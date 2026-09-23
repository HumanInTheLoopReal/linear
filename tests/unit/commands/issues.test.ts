import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock all external dependencies before importing the module under test
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

vi.mock("../../../src/resolvers/user-resolver.js", () => ({
  resolveUserId: vi.fn().mockResolvedValue("resolved-user-uuid"),
}));

vi.mock("../../../src/resolvers/team-resolver.js", () => ({
  resolveTeamId: vi.fn().mockResolvedValue("resolved-team-uuid"),
  resolveTeamEstimateContext: vi.fn().mockResolvedValue({
    teamId: "resolved-team-uuid",
    teamKey: "ENG",
    teamName: "Engineering",
    issueEstimationType: "fibonacci",
    issueEstimationExtended: false,
    issueEstimationAllowZero: false,
  }),
}));

vi.mock("../../../src/common/config-store.js", () => ({
  getDefaultTeam: vi.fn(() => null),
  // getConfig returns "not found" so resolveCreateValidationMode falls through
  // to its default ("error") — faithful to production. Create tests that
  // aren't exercising the gate pass `--no-validate`; the gate has its own
  // dedicated describe block that overrides this per-test.
  getConfig: vi.fn(() => ({
    key: "",
    value: null,
    found: false,
    source: "default",
  })),
  getDefaultTeamWithSource: vi.fn(() => ({ value: null, source: null })),
}));

vi.mock("../../../src/common/scope-filter.js", () => ({
  getActiveScope: vi.fn(() => ({})),
  buildScopeFragments: vi.fn(() => []),
  applyScopeToFilter: vi.fn((base: unknown) => base),
  resolveScopeOption: vi.fn((opt: unknown) => (opt === false ? undefined : {})),
}));

vi.mock("../../../src/resolvers/issue-resolver.js", () => ({
  resolveIssueId: vi.fn().mockResolvedValue("resolved-issue-uuid"),
  resolveIssueEstimateContext: vi.fn().mockResolvedValue({
    issueId: "resolved-issue-uuid",
    team: {
      teamId: "team-uuid",
      teamKey: "ENG",
      teamName: "Engineering",
      issueEstimationType: "linear",
      issueEstimationExtended: false,
      issueEstimationAllowZero: false,
    },
  }),
}));

vi.mock("../../../src/resolvers/project-resolver.js", () => ({
  resolveProjectId: vi.fn().mockResolvedValue("resolved-project-uuid"),
}));

vi.mock("../../../src/resolvers/label-resolver.js", () => ({
  findMissingLabelNames: vi.fn().mockResolvedValue([]),
  resolveLabelIds: vi.fn().mockResolvedValue(["resolved-label-uuid"]),
  resolveLabelId: vi.fn().mockResolvedValue("resolved-label-uuid"),
}));

vi.mock("../../../src/services/label-service.js", () => {
  const ensureWorkspaceLabel = vi.fn().mockResolvedValue("resolved-label-uuid");
  return {
    ensureWorkspaceLabel,
    ensureWorkspaceLabelIds: vi.fn(async (client: unknown, names: string[]) => {
      const ids: string[] = [];
      for (const raw of names) {
        const name = raw.trim();
        if (name.length === 0) continue;
        ids.push(await ensureWorkspaceLabel(client, name, `Label '${name}'.`));
      }
      return ids;
    }),
  };
});

vi.mock("../../../src/resolvers/milestone-resolver.js", () => ({
  resolveMilestoneId: vi.fn().mockResolvedValue("resolved-milestone-uuid"),
}));

vi.mock("../../../src/resolvers/cycle-resolver.js", () => ({
  resolveCycleId: vi.fn().mockResolvedValue("resolved-cycle-uuid"),
}));

vi.mock("../../../src/resolvers/status-resolver.js", () => ({
  resolveStatusId: vi.fn().mockResolvedValue("resolved-status-uuid"),
  resolveStateIdByType: vi.fn().mockResolvedValue("resolved-state-uuid"),
}));

vi.mock("../../../src/services/issue-service.js", () => ({
  appendNote: vi.fn().mockResolvedValue({
    id: "resolved-issue-uuid",
    identifier: "ENG-1",
    description: "## Notes\n\nfresh",
  }),
  archiveIssue: vi.fn().mockResolvedValue({ id: "resolved-issue-uuid" }),
  createIssue: vi.fn().mockResolvedValue({ id: "new-issue-id" }),
  deleteIssue: vi.fn().mockResolvedValue({
    id: "resolved-issue-uuid",
    identifier: "ENG-42",
    title: "An issue",
    success: true,
  }),
  updateIssue: vi.fn().mockResolvedValue({ id: "updated-issue-id" }),
  unarchiveIssue: vi.fn().mockResolvedValue({ id: "resolved-issue-uuid" }),
  getIssue: vi.fn().mockResolvedValue({
    id: "resolved-issue-uuid",
    team: { id: "team-uuid", key: "ENG" },
    project: { name: "My Project" },
    labels: { nodes: [] },
  }),
  getIssueByIdentifier: vi.fn(),
  getIssueWithComments: vi.fn().mockResolvedValue({
    id: "resolved-issue-uuid",
    comments: { nodes: [{ id: "comment-1", user: { displayName: "Ada" } }] },
  }),
  getIssueByIdentifierWithComments: vi.fn(),
  getIssueWithCommentThreads: vi.fn().mockResolvedValue({
    id: "resolved-issue-uuid",
    comments: {
      nodes: [{ id: "comment-1", replies: [{ id: "comment-2" }] }],
    },
  }),
  getIssueByIdentifierWithCommentThreads: vi.fn(),
  getIssueWithAttachments: vi.fn().mockResolvedValue({
    id: "resolved-issue-uuid",
    attachments: { nodes: [{ id: "att-1", title: "PR #42" }] },
  }),
  getIssueByIdentifierWithAttachments: vi.fn(),
  getIssueWithReactions: vi.fn().mockResolvedValue({
    id: "resolved-issue-uuid",
    reactions: [{ emoji: "👍", count: 1, users: [], reactionIds: ["r-1"] }],
  }),
  getIssueByIdentifierWithReactions: vi.fn().mockResolvedValue({
    id: "resolved-issue-uuid",
    reactions: [{ emoji: "👍", count: 1, users: [], reactionIds: ["r-1"] }],
  }),
  getCommentCountsByIssueIds: vi.fn().mockResolvedValue(new Map()),
  listIssues: vi
    .fn()
    .mockResolvedValue({ nodes: [], pageInfo: { hasNextPage: false } }),
  // The real searchIssues returns a PaginatedResult, not a bare array —
  // the meta layer (lin-hsjq) reads result.nodes/pageInfo, so the mock
  // must match that shape.
  searchIssues: vi
    .fn()
    .mockResolvedValue({ nodes: [], pageInfo: { hasNextPage: false } }),
}));

vi.mock("../../../src/services/comment-service.js", () => ({
  createComment: vi.fn().mockResolvedValue({ id: "comment-1" }),
}));

vi.mock("../../../src/services/issue-relation-service.js", () => {
  const listIssueRelations = vi.fn().mockResolvedValue([]);
  return {
    createIssueRelation: vi
      .fn()
      .mockResolvedValue({ id: "rel-uuid", type: "duplicate" }),
    deleteIssueRelation: vi.fn(),
    findIssueRelation: vi.fn(),
    listIssueRelations,
    findNewlyUnblockedByClose: vi.fn(
      async (client: unknown, closedIssueId: string) => {
        const dependents = await listIssueRelations(client, closedIssueId, {
          direction: "up",
          type: "blocks",
        });
        const freed = [];
        for (const dependent of dependents) {
          if (
            ["completed", "canceled", "duplicate"].includes(dependent.status)
          ) {
            continue;
          }
          const blockers = await listIssueRelations(
            client,
            dependent.issue_id,
            {
              direction: "down",
              type: "blocks",
            },
          );
          if (
            blockers.some(
              (blocker: { status: string }) =>
                !["completed", "canceled", "duplicate"].includes(
                  blocker.status,
                ),
            )
          ) {
            continue;
          }
          freed.push({
            identifier: dependent.identifier,
            title: dependent.title,
            priority: dependent.priority,
          });
        }
        return freed;
      },
    ),
  };
});

vi.mock("../../../src/services/epic-service.js", () => ({
  getEpicStatuses: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../../src/services/types-service.js", () => ({
  listTypes: vi.fn().mockResolvedValue({
    core_types: [{ name: "task", description: "General work item (default)" }],
    custom_types: ["research"],
  }),
}));

vi.mock("../../../src/services/status-service.js", () => ({
  listStatuses: vi.fn().mockResolvedValue({
    statuses: [
      {
        id: "s1",
        name: "Todo",
        type: "unstarted",
        category: "active",
        color: "#000",
        position: 1,
        team: { id: "team-uuid", key: "ENG", name: "Engineering" },
      },
    ],
  }),
}));

vi.mock("../../../src/services/stats-service.js", () => ({
  getStatus: vi.fn().mockResolvedValue({
    summary: {
      total_issues: 0,
      open_issues: 0,
      in_progress_issues: 0,
      blocked_issues: 0,
      deferred_issues: 0,
      closed_issues: 0,
      ready_issues: 0,
      pinned_issues: 0,
      epics_eligible_for_closure: 0,
      average_lead_time: 0,
    },
    recent_activity: null,
  }),
}));

vi.mock("../../../src/services/count-service.js", () => ({
  countMatching: vi.fn().mockResolvedValue({ count: 7 }),
  countMatchingGrouped: vi.fn().mockResolvedValue({
    total: 7,
    groups: [
      { group: "closed", count: 3 },
      { group: "open", count: 4 },
    ],
  }),
}));

vi.mock("../../../src/services/snapshot-service.js", () => ({
  writeSnapshot: vi.fn().mockResolvedValue({
    label: "v1",
    path: "/tmp/snap/v1.jsonl",
    meta: {
      label: "v1",
      created_at: "2026-05-12T00:00:00.000Z",
      issue_count: 0,
    },
  }),
  listSnapshots: vi.fn().mockReturnValue([]),
  loadSnapshotByRef: vi.fn().mockResolvedValue({ label: "v1", issues: [] }),
}));

vi.mock("../../../src/services/diff-service.js", () => ({
  computeDiff: vi.fn().mockReturnValue([]),
}));

vi.mock("../../../src/services/history-service.js", () => ({
  getIssueHistory: vi.fn().mockResolvedValue({
    issue: { id: "resolved-issue-uuid", identifier: "TES-1", title: "demo" },
    events: [],
    total: 0,
  }),
}));

vi.mock("../../../src/services/lint-service.js", async (importOriginal) => {
  // Keep the real `resolveRequiredSections` so the create-time gate resolves
  // its per-type contract exactly as in production; only the network/summary
  // helpers are stubbed.
  const actual =
    await importOriginal<
      typeof import("../../../src/services/lint-service.js")
    >();
  return {
    ...actual,
    fetchIssuesForLint: vi.fn().mockResolvedValue([
      {
        id: "i1",
        identifier: "T-1",
        title: "x",
        description: "",
        labels: { nodes: [] },
      },
    ]),
    getIssueForLint: vi.fn().mockResolvedValue({
      id: "i1",
      identifier: "T-1",
      title: "x",
      description: "",
      labels: { nodes: [] },
    }),
    buildLintSummary: vi.fn().mockReturnValue({
      total: 0,
      issues: 0,
      results: [],
    }),
  };
});

vi.mock("../../../src/services/capability-service.js", () => ({
  shipCapability: vi.fn().mockResolvedValue({
    status: "shipped",
    capability: "foo",
    issue_id: "issue-1",
    issue_identifier: "ENG-1",
    label: "provides:foo",
  }),
}));

vi.mock("../../../src/services/duplicate-detection-service.js", () => ({
  findDuplicateGroups: vi.fn().mockResolvedValue([]),
  fetchOpenIssuesForMerge: vi.fn().mockResolvedValue(new Map()),
  findMarkedDuplicates: vi.fn().mockReturnValue([]),
  mergeDuplicateGroup: vi.fn().mockResolvedValue({
    target: "ENG-1",
    sources: [],
    closed: [],
    linked: [],
    reparented: [],
    errors: [],
  }),
}));

vi.mock("../../../src/services/duplicate-similarity-service.js", () => ({
  AI_DEFAULT_MODEL: "claude-sonnet-4-5",
  runMechanicalDuplicateDetection: vi.fn().mockResolvedValue({
    pairs: [],
    count: 0,
    method: "mechanical",
    threshold: 0.5,
  }),
  runAIDuplicateDetection: vi.fn().mockResolvedValue({
    pairs: [],
    count: 0,
    method: "ai",
    threshold: 0.5,
    candidates_evaluated: 0,
    model: "claude-sonnet-4-5",
  }),
}));

vi.mock("../../../src/services/reaction-service.js", () => ({
  createReactionForIssue: vi.fn().mockResolvedValue({ id: "reaction-1" }),
  createReactionForComment: vi.fn().mockResolvedValue({ id: "reaction-1" }),
  deleteOwnReactionByEmoji: vi
    .fn()
    .mockResolvedValue({ id: "reaction-1", success: true }),
  deleteOwnReactionById: vi
    .fn()
    .mockResolvedValue({ id: "reaction-1", success: true }),
}));

vi.mock("../../../src/services/discussion-service.js", () => ({
  startIssueDiscussion: vi.fn().mockResolvedValue({ id: "discussion-root-1" }),
  listDiscussionsForIssue: vi.fn().mockResolvedValue({
    nodes: [],
    pageInfo: {
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: null,
      endCursor: null,
    },
  }),
  listDiscussionReplies: vi.fn().mockResolvedValue({
    nodes: [],
    pageInfo: {
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: null,
      endCursor: null,
    },
  }),
  listDiscussionsForIssueWithReactions: vi.fn().mockResolvedValue({
    nodes: [],
    pageInfo: {
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: null,
      endCursor: null,
    },
  }),
  listDiscussionRepliesWithReactions: vi.fn().mockResolvedValue({
    nodes: [],
    pageInfo: {
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: null,
      endCursor: null,
    },
  }),
  replyToDiscussion: vi.fn().mockResolvedValue({ id: "discussion-reply-1" }),
  editDiscussionReply: vi.fn().mockResolvedValue({ id: "discussion-reply-1" }),
  deleteDiscussionReply: vi.fn().mockResolvedValue({
    id: "discussion-reply-1",
    success: true,
  }),
  editDiscussionComment: vi
    .fn()
    .mockResolvedValue({ id: "discussion-comment-1" }),
  deleteDiscussionComment: vi.fn().mockResolvedValue({
    id: "discussion-comment-1",
    success: true,
  }),
  resolveDiscussion: vi.fn().mockResolvedValue({ id: "discussion-root-1" }),
  unresolveDiscussion: vi.fn().mockResolvedValue({ id: "discussion-root-1" }),
  createDiscussionCommentReaction: vi
    .fn()
    .mockResolvedValue({ id: "reaction-1" }),
  deleteDiscussionCommentReactionByEmoji: vi
    .fn()
    .mockResolvedValue({ id: "reaction-1", success: true }),
  deleteDiscussionCommentReactionById: vi
    .fn()
    .mockResolvedValue({ id: "reaction-1", success: true }),
}));

vi.mock("../../../src/services/next-service.js", () => ({
  listNextIssues: vi.fn().mockResolvedValue([]),
  claimReadyIssue: vi.fn().mockResolvedValue({
    id: "ready-uuid",
    identifier: "ENG-7",
    assignee_id: "viewer-uuid",
    state_id: "started-uuid",
  }),
}));

import { resolveCreateValidationMode } from "../../../src/commands/_create-validation.js";
import {
  assembleCreateDescription,
  formatClaimedNext,
  formatCreateDryRun,
  formatIssueCreate,
  formatIssueHistory,
  formatIssueList,
  formatNewlyUnblocked,
  normalizeIssueType,
  setupIssuesCommands,
  sortQueryResults,
} from "../../../src/commands/issues.js";
import { getConfig, getDefaultTeam } from "../../../src/common/config-store.js";
import { getRootOpts } from "../../../src/common/context.js";
import { outputResult, outputSuccess } from "../../../src/common/output.js";
import { validateCreateDescription } from "../../../src/common/required-sections.js";
import { resolveScopeOption } from "../../../src/common/scope-filter.js";
import {
  resolveIssueEstimateContext,
  resolveIssueId,
} from "../../../src/resolvers/issue-resolver.js";
import { findMissingLabelNames } from "../../../src/resolvers/label-resolver.js";
import { resolveProjectId } from "../../../src/resolvers/project-resolver.js";
import { resolveStateIdByType } from "../../../src/resolvers/status-resolver.js";
import {
  resolveTeamEstimateContext,
  resolveTeamId,
} from "../../../src/resolvers/team-resolver.js";
import { resolveUserId } from "../../../src/resolvers/user-resolver.js";
import { shipCapability } from "../../../src/services/capability-service.js";
import { createComment } from "../../../src/services/comment-service.js";
import {
  countMatching,
  countMatchingGrouped,
} from "../../../src/services/count-service.js";
import { computeDiff } from "../../../src/services/diff-service.js";
import {
  createDiscussionCommentReaction,
  deleteDiscussionComment,
  deleteDiscussionCommentReactionById,
  deleteDiscussionReply,
  editDiscussionComment,
  editDiscussionReply,
  listDiscussionReplies,
  listDiscussionRepliesWithReactions,
  listDiscussionsForIssue,
  listDiscussionsForIssueWithReactions,
  replyToDiscussion,
  resolveDiscussion,
  startIssueDiscussion,
  unresolveDiscussion,
} from "../../../src/services/discussion-service.js";
import {
  fetchOpenIssuesForMerge,
  findDuplicateGroups,
  mergeDuplicateGroup,
} from "../../../src/services/duplicate-detection-service.js";
import { runMechanicalDuplicateDetection } from "../../../src/services/duplicate-similarity-service.js";
import { getEpicStatuses } from "../../../src/services/epic-service.js";
import { getIssueHistory } from "../../../src/services/history-service.js";
import {
  createIssueRelation,
  listIssueRelations,
} from "../../../src/services/issue-relation-service.js";
import {
  appendNote,
  archiveIssue,
  createIssue,
  deleteIssue,
  getCommentCountsByIssueIds,
  getIssue,
  getIssueByIdentifier,
  getIssueByIdentifierWithAttachments,
  getIssueByIdentifierWithComments,
  getIssueByIdentifierWithCommentThreads,
  getIssueByIdentifierWithReactions,
  getIssueWithAttachments,
  getIssueWithComments,
  getIssueWithCommentThreads,
  getIssueWithReactions,
  listIssues,
  searchIssues,
  unarchiveIssue,
  updateIssue,
} from "../../../src/services/issue-service.js";
import {
  ensureWorkspaceLabel,
  ensureWorkspaceLabelIds,
} from "../../../src/services/label-service.js";
import {
  buildLintSummary,
  fetchIssuesForLint,
  getIssueForLint,
} from "../../../src/services/lint-service.js";
import {
  claimReadyIssue,
  listNextIssues,
} from "../../../src/services/next-service.js";
import {
  createReactionForIssue,
  deleteOwnReactionByEmoji,
  deleteOwnReactionById,
} from "../../../src/services/reaction-service.js";
import {
  listSnapshots,
  loadSnapshotByRef,
  writeSnapshot,
} from "../../../src/services/snapshot-service.js";
import { getStatus } from "../../../src/services/stats-service.js";
import { listStatuses } from "../../../src/services/status-service.js";
import { listTypes } from "../../../src/services/types-service.js";

