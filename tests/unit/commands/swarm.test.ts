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

vi.mock("../../../src/resolvers/issue-resolver.js", () => ({
  resolveIssueId: vi.fn(async (_sdk: unknown, id: string) => `uuid-${id}`),
}));

vi.mock("../../../src/services/swarm-service.js", () => ({
  analyzeEpicForSwarm: vi.fn(),
  createSwarmMolecule: vi.fn(),
  findExistingSwarm: vi.fn(),
  getSwarmStatus: vi.fn(),
  listSwarmMolecules: vi.fn(),
  prepareSwarmEpic: vi.fn(),
}));

import { setupSwarmCommands } from "../../../src/commands/swarm.js";
import { outputResult } from "../../../src/common/output.js";
import { resolveIssueId } from "../../../src/resolvers/issue-resolver.js";
import {
  analyzeEpicForSwarm,
  createSwarmMolecule,
  findExistingSwarm,
  getSwarmStatus,
  listSwarmMolecules,
  prepareSwarmEpic,
} from "../../../src/services/swarm-service.js";

function createProgram(): Command {
  const program = new Command();
  setupSwarmCommands(program);
  return program;
}

function epicIssue(
  opts: { id?: string; identifier?: string; childCount?: number } = {},
) {
  const children: { id: string; identifier: string }[] = [];
  for (let i = 0; i < (opts.childCount ?? 1); i++) {
    children.push({ id: `child-${i}`, identifier: `ENG-${10 + i}` });
  }
  return {
    id: opts.id ?? "epic-1",
    identifier: opts.identifier ?? "ENG-1",
    title: "Epic foo",
    description: "",
    priority: 2,
    state: { id: "s", name: "Backlog", type: "backlog" },
    team: { id: "team-a", key: "ENG", name: "Eng" },
    parent: null,
    children: { nodes: children },
    labels: { nodes: [] },
    relations: { nodes: [] },
    inverseRelations: { nodes: [] },
  };
}

function swarmableAnalysis() {
  return {
    epic_id: "epic-1",
    epic_identifier: "ENG-1",
    epic_title: "Epic foo",
    total_issues: 2,
    closed_issues: 0,
    ready_fronts: [
      { wave: 0, issues: ["ENG-10"], titles: ["A"] },
      { wave: 1, issues: ["ENG-11"], titles: ["B"] },
    ],
    max_parallelism: 1,
    estimated_sessions: 2,
    warnings: [],
    errors: [],
    swarmable: true,
    issues: {},
  };
}

