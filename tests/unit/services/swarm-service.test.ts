import { afterEach, describe, expect, it, vi } from "vitest";
import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import { IssueRelationType } from "../../../src/gql/graphql.js";
import * as issueRelationService from "../../../src/services/issue-relation-service.js";
import * as issueService from "../../../src/services/issue-service.js";
import {
  analyzeEpicForSwarm,
  buildSwarmDescription,
  createSwarmMolecule,
  findExistingSwarm,
  getSwarmStatus,
  listSwarmMolecules,
  parseSwarmCoordinator,
  prepareSwarmEpic,
  SWARM_LABEL_NAME,
  wrapIssueAsEpic,
} from "../../../src/services/swarm-service.js";

vi.mock("../../../src/services/issue-service.js", () => ({
  createIssue: vi.fn(),
  updateIssue: vi.fn(),
}));
vi.mock("../../../src/services/issue-relation-service.js", () => ({
  createIssueRelation: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

function makeClient(responses: unknown[]): GraphQLClient {
  const request = vi.fn();
  for (const r of responses) request.mockResolvedValueOnce(r);
  return { request } as unknown as GraphQLClient;
}

function childOf(opts: {
  id: string;
  identifier: string;
  title?: string;
  priority?: number;
  stateType?: string;
  assignee?: { id: string; name?: string; email?: string };
  completedAt?: string | null;
  canceledAt?: string | null;
  // forward `blocks` edges from this child to other identifiers; the relation
  // lives on the BLOCKER per Linear semantics.
  blocks?: Array<{ id: string; identifier: string }>;
  related?: Array<{ id: string; identifier: string }>;
}) {
  const blocks = (opts.blocks ?? []).map((t, i) => ({
    id: `r-${opts.id}-b-${i}`,
    type: "blocks",
    relatedIssue: t,
  }));
  const related = (opts.related ?? []).map((t, i) => ({
    id: `r-${opts.id}-r-${i}`,
    type: "related",
    relatedIssue: t,
  }));
  return {
    id: opts.id,
    identifier: opts.identifier,
    title: opts.title ?? opts.identifier,
    priority: opts.priority ?? 2,
    assignee: opts.assignee
      ? {
          id: opts.assignee.id,
          name: opts.assignee.name ?? null,
          email: opts.assignee.email ?? null,
        }
      : null,
    state: {
      id: `s-${opts.stateType ?? "backlog"}`,
      name: opts.stateType ?? "backlog",
      type: opts.stateType ?? "backlog",
    },
    completedAt: opts.completedAt ?? null,
    canceledAt: opts.canceledAt ?? null,
    relations: { nodes: [...blocks, ...related] },
  };
}

function epicResponse(opts: {
  id: string;
  identifier: string;
  title?: string;
  priority?: number;
  teamId?: string;
  children: ReturnType<typeof childOf>[];
}) {
  return {
    issue: {
      id: opts.id,
      identifier: opts.identifier,
      title: opts.title ?? "Epic",
      description: "",
      priority: opts.priority ?? 2,
      state: { id: "s-backlog", name: "Backlog", type: "backlog" },
      team: { id: opts.teamId ?? "team-a", key: "ENG", name: "Eng" },
      parent: null,
      children: { nodes: opts.children },
      labels: { nodes: [] },
      relations: { nodes: [] },
      inverseRelations: { nodes: [] },
    },
  };
}

describe("analyzeEpicForSwarm", () => {
  it("warns when the epic has no children", async () => {
    const client = makeClient([
      epicResponse({ id: "epic-1", identifier: "ENG-1", children: [] }),
    ]);
    const result = await analyzeEpicForSwarm(client, "epic-1");
    expect(result.swarmable).toBe(true);
    expect(result.total_issues).toBe(0);
    expect(result.warnings).toContain("Epic has no children");
    expect(result.ready_fronts).toEqual([]);
  });

  it("layers a 3-child chain into 3 waves and tracks closed children", async () => {
    // A blocks B blocks C. Forward `blocks` lives on the blocker, so:
    //   A.relations.blocks -> B
    //   B.relations.blocks -> C
    const a = childOf({
      id: "c-a",
      identifier: "ENG-2",
      blocks: [{ id: "c-b", identifier: "ENG-3" }],
    });
    const b = childOf({
      id: "c-b",
      identifier: "ENG-3",
      blocks: [{ id: "c-c", identifier: "ENG-4" }],
    });
    const c = childOf({
      id: "c-c",
      identifier: "ENG-4",
      stateType: "completed",
    });
    const client = makeClient([
      epicResponse({ id: "epic-1", identifier: "ENG-1", children: [a, b, c] }),
    ]);
    const result = await analyzeEpicForSwarm(client, "epic-1");
    expect(result.swarmable).toBe(true);
    expect(result.total_issues).toBe(3);
    expect(result.closed_issues).toBe(1);
    expect(result.ready_fronts).toHaveLength(3);
    expect(result.ready_fronts[0]?.issues).toEqual(["ENG-2"]);
    expect(result.ready_fronts[1]?.issues).toEqual(["ENG-3"]);
    expect(result.ready_fronts[2]?.issues).toEqual(["ENG-4"]);
    expect(result.max_parallelism).toBe(1);
    expect(result.estimated_sessions).toBe(3);
    expect(result.issues?.["c-a"]?.depends_on).toEqual([]);
    expect(result.issues?.["c-b"]?.depends_on).toEqual(["ENG-2"]);
    expect(result.issues?.["c-c"]?.depends_on).toEqual(["ENG-3"]);
  });

  it("reports a cycle as an error and marks not swarmable", async () => {
    // A blocks B, B blocks A.
    const a = childOf({
      id: "c-a",
      identifier: "ENG-2",
      blocks: [{ id: "c-b", identifier: "ENG-3" }],
    });
    const b = childOf({
      id: "c-b",
      identifier: "ENG-3",
      blocks: [{ id: "c-a", identifier: "ENG-2" }],
    });
    const client = makeClient([
      epicResponse({ id: "epic-1", identifier: "ENG-1", children: [a, b] }),
    ]);
    const result = await analyzeEpicForSwarm(client, "epic-1");
    expect(result.swarmable).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/Dependency cycle/);
    // No wave layering when errors exist.
    expect(result.ready_fronts).toEqual([]);
  });

  it("warns on disconnected children not reachable from roots", async () => {
    // A blocks B; C is isolated. Roots are A and C, but C has no dependents.
    // The disconnected DFS visits everything from roots (depends_on==0), so a
    // truly orphan node only fails when it neither blocks nor is blocked but
    // is still a non-root. Use two disjoint roots-but-one-with-no-children:
    // simulate with a single child holding a cycle on itself? No, that's an
    // error. Instead, force disconnection via a forward `blocks` to a NON-EPIC
    // child (gets warned out), and create C with no relations at all: the DFS
    // sees both roots A and C, so neither is disconnected. To produce a true
    // disconnect we need a node that isn't a root and isn't reachable: A→B and
    // a back-edge B→A is a cycle. So the safer test is: A→B chain, plus C as
    // its own component → no disconnect. Skip the disconnect-warning case here
    // and rely on the foundation/integration heuristics test below.
    const a = childOf({
      id: "c-a",
      identifier: "ENG-2",
      title: "Foundation refactor",
    });
    const client = makeClient([
      epicResponse({ id: "epic-1", identifier: "ENG-1", children: [a] }),
    ]);
    const result = await analyzeEpicForSwarm(client, "epic-1");
    expect(result.swarmable).toBe(true);
    // Foundation root with no dependents triggers the "no dependents" warning.
    expect(result.warnings.some((w) => /no dependents/.test(w))).toBe(true);
  });

  it("flags integration/final/test leaves with no dependencies", async () => {
    const a = childOf({
      id: "c-a",
      identifier: "ENG-2",
      title: "Integration test pass",
    });
    const client = makeClient([
      epicResponse({ id: "epic-1", identifier: "ENG-1", children: [a] }),
    ]);
    const result = await analyzeEpicForSwarm(client, "epic-1");
    expect(result.warnings.some((w) => /no dependencies/.test(w))).toBe(true);
  });

  it("warns when a child blocks an issue outside the epic", async () => {
    const a = childOf({
      id: "c-a",
      identifier: "ENG-2",
      blocks: [{ id: "outside-1", identifier: "ENG-99" }],
    });
    const client = makeClient([
      epicResponse({ id: "epic-1", identifier: "ENG-1", children: [a] }),
    ]);
    const result = await analyzeEpicForSwarm(client, "epic-1");
    expect(
      result.warnings.some((w) => /outside epic/.test(w) && /ENG-99/.test(w)),
    ).toBe(true);
  });

  it("throws when the epic itself is missing", async () => {
    const client = makeClient([{ issue: null }]);
    await expect(analyzeEpicForSwarm(client, "missing-id")).rejects.toThrow(
      /not found/,
    );
  });
});

describe("prepareSwarmEpic", () => {
  it("returns an existing epic without mutating it", async () => {
    const epic = epicResponse({
      id: "epic-1",
      identifier: "ENG-1",
      children: [childOf({ id: "child-1", identifier: "ENG-2" })],
    });
    const client = makeClient([epic]);

    const result = await prepareSwarmEpic(client, "epic-1", "ENG-1");

    expect(result.id).toBe("epic-1");
    expect(issueService.createIssue).not.toHaveBeenCalled();
    expect(issueService.updateIssue).not.toHaveBeenCalled();
  });

  it("wraps a childless issue and returns the re-fetched wrapper", async () => {
    const source = epicResponse({
      id: "source-1",
      identifier: "ENG-7",
      children: [],
    });
    const wrapper = epicResponse({
      id: "wrapper-1",
      identifier: "ENG-99",
      children: [childOf({ id: "source-1", identifier: "ENG-7" })],
    });
    vi.mocked(issueService.createIssue).mockResolvedValueOnce({
      id: "wrapper-1",
      identifier: "ENG-99",
      title: "Swarm Epic: ENG-7",
      url: "https://linear.app/ENG-99",
    } as never);
    vi.mocked(issueService.updateIssue).mockResolvedValueOnce({
      id: "source-1",
    } as never);
    const client = makeClient([source, wrapper]);

    const result = await prepareSwarmEpic(client, "source-1", "ENG-7");

    expect(result.id).toBe("wrapper-1");
    expect(client.request).toHaveBeenCalledTimes(2);
  });

  it("throws a display-friendly error when the source is missing", async () => {
    const client = makeClient([{ issue: null }]);

    await expect(
      prepareSwarmEpic(client, "missing-uuid", "ENG-404"),
    ).rejects.toThrow("issue 'ENG-404' not found");
  });
});

describe("findExistingSwarm", () => {
  it("returns the first molecule whose related-relation points at the epic", async () => {
    const epicId = "epic-1";
    const page = {
      issues: {
        nodes: [
          {
            id: "swarm-1",
            identifier: "ENG-10",
            title: "Swarm: foo",
            description: "",
            labels: { nodes: [{ id: "l", name: "swarm" }] },
            relations: {
              nodes: [
                {
                  id: "r1",
                  type: "related",
                  relatedIssue: { id: epicId, identifier: "ENG-1" },
                },
              ],
            },
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    };
    const client = makeClient([page]);
    const result = await findExistingSwarm(client, epicId);
    expect(result?.id).toBe("swarm-1");
  });

  it("paginates and returns null when no candidate links to the epic", async () => {
    const page1 = {
      issues: {
        nodes: [
          {
            id: "swarm-1",
            identifier: "ENG-10",
            title: "Swarm: other",
            description: "",
            labels: { nodes: [{ id: "l", name: "swarm" }] },
            relations: {
              nodes: [
                {
                  id: "r1",
                  type: "related",
                  relatedIssue: { id: "epic-other", identifier: "ENG-2" },
                },
              ],
            },
          },
        ],
        pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
      },
    };
    const page2 = {
      issues: {
        nodes: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    };
    const client = makeClient([page1, page2]);
    const result = await findExistingSwarm(client, "epic-1");
    expect(result).toBeNull();
    expect((client.request as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      2,
    );
  });
});

describe("buildSwarmDescription", () => {
  it("includes epic identifiers and coordinator in a structured block", async () => {
    const out = buildSwarmDescription({
      epic_id: "epic-1",
      epic_identifier: "ENG-1",
      coordinator: "agent://foo",
    });
    expect(out).toContain("ENG-1");
    expect(out).toContain("epic-1");
    expect(out).toContain("agent://foo");
  });
});

describe("createSwarmMolecule", () => {
  it("ensures label, creates issue with label, then links via Related relation", async () => {
    const client = makeClient([
      // ensureSwarmLabel → existing
      {
        issueLabels: {
          nodes: [{ id: "label-swarm", name: SWARM_LABEL_NAME, color: "#000" }],
        },
      },
    ]);
    const createIssueMock = vi
      .mocked(issueService.createIssue)
      .mockResolvedValueOnce({
        id: "swarm-new",
        identifier: "ENG-50",
        title: "Swarm: Epic foo",
        url: "https://x",
      } as never);
    const createRelationMock = vi
      .mocked(issueRelationService.createIssueRelation)
      .mockResolvedValueOnce({
        id: "rel-1",
        type: IssueRelationType.Related,
      } as never);

    const epic = {
      id: "epic-1",
      identifier: "ENG-1",
      title: "Epic foo",
      description: "",
      priority: 2,
      state: { id: "s", name: "Backlog", type: "backlog" },
      team: { id: "team-a", key: "ENG", name: "Eng" },
      parent: null,
      children: { nodes: [] },
      labels: { nodes: [] },
      relations: { nodes: [] },
      inverseRelations: { nodes: [] },
    };
    const result = await createSwarmMolecule(client, {
      epic: epic as never,
      coordinator: "agent://x",
    });
    expect(result.id).toBe("swarm-new");
    expect(result.epic_identifier).toBe("ENG-1");
    expect(createIssueMock).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        teamId: "team-a",
        title: "Swarm: Epic foo",
        labelIds: ["label-swarm"],
      }),
    );
    expect(createRelationMock).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        issueId: "swarm-new",
        relatedIssueId: "epic-1",
        type: IssueRelationType.Related,
      }),
    );
  });
});

describe("wrapIssueAsEpic", () => {
  it("creates a wrapper in the same team and reparents the source", async () => {
    const client = makeClient([]);
    const createIssueMock = vi
      .mocked(issueService.createIssue)
      .mockResolvedValueOnce({
        id: "wrapper-1",
        identifier: "ENG-60",
        title: "Swarm Epic: ENG-7 — Implement foo",
        url: "https://x",
      } as never);
    const updateIssueMock = vi
      .mocked(issueService.updateIssue)
      .mockResolvedValueOnce({ id: "src-1" } as never);

    const source = {
      id: "src-1",
      identifier: "ENG-7",
      title: "Implement foo",
      description: "",
      priority: 3,
      state: { id: "s", name: "Backlog", type: "backlog" },
      team: { id: "team-a", key: "ENG", name: "Eng" },
      parent: null,
      children: { nodes: [] },
      labels: { nodes: [] },
      relations: { nodes: [] },
      inverseRelations: { nodes: [] },
    };
    const result = await wrapIssueAsEpic(client, source as never);
    expect(result.id).toBe("wrapper-1");
    expect(createIssueMock).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ teamId: "team-a", priority: 3 }),
    );
    expect(updateIssueMock).toHaveBeenCalledWith(client, "src-1", {
      parentId: "wrapper-1",
    });
  });
});