function createProgram(): Command {
  const program = new Command();
  program.option("--api-token <token>");
  setupIssuesCommands(program);
  return program;
}

describe("issues create --assignee", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("resolves assignee name to UUID before creating issue", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "--no-validate",
      "Fix login bug",
      "--team",
      "ENG",
      "--assignee",
      "John Doe",
    ]);

    expect(resolveUserId).toHaveBeenCalledWith(expect.anything(), "John Doe");
    expect(createIssue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ assigneeId: "resolved-user-uuid" }),
    );
  });

  it("resolves assignee email to UUID before creating issue", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "--no-validate",
      "Fix login bug",
      "--team",
      "ENG",
      "--assignee",
      "john@example.com",
    ]);

    expect(resolveUserId).toHaveBeenCalledWith(
      expect.anything(),
      "john@example.com",
    );
    expect(createIssue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ assigneeId: "resolved-user-uuid" }),
    );
  });

  it("auto-assigns the creator (@me) by default when --assignee is omitted (lin-8yl1.4)", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "--no-validate",
      "Fix login bug",
      "--team",
      "ENG",
    ]);

    expect(resolveUserId).toHaveBeenCalledWith(expect.anything(), "@me");
    expect(createIssue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ assigneeId: "resolved-user-uuid" }),
    );
  });

  it("leaves the issue unassigned with --no-assign (lin-8yl1.4)", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "--no-validate",
      "Fix login bug",
      "--team",
      "ENG",
      "--no-assign",
    ]);

    expect(resolveUserId).not.toHaveBeenCalled();
    expect(createIssue).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({ assigneeId: expect.anything() }),
    );
  });

  it("an explicit --assignee overrides the @me default (lin-8yl1.4)", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "--no-validate",
      "Fix login bug",
      "--team",
      "ENG",
      "--assignee",
      "Jane Doe",
    ]);

    expect(resolveUserId).toHaveBeenCalledWith(expect.anything(), "Jane Doe");
    expect(resolveUserId).not.toHaveBeenCalledWith(expect.anything(), "@me");
  });
});

describe("issues create --labels auto-create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("ensures each named label exists on the workspace before referencing", async () => {
    vi.mocked(ensureWorkspaceLabel)
      .mockResolvedValueOnce("type-epic-uuid")
      .mockResolvedValueOnce("swarm-uuid");

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "--no-validate",
      "Coordinate rollout",
      "--team",
      "ENG",
      "--labels",
      "type:epic,swarm",
    ]);

    expect(ensureWorkspaceLabel).toHaveBeenCalledTimes(2);
    expect(ensureWorkspaceLabelIds).toHaveBeenCalledWith(expect.anything(), [
      "type:epic",
      "swarm",
    ]);
    expect(ensureWorkspaceLabel).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      "type:epic",
      "Label 'type:epic'.",
    );
    expect(ensureWorkspaceLabel).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "swarm",
      "Label 'swarm'.",
    );
    expect(createIssue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        labelIds: ["type-epic-uuid", "swarm-uuid"],
      }),
    );
  });

  it("does not call ensureWorkspaceLabel when --labels is omitted", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "--no-validate",
      "no labels here",
      "--team",
      "ENG",
    ]);

    expect(ensureWorkspaceLabel).not.toHaveBeenCalled();
  });
});

describe("issues create scope auto-tagging (Phase 4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("appends scope.label to labelIds when scope is active", async () => {
    vi.mocked(resolveScopeOption).mockReturnValueOnce({
      label: "git:linear-cli",
    });
    vi.mocked(ensureWorkspaceLabel).mockResolvedValueOnce("scope-label-uuid");

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "--no-validate",
      "scoped issue",
      "--team",
      "ENG",
    ]);

    expect(ensureWorkspaceLabel).toHaveBeenCalledWith(
      expect.anything(),
      "git:linear-cli",
      "Label 'git:linear-cli'.",
    );
    expect(createIssue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ labelIds: ["scope-label-uuid"] }),
    );
  });

  it("appends scope.label after user-provided labels", async () => {
    vi.mocked(resolveScopeOption).mockReturnValueOnce({
      label: "git:linear-cli",
    });
    vi.mocked(ensureWorkspaceLabel)
      .mockResolvedValueOnce("user-label-uuid")
      .mockResolvedValueOnce("scope-label-uuid");

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "--no-validate",
      "scoped issue",
      "--team",
      "ENG",
      "--labels",
      "bug",
    ]);

    expect(createIssue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        labelIds: ["user-label-uuid", "scope-label-uuid"],
      }),
    );
  });

  it("resolves scope.default_project before passing projectId", async () => {
    vi.mocked(resolveScopeOption).mockReturnValueOnce({
      project: "Roadmap",
    });

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "--no-validate",
      "project-defaulted",
      "--team",
      "ENG",
    ]);

    expect(resolveProjectId).toHaveBeenCalledWith(expect.anything(), "Roadmap");
    expect(createIssue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ projectId: "resolved-project-uuid" }),
    );
  });

  it("does not override user-provided --project with scope.project", async () => {
    vi.mocked(resolveScopeOption).mockReturnValueOnce({
      project: "scope-project-uuid",
    });

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "--no-validate",
      "user wins",
      "--team",
      "ENG",
      "--project",
      "explicit",
    ]);

    expect(createIssue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ projectId: "resolved-project-uuid" }),
    );
  });

  it("--no-scope bypasses scope.label and scope.project injection", async () => {
    vi.mocked(resolveScopeOption).mockReturnValueOnce(undefined);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "--no-validate",
      "firehose create",
      "--team",
      "ENG",
      "--no-scope",
    ]);

    expect(resolveScopeOption).toHaveBeenCalledWith(false);
    expect(createIssue).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({
        labelIds: expect.anything(),
        projectId: expect.anything(),
      }),
    );
  });

  it("dry-run includes the effective scope project and label without writes", async () => {
    vi.mocked(resolveScopeOption).mockReturnValueOnce({
      label: "git:linear-cli",
      project: "Roadmap",
    });
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "--no-validate",
      "scoped preview",
      "--team",
      "ENG",
      "--dry-run",
    ]);

    const preview = vi.mocked(outputResult).mock.calls[0][0] as {
      project: string | null;
      labels: string[];
    };
    expect(preview.project).toBe("Roadmap");
    expect(preview.labels).toContain("git:linear-cli");
    expect(resolveProjectId).not.toHaveBeenCalled();
    expect(ensureWorkspaceLabel).not.toHaveBeenCalled();
    expect(createIssue).not.toHaveBeenCalled();
  });

  it("dry-run reflects --scope label overrides", async () => {
    vi.mocked(resolveScopeOption).mockReturnValueOnce({ label: "git:other" });
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "--no-validate",
      "override preview",
      "--team",
      "ENG",
      "--dry-run",
      "--scope",
      "git:other",
    ]);

    const preview = vi.mocked(outputResult).mock.calls[0][0] as {
      labels: string[];
    };
    expect(resolveScopeOption).toHaveBeenCalledWith("git:other");
    expect(preview.labels).toContain("git:other");
    expect(ensureWorkspaceLabel).not.toHaveBeenCalled();
  });

  it("dry-run honors --no-scope", async () => {
    vi.mocked(resolveScopeOption).mockReturnValueOnce(undefined);
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "--no-validate",
      "unscoped preview",
      "--team",
      "ENG",
      "--dry-run",
      "--no-scope",
    ]);

    const preview = vi.mocked(outputResult).mock.calls[0][0] as {
      project: string | null;
      labels: string[];
    };
    expect(resolveScopeOption).toHaveBeenCalledWith(false);
    expect(preview.project).toBeNull();
    expect(preview.labels).toEqual([]);
  });
});

describe("issues create --estimate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("passes estimate as integer to createIssue", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "--no-validate",
      "Estimate test",
      "--team",
      "ENG",
      "--estimate",
      "5",
    ]);

    expect(createIssue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ estimate: 5 }),
    );
  });

  it("passes estimate 0 through to createIssue when team allows zero", async () => {
    vi.mocked(resolveTeamEstimateContext).mockResolvedValueOnce({
      teamId: "resolved-team-uuid",
      teamKey: "ENG",
      teamName: "Engineering",
      issueEstimationType: "fibonacci",
      issueEstimationExtended: false,
      issueEstimationAllowZero: true,
    });

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "--no-validate",
      "Zero estimate",
      "--team",
      "ENG",
      "--estimate",
      "0",
    ]);

    expect(createIssue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ estimate: 0 }),
    );
  });

  it("does not set estimate when --estimate is omitted", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "--no-validate",
      "No estimate",
      "--team",
      "ENG",
    ]);

    expect(createIssue).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({ estimate: expect.anything() }),
    );
  });

  it("rejects create estimate outside team scale before mutation", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "--no-validate",
      "Strict estimate",
      "--team",
      "ENG",
      "--estimate",
      "9",
    ]);

    const outOfScaleCreateError = JSON.parse(
      vi.mocked(console.error).mock.calls[0][0] as string,
    ) as { error: string };
    expect(outOfScaleCreateError.error).toBe(
      'Invalid --estimate: must be one of [1, 2, 3, 5, 8] for team "ENG" (fibonacci)',
    );
    expect(createIssue).not.toHaveBeenCalled();
  });

  it("rejects create estimate when team estimation disabled", async () => {
    vi.mocked(resolveTeamEstimateContext).mockResolvedValueOnce({
      teamId: "resolved-team-uuid",
      teamKey: "ENG",
      teamName: "Engineering",
      issueEstimationType: "notUsed",
      issueEstimationExtended: false,
      issueEstimationAllowZero: false,
    });

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "--no-validate",
      "Strict estimate",
      "--team",
      "ENG",
      "--estimate",
      "3",
    ]);

    const disabledEstimationCreateError = JSON.parse(
      vi.mocked(console.error).mock.calls[0][0] as string,
    ) as { error: string };
    expect(disabledEstimationCreateError.error).toBe(
      'Invalid --estimate: team "ENG" has estimates disabled (issueEstimationType=notUsed)',
    );
    expect(createIssue).not.toHaveBeenCalled();
  });
});

describe("issues create numeric option validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("rejects invalid --priority before resolver/service calls", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "--no-validate",
      "Invalid priority",
      "--team",
      "ENG",
      "--priority",
      "0",
    ]);

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "Invalid --priority: must be 1-4 (or P1-P4); Linear's 0 means 'No priority' and is set by omitting --priority",
      ),
    );
    expect(resolveTeamId).not.toHaveBeenCalled();
    expect(createIssue).not.toHaveBeenCalled();
  });

  it("rejects invalid --estimate before resolver/service calls", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "--no-validate",
      "Invalid estimate",
      "--team",
      "ENG",
      "--estimate",
      "-1",
    ]);

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "Invalid --estimate: must be a non-negative integer",
      ),
    );
    expect(resolveTeamId).not.toHaveBeenCalled();
    expect(createIssue).not.toHaveBeenCalled();
  });

  it("maps valid numeric create options into createIssue input", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "--no-validate",
      "Valid numbers",
      "--team",
      "ENG",
      "--priority",
      "2",
      "--estimate",
      "3",
    ]);

    expect(createIssue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ priority: 2, estimate: 3 }),
    );
  });
});

describe("issues create --due-date", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("passes dueDate in create input", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "--no-validate",
      "Fix login bug",
      "--team",
      "ENG",
      "--due-date",
      "2025-01-15",
    ]);

    expect(createIssue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ dueDate: "2025-01-15" }),
    );
  });

  it("does not include dueDate when --due-date is omitted", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "--no-validate",
      "Fix login bug",
      "--team",
      "ENG",
    ]);

    expect(createIssue).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({ dueDate: expect.anything() }),
    );
  });

  it("rejects invalid date format", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "--no-validate",
      "Fix login bug",
      "--team",
      "ENG",
      "--due-date",
      "not-a-date",
    ]);

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Invalid due date format"),
    );
  });
});

describe("issues update --estimate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("passes estimate as integer to updateIssue", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "update",
      "ENG-42",
      "--estimate",
      "3",
    ]);

    expect(updateIssue).toHaveBeenCalledWith(
      expect.anything(),
      "resolved-issue-uuid",
      expect.objectContaining({ estimate: 3 }),
    );
  });

  it("clears estimate with --clear-estimate", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "update",
      "ENG-42",
      "--clear-estimate",
    ]);

    expect(updateIssue).toHaveBeenCalledWith(
      expect.anything(),
      "resolved-issue-uuid",
      expect.objectContaining({ estimate: null }),
    );
  });

  it("rejects update estimate outside issue team scale before mutation", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "update",
      "ENG-42",
      "--estimate",
      "8",
    ]);

    const outOfScaleUpdateError = JSON.parse(
      vi.mocked(console.error).mock.calls[0][0] as string,
    ) as { error: string };
    expect(outOfScaleUpdateError.error).toBe(
      'Invalid --estimate: must be one of [1, 2, 3, 4, 5] for team "ENG" (linear)',
    );
    expect(updateIssue).not.toHaveBeenCalled();
  });

  it("uses issue estimate context resolver when --estimate is present", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "update",
      "ENG-42",
      "--estimate",
      "3",
    ]);

    expect(resolveIssueEstimateContext).toHaveBeenCalledWith(
      expect.anything(),
      "ENG-42",
    );
  });

  it("rejects --estimate and --clear-estimate together", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "update",
      "ENG-42",
      "--estimate",
      "5",
      "--clear-estimate",
    ]);

    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("rejects --estimate 0 and --clear-estimate together", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "update",
      "ENG-42",
      "--estimate",
      "0",
      "--clear-estimate",
    ]);

    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("skips scale validation when --clear-estimate is used", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "update",
      "ENG-42",
      "--clear-estimate",
    ]);

    expect(resolveIssueEstimateContext).not.toHaveBeenCalled();
    expect(updateIssue).toHaveBeenCalledWith(
      expect.anything(),
      "resolved-issue-uuid",
      expect.objectContaining({ estimate: null }),
    );
  });
});

describe("issues update section editors (lin-ov30.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  // Blank-line-separated bodies, matching the markdown replaceSection emits;
  // sections it doesn't touch are preserved verbatim, so the fixture must be
  // in that same normalized shape for the preservation assertions to hold.
  const EXISTING = [
    "## Context",
    "",
    "why",
    "",
    "## Acceptance Criteria",
    "",
    "old ac",
    "",
    "## Notes",
    "",
    "note one",
  ].join("\n");

  function mockExistingBody(description: string) {
    vi.mocked(getIssue).mockResolvedValueOnce({
      id: "resolved-issue-uuid",
      team: { id: "team-uuid", key: "ENG" },
      labels: { nodes: [] },
      description,
    } as unknown as Awaited<ReturnType<typeof getIssue>>);
  }

  it("replaces only the named section in the existing body, preserving siblings", async () => {
    mockExistingBody(EXISTING);
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "update",
      "ENG-42",
      "--acceptance",
      "new ac",
    ]);

    const input = vi.mocked(updateIssue).mock.calls[0][2] as {
      description: string;
    };
    expect(input.description).toContain("## Context\n\nwhy");
    expect(input.description).toContain("## Acceptance Criteria\n\nnew ac");
    expect(input.description).not.toContain("old ac");
    expect(input.description).toContain("## Notes\n\nnote one");
  });

  it("appends to the Notes section without discarding existing content", async () => {
    mockExistingBody(EXISTING);
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "update",
      "ENG-42",
      "--append-notes",
      "note two",
    ]);

    const input = vi.mocked(updateIssue).mock.calls[0][2] as {
      description: string;
    };
    expect(input.description).toContain("## Notes\n\nnote one\n\nnote two");
  });

  it("rejects --notes and --append-notes together", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "update",
      "ENG-42",
      "--notes",
      "a",
      "--append-notes",
      "b",
    ]);

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(updateIssue).not.toHaveBeenCalled();
  });

  it("splices sections into the NEW description when --description is also given (no fetch)", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "update",
      "ENG-42",
      "--description",
      "## Context\n\nfresh",
      "--acceptance",
      "done means X",
    ]);

    // A new description was supplied, so the existing body is never fetched.
    expect(getIssue).not.toHaveBeenCalled();
    const input = vi.mocked(updateIssue).mock.calls[0][2] as {
      description: string;
    };
    expect(input.description).toContain("## Context\n\nfresh");
    expect(input.description).toContain(
      "## Acceptance Criteria\n\ndone means X",
    );
  });

  it("applies multiple section editors in one call", async () => {
    mockExistingBody(EXISTING);
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "update",
      "ENG-42",
      "--context",
      "new ctx",
      "--test",
      "run vitest",
    ]);

    const input = vi.mocked(updateIssue).mock.calls[0][2] as {
      description: string;
    };
    expect(input.description).toContain("## Context\n\nnew ctx");
    expect(input.description).toContain("## Test Plan\n\nrun vitest");
    expect(input.description).toContain("## Acceptance Criteria\n\nold ac");
  });
});

