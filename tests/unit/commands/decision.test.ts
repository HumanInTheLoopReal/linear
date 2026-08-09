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

// `record` and `supersede` now run the create gate, which resolves the active
// template. Unset config on every layer is what makes these tests measure the
// contract the CLI ships rather than whatever this machine has configured.
vi.mock("../../../src/common/config-store.js", () => ({
  getDefaultTeam: vi.fn(() => "ENG"),
  getConfig: vi.fn((key: string) => ({
    key,
    value: null,
    found: false,
    source: "default",
  })),
  readAll: vi.fn(() => ({})),
}));

vi.mock("../../../src/resolvers/team-resolver.js", () => ({
  resolveTeamId: vi.fn(async (_sdk: unknown, key: string) => `team-${key}`),
}));

vi.mock("../../../src/resolvers/issue-resolver.js", () => ({
  resolveIssueId: vi.fn(async (_sdk: unknown, id: string) => `uuid-${id}`),
}));

vi.mock("../../../src/resolvers/label-resolver.js", () => ({
  resolveWorkspaceLabelId: vi.fn(async () => "label-decision-uuid"),
}));

vi.mock("../../../src/resolvers/status-resolver.js", () => ({
  resolveStateIdByType: vi.fn(async () => "state-completed"),
}));

vi.mock("../../../src/services/label-service.js", () => ({
  ensureWorkspaceLabel: vi.fn(async () => "label-decision-uuid"),
}));

vi.mock("../../../src/services/issue-service.js", () => ({
  createIssue: vi.fn(async (_gql: unknown, input: { title: string }) => ({
    id: "issue-new-uuid",
    identifier: "ENG-99",
    title: input.title,
  })),
  getIssue: vi.fn(async (_gql: unknown, id: string) => ({
    id,
    identifier: id === "uuid-ENG-1" ? "ENG-1" : "ENG-X",
    title: "Old decision",
    description: "## Decision\n\nold",
    team: { id: "team-ENG", key: "ENG", name: "Eng" },
  })),
  listIssues: vi.fn(async () => ({
    nodes: [
      {
        id: "u1",
        identifier: "ENG-1",
        title: "First decision",
        state: { name: "In Progress" },
      },
      {
        id: "u2",
        identifier: "ENG-2",
        title: "Second decision",
        state: { name: "Backlog" },
      },
    ],
    pageInfo: { hasNextPage: false, endCursor: null },
  })),
  updateIssue: vi.fn(async () => ({ id: "uuid-ENG-1" })),
}));

vi.mock("../../../src/services/issue-relation-service.js", () => ({
  createIssueRelation: vi.fn(async () => ({
    id: "rel-1",
    type: "related",
  })),
}));

import {
  buildDecisionDescription,
  setupDecisionCommands,
} from "../../../src/commands/decision.js";
import { getDefaultTeam } from "../../../src/common/config-store.js";
import { notFoundError } from "../../../src/common/errors.js";
import { outputResult } from "../../../src/common/output.js";
import { resolveIssueId } from "../../../src/resolvers/issue-resolver.js";
import { resolveWorkspaceLabelId } from "../../../src/resolvers/label-resolver.js";
import { resolveTeamId } from "../../../src/resolvers/team-resolver.js";
import { createIssueRelation } from "../../../src/services/issue-relation-service.js";
import {
  createIssue,
  listIssues,
  updateIssue,
} from "../../../src/services/issue-service.js";
import { ensureWorkspaceLabel } from "../../../src/services/label-service.js";
import { lintIssue } from "../../../src/services/lint-service.js";

function createProgram(): Command {
  const program = new Command();
  setupDecisionCommands(program);
  return program;
}

/**
 * Flags filling every section the `decision` contract requires. Spelled out once
 * because the gate now refuses a partial body, so a test about priority or
 * relations would otherwise be half made of unrelated section flags.
 */
