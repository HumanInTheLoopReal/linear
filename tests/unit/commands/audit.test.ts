import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/common/output.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/common/output.js")>();
  return {
    ...actual,
    outputSuccess: vi.fn(),
    outputResult: vi.fn(),
  };
});

vi.mock("../../../src/common/audit-store.js", () => ({
  appendAuditEntry: vi.fn((input, _scope) => ({
    id: "int-deadbeef",
    kind: input.kind,
    created_at: "2026-05-12T00:00:00.000Z",
    ...input,
  })),
  getAuditPath: vi.fn(() => "/tmp/test/.linear/audit.jsonl"),
}));

import { setupAuditCommands } from "../../../src/commands/audit.js";
import {
  appendAuditEntry,
  getAuditPath,
} from "../../../src/common/audit-store.js";
import { outputResult } from "../../../src/common/output.js";

function createProgram(): Command {
  const program = new Command();
  setupAuditCommands(program);
  return program;
}

describe("linear audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    // Default: pretend stdin is a TTY so the auto-stdin path doesn't fire.
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
  });

  describe("record", () => {
    it("appends an entry from flags and emits {id, kind}", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "audit",
        "record",
        "--kind",
        "llm_call",
        "--model",
        "claude-opus-4-7",
        "--prompt",
        "p",
        "--response",
        "r",
        "--issue-id",
        "ENG-1",
      ]);

      expect(appendAuditEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "llm_call",
          model: "claude-opus-4-7",
          prompt: "p",
          response: "r",
          issue_id: "ENG-1",
        }),
        { global: false },
      );
      expect(outputResult).toHaveBeenCalledWith(
        {
          id: "int-deadbeef",
          kind: "llm_call",
        },
        expect.any(Function),
        expect.anything(),
      );
    });

    it("forwards --exit-code 0 as a numeric (not boolean) field", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "audit",
        "record",
        "--kind",
        "tool_call",
        "--tool-name",
        "Bash",
        "--exit-code",
        "0",
      ]);
      expect(appendAuditEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "tool_call",
          tool_name: "Bash",
          exit_code: 0,
        }),
        { global: false },
      );
    });

    it("rejects when --kind is missing and stdin is a TTY", async () => {
      const program = createProgram();
      await program.parseAsync(["node", "test", "audit", "record"]);
      expect(process.exit).toHaveBeenCalledWith(1);
      expect(appendAuditEntry).not.toHaveBeenCalled();
    });
  });

  describe("label", () => {
    it("appends a label entry pointing at the parent and emits {id, parent_id, label}", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "audit",
        "label",
        "int-cafefeed",
        "--label",
        "good",
        "--reason",
        "answer was correct",
      ]);

      expect(appendAuditEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "label",
          parent_id: "int-cafefeed",
          label: "good",
          reason: "answer was correct",
        }),
        { global: false },
      );
      expect(outputResult).toHaveBeenCalledWith(
        {
          id: "int-deadbeef",
          parent_id: "int-cafefeed",
          label: "good",
        },
        expect.any(Function),
        expect.anything(),
      );
    });

    it("commander reports a missing-required-option error for --label", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "audit",
        "label",
        "int-cafefeed",
      ]);
      // Commander prints the missing-option error and calls process.exit before
      // (mocked exit lets execution continue, so we don't assert call-count on
      // appendAuditEntry — just that the error path was taken).
      expect(process.exit).toHaveBeenCalled();
    });
  });

  describe("path", () => {
    it("emits the absolute audit-log path", async () => {
      const program = createProgram();
      await program.parseAsync(["node", "test", "audit", "path"]);
      expect(getAuditPath).toHaveBeenCalled();
      expect(outputResult).toHaveBeenCalledWith(
        {
          path: "/tmp/test/.linear/audit.jsonl",
        },
        expect.any(Function),
        expect.anything(),
      );
    });
  });

  describe("--global", () => {
    it("forwards {global:true} to appendAuditEntry on record", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "audit",
        "record",
        "--kind",
        "llm_call",
        "--model",
        "x",
        "--global",
      ]);
      expect(appendAuditEntry).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "llm_call", model: "x" }),
        { global: true },
      );
    });

    it("forwards {global:true} to appendAuditEntry on label", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "audit",
        "label",
        "int-cafefeed",
        "--label",
        "good",
        "--global",
      ]);
      expect(appendAuditEntry).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "label", label: "good" }),
        { global: true },
      );
    });
  });
});
