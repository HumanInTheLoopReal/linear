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
  return {
    ...actual,
    outputSuccess: vi.fn(),
    outputResult: vi.fn(),
  };
});

vi.mock("../../../src/resolvers/team-resolver.js", () => ({
  resolveTeamId: vi.fn().mockResolvedValue("resolved-team-uuid"),
}));

vi.mock("../../../src/common/config-store.js", () => ({
  getDefaultTeam: vi.fn(() => null),
}));

vi.mock("../../../src/resolvers/issue-resolver.js", () => ({
  resolveIssueId: vi
    .fn()
    .mockImplementation(async (_sdk, id: string) => `uuid-${id}`),
}));

vi.mock("../../../src/resolvers/label-resolver.js", () => ({
  resolveLabelId: vi.fn().mockResolvedValue("resolved-label-uuid"),
}));

vi.mock("../../../src/services/label-service.js", () => ({
  listLabels: vi.fn().mockResolvedValue({
    nodes: [{ id: "lbl-1", name: "Bug", color: "#ff0000", type: "issue" }],
    pageInfo: { hasNextPage: false, endCursor: null },
  }),
  listProjectLabels: vi.fn().mockResolvedValue({
    nodes: [
      {
        id: "plbl-1",
        name: "Customer",
        color: "#0000ff",
        type: "project",
      },
    ],
    pageInfo: { hasNextPage: false, endCursor: null },
  }),
  ensureWorkspaceLabel: vi.fn().mockResolvedValue("ensured-label-uuid"),
  createWorkspaceLabel: vi.fn().mockResolvedValue({
    id: "created-label-uuid",
    name: "frontend",
    created: true,
  }),
  addLabelToIssues: vi.fn().mockResolvedValue([
    {
      status: "added",
      issue_id: "uuid-ENG-1",
      issue_identifier: "ENG-1",
      label: "bug",
      changed: true,
    },
  ]),
  removeLabelFromIssues: vi.fn().mockResolvedValue([
    {
      status: "removed",
      issue_id: "uuid-ENG-1",
      issue_identifier: "ENG-1",
      label: "bug",
      changed: true,
    },
  ]),
  getLabelsForIssue: vi.fn().mockResolvedValue(["alpha", "zebra"]),
  propagateLabelToChildren: vi.fn().mockResolvedValue([
    {
      status: "propagated",
      issue_id: "uuid-ENG-2",
      issue_identifier: "ENG-2",
      label: "bug",
      changed: true,
    },
  ]),
  tallyLabelUsage: vi.fn().mockResolvedValue(new Map([["lbl-1", 7]])),
}));

import { setupLabelsCommands } from "../../../src/commands/labels.js";
import { outputResult } from "../../../src/common/output.js";
import { resolveIssueId } from "../../../src/resolvers/issue-resolver.js";
import { resolveLabelId } from "../../../src/resolvers/label-resolver.js";
import { resolveTeamId } from "../../../src/resolvers/team-resolver.js";
import {
  addLabelToIssues,
  createWorkspaceLabel,
  ensureWorkspaceLabel,
  getLabelsForIssue,
  listLabels,
  listProjectLabels,
  propagateLabelToChildren,
  removeLabelFromIssues,
  tallyLabelUsage,
} from "../../../src/services/label-service.js";

function createProgram(): Command {
  const program = new Command();
  program.option("--api-token <token>");
  setupLabelsCommands(program);
  return program;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
});