describe("issues update numeric option validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("rejects invalid --priority before resolver/service calls", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "update",
      "ENG-42",
      "--priority",
      "5",
    ]);

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "Invalid --priority: must be 1-4 (or P1-P4); Linear's 0 means 'No priority' and is set by omitting --priority",
      ),
    );
    expect(resolveIssueId).not.toHaveBeenCalled();
    expect(updateIssue).not.toHaveBeenCalled();
  });

  it("rejects invalid --estimate before resolver/service calls", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "update",
      "ENG-42",
      "--estimate",
      "-1",
    ]);

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "Invalid --estimate: must be a non-negative integer",
      ),
    );
    expect(resolveIssueId).not.toHaveBeenCalled();
    expect(updateIssue).not.toHaveBeenCalled();
  });

  it("maps valid numeric update options into updateIssue input", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "update",
      "ENG-42",
      "--priority",
      "1",
      "--estimate",
      "5",
    ]);

    expect(updateIssue).toHaveBeenCalledWith(
      expect.anything(),
      "resolved-issue-uuid",
      expect.objectContaining({ priority: 1, estimate: 5 }),
    );
  });
});

describe("issues update --due-date", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("passes dueDate in update input", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "update",
      "ENG-42",
      "--due-date",
      "2025-02-01",
    ]);

    expect(updateIssue).toHaveBeenCalledWith(
      expect.anything(),
      "resolved-issue-uuid",
      expect.objectContaining({ dueDate: "2025-02-01" }),
    );
  });

  it("clears dueDate with --clear-due-date", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "update",
      "ENG-42",
      "--clear-due-date",
    ]);

    expect(updateIssue).toHaveBeenCalledWith(
      expect.anything(),
      "resolved-issue-uuid",
      expect.objectContaining({ dueDate: null }),
    );
  });

  it("throws when --due-date and --clear-due-date are both provided", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "update",
      "ENG-42",
      "--due-date",
      "2025-02-01",
      "--clear-due-date",
    ]);

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "Cannot use --due-date and --clear-due-date together",
      ),
    );
  });

  it("rejects invalid date format", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "update",
      "ENG-42",
      "--due-date",
      "2025-13-01",
    ]);

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Invalid due date"),
    );
  });
});

describe("issues list/search filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("passes resolved filters to issues list", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "list",
      "--team",
      "ENG",
      "--status",
      "Todo",
      "--limit",
      "10",
      "--after",
      "cursor-1",
    ]);

    expect(listIssues).toHaveBeenCalledWith(
      expect.anything(),
      { limit: 10, after: "cursor-1" },
      {
        and: [
          { team: { id: { eq: "resolved-team-uuid" } } },
          { state: { id: { in: ["resolved-status-uuid"] } } },
        ],
      },
      { includeArchived: undefined },
    );
  });

  // lin-pyzt: --status all is the documented escape hatch from the
  // default "hide completed + archived" behavior. It must reach the
  // service layer with includeArchived: true so archived issues come back.
  it("--status all forwards includeArchived: true to listIssues", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "list",
      "--status",
      "all",
    ]);

    expect(listIssues).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({}),
      expect.objectContaining({
        and: expect.arrayContaining([
          expect.objectContaining({
            state: {
              type: {
                in: expect.arrayContaining([
                  "completed",
                  "canceled",
                  "backlog",
                ]),
              },
            },
          }),
        ]),
      }),
      { includeArchived: true },
    );
  });

  it("passes resolved filters to issues search", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "search",
      "authentication bug",
      "--team",
      "ENG",
      "--status",
      "Todo",
      "--limit",
      "10",
    ]);

    expect(searchIssues).toHaveBeenCalledWith(
      expect.anything(),
      "authentication bug",
      { limit: 10, after: undefined },
      {
        and: [
          { team: { id: { eq: "resolved-team-uuid" } } },
          { state: { id: { in: ["resolved-status-uuid"] } } },
        ],
      },
    );
  });

  it("keeps issues list --query as a deprecated search compatibility path", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "list",
      "--query",
      "authentication bug",
      "--team",
      "ENG",
      "--status",
      "Todo",
      "--limit",
      "10",
      "--after",
      "cursor-1",
    ]);

    expect(searchIssues).toHaveBeenCalledWith(
      expect.anything(),
      "authentication bug",
      { limit: 10, after: "cursor-1" },
      {
        and: [
          { team: { id: { eq: "resolved-team-uuid" } } },
          { state: { id: { in: ["resolved-status-uuid"] } } },
        ],
      },
    );
    expect(listIssues).not.toHaveBeenCalled();
  });

  it("applies the default open-state filter before paginating list --query", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "list",
      "--query",
      "authentication bug",
      "--all-teams",
      "--limit",
      "10",
    ]);

    expect(searchIssues).toHaveBeenCalledWith(
      expect.anything(),
      "authentication bug",
      { limit: 10, after: undefined },
      {
        state: {
          type: { nin: ["completed", "canceled", "duplicate"] },
        },
      },
    );
  });

  it("renders terminal rows when an explicit status filter requests them", async () => {
    const closed = {
      id: "closed-uuid",
      identifier: "ENG-9",
      title: "Finished work",
      priority: 2,
      state: { id: "done", name: "Done", type: "completed" },
      labels: { nodes: [] },
    };
    vi.mocked(listIssues).mockResolvedValueOnce({
      nodes: [closed],
      pageInfo: { hasNextPage: false, endCursor: null },
    } as never);
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "issues",
      "list",
      "--team",
      "ENG",
      "--status",
      "Done",
    ]);

    const [payload, formatter] =
      vi.mocked(outputResult).mock.calls.at(-1) ?? [];
    expect(formatter?.(payload as never)).toContain("ENG-9");
  });

  // lin-5u3w: --defer-before/--defer-after narrows server-side to issues
  // carrying a `deferred-until:` label, then filters the resurface date
  // window client-side (Linear can't range-compare a label name).
  it("--defer-before narrows server-side and filters the resurface date client-side", async () => {
    function withLabels(id: string, ...names: string[]) {
      return {
        id,
        identifier: id,
        title: id,
        labels: { nodes: names.map((name) => ({ name })) },
      };
    }
    vi.mocked(listIssues).mockResolvedValueOnce({
      nodes: [
        withLabels("EN-1", "deferred", "deferred-until:2026-06-10"), // in window
        withLabels("EN-2", "deferred", "deferred-until:2026-09-01"), // too late
        withLabels("EN-3", "deferred"), // no date → excluded
      ] as never,
      pageInfo: { hasNextPage: false },
    });

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "list",
      "--team",
      "ENG",
      "--defer-before",
      "2026-07-01",
    ]);

    // Scans up to the cap with the deferred-until narrowing fragment ANDed.
    expect(listIssues).toHaveBeenCalledWith(
      expect.anything(),
      { limit: 250 },
      expect.objectContaining({
        and: expect.arrayContaining([
          { labels: { some: { name: { startsWith: "deferred-until:" } } } },
        ]),
      }),
      { includeArchived: undefined },
    );
    // Only the in-window issue survives the client-side filter.
    const arg = vi.mocked(outputResult).mock.calls[0][0] as {
      nodes: Array<{ identifier: string }>;
    };
    expect(arg.nodes.map((n) => n.identifier)).toEqual(["EN-1"]);
  });

  it("requires every label across repeated and comma-separated --label flags", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "list",
      "--all-teams",
      "--label",
      "type:bug",
      "--label",
      "area:cli,area:api",
    ]);

    expect(listIssues).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        and: [
          { labels: { some: { name: { eqIgnoreCase: "type:bug" } } } },
          { labels: { some: { name: { eqIgnoreCase: "area:cli" } } } },
          { labels: { some: { name: { eqIgnoreCase: "area:api" } } } },
        ],
      },
      { includeArchived: undefined },
    );
  });

  it("treats an unknown --label as an empty match with a stderr note", async () => {
    vi.mocked(findMissingLabelNames).mockResolvedValueOnce(["nope"]);
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "search",
      "login",
      "--all-teams",
      "--label",
      "nope",
    ]);

    expect(process.exit).not.toHaveBeenCalled();
    expect(searchIssues).toHaveBeenCalledWith(
      expect.anything(),
      "login",
      expect.anything(),
      { and: [{ labels: { some: { name: { eqIgnoreCase: "nope" } } } }] },
    );
    expect(console.error).toHaveBeenCalledWith(
      'Warning: label "nope" does not exist, so no issue matches --label nope',
    );
  });

  it("filters by --state-type server-side without --team", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "list",
      "--all-teams",
      "--state-type",
      "started,completed",
    ]);

    expect(listIssues).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { and: [{ state: { type: { in: ["started", "completed"] } } }] },
      { includeArchived: undefined },
    );
  });

  it("rejects an unknown --state-type before any request", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "list",
      "--state-type",
      "doing",
    ]);

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(listIssues).not.toHaveBeenCalled();
  });

  it("rejects an empty --defer-after/--defer-before window", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "list",
      "--defer-after",
      "2026-08-01",
      "--defer-before",
      "2026-07-01",
    ]);
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(listIssues).not.toHaveBeenCalled();
  });
});

// lin-hsjq: the additive JSON meta layer on paginated list verbs. nodes /
// pageInfo stay byte-identical; a meta sibling carries count / truncated /
// limit_applied / scope so an agent can tell a complete page from a
// truncated one.
describe("issues list/search/children meta layer (lin-hsjq)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    vi.mocked(getDefaultTeam).mockReturnValue(null);
  });

  it("list: attaches meta with count/limit_applied/scope, nodes preserved", async () => {
    vi.mocked(listIssues).mockResolvedValueOnce({
      nodes: [{ id: "i-1" }, { id: "i-2" }] as never,
      pageInfo: { hasNextPage: false } as never,
    });
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "list",
      "--team",
      "ENG",
      "--limit",
      "10",
    ]);

    const arg = vi.mocked(outputResult).mock.calls[0][0] as {
      nodes: unknown[];
      pageInfo: unknown;
      meta: Record<string, unknown>;
    };
    expect(arg.nodes).toHaveLength(2);
    expect(arg.pageInfo).toEqual({ hasNextPage: false });
    expect(arg.meta).toEqual({
      count: 2,
      truncated: false,
      limit_applied: 10,
      scope: { team: "ENG", project: null },
      agent_mode: false,
    });
  });

  it("list: meta.truncated mirrors pageInfo.hasNextPage", async () => {
    vi.mocked(listIssues).mockResolvedValueOnce({
      nodes: [{ id: "i-1" }] as never,
      pageInfo: { hasNextPage: true } as never,
    });
    const program = createProgram();
    await program.parseAsync(["node", "test", "issues", "list"]);

    const arg = vi.mocked(outputResult).mock.calls[0][0] as {
      meta: { truncated: boolean; scope: { team: string | null } };
    };
    expect(arg.meta.truncated).toBe(true);
    // No --team and getDefaultTeam() === null → scope.team null.
    expect(arg.meta.scope.team).toBeNull();
  });

  it("list: meta.scope.team reflects the resolved default team", async () => {
    vi.mocked(getDefaultTeam).mockReturnValue("TES");
    const program = createProgram();
    await program.parseAsync(["node", "test", "issues", "list"]);

    const arg = vi.mocked(outputResult).mock.calls[0][0] as {
      meta: { scope: { team: string | null } };
    };
    expect(arg.meta.scope.team).toBe("TES");
  });

  it("search: attaches meta with the search team scope", async () => {
    vi.mocked(searchIssues).mockResolvedValueOnce({
      nodes: [{ id: "s-1" }] as never,
      pageInfo: { hasNextPage: true } as never,
    });
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "search",
      "auth bug",
      "--team",
      "ENG",
      "--limit",
      "25",
    ]);

    const arg = vi.mocked(outputResult).mock.calls[0][0] as {
      meta: Record<string, unknown>;
    };
    expect(arg.meta).toEqual({
      count: 1,
      truncated: true,
      limit_applied: 25,
      scope: { team: "ENG", project: null },
      agent_mode: false,
    });
  });

  it("children --json: attaches meta (parent-scoped → null team/project)", async () => {
    vi.mocked(getRootOpts).mockReturnValueOnce({
      apiToken: "test-token",
      json: true,
    });
    vi.mocked(listIssues).mockResolvedValueOnce({
      nodes: [{ id: "c-1" }] as never,
      pageInfo: { hasNextPage: false } as never,
    });
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "children",
      "ENG-123",
      "--limit",
      "10",
    ]);

    const arg = vi.mocked(outputSuccess).mock.calls[0][0] as {
      nodes: unknown[];
      meta: Record<string, unknown>;
    };
    expect(arg.nodes).toHaveLength(1);
    expect(arg.meta).toEqual({
      count: 1,
      truncated: false,
      limit_applied: 10,
      scope: { team: null, project: null },
      agent_mode: false,
    });
  });
});

describe("issues list --with-comment-counts (lin-ov30.7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    vi.mocked(getDefaultTeam).mockReturnValue(null);
  });

  it("attaches a per-issue commentCount via ONE batched query (no N+1)", async () => {
    vi.mocked(listIssues).mockResolvedValueOnce({
      nodes: [
        { id: "i-1", identifier: "ENG-1" },
        { id: "i-2", identifier: "ENG-2" },
      ] as never,
      pageInfo: { hasNextPage: false } as never,
    });
    vi.mocked(getCommentCountsByIssueIds).mockResolvedValueOnce(
      new Map([
        ["i-1", 3],
        ["i-2", 0],
      ]),
    );

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "list",
      "--with-comment-counts",
    ]);

    // Exactly ONE batched count call over the page's ids — not one per issue.
    expect(getCommentCountsByIssueIds).toHaveBeenCalledTimes(1);
    expect(getCommentCountsByIssueIds).toHaveBeenCalledWith(expect.anything(), [
      "i-1",
      "i-2",
    ]);

    const arg = vi.mocked(outputResult).mock.calls[0][0] as {
      nodes: Array<{ id: string; commentCount?: number }>;
    };
    expect(arg.nodes[0].commentCount).toBe(3);
    expect(arg.nodes[1].commentCount).toBe(0);
  });

  it("does NOT fetch counts when the flag is absent", async () => {
    vi.mocked(listIssues).mockResolvedValueOnce({
      nodes: [{ id: "i-1", identifier: "ENG-1" }] as never,
      pageInfo: { hasNextPage: false } as never,
    });

    const program = createProgram();
    await program.parseAsync(["node", "test", "issues", "list"]);

    expect(getCommentCountsByIssueIds).not.toHaveBeenCalled();
    const arg = vi.mocked(outputResult).mock.calls[0][0] as {
      nodes: Array<{ commentCount?: number }>;
    };
    expect(arg.nodes[0].commentCount).toBeUndefined();
  });

  it("skips the count query for an empty page", async () => {
    vi.mocked(listIssues).mockResolvedValueOnce({
      nodes: [] as never,
      pageInfo: { hasNextPage: false } as never,
    });

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "list",
      "--with-comment-counts",
    ]);

    expect(getCommentCountsByIssueIds).not.toHaveBeenCalled();
  });
});

describe("formatIssueList comment counts (lin-ov30.7)", () => {
  it("renders a 💬N suffix when a row carries commentCount", () => {
    const out = formatIssueList({
      nodes: [
        {
          identifier: "ENG-1",
          title: "Has comments",
          priority: 2,
          state: { type: "backlog" },
          commentCount: 4,
        },
      ],
    });
    expect(out).toContain("💬4");
  });

  it("omits the suffix when commentCount is absent", () => {
    const out = formatIssueList({
      nodes: [
        {
          identifier: "ENG-1",
          title: "No counts",
          priority: 2,
          state: { type: "backlog" },
        },
      ],
    });
    expect(out).not.toContain("💬");
  });
});

describe("issues query --with-comment-counts (lin-ov30.8)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("enriches the query projection with commentCount via ONE batched query", async () => {
    vi.mocked(listIssues).mockResolvedValueOnce({
      nodes: [
        {
          id: "q-1",
          identifier: "ENG-1",
          title: "A",
          priority: 2,
          state: { type: "backlog" },
        },
        {
          id: "q-2",
          identifier: "ENG-2",
          title: "B",
          priority: 2,
          state: { type: "backlog" },
        },
      ] as never,
      pageInfo: { hasNextPage: false } as never,
    });
    vi.mocked(getCommentCountsByIssueIds).mockResolvedValueOnce(
      new Map([
        ["q-1", 5],
        ["q-2", 0],
      ]),
    );

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "query",
      "status=open",
      "--with-comment-counts",
    ]);

    // ONE batched count call over the final result set (no N+1).
    expect(getCommentCountsByIssueIds).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(outputResult).mock.calls[0][0] as {
      nodes: Array<{ id: string; commentCount?: number }>;
    };
    const q1 = arg.nodes.find((n) => n.id === "q-1");
    const q2 = arg.nodes.find((n) => n.id === "q-2");
    expect(q1?.commentCount).toBe(5);
    expect(q2?.commentCount).toBe(0);
  });

  it("leaves the projection unchanged without the flag", async () => {
    vi.mocked(listIssues).mockResolvedValueOnce({
      nodes: [
        {
          id: "q-1",
          identifier: "ENG-1",
          title: "A",
          priority: 2,
          state: { type: "backlog" },
        },
      ] as never,
      pageInfo: { hasNextPage: false } as never,
    });

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "query",
      "status=open",
    ]);

    expect(getCommentCountsByIssueIds).not.toHaveBeenCalled();
    const arg = vi.mocked(outputResult).mock.calls[0][0] as {
      nodes: Array<{ commentCount?: number }>;
    };
    expect(arg.nodes[0].commentCount).toBeUndefined();
  });
});

