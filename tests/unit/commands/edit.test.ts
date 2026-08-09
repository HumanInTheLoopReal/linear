import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/common/context.js", () => ({
  createContext: vi.fn(() => ({
    gql: { request: vi.fn() },
    sdk: { sdk: {} },
  })),
  getRootOpts: vi.fn(() => ({ apiToken: "test-token" })),
}));

vi.mock("../../../src/common/output.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/common/output.js")>();
  return {
    ...actual,
    outputSuccess: vi.fn(),
    outputResult: vi.fn(),
  };
});

vi.mock("../../../src/resolvers/issue-resolver.js", () => ({
  resolveIssueId: vi.fn().mockResolvedValue("resolved-issue-uuid"),
}));

vi.mock("../../../src/services/issue-service.js", () => ({
  getEditableFieldValue: vi.fn().mockResolvedValue("old value"),
  setEditableFieldValue: vi.fn().mockResolvedValue({
    id: "resolved-issue-uuid",
    identifier: "ENG-1",
  }),
}));

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(() => ({ status: 0 })),
}));

import { setupEditCommands } from "../../../src/commands/edit.js";
import { outputResult } from "../../../src/common/output.js";
import {
  getEditableFieldValue,
  setEditableFieldValue,
} from "../../../src/services/issue-service.js";

function createProgram(): Command {
  const program = new Command();
  program.option("--api-token <token>");
  setupEditCommands(program);
  return program;
}

describe("edit", () => {
  const ORIGINAL_EDITOR = process.env.EDITOR;
  const ORIGINAL_VISUAL = process.env.VISUAL;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    process.env.EDITOR = "vim";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (ORIGINAL_EDITOR === undefined) delete process.env.EDITOR;
    else process.env.EDITOR = ORIGINAL_EDITOR;
    if (ORIGINAL_VISUAL === undefined) delete process.env.VISUAL;
    else process.env.VISUAL = ORIGINAL_VISUAL;
  });

  it("writes the current value to a tmp file, calls $EDITOR, and sends new value to setEditableFieldValue", async () => {
    const fs = await import("node:fs");
    vi.spyOn(fs.default, "writeFileSync").mockImplementation(() => undefined);
    vi.spyOn(fs.default, "readFileSync").mockReturnValue("new title");
    vi.spyOn(fs.default, "unlinkSync").mockImplementation(() => undefined);
    vi.mocked(getEditableFieldValue).mockResolvedValueOnce("old title");

    const program = createProgram();
    await program.parseAsync(["node", "test", "edit", "ENG-1", "--title"]);

    expect(getEditableFieldValue).toHaveBeenCalledWith(
      expect.anything(),
      "resolved-issue-uuid",
      "title",
    );
    expect(setEditableFieldValue).toHaveBeenCalledWith(
      expect.anything(),
      "resolved-issue-uuid",
      "title",
      "new title",
    );
    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({ changed: true, field: "title" }),
      expect.any(Function),
      expect.anything(),
    );
  });

  it("emits {changed: false} when the editor saved an unchanged value", async () => {
    const fs = await import("node:fs");
    vi.spyOn(fs.default, "writeFileSync").mockImplementation(() => undefined);
    vi.spyOn(fs.default, "readFileSync").mockReturnValue("same body");
    vi.spyOn(fs.default, "unlinkSync").mockImplementation(() => undefined);
    vi.mocked(getEditableFieldValue).mockResolvedValueOnce("same body");

    const program = createProgram();
    await program.parseAsync(["node", "test", "edit", "ENG-1"]);

    expect(setEditableFieldValue).not.toHaveBeenCalled();
    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({ changed: false, field: "description" }),
      expect.any(Function),
      expect.anything(),
    );
  });

  it("rejects multiple field flags together (exits 1)", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "edit",
      "ENG-1",
      "--title",
      "--notes",
    ]);

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(getEditableFieldValue).not.toHaveBeenCalled();
  });

  it("errors when $EDITOR / $VISUAL are unset", async () => {
    delete process.env.EDITOR;
    delete process.env.VISUAL;

    const program = createProgram();
    await program.parseAsync(["node", "test", "edit", "ENG-1"]);

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(getEditableFieldValue).not.toHaveBeenCalled();
  });
});
