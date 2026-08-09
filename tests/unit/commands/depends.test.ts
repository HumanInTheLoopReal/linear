import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
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

vi.mock("../../../src/services/issue-service.js", () => ({
  getIssue: vi.fn().mockResolvedValue({
    id: "uuid-A",
    identifier: "ENG-A",
    parent: null,
  }),
}));

vi.mock("../../../src/resolvers/issue-resolver.js", () => ({
  resolveIssueId: vi.fn(async (_sdk: unknown, id: string) => `uuid-${id}`),
}));

vi.mock("../../../src/resolvers/team-resolver.js", () => ({
  resolveTeamId: vi.fn().mockResolvedValue("resolved-team-uuid"),
}));

vi.mock("../../../src/common/config-store.js", () => ({
  getDefaultTeam: vi.fn(() => null),
}));

vi.mock("../../../src/services/dep-tree-service.js", () => ({
  loadDependencyTree: vi.fn().mockResolvedValue([]),
  renderMermaid: vi.fn(() => "flowchart TD"),
}));

vi.mock("../../../src/services/dependency-graph-service.js", () => ({
  loadGraphSubgraph: vi.fn().mockResolvedValue({
    root: { id: "uuid-A", identifier: "ENG-A" },
    issues: [{ id: "uuid-A", identifier: "ENG-A" }],
    dependencies: [],
  }),
  loadAllOpenSubgraphs: vi.fn().mockResolvedValue([]),
  computeLayout: vi.fn(() => ({
    nodes: {},
    layers: [],
    max_layer: 0,
    root_id: "ENG-A",
  })),
  detectCycles: vi.fn(() => []),
  detectCyclesWithIssues: vi.fn(() => []),
  renderDot: vi.fn(() => "digraph linear { }"),
  wouldCreateBlockingCycle: vi.fn().mockResolvedValue(false),
}));

vi.mock("../../../src/services/issue-relation-service.js", () => ({
  createIssueRelation: vi.fn().mockResolvedValue({
    id: "rel-id",
    type: "blocks",
    relatedIssue: { id: "uuid-target", identifier: "ENG-2" },
  }),
  bulkCreateIssueRelations: vi.fn(),
  deleteIssueRelation: vi.fn().mockResolvedValue({
    id: "rel-id",
    success: true,
  }),
  findIssueRelation: vi.fn().mockResolvedValue("rel-id"),
  ensureDependencyTypeLabels: vi.fn(
    async (_client: unknown, types: string[]) =>
      new Map(
        Array.from(new Set(types)).map((type) => [
          type,
          `label-uuid-dep-type:${type}`,
        ]),
      ),
  ),
  listIssueRelations: vi.fn().mockResolvedValue([
    {
      relation_id: "rel-id",
      type: "blocks",
      direction: "down",
      issue_id: "uuid-blocker",
      identifier: "ENG-5",
      title: "Blocker title",
      priority: 2,
      status: "started",
      state_name: "In Progress",
    },
  ]),
}));

vi.mock("../../../src/services/label-service.js", () => ({
  ensureWorkspaceLabel: vi.fn(
    async (_client: unknown, name: string) => `label-uuid-${name}`,
  ),
  addLabelToIssues: vi.fn().mockResolvedValue([]),
}));

import { setupDependsCommands } from "../../../src/commands/depends.js";
import { getRootOpts } from "../../../src/common/context.js";
import { outputResult, outputSuccess } from "../../../src/common/output.js";
import { resolveIssueId } from "../../../src/resolvers/issue-resolver.js";
import { resolveTeamId } from "../../../src/resolvers/team-resolver.js";
import {
  loadDependencyTree,
  renderMermaid,
} from "../../../src/services/dep-tree-service.js";
import {
  detectCycles,
  detectCyclesWithIssues,
  loadAllOpenSubgraphs,
  loadGraphSubgraph,
  renderDot,
  wouldCreateBlockingCycle,
} from "../../../src/services/dependency-graph-service.js";
import {
  bulkCreateIssueRelations,
  createIssueRelation,
  deleteIssueRelation,
  ensureDependencyTypeLabels,
  findIssueRelation,
  listIssueRelations,
} from "../../../src/services/issue-relation-service.js";
import { getIssue } from "../../../src/services/issue-service.js";
import {
  addLabelToIssues,
  ensureWorkspaceLabel,
} from "../../../src/services/label-service.js";

function createProgram(): Command {
  const program = new Command();
  setupDependsCommands(program);
  return program;
}