describe("labels list", () => {
  it("routes to issue labels by default", async () => {
    const program = createProgram();

    await program.parseAsync(["node", "test", "labels", "list"]);

    expect(listLabels).toHaveBeenCalledWith(expect.anything(), undefined, {
      limit: 50,
      after: undefined,
      scope: undefined,
    });
    expect(listProjectLabels).not.toHaveBeenCalled();
    expect(resolveTeamId).not.toHaveBeenCalled();
    expect(outputResult).toHaveBeenCalledWith(
      {
        nodes: [{ id: "lbl-1", name: "Bug", color: "#ff0000", type: "issue" }],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
      expect.any(Function),
      expect.any(Object),
    );
  });

  it("resolves team and lists issue labels", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "labels",
      "list",
      "--team",
      "ENG",
      "--limit",
      "10",
      "--after",
      "cur1",
    ]);

    expect(resolveTeamId).toHaveBeenCalledWith(expect.anything(), "ENG");
    expect(listLabels).toHaveBeenCalledWith(
      expect.anything(),
      "resolved-team-uuid",
      {
        limit: 10,
        after: "cur1",
        scope: undefined,
      },
    );
    expect(listProjectLabels).not.toHaveBeenCalled();
  });

  it("passes workspace scope without team resolution", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "labels",
      "list",
      "--scope",
      "workspace",
    ]);

    expect(listLabels).toHaveBeenCalledWith(expect.anything(), undefined, {
      limit: 50,
      after: undefined,
      scope: "workspace",
    });
    expect(resolveTeamId).not.toHaveBeenCalled();
    expect(listProjectLabels).not.toHaveBeenCalled();
  });

  it("resolves team for explicit team scope", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "labels",
      "list",
      "--scope",
      "team",
      "--team",
      "ENG",
    ]);

    expect(resolveTeamId).toHaveBeenCalledWith(expect.anything(), "ENG");
    expect(listLabels).toHaveBeenCalledWith(
      expect.anything(),
      "resolved-team-uuid",
      {
        limit: 50,
        after: undefined,
        scope: "team",
      },
    );
    expect(listProjectLabels).not.toHaveBeenCalled();
  });

  it("accepts an explicit issue type", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "labels",
      "list",
      "--type",
      "issue",
    ]);

    expect(listLabels).toHaveBeenCalledWith(expect.anything(), undefined, {
      limit: 50,
      after: undefined,
      scope: undefined,
    });
    expect(listProjectLabels).not.toHaveBeenCalled();
    expect(resolveTeamId).not.toHaveBeenCalled();
  });

  it("routes project label requests without team resolution", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "labels",
      "list",
      "--type",
      "project",
      "--limit",
      "25",
      "--after",
      "cur2",
    ]);

    expect(listProjectLabels).toHaveBeenCalledWith(expect.anything(), {
      limit: 25,
      after: "cur2",
    });
    expect(listLabels).not.toHaveBeenCalled();
    expect(resolveTeamId).not.toHaveBeenCalled();
    expect(outputResult).toHaveBeenCalledWith(
      {
        nodes: [
          {
            id: "plbl-1",
            name: "Customer",
            color: "#0000ff",
            type: "project",
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
      expect.any(Function),
      expect.any(Object),
    );
  });

  it("attaches per-label issue counts with --with-counts (lin-ov30.3)", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "labels",
      "list",
      "--with-counts",
    ]);

    expect(tallyLabelUsage).toHaveBeenCalledTimes(1);
    expect(outputResult).toHaveBeenCalledWith(
      {
        nodes: [
          {
            id: "lbl-1",
            name: "Bug",
            color: "#ff0000",
            type: "issue",
            count: 7,
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
      expect.any(Function),
      expect.any(Object),
    );
  });

  it("defaults a listed label with no usage to count 0", async () => {
    vi.mocked(tallyLabelUsage).mockResolvedValueOnce(new Map());
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "labels",
      "list",
      "--with-counts",
    ]);

    const call = vi.mocked(outputResult).mock.calls[0][0] as {
      nodes: Array<{ count?: number }>;
    };
    expect(call.nodes[0].count).toBe(0);
  });

  it("does not tally counts on a normal list (no --with-counts)", async () => {
    const program = createProgram();

    await program.parseAsync(["node", "test", "labels", "list"]);

    expect(tallyLabelUsage).not.toHaveBeenCalled();
  });

  it("rejects --with-counts with --type project", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "labels",
      "list",
      "--type",
      "project",
      "--with-counts",
    ]);

    expect(tallyLabelUsage).not.toHaveBeenCalled();
    expect(listProjectLabels).not.toHaveBeenCalled();
    const err = JSON.parse(
      vi.mocked(console.error).mock.calls[0][0] as string,
    ) as { error: string };
    expect(err.error).toContain("--with-counts");
  });
});

