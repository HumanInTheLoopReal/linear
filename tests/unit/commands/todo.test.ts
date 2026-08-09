import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  return { ...actual, outputSuccess: vi.fn(), outputResult: vi.fn() };
});

vi.mock("../../../src/resolvers/team-resolver.js", () => ({
  resolveTeamId: vi.fn().mockResolvedValue("resolved-team-uuid"),
}));

vi.mock("../../../src/common/config-store.js", () => ({
  getDefaultTeam: vi.fn(() => null),
}));

vi.mock("../../../src/resolvers/issue-resolver.js", () => ({
  resolveIssueId: vi.fn().mockResolvedValue("resolved-issue-uuid"),
}));

vi.mock("../../../src/resolvers/status-resolver.js", () => ({
  resolveStateIdByType: vi.fn().mockResolvedValue("completed-state-uuid"),
}));

vi.mock("../../../src/services/todo-service.js", () => ({
  listTodos: vi.fn().mockResolvedValue([]),
  TODO_LABEL_NAME: "type:task",
  TODO_LABEL_DESCRIPTION: "Lightweight TODO task issue.",
}));

vi.mock("../../../src/services/label-service.js", () => ({
  ensureWorkspaceLabel: vi.fn().mockResolvedValue("label-uuid"),
}));

vi.mock("../../../src/services/issue-service.js", () => ({
  createIssue: vi
    .fn()
    .mockResolvedValue({ id: "new-issue", identifier: "ENG-99" }),
  getIssue: vi.fn().mockResolvedValue({
    id: "resolved-issue-uuid",
    identifier: "ENG-1",
    team: { id: "team-uuid", key: "ENG", name: "Eng" },
  }),
  updateIssue: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../../src/services/comment-service.js", () => ({
  createComment: vi.fn().mockResolvedValue({}),
}));

import { setupTodoCommands } from "../../../src/commands/todo.js";
import { outputResult } from "../../../src/common/output.js";
import { resolveTeamId } from "../../../src/resolvers/team-resolver.js";
import { createComment } from "../../../src/services/comment-service.js";
import {
  createIssue,
  updateIssue,
} from "../../../src/services/issue-service.js";
import { ensureWorkspaceLabel } from "../../../src/services/label-service.js";
import { listTodos } from "../../../src/services/todo-service.js";

function createProgram(): Command {
  const program = new Command();
  setupTodoCommands(program);
  return program;
}

describe("linear todo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("parent command with no subcommand runs list", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "todo"]);
    expect(listTodos).toHaveBeenCalledWith(expect.anything(), {});
    expect(outputResult).toHaveBeenCalledWith(
      [],
      expect.any(Function),
      expect.any(Object),
    );
  });

  it("list defaults: open todos, limit 50", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "todo", "list"]);
    expect(listTodos).toHaveBeenCalledWith(expect.anything(), {
      all: false,
      teamId: undefined,
      limit: 50,
    });
  });

  it("list --all forwards to the service", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "todo", "list", "--all"]);
    expect(listTodos).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ all: true }),
    );
  });

  it("list --team resolves the team UUID and forwards it", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "todo", "list", "--team", "ENG"]);
    expect(resolveTeamId).toHaveBeenCalledWith(expect.anything(), "ENG");
    expect(listTodos).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ teamId: "resolved-team-uuid" }),
    );
  });

  it("add ensures the label, resolves the team, and creates the issue", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "todo",
      "add",
      "Buy milk",
      "--team",
      "ENG",
    ]);
    expect(resolveTeamId).toHaveBeenCalledWith(expect.anything(), "ENG");
    expect(ensureWorkspaceLabel).toHaveBeenCalledWith(
      expect.anything(),
      "type:task",
      "Lightweight TODO task issue.",
    );
    expect(createIssue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        teamId: "resolved-team-uuid",
        title: "Buy milk",
        priority: 2,
        labelIds: ["label-uuid"],
      }),
    );
  });

  it("add forwards --priority and --description", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "todo",
      "add",
      "Important",
      "--team",
      "ENG",
      "--priority",
      "1",
      "--description",
      "context here",
    ]);
    expect(createIssue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        priority: 1,
        description: "context here",
      }),
    );
  });

  it("done closes the issue and posts a comment when --reason is given", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "todo",
      "done",
      "ENG-1",
      "--reason",
      "shipped it",
    ]);
    expect(createComment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        issueId: "resolved-issue-uuid",
        body: "shipped it",
      }),
    );
    expect(updateIssue).toHaveBeenCalledWith(
      expect.anything(),
      "resolved-issue-uuid",
      { stateId: "completed-state-uuid" },
    );
    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({
        closed: [{ id: "resolved-issue-uuid", identifier: "ENG-1" }],
        count: 1,
        reason: "shipped it",
      }),
      expect.any(Function),
      expect.anything(),
    );
  });

  it("done without --reason does not post a comment", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "todo", "done", "ENG-1"]);
    expect(createComment).not.toHaveBeenCalled();
    expect(updateIssue).toHaveBeenCalled();
  });
});
