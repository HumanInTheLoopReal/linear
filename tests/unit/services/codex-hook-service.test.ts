import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CodexHookResponse } from "../../../src/common/codex-hook-types.js";
import {
  codexHookMarkerBaseDir,
  codexHookRefreshMarkerPath,
  runCodexHook,
  setCodexHookExecPrime,
} from "../../../src/services/codex-hook-service.js";

/** Collect everything written to a Writable so we can inspect the envelope. */
function captureStream(): { stream: Writable; text: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  return { stream, text: () => chunks.join("") };
}

function parseEnvelope(raw: string): CodexHookResponse {
  return JSON.parse(raw.trim()) as CodexHookResponse;
}

let tmpHome: string;
let homedirSpy: ReturnType<typeof vi.spyOn>;
let restorePrime: (() => void) | undefined;

beforeEach(() => {
  // Redirect the user-cache dir (and therefore the marker base dir) into a
  // throwaway temp tree so marker writes never touch the real ~/.cache.
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-hook-home-"));
  homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
});

afterEach(() => {
  restorePrime?.();
  restorePrime = undefined;
  homedirSpy.mockRestore();
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("codexHookRefreshMarkerPath", () => {
  it("is deterministic for the same session + cwd", () => {
    const a = codexHookRefreshMarkerPath({ session_id: "s1", cwd: "/repo" });
    const b = codexHookRefreshMarkerPath({ session_id: "s1", cwd: "/repo" });
    expect(a).toBe(b);
    expect(a.startsWith(codexHookMarkerBaseDir())).toBe(true);
    expect(a.endsWith(".refresh")).toBe(true);
  });

  it("differs when session or cwd differs", () => {
    const base = codexHookRefreshMarkerPath({ session_id: "s1", cwd: "/repo" });
    expect(
      codexHookRefreshMarkerPath({ session_id: "s2", cwd: "/repo" }),
    ).not.toBe(base);
    expect(
      codexHookRefreshMarkerPath({ session_id: "s1", cwd: "/other" }),
    ).not.toBe(base);
  });

  it("falls back to placeholder keys for empty input", () => {
    const empty = codexHookRefreshMarkerPath({});
    const placeholders = codexHookRefreshMarkerPath({
      session_id: "unknown-session",
      cwd: "unknown-workspace",
    });
    expect(empty).toBe(placeholders);
  });
});

describe("runCodexHook — SessionStart", () => {
  it("injects full prime output as additionalContext", async () => {
    restorePrime = setCodexHookExecPrime(async (memoriesOnly) => {
      expect(memoriesOnly).toBe(false);
      return "LINEAR PRIME\nlinear next\n";
    });
    const { stream, text } = captureStream();
    await runCodexHook(
      "SessionStart",
      { session_id: "s1", cwd: "/repo", hook_event_name: "SessionStart" },
      stream,
    );
    const got = parseEnvelope(text());
    expect(got.continue).toBe(true);
    expect(got.hookSpecificOutput?.hookEventName).toBe("SessionStart");
    expect(got.hookSpecificOutput?.additionalContext).toContain("linear next");
  });

  it("emits nothing when prime fails", async () => {
    restorePrime = setCodexHookExecPrime(async () => {
      throw new Error("workspace unavailable");
    });
    const { stream, text } = captureStream();
    await runCodexHook("SessionStart", { session_id: "s1" }, stream);
    expect(text()).toBe("");
  });

  it("emits nothing when prime output is empty", async () => {
    restorePrime = setCodexHookExecPrime(async () => "   \n");
    const { stream, text } = captureStream();
    await runCodexHook("SessionStart", { session_id: "s1" }, stream);
    expect(text()).toBe("");
  });
});

describe("runCodexHook — PreCompact", () => {
  it("warns via systemMessage when memories prime fails", async () => {
    restorePrime = setCodexHookExecPrime(async (memoriesOnly) => {
      expect(memoriesOnly).toBe(true);
      throw new Error("workspace unavailable");
    });
    const { stream, text } = captureStream();
    await runCodexHook(
      "PreCompact",
      { hook_event_name: "PreCompact", trigger: "manual" },
      stream,
    );
    const got = parseEnvelope(text());
    expect(got.continue).toBe(true);
    expect(got.systemMessage).toContain("Linear context check failed");
  });

  it("emits nothing on success", async () => {
    restorePrime = setCodexHookExecPrime(async () => "MEMORIES\n");
    const { stream, text } = captureStream();
    await runCodexHook("PreCompact", {}, stream);
    expect(text()).toBe("");
  });
});

describe("runCodexHook — PostCompact then UserPromptSubmit", () => {
  it("marks a refresh and refreshes exactly once", async () => {
    let calls = 0;
    restorePrime = setCodexHookExecPrime(async (memoriesOnly) => {
      calls += 1;
      expect(memoriesOnly).toBe(false);
      return "REFRESHED LINEAR CONTEXT\n";
    });

    const input = {
      session_id: "s1",
      cwd: path.join("repo", "sub"),
    };
    const marker = codexHookRefreshMarkerPath(input);

    // PostCompact writes the marker, emits nothing.
    const post = captureStream();
    await runCodexHook(
      "PostCompact",
      { ...input, hook_event_name: "PostCompact" },
      post.stream,
    );
    expect(post.text()).toBe("");
    expect(fs.existsSync(marker)).toBe(true);

    // First UserPromptSubmit consumes the marker and re-primes.
    const first = captureStream();
    await runCodexHook(
      "UserPromptSubmit",
      { ...input, hook_event_name: "UserPromptSubmit" },
      first.stream,
    );
    expect(calls).toBe(1);
    expect(fs.existsSync(marker)).toBe(false);
    const got = parseEnvelope(first.text());
    expect(got.hookSpecificOutput?.additionalContext).toContain(
      "REFRESHED LINEAR CONTEXT",
    );
    expect(got.hookSpecificOutput?.hookEventName).toBe("UserPromptSubmit");

    // Second UserPromptSubmit: no marker, no work, no output.
    const second = captureStream();
    await runCodexHook(
      "UserPromptSubmit",
      { ...input, hook_event_name: "UserPromptSubmit" },
      second.stream,
    );
    expect(calls).toBe(1);
    expect(second.text()).toBe("");
  });

  it("warns and keeps the marker when refresh prime fails", async () => {
    restorePrime = setCodexHookExecPrime(async () => {
      throw new Error("workspace unavailable");
    });
    const input = { session_id: "s2", cwd: "/repo" };
    const marker = codexHookRefreshMarkerPath(input);
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, "1\n");

    const { stream, text } = captureStream();
    await runCodexHook(
      "UserPromptSubmit",
      { ...input, hook_event_name: "UserPromptSubmit" },
      stream,
    );
    const got = parseEnvelope(text());
    expect(got.systemMessage).toContain(
      "Linear context refresh after compaction failed",
    );
    // Marker survives so a later prompt can retry.
    expect(fs.existsSync(marker)).toBe(true);
  });
});

describe("runCodexHook — dispatch", () => {
  it("prefers hook_event_name over the positional event", async () => {
    restorePrime = setCodexHookExecPrime(async () => "CONTEXT\n");
    const { stream, text } = captureStream();
    // Positional says PostCompact, but the envelope says SessionStart.
    await runCodexHook(
      "PostCompact",
      { hook_event_name: "SessionStart", session_id: "s1" },
      stream,
    );
    const got = parseEnvelope(text());
    expect(got.hookSpecificOutput?.hookEventName).toBe("SessionStart");
  });

  it("throws on an unsupported event", async () => {
    const { stream } = captureStream();
    await expect(runCodexHook("Nonsense", {}, stream)).rejects.toThrow(
      'unsupported Codex hook event "Nonsense"',
    );
  });
});