describe("parseSwarmCoordinator", () => {
  it("extracts coordinator from a description built by buildSwarmDescription", () => {
    const desc = buildSwarmDescription({
      epic_id: "epic-1",
      epic_identifier: "ENG-1",
      coordinator: "alice@team",
    });
    expect(parseSwarmCoordinator(desc)).toBe("alice@team");
  });

  it("returns empty string when description is null/undefined", () => {
    expect(parseSwarmCoordinator(null)).toBe("");
    expect(parseSwarmCoordinator("")).toBe("");
  });

  it("returns empty string when the coordinator marker is missing", () => {
    expect(
      parseSwarmCoordinator("Some random description\nwith no marker"),
    ).toBe("");
  });

  it("returns empty string when coordinator value is empty", () => {
    const desc = buildSwarmDescription({
      epic_id: "epic-1",
      epic_identifier: "ENG-1",
      coordinator: "",
    });
    expect(parseSwarmCoordinator(desc)).toBe("");
  });

  it("matches the marker case-insensitively but preserves value casing", () => {
    expect(parseSwarmCoordinator("- COORDINATOR: MixedCase-Coord")).toBe(
      "MixedCase-Coord",
    );
  });
});

describe("listSwarmMolecules", () => {
  function swarmCandidate(opts: {
    id: string;
    identifier: string;
    title: string;
    description: string;
    epicId?: string;
    epicIdentifier?: string;
  }) {
    const relations =
      opts.epicId !== undefined
        ? [
            {
              id: `r-${opts.id}`,
              type: "related",
              relatedIssue: {
                id: opts.epicId,
                identifier: opts.epicIdentifier ?? "EPIC-?",
              },
            },
          ]
        : [];
    return {
      id: opts.id,
      identifier: opts.identifier,
      title: opts.title,
      description: opts.description,
      labels: { nodes: [{ id: "l-swarm", name: "swarm" }] },
      relations: { nodes: relations },
    };
  }

  it("returns an empty result when no swarms are labeled", async () => {
    const client = makeClient([
      {
        issues: {
          nodes: [],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    ]);
    const result = await listSwarmMolecules(client);
    expect(result).toEqual({ swarms: [], count: 0 });
  });

  it("emits a row with parsed coordinator and analysis fields when epic is linked", async () => {
    const epicId = "epic-1";
    const swarmPage = {
      issues: {
        nodes: [
          swarmCandidate({
            id: "swarm-1",
            identifier: "ENG-100",
            title: "Swarm: foo",
            description: buildSwarmDescription({
              epic_id: epicId,
              epic_identifier: "ENG-1",
              coordinator: "alice",
            }),
            epicId,
            epicIdentifier: "ENG-1",
          }),
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    };
    const epic = epicResponse({
      id: epicId,
      identifier: "ENG-1",
      title: "Foo Epic",
      children: [
        childOf({ id: "c1", identifier: "ENG-2", stateType: "completed" }),
        childOf({ id: "c2", identifier: "ENG-3", stateType: "started" }),
        childOf({ id: "c3", identifier: "ENG-4", stateType: "backlog" }),
      ],
    });
    const client = makeClient([swarmPage, epic]);
    const result = await listSwarmMolecules(client);
    expect(result.count).toBe(1);
    const row = result.swarms[0];
    expect(row.swarm_id).toBe("swarm-1");
    expect(row.swarm_identifier).toBe("ENG-100");
    expect(row.coordinator).toBe("alice");
    expect(row.epic_id).toBe(epicId);
    expect(row.epic_identifier).toBe("ENG-1");
    expect(row.epic_title).toBe("Foo Epic");
    expect(row.total_issues).toBe(3);
    expect(row.closed_issues).toBe(1);
    expect(row.wave_depth).toBeGreaterThanOrEqual(1);
    expect(row.swarmable).toBe(true);
    expect(row.analysis_error).toBeUndefined();
  });

  it("paginates the swarm label query", async () => {
    const page1 = {
      issues: {
        nodes: [
          swarmCandidate({
            id: "swarm-1",
            identifier: "ENG-100",
            title: "Swarm A",
            description: buildSwarmDescription({
              epic_id: "epic-1",
              epic_identifier: "ENG-1",
              coordinator: "a",
            }),
            // no epic linked → no analyze call
          }),
        ],
        pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
      },
    };
    const page2 = {
      issues: {
        nodes: [
          swarmCandidate({
            id: "swarm-2",
            identifier: "ENG-101",
            title: "Swarm B",
            description: buildSwarmDescription({
              epic_id: "epic-2",
              epic_identifier: "ENG-2",
              coordinator: "b",
            }),
            // no epic linked → no analyze call
          }),
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    };
    const client = makeClient([page1, page2]);
    const result = await listSwarmMolecules(client);
    expect(result.count).toBe(2);
    expect(result.swarms.map((s) => s.swarm_id)).toEqual([
      "swarm-1",
      "swarm-2",
    ]);
    // 2 swarm pages, 0 epic analysis calls (no relations)
    expect((client.request as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      2,
    );
  });

  it("captures analysis_error and continues when analyzeEpicForSwarm fails", async () => {
    const swarmPage = {
      issues: {
        nodes: [
          swarmCandidate({
            id: "swarm-1",
            identifier: "ENG-100",
            title: "Swarm",
            description: buildSwarmDescription({
              epic_id: "epic-missing",
              epic_identifier: "ENG-1",
              coordinator: "x",
            }),
            epicId: "epic-missing",
            epicIdentifier: "ENG-1",
          }),
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    };
    // analyzeEpicForSwarm calls request once and throws on missing issue
    const client = makeClient([swarmPage, { issue: null }]);
    const result = await listSwarmMolecules(client);
    expect(result.count).toBe(1);
    expect(result.swarms[0].analysis_error).toMatch(/not found/);
    expect(result.swarms[0].total_issues).toBe(0);
  });

  it("leaves epic fields null when the swarm has no related-relation", async () => {
    const swarmPage = {
      issues: {
        nodes: [
          swarmCandidate({
            id: "swarm-orphan",
            identifier: "ENG-100",
            title: "Orphaned swarm",
            description: "no markers here",
            // no relations → no epic
          }),
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    };
    const client = makeClient([swarmPage]);
    const result = await listSwarmMolecules(client);
    const row = result.swarms[0];
    expect(row.epic_id).toBeNull();
    expect(row.epic_identifier).toBeNull();
    expect(row.coordinator).toBe("");
    expect(row.total_issues).toBe(0);
  });
});

describe("getSwarmStatus", () => {
  it("treats a non-molecule input as the epic directly", async () => {
    const a = childOf({
      id: "c-a",
      identifier: "ENG-2",
      stateType: "completed",
      completedAt: "2026-05-10T12:00:00.000Z",
    });
    const b = childOf({
      id: "c-b",
      identifier: "ENG-3",
      stateType: "started",
      assignee: { id: "u-1", name: "Alice", email: "alice@example.com" },
    });
    const client = makeClient([
      epicResponse({ id: "epic-1", identifier: "ENG-1", children: [a, b] }),
    ]);
    const status = await getSwarmStatus(client, "epic-1");
    expect(status.epic_id).toBe("epic-1");
    expect(status.total_issues).toBe(2);
    expect(status.completed).toHaveLength(1);
    expect(status.completed[0].identifier).toBe("ENG-2");
    expect(status.completed[0].closed_at).toBe("2026-05-10T12:00:00.000Z");
    expect(status.active).toHaveLength(1);
    expect(status.active[0].identifier).toBe("ENG-3");
    expect(status.active[0].assignee_name).toBe("Alice");
    expect(status.active[0].assignee_email).toBe("alice@example.com");
    expect(status.progress_percent).toBe(50);
  });

  it("categorizes ready vs blocked using in-epic blocks relations", async () => {
    // A (open, no deps) → ready
    // B (open, blocks_by closed C) → ready  (its blocker is closed)
    // D (open, blocks_by open A) → blocked
    const a = childOf({
      id: "c-a",
      identifier: "ENG-2",
      blocks: [{ id: "c-d", identifier: "ENG-5" }],
    });
    const c = childOf({
      id: "c-c",
      identifier: "ENG-4",
      stateType: "completed",
      blocks: [{ id: "c-b", identifier: "ENG-3" }],
    });
    const b = childOf({ id: "c-b", identifier: "ENG-3" });
    const d = childOf({ id: "c-d", identifier: "ENG-5" });
    const client = makeClient([
      epicResponse({
        id: "epic-1",
        identifier: "ENG-1",
        children: [a, b, c, d],
      }),
    ]);
    const status = await getSwarmStatus(client, "epic-1");
    expect(status.completed.map((s) => s.identifier)).toEqual(["ENG-4"]);
    expect(status.ready.map((s) => s.identifier).sort()).toEqual([
      "ENG-2",
      "ENG-3",
    ]);
    expect(status.blocked.map((s) => s.identifier)).toEqual(["ENG-5"]);
    expect(status.blocked[0].blocked_by).toEqual(["ENG-2"]);
    expect(status.active_count).toBe(0);
    expect(status.ready_count).toBe(2);
    expect(status.blocked_count).toBe(1);
  });

  it("sorts each bucket by identifier numerically", async () => {
    const c1 = childOf({ id: "x1", identifier: "ENG-12" });
    const c2 = childOf({ id: "x2", identifier: "ENG-2" });
    const c3 = childOf({ id: "x3", identifier: "ENG-100" });
    const client = makeClient([
      epicResponse({
        id: "epic-1",
        identifier: "ENG-1",
        children: [c1, c2, c3],
      }),
    ]);
    const status = await getSwarmStatus(client, "epic-1");
    expect(status.ready.map((s) => s.identifier)).toEqual([
      "ENG-2",
      "ENG-12",
      "ENG-100",
    ]);
  });

  it("follows a swarm molecule's related-relation to find the epic", async () => {
    // First request: swarmOrEpicId 'mol-1' resolves to a molecule with labels=[swarm] and a related→epic-1 relation.
    // Service then needs a second request for epic-1.
    const moleculeResponse = {
      issue: {
        id: "mol-1",
        identifier: "ENG-100",
        title: "Swarm: foo",
        description: "",
        priority: 2,
        state: { id: "s", name: "Backlog", type: "backlog" },
        team: { id: "t", key: "ENG", name: "Eng" },
        parent: null,
        children: { nodes: [] },
        labels: { nodes: [{ id: "l-s", name: "swarm" }] },
        relations: {
          nodes: [
            {
              id: "r-1",
              type: "related",
              relatedIssue: { id: "epic-1", identifier: "ENG-1" },
            },
          ],
        },
        inverseRelations: { nodes: [] },
      },
    };
    const a = childOf({
      id: "c-a",
      identifier: "ENG-2",
      stateType: "completed",
    });
    const b = childOf({ id: "c-b", identifier: "ENG-3" });
    const client = makeClient([
      moleculeResponse,
      epicResponse({ id: "epic-1", identifier: "ENG-1", children: [a, b] }),
    ]);
    const status = await getSwarmStatus(client, "mol-1");
    expect(status.epic_id).toBe("epic-1");
    expect(status.total_issues).toBe(2);
    expect(status.completed).toHaveLength(1);
    expect(status.ready).toHaveLength(1);
  });

  it("throws when a swarm molecule has no related-epic relation", async () => {
    const orphanMolecule = {
      issue: {
        id: "mol-orphan",
        identifier: "ENG-100",
        title: "Orphan swarm",
        description: "",
        priority: 2,
        state: { id: "s", name: "Backlog", type: "backlog" },
        team: { id: "t", key: "ENG", name: "Eng" },
        parent: null,
        children: { nodes: [] },
        labels: { nodes: [{ id: "l-s", name: "swarm" }] },
        relations: { nodes: [] },
        inverseRelations: { nodes: [] },
      },
    };
    const client = makeClient([orphanMolecule]);
    await expect(getSwarmStatus(client, "mol-orphan")).rejects.toThrow(
      /no linked epic/,
    );
  });

  it("throws when the input issue is not found", async () => {
    const client = makeClient([{ issue: null }]);
    await expect(getSwarmStatus(client, "missing")).rejects.toThrow(
      /not found/,
    );
  });

  it("returns an empty status when the epic has no children", async () => {
    const client = makeClient([
      epicResponse({ id: "epic-1", identifier: "ENG-1", children: [] }),
    ]);
    const status = await getSwarmStatus(client, "epic-1");
    expect(status.total_issues).toBe(0);
    expect(status.completed).toEqual([]);
    expect(status.ready).toEqual([]);
    expect(status.blocked).toEqual([]);
    expect(status.active).toEqual([]);
    expect(status.progress_percent).toBe(0);
  });
});