describe("issues children", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("text path: fetches the parent then BFS-walks descendants under its identifier", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "issues", "children", "ENG-123"]);

    // Step 1: parent is fetched for the tree root.
    expect(getIssue).toHaveBeenCalledWith(
      expect.anything(),
      "resolved-issue-uuid",
    );
    // Step 2: BFS starts with the parent's id and uses a fixed page size of
    // 250 (per-level fetch cap), independent of the user-facing --limit
    // which caps total collected rows.
    expect(listIssues).toHaveBeenCalledWith(
      expect.anything(),
      { limit: 250 },
      { and: [{ parent: { id: { eq: "resolved-issue-uuid" } } }] },
      { includeClosed: true },
    );
  });

  it("--json path: preserves the legacy PaginatedResult of direct children with --limit/--after honored", async () => {
    vi.mocked(getRootOpts).mockReturnValueOnce({
      apiToken: "test-token",
      json: true,
    });
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "children",
      "ENG-123",
      "--limit",
      "10",
      "--after",
      "cursor-1",
    ]);

    // JSON path skips the parent fetch and walks no descendants — just one
    // direct-children listIssues call with the user's pagination flags.
    expect(getIssue).not.toHaveBeenCalled();
    expect(listIssues).toHaveBeenCalledWith(
      expect.anything(),
      { limit: 10, after: "cursor-1" },
      { and: [{ parent: { id: { eq: "resolved-issue-uuid" } } }] },
      { includeClosed: true },
    );
  });
});

describe("issues stale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    // Some tests below queue getDefaultTeam.mockReturnValueOnce("TES") to
    // assert that an explicit --team / --all-teams short-circuits the default.
    // Those paths never call getDefaultTeam, so the queued value is left
    // unconsumed — and vi.clearAllMocks() does NOT drain a mockReturnValueOnce
    // queue. Without this reset the leftovers leak into later describe blocks
    // (epic-status, close-eligible-epics), making them resolve a phantom team.
    // Drain the queue and restore the null baseline here. (lin-muz6)
    vi.mocked(getDefaultTeam).mockReset();
    vi.mocked(getDefaultTeam).mockReturnValue(null);
  });

  it("defaults to 30 days and excludes every closed state type", async () => {
    const now = new Date("2026-05-11T00:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const program = createProgram();
    await program.parseAsync(["node", "test", "issues", "stale"]);

    const cutoff = new Date(now.getTime() - 30 * 86_400_000).toISOString();

    expect(listIssues).toHaveBeenCalledWith(
      expect.anything(),
      { limit: 50 },
      {
        and: [
          {
            state: {
              type: { nin: ["completed", "canceled", "duplicate"] },
            },
          },
          { updatedAt: { lt: cutoff } },
        ],
      },
    );

    vi.useRealTimers();
  });

  it("maps --status open to the canonical to-do state types", async () => {
    const now = new Date("2026-05-11T00:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "stale",
      "--status",
      "open",
      "--days",
      "7",
      "--limit",
      "10",
    ]);

    const cutoff = new Date(now.getTime() - 7 * 86_400_000).toISOString();

    expect(listIssues).toHaveBeenCalledWith(
      expect.anything(),
      { limit: 10 },
      {
        and: [
          {
            state: {
              type: { in: ["triage", "backlog", "unstarted"] },
            },
          },
          { updatedAt: { lt: cutoff } },
        ],
      },
    );

    vi.useRealTimers();
  });

  it("rejects status filters that have no Linear state type analog", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "stale",
      "--status",
      "blocked",
    ]);

    expect(listIssues).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  // lin-zp6j: hygiene command must not silently leak across teams.
  it("scopes to team.default when no --team is given (lin-zp6j)", async () => {
    vi.mocked(getDefaultTeam).mockReturnValueOnce("TES");

    const program = createProgram();
    await program.parseAsync(["node", "test", "issues", "stale"]);

    expect(resolveTeamId).toHaveBeenCalledWith(expect.anything(), "TES");
    expect(listIssues).toHaveBeenCalledWith(
      expect.anything(),
      { limit: 50 },
      expect.objectContaining({
        and: expect.arrayContaining([
          { team: { id: { eq: "resolved-team-uuid" } } },
        ]),
      }),
    );
  });

  it("uses --team override even when team.default is set", async () => {
    vi.mocked(getDefaultTeam).mockReturnValueOnce("TES");

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "stale",
      "--team",
      "ENG",
    ]);

    expect(resolveTeamId).toHaveBeenCalledWith(expect.anything(), "ENG");
  });

  it("--all-teams ignores team.default (no team filter applied)", async () => {
    vi.mocked(getDefaultTeam).mockReturnValueOnce("TES");

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "stale",
      "--all-teams",
    ]);

    expect(resolveTeamId).not.toHaveBeenCalled();
    expect(listIssues).toHaveBeenCalledWith(
      expect.anything(),
      { limit: 50 },
      expect.not.objectContaining({
        team: expect.anything(),
      }),
    );
  });
});

describe("issues close", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("sets state to completed for the issue's team", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "issues", "close", "ENG-1"]);

    expect(resolveStateIdByType).toHaveBeenCalledWith(
      expect.anything(),
      "team-uuid",
      "completed",
    );
    expect(updateIssue).toHaveBeenCalledWith(
      expect.anything(),
      "resolved-issue-uuid",
      { stateId: "resolved-state-uuid" },
    );
    expect(createComment).not.toHaveBeenCalled();
  });

  it("posts the reason as a comment before transitioning state", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "close",
      "ENG-1",
      "--reason",
      "Shipped via PR #42",
    ]);

    expect(createComment).toHaveBeenCalledWith(expect.anything(), {
      issueId: "resolved-issue-uuid",
      body: "Shipped via PR #42",
    });
    expect(updateIssue).toHaveBeenCalledWith(
      expect.anything(),
      "resolved-issue-uuid",
      { stateId: "resolved-state-uuid" },
    );
  });

  it("rejects when no issue IDs are provided", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "issues", "close"]);

    expect(updateIssue).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("--suggest-next reports a dependent freed by the close (lin-ov30.5)", async () => {
    // 1st relations call = dependents of the closed issue (it blocks ENG-2);
    // 2nd = ENG-2's blockers, all now closed → ENG-2 is freed.
    vi.mocked(listIssueRelations)
      .mockResolvedValueOnce([
        {
          relation_id: "r1",
          type: "blocks",
          direction: "up",
          issue_id: "dep-uuid",
          identifier: "ENG-2",
          title: "Dependent",
          priority: 2,
          status: "backlog",
          state_name: "Backlog",
        },
      ])
      .mockResolvedValueOnce([
        {
          relation_id: "r1",
          type: "blocks",
          direction: "down",
          issue_id: "updated-issue-id",
          identifier: "ENG-1",
          title: "Blocker",
          priority: 1,
          status: "completed",
          state_name: "Done",
        },
      ]);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "close",
      "ENG-1",
      "--suggest-next",
    ]);

    const envelope = vi.mocked(outputResult).mock.calls[0][0] as {
      closed: unknown[];
      unblocked: Array<{ identifier: string }>;
    };
    expect(envelope.unblocked).toHaveLength(1);
    expect(envelope.unblocked[0].identifier).toBe("ENG-2");
  });

  it("--suggest-next omits a dependent still blocked by another open issue", async () => {
    vi.mocked(listIssueRelations)
      .mockResolvedValueOnce([
        {
          relation_id: "r1",
          type: "blocks",
          direction: "up",
          issue_id: "dep-uuid",
          identifier: "ENG-2",
          title: "Dependent",
          priority: 2,
          status: "backlog",
          state_name: "Backlog",
        },
      ])
      .mockResolvedValueOnce([
        // The just-closed blocker is done...
        {
          relation_id: "r1",
          type: "blocks",
          direction: "down",
          issue_id: "updated-issue-id",
          identifier: "ENG-1",
          title: "Blocker",
          priority: 1,
          status: "completed",
          state_name: "Done",
        },
        // ...but another blocker is still open, so ENG-2 is NOT freed.
        {
          relation_id: "r2",
          type: "blocks",
          direction: "down",
          issue_id: "other-uuid",
          identifier: "ENG-9",
          title: "Other blocker",
          priority: 2,
          status: "started",
          state_name: "In Progress",
        },
      ]);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "close",
      "ENG-1",
      "--suggest-next",
    ]);

    // Nothing freed → falls back to the plain close output (an array).
    const arg = vi.mocked(outputResult).mock.calls[0][0];
    expect(Array.isArray(arg)).toBe(true);
  });

  it("--suggest-next rejects closing more than one issue", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "close",
      "ENG-1",
      "ENG-2",
      "--suggest-next",
    ]);

    expect(updateIssue).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("--claim-next claims the next ready issue and reports it (lin-ov30.6)", async () => {
    vi.mocked(listNextIssues).mockResolvedValueOnce([
      {
        id: "ready-uuid",
        identifier: "ENG-7",
        title: "Next ready",
        priority: 1,
        team: { id: "team-uuid" },
      } as never,
    ]);
    vi.mocked(claimReadyIssue).mockResolvedValueOnce({
      id: "ready-uuid",
      identifier: "ENG-7",
      assignee_id: "viewer-uuid",
      state_id: "started-uuid",
    });

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "close",
      "ENG-1",
      "--claim-next",
    ]);

    // Workspace-wide, single highest-priority ready candidate.
    expect(listNextIssues).toHaveBeenCalledWith(expect.anything(), {
      limit: 1,
    });
    // Started state is resolved against the CLAIMED issue's team.
    expect(resolveStateIdByType).toHaveBeenCalledWith(
      expect.anything(),
      "team-uuid",
      "started",
    );
    expect(claimReadyIssue).toHaveBeenCalled();

    const envelope = vi.mocked(outputResult).mock.calls[0][0] as {
      closed: unknown[];
      claimed?: { identifier: string; priority: number };
    };
    expect(envelope.claimed?.identifier).toBe("ENG-7");
    expect(envelope.claimed?.priority).toBe(1);
  });

  it("--claim-next leaves a plain closed array when no ready work remains", async () => {
    vi.mocked(listNextIssues).mockResolvedValueOnce([]);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "close",
      "ENG-1",
      "--claim-next",
    ]);

    // Nothing to claim → no claim attempt, JSON stays the plain closed array.
    expect(claimReadyIssue).not.toHaveBeenCalled();
    const arg = vi.mocked(outputResult).mock.calls[0][0];
    expect(Array.isArray(arg)).toBe(true);
  });

  it("--claim-next is allowed when closing multiple issues (no single-issue limit)", async () => {
    vi.mocked(listNextIssues).mockResolvedValueOnce([]);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "close",
      "ENG-1",
      "ENG-2",
      "--claim-next",
    ]);

    // Unlike --suggest-next, claim-next has no single-issue restriction.
    expect(process.exit).not.toHaveBeenCalledWith(1);
    expect(updateIssue).toHaveBeenCalled();
  });
});

describe("formatNewlyUnblocked (lin-ov30.5)", () => {
  it("renders a `• <id> — <title> (P<n>)` bullet per freed dependent", () => {
    const out = formatNewlyUnblocked([
      { identifier: "ENG-2", title: "Dependent", priority: 2 },
    ]);
    expect(out).toContain("Newly unblocked:");
    expect(out).toContain("• ENG-2 — Dependent (P2)");
  });

  it("is empty when nothing was freed", () => {
    expect(formatNewlyUnblocked([])).toBe("");
  });
});

describe("formatClaimedNext (lin-ov30.6)", () => {
  it("renders the auto-claimed line with id, title and priority", () => {
    const out = formatClaimedNext({
      id: "ready-uuid",
      identifier: "ENG-7",
      title: "Next ready",
      priority: 1,
      assignee_id: "viewer-uuid",
      state_id: "started-uuid",
    });
    expect(out).toContain(
      "Auto-claimed next ready issue: ENG-7 — Next ready (P1)",
    );
  });

  it("renders the empty-queue notice when nothing was claimed", () => {
    expect(formatClaimedNext(null)).toContain(
      "No ready issues available to claim.",
    );
  });
});

describe("issues reopen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("sets state to unstarted for the issue's team", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "issues", "reopen", "ENG-1"]);

    expect(resolveStateIdByType).toHaveBeenCalledWith(
      expect.anything(),
      "team-uuid",
      "unstarted",
    );
    expect(updateIssue).toHaveBeenCalledWith(
      expect.anything(),
      "resolved-issue-uuid",
      { stateId: "resolved-state-uuid" },
    );
  });
});

describe("issues rename", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("updates only the title of the resolved issue", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "rename",
      "ENG-1",
      "New title",
    ]);

    expect(resolveIssueId).toHaveBeenCalledWith(expect.anything(), "ENG-1");
    expect(updateIssue).toHaveBeenCalledWith(
      expect.anything(),
      "resolved-issue-uuid",
      { title: "New title" },
    );
  });
});

describe("issues tag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("appends a new label to the existing label set", async () => {
    vi.mocked(getIssue).mockResolvedValueOnce({
      id: "resolved-issue-uuid",
      labels: { nodes: [{ id: "existing-label-uuid" }] },
    } as never);

    const program = createProgram();
    await program.parseAsync(["node", "test", "issues", "tag", "ENG-1", "bug"]);

    expect(ensureWorkspaceLabel).toHaveBeenCalledWith(
      expect.anything(),
      "bug",
      "Label 'bug'.",
    );
    expect(updateIssue).toHaveBeenCalledWith(
      expect.anything(),
      "resolved-issue-uuid",
      { labelIds: ["existing-label-uuid", "resolved-label-uuid"] },
    );
  });

  it("auto-creates a label that does not yet exist on the workspace", async () => {
    vi.mocked(getIssue).mockResolvedValueOnce({
      id: "resolved-issue-uuid",
      labels: { nodes: [] },
    } as never);
    vi.mocked(ensureWorkspaceLabel).mockResolvedValueOnce("created-label-uuid");

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "tag",
      "ENG-1",
      "type:epic",
    ]);

    expect(ensureWorkspaceLabel).toHaveBeenCalledWith(
      expect.anything(),
      "type:epic",
      "Label 'type:epic'.",
    );
    expect(updateIssue).toHaveBeenCalledWith(
      expect.anything(),
      "resolved-issue-uuid",
      { labelIds: ["created-label-uuid"] },
    );
  });

  it("does not duplicate when label is already on the issue", async () => {
    vi.mocked(getIssue).mockResolvedValueOnce({
      id: "resolved-issue-uuid",
      labels: { nodes: [{ id: "resolved-label-uuid" }] },
    } as never);

    const program = createProgram();
    await program.parseAsync(["node", "test", "issues", "tag", "ENG-1", "bug"]);

    expect(updateIssue).toHaveBeenCalledWith(
      expect.anything(),
      "resolved-issue-uuid",
      { labelIds: ["resolved-label-uuid"] },
    );
  });
});

describe("issues create/update --external-ref (lin-qev5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("create stores --external-ref as a queryable ref:<value> label", async () => {
    vi.mocked(ensureWorkspaceLabel).mockResolvedValueOnce("ref-label-uuid");
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "--no-validate",
      "Sync from GH",
      "--team",
      "ENG",
      "--external-ref",
      "gh-123",
    ]);

    expect(ensureWorkspaceLabel).toHaveBeenCalledWith(
      expect.anything(),
      "ref:gh-123",
      expect.any(String),
    );
    expect(createIssue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        labelIds: expect.arrayContaining(["ref-label-uuid"]),
      }),
    );
  });

  it("create --dry-run previews the ref label without creating it or any label", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "--no-validate",
      "--dry-run",
      "Sync",
      "--team",
      "ENG",
      "--external-ref",
      "jira-9",
    ]);

    expect(ensureWorkspaceLabel).not.toHaveBeenCalled();
    expect(createIssue).not.toHaveBeenCalled();
  });

  it("update --external-ref replaces a prior ref label and preserves the rest", async () => {
    vi.mocked(getIssue).mockResolvedValueOnce({
      id: "resolved-issue-uuid",
      team: { id: "team-uuid", key: "ENG" },
      labels: {
        nodes: [
          { id: "keep-uuid", name: "type:bug" },
          { id: "old-ref-uuid", name: "ref:gh-1" },
        ],
      },
    } as never);
    vi.mocked(ensureWorkspaceLabel).mockResolvedValueOnce("new-ref-uuid");

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "update",
      "ENG-1",
      "--external-ref",
      "gh-2",
    ]);

    expect(ensureWorkspaceLabel).toHaveBeenCalledWith(
      expect.anything(),
      "ref:gh-2",
      expect.any(String),
    );
    expect(updateIssue).toHaveBeenCalledWith(
      expect.anything(),
      "resolved-issue-uuid",
      expect.objectContaining({ labelIds: ["keep-uuid", "new-ref-uuid"] }),
    );
  });

  it("update --clear-external-ref strips ref labels but keeps the rest", async () => {
    vi.mocked(getIssue).mockResolvedValueOnce({
      id: "resolved-issue-uuid",
      team: { id: "team-uuid", key: "ENG" },
      labels: {
        nodes: [
          { id: "keep-uuid", name: "area:api" },
          { id: "old-ref-uuid", name: "ref:gh-1" },
        ],
      },
    } as never);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "update",
      "ENG-1",
      "--clear-external-ref",
    ]);

    expect(updateIssue).toHaveBeenCalledWith(
      expect.anything(),
      "resolved-issue-uuid",
      expect.objectContaining({ labelIds: ["keep-uuid"] }),
    );
  });

  it("rejects --external-ref combined with --labels", async () => {
    let captured: unknown;
    vi.spyOn(console, "error").mockImplementation((m) => {
      captured = m;
    });
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "update",
      "ENG-1",
      "--external-ref",
      "gh-1",
      "--labels",
      "bug",
    ]);

    expect(updateIssue).not.toHaveBeenCalled();
    expect(String(captured)).toMatch(/cannot be combined with --labels/);
  });
});

