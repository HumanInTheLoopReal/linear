import { Readable } from "node:stream";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CODEX_HOOK_META,
  setupCodexHookCommands,
} from "../../../src/commands/codex-hook.js";
import { setCodexHookExecPrime } from "../../../src/services/codex-hook-service.js";

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  setupCodexHookCommands(program);
  return program;
}

/** Swap process.stdin for a non-TTY readable carrying the given payload. */
function fakeStdin(payload: string): Readable {
  const stream = new Readable({
    read() {
      this.push(payload);
      this.push(null);
    },
  });
  (stream as Readable & { isTTY?: boolean }).isTTY = false;
  return stream;
}

let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;
let stdinSpy: ReturnType<typeof vi.spyOn>;
let restorePrime: (() => void) | undefined;

beforeEach(() => {
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  process.exitCode = undefined;
});

afterEach(() => {
  restorePrime?.();
  restorePrime = undefined;
  stdinSpy?.mockRestore();
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

function setStdin(payload: string): void {
  stdinSpy = vi
    .spyOn(process, "stdin", "get")
    .mockReturnValue(fakeStdin(payload) as unknown as typeof process.stdin);
}

describe("CODEX_HOOK_META", () => {
  it("exposes the four lifecycle events in its context", () => {
    expect(CODEX_HOOK_META.name).toBe("codex-hook");
    for (const event of [
      "SessionStart",
      "PreCompact",
      "PostCompact",
      "UserPromptSubmit",
    ]) {
      expect(CODEX_HOOK_META.context).toContain(event);
    }
  });
});

describe("setupCodexHookCommands", () => {
  it("registers a hidden codex-hook command", () => {
    const program = createProgram();
    const cmd = program.commands.find((c) => c.name() === "codex-hook");
    expect(cmd).toBeDefined();
    // Hidden commands are registered but excluded from help output.
    const visible = program
      .createHelp()
      .visibleCommands(program)
      .map((c) => c.name());
    expect(visible).not.toContain("codex-hook");
  });

  it("dispatches SessionStart and emits the response envelope", async () => {
    restorePrime = setCodexHookExecPrime(async () => "PRIME\nlinear next\n");
    setStdin(
      JSON.stringify({
        session_id: "s1",
        cwd: "/repo",
        hook_event_name: "SessionStart",
      }),
    );
    const program = createProgram();
    await program.parseAsync(["node", "test", "codex-hook", "SessionStart"]);
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    const envelope = JSON.parse(out.trim());
    expect(envelope.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(envelope.hookSpecificOutput.additionalContext).toContain(
      "linear next",
    );
    expect(process.exitCode).toBeUndefined();
  });

  it("tolerates an empty stdin (uses positional event)", async () => {
    restorePrime = setCodexHookExecPrime(async () => "");
    setStdin("");
    const program = createProgram();
    await program.parseAsync(["node", "test", "codex-hook", "SessionStart"]);
    // Empty prime output → no envelope, clean exit.
    expect(stdoutSpy.mock.calls.map((c) => c[0]).join("")).toBe("");
    expect(process.exitCode).toBeUndefined();
  });

  it("exits non-zero with a stderr diagnostic on malformed JSON", async () => {
    setStdin("{not valid json");
    const program = createProgram();
    await program.parseAsync(["node", "test", "codex-hook", "SessionStart"]);
    expect(process.exitCode).toBe(1);
    expect(stderrSpy.mock.calls.map((c) => c[0]).join("")).not.toBe("");
  });

  it("exits non-zero on an unsupported event", async () => {
    setStdin("");
    const program = createProgram();
    await program.parseAsync(["node", "test", "codex-hook", "Nonsense"]);
    expect(process.exitCode).toBe(1);
    expect(stderrSpy.mock.calls.map((c) => c[0]).join("")).toContain(
      "unsupported Codex hook event",
    );
  });
});