const FULL_BODY = [
  "--context",
  "The current runtime cannot be measured.",
  "--decision",
  "Adopt the new runtime.",
  "--consequences",
  "Measurement gets easier; the migration costs a sprint.",
  "--alternatives",
  "Stay put: rejected, the blind spot remains.",
  "--revisit-when",
  "The runtime stops publishing metrics.",
  "--test",
  "npm run check",
];

describe("buildDecisionDescription", () => {
  it("renders the sections in contract order, Affects last", () => {
    const body = buildDecisionDescription({
      context: "Latency is unmeasurable.",
      decision: "Adopt the new runtime.",
      consequences: "Faster reads; a sprint of migration.",
      alternatives: "Stay put: the blind spot remains.",
      revisitWhen: "Metrics stop being published.",
      test: "npm run check",
      affects: "ENG-12, ENG-13",
    }) as string;
    const order = [
      "## Context",
      "## Decision",
      "## Consequences",
      "## Alternatives",
      "## Revisit when",
      "## Test Plan",
      "## Affects",
    ].map((heading) => body.indexOf(heading));
    expect(order[0]).toBe(0);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order).not.toContain(-1);
  });

  it("omits a section nobody supplied rather than inventing a placeholder", () => {
    // The old body carried "<one-sentence summary of what was decided>" under
    // ## Decision and "- (none recorded)" elsewhere. Every one of those reads as
    // filled content to a checker, which is how a decision could be recorded
    // with its decision left unwritten.
    const body = buildDecisionDescription({ decision: "Adopt it." }) as string;
    expect(body).toContain("## Decision");
    expect(body).not.toContain("## Alternatives");
    expect(body).not.toContain("(none recorded)");
    expect(body).not.toContain("<one-sentence");
  });

  it("treats --rationale as the old spelling of --context", () => {
    const body = buildDecisionDescription({ rationale: "because X" }) as string;
    expect(body).toContain("## Context");
    expect(body).toContain("because X");
    expect(body).not.toContain("## Rationale");
  });

  it("refuses --rationale and --context together, since both fill one section", () => {
    expect(() =>
      buildDecisionDescription({ context: "a", rationale: "b" }),
    ).toThrow(/--context/);
  });

  it("returns undefined when no source was given, so the gate reports it all", () => {
    expect(buildDecisionDescription({})).toBeUndefined();
  });

  it("produces a body the lint accepts, which is the point of the change", () => {
    // This is the regression that mattered: the command composed its own
    // headings, so `decision record` shipped issues that `issues lint` then
    // flagged. Both sides now read one resolver, and this asserts they agree
    // rather than asserting a heading list a reader would have to trust.
    const description = buildDecisionDescription({
      context: "Latency is unmeasurable.",
      decision: "Adopt the new runtime.",
      consequences: "Faster reads; a sprint of migration.",
      alternatives: "Stay put: the blind spot remains.",
      revisitWhen: "Metrics stop being published.",
      test: "npm run check",
    });
    expect(
      lintIssue({
        id: "issue-1",
        identifier: "ENG-7",
        title: "Adopt the new runtime",
        description,
        labels: { nodes: [{ name: "type:decision" }] },
      } as Parameters<typeof lintIssue>[0]),
    ).toBeNull();
  });

  it("takes a whole body verbatim", () => {
    const written = "## Context\n\nalready written\n";
    expect(buildDecisionDescription({ body: written })).toBe(written);
  });

  it("refuses a whole body combined with a section flag", () => {
    // Splicing one into the other cannot be done safely here: replaceSection
    // matches a heading case-sensitively and treats only `## ` as a boundary,
    // while the gate matches case-insensitively at any depth. The two cases
    // below are what that mismatch produces, so the combination is refused
    // rather than silently corrupting the body.
    expect(() =>
      buildDecisionDescription({
        body: "## Context\n\nctx\n\n## decision\n\nold\n",
        decision: "new",
      }),
    ).toThrow(/--decision/);

    expect(() =>
      buildDecisionDescription({
        body: "## Decision\n\nold\n\n### Consequences\n\nimpact\n",
        decision: "new",
      }),
    ).toThrow(/--body/);
  });

  it("refuses two body sources at once", () => {
    expect(() =>
      buildDecisionDescription({ body: "x", bodyFile: "/tmp/nope.md" }),
    ).toThrow(/--body/);
  });

  it("names the offending flag, whichever section it was", () => {
    expect(() =>
      buildDecisionDescription({ body: "x", affects: "ENG-1" }),
    ).toThrow(/--affects/);
  });

  it("treats an empty section value as supplied, and the gate then refuses it", () => {
    // An empty value is a heading asked for with nothing under it. It composes
    // to nothing here, so the section is simply absent and the gate names it —
    // never a silently accepted blank section.
    const body = buildDecisionDescription({
      context: "",
      decision: "Adopt it.",
    }) as string;
    expect(body).not.toContain("## Context");
    expect(body).toContain("## Decision");
  });
});