describe("issues create/update --metadata (lin-e64s)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("create appends --metadata as a fenced block after the body", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "--no-validate",
      "Synced",
      "--team",
      "ENG",
      "--description",
      "Body text",
      "--metadata",
      '{"run_id":"abc"}',
    ]);
    const input = vi.mocked(createIssue).mock.calls[0][1] as {
      description?: string;
    };
    expect(input.description).toContain("Body text");
    expect(input.description).toContain("```metadata");
    expect(input.description).toContain('"run_id": "abc"');
  });

  it("create rejects invalid --metadata JSON before any network call", async () => {
    let captured: unknown;
    vi.spyOn(console, "error").mockImplementation((m) => {
      captured = m;
    });
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "--no-validate",
      "X",
      "--team",
      "ENG",
      "--metadata",
      "{bad",
    ]);
    expect(createIssue).not.toHaveBeenCalled();
    expect(String(captured)).toMatch(/must be valid JSON/);
  });

  it("create --dry-run previews parsed metadata without creating", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "--no-validate",
      "--dry-run",
      "X",
      "--team",
      "ENG",
      "--metadata",
      '{"k":1}',
    ]);
    expect(createIssue).not.toHaveBeenCalled();
    const preview = vi.mocked(outputResult).mock.calls[0][0] as {
      metadata?: unknown;
    };
    expect(preview.metadata).toEqual({ k: 1 });
  });

  it("create --defer --dry-run previews the deferred labels without creating (lin-ov30.4)", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "--no-validate",
      "--dry-run",
      "Later",
      "--team",
      "ENG",
      "--defer",
      "2026-12-31",
    ]);

    expect(createIssue).not.toHaveBeenCalled();
    expect(ensureWorkspaceLabel).not.toHaveBeenCalled();
    const preview = vi.mocked(outputResult).mock.calls[0][0] as {
      labels: string[];
    };
    expect(preview.labels).toContain("deferred");
    expect(preview.labels).toContain("deferred-until:2026-12-31");
  });

  it("create --defer attaches both deferred labels at creation (lin-ov30.4)", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "--no-validate",
      "Later",
      "--team",
      "ENG",
      "--defer",
      "2026-12-31",
    ]);

    expect(ensureWorkspaceLabel).toHaveBeenCalledWith(
      expect.anything(),
      "deferred",
      expect.any(String),
    );
    expect(ensureWorkspaceLabel).toHaveBeenCalledWith(
      expect.anything(),
      "deferred-until:2026-12-31",
      expect.any(String),
    );
    expect(createIssue).toHaveBeenCalledTimes(1);
  });

  it("create --defer rejects an unparseable resurface date (lin-ov30.4)", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "--no-validate",
      "Later",
      "--team",
      "ENG",
      "--defer",
      "someday",
    ]);

    expect(createIssue).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("update --metadata merges into the existing block", async () => {
    vi.mocked(getIssue).mockResolvedValueOnce({
      id: "resolved-issue-uuid",
      team: { id: "team-uuid", key: "ENG" },
      description: 'Body\n\n```metadata\n{\n  "a": 1\n}\n```',
      labels: { nodes: [] },
    } as never);
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "update",
      "ENG-1",
      "--metadata",
      '{"b":2}',
    ]);
    const input = vi.mocked(updateIssue).mock.calls[0][2] as {
      description?: string;
    };
    expect(input.description).toContain('"a": 1');
    expect(input.description).toContain('"b": 2');
  });

  it("update --set-metadata / --unset-metadata edit keys (JSON-coerced)", async () => {
    vi.mocked(getIssue).mockResolvedValueOnce({
      id: "resolved-issue-uuid",
      team: { id: "team-uuid", key: "ENG" },
      description: 'Body\n\n```metadata\n{\n  "old": true\n}\n```',
      labels: { nodes: [] },
    } as never);
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "update",
      "ENG-1",
      "--set-metadata",
      "count=5",
      "--unset-metadata",
      "old",
    ]);
    const input = vi.mocked(updateIssue).mock.calls[0][2] as {
      description?: string;
    };
    expect(input.description).toContain('"count": 5');
    expect(input.description).not.toContain('"old"');
  });

  it("rejects combining --metadata with --set-metadata", async () => {
    let captured: unknown;
    vi.spyOn(console, "error").mockImplementation((m) => {
      captured = m;
    });
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "update",
      "ENG-1",
      "--metadata",
      '{"a":1}',
      "--set-metadata",
      "b=2",
    ]);
    expect(updateIssue).not.toHaveBeenCalled();
    expect(String(captured)).toMatch(/cannot combine --metadata/);
  });

  it("read surfaces a parsed metadata field for --json consumers", async () => {
    vi.mocked(getIssue).mockResolvedValueOnce({
      id: "resolved-issue-uuid",
      identifier: "ENG-1",
      description: 'Body\n\n```metadata\n{\n  "run_id": "xyz"\n}\n```',
    } as never);
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "read",
      "00000000-0000-0000-0000-000000000000",
    ]);
    const surfaced = vi.mocked(outputResult).mock.calls[0][0] as {
      metadata?: unknown;
    };
    expect(surfaced.metadata).toEqual({ run_id: "xyz" });
  });
});

describe("issues epic-status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("scans the whole workspace when --team is omitted", async () => {
    vi.mocked(getEpicStatuses).mockResolvedValueOnce([
      {
        epic: {
          id: "epic-uuid",
          identifier: "ENG-1",
          title: "E",
          priority: 2,
          state: { id: "s", name: "Backlog", type: "backlog" },
          team: { id: "team-uuid", key: "ENG", name: "Eng" },
        },
        total_children: 3,
        closed_children: 1,
        eligible_for_close: false,
      },
    ]);

    const program = createProgram();
    await program.parseAsync(["node", "test", "issues", "epic-status"]);

    expect(getEpicStatuses).toHaveBeenCalledWith(expect.anything(), {
      teamId: undefined,
      eligibleOnly: false,
    });
    expect(resolveTeamId).not.toHaveBeenCalled();
  });

  it("resolves --team and forwards --eligible-only", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "epic-status",
      "--team",
      "ENG",
      "--eligible-only",
    ]);

    expect(resolveTeamId).toHaveBeenCalledWith(expect.anything(), "ENG");
    expect(getEpicStatuses).toHaveBeenCalledWith(expect.anything(), {
      teamId: "resolved-team-uuid",
      eligibleOnly: true,
    });
  });
});

describe("issues close-eligible-epics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("--dry-run does not close anything", async () => {
    vi.mocked(getEpicStatuses).mockResolvedValueOnce([
      {
        epic: {
          id: "epic-uuid",
          identifier: "ENG-9",
          title: "Eligible",
          priority: 2,
          state: { id: "s", name: "Backlog", type: "backlog" },
          team: { id: "team-uuid", key: "ENG", name: "Eng" },
        },
        total_children: 2,
        closed_children: 2,
        eligible_for_close: true,
      },
    ]);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "close-eligible-epics",
      "--dry-run",
    ]);

    expect(getEpicStatuses).toHaveBeenCalledWith(expect.anything(), {
      teamId: undefined,
      eligibleOnly: true,
    });
    expect(updateIssue).not.toHaveBeenCalled();
    expect(resolveStateIdByType).not.toHaveBeenCalled();
  });

  it("closes each eligible epic with the team's completed state", async () => {
    vi.mocked(getEpicStatuses).mockResolvedValueOnce([
      {
        epic: {
          id: "epic-a",
          identifier: "ENG-1",
          title: "A",
          priority: 2,
          state: { id: "s1", name: "Backlog", type: "backlog" },
          team: { id: "team-a", key: "ENG", name: "Eng" },
        },
        total_children: 1,
        closed_children: 1,
        eligible_for_close: true,
      },
      {
        epic: {
          id: "epic-b",
          identifier: "ENG-2",
          title: "B",
          priority: 2,
          state: { id: "s2", name: "Backlog", type: "backlog" },
          team: { id: "team-b", key: "ENG2", name: "Eng2" },
        },
        total_children: 1,
        closed_children: 1,
        eligible_for_close: true,
      },
    ]);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "close-eligible-epics",
    ]);

    expect(resolveStateIdByType).toHaveBeenCalledTimes(2);
    expect(resolveStateIdByType).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      "team-a",
      "completed",
    );
    expect(updateIssue).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      "epic-a",
      { stateId: "resolved-state-uuid" },
    );
    expect(updateIssue).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "epic-b",
      { stateId: "resolved-state-uuid" },
    );
  });
});

describe("issues supersede", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    vi.mocked(getIssue).mockImplementation(async (_gql, id) =>
      id === "replacement-uuid"
        ? ({
            id: "replacement-uuid",
            identifier: "ENG-25",
            team: { id: "team-uuid", key: "ENG", name: "Engineering" },
          } as never)
        : ({
            id: "superseded-uuid",
            identifier: "ENG-10",
            team: { id: "team-uuid", key: "ENG", name: "Engineering" },
          } as never),
    );
    vi.mocked(updateIssue).mockResolvedValue({
      id: "superseded-uuid",
      identifier: "ENG-10",
      title: "Old work",
    } as never);
    vi.mocked(createIssueRelation).mockResolvedValue({
      id: "relation-uuid",
    } as never);
  });

  afterEach(() => {
    vi.mocked(resolveIssueId).mockResolvedValue("resolved-issue-uuid");
  });

  it("creates a Related relation and closes the superseded issue with canceled state", async () => {
    vi.mocked(resolveIssueId).mockImplementation(async (_sdk, id) =>
      id === "ENG-10" ? "superseded-uuid" : "replacement-uuid",
    );

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "supersede",
      "ENG-10",
      "--with",
      "ENG-25",
    ]);

    expect(createIssueRelation).toHaveBeenCalledWith(expect.anything(), {
      issueId: "superseded-uuid",
      relatedIssueId: "replacement-uuid",
      type: "related",
    });
    expect(resolveStateIdByType).toHaveBeenCalledWith(
      expect.anything(),
      "team-uuid",
      "canceled",
    );
    expect(updateIssue).toHaveBeenCalledWith(
      expect.anything(),
      "superseded-uuid",
      { stateId: "resolved-state-uuid" },
    );
    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "superseded",
        superseded: "superseded-uuid",
        replacement: "replacement-uuid",
        relation_id: "relation-uuid",
      }),
      expect.any(Function),
      expect.anything(),
    );
  });

  it("rejects superseding an issue with itself", async () => {
    vi.mocked(resolveIssueId).mockResolvedValue("same-uuid");

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "supersede",
      "ENG-10",
      "--with",
      "ENG-10",
    ]);

    expect(createIssueRelation).not.toHaveBeenCalled();
    expect(updateIssue).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("requires --with", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "issues", "supersede", "ENG-10"]);

    expect(createIssueRelation).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalled();
  });
});

describe("issues mark-duplicate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    vi.mocked(getIssue).mockImplementation(async (_gql, id) =>
      id === "canonical-uuid"
        ? ({
            id: "canonical-uuid",
            identifier: "ENG-3",
            team: { id: "team-uuid", key: "ENG", name: "Engineering" },
          } as never)
        : ({
            id: "duplicate-uuid",
            identifier: "ENG-7",
            team: { id: "team-uuid", key: "ENG", name: "Engineering" },
          } as never),
    );
    vi.mocked(updateIssue).mockResolvedValue({
      id: "duplicate-uuid",
      identifier: "ENG-7",
      title: "Duplicate work",
    } as never);
    vi.mocked(createIssueRelation).mockResolvedValue({
      id: "relation-uuid",
    } as never);
  });

  afterEach(() => {
    // Restore default resolveIssueId mock so per-test overrides don't leak.
    vi.mocked(resolveIssueId).mockResolvedValue("resolved-issue-uuid");
  });

  it("creates a Duplicate relation and closes the duplicate with canceled state", async () => {
    vi.mocked(resolveIssueId).mockImplementation(async (_sdk, id) =>
      id === "ENG-7" ? "duplicate-uuid" : "canonical-uuid",
    );

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "mark-duplicate",
      "ENG-7",
      "--of",
      "ENG-3",
    ]);

    expect(createIssueRelation).toHaveBeenCalledWith(expect.anything(), {
      issueId: "duplicate-uuid",
      relatedIssueId: "canonical-uuid",
      type: "duplicate",
    });
    expect(resolveStateIdByType).toHaveBeenCalledWith(
      expect.anything(),
      "team-uuid",
      "canceled",
    );
    expect(updateIssue).toHaveBeenCalledWith(
      expect.anything(),
      "duplicate-uuid",
      { stateId: "resolved-state-uuid" },
    );
    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "marked-duplicate",
        duplicate: "duplicate-uuid",
        canonical: "canonical-uuid",
        relation_id: "relation-uuid",
      }),
      expect.any(Function),
      expect.anything(),
    );
  });

  it("rejects marking an issue as a duplicate of itself", async () => {
    vi.mocked(resolveIssueId).mockResolvedValue("same-uuid");

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "mark-duplicate",
      "ENG-7",
      "--of",
      "ENG-7",
    ]);

    expect(createIssueRelation).not.toHaveBeenCalled();
    expect(updateIssue).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("requires --of", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "mark-duplicate",
      "ENG-7",
    ]);

    expect(createIssueRelation).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalled();
  });
});

describe("issues find-duplicates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("scans the whole workspace without resolving a team when --team is omitted", async () => {
    vi.mocked(findDuplicateGroups).mockResolvedValueOnce([]);

    const program = createProgram();
    await program.parseAsync(["node", "test", "issues", "find-duplicates"]);

    expect(resolveTeamId).not.toHaveBeenCalled();
    expect(findDuplicateGroups).toHaveBeenCalledWith(expect.anything(), {
      teamId: undefined,
    });
    // fetchOpenIssuesForMerge is called once unconditionally for the
    // marked-duplicate pre-fetch (lin-w3w7), but not again for merging.
    expect(fetchOpenIssuesForMerge).toHaveBeenCalledTimes(1);
    expect(fetchOpenIssuesForMerge).toHaveBeenCalledWith(expect.anything(), {
      teamId: undefined,
      stateTypes: null,
    });
    expect(mergeDuplicateGroup).not.toHaveBeenCalled();
  });

  it("resolves --team and forwards the UUID into the service", async () => {
    vi.mocked(findDuplicateGroups).mockResolvedValueOnce([]);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "find-duplicates",
      "--team",
      "ENG",
    ]);

    expect(resolveTeamId).toHaveBeenCalledWith(expect.anything(), "ENG");
    expect(findDuplicateGroups).toHaveBeenCalledWith(expect.anything(), {
      teamId: "resolved-team-uuid",
    });
  });

  it("--auto-merge --dry-run emits merge_commands without fetching full issues or merging", async () => {
    vi.mocked(findDuplicateGroups).mockResolvedValueOnce([
      {
        title: "Same",
        issues: [],
        suggested_target: "ENG-1",
        suggested_sources: ["ENG-2", "ENG-3"],
        suggested_action:
          "linear issues mark-duplicate ENG-2 --of ENG-1 && linear issues mark-duplicate ENG-3 --of ENG-1",
        note: "",
      },
    ]);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "find-duplicates",
      "--auto-merge",
      "--dry-run",
    ]);

    // fetchOpenIssuesForMerge is called once for the marked-duplicate
    // pre-fetch (lin-w3w7) even on --dry-run, but never for the merge.
    expect(fetchOpenIssuesForMerge).toHaveBeenCalledTimes(1);
    expect(fetchOpenIssuesForMerge).toHaveBeenCalledWith(expect.anything(), {
      teamId: undefined,
      stateTypes: null,
    });
    expect(mergeDuplicateGroup).not.toHaveBeenCalled();
    expect(resolveStateIdByType).not.toHaveBeenCalled();
  });

  it("--auto-merge pre-resolves canceled state per source team and calls mergeDuplicateGroup for each group", async () => {
    vi.mocked(findDuplicateGroups).mockResolvedValueOnce([
      {
        title: "Same",
        issues: [],
        suggested_target: "ENG-1",
        suggested_sources: ["ENG-2"],
        suggested_action: "linear issues mark-duplicate ENG-2 --of ENG-1",
        note: "",
      },
      {
        title: "Other",
        issues: [],
        suggested_target: "ENG-9",
        suggested_sources: ["ENG-10"],
        suggested_action: "linear issues mark-duplicate ENG-10 --of ENG-9",
        note: "",
      },
    ]);
    // First call: marked-duplicate pre-fetch (lin-w3w7); empty result is fine
    // for this test which only exercises the merge path.
    // Second call: actual merge fetch returning the source-team fixtures.
    vi.mocked(fetchOpenIssuesForMerge)
      .mockResolvedValueOnce(new Map() as never)
      .mockResolvedValueOnce(
        new Map([
          [
            "ENG-2",
            {
              id: "src-1",
              identifier: "ENG-2",
              team: { id: "team-a", key: "ENG", name: "Eng" },
            },
          ],
          [
            "ENG-10",
            {
              id: "src-2",
              identifier: "ENG-10",
              team: { id: "team-b", key: "ENG2", name: "Eng2" },
            },
          ],
        ]) as never,
      );

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "find-duplicates",
      "--auto-merge",
    ]);

    expect(fetchOpenIssuesForMerge).toHaveBeenCalledWith(expect.anything(), {
      teamId: undefined,
      stateTypes: null,
    });
    expect(fetchOpenIssuesForMerge).toHaveBeenCalledWith(expect.anything(), {
      teamId: undefined,
    });
    expect(resolveStateIdByType).toHaveBeenCalledTimes(2);
    expect(resolveStateIdByType).toHaveBeenCalledWith(
      expect.anything(),
      "team-a",
      "canceled",
    );
    expect(resolveStateIdByType).toHaveBeenCalledWith(
      expect.anything(),
      "team-b",
      "canceled",
    );
    expect(mergeDuplicateGroup).toHaveBeenCalledTimes(2);
  });

  it("--method mechanical delegates to the similarity service with parsed flags", async () => {
    vi.mocked(runMechanicalDuplicateDetection).mockResolvedValueOnce({
      pairs: [],
      count: 0,
      method: "mechanical",
      threshold: 0.7,
    });

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "find-duplicates",
      "--method",
      "mechanical",
      "--threshold",
      "0.7",
      "--limit",
      "10",
    ]);

    expect(findDuplicateGroups).not.toHaveBeenCalled();
    expect(runMechanicalDuplicateDetection).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        threshold: 0.7,
        limit: 10,
        teamId: undefined,
        stateTypes: undefined,
      }),
    );
  });

  it("--method mechanical with --status all clears the state filter", async () => {
    vi.mocked(runMechanicalDuplicateDetection).mockResolvedValueOnce({
      pairs: [],
      count: 0,
      method: "mechanical",
      threshold: 0.5,
    });

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "find-duplicates",
      "--method",
      "mechanical",
      "--status",
      "all",
    ]);

    expect(runMechanicalDuplicateDetection).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ stateTypes: null }),
    );
  });

  it("--method mechanical maps --status closed to canceled+completed state types", async () => {
    vi.mocked(runMechanicalDuplicateDetection).mockResolvedValueOnce({
      pairs: [],
      count: 0,
      method: "mechanical",
      threshold: 0.5,
    });

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "find-duplicates",
      "--method",
      "mechanical",
      "--status",
      "closed",
    ]);

    const call = vi.mocked(runMechanicalDuplicateDetection).mock.calls[0][1];
    expect(call.stateTypes).toEqual(["completed", "canceled", "duplicate"]);
  });

  it("--method mechanical rejects an out-of-range --threshold", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "find-duplicates",
      "--method",
      "mechanical",
      "--threshold",
      "1.5",
    ]);

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(runMechanicalDuplicateDetection).not.toHaveBeenCalled();
  });

  it("--method ai surfaces a 'not implemented' error", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "find-duplicates",
      "--method",
      "ai",
    ]);

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(runMechanicalDuplicateDetection).not.toHaveBeenCalled();
    expect(findDuplicateGroups).not.toHaveBeenCalled();
  });

  it("rejects an unknown --method value", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "find-duplicates",
      "--method",
      "wat",
    ]);

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(runMechanicalDuplicateDetection).not.toHaveBeenCalled();
    expect(findDuplicateGroups).not.toHaveBeenCalled();
  });
});