describe("linear depends", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("add", () => {
    it("creates a blocks relation where depends-on blocks the issue (default type)", async () => {
      const program = createProgram();
      await program.parseAsync(["node", "test", "depends", "add", "A", "B"]);

      expect(resolveIssueId).toHaveBeenCalledWith(expect.anything(), "A");
      expect(resolveIssueId).toHaveBeenCalledWith(expect.anything(), "B");
      expect(createIssueRelation).toHaveBeenCalledWith(expect.anything(), {
        issueId: "uuid-B",
        relatedIssueId: "uuid-A",
        type: "blocks",
      });
      expect(outputResult).toHaveBeenCalledWith(
        {
          status: "added",
          relation_id: "rel-id",
          issue_id: "uuid-A",
          depends_on_id: "uuid-B",
          type: "blocks",
        },
        expect.any(Function),
        expect.anything(),
      );
    });

    it("enriches the confirmation with each endpoint's identifier + title (lin-8yl1.5)", async () => {
      // The mutation now returns both endpoints with titles; the action maps
      // them by UUID so the echoed payload + text carry `id (title)` per side.
      vi.mocked(createIssueRelation).mockResolvedValueOnce({
        id: "rel-id",
        type: "blocks",
        issue: { id: "uuid-B", identifier: "ENG-2", title: "Blocker issue" },
        relatedIssue: {
          id: "uuid-A",
          identifier: "ENG-1",
          title: "Blocked issue",
        },
      } as unknown as Awaited<ReturnType<typeof createIssueRelation>>);

      const program = createProgram();
      await program.parseAsync(["node", "test", "depends", "add", "A", "B"]);

      const call = vi.mocked(outputResult).mock.calls.at(-1);
      expect(call?.[0]).toMatchObject({
        issue_id: "uuid-A",
        issue_identifier: "ENG-1",
        issue_title: "Blocked issue",
        depends_on_id: "uuid-B",
        depends_on_identifier: "ENG-2",
        depends_on_title: "Blocker issue",
      });
      // The text formatter renders `identifier (title)` for both sides.
      const formatter = call?.[1] as (d: unknown) => string;
      const text = formatter(call?.[0]);
      expect(text).toContain("ENG-2 (Blocker issue)");
      expect(text).toContain("ENG-1 (Blocked issue)");
    });

    it("creates a blocks relation where issue blocks depends-on under --type blocked-by", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "depends",
        "add",
        "A",
        "B",
        "--type",
        "blocked-by",
      ]);

      expect(createIssueRelation).toHaveBeenCalledWith(expect.anything(), {
        issueId: "uuid-A",
        relatedIssueId: "uuid-B",
        type: "blocks",
      });
    });

    it("creates a related relation under --type related", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "depends",
        "add",
        "A",
        "B",
        "--type",
        "related",
      ]);

      expect(createIssueRelation).toHaveBeenCalledWith(expect.anything(), {
        issueId: "uuid-A",
        relatedIssueId: "uuid-B",
        type: "related",
      });
    });

    it("refuses a blocks edge that would create a cycle (lin-gv9)", async () => {
      vi.mocked(wouldCreateBlockingCycle).mockResolvedValueOnce(true);
      const exitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation(() => undefined as never);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const program = createProgram();
      await program.parseAsync(["node", "test", "depends", "add", "A", "B"]);

      expect(createIssueRelation).not.toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);
      const serialized = errSpy.mock.calls
        .map((call) => String(call[0] ?? ""))
        .join("\n");
      expect(serialized).toMatch(/cycle/i);

      exitSpy.mockRestore();
      errSpy.mockRestore();
    });

    it("skips the cycle check for non-blocks types", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "depends",
        "add",
        "A",
        "B",
        "--type",
        "related",
      ]);

      expect(wouldCreateBlockingCycle).not.toHaveBeenCalled();
      expect(createIssueRelation).toHaveBeenCalled();
    });

    it("rejects parent-child (handled via `issues update --parent`)", async () => {
      const exitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation(() => undefined as never);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "depends",
        "add",
        "A",
        "B",
        "--type",
        "parent-child",
      ]);

      expect(createIssueRelation).not.toHaveBeenCalled();
      expect(errSpy).toHaveBeenCalled();
      exitSpy.mockRestore();
      errSpy.mockRestore();
    });

    it("for --type tracks (Linear-Hack): creates Related, ensures dep-type:tracks label, applies it to the source", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "depends",
        "add",
        "A",
        "B",
        "--type",
        "tracks",
      ]);

      expect(createIssueRelation).toHaveBeenCalledWith(expect.anything(), {
        issueId: "uuid-A",
        relatedIssueId: "uuid-B",
        type: "related",
      });
      expect(ensureWorkspaceLabel).toHaveBeenCalledWith(
        expect.anything(),
        "dep-type:tracks",
        expect.stringContaining("'tracks'"),
      );
      expect(addLabelToIssues).toHaveBeenCalledWith(
        expect.anything(),
        ["uuid-A"],
        "label-uuid-dep-type:tracks",
        "dep-type:tracks",
      );
      expect(outputResult).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "added",
          type: "tracks",
          dep_type_label: "dep-type:tracks",
        }),
        expect.any(Function),
        expect.anything(),
      );
    });

    it("accepts the other five hack types (validates, supersedes, …)", async () => {
      for (const hackType of [
        "validates",
        "supersedes",
        "discovered-from",
        "until",
        "caused-by",
      ]) {
        vi.clearAllMocks();
        const program = createProgram();
        await program.parseAsync([
          "node",
          "test",
          "depends",
          "add",
          "X",
          "Y",
          "--type",
          hackType,
        ]);
        expect(ensureWorkspaceLabel).toHaveBeenCalledWith(
          expect.anything(),
          `dep-type:${hackType}`,
          expect.any(String),
        );
        expect(addLabelToIssues).toHaveBeenCalledWith(
          expect.anything(),
          ["uuid-X"],
          `label-uuid-dep-type:${hackType}`,
          `dep-type:${hackType}`,
        );
      }
    });

    // lin-f5qx: --blocker / --blocked flag pair as an unambiguous
    // alternative to the positional form (round-1 UX: 4/4 agents had to
    // re-read --help to confirm direction of the positional args).
    it("--blocker/--blocked maps to the same edge as positional <issue> <depends-on>", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "depends",
        "add",
        "--blocker",
        "B",
        "--blocked",
        "A",
      ]);

      expect(createIssueRelation).toHaveBeenCalledWith(expect.anything(), {
        issueId: "uuid-B",
        relatedIssueId: "uuid-A",
        type: "blocks",
      });
    });

    it("errors when only --blocker is given (must be paired with --blocked)", async () => {
      const exitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation(() => undefined as never);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "depends",
        "add",
        "--blocker",
        "B",
      ]);

      expect(createIssueRelation).not.toHaveBeenCalled();
      const errStr = errSpy.mock.calls
        .map((c) => String(c[0] ?? ""))
        .join("\n");
      expect(errStr).toMatch(/must be used together/);
      exitSpy.mockRestore();
      errSpy.mockRestore();
    });

    it("errors when only --blocked is given (must be paired with --blocker)", async () => {
      const exitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation(() => undefined as never);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "depends",
        "add",
        "--blocked",
        "A",
      ]);

      expect(createIssueRelation).not.toHaveBeenCalled();
      const errStr = errSpy.mock.calls
        .map((c) => String(c[0] ?? ""))
        .join("\n");
      expect(errStr).toMatch(/must be used together/);
      exitSpy.mockRestore();
      errSpy.mockRestore();
    });

    it("errors when --blocker/--blocked is combined with positional args", async () => {
      const exitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation(() => undefined as never);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "depends",
        "add",
        "A",
        "B",
        "--blocker",
        "C",
        "--blocked",
        "D",
      ]);

      expect(createIssueRelation).not.toHaveBeenCalled();
      const errStr = errSpy.mock.calls
        .map((c) => String(c[0] ?? ""))
        .join("\n");
      expect(errStr).toMatch(/cannot be combined/);
      exitSpy.mockRestore();
      errSpy.mockRestore();
    });

    it("--blocker/--blocked respects --type (e.g. supersedes)", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "depends",
        "add",
        "--blocker",
        "B",
        "--blocked",
        "A",
        "--type",
        "supersedes",
      ]);

      // For non-blocks types, relationForType uses (from=A, to=B), so the
      // relation should be A → B with type=related plus the supersedes label.
      expect(createIssueRelation).toHaveBeenCalledWith(expect.anything(), {
        issueId: "uuid-A",
        relatedIssueId: "uuid-B",
        type: "related",
      });
      expect(ensureWorkspaceLabel).toHaveBeenCalledWith(
        expect.anything(),
        "dep-type:supersedes",
        expect.any(String),
      );
    });

    it("rejects truly unsupported types (parity error message lists native + hack)", async () => {
      const exitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation(() => undefined as never);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "depends",
        "add",
        "A",
        "B",
        "--type",
        "bogus",
      ]);

      expect(createIssueRelation).not.toHaveBeenCalled();
      expect(errSpy).toHaveBeenCalled();
      const errArg = vi.mocked(console.error).mock.calls[0]?.[0];
      const errStr =
        typeof errArg === "string" ? errArg : JSON.stringify(errArg);
      expect(errStr).toMatch(/tracks/);
      expect(errStr).toMatch(/Native/);
      exitSpy.mockRestore();
      errSpy.mockRestore();
    });
  });

  describe("add --file (bulk JSONL)", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), "linear-depends-bulk-")),
      );
    });

    function writeJsonl(lines: unknown[]): string {
      const file = path.join(tmpDir, "deps.jsonl");
      fs.writeFileSync(
        file,
        lines
          .map((l) => (typeof l === "string" ? l : JSON.stringify(l)))
          .join("\n"),
      );
      return file;
    }

    it("parses JSONL, resolves IDs, dispatches to bulkCreateIssueRelations", async () => {
      vi.mocked(bulkCreateIssueRelations).mockResolvedValueOnce({
        status: "added",
        count: 2,
        dependencies: [
          {
            line: 1,
            issue_id: "uuid-A",
            depends_on_id: "uuid-B",
            type: "blocks",
          },
          {
            line: 2,
            issue_id: "uuid-C",
            depends_on_id: "uuid-D",
            type: "related",
          },
        ],
        errors: [],
      });
      const file = writeJsonl([
        { from: "A", to: "B" },
        { from: "C", to: "D", type: "related" },
      ]);

      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "depends",
        "add",
        "--file",
        file,
      ]);

      expect(resolveIssueId).toHaveBeenCalledWith(expect.anything(), "A");
      expect(resolveIssueId).toHaveBeenCalledWith(expect.anything(), "D");
      expect(bulkCreateIssueRelations).toHaveBeenCalledOnce();
      const [, edges, carried] = vi.mocked(bulkCreateIssueRelations).mock
        .calls[0];
      expect(edges).toEqual([
        {
          line: 1,
          issueId: "uuid-B",
          relatedIssueId: "uuid-A",
          type: "blocks",
          rawType: "blocks",
          issueLabel: "A",
          relatedLabel: "B",
        },
        {
          line: 2,
          issueId: "uuid-C",
          relatedIssueId: "uuid-D",
          type: "related",
          rawType: "related",
          issueLabel: "C",
          relatedLabel: "D",
        },
      ]);
      expect(carried).toEqual([]);
      expect(outputResult).toHaveBeenCalledWith(
        expect.objectContaining({ count: 2, status: "added" }),
        expect.any(Function),
        expect.anything(),
      );
    });

    it("accepts issue_id/depends_on_id aliases and the 'blocked-by' type", async () => {
      vi.mocked(bulkCreateIssueRelations).mockResolvedValueOnce({
        status: "added",
        count: 1,
        dependencies: [],
        errors: [],
      });
      const file = writeJsonl([
        { issue_id: "X", depends_on_id: "Y", type: "blocked-by" },
      ]);

      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "depends",
        "add",
        "--file",
        file,
      ]);

      const [, edges] = vi.mocked(bulkCreateIssueRelations).mock.calls[0];
      expect(edges[0]).toMatchObject({
        issueId: "uuid-X",
        relatedIssueId: "uuid-Y",
        type: "blocks",
        rawType: "blocked-by",
      });
    });

    it("carries parse errors (invalid JSON, missing fields, bad type) without aborting", async () => {
      vi.mocked(bulkCreateIssueRelations).mockResolvedValueOnce({
        status: "added",
        count: 1,
        dependencies: [
          {
            line: 4,
            issue_id: "uuid-A",
            depends_on_id: "uuid-B",
            type: "blocks",
          },
        ],
        errors: [
          { line: 1, error: "invalid JSON: ..." },
          { line: 2, error: "missing 'to' (or 'depends_on_id')" },
          {
            line: 3,
            error:
              'unsupported type "weird". Linear supports: blocks, blocked-by, related, relates-to. Use `linear issues update --parent` for parent-child relationships.',
          },
        ],
      });
      const file = writeJsonl([
        "not json",
        { from: "X" },
        { from: "X", to: "Y", type: "weird" },
        { from: "A", to: "B" },
      ]);

      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "depends",
        "add",
        "--file",
        file,
      ]);

      const [, edges, carried] = vi.mocked(bulkCreateIssueRelations).mock
        .calls[0];
      expect(edges.map((e) => e.line)).toEqual([4]);
      expect(carried.map((e) => e.line)).toEqual([1, 2, 3]);
    });

    it("rejects when --file is combined with positional args", async () => {
      const exitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation((() => undefined) as never);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const file = writeJsonl([{ from: "A", to: "B" }]);

      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "depends",
        "add",
        "A",
        "B",
        "--file",
        file,
      ]);

      expect(bulkCreateIssueRelations).not.toHaveBeenCalled();
      expect(errSpy).toHaveBeenCalled();
      exitSpy.mockRestore();
      errSpy.mockRestore();
    });

    it("threads pre-ensured hack-type label IDs through bulk edges by type", async () => {
      vi.mocked(bulkCreateIssueRelations).mockResolvedValueOnce({
        status: "added",
        count: 3,
        dependencies: [],
        errors: [],
      });
      const file = writeJsonl([
        { from: "A", to: "B", type: "tracks" },
        { from: "C", to: "D", type: "blocks" },
        { from: "E", to: "F", type: "validates" },
      ]);

      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "depends",
        "add",
        "--file",
        file,
      ]);

      expect(ensureDependencyTypeLabels).toHaveBeenCalledWith(
        expect.anything(),
        ["tracks", "validates"],
      );

      const [, edges] = vi.mocked(bulkCreateIssueRelations).mock.calls[0];
      const byType = Object.fromEntries(
        edges.map((e) => [e.rawType, e.hackLabelId]),
      );
      expect(byType).toEqual({
        tracks: "label-uuid-dep-type:tracks",
        blocks: undefined,
        validates: "label-uuid-dep-type:validates",
      });
    });
  });

  describe("remove", () => {
    it("finds the relation and deletes it", async () => {
      const program = createProgram();
      await program.parseAsync(["node", "test", "depends", "remove", "A", "B"]);

      expect(findIssueRelation).toHaveBeenCalledWith(
        expect.anything(),
        "uuid-A",
        "uuid-B",
      );
      expect(deleteIssueRelation).toHaveBeenCalledWith(
        expect.anything(),
        "rel-id",
      );
      expect(outputResult).toHaveBeenCalledWith(
        {
          status: "removed",
          issue_id: "uuid-A",
          depends_on_id: "uuid-B",
        },
        expect.any(Function),
        expect.anything(),
      );
    });
  });

  describe("list", () => {
    it("lists outbound relations by default and dispatches via outputResult in text mode", async () => {
      const program = createProgram();
      await program.parseAsync(["node", "test", "depends", "list", "A"]);

      expect(listIssueRelations).toHaveBeenCalledWith(
        expect.anything(),
        "uuid-A",
        { direction: "down", type: undefined },
      );
      // Text mode goes through outputResult — outputSuccess is only invoked
      // when --json is set.
      expect(outputResult).toHaveBeenCalled();
      expect(outputSuccess).not.toHaveBeenCalled();
    });

    it("--json path emits the raw service entries via outputSuccess (legacy JSON contract)", async () => {
      vi.mocked(getRootOpts).mockReturnValueOnce({
        apiToken: "test-token",
        json: true,
      });
      const program = createProgram();
      await program.parseAsync(["node", "test", "depends", "list", "A"]);

      expect(outputSuccess).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            direction: "down",
            identifier: "ENG-5",
            status: "started",
          }),
        ],
        "pretty",
        // No --fields on this invocation; the projection arg rides along undefined.
        undefined,
      );
      // JSON path skips the synthetic parent-child fetch entirely.
      expect(getIssue).not.toHaveBeenCalled();
    });

    it("passes through --direction up and --type filter", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "depends",
        "list",
        "A",
        "--direction",
        "up",
        "--type",
        "blocks",
      ]);

      expect(listIssueRelations).toHaveBeenCalledWith(
        expect.anything(),
        "uuid-A",
        { direction: "up", type: "blocks" },
      );
    });

    it("rejects unknown --direction values", async () => {
      const exitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation(() => undefined as never);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "depends",
        "list",
        "A",
        "--direction",
        "sideways",
      ]);

      expect(listIssueRelations).not.toHaveBeenCalled();
      expect(errSpy).toHaveBeenCalled();
      exitSpy.mockRestore();
      errSpy.mockRestore();
    });

    // lin-zoqs: `depends list` now accepts multiple issue ids.
    it("surveys multiple issues and flattens edges into one array under --json", async () => {
      vi.mocked(getRootOpts).mockReturnValueOnce({
        apiToken: "test-token",
        json: true,
      });
      const program = createProgram();
      await program.parseAsync(["node", "test", "depends", "list", "A", "B"]);

      expect(resolveIssueId).toHaveBeenCalledWith(expect.anything(), "A");
      expect(resolveIssueId).toHaveBeenCalledWith(expect.anything(), "B");
      expect(listIssueRelations).toHaveBeenCalledTimes(2);
      // Flat concat preserves the stable single-issue array shape: one edge
      // per surveyed issue (the mock returns one each).
      const [arr] = vi.mocked(outputSuccess).mock.calls[0];
      expect(arr).toHaveLength(2);
      // JSON path skips the synthetic parent fetch for every issue.
      expect(getIssue).not.toHaveBeenCalled();
    });

    it("groups multiple issues under per-issue headers in text mode (lin-zoqs)", async () => {
      const program = createProgram();
      await program.parseAsync(["node", "test", "depends", "list", "A", "B"]);

      expect(outputSuccess).not.toHaveBeenCalled();
      const call = vi.mocked(outputResult).mock.calls.at(-1);
      const formatter = call?.[1] as (d: unknown) => string;
      const text = formatter(call?.[0]);
      expect(text).toContain("📋 A depends on:");
      expect(text).toContain("📋 B depends on:");
    });

    it("skips an unresolvable id in batch mode with a stderr warning (lin-zoqs)", async () => {
      vi.mocked(resolveIssueId)
        .mockImplementationOnce(
          async (_sdk: unknown, id: string) => `uuid-${id}`,
        )
        .mockImplementationOnce(async () => {
          throw new Error("issue not found: BAD");
        });
      const errSpy = vi
        .spyOn(process.stderr, "write")
        .mockImplementation(() => true);

      const program = createProgram();
      await program.parseAsync(["node", "test", "depends", "list", "A", "BAD"]);

      // The good id is still surveyed; the bad one is skipped, not fatal.
      expect(listIssueRelations).toHaveBeenCalledTimes(1);
      expect(listIssueRelations).toHaveBeenCalledWith(
        expect.anything(),
        "uuid-A",
        expect.anything(),
      );
      const warned = errSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(warned).toContain("BAD");
      expect(warned).toContain("skipped");
      errSpy.mockRestore();
    });

    it("keeps a single unresolvable id fatal — no batch skip (lin-zoqs)", async () => {
      vi.mocked(resolveIssueId).mockImplementationOnce(async () => {
        throw new Error("issue not found: NOPE");
      });
      const exitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation(() => undefined as never);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const program = createProgram();
      await program.parseAsync(["node", "test", "depends", "list", "NOPE"]);

      // Single-arg keeps the fatal path (handled by handleCommand → exit 1).
      expect(listIssueRelations).not.toHaveBeenCalled();
      exitSpy.mockRestore();
      errSpy.mockRestore();
    });
  });

  describe("relate / unrelate", () => {
    it("relate creates a related-type relation", async () => {
      const program = createProgram();
      await program.parseAsync(["node", "test", "depends", "relate", "A", "B"]);

      expect(createIssueRelation).toHaveBeenCalledWith(expect.anything(), {
        issueId: "uuid-A",
        relatedIssueId: "uuid-B",
        type: "related",
      });
      expect(outputResult).toHaveBeenCalledWith(
        {
          status: "related",
          relation_id: "rel-id",
          issue_a_id: "uuid-A",
          issue_b_id: "uuid-B",
        },
        expect.any(Function),
        expect.anything(),
      );
    });

    it("unrelate finds and deletes the related-type relation", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "depends",
        "unrelate",
        "A",
        "B",
      ]);

      expect(findIssueRelation).toHaveBeenCalledWith(
        expect.anything(),
        "uuid-A",
        "uuid-B",
      );
      expect(deleteIssueRelation).toHaveBeenCalledWith(
        expect.anything(),
        "rel-id",
      );
    });
  });

  describe("cycles", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("loads all open subgraphs and dispatches cycles via outputResult (text path)", async () => {
      vi.mocked(loadAllOpenSubgraphs).mockResolvedValueOnce([] as never);
      vi.mocked(detectCyclesWithIssues).mockReturnValueOnce([
        [
          {
            id: "uuid-A",
            identifier: "ENG-A",
            title: "A",
            priority: 2,
            status: "started",
            state_name: "In Progress",
            team: { id: "t", key: "ENG", name: "Eng" },
          },
          {
            id: "uuid-B",
            identifier: "ENG-B",
            title: "B",
            priority: 2,
            status: "started",
            state_name: "In Progress",
            team: { id: "t", key: "ENG", name: "Eng" },
          },
        ],
      ]);

      const program = createProgram();
      await program.parseAsync(["node", "test", "depends", "cycles"]);

      expect(loadAllOpenSubgraphs).toHaveBeenCalledWith(expect.anything(), {
        teamId: undefined,
      });
      expect(detectCyclesWithIssues).toHaveBeenCalledOnce();
      // Text mode goes through outputResult; outputSuccess only fires when
      // --json is set.
      expect(outputResult).toHaveBeenCalled();
      const arg = vi.mocked(outputResult).mock.calls[0][0];
      expect(Array.isArray(arg)).toBe(true);
      expect((arg as unknown[][])[0]).toHaveLength(2);
    });

    it("forwards --team to loadAllOpenSubgraphs after resolving the team", async () => {
      vi.mocked(loadAllOpenSubgraphs).mockResolvedValueOnce([] as never);
      vi.mocked(detectCyclesWithIssues).mockReturnValueOnce([]);

      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "depends",
        "cycles",
        "--team",
        "ENG",
      ]);

      expect(resolveTeamId).toHaveBeenCalledWith(expect.anything(), "ENG");
      expect(loadAllOpenSubgraphs).toHaveBeenCalledWith(expect.anything(), {
        teamId: "resolved-team-uuid",
      });
    });

    it("dispatches an empty array to outputResult (no exit-1, no JSON outputSuccess)", async () => {
      vi.mocked(loadAllOpenSubgraphs).mockResolvedValueOnce([] as never);
      vi.mocked(detectCyclesWithIssues).mockReturnValueOnce([]);
      const exitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation(() => undefined as never);

      const program = createProgram();
      await program.parseAsync(["node", "test", "depends", "cycles"]);

      expect(outputResult).toHaveBeenCalled();
      const arg = vi.mocked(outputResult).mock.calls[0][0];
      expect(arg).toEqual([]);
      expect(exitSpy).not.toHaveBeenCalled();
      exitSpy.mockRestore();
    });
  });

  describe("graph", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
      vi.spyOn(process.stdout, "write").mockImplementation(() => true as never);
    });

    it("single-issue mode resolves the issue and emits {root, issues, dependencies, layout}", async () => {
      const program = createProgram();
      await program.parseAsync(["node", "test", "depends", "graph", "ENG-A"]);

      expect(resolveIssueId).toHaveBeenCalledWith(expect.anything(), "ENG-A");
      expect(loadGraphSubgraph).toHaveBeenCalledWith(
        expect.anything(),
        "uuid-ENG-A",
        { maxDepth: 5 },
      );
      expect(outputResult).toHaveBeenCalledWith(
        expect.objectContaining({
          root: expect.anything(),
          issues: expect.any(Array),
          dependencies: expect.any(Array),
          layout: expect.anything(),
        }),
        expect.any(Function),
        expect.anything(),
      );
    });

    it("--max-depth is forwarded to the service", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "depends",
        "graph",
        "ENG-A",
        "--max-depth",
        "2",
      ]);

      expect(loadGraphSubgraph).toHaveBeenCalledWith(
        expect.anything(),
        "uuid-ENG-A",
        { maxDepth: 2 },
      );
    });

    it("--all calls loadAllOpenSubgraphs and skips the single-issue path", async () => {
      vi.mocked(loadAllOpenSubgraphs).mockResolvedValueOnce([
        {
          root: {
            id: "uuid-A",
            identifier: "ENG-A",
            title: "A",
            priority: 0,
            status: "backlog",
            state_name: "Backlog",
            team: { id: "team-a", key: "ENG", name: "Eng" },
          },
          issues: [],
          dependencies: [],
        },
      ]);
      const program = createProgram();
      await program.parseAsync(["node", "test", "depends", "graph", "--all"]);

      expect(loadAllOpenSubgraphs).toHaveBeenCalledWith(expect.anything(), {
        teamId: undefined,
      });
      expect(loadGraphSubgraph).not.toHaveBeenCalled();
      expect(outputResult).toHaveBeenCalledWith(
        expect.objectContaining({
          subgraphs: expect.any(Array),
          count: 1,
        }),
        expect.any(Function),
        expect.anything(),
      );
    });

    it("--all --team resolves the team UUID and forwards it", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "depends",
        "graph",
        "--all",
        "--team",
        "ENG",
      ]);

      expect(resolveTeamId).toHaveBeenCalledWith(expect.anything(), "ENG");
      expect(loadAllOpenSubgraphs).toHaveBeenCalledWith(expect.anything(), {
        teamId: "resolved-team-uuid",
      });
    });

    it("--dot writes raw DOT to stdout and does not call outputSuccess", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "depends",
        "graph",
        "ENG-A",
        "--dot",
      ]);

      expect(renderDot).toHaveBeenCalled();
      expect(process.stdout.write).toHaveBeenCalledWith(
        expect.stringContaining("digraph linear"),
      );
      expect(outputSuccess).not.toHaveBeenCalled();
    });

    it("rejects [issue] together with --all", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "depends",
        "graph",
        "ENG-A",
        "--all",
      ]);

      expect(loadGraphSubgraph).not.toHaveBeenCalled();
      expect(loadAllOpenSubgraphs).not.toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalled();
    });

    it("rejects missing [issue] without --all", async () => {
      const program = createProgram();
      await program.parseAsync(["node", "test", "depends", "graph"]);

      expect(loadGraphSubgraph).not.toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalled();
    });

    it("check returns {clean, cycles, summary} and exits 0 when clean", async () => {
      vi.mocked(detectCycles).mockReturnValueOnce([]);
      const program = createProgram();
      await program.parseAsync(["node", "test", "depends", "graph", "check"]);

      expect(loadAllOpenSubgraphs).toHaveBeenCalled();
      expect(outputResult).toHaveBeenCalledWith(
        {
          clean: true,
          cycles: [],
          summary: { cycle_count: 0 },
        },
        expect.any(Function),
        expect.anything(),
      );
      expect(process.exit).not.toHaveBeenCalled();
    });

    it("check exits 1 when cycles are found", async () => {
      vi.mocked(detectCycles).mockReturnValueOnce([["ENG-A", "ENG-B"]]);
      const program = createProgram();
      await program.parseAsync(["node", "test", "depends", "graph", "check"]);

      expect(outputResult).toHaveBeenCalledWith(
        {
          clean: false,
          cycles: [["ENG-A", "ENG-B"]],
          summary: { cycle_count: 1 },
        },
        expect.any(Function),
        expect.anything(),
      );
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe("tree", () => {
    beforeEach(() => {
      vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(process.stdout, "write").mockImplementation(() => true as never);
    });

    it("resolves the issue id and delegates to loadDependencyTree with defaults", async () => {
      vi.mocked(loadDependencyTree).mockResolvedValueOnce([]);
      const program = createProgram();
      await program.parseAsync(["node", "test", "depends", "tree", "ENG-1"]);

      expect(resolveIssueId).toHaveBeenCalledWith(expect.anything(), "ENG-1");
      expect(loadDependencyTree).toHaveBeenCalledWith(
        expect.anything(),
        "uuid-ENG-1",
        expect.objectContaining({
          direction: "down",
          maxDepth: 50,
          status: undefined,
          showAllPaths: false,
        }),
      );
    });

    it("--direction up / --max-depth / --status / --show-all-paths all flow through", async () => {
      vi.mocked(loadDependencyTree).mockResolvedValueOnce([]);
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "depends",
        "tree",
        "ENG-1",
        "--direction",
        "up",
        "--max-depth",
        "3",
        "--status",
        "open",
        "--show-all-paths",
      ]);

      expect(loadDependencyTree).toHaveBeenCalledWith(
        expect.anything(),
        "uuid-ENG-1",
        expect.objectContaining({
          direction: "up",
          maxDepth: 3,
          status: "open",
          showAllPaths: true,
        }),
      );
    });

    it("--reverse is treated as --direction up", async () => {
      vi.mocked(loadDependencyTree).mockResolvedValueOnce([]);
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "depends",
        "tree",
        "ENG-1",
        "--reverse",
      ]);

      const call = vi.mocked(loadDependencyTree).mock.calls[0][2];
      expect(call.direction).toBe("up");
    });

    it("rejects an unknown --direction value", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "depends",
        "tree",
        "ENG-1",
        "--direction",
        "sideways",
      ]);

      expect(process.exit).toHaveBeenCalledWith(1);
      expect(loadDependencyTree).not.toHaveBeenCalled();
    });

    it("--format mermaid writes raw text via renderMermaid (no outputSuccess)", async () => {
      vi.mocked(loadDependencyTree).mockResolvedValueOnce([]);
      vi.mocked(renderMermaid).mockReturnValueOnce("flowchart TD\nA --> B");
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "depends",
        "tree",
        "ENG-1",
        "--format",
        "mermaid",
      ]);

      expect(renderMermaid).toHaveBeenCalled();
      expect(outputSuccess).not.toHaveBeenCalled();
      expect(process.stdout.write).toHaveBeenCalledWith(
        "flowchart TD\nA --> B\n",
      );
    });

    it("rejects an unknown --format value", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "depends",
        "tree",
        "ENG-1",
        "--format",
        "yaml",
      ]);

      expect(process.exit).toHaveBeenCalledWith(1);
      expect(loadDependencyTree).not.toHaveBeenCalled();
    });
  });
});