describe("linear decision record", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("creates a Linear issue with the type:decision label and structured body", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "decision",
      "record",
      "--title",
      "Switch to Linear",
      ...FULL_BODY,
      "--affects",
      "- ENG-12",
    ]);

    expect(ensureWorkspaceLabel).toHaveBeenCalledWith(
      expect.anything(),
      "type:decision",
      expect.any(String),
    );
    expect(resolveTeamId).toHaveBeenCalledWith(expect.anything(), "ENG");
    expect(createIssue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        title: "Switch to Linear",
        teamId: "team-ENG",
        labelIds: ["label-decision-uuid"],
        priority: 2,
        description: expect.stringContaining("## Revisit when"),
      }),
    );
    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: "ENG-99",
        label: "type:decision",
      }),
      expect.any(Function),
      expect.anything(),
    );
  });

  it("uses --team override over getDefaultTeam()", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "decision",
      "record",
      "--title",
      "X",
      ...FULL_BODY,
      "--team",
      "DESIGN",
    ]);
    expect(resolveTeamId).toHaveBeenCalledWith(expect.anything(), "DESIGN");
  });

  it("uses the canonical Linear priority scale and accepts P1 shorthand", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "decision",
      "record",
      "--title",
      "Urgent decision",
      ...FULL_BODY,
      "--priority",
      "P1",
    ]);

    expect(createIssue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ priority: 1 }),
    );
  });

  it.each([
    "0",
    "2junk",
    "5",
  ])("rejects non-assignable priority %s", async (priority) => {
    const program = createProgram();
    await expect(
      program.parseAsync([
        "node",
        "test",
        "decision",
        "record",
        "--title",
        "Invalid priority",
        ...FULL_BODY,
        "--priority",
        priority,
      ]),
    ).rejects.toThrow(/must be 1-4/);

    expect(createIssue).not.toHaveBeenCalled();
  });

  it("refuses a title-only decision, and refuses it before touching the workspace", async () => {
    // No section flag is a commander requiredOption any more, because what a
    // decision must contain belongs to the gate and to `template show`. The
    // label check matters as much as the create one: ensureWorkspaceLabel
    // CREATES the convention label, so a refusal after it would leave that
    // label behind for a decision that was never recorded.
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "decision",
      "record",
      "--title",
      "X",
    ]);
    expect(createIssue).not.toHaveBeenCalled();
    expect(ensureWorkspaceLabel).not.toHaveBeenCalled();
    expect(resolveTeamId).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("refuses --context and --rationale together at the CLI", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "decision",
      "record",
      "--title",
      "X",
      ...FULL_BODY,
      "--rationale",
      "duplicate of --context",
    ]);
    expect(createIssue).not.toHaveBeenCalled();
    expect(ensureWorkspaceLabel).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("refuses --body plus a section flag at the CLI", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "decision",
      "record",
      "--title",
      "X",
      "--body",
      "## Context\n\nctx\n",
      "--decision",
      "Adopt it.",
    ]);
    expect(createIssue).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("accepts a whole body that satisfies the contract", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "decision",
      "record",
      "--title",
      "X",
      "--body",
      [
        "## Context",
        "",
        "Latency is unmeasurable.",
        "",
        "## Decision",
        "",
        "Adopt the new runtime.",
        "",
        "## Consequences",
        "",
        "- Faster reads",
        "",
        "## Alternatives",
        "",
        "- Stay put",
        "",
        "## Revisit when",
        "",
        "Metrics stop.",
        "",
        "## Test Plan",
        "",
        "npm run check",
      ].join("\n"),
    ]);
    expect(createIssue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        description: expect.stringContaining("Adopt the new runtime."),
      }),
    );
  });

  it("errors when no team is supplied and no team.default is configured", async () => {
    (getDefaultTeam as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      null,
    );
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "decision",
      "record",
      "--title",
      "X",
      ...FULL_BODY,
    ]);
    expect(createIssue).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