describe("labels list validation", () => {
  it("rejects unsupported label types", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "labels",
      "list",
      "--type",
      "initiative",
    ]);

    const errorOutput = JSON.parse(
      vi.mocked(console.error).mock.calls[0][0] as string,
    ) as { error: string };

    expect(errorOutput.error).toBe(
      'Invalid --type: must be one of "issue" or "project"',
    );
    expect(listLabels).not.toHaveBeenCalled();
    expect(listProjectLabels).not.toHaveBeenCalled();
    expect(resolveTeamId).not.toHaveBeenCalled();
  });

  it("rejects unsupported scope values", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "labels",
      "list",
      "--scope",
      "org",
    ]);

    const errorOutput = JSON.parse(
      vi.mocked(console.error).mock.calls[0][0] as string,
    ) as { error: string };

    expect(errorOutput.error).toBe(
      'Invalid --scope: must be one of "workspace" or "team"',
    );
    expect(listLabels).not.toHaveBeenCalled();
    expect(listProjectLabels).not.toHaveBeenCalled();
    expect(resolveTeamId).not.toHaveBeenCalled();
  });

  it("rejects team scope without a team filter", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "labels",
      "list",
      "--scope",
      "team",
    ]);

    const errorOutput = JSON.parse(
      vi.mocked(console.error).mock.calls[0][0] as string,
    ) as { error: string };

    expect(errorOutput.error).toBe(
      "Invalid --scope: team scope requires --team",
    );
    expect(listLabels).not.toHaveBeenCalled();
    expect(listProjectLabels).not.toHaveBeenCalled();
    expect(resolveTeamId).not.toHaveBeenCalled();
  });

  it("rejects team filters for workspace scope", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "labels",
      "list",
      "--scope",
      "workspace",
      "--team",
      "ENG",
    ]);

    const errorOutput = JSON.parse(
      vi.mocked(console.error).mock.calls[0][0] as string,
    ) as { error: string };

    expect(errorOutput.error).toBe(
      "Invalid --team: cannot be used with --scope workspace",
    );
    expect(listLabels).not.toHaveBeenCalled();
    expect(listProjectLabels).not.toHaveBeenCalled();
    expect(resolveTeamId).not.toHaveBeenCalled();
  });

  it("rejects team filters for project labels", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "labels",
      "list",
      "--type",
      "project",
      "--team",
      "ENG",
    ]);

    const errorOutput = JSON.parse(
      vi.mocked(console.error).mock.calls[0][0] as string,
    ) as { error: string };

    expect(errorOutput.error).toBe(
      "Invalid --team: cannot be used with --type project because project labels are workspace-scoped",
    );
    expect(listLabels).not.toHaveBeenCalled();
    expect(listProjectLabels).not.toHaveBeenCalled();
    expect(resolveTeamId).not.toHaveBeenCalled();
  });

  it("rejects scope filters for project labels", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "labels",
      "list",
      "--type",
      "project",
      "--scope",
      "workspace",
    ]);

    const errorOutput = JSON.parse(
      vi.mocked(console.error).mock.calls[0][0] as string,
    ) as { error: string };

    expect(errorOutput.error).toBe(
      "Invalid --scope: cannot be used with --type project because project labels are always workspace-scoped",
    );
    expect(listLabels).not.toHaveBeenCalled();
    expect(listProjectLabels).not.toHaveBeenCalled();
    expect(resolveTeamId).not.toHaveBeenCalled();
  });
});

// lin-s9hs: explicit `labels create` verb so first-run users don't have to
// guess whether the implicit auto-create-on-add is supported.
describe("labels create", () => {
  it("calls createWorkspaceLabel with default description", async () => {
    const program = createProgram();

    await program.parseAsync(["node", "test", "labels", "create", "frontend"]);

    expect(createWorkspaceLabel).toHaveBeenCalledWith(
      expect.anything(),
      "frontend",
      "Label 'frontend'.",
    );
    expect(outputResult).toHaveBeenCalled();
  });

  it("forwards --description verbatim", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "labels",
      "create",
      "frontend",
      "--description",
      "Web frontend area",
    ]);

    expect(createWorkspaceLabel).toHaveBeenCalledWith(
      expect.anything(),
      "frontend",
      "Web frontend area",
    );
  });

  it("rejects provides:* labels with a hint to use issues ship (exits 1)", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "labels",
      "create",
      "provides:auth",
    ]);

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(createWorkspaceLabel).not.toHaveBeenCalled();
  });

  it("rejects empty/whitespace label name (exits 1)", async () => {
    const program = createProgram();

    await program.parseAsync(["node", "test", "labels", "create", "   "]);

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(createWorkspaceLabel).not.toHaveBeenCalled();
  });
});