describe("issues update --assignee", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("resolves assignee name to UUID before updating issue", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "update",
      "ENG-42",
      "--assignee",
      "Jane Smith",
    ]);

    expect(resolveUserId).toHaveBeenCalledWith(expect.anything(), "Jane Smith");
    expect(updateIssue).toHaveBeenCalledWith(
      expect.anything(),
      "resolved-issue-uuid",
      expect.objectContaining({ assigneeId: "resolved-user-uuid" }),
    );
  });

  it("clears the assignee with --clear-assignee", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "update",
      "ENG-42",
      "--clear-assignee",
    ]);

    expect(resolveUserId).not.toHaveBeenCalled();
    expect(updateIssue).toHaveBeenCalledWith(
      expect.anything(),
      "resolved-issue-uuid",
      expect.objectContaining({ assigneeId: null }),
    );
  });

  it("rejects --assignee together with --clear-assignee", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "update",
      "ENG-42",
      "--assignee",
      "Jane Smith",
      "--clear-assignee",
    ]);

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(updateIssue).not.toHaveBeenCalled();
  });

  it("does not call resolveUserId when --assignee is omitted", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "update",
      "ENG-42",
      "--title",
      "New title",
    ]);

    expect(resolveUserId).not.toHaveBeenCalled();
  });
});

describe("issues read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("uses the lean issue read for UUIDs by default", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "read",
      "550e8400-e29b-41d4-a716-446655440000",
    ]);

    expect(getIssue).toHaveBeenCalledWith(
      expect.anything(),
      "550e8400-e29b-41d4-a716-446655440000",
    );
    expect(getIssueWithComments).not.toHaveBeenCalled();
    expect(getIssueWithCommentThreads).not.toHaveBeenCalled();
    expect(getIssueWithAttachments).not.toHaveBeenCalled();
  });

  it("uses the lean issue read for identifiers by default", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "issues", "read", "ENG-42"]);

    expect(getIssueByIdentifier).toHaveBeenCalledWith(
      expect.anything(),
      "ENG",
      42,
    );
    expect(getIssueByIdentifierWithComments).not.toHaveBeenCalled();
    expect(getIssueByIdentifierWithCommentThreads).not.toHaveBeenCalled();
    expect(getIssueByIdentifierWithAttachments).not.toHaveBeenCalled();
  });

  it("calls getIssueWithComments when flag is set with UUID", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "read",
      "550e8400-e29b-41d4-a716-446655440000",
      "--with-comments",
    ]);

    expect(getIssueWithComments).toHaveBeenCalledWith(
      expect.anything(),
      "550e8400-e29b-41d4-a716-446655440000",
    );
    expect(getIssueWithAttachments).not.toHaveBeenCalled();
  });

  it("calls getIssueByIdentifierWithComments when flag is set with identifier", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "read",
      "ENG-42",
      "--with-comments",
    ]);

    expect(getIssueByIdentifierWithComments).toHaveBeenCalledWith(
      expect.anything(),
      "ENG",
      42,
    );
    expect(getIssueByIdentifierWithAttachments).not.toHaveBeenCalled();
  });

  it("calls getIssueWithCommentThreads when flag is set with UUID", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "read",
      "550e8400-e29b-41d4-a716-446655440000",
      "--with-comment-threads",
    ]);

    expect(getIssueWithCommentThreads).toHaveBeenCalledWith(
      expect.anything(),
      "550e8400-e29b-41d4-a716-446655440000",
    );
    expect(getIssueWithAttachments).not.toHaveBeenCalled();
  });

  it("calls getIssueByIdentifierWithCommentThreads when flag is set with identifier", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "read",
      "ENG-42",
      "--with-comment-threads",
    ]);

    expect(getIssueByIdentifierWithCommentThreads).toHaveBeenCalledWith(
      expect.anything(),
      "ENG",
      42,
    );
    expect(getIssueByIdentifierWithAttachments).not.toHaveBeenCalled();
  });

  it("keeps attachment reads on the attachment path when combined with --with-comments", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "read",
      "550e8400-e29b-41d4-a716-446655440000",
      "--with-attachments",
      "--with-comments",
    ]);

    expect(getIssueWithAttachments).toHaveBeenCalledWith(
      expect.anything(),
      "550e8400-e29b-41d4-a716-446655440000",
    );
    expect(getIssueWithComments).not.toHaveBeenCalled();
  });

  it.each([
    ["--with-attachments"],
    ["--with-comments"],
    ["--with-comment-threads"],
  ])("rejects issues read %s with --with-reactions", async (flag) => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "read",
      "550e8400-e29b-41d4-a716-446655440000",
      flag,
      "--with-reactions",
    ]);

    expect(console.error).toHaveBeenCalledWith(
      JSON.stringify(
        {
          error:
            "Invalid --with-reactions: cannot be combined with --with-attachments, --with-comments, or --with-comment-threads",
        },
        null,
        2,
      ),
    );
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(getIssueWithAttachments).not.toHaveBeenCalled();
    expect(getIssueWithComments).not.toHaveBeenCalled();
    expect(getIssueWithCommentThreads).not.toHaveBeenCalled();
    expect(getIssueWithReactions).not.toHaveBeenCalled();
  });

  it("issues read --with-reactions routes to reaction-aware issue read for UUIDs", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "read",
      "550e8400-e29b-41d4-a716-446655440000",
      "--with-reactions",
    ]);

    expect(getIssueWithReactions).toHaveBeenCalledWith(
      expect.anything(),
      "550e8400-e29b-41d4-a716-446655440000",
    );
    expect(getIssueWithComments).not.toHaveBeenCalled();
    expect(getIssueWithAttachments).not.toHaveBeenCalled();
  });

  it("issues read --with-reactions routes to reaction-aware issue read for identifiers", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "read",
      "ENG-42",
      "--with-reactions",
    ]);

    expect(getIssueByIdentifierWithReactions).toHaveBeenCalledWith(
      expect.anything(),
      "ENG",
      42,
    );
    expect(getIssueByIdentifierWithComments).not.toHaveBeenCalled();
    expect(getIssueByIdentifierWithAttachments).not.toHaveBeenCalled();
  });

  it("calls getIssueWithAttachments when flag is set with UUID", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "read",
      "550e8400-e29b-41d4-a716-446655440000",
      "--with-attachments",
    ]);

    expect(getIssueWithAttachments).toHaveBeenCalledWith(
      expect.anything(),
      "550e8400-e29b-41d4-a716-446655440000",
    );
  });

  it("calls getIssueByIdentifierWithAttachments when flag is set with identifier", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "read",
      "ENG-42",
      "--with-attachments",
    ]);

    expect(getIssueByIdentifierWithAttachments).toHaveBeenCalledWith(
      expect.anything(),
      "ENG",
      42,
    );
  });
});

describe("issues reaction commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("issues react resolves issue and delegates to reaction service", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "issues",
      "react",
      "ENG-42",
      "👍",
    ]);

    expect(resolveIssueId).toHaveBeenCalledWith(expect.anything(), "ENG-42");
    expect(createReactionForIssue).toHaveBeenCalledWith(expect.anything(), {
      issueId: "resolved-issue-uuid",
      emoji: "👍",
    });
  });

  it("issues react supports --shortcode", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "issues",
      "react",
      "ENG-42",
      "--shortcode",
      "thumbs_up",
    ]);

    expect(createReactionForIssue).toHaveBeenCalledWith(expect.anything(), {
      issueId: "resolved-issue-uuid",
      emoji: "👍",
    });
  });

  it("issues unreact resolves issue and deletes viewer reaction by emoji", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "issues",
      "unreact",
      "ENG-42",
      "👍",
    ]);

    expect(deleteOwnReactionByEmoji).toHaveBeenCalledWith(expect.anything(), {
      kind: "issue",
      id: "resolved-issue-uuid",
      emoji: "👍",
    });
  });

  it("issues unreact-id resolves issue and deletes viewer reaction by id", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "issues",
      "unreact-id",
      "ENG-42",
      "reaction-123",
    ]);

    expect(deleteOwnReactionById).toHaveBeenCalledWith(expect.anything(), {
      kind: "issue",
      id: "resolved-issue-uuid",
      reactionId: "reaction-123",
    });
  });
});

describe("issues lifecycle commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("issues archive resolves identifier and calls archiveIssue", async () => {
    const program = createProgram();

    await program.parseAsync(["node", "test", "issues", "archive", "ENG-42"]);

    expect(resolveIssueId).toHaveBeenCalledWith(expect.anything(), "ENG-42");
    expect(archiveIssue).toHaveBeenCalledWith(
      expect.anything(),
      "resolved-issue-uuid",
    );
  });

  it("issues archive accepts multiple ids and bulk-archives each (lin-2d20)", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "issues",
      "archive",
      "ENG-1",
      "ENG-2",
      "ENG-3",
    ]);

    expect(resolveIssueId).toHaveBeenCalledWith(expect.anything(), "ENG-1");
    expect(resolveIssueId).toHaveBeenCalledWith(expect.anything(), "ENG-2");
    expect(resolveIssueId).toHaveBeenCalledWith(expect.anything(), "ENG-3");
    expect(archiveIssue).toHaveBeenCalledTimes(3);
  });

  it("issues unarchive resolves identifier and calls unarchiveIssue", async () => {
    const program = createProgram();

    await program.parseAsync(["node", "test", "issues", "unarchive", "ENG-42"]);

    expect(resolveIssueId).toHaveBeenCalledWith(expect.anything(), "ENG-42");
    expect(unarchiveIssue).toHaveBeenCalledWith(
      expect.anything(),
      "resolved-issue-uuid",
    );
  });

  it("issues unarchive accepts multiple ids and bulk-unarchives each (lin-2d20)", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "issues",
      "unarchive",
      "ENG-1",
      "ENG-2",
    ]);

    expect(unarchiveIssue).toHaveBeenCalledTimes(2);
  });

  it("issues delete resolves identifier and calls deleteIssue", async () => {
    const program = createProgram();

    await program.parseAsync(["node", "test", "issues", "delete", "ENG-42"]);

    expect(resolveIssueId).toHaveBeenCalledWith(expect.anything(), "ENG-42");
    expect(deleteIssue).toHaveBeenCalledWith(
      expect.anything(),
      "resolved-issue-uuid",
    );
    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: "ENG-42",
        title: "An issue",
        success: true,
      }),
      expect.any(Function),
      expect.anything(),
    );
  });
});

describe("issues discussion commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("issues discuss resolves issue and starts thread", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "issues",
      "discuss",
      "ENG-42",
      "--body",
      "Need decision",
    ]);

    expect(resolveIssueId).toHaveBeenCalledWith(expect.anything(), "ENG-42");
    expect(startIssueDiscussion).toHaveBeenCalledWith(expect.anything(), {
      issueId: "resolved-issue-uuid",
      body: "Need decision",
    });
  });

  it("issues discuss requires --body", async () => {
    const program = createProgram();

    await program.parseAsync(["node", "test", "issues", "discuss", "ENG-42"]);

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Invalid --body: is required"),
    );
    expect(startIssueDiscussion).not.toHaveBeenCalled();
  });

  it("issues discussions resolves issue and forwards pagination", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "issues",
      "discussions",
      "ENG-42",
      "--limit",
      "10",
      "--after",
      "cursor-1",
    ]);

    expect(resolveIssueId).toHaveBeenCalledWith(expect.anything(), "ENG-42");
    expect(listDiscussionsForIssue).toHaveBeenCalledWith(
      expect.anything(),
      "resolved-issue-uuid",
      { limit: 10, after: "cursor-1" },
    );
  });

  it("issues discussions --with-reactions routes to reaction-aware service", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "issues",
      "discussions",
      "ENG-42",
      "--with-reactions",
    ]);

    expect(listDiscussionsForIssueWithReactions).toHaveBeenCalledWith(
      expect.anything(),
      "resolved-issue-uuid",
      { limit: 25, after: undefined },
    );
    expect(listDiscussionsForIssue).not.toHaveBeenCalled();
  });

  it("issues replies forwards pagination", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "issues",
      "replies",
      "thread-1",
      "--limit",
      "15",
      "--after",
      "cursor-2",
    ]);

    expect(listDiscussionReplies).toHaveBeenCalledWith(
      expect.anything(),
      "thread-1",
      {
        limit: 15,
        after: "cursor-2",
      },
      "issue",
    );
  });

  it("issues replies --with-reactions routes to reaction-aware service", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "issues",
      "replies",
      "thread-1",
      "--with-reactions",
    ]);

    expect(listDiscussionRepliesWithReactions).toHaveBeenCalledWith(
      expect.anything(),
      "thread-1",
      { limit: 50, after: undefined },
      "issue",
    );
    expect(listDiscussionReplies).not.toHaveBeenCalled();
  });

  it("issues reply requires --body", async () => {
    const program = createProgram();

    await program.parseAsync(["node", "test", "issues", "reply", "thread-1"]);

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Invalid --body: is required"),
    );
    expect(replyToDiscussion).not.toHaveBeenCalled();
  });

  it("issues reply delegates to discussion service", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "issues",
      "reply",
      "thread-1",
      "--body",
      "Nested reply",
    ]);

    expect(replyToDiscussion).toHaveBeenCalledWith(expect.anything(), {
      threadId: "thread-1",
      body: "Nested reply",
      entityKind: "issue",
    });
  });

  it("issues delete-comment deletes root or reply discussion comments", async () => {
    const program = createProgram();
    const commentId = "11111111-1111-4111-8111-111111111111";

    await program.parseAsync([
      "node",
      "test",
      "issues",
      "delete-comment",
      commentId,
    ]);

    expect(deleteDiscussionComment).toHaveBeenCalledWith(
      expect.anything(),
      commentId,
      "issue",
    );
    expect(deleteIssue).not.toHaveBeenCalled();
  });

  it("issues generic edit/delete help documents root or reply IDs while strict reply commands stay reply-only", () => {
    const program = createProgram();
    const issues = program.commands.find(
      (command) => command.name() === "issues",
    );

    const edit = issues?.commands.find((command) => command.name() === "edit");
    const del = issues?.commands.find(
      (command) => command.name() === "delete-comment",
    );
    const editReply = issues?.commands.find(
      (command) => command.name() === "edit-reply",
    );
    const deleteReply = issues?.commands.find(
      (command) => command.name() === "delete-reply",
    );

    expect(edit?.description()).toContain("root discussion or reply");
    expect(del?.description()).toContain("root discussion or reply");
    expect(editReply?.description()).toBe("edit a discussion reply");
    expect(deleteReply?.description()).toBe("delete a discussion reply");
  });

  it("issues edit delegates to generic discussion comment service", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "issues",
      "edit",
      "11111111-1111-4111-8111-111111111111",
      "--body",
      "Edited",
    ]);

    expect(editDiscussionComment).toHaveBeenCalledWith(
      expect.anything(),
      "11111111-1111-4111-8111-111111111111",
      { body: "Edited" },
      "issue",
    );
  });

  it("issues edit-reply delegates to discussion service", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "issues",
      "edit-reply",
      "reply-1",
      "--body",
      "Edited",
    ]);

    expect(editDiscussionReply).toHaveBeenCalledWith(
      expect.anything(),
      "reply-1",
      { body: "Edited" },
      "issue",
    );
  });

  it("issues edit-reply requires --body", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "issues",
      "edit-reply",
      "reply-1",
    ]);

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Invalid --body: is required"),
    );
    expect(editDiscussionReply).not.toHaveBeenCalled();
  });

  it("issues delete-comment delegates to generic discussion comment service", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "issues",
      "delete-comment",
      "11111111-1111-4111-8111-111111111111",
    ]);

    expect(deleteDiscussionComment).toHaveBeenCalledWith(
      expect.anything(),
      "11111111-1111-4111-8111-111111111111",
      "issue",
    );
  });

  it("issues delete-reply delegates to discussion service", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "issues",
      "delete-reply",
      "reply-1",
    ]);

    expect(deleteDiscussionReply).toHaveBeenCalledWith(
      expect.anything(),
      "reply-1",
      "issue",
    );
  });

  it("issues resolve delegates to discussion service", async () => {
    const program = createProgram();

    await program.parseAsync(["node", "test", "issues", "resolve", "thread-1"]);

    expect(resolveDiscussion).toHaveBeenCalledWith(expect.anything(), {
      threadId: "thread-1",
      entityKind: "issue",
    });
  });

  it("issues resolve forwards --with-comment as resolvingCommentId", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "issues",
      "resolve",
      "thread-1",
      "--with-comment",
      "comment-123",
    ]);

    expect(resolveDiscussion).toHaveBeenCalledWith(expect.anything(), {
      threadId: "thread-1",
      resolvingCommentId: "comment-123",
      entityKind: "issue",
    });
  });

  it("issues unresolve delegates to discussion service", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "issues",
      "unresolve",
      "thread-1",
    ]);

    expect(unresolveDiscussion).toHaveBeenCalledWith(
      expect.anything(),
      "thread-1",
      "issue",
    );
  });

  it("issues threads react delegates to comment reaction service", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "issues",
      "threads",
      "react",
      "thread-1",
      "🎉",
    ]);

    expect(createDiscussionCommentReaction).toHaveBeenCalledWith(
      expect.anything(),
      {
        commentId: "thread-1",
        target: "thread",
        expectedEntityKind: "issue",
        emoji: "🎉",
      },
    );
  });

  it("issues replies unreact-id delegates to comment reaction service", async () => {
    const program = createProgram();

    await program.parseAsync([
      "node",
      "test",
      "issues",
      "replies",
      "unreact-id",
      "reply-1",
      "reaction-123",
    ]);

    expect(deleteDiscussionCommentReactionById).toHaveBeenCalledWith(
      expect.anything(),
      {
        commentId: "reply-1",
        target: "reply",
        expectedEntityKind: "issue",
        reactionId: "reaction-123",
      },
    );
  });
});