describe("linear decision list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("filters by the type:decision label and emits row payloads", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "decision", "list"]);

    expect(resolveWorkspaceLabelId).toHaveBeenCalledWith(
      expect.anything(),
      "type:decision",
    );
    expect(ensureWorkspaceLabel).not.toHaveBeenCalled();
    expect(listIssues).toHaveBeenCalledWith(
      expect.anything(),
      { limit: 50 },
      { labels: { some: { id: { in: ["label-decision-uuid"] } } } },
      { includeClosed: true },
    );
    expect(outputResult).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ identifier: "ENG-1" }),
      ]),
      expect.any(Function),
      expect.anything(),
    );
  });

  it("returns an empty read-only log when the convention label is absent", async () => {
    vi.mocked(resolveWorkspaceLabelId).mockRejectedValueOnce(
      notFoundError("Workspace label", "type:decision"),
    );
    const program = createProgram();

    await program.parseAsync(["node", "test", "decision", "list"]);

    expect(listIssues).not.toHaveBeenCalled();
    expect(ensureWorkspaceLabel).not.toHaveBeenCalled();
    expect(outputResult).toHaveBeenCalledWith(
      [],
      expect.any(Function),
      expect.anything(),
    );
  });

  it("does not hide infrastructure failures as an empty decision log", async () => {
    vi.mocked(resolveWorkspaceLabelId).mockRejectedValueOnce(
      new Error("network unavailable"),
    );
    const program = createProgram();

    await program.parseAsync(["node", "test", "decision", "list"]);

    expect(listIssues).not.toHaveBeenCalled();
    expect(outputResult).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

describe("linear decision supersede", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("refuses an incomplete body before it resolves the superseded issue", async () => {
    // supersede reads the old issue to inherit its team, which is a network call
    // like any other. A refusal has to land before it.
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "decision",
      "supersede",
      "ENG-1",
      "--title",
      "New plan",
    ]);
    expect(resolveIssueId).not.toHaveBeenCalled();
    expect(ensureWorkspaceLabel).not.toHaveBeenCalled();
    expect(createIssue).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("creates a new decision, links it `related` to the old, and closes the old", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "decision",
      "supersede",
      "ENG-1",
      "--title",
      "New plan",
      ...FULL_BODY,
    ]);

    expect(createIssue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        title: "New plan",
        labelIds: ["label-decision-uuid"],
      }),
    );
    expect(createIssueRelation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        issueId: "issue-new-uuid",
        relatedIssueId: "uuid-ENG-1",
        type: "related",
      }),
    );
    expect(updateIssue).toHaveBeenCalledWith(
      expect.anything(),
      "uuid-ENG-1",
      expect.objectContaining({ stateId: "state-completed" }),
    );
    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({
        superseded_identifier: "ENG-1",
        relation_created: true,
        closed: true,
      }),
      expect.any(Function),
      expect.anything(),
    );
  });
});
