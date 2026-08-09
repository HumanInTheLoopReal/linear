import { describe, expect, it, vi } from "vitest";
import { AuthenticationError } from "../../../src/common/errors.js";
import {
  handleCommand,
  outputAuthError,
  outputError,
  outputResult,
  outputSuccess,
  parseLimit,
  resolveJsonMode,
} from "../../../src/common/output.js";

describe("resolveJsonMode", () => {
  it("returns null when undefined (text path)", () => {
    expect(resolveJsonMode(undefined)).toBeNull();
  });

  it("returns null when explicitly false", () => {
    expect(resolveJsonMode(false)).toBeNull();
  });

  it("returns 'pretty' for bare --json (Commander parses to true)", () => {
    expect(resolveJsonMode(true)).toBe("pretty");
  });

  it("returns 'pretty' for explicit --json=pretty", () => {
    expect(resolveJsonMode("pretty")).toBe("pretty");
  });

  it("returns 'compact' for --json=compact", () => {
    expect(resolveJsonMode("compact")).toBe("compact");
  });

  it("falls back to 'pretty' for unrecognized strings (never silent text path)", () => {
    expect(resolveJsonMode("verbose")).toBe("pretty");
  });

  // Agent-mode default (lin-g1hy): only a *bare* --json flips to compact.
  it("returns 'compact' for bare --json under agent mode", () => {
    expect(resolveJsonMode(true, true)).toBe("compact");
  });

  it("keeps explicit --json=pretty pretty even under agent mode", () => {
    expect(resolveJsonMode("pretty", true)).toBe("pretty");
  });

  it("keeps the text path (null) under agent mode when --json is absent", () => {
    expect(resolveJsonMode(undefined, true)).toBeNull();
    expect(resolveJsonMode(false, true)).toBeNull();
  });
});

describe("outputSuccess", () => {
  it("writes pretty JSON to stdout by default", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    outputSuccess({ id: "123", title: "Test" });
    expect(spy).toHaveBeenCalledWith(
      JSON.stringify({ id: "123", title: "Test" }, null, 2),
    );
    spy.mockRestore();
  });

  it("writes compact JSON when mode is 'compact'", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    outputSuccess({ id: "123", title: "Test" }, "compact");
    expect(spy).toHaveBeenCalledWith('{"id":"123","title":"Test"}');
    spy.mockRestore();
  });

  it("writes pretty JSON when mode is explicitly 'pretty'", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    outputSuccess({ a: 1 }, "pretty");
    expect(spy).toHaveBeenCalledWith(JSON.stringify({ a: 1 }, null, 2));
    spy.mockRestore();
  });
});

describe("outputResult", () => {
  it("writes formatter output to stdout in the default (text) path", () => {
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    outputResult({ count: 3 }, (d) => `count=${d.count}`);
    // Body + trailing newline (separate write).
    expect(writeSpy).toHaveBeenNthCalledWith(1, "count=3");
    expect(writeSpy).toHaveBeenNthCalledWith(2, "\n");
    writeSpy.mockRestore();
  });

  it("does not append a second newline when the formatter already ends with one", () => {
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    outputResult({}, () => "line\n");
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy).toHaveBeenCalledWith("line\n");
    writeSpy.mockRestore();
  });

  it("delegates to outputSuccess (pretty JSON) when opts.json is true", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    outputResult({ id: "X-1" }, () => "should not be called", { json: true });
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify({ id: "X-1" }, null, 2));
    expect(writeSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
    writeSpy.mockRestore();
  });

  it("emits compact JSON when opts.json is 'compact'", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    outputResult({ id: "X-1" }, () => "should not be called", {
      json: "compact",
    });
    expect(logSpy).toHaveBeenCalledWith('{"id":"X-1"}');
    logSpy.mockRestore();
  });

  it("emits pretty JSON when opts.json is 'pretty' (explicit)", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    outputResult({ id: "X-1" }, () => "should not be called", {
      json: "pretty",
    });
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify({ id: "X-1" }, null, 2));
    logSpy.mockRestore();
  });

  it("takes the text path when opts.json is false", () => {
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    outputResult({}, () => "text-out", { json: false });
    expect(writeSpy).toHaveBeenCalledWith("text-out");
    writeSpy.mockRestore();
  });
});

describe("outputError", () => {
  it("writes error JSON to stderr and exits", () => {
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    outputError(new Error("something failed"));

    expect(stderrSpy).toHaveBeenCalledWith(
      JSON.stringify({ error: "something failed" }, null, 2),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);

    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

describe("handleCommand", () => {
  it("calls the wrapped function", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const wrapped = handleCommand(fn);
    await wrapped("arg1", "arg2");
    expect(fn).toHaveBeenCalledWith("arg1", "arg2");
  });

  it("catches errors and outputs them", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("boom"));
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    const wrapped = handleCommand(fn);
    await wrapped();

    expect(stderrSpy).toHaveBeenCalledWith(
      JSON.stringify({ error: "boom" }, null, 2),
    );

    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

describe("handleCommand with AuthenticationError", () => {
  it("calls outputAuthError for AuthenticationError", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    const handler = handleCommand(async () => {
      throw new AuthenticationError("expired");
    });

    await handler();

    const output = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(output.error).toBe("AUTHENTICATION_REQUIRED");
    expect(exitSpy).toHaveBeenCalledWith(42);

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

describe("parseLimit", () => {
  it("parses valid integer string", () => {
    expect(parseLimit("50")).toBe(50);
  });

  it("parses single digit", () => {
    expect(parseLimit("1")).toBe(1);
  });

  it("throws on non-numeric string", () => {
    expect(() => parseLimit("foo")).toThrow();
  });

  it("throws on zero", () => {
    expect(() => parseLimit("0")).toThrow();
  });

  it("throws on negative number", () => {
    expect(() => parseLimit("-1")).toThrow();
  });
});

describe("outputAuthError", () => {
  it("outputs structured JSON with AUTHENTICATION_REQUIRED", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    const err = new AuthenticationError("Token expired");
    outputAuthError(err);

    const output = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(output.error).toBe("AUTHENTICATION_REQUIRED");
    expect(output.message).toBe("Linear API authentication failed.");
    expect(output.details).toBe("Token expired");
    expect(output.action).toBe("USER_ACTION_REQUIRED");
    expect(output.instruction).toContain("linear auth");
    expect(output.exit_code).toBe(42);
    expect(exitSpy).toHaveBeenCalledWith(42);

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("emits a remediation array echoing the env-var step", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    outputAuthError(new AuthenticationError("Token expired"));

    const output = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(Array.isArray(output.remediation)).toBe(true);
    expect(
      output.remediation.some((line: string) =>
        line.includes("LINEAR_API_TOKEN"),
      ),
    ).toBe(true);
    // instruction is derived from the remediation list, preserving the
    // existing "linear auth" substring contract.
    expect(output.instruction).toBe(output.remediation.join("\n"));

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("echoes a missing-token error's message and remediation verbatim", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    const remediation = [
      "Set LINEAR_API_TOKEN=<token> in the environment, or pass --api-token <token>.",
      'Persist once: echo "$TOKEN" | linear auth login',
    ];
    outputAuthError(
      new AuthenticationError("No token in any source.", {
        kind: "missing",
        message: "No API token found.",
        remediation,
      }),
    );

    const output = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(output.message).toBe("No API token found.");
    expect(output.remediation).toEqual(remediation);
    expect(output.exit_code).toBe(42);
    expect(exitSpy).toHaveBeenCalledWith(42);

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