describe("issues create relations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("creates single relation", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "--no-validate",
      "Title",
      "--team",
      "ENG",
      "--blocks",
      "DAT-103",
    ]);
    const { createIssueRelation } = await import(
      "../../../src/services/issue-relation-service.js"
    );
    expect(createIssueRelation).toHaveBeenCalledTimes(1);
    expect(createIssueRelation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "blocks" }),
    );
  });

  it("creates multiple relations of same type", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "--no-validate",
      "Title",
      "--team",
      "ENG",
      "--blocks",
      "DAT-103,DAT-104",
    ]);
    const { createIssueRelation } = await import(
      "../../../src/services/issue-relation-service.js"
    );
    expect(createIssueRelation).toHaveBeenCalledTimes(2);
  });

  it("creates multiple relations of different types", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "--no-validate",
      "Title",
      "--team",
      "ENG",
      "--blocks",
      "DAT-103",
      "--relates-to",
      "DAT-913",
    ]);
    const { createIssueRelation } = await import(
      "../../../src/services/issue-relation-service.js"
    );
    expect(createIssueRelation).toHaveBeenCalledTimes(2);
  });

  it("errors on cross-flag duplicate target", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "--no-validate",
      "Title",
      "--team",
      "ENG",
      "--blocks",
      "DAT-103",
      "--relates-to",
      "DAT-103",
    ]);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("appears in multiple relation flags"),
    );
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("deduplicates intra-flag duplicates silently", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "--no-validate",
      "Title",
      "--team",
      "ENG",
      "--blocks",
      "DAT-103,DAT-103",
    ]);
    const { createIssueRelation } = await import(
      "../../../src/services/issue-relation-service.js"
    );
    expect(createIssueRelation).toHaveBeenCalledTimes(1);
  });
});

describe("issues update relations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("removes single relation", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "update",
      "ENG-42",
      "--remove-relation",
      "DAT-103",
    ]);
    const { deleteIssueRelation, findIssueRelation } = await import(
      "../../../src/services/issue-relation-service.js"
    );
    expect(findIssueRelation).toHaveBeenCalledTimes(1);
    expect(deleteIssueRelation).toHaveBeenCalledTimes(1);
  });

  it("removes multiple relations", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "update",
      "ENG-42",
      "--remove-relation",
      "DAT-103,DAT-913",
    ]);
    const { deleteIssueRelation, findIssueRelation } = await import(
      "../../../src/services/issue-relation-service.js"
    );
    expect(findIssueRelation).toHaveBeenCalledTimes(2);
    expect(deleteIssueRelation).toHaveBeenCalledTimes(2);
  });

  it("errors on cross-flag duplicate in update", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "update",
      "ENG-42",
      "--blocks",
      "DAT-103",
      "--relates-to",
      "DAT-103",
    ]);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("appears in multiple relation flags"),
    );
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("errors when remove-relation mixed with add flags in update", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "update",
      "ENG-42",
      "--blocks",
      "DAT-103",
      "--remove-relation",
      "DAT-913",
    ]);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Cannot mix add and remove relation flags"),
    );
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

describe("issues ship", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("delegates to shipCapability with the capability and default flags", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "issues", "ship", "foo"]);
    expect(shipCapability).toHaveBeenCalledWith(expect.anything(), "foo", {
      force: false,
      dryRun: false,
    });
  });

  it("forwards --force and --dry-run", async () => {
    vi.mocked(shipCapability).mockResolvedValueOnce({
      status: "dry_run",
      capability: "foo",
      issue_id: "issue-1",
      issue_identifier: "ENG-1",
      would_add: "provides:foo",
    });
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "ship",
      "foo",
      "--force",
      "--dry-run",
    ]);
    expect(shipCapability).toHaveBeenCalledWith(expect.anything(), "foo", {
      force: true,
      dryRun: true,
    });
  });

  it("propagates a service error via handleCommand (exits 1)", async () => {
    vi.mocked(shipCapability).mockRejectedValueOnce(
      new Error("no issue found with label 'export:foo'"),
    );
    const program = createProgram();
    await program.parseAsync(["node", "test", "issues", "ship", "foo"]);
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

describe("issues note", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("joins positional text args with spaces", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "note",
      "ENG-1",
      "fixed",
      "the",
      "flaky",
      "test",
    ]);

    expect(resolveIssueId).toHaveBeenCalledWith(expect.anything(), "ENG-1");
    expect(appendNote).toHaveBeenCalledWith(
      expect.anything(),
      "resolved-issue-uuid",
      "fixed the flaky test",
    );
  });

  it("reads from stdin when --stdin is set and strips trailing newlines", async () => {
    const fs = await import("node:fs");
    const readSpy = vi
      .spyOn(fs.default, "readFileSync")
      .mockReturnValueOnce("note from pipe\n\n");

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "note",
      "ENG-1",
      "--stdin",
    ]);

    expect(readSpy).toHaveBeenCalledWith(0, "utf8");
    expect(appendNote).toHaveBeenCalledWith(
      expect.anything(),
      "resolved-issue-uuid",
      "note from pipe",
    );
  });

  it("reads from --file path", async () => {
    const fs = await import("node:fs");
    const readSpy = vi
      .spyOn(fs.default, "readFileSync")
      .mockReturnValueOnce("file note body");

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "note",
      "ENG-1",
      "--file",
      "notes.txt",
    ]);

    expect(readSpy).toHaveBeenCalledWith("notes.txt", "utf8");
    expect(appendNote).toHaveBeenCalledWith(
      expect.anything(),
      "resolved-issue-uuid",
      "file note body",
    );
  });

  it("rejects combining --stdin and --file (exits 1)", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "note",
      "ENG-1",
      "--stdin",
      "--file",
      "notes.txt",
    ]);

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(appendNote).not.toHaveBeenCalled();
  });

  it("rejects empty text from stdin (exits 1)", async () => {
    const fs = await import("node:fs");
    vi.spyOn(fs.default, "readFileSync").mockReturnValueOnce("\n\n");

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "note",
      "ENG-1",
      "--stdin",
    ]);

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(appendNote).not.toHaveBeenCalled();
  });

  it("rejects when no text source is provided (exits 1)", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "issues", "note", "ENG-1"]);

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(appendNote).not.toHaveBeenCalled();
  });
});

describe("issues types", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("delegates to listTypes and dispatches via outputResult", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "issues", "types"]);

    expect(listTypes).toHaveBeenCalledOnce();
    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({
        core_types: expect.any(Array),
        custom_types: expect.any(Array),
      }),
      expect.any(Function),
      expect.any(Object),
    );
  });
});

describe("issues statuses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("queries all teams when --team is omitted", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "issues", "statuses"]);

    expect(resolveTeamId).not.toHaveBeenCalled();
    expect(listStatuses).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ teamId: undefined }),
    );
    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({ statuses: expect.any(Array) }),
      expect.any(Function),
      expect.any(Object),
    );
  });

  it("resolves --team to UUID and scopes the service call", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "statuses",
      "--team",
      "ENG",
    ]);

    expect(resolveTeamId).toHaveBeenCalledWith(expect.anything(), "ENG");
    expect(listStatuses).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ teamId: "resolved-team-uuid" }),
    );
  });
});

describe("issues status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("delegates to getStatus and emits its result", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "issues", "status"]);

    expect(getStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ assignedOnly: false }),
    );
    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: expect.objectContaining({ total_issues: 0 }),
        recent_activity: null,
      }),
      expect.any(Function),
      expect.any(Object),
    );
  });

  it("passes assignedOnly=true when --assigned is set", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "status",
      "--assigned",
    ]);

    expect(getStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ assignedOnly: true }),
    );
  });

  it("'stats' alias routes to the same handler", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "issues", "stats"]);

    expect(getStatus).toHaveBeenCalledOnce();
  });
});

describe("issues count", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("delegates to countMatching without --by-* and dispatches via outputResult", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "issues", "count"]);

    expect(countMatching).toHaveBeenCalledOnce();
    expect(countMatchingGrouped).not.toHaveBeenCalled();
    expect(outputResult).toHaveBeenCalledWith(
      { count: 7 },
      expect.any(Function),
      expect.any(Object),
    );
  });

  it("delegates to countMatchingGrouped when --by-status is set", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "count",
      "--by-status",
    ]);

    expect(countMatchingGrouped).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      "status",
    );
    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({
        total: 7,
        groups: expect.any(Array),
      }),
      expect.any(Function),
      expect.any(Object),
    );
  });

  it("rejects multiple --by-* flags (exits 1)", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "count",
      "--by-status",
      "--by-type",
    ]);

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(countMatching).not.toHaveBeenCalled();
    expect(countMatchingGrouped).not.toHaveBeenCalled();
  });
});

describe("issues create-form", () => {
  it("rejects when stdin is non-TTY (agent-blocking)", async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });
    const program = createProgram();
    await program.parseAsync(["node", "test", "issues", "create-form"]);

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(createIssue).not.toHaveBeenCalled();
  });
});

describe("issues lint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    vi.mocked(buildLintSummary).mockReturnValue({
      total: 0,
      issues: 0,
      results: [],
    });
  });

  it("delegates to fetchIssuesForLint with open-state filter by default", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "issues", "lint"]);

    expect(fetchIssuesForLint).toHaveBeenCalledOnce();
    const [, filter] = vi.mocked(fetchIssuesForLint).mock.calls[0];
    expect(filter).toEqual({
      state: { type: { in: ["triage", "backlog", "unstarted"] } },
    });
    expect(outputResult).toHaveBeenCalledWith(
      { total: 0, issues: 0, results: [] },
      expect.any(Function),
      expect.any(Object),
    );
  });

  it("--status all omits the state filter", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "lint",
      "--status",
      "all",
    ]);

    const [, filter] = vi.mocked(fetchIssuesForLint).mock.calls[0];
    expect(filter).toEqual({});
  });

  it("--type bug compiles to a type:bug label filter", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "lint",
      "--type",
      "bug",
    ]);

    const [, filter] = vi.mocked(fetchIssuesForLint).mock.calls[0] as [
      unknown,
      { labels?: { name: { eq: string } } },
    ];
    expect(filter.labels).toEqual({ name: { eq: "type:bug" } });
  });

  it("rejects an unknown --status value", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "lint",
      "--status",
      "wat",
    ]);

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(fetchIssuesForLint).not.toHaveBeenCalled();
  });

  it("resolves positional identifiers before delegating the lint read", async () => {
    const program = createProgram();

    await program.parseAsync(["node", "test", "issues", "lint", "ENG-42"]);

    expect(resolveIssueId).toHaveBeenCalledWith(expect.anything(), "ENG-42");
    expect(getIssueForLint).toHaveBeenCalledWith(
      expect.anything(),
      "resolved-issue-uuid",
    );
    expect(fetchIssuesForLint).not.toHaveBeenCalled();
  });

  it("emits the buildLintSummary result via outputResult", async () => {
    vi.mocked(buildLintSummary).mockReturnValueOnce({
      total: 3,
      issues: 2,
      results: [
        {
          id: "a",
          identifier: "T-1",
          title: "bug-a",
          type: "bug",
          missing: ["## Steps to Reproduce", "## Acceptance Criteria"],
          warnings: 2,
        },
        {
          id: "b",
          identifier: "T-2",
          title: "task-b",
          type: "task",
          missing: ["## Acceptance Criteria"],
          warnings: 1,
        },
      ],
    });

    const program = createProgram();
    await program.parseAsync(["node", "test", "issues", "lint"]);

    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({ total: 3, issues: 2 }),
      expect.any(Function),
      expect.any(Object),
    );
  });

  it("--fix injects missing sections and saves via updateIssue (lin-xn2c)", async () => {
    vi.mocked(fetchIssuesForLint).mockResolvedValueOnce([
      {
        id: "bug-1",
        identifier: "T-9",
        title: "broken",
        description: "just a body",
        labels: { nodes: [{ id: "lb", name: "type:bug" }] },
      },
    ] as never);
    const program = createProgram();
    await program.parseAsync(["node", "test", "issues", "lint", "--fix"]);

    expect(updateIssue).toHaveBeenCalledWith(
      expect.anything(),
      "bug-1",
      expect.objectContaining({
        description: expect.stringContaining("## Steps to Reproduce"),
      }),
    );
  });

  it("--fix is a no-op (no updateIssue) when nothing is missing", async () => {
    vi.mocked(fetchIssuesForLint).mockResolvedValueOnce([
      {
        id: "ok-1",
        identifier: "T-10",
        title: "fine",
        description:
          "## Context\n\nwhy\n\n## Acceptance Criteria\n\ndone\n\n## Test Plan\n\nnpm test",
        labels: { nodes: [{ id: "lt", name: "type:task" }] },
      },
    ] as never);
    const program = createProgram();
    await program.parseAsync(["node", "test", "issues", "lint", "--fix"]);

    expect(updateIssue).not.toHaveBeenCalled();
  });
});

describe("issues history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveIssueId).mockResolvedValue("resolved-issue-uuid");
    vi.mocked(getIssueHistory).mockResolvedValue({
      issue: {
        id: "resolved-issue-uuid",
        identifier: "TES-1",
        title: "demo",
      },
      events: [],
      total: 0,
    });
  });

  it("resolves the issue id and calls getIssueHistory with limit=0 by default", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "issues", "history", "TES-1"]);

    expect(resolveIssueId).toHaveBeenCalledWith(expect.anything(), "TES-1");
    expect(getIssueHistory).toHaveBeenCalledWith(
      expect.anything(),
      "resolved-issue-uuid",
      0,
    );
  });

  it("passes --limit through to getIssueHistory", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "history",
      "TES-1",
      "--limit",
      "5",
    ]);

    expect(getIssueHistory).toHaveBeenCalledWith(
      expect.anything(),
      "resolved-issue-uuid",
      5,
    );
  });

  it("rejects a negative --limit value", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "history",
      "TES-1",
      "--limit",
      "-3",
    ]);

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(getIssueHistory).not.toHaveBeenCalled();
  });

  it("emits the history result via outputResult", async () => {
    vi.mocked(getIssueHistory).mockResolvedValueOnce({
      issue: {
        id: "resolved-issue-uuid",
        identifier: "TES-1",
        title: "demo",
      },
      events: [
        {
          id: "ev-1",
          createdAt: "2026-05-10T12:00:00.000Z",
          actor: null,
          fromState: null,
          toState: null,
          fromPriority: null,
          toPriority: 2,
          fromTitle: null,
          toTitle: null,
          fromAssignee: null,
          toAssignee: null,
          fromParent: null,
          toParent: null,
          addedLabels: [],
          removedLabels: [],
          updatedDescription: false,
        },
      ],
      total: 1,
    });

    const program = createProgram();
    await program.parseAsync(["node", "test", "issues", "history", "TES-1"]);

    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({
        issue: expect.objectContaining({ identifier: "TES-1" }),
        total: 1,
      }),
      expect.any(Function),
      expect.anything(),
    );
  });
});

describe("issues snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(writeSnapshot).mockResolvedValue({
      label: "v1",
      path: "/tmp/snap/v1.jsonl",
      meta: {
        label: "v1",
        created_at: "2026-05-12T00:00:00.000Z",
        issue_count: 0,
      },
    });
    vi.mocked(listSnapshots).mockReturnValue([]);
  });

  it("calls writeSnapshot with the user-supplied label", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "snapshot",
      "before-sprint-7",
    ]);

    expect(writeSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      "before-sprint-7",
    );
    expect(listSnapshots).not.toHaveBeenCalled();
  });

  it("calls writeSnapshot with undefined when no label is given", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "issues", "snapshot"]);

    expect(writeSnapshot).toHaveBeenCalledWith(expect.anything(), undefined);
  });

  it("--list emits the listSnapshots result without writing", async () => {
    vi.mocked(listSnapshots).mockReturnValueOnce([
      { label: "v1", created_at: "2026-05-12T00:00:00.000Z", issue_count: 12 },
    ]);
    const program = createProgram();
    await program.parseAsync(["node", "test", "issues", "snapshot", "--list"]);

    expect(writeSnapshot).not.toHaveBeenCalled();
    expect(outputResult).toHaveBeenCalledWith(
      {
        snapshots: [
          {
            label: "v1",
            created_at: "2026-05-12T00:00:00.000Z",
            issue_count: 12,
          },
        ],
      },
      expect.any(Function),
      expect.anything(),
    );
  });
});