describe("linear swarm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    // Re-prime the createContext mock per test so its gql.request stub is fresh.
  });

  describe("create", () => {
    it("creates a molecule when no existing swarm and analysis is swarmable", async () => {
      vi.mocked(prepareSwarmEpic).mockResolvedValueOnce(
        epicIssue({ childCount: 2 }) as never,
      );
      vi.mocked(findExistingSwarm).mockResolvedValueOnce(null);
      vi.mocked(analyzeEpicForSwarm).mockResolvedValueOnce(
        swarmableAnalysis() as never,
      );
      vi.mocked(createSwarmMolecule).mockResolvedValueOnce({
        id: "swarm-1",
        identifier: "ENG-50",
        title: "Swarm: Epic foo",
        description: "...",
        epic_id: "epic-1",
        epic_identifier: "ENG-1",
        coordinator: "agent://x",
      } as never);

      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "swarm",
        "create",
        "ENG-1",
        "--coordinator",
        "agent://x",
      ]);

      expect(resolveIssueId).toHaveBeenCalledWith(expect.anything(), "ENG-1");
      expect(findExistingSwarm).toHaveBeenCalledWith(
        expect.anything(),
        "epic-1",
      );
      expect(analyzeEpicForSwarm).toHaveBeenCalledWith(
        expect.anything(),
        "epic-1",
      );
      expect(createSwarmMolecule).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ coordinator: "agent://x" }),
      );
      expect(outputResult).toHaveBeenCalledWith(
        expect.objectContaining({
          swarm_id: "swarm-1",
          swarm_identifier: "ENG-50",
          epic_id: "epic-1",
          epic_identifier: "ENG-1",
        }),
        expect.any(Function),
        expect.anything(),
      );
      expect(process.exit).not.toHaveBeenCalled();
    });

    it("auto-wraps a non-epic (no children) before creating a molecule", async () => {
      vi.mocked(prepareSwarmEpic).mockResolvedValueOnce(
        epicIssue({
          id: "wrapper-1",
          identifier: "ENG-99",
          childCount: 1,
        }) as never,
      );
      vi.mocked(findExistingSwarm).mockResolvedValueOnce(null);
      vi.mocked(analyzeEpicForSwarm).mockResolvedValueOnce(
        swarmableAnalysis() as never,
      );
      vi.mocked(createSwarmMolecule).mockResolvedValueOnce({
        id: "swarm-2",
        identifier: "ENG-51",
        title: "Swarm: ...",
        description: "...",
        epic_id: "wrapper-1",
        epic_identifier: "ENG-99",
        coordinator: "",
      } as never);

      const program = createProgram();
      await program.parseAsync(["node", "test", "swarm", "create", "ENG-7"]);

      expect(prepareSwarmEpic).toHaveBeenCalledWith(
        expect.anything(),
        "uuid-ENG-7",
        "ENG-7",
      );
      expect(findExistingSwarm).toHaveBeenCalledWith(
        expect.anything(),
        "wrapper-1",
      );
      expect(createSwarmMolecule).toHaveBeenCalled();
    });

    it("exits 1 when a swarm already exists and --force is absent", async () => {
      vi.mocked(prepareSwarmEpic).mockResolvedValueOnce(
        epicIssue({ childCount: 2 }) as never,
      );

      vi.mocked(findExistingSwarm).mockResolvedValueOnce({
        id: "existing-swarm",
        identifier: "ENG-40",
        title: "Swarm: existing",
      } as never);

      const program = createProgram();
      await program.parseAsync(["node", "test", "swarm", "create", "ENG-1"]);

      expect(outputResult).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "swarm already exists",
          existing_id: "existing-swarm",
        }),
        expect.any(Function),
        expect.anything(),
      );
      expect(process.exit).toHaveBeenCalledWith(1);
      expect(createSwarmMolecule).not.toHaveBeenCalled();
    });

    it("--force bypasses the existing-swarm guard", async () => {
      vi.mocked(prepareSwarmEpic).mockResolvedValueOnce(
        epicIssue({ childCount: 2 }) as never,
      );

      vi.mocked(findExistingSwarm).mockResolvedValueOnce({
        id: "existing-swarm",
        identifier: "ENG-40",
        title: "Swarm: existing",
      } as never);
      vi.mocked(analyzeEpicForSwarm).mockResolvedValueOnce(
        swarmableAnalysis() as never,
      );
      vi.mocked(createSwarmMolecule).mockResolvedValueOnce({
        id: "swarm-new",
        identifier: "ENG-60",
        title: "Swarm: x",
        description: "",
        epic_id: "epic-1",
        epic_identifier: "ENG-1",
        coordinator: "",
      } as never);

      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "swarm",
        "create",
        "ENG-1",
        "--force",
      ]);

      expect(createSwarmMolecule).toHaveBeenCalled();
      expect(process.exit).not.toHaveBeenCalled();
    });

    it("exits 1 when analysis reports the epic is not swarmable", async () => {
      vi.mocked(prepareSwarmEpic).mockResolvedValueOnce(
        epicIssue({ childCount: 2 }) as never,
      );

      vi.mocked(findExistingSwarm).mockResolvedValueOnce(null);
      vi.mocked(analyzeEpicForSwarm).mockResolvedValueOnce({
        ...swarmableAnalysis(),
        swarmable: false,
        errors: ["Dependency cycle detected"],
      } as never);

      const program = createProgram();
      await program.parseAsync(["node", "test", "swarm", "create", "ENG-1"]);

      expect(outputResult).toHaveBeenCalledWith(
        expect.objectContaining({ error: "epic is not swarmable" }),
        expect.any(Function),
        expect.anything(),
      );
      expect(process.exit).toHaveBeenCalledWith(1);
      expect(createSwarmMolecule).not.toHaveBeenCalled();
    });
  });

  describe("validate", () => {
    it("emits the analysis and strips issues by default", async () => {
      const analysis = {
        ...swarmableAnalysis(),
        issues: { foo: { id: "foo", identifier: "ENG-2" } },
      };
      vi.mocked(analyzeEpicForSwarm).mockResolvedValueOnce(analysis as never);

      const program = createProgram();
      await program.parseAsync(["node", "test", "swarm", "validate", "ENG-1"]);

      expect(resolveIssueId).toHaveBeenCalledWith(expect.anything(), "ENG-1");
      expect(analyzeEpicForSwarm).toHaveBeenCalledWith(
        expect.anything(),
        "uuid-ENG-1",
      );
      expect(outputResult).toHaveBeenCalledWith(
        expect.objectContaining({ swarmable: true, issues: undefined }),
        expect.any(Function),
        expect.anything(),
      );
      expect(process.exit).not.toHaveBeenCalled();
    });

    it("--verbose preserves the issues map", async () => {
      const analysis = {
        ...swarmableAnalysis(),
        issues: { foo: { id: "foo", identifier: "ENG-2" } },
      };
      vi.mocked(analyzeEpicForSwarm).mockResolvedValueOnce(analysis as never);

      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "swarm",
        "validate",
        "ENG-1",
        "--verbose",
      ]);

      expect(outputResult).toHaveBeenCalledWith(
        expect.objectContaining({
          issues: { foo: { id: "foo", identifier: "ENG-2" } },
        }),
        expect.any(Function),
        expect.anything(),
      );
    });

    it("exits 1 when analysis is not swarmable", async () => {
      vi.mocked(analyzeEpicForSwarm).mockResolvedValueOnce({
        ...swarmableAnalysis(),
        swarmable: false,
        errors: ["cycle"],
      } as never);

      const program = createProgram();
      await program.parseAsync(["node", "test", "swarm", "validate", "ENG-1"]);

      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe("list", () => {
    it("calls listSwarmMolecules and emits the result via outputSuccess", async () => {
      vi.mocked(listSwarmMolecules).mockResolvedValueOnce({
        swarms: [
          {
            swarm_id: "swarm-1",
            swarm_identifier: "ENG-100",
            swarm_title: "Swarm: foo",
            epic_id: "epic-1",
            epic_identifier: "ENG-1",
            epic_title: "Foo",
            coordinator: "alice",
            total_issues: 3,
            closed_issues: 1,
            wave_depth: 2,
            max_parallelism: 2,
            swarmable: true,
          },
        ],
        count: 1,
      });

      const program = createProgram();
      await program.parseAsync(["node", "test", "swarm", "list"]);

      expect(listSwarmMolecules).toHaveBeenCalled();
      const payload = vi.mocked(outputResult).mock.calls[0]?.[0] as {
        swarms: Array<{ swarm_id: string; coordinator: string }>;
        count: number;
      };
      expect(payload.count).toBe(1);
      expect(payload.swarms[0].coordinator).toBe("alice");
    });

    it("emits an empty list when no swarms exist", async () => {
      vi.mocked(listSwarmMolecules).mockResolvedValueOnce({
        swarms: [],
        count: 0,
      });
      const program = createProgram();
      await program.parseAsync(["node", "test", "swarm", "list"]);
      const payload = vi.mocked(outputResult).mock.calls[0]?.[0] as {
        count: number;
      };
      expect(payload.count).toBe(0);
    });
  });

  describe("status", () => {
    it("resolves identifier and calls getSwarmStatus with the resolved UUID", async () => {
      vi.mocked(getSwarmStatus).mockResolvedValueOnce({
        epic_id: "uuid-ENG-1",
        epic_identifier: "ENG-1",
        epic_title: "Foo",
        total_issues: 2,
        completed: [],
        active: [],
        ready: [],
        blocked: [],
        active_count: 0,
        ready_count: 0,
        blocked_count: 0,
        progress_percent: 0,
      });
      const program = createProgram();
      await program.parseAsync(["node", "test", "swarm", "status", "ENG-1"]);
      expect(resolveIssueId).toHaveBeenCalledWith(expect.anything(), "ENG-1");
      expect(getSwarmStatus).toHaveBeenCalledWith(
        expect.anything(),
        "uuid-ENG-1",
      );
      expect(outputResult).toHaveBeenCalled();
    });
  });
});