describe("labels add", () => {
  it("resolves issues, ensures workspace label, and calls addLabelToIssues", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "labels",
      "add",
      "ENG-1",
      "ENG-2",
      "bug",
    ]);

    expect(resolveIssueId).toHaveBeenCalledTimes(2);
    expect(ensureWorkspaceLabel).toHaveBeenCalledWith(
      expect.anything(),
      "bug",
      "Label 'bug'.",
    );
    expect(addLabelToIssues).toHaveBeenCalledWith(
      expect.anything(),
      ["uuid-ENG-1", "uuid-ENG-2"],
      "ensured-label-uuid",
      "bug",
    );
    expect(outputResult).toHaveBeenCalled();
  });

  it("rejects provides:* labels with a hint to use issues ship (exits 1)", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "labels",
      "add",
      "ENG-1",
      "provides:foo",
    ]);

    expect(process.exit).toHaveBeenCalledWith(1);
    const errorOutput = JSON.parse(
      vi.mocked(console.error).mock.calls[0][0] as string,
    ) as { error: string };
    expect(errorOutput.error).toMatch(/'provides:' labels are reserved/);
    expect(errorOutput.error).toMatch(/issues ship foo/);
    expect(addLabelToIssues).not.toHaveBeenCalled();
  });

  it("rejects when fewer than 2 args are provided (exits 1)", async () => {
    const program = createProgram();

    await program.parseAsync(["node", "test", "labels", "add", "bug"]);

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(addLabelToIssues).not.toHaveBeenCalled();
  });
});

describe("labels remove", () => {
  it("resolves the label via resolveLabelId (not ensure) and calls removeLabelFromIssues", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "labels",
      "remove",
      "ENG-1",
      "ENG-2",
      "bug",
    ]);

    expect(resolveLabelId).toHaveBeenCalledWith(expect.anything(), "bug");
    expect(ensureWorkspaceLabel).not.toHaveBeenCalled();
    expect(removeLabelFromIssues).toHaveBeenCalledWith(
      expect.anything(),
      ["uuid-ENG-1", "uuid-ENG-2"],
      "resolved-label-uuid",
      "bug",
    );
  });

  it("does NOT guard provides:* on remove (cleanup must be possible)", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "labels",
      "remove",
      "ENG-1",
      "provides:foo",
    ]);

    expect(removeLabelFromIssues).toHaveBeenCalled();
    expect(process.exit).not.toHaveBeenCalled();
  });
});

describe("labels show", () => {
  it("returns sorted label names for a single issue", async () => {
    const program = createProgram();

    await program.parseAsync(["node", "test", "labels", "show", "ENG-1"]);

    expect(resolveIssueId).toHaveBeenCalledWith(expect.anything(), "ENG-1");
    expect(getLabelsForIssue).toHaveBeenCalledWith(
      expect.anything(),
      "uuid-ENG-1",
    );
    expect(outputResult).toHaveBeenCalledWith(
      ["alpha", "zebra"],
      expect.any(Function),
      expect.anything(),
    );
  });
});

describe("labels propagate", () => {
  it("resolves parent, ensures label, and calls propagateLabelToChildren", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "labels",
      "propagate",
      "ENG-1",
      "bug",
    ]);

    expect(resolveIssueId).toHaveBeenCalledWith(expect.anything(), "ENG-1");
    expect(ensureWorkspaceLabel).toHaveBeenCalledWith(
      expect.anything(),
      "bug",
      "Label 'bug'.",
    );
    expect(propagateLabelToChildren).toHaveBeenCalledWith(
      expect.anything(),
      "uuid-ENG-1",
      "ensured-label-uuid",
      "bug",
    );
  });

  it("rejects provides:* labels (exits 1)", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "labels",
      "propagate",
      "ENG-1",
      "provides:foo",
    ]);

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(propagateLabelToChildren).not.toHaveBeenCalled();
  });
});