describe("issues diff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadSnapshotByRef).mockResolvedValue({ label: "x", issues: [] });
    vi.mocked(computeDiff).mockReturnValue([]);
  });

  it("loads both snapshot refs and emits the computed diff", async () => {
    vi.mocked(loadSnapshotByRef)
      .mockResolvedValueOnce({ label: "from", issues: [] })
      .mockResolvedValueOnce({ label: "to", issues: [] });
    vi.mocked(computeDiff).mockReturnValueOnce([
      {
        issue_id: "u1",
        diff_type: "added",
        old_value: null,
        new_value: {
          id: "u1",
          identifier: "TES-1",
          title: "x",
          description: "",
          priority: 0,
          status: "started",
        },
      },
    ]);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "diff",
      "before",
      "live",
    ]);

    expect(loadSnapshotByRef).toHaveBeenCalledTimes(2);
    expect(loadSnapshotByRef).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      "before",
    );
    expect(loadSnapshotByRef).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "live",
    );
    expect(computeDiff).toHaveBeenCalled();
    expect(outputResult).toHaveBeenCalledWith(
      [expect.objectContaining({ issue_id: "u1", diff_type: "added" })],
      expect.any(Function),
      expect.anything(),
    );
  });
});

describe("issues create validation gate (lin-z3b3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    // Default: getConfig reports "not found" so the mode resolves to its
    // production default ("error" — block by default).
    vi.mocked(getConfig).mockReturnValue({
      key: "validation.on-create",
      value: null,
      found: false,
      source: "default",
    });
  });

  // --- pure helpers -------------------------------------------------------

  it("assembleCreateDescription splices flag sections into the body and satisfies the gate", () => {
    const body = assembleCreateDescription({
      description: "Intro",
      context: "why",
      acceptance: "done",
      test: "vitest",
    });
    expect(body).toContain("Intro");
    expect(body).toContain("## Context");
    expect(body).toContain("## Acceptance Criteria");
    expect(body).toContain("## Test Plan");
    expect(validateCreateDescription(body ?? "")).toEqual([]);
  });

  it("assembleCreateDescription returns undefined when nothing is supplied", () => {
    expect(assembleCreateDescription({})).toBeUndefined();
  });

  it("assembleCreateDescription folds --notes into a ## Notes section (lin-8yl1.3)", () => {
    const body = assembleCreateDescription({
      description: "Intro",
      notes: "extra context for the agent",
    });
    expect(body).toContain("Intro");
    expect(body).toContain("## Notes");
    expect(body).toContain("extra context for the agent");
  });

  it("assembleCreateDescription returns a body when only --notes is supplied", () => {
    const body = assembleCreateDescription({ notes: "standalone" });
    expect(body).toBeDefined();
    expect(body).toContain("## Notes");
    expect(body).toContain("standalone");
  });

  it("formatCreateDryRun renders the resolved preview without mutation (lin-jw2x)", () => {
    const out = formatCreateDryRun({
      dry_run: true,
      title: "Build the thing",
      team: "TES",
      team_source: "config:team.default",
      type: "feature",
      priority: 2,
      estimate: 3,
      status: "Todo",
      assignee: "alice",
      project: "Platform",
      parent: "TES-1",
      labels: ["type:feature", "area:api"],
      description: "## Context\n\nwhy this exists",
      relations: [{ type: "blocks", targets: ["TES-2", "TES-3"] }],
    });
    expect(out).toContain("[DRY RUN] Would create issue:");
    expect(out).toContain("Title: Build the thing");
    expect(out).toContain("Team: TES [from config:team.default]");
    expect(out).toContain("Type: feature");
    expect(out).toContain("Priority: P2");
    expect(out).toContain("Labels: type:feature, area:api");
    expect(out).toContain("blocks: TES-2, TES-3");
    expect(out).toContain("nothing was created");
  });

  it("formatCreateDryRun omits empty fields and the [from] hint for explicit teams", () => {
    const out = formatCreateDryRun({
      dry_run: true,
      title: "Minimal",
      team: "TES",
      team_source: "flag",
      type: null,
      priority: null,
      estimate: null,
      status: null,
      assignee: null,
      project: null,
      parent: null,
      labels: [],
      description: null,
      relations: [],
    });
    expect(out).toContain("Team: TES");
    expect(out).not.toContain("[from");
    expect(out).not.toContain("Priority:");
    expect(out).not.toContain("Labels:");
  });

  it("normalizeIssueType maps type aliases and passes others through (lin-8yl1.2)", () => {
    expect(normalizeIssueType("feat")).toBe("feature");
    expect(normalizeIssueType("enhancement")).toBe("feature");
    expect(normalizeIssueType("dec")).toBe("decision");
    expect(normalizeIssueType("adr")).toBe("decision");
    expect(normalizeIssueType("BUG")).toBe("bug");
    expect(normalizeIssueType("  epic ")).toBe("epic");
    expect(normalizeIssueType("custom-thing")).toBe("custom-thing");
  });

  it("resolveCreateValidationMode: --no-validate (false) wins → off", () => {
    expect(resolveCreateValidationMode(false)).toBe("off");
  });

  it("resolveCreateValidationMode: --validate (true) wins → error even when config is off", () => {
    vi.mocked(getConfig).mockReturnValue({
      key: "validation.on-create",
      value: "off",
      found: true,
      source: "local",
    });
    expect(resolveCreateValidationMode(true)).toBe("error");
  });

  it("resolveCreateValidationMode: default (no config) → error", () => {
    expect(resolveCreateValidationMode(undefined)).toBe("error");
  });

  it("resolveCreateValidationMode: config warn / off honored", () => {
    vi.mocked(getConfig).mockReturnValue({
      key: "validation.on-create",
      value: "warn",
      found: true,
      source: "local",
    });
    expect(resolveCreateValidationMode(undefined)).toBe("warn");
    vi.mocked(getConfig).mockReturnValue({
      key: "validation.on-create",
      value: "off",
      found: true,
      source: "global",
    });
    expect(resolveCreateValidationMode(undefined)).toBe("off");
  });

  // --- command-level ------------------------------------------------------

  it("blocks create (error default) when sections are missing — no API call", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "No sections",
      "--team",
      "ENG",
    ]);
    expect(createIssue).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("required sections missing or empty:"),
    );
  });

  it("--no-validate bypasses the gate and creates", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "No sections",
      "--team",
      "ENG",
      "--no-validate",
    ]);
    expect(createIssue).toHaveBeenCalled();
  });

  it("--context/--acceptance/--test satisfy the gate and create with assembled sections", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "Filled",
      "--team",
      "ENG",
      "--context",
      "why",
      "--acceptance",
      "done",
      "--test",
      "vitest",
    ]);
    expect(createIssue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        description: expect.stringContaining("## Context"),
      }),
    );
  });

  it("--validate forces the gate on even when config disables it", async () => {
    vi.mocked(getConfig).mockReturnValue({
      key: "validation.on-create",
      value: "off",
      found: true,
      source: "local",
    });
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "No sections",
      "--team",
      "ENG",
      "--validate",
    ]);
    expect(createIssue).not.toHaveBeenCalled();
  });

  it("warn mode proceeds with a stderr warning instead of blocking", async () => {
    vi.mocked(getConfig).mockReturnValue({
      key: "validation.on-create",
      value: "warn",
      found: true,
      source: "local",
    });
    const writeSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "No sections",
      "--team",
      "ENG",
    ]);
    expect(createIssue).toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalledWith(
      expect.stringContaining("required sections missing or empty:"),
    );
  });

  // --- per-type resolution (agrees with `issues lint`) --------------------

  /** Drive `issues create` with a body read from --description. */
  async function createWithBody(type: string | null, body: string) {
    const argv = [
      "node",
      "test",
      "issues",
      "create",
      "Probe",
      "--team",
      "ENG",
      "--description",
      body,
    ];
    if (type) argv.push("--type", type);
    await createProgram().parseAsync(argv);
  }

  const CONTEXT = "## Context\n\nwhy.\n\n";
  const TEST_PLAN = "\n\n## Test Plan\n\nnpm test\n";

  it("an epic body with ## Success Criteria passes", async () => {
    await createWithBody(
      "epic",
      `${CONTEXT}## Success Criteria\n\n- a thing is true${TEST_PLAN}`,
    );
    expect(createIssue).toHaveBeenCalled();
  });

  it("an epic body with only ## Acceptance Criteria is blocked", async () => {
    await createWithBody(
      "epic",
      `${CONTEXT}## Acceptance Criteria\n\n- [ ] true${TEST_PLAN}`,
    );
    expect(createIssue).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("## Success Criteria"),
    );
  });

  it("a task body with ## Acceptance Criteria passes", async () => {
    await createWithBody(
      "task",
      `${CONTEXT}## Acceptance Criteria\n\n- [ ] true${TEST_PLAN}`,
    );
    expect(createIssue).toHaveBeenCalled();
  });

  it("a chore body needs ## Acceptance Criteria like any other work", async () => {
    await createWithBody("chore", `${CONTEXT}${TEST_PLAN}`);
    expect(createIssue).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("## Acceptance Criteria"),
    );
  });

  it("a chore body with ## Acceptance Criteria passes", async () => {
    await createWithBody(
      "chore",
      `${CONTEXT}## Acceptance Criteria\n\n- [ ] true${TEST_PLAN}`,
    );
    expect(createIssue).toHaveBeenCalled();
  });

  // --- shape repair (the gate rewrites, then creates) --------------------

  /** The description `createIssue` was actually called with. */
  function createdDescription(): string {
    const [, input] = vi.mocked(createIssue).mock.calls[0];
    return (input as { description: string }).description;
  }

  it("rewrites bare criteria lines into checkboxes before creating", async () => {
    await createWithBody(
      "task",
      `${CONTEXT}## Acceptance Criteria\n\nThe list renders every session.\nSelecting one opens it.${TEST_PLAN}`,
    );
    expect(createIssue).toHaveBeenCalled();
    const body = createdDescription();
    expect(body).toContain("- [ ] The list renders every session.");
    expect(body).toContain("- [ ] Selecting one opens it.");
  });

  it("says on stderr what it reformatted", async () => {
    const writeSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    await createWithBody(
      "task",
      `${CONTEXT}## Acceptance Criteria\n\nbare claim${TEST_PLAN}`,
    );
    expect(writeSpy).toHaveBeenCalledWith(
      expect.stringContaining("formatted to match the template"),
    );
  });

  it("leaves the Context and Test Plan prose exactly as written", async () => {
    await createWithBody(
      "task",
      `${CONTEXT}## Acceptance Criteria\n\n- [ ] fine${TEST_PLAN}`,
    );
    const body = createdDescription();
    expect(body).toContain("why.");
    expect(body).toContain("npm test");
    expect(body).not.toContain("- npm test");
    expect(body).not.toContain("- why.");
  });

  it("refuses a required section that is present but empty", async () => {
    // Formatting has one right answer so the CLI applies it; missing content
    // does not, so the CLI asks for it.
    await createWithBody(
      "task",
      `${CONTEXT}## Acceptance Criteria\n${TEST_PLAN}`,
    );
    expect(createIssue).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("## Acceptance Criteria"),
    );
  });

  it("a bug still needs ## Steps to Reproduce", async () => {
    await createWithBody(
      "bug",
      `${CONTEXT}## Acceptance Criteria\n\n- [ ] true${TEST_PLAN}`,
    );
    expect(createIssue).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("## Steps to Reproduce"),
    );
  });

  it("resolves --type aliases before picking the contract (feat -> feature)", async () => {
    await createWithBody(
      "feat",
      `${CONTEXT}## Success Criteria\n\n-x${TEST_PLAN}`,
    );
    expect(createIssue).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("## Acceptance Criteria"),
    );
  });

  it("an untyped create is still held to the full template", async () => {
    await createWithBody(null, `${CONTEXT}${TEST_PLAN}`);
    expect(createIssue).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("## Acceptance Criteria"),
    );
  });

  it("--no-validate still bypasses the per-type gate", async () => {
    await createProgram().parseAsync([
      "node",
      "test",
      "issues",
      "create",
      "Probe",
      "--team",
      "ENG",
      "--type",
      "epic",
      "--no-validate",
    ]);
    expect(createIssue).toHaveBeenCalled();
  });

  // --- team provenance (lin-4wvh) ----------------------------------------

  it("formatIssueCreate prints a provenance hint for an implied team", () => {
    const out = formatIssueCreate({
      identifier: "ENG-1",
      title: "T",
      team_provenance: { team: "ENG", source: "scope.team" },
    });
    expect(out).toContain("Team: ENG [from scope.team]");
  });

  it("formatIssueCreate omits the hint for an explicit --team (flag)", () => {
    const out = formatIssueCreate({
      identifier: "ENG-1",
      title: "T",
      team_provenance: { team: "ENG", source: "flag" },
    });
    expect(out).not.toContain("[from");
  });
});

describe("sortQueryResults — query --sort field coverage", () => {
  // lin-1cs6: `completed` and `type` were advertised in `query --help`
  // but rejected by the runtime allowlist. These assert parity with the
  // help string: every advertised field sorts instead of throwing.
  const label = (name: string) => ({ nodes: [{ name }] });

  it("sorts by completed (completedAt) ascending and reversed", () => {
    const nodes = [
      { id: "a", completedAt: "2026-03-01T00:00:00Z" },
      { id: "b", completedAt: "2026-01-01T00:00:00Z" },
      { id: "c", completedAt: "2026-02-01T00:00:00Z" },
    ];
    expect(
      sortQueryResults(nodes, "completed", false).map((n) => n.id),
    ).toEqual(["b", "c", "a"]);
    expect(sortQueryResults(nodes, "completed", true).map((n) => n.id)).toEqual(
      ["a", "c", "b"],
    );
  });

  it("places issues with no completedAt first when ascending", () => {
    const nodes = [
      { id: "done", completedAt: "2026-01-01T00:00:00Z" },
      { id: "open", completedAt: null },
    ];
    expect(
      sortQueryResults(nodes, "completed", false).map((n) => n.id),
    ).toEqual(["open", "done"]);
  });

  it("sorts by type using the type:* label, defaulting to task", () => {
    const nodes = [
      { id: "task", labels: label("type:task") },
      { id: "bug", labels: label("type:bug") },
      { id: "epic", labels: label("type:epic") },
      { id: "untyped", labels: { nodes: [] } },
    ];
    // bug < epic < task; untyped derives "task" so it ties with the task row
    const ids = sortQueryResults(nodes, "type", false).map((n) => n.id);
    expect(ids.slice(0, 2)).toEqual(["bug", "epic"]);
    expect(ids.slice(2).sort()).toEqual(["task", "untyped"]);
  });

  it("accepts every field advertised in query --help", () => {
    const fields = [
      "priority",
      "created",
      "updated",
      "completed",
      "status",
      "id",
      "title",
      "type",
      "assignee",
    ];
    for (const f of fields) {
      expect(() => sortQueryResults([{ id: "x" }], f, false)).not.toThrow();
    }
  });

  it("still rejects an unsupported sort field", () => {
    expect(() => sortQueryResults([{ id: "x" }], "bogus", false)).toThrow(
      /unsupported sort field/,
    );
  });
});

describe("formatIssueHistory — delta rendering (lin-8yl1.8)", () => {
  const baseEvent = () => ({
    id: "ev",
    createdAt: "2026-05-10T12:00:00.000Z",
    actor: { displayName: "Ada", name: "ada" },
    fromState: null,
    toState: null,
    fromPriority: null,
    toPriority: null,
    fromTitle: null,
    toTitle: null,
    fromAssignee: null,
    toAssignee: null,
    fromParent: null,
    toParent: null,
    addedLabels: [],
    removedLabels: [],
    updatedDescription: false,
    relationChanges: [],
    archived: null,
    fromEstimate: null,
    toEstimate: null,
    fromDueDate: null,
    toDueDate: null,
    fromCycle: null,
    toCycle: null,
    fromProject: null,
    toProject: null,
  });

  const render = (overrides: Record<string, unknown>) =>
    formatIssueHistory({
      issue: { identifier: "TES-1" },
      events: [{ ...baseEvent(), ...overrides }],
      total: 1,
    });

  it("humanizes a known relation-change code (ab → added blocks)", () => {
    const out = render({
      relationChanges: [{ identifier: "TES-9", type: "ab" }],
    });
    expect(out).toContain("relation added: blocks TES-9");
  });

  it("humanizes a removal code (rb → removed blocks)", () => {
    const out = render({
      relationChanges: [{ identifier: "TES-9", type: "rb" }],
    });
    expect(out).toContain("relation removed: blocks TES-9");
  });

  it("falls back to the raw code for an unverified relation type", () => {
    const out = render({
      relationChanges: [{ identifier: "TES-9", type: "xz" }],
    });
    expect(out).toContain("relation changed (xz): TES-9");
  });

  it("renders archive, estimate, due-date, cycle and project deltas", () => {
    expect(render({ archived: true })).toContain("archived");
    expect(render({ archived: false })).toContain("unarchived");
    expect(render({ fromEstimate: 1, toEstimate: 3 })).toContain(
      "estimate: 1 → 3",
    );
    expect(render({ fromDueDate: null, toDueDate: "2026-02-01" })).toContain(
      "due date: (none) → 2026-02-01",
    );
    expect(
      render({
        fromCycle: { name: "Sprint 1", number: 1 },
        toCycle: { name: null, number: 2 },
      }),
    ).toContain("cycle: Sprint 1 (#1) → Cycle 2 (#2)");
    expect(
      render({ fromProject: { name: "Old" }, toProject: { name: "New" } }),
    ).toContain("project: Old → New");
  });

  it("still reports '(no field deltas recorded)' for an empty event", () => {
    expect(render({})).toContain("(no field deltas recorded)");
  });
});
