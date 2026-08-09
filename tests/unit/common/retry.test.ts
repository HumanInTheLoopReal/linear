import { describe, expect, it, vi } from "vitest";
import { isRetryable, withRetry } from "../../../src/common/retry.js";

describe("isRetryable", () => {
  it("returns true for 429", () => {
    expect(isRetryable({ response: { status: 429 } })).toBe(true);
  });

  it("returns true for 500", () => {
    expect(isRetryable({ response: { status: 500 } })).toBe(true);
  });

  it("returns true for 503", () => {
    expect(isRetryable({ response: { status: 503 } })).toBe(true);
  });

  it("returns false for 400", () => {
    expect(isRetryable({ response: { status: 400 } })).toBe(false);
  });

  it("returns false for 404", () => {
    expect(isRetryable({ response: { status: 404 } })).toBe(false);
  });

  it("returns false for auth errors", () => {
    expect(isRetryable({ response: { status: 401 } })).toBe(false);
  });

  it("returns true for timeout errors", () => {
    expect(isRetryable(new Error("Request timed out"))).toBe(true);
  });

  it("returns false for generic errors", () => {
    expect(isRetryable(new Error("Entity not found"))).toBe(false);
  });
});

describe("withRetry", () => {
  it("returns result on first success", async () => {
    const fn = vi.fn().mockResolvedValueOnce("ok");
    const result = await withRetry(fn, { baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 and succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ response: { status: 429 } })
      .mockResolvedValueOnce("ok");
    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on 503 up to maxRetries then throws", async () => {
    const err = { response: { status: 503 } };
    const fn = vi.fn().mockRejectedValue(err);
    await expect(
      withRetry(fn, { maxRetries: 2, baseDelayMs: 1 }),
    ).rejects.toEqual(err);
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("does not retry non-retryable errors", async () => {
    const err = new Error("Entity not found");
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn, { baseDelayMs: 1 })).rejects.toThrow(
      "Entity not found",
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("uses exponential backoff: 500ms → 1s → 2s", async () => {
    vi.useFakeTimers();
    const delays: number[] = [];
    const realSetTimeout = globalThis.setTimeout;

    const spy = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((cb: TimerHandler, ms?: number) => {
        delays.push(ms ?? 0);
        return realSetTimeout(cb as () => void, 0);
      });

    const err = { response: { status: 503 } };
    const fn = vi
      .fn()
      .mockRejectedValueOnce(err)
      .mockRejectedValueOnce(err)
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce("ok");

    const promise = withRetry(fn, { maxRetries: 3, baseDelayMs: 500 });
    await vi.runAllTimersAsync();
    await promise;

    spy.mockRestore();
    vi.useRealTimers();

    expect(delays).toEqual([500, 1000, 2000]);
  });
});

/**
 * Node's native fetch (undici) rejects transport failures as a generic
 * `TypeError: fetch failed` and hangs the real error off `cause`, so anything
 * that reads only the top-level message classifies these as fatal.
 */
function undiciTransportError(code: string): TypeError {
  return new TypeError("fetch failed", {
    cause: new Error(`connect ${code} 104.16.0.1:443`),
  });
}

describe("isRetryable — transport failures on the cause chain", () => {
  it("retries a transport failure reported only on the cause", () => {
    expect(isRetryable(undiciTransportError("ECONNRESET"))).toBe(true);
    expect(isRetryable(undiciTransportError("ETIMEDOUT"))).toBe(true);
  });

  it("retries a bare undici wrapper with no cause", () => {
    expect(isRetryable(new TypeError("fetch failed"))).toBe(true);
  });

  it("retries a cause nested more than one level deep", () => {
    const error = new Error("request failed", {
      cause: new TypeError("fetch failed", {
        cause: new Error("read ECONNRESET"),
      }),
    });
    expect(isRetryable(error)).toBe(true);
  });

  it("still rejects non-errors and unrelated failures", () => {
    expect(isRetryable("not an error")).toBe(false);
    expect(isRetryable(new Error("Issue not found"))).toBe(false);
  });

  it("terminates on a self-referential cause chain", () => {
    const error = new Error("boom") as Error & { cause?: unknown };
    error.cause = error;
    expect(isRetryable(error)).toBe(false);
  });
});

describe("withRetry — transport failures", () => {
  it("retries a transport failure and returns the eventual success", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(undiciTransportError("ECONNRESET"))
      .mockResolvedValue("ok");

    const result = await withRetry(fn, { baseDelayMs: 1 });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("rethrows after exhausting retries", async () => {
    const fn = vi.fn().mockRejectedValue(undiciTransportError("ECONNRESET"));

    await expect(
      withRetry(fn, { maxRetries: 2, baseDelayMs: 1 }),
    ).rejects.toThrow("fetch failed");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
