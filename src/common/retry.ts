interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
}

interface RetryableError {
  response?: {
    status?: number;
  };
}

/**
 * Node's native fetch (undici) reports transport failures as a generic
 * `TypeError: fetch failed` and carries the real error (`ECONNRESET`,
 * `ETIMEDOUT`, ...) on `cause`. Reading only the top-level message misses
 * every one of them, so walk the whole chain. The `seen` set keeps a
 * self-referential `cause` from looping forever.
 */
function collectErrorMessages(error: unknown): string {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    messages.push(current.message);
    current = current.cause;
  }
  return messages.join(" ").toLowerCase();
}

const RETRYABLE_MESSAGES = [
  "timed out",
  "etimedout",
  "econnreset",
  "network",
  "fetch failed",
];

export function isRetryable(error: unknown): boolean {
  const err = error as RetryableError;
  const status = err?.response?.status;
  if (typeof status === "number") {
    return status === 429 || (status >= 500 && status < 600);
  }
  const msg = collectErrorMessages(error);
  return RETRYABLE_MESSAGES.some((needle) => msg.includes(needle));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 500 } = options ?? {};
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries || !isRetryable(error)) throw error;
      const delay = baseDelayMs * 2 ** attempt;
      await new Promise<void>((r) => setTimeout(r, delay));
    }
  }
  throw new Error("withRetry: exhausted attempts");
}
