import { describe, expect, it, vi } from "vitest";
import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import { importIssues } from "../../../src/services/issue-import-service.js";

function opName(doc: unknown): string | undefined {
  const defs =
    (doc as { definitions?: Array<{ name?: { value?: string } }> })
      .definitions ?? [];
  for (const d of defs) {
    if (d.name?.value) return d.name.value;
  }
  return undefined;
}

interface MockState {
  teams: Array<{ id: string; key: string; name: string }>;
  labels: Array<{ id: string; name: string }>;
  openTitles: string[];
  createdIssues: Array<{ id: string; identifier: string; title: string }>;
  createdRelations: Array<{ issueId: string; relatedIssueId: string }>;
  failNextCreate?: boolean;
}

function mkClient(state: MockState): GraphQLClient {
  return {
    request: vi.fn(async (doc: unknown, vars?: unknown) => {
      const name = opName(doc);
      switch (name) {
        case "GetTeams":
          return {
            teams: {
              nodes: state.teams,
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          };
        case "GetLabels": {
          const v = (vars ?? {}) as {
            filter?: { name?: { eq?: string } };
          };
          const filterName = v.filter?.name?.eq;
          const matched = filterName
            ? state.labels.filter((l) => l.name === filterName)
            : state.labels;
          return {
            issueLabels: {
              nodes: matched,
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          };
        }
        case "ListIssuesForExport":
          return {
            issues: {
              nodes: state.openTitles.map((t, i) => ({
                id: `o${i}`,
                identifier: `OPEN-${i}`,
                title: t,
                description: null,
                priority: 0,
                state: { id: "s", name: "Open" },
                team: null,
                labels: { nodes: [] },
                assignee: null,
                project: null,
                parent: null,
                children: { nodes: [] },
                relations: { nodes: [] },
                inverseRelations: { nodes: [] },
                comments: { nodes: [] },
                createdAt: "2026-05-01T00:00:00.000Z",
                updatedAt: "2026-05-01T00:00:00.000Z",
              })),
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          };
        case "CreateIssueLabel": {
          const v = vars as { input: { name: string } };
          const id = `l-new-${v.input.name}`;
          state.labels.push({ id, name: v.input.name });
          return {
            issueLabelCreate: {
              success: true,
              issueLabel: { id, name: v.input.name },
            },
          };
        }
        case "CreateIssue": {
          if (state.failNextCreate) {
            state.failNextCreate = false;
            return { issueCreate: { success: false, issue: null } };
          }
          const v = vars as { input: { title: string } };
          const id = `i-${state.createdIssues.length + 1}`;
          const identifier = `NEW-${state.createdIssues.length + 1}`;
          const created = { id, identifier, title: v.input.title };
          state.createdIssues.push(created);
          return { issueCreate: { success: true, issue: created } };
        }
        case "CreateIssueRelation": {
          const v = vars as {
            input: { issueId: string; relatedIssueId: string };
          };
          state.createdRelations.push({
            issueId: v.input.issueId,
            relatedIssueId: v.input.relatedIssueId,
          });
          return {
            issueRelationCreate: {
              success: true,
              issueRelation: { id: `r-${state.createdRelations.length}` },
            },
          };
        }
        default:
          throw new Error(`unexpected op: ${name}`);
      }
    }),
  } as unknown as GraphQLClient;
}

function freshState(): MockState {
  return {
    teams: [{ id: "t-eng", key: "ENG", name: "Engineering" }],
    labels: [{ id: "l-bug", name: "bug" }],
    openTitles: [],
    createdIssues: [],
    createdRelations: [],
  };
}

function lineFor(args: {
  identifier: string;
  title: string;
  teamKey?: string | null;
  labels?: string[];
  description?: string;
  priority?: number;
  dependencies?: Array<{ depends_on_identifier: string; type?: string }>;
}): string {
  return JSON.stringify({
    _type: "issue",
    identifier: args.identifier,
    title: args.title,
    description: args.description ?? null,
    priority: args.priority ?? 2,
    team:
      args.teamKey === undefined
        ? { key: "ENG" }
        : args.teamKey === null
          ? null
          : { key: args.teamKey },
    labels: args.labels ?? [],
    dependencies: args.dependencies ?? [],
  });
}

describe("importIssues — parsing", () => {
  it("ignores blank lines and counts memory lines as skipped", async () => {
    const state = freshState();
    const client = mkClient(state);
    const jsonl = [
      lineFor({ identifier: "OLD-1", title: "T1" }),
      "",
      JSON.stringify({ _type: "memory", key: "k", value: "v" }),
      lineFor({ identifier: "OLD-2", title: "T2" }),
    ].join("\n");

    const r = await importIssues({ client, jsonl, source: "test" });
    expect(r.parsed).toBe(2);
    expect(r.memories_skipped).toBe(1);
    expect(r.created).toBe(2);
  });

  it("records a parse error for invalid JSON, keeps going", async () => {
    const state = freshState();
    const client = mkClient(state);
    const jsonl = [
      lineFor({ identifier: "OLD-1", title: "T1" }),
      "{not-json",
      lineFor({ identifier: "OLD-2", title: "T2" }),
    ].join("\n");

    const r = await importIssues({ client, jsonl, source: "test" });
    expect(r.parsed).toBe(2);
    expect(r.errors.find((e) => e.line_index === 1)?.message).toMatch(
      /invalid JSON/,
    );
    expect(r.created).toBe(2);
  });

  it("records an error for missing title", async () => {
    const state = freshState();
    const client = mkClient(state);
    const jsonl = [
      JSON.stringify({
        _type: "issue",
        identifier: "OLD-1",
        team: { key: "ENG" },
      }),
    ].join("\n");
    const r = await importIssues({ client, jsonl, source: "test" });
    expect(r.parsed).toBe(0);
    expect(r.errors[0].message).toMatch(/title/);
  });
});

describe("importIssues — happy path", () => {
  it("creates issues + relations, returns new identifiers", async () => {
    const state = freshState();
    const client = mkClient(state);
    const jsonl = [
      lineFor({
        identifier: "OLD-1",
        title: "Build login",
        labels: ["bug", "new-label"],
      }),
      lineFor({
        identifier: "OLD-2",
        title: "Wire OAuth",
        dependencies: [{ depends_on_identifier: "OLD-1", type: "blocks" }],
      }),
    ].join("\n");

    const r = await importIssues({ client, jsonl, source: "import.jsonl" });

    expect(r.action).toBe("imported");
    expect(r.parsed).toBe(2);
    expect(r.created).toBe(2);
    expect(r.ids).toEqual(["NEW-1", "NEW-2"]);
    expect(r.relations_created).toBe(1);
    // Phase B: OLD-1 blocks OLD-2 → blocker is OLD-1 → issueId=NEW-1's UUID
    expect(state.createdRelations).toEqual([
      { issueId: "i-1", relatedIssueId: "i-2" },
    ]);
    expect(state.labels.some((l) => l.name === "new-label")).toBe(true);
  });
});

describe("importIssues — dry-run", () => {
  it("plans without mutating", async () => {
    const state = freshState();
    const client = mkClient(state);
    const jsonl = lineFor({ identifier: "OLD-1", title: "T" });

    const r = await importIssues({
      client,
      jsonl,
      source: "test",
      dryRun: true,
    });
    expect(r.action).toBe("planned");
    expect(r.dry_run).toBe(true);
    expect(r.created).toBe(1);
    expect(state.createdIssues).toEqual([]);
    expect(state.createdRelations).toEqual([]);
  });
});

describe("importIssues — dedup", () => {
  it("skips lines whose title matches an open issue", async () => {
    const state = freshState();
    state.openTitles = ["Build login"];
    const client = mkClient(state);
    const jsonl = [
      lineFor({ identifier: "OLD-1", title: "Build login" }),
      lineFor({ identifier: "OLD-2", title: "Wire OAuth" }),
    ].join("\n");

    const r = await importIssues({
      client,
      jsonl,
      source: "test",
      dedup: true,
    });
    expect(r.dedup_skipped).toBe(1);
    expect(r.created).toBe(1);
    expect(r.ids).toEqual(["NEW-1"]);
  });
});

describe("importIssues — errors", () => {
  it("reports missing team.key", async () => {
    const state = freshState();
    const client = mkClient(state);
    const jsonl = lineFor({ identifier: "OLD-1", title: "T", teamKey: null });
    const r = await importIssues({ client, jsonl, source: "test" });
    expect(r.errors[0].message).toMatch(/missing team\.key/);
    expect(r.created).toBe(0);
  });

  it("reports unknown team key but keeps going", async () => {
    const state = freshState();
    const client = mkClient(state);
    const jsonl = [
      lineFor({ identifier: "OLD-1", title: "T1", teamKey: "GHOST" }),
      lineFor({ identifier: "OLD-2", title: "T2" }),
    ].join("\n");
    const r = await importIssues({ client, jsonl, source: "test" });
    expect(r.created).toBe(1);
    expect(r.errors.find((e) => e.identifier === "OLD-1")?.message).toMatch(
      /unknown team key/,
    );
  });

  it("reports dependency targets not present in this import", async () => {
    const state = freshState();
    const client = mkClient(state);
    const jsonl = lineFor({
      identifier: "OLD-1",
      title: "T",
      dependencies: [{ depends_on_identifier: "GONE-99", type: "blocks" }],
    });
    const r = await importIssues({ client, jsonl, source: "test" });
    expect(r.created).toBe(1);
    expect(r.relations_created).toBe(0);
    expect(r.errors[0].message).toMatch(/GONE-99/);
  });

  it("captures createIssue failures into errors without throwing", async () => {
    const state = freshState();
    state.failNextCreate = true;
    const client = mkClient(state);
    const jsonl = [
      lineFor({ identifier: "OLD-1", title: "Doomed" }),
      lineFor({ identifier: "OLD-2", title: "Survivor" }),
    ].join("\n");
    const r = await importIssues({ client, jsonl, source: "test" });
    expect(r.created).toBe(1);
    expect(r.ids).toEqual(["NEW-1"]);
    expect(r.errors.find((e) => e.identifier === "OLD-1")?.message).toMatch(
      /success=false/,
    );
  });
});
