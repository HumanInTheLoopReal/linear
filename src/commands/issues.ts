import fs from "node:fs";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import type { Command } from "commander";
import { resolveAgentLimit } from "../common/agent-mode.js";
import {
  resolveBodyInput,
  resolveDesignInput,
  resolveReasonInput,
} from "../common/body-input.js";
import {
  getDefaultTeam,
  getDefaultTeamWithSource,
} from "../common/config-store.js";
import type { CommandContext } from "../common/context.js";
import { createContext, getRootOpts } from "../common/context.js";
import {
  DEFERRED_LABEL,
  DEFERRED_UNTIL_PREFIX,
  deferInstant,
} from "../common/deferred-label.js";
import { invalidParameterError } from "../common/errors.js";
import { validateEstimateAgainstTeamConfig } from "../common/estimate-validation.js";
import { isRefLabel, refLabelName } from "../common/external-ref.js";
import {
  isUuid,
  parseDueDate,
  parseIssueIdentifier,
} from "../common/identifier.js";
import { prepareIssueFilterOptions } from "../common/issue-filter-orchestration.js";
import {
  CLOSED_STATE_TYPES,
  isNonClosedStateType,
} from "../common/issue-lifecycle.js";
import { withListMeta } from "../common/list-meta.js";
import { appendSection, replaceSection } from "../common/markdown-sections.js";
import {
  applyMetadataEdits,
  extractMetadata,
  type Metadata,
  mergeMetadata,
  parseMetadataJson,
  withMetadataBlock,
} from "../common/metadata-block.js";
import {
  parseEstimateOption,
  parsePriorityOption,
} from "../common/number-options.js";
import {
  handleCommand,
  outputIdOnly,
  outputResult,
  parseLimit,
} from "../common/output.js";
import {
  applyScopeToFilter,
  resolveScopeOption,
} from "../common/scope-filter.js";
import { parseDeferWhen } from "../common/snooze-input.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import {
  type IssueCreateInput,
  type IssueFilter,
  IssueRelationType,
  type IssueUpdateInput,
} from "../gql/graphql.js";
import { resolveCycleId } from "../resolvers/cycle-resolver.js";
import { resolveFilterOptions } from "../resolvers/issue-filter-options-resolver.js";
import {
  resolveIssueEstimateContext,
  resolveIssueId,
} from "../resolvers/issue-resolver.js";
import {
  resolveLabelId,
  resolveLabelIds,
} from "../resolvers/label-resolver.js";
import { resolveMilestoneId } from "../resolvers/milestone-resolver.js";
import { resolveProjectId } from "../resolvers/project-resolver.js";
import {
  resolveStateIdByType,
  resolveStatusId,
} from "../resolvers/status-resolver.js";
import {
  resolveTeamEstimateContext,
  resolveTeamId,
} from "../resolvers/team-resolver.js";
import { resolveUserId } from "../resolvers/user-resolver.js";
import { pullIssue, pushIssue } from "../services/issue-edit-service.js";
import { buildIssueFilter } from "../services/issue-filter.js";
import {
  createIssueRelation,
  deleteIssueRelation,
  findIssueRelation,
} from "../services/issue-relation-service.js";
import {
  appendNote,
  type ChecklistToggleResult,
  createIssue,
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
  toggleChecklistItem,
  updateIssue,
} from "../services/issue-service.js";
import {
  ensureWorkspaceLabel,
  ensureWorkspaceLabelIds,
} from "../services/label-service.js";
import { resolveRequiredSections } from "../services/lint-service.js";
import {
  astToString,
  compile,
  hasExplicitStatusFilter,
  parseQuery,
} from "../services/query-language/index.js";
import {
  getStateValue,
  listStateDimensions,
  setStateLabel,
} from "../services/state-service.js";
import {
  checkAgainstTemplate,
  enforceCreateValidation,
} from "./_create-validation.js";
import { priorityCol, statusIcon } from "./_format.js";
import { registerIssueActivityCommand } from "./issues/activity.js";
import { registerIssueAnalysisCommands } from "./issues/analysis.js";
import { registerIssueDiscussionCommands } from "./issues/discussions.js";
import { registerIssueHistoryCommand } from "./issues/history.js";
import {
  registerIssueLifecycleCommands,
  type TransitionRowShape,
} from "./issues/lifecycle.js";
import { registerIssueLintCommand } from "./issues/lint.js";
import {
  formatIssueList,
  hasDeferredLabel,
  type ListIssueShape,
} from "./issues/list-format.js";
import {
  addFilterOptions,
  attachCommentCounts,
  type FilterOptions,
  registerIssueReportCommands,
  warnMissingLabels,
} from "./issues/reports.js";
import { registerIssueSnapshotCommands } from "./issues/snapshots.js";
import { registerIssueTransferCommands } from "./issues/transfer.js";

export {
  enforceCreateValidation,
  resolveCreateValidationMode,
} from "./_create-validation.js";
export {
  formatCloseEligibleEpicsClosed,
  formatCloseEligibleEpicsDryRun,
  formatIssueEpicStatus,
  runCloseEligibleEpics,
  runEpicStatus,
} from "./_epic-status.js";
export { formatIssueImport } from "./_issue-import-format.js";
export {
  formatThreadResolved,
  formatThreadUnresolved,
} from "./comments.js";
export {
  formatDuplicateGroups,
  formatDuplicatePairs,
  formatIssueShip,
  formatMarkedDuplicates,
  type ShipResultShape,
} from "./issues/analysis.js";
export { formatIssueHistory } from "./issues/history.js";
export {
  type ClaimedNextRow,
  formatClaimedNext,
  formatIssueClose,
  formatIssueReopen,
  formatNewlyUnblocked,
  type NewlyUnblockedRow,
  type TransitionRowShape,
} from "./issues/lifecycle.js";
export { formatIssueLint, formatIssueLintFix } from "./issues/lint.js";
export {
  type FormatIssueListOptions,
  formatIssueList,
} from "./issues/list-format.js";
export {
  formatIssueCount,
  formatIssueCountGrouped,
  formatIssueStatus,
  formatIssueStatuses,
  formatIssueTypes,
} from "./issues/reports.js";
export {
  formatDiff,
  formatSnapshotList,
  formatSnapshotWritten,
} from "./issues/snapshots.js";
export {
  formatIssueArchive,
  formatIssueDelete,
  formatIssueExport,
  formatIssueUnarchive,
  type IssueExportEchoShape,
} from "./issues/transfer.js";

interface CreateOptions {
  description?: string;
  bodyFile?: string;
  stdin?: boolean;
  design?: string;
  designFile?: string;
  designStdin?: boolean;
  context?: string;
  acceptance?: string;
  test?: string;
  /**
   * Tri-state create-time validation control (commander `--validate` /
   * `--no-validate`): `true` forces the gate on (error mode), `false` skips
   * it, `undefined` defers to the `validation.on-create` config (default
   * `error` — block by default).
   */
  validate?: boolean;
  dryRun?: boolean;
  type?: string;
  notes?: string;
  assignee?: string;
  priority?: string;
  estimate?: string;
  project?: string;
  team?: string;
  labels?: string;
  projectMilestone?: string;
  cycle?: string;
  status?: string;
  parentTicket?: string;
  dueDate?: string;
  blocks?: string;
  blockedBy?: string;
  relatesTo?: string;
  duplicateOf?: string;
  scope?: string | boolean;
  externalRef?: string;
  metadata?: string;
  /**
   * `--defer <when>` files the issue already deferred:
   * the resurface date, parsed with snooze's NL/relative grammar, becomes a
   * `deferred` + `deferred-until:<suffix>` label pair at creation. (lin-ov30.4)
   */
  defer?: string;
  /**
   * Commander negation flag (`--no-assign`): `false` leaves the issue
   * unassigned; `undefined`/`true` auto-assigns the creator (@me) by default.
   * `--assignee` overrides either way.
   */
  assign?: boolean;
}

interface UpdateOptions {
  title?: string;
  description?: string;
  bodyFile?: string;
  stdin?: boolean;
  design?: string;
  designFile?: string;
  designStdin?: boolean;
  context?: string;
  acceptance?: string;
  test?: string;
  notes?: string;
  appendNotes?: string;
  status?: string;
  priority?: string;
  estimate?: string;
  clearEstimate?: boolean;
  assignee?: string;
  clearAssignee?: boolean;
  project?: string;
  labels?: string;
  labelMode?: string;
  clearLabels?: boolean;
  parentTicket?: string;
  clearParentTicket?: boolean;
  projectMilestone?: string;
  clearProjectMilestone?: boolean;
  cycle?: string;
  clearCycle?: boolean;
  dueDate?: string;
  clearDueDate?: boolean;
  blocks?: string;
  blockedBy?: string;
  relatesTo?: string;
  duplicateOf?: string;
  removeRelation?: string;
  externalRef?: string;
  clearExternalRef?: boolean;
  metadata?: string;
  setMetadata?: string[];
  unsetMetadata?: string[];
}

interface ReadOptions {
  withAttachments?: boolean;
  withComments?: boolean;
  withCommentThreads?: boolean;
  withReactions?: boolean;
}

function validateReadOptions(options: ReadOptions): void {
  if (
    options.withReactions &&
    (options.withAttachments ||
      options.withComments ||
      options.withCommentThreads)
  ) {
    throw invalidParameterError(
      "--with-reactions",
      "cannot be combined with --with-attachments, --with-comments, or --with-comment-threads",
    );
  }
}

export const ISSUES_META: DomainMeta = {
  name: "issues",
  summary: "work items with status, priority, assignee, labels",
  context: [
    "an issue belongs to exactly one team. it has a status (e.g. backlog,",
    "todo, in progress, done — configurable per team), a priority (1-4),",
    "and can be assigned to a user. issues can have estimates; valid values",
    "are integers whose meaning depends on the team's estimation scale",
    "(fibonacci, exponential, linear, or t-shirt sizes mapped to integers).",
    "issues can have labels, a due date, belong to a project, be part of a",
    "cycle (sprint), and reference a project milestone. parent-child",
    "relationships and issue relations (blocks, blocked-by, relates-to,",
    "duplicate-of) are supported.",
  ].join("\n"),
  arguments: {
    issue: "issue identifier (UUID or ABC-123)",
    title: "string",
    query: "full-text search term",
  },
  seeAlso: [
    "comments create <issue>",
    "documents list --issue <issue>",
    "attachments list <issue>",
    "issues read --with-attachments",
    "issues archive <issue>",
    "issues unarchive <issue>",
    "issues delete <issue>",
  ],
};

interface RelationAction {
  type: "blocks" | "blockedBy" | "relatesTo" | "duplicateOf" | "remove";
  targets: string[];
}

function parseRelationFlags(flags: {
  blocks?: string;
  blockedBy?: string;
  relatesTo?: string;
  duplicateOf?: string;
  removeRelation?: string;
}): RelationAction[] {
  const entries: Array<{
    type: RelationAction["type"];
    raw: string | undefined;
  }> = [
    { type: "blocks", raw: flags.blocks },
    { type: "blockedBy", raw: flags.blockedBy },
    { type: "relatesTo", raw: flags.relatesTo },
    { type: "duplicateOf", raw: flags.duplicateOf },
    { type: "remove", raw: flags.removeRelation },
  ];

  const actions: RelationAction[] = [];
  const hasAdd = entries.some((e) => e.type !== "remove" && e.raw);
  const hasRemove = entries.some((e) => e.type === "remove" && e.raw);

  if (hasAdd && hasRemove) {
    throw new Error("Cannot mix add and remove relation flags");
  }

  for (const { type, raw } of entries) {
    if (!raw) continue;

    const targets = [
      ...new Set(
        raw
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      ),
    ];
    if (targets.length === 0) {
      throw new Error(
        `Relation flag --${type === "remove" ? "remove-relation" : type} must not be empty`,
      );
    }
    actions.push({ type, targets });
  }

  // Cross-flag collision check
  const seen = new Map<string, string>();
  for (const action of actions) {
    for (const target of action.targets) {
      const prev = seen.get(target);
      if (prev) {
        throw new Error(
          `${target} appears in multiple relation flags (${prev} and --${action.type === "remove" ? "remove-relation" : action.type})`,
        );
      }
      seen.set(
        target,
        `--${action.type === "remove" ? "remove-relation" : action.type}`,
      );
    }
  }

  return actions;
}

async function resolveAndApplyRelations(
  ctx: CommandContext,
  issueId: string,
  actions: RelationAction[],
): Promise<void> {
  // Resolve all unique targets to UUIDs
  const uniqueTargets = new Set(actions.flatMap((a) => a.targets));
  const resolved = new Map<string, string>();
  await Promise.all(
    [...uniqueTargets].map(async (target) => {
      resolved.set(target, await resolveIssueId(ctx.sdk, target));
    }),
  );

  for (const action of actions) {
    for (const target of action.targets) {
      const targetId = resolved.get(target)!;

      switch (action.type) {
        case "blocks":
          await createIssueRelation(ctx.gql, {
            issueId,
            relatedIssueId: targetId,
            type: IssueRelationType.Blocks,
          });
          break;
        case "blockedBy":
          await createIssueRelation(ctx.gql, {
            issueId: targetId,
            relatedIssueId: issueId,
            type: IssueRelationType.Blocks,
          });
          break;
        case "relatesTo":
          await createIssueRelation(ctx.gql, {
            issueId,
            relatedIssueId: targetId,
            type: IssueRelationType.Related,
          });
          break;
        case "duplicateOf":
          await createIssueRelation(ctx.gql, {
            issueId,
            relatedIssueId: targetId,
            type: IssueRelationType.Duplicate,
          });
          break;
        case "remove": {
          const relationId = await findIssueRelation(
            ctx.gql,
            issueId,
            targetId,
          );
          await deleteIssueRelation(ctx.gql, relationId);
          break;
        }
      }
    }
  }
}

import type { CreatedIssue } from "../common/types.js";

type CreateFormResult = CreatedIssue | { canceled: true };

const FORM_TYPES = [
  "task",
  "bug",
  "feature",
  "epic",
  "chore",
  "decision",
  "spike",
  "story",
  "milestone",
];

/**
 * Normalize a user-supplied `--type` value to its canonical slug, applying
 * the documented aliases (feat/enhancement → feature, dec/adr → decision).
 * Unknown values pass through (lowercased) so workspace-custom types still
 * resolve to a `type:<value>` label (lin-8yl1.2).
 */
export function normalizeIssueType(raw: string): string {
  const t = raw.trim().toLowerCase();
  switch (t) {
    case "feat":
    case "enhancement":
      return "feature";
    case "dec":
    case "adr":
      return "decision";
    default:
      return t;
  }
}

async function runCreateForm(
  ctx: CommandContext,
  opts: { parent?: string },
): Promise<CreateFormResult> {
  const rl = createInterface({ input, output });
  try {
    process.stderr.write(
      "Create an issue (Ctrl+C to cancel). Leave optional fields blank to skip.\n\n",
    );

    let title = "";
    while (true) {
      title = (await rl.question("Title (required, max 500 chars): ")).trim();
      if (title.length === 0) {
        process.stderr.write("  title is required\n");
        continue;
      }
      if (title.length > 500) {
        process.stderr.write("  title must be 500 characters or less\n");
        continue;
      }
      break;
    }

    let teamId = "";
    while (true) {
      const team = (
        await rl.question("Team key or UUID (required, e.g. ENG): ")
      ).trim();
      if (team.length === 0) {
        process.stderr.write("  team is required\n");
        continue;
      }
      try {
        teamId = await resolveTeamId(ctx.sdk, team);
        break;
      } catch (err) {
        process.stderr.write(
          `  could not resolve team: ${(err as Error).message}\n`,
        );
      }
    }

    const description = (await rl.question("Description (optional): ")).trim();

    const context = (
      await rl.question("Context — why this work exists, ## Context section: ")
    ).trim();

    process.stderr.write(`  available types: ${FORM_TYPES.join(", ")}\n`);
    const typeRaw = (
      await rl.question("Type (optional, default: task): ")
    ).trim();
    const typeValue = typeRaw.length > 0 ? typeRaw : "task";

    process.stderr.write(
      "  priority: 1=urgent 2=high 3=medium 4=low (blank = no priority)\n",
    );
    const priorityStr = (
      await rl.question("Priority (optional, 1-4): ")
    ).trim();
    const priority =
      priorityStr.length > 0 ? parsePriorityOption(priorityStr) : undefined;

    const assigneeRaw = (
      await rl.question("Assignee (username or email, optional): ")
    ).trim();

    const labelsRaw = (
      await rl.question("Labels (comma-separated, optional): ")
    ).trim();

    const design = (
      await rl.question("Design notes — ## Design section (optional): ")
    ).trim();

    const acceptance = (
      await rl.question(
        "Acceptance criteria — ## Acceptance Criteria section: ",
      )
    ).trim();

    const test = (
      await rl.question(
        "Test plan — how this is verified, ## Test Plan section: ",
      )
    ).trim();

    // Assemble the description (incl. the Linear-Hack sections) BEFORE the
    // confirm so we can warn about any missing required sections while the
    // human is still in control. Unlike the agent `create` path this never
    // blocks — an interactive human who confirms is making a deliberate call.
    let finalDescription = description;
    if (design.length > 0) {
      finalDescription = replaceSection(finalDescription, "## Design", design);
    }
    if (context.length > 0) {
      finalDescription = replaceSection(
        finalDescription,
        "## Context",
        context,
      );
    }
    if (acceptance.length > 0) {
      finalDescription = replaceSection(
        finalDescription,
        "## Acceptance Criteria",
        acceptance,
      );
    }
    if (test.length > 0) {
      finalDescription = replaceSection(finalDescription, "## Test Plan", test);
    }

    const checked = checkAgainstTemplate(
      finalDescription,
      resolveRequiredSections(normalizeIssueType(typeValue)),
    );
    finalDescription = checked.description;
    if (checked.notice) process.stderr.write(`✎ ${checked.notice}\n`);
    if (checked.problems.length > 0) {
      process.stderr.write(
        `⚠ still missing recommended sections: ${checked.problems.join(", ")}\n`,
      );
    }

    const confirmAnswer = (await rl.question("Create this issue? (Y/n): "))
      .trim()
      .toLowerCase();
    if (
      confirmAnswer !== "" &&
      confirmAnswer !== "y" &&
      confirmAnswer !== "yes"
    ) {
      return { canceled: true };
    }

    const labelIds: string[] = [];
    if (typeValue.length > 0) {
      const typeLabelId = await ensureWorkspaceLabel(
        ctx.gql,
        `type:${typeValue}`,
        `Issue type: ${typeValue}`,
      );
      labelIds.push(typeLabelId);
    }
    if (labelsRaw.length > 0) {
      const userLabelNames = labelsRaw
        .split(",")
        .map((l) => l.trim())
        .filter(Boolean);
      if (userLabelNames.length > 0) {
        const userLabelIds = await resolveLabelIds(ctx.sdk, userLabelNames);
        labelIds.push(...userLabelIds);
      }
    }

    const issueInput: IssueCreateInput = { title, teamId };
    if (finalDescription.length > 0) issueInput.description = finalDescription;
    if (priority !== undefined) issueInput.priority = priority;
    if (assigneeRaw.length > 0) {
      issueInput.assigneeId = await resolveUserId(ctx.sdk, assigneeRaw);
    }
    if (labelIds.length > 0) issueInput.labelIds = labelIds;
    if (opts.parent) {
      issueInput.parentId = await resolveIssueId(ctx.sdk, opts.parent);
    }

    return await createIssue(ctx.gql, issueInput);
  } finally {
    rl.close();
  }
}

type QueryNode = {
  priority?: number | null;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string | null;
  state?: { name?: string | null } | null;
  identifier?: string | null;
  id?: string;
  title?: string | null;
  assignee?: { name?: string | null } | null;
  labels?: { nodes: { name: string }[] } | null;
};

const QUERY_SORT_FIELDS = new Set([
  "priority",
  "created",
  "updated",
  "completed",
  "status",
  "id",
  "title",
  "type",
  "assignee",
]);

export function sortQueryResults<T extends QueryNode>(
  nodes: T[],
  sortBy: string | undefined,
  reverse: boolean,
): T[] {
  if (!sortBy) return nodes;
  if (!QUERY_SORT_FIELDS.has(sortBy)) {
    throw invalidParameterError(
      "--sort",
      `unsupported sort field '${sortBy}'. supported: priority, created, updated, completed, status, id, title, type, assignee`,
    );
  }
  const sorted = [...nodes].sort((a, b) => {
    let cmp = 0;
    switch (sortBy) {
      case "priority":
        cmp = (a.priority ?? 0) - (b.priority ?? 0);
        break;
      case "created":
        cmp = (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
        break;
      case "updated":
        cmp = (a.updatedAt ?? "").localeCompare(b.updatedAt ?? "");
        break;
      case "completed":
        cmp = (a.completedAt ?? "").localeCompare(b.completedAt ?? "");
        break;
      case "status":
        cmp = (a.state?.name ?? "").localeCompare(b.state?.name ?? "");
        break;
      case "id":
        cmp = (a.identifier ?? a.id ?? "").localeCompare(
          b.identifier ?? b.id ?? "",
        );
        break;
      case "title":
        cmp = (a.title ?? "").localeCompare(b.title ?? "");
        break;
      case "type":
        cmp = deriveTypeName(a.labels).localeCompare(deriveTypeName(b.labels));
        break;
      case "assignee":
        cmp = (a.assignee?.name ?? "").localeCompare(b.assignee?.name ?? "");
        break;
    }
    return reverse ? -cmp : cmp;
  });
  return sorted;
}

/**
 * Build the uppercase state banner shown inside `[● P<n> · STATE]` in the
 * detail header. Uses Linear's actual `state.name` (e.g. "Backlog",
 * "In Progress") uppercased — so workspace-specific states like "In Review"
 * or "Ready for QA" surface verbatim — with the deferred Linear-Hack as a
 * single-purpose override (it isn't a Linear state, it's a label).
 */
function detailStateBanner(stateName: string, deferred: boolean): string {
  if (deferred) return "DEFERRED";
  return stateName.toUpperCase();
}

/**
 * lin-7ypt: compose reasons-not-startable into the header banner. An
 * issue can be BOTH deferred AND blocked — header used to show only the
 * first reason it noticed, hiding blockers when the deferred label was
 * set. Returns the suffix to append after the state banner (e.g.
 * ` · BLOCKED by TES-624` or ` · BLOCKED by 3`), or empty when nothing
 * is actively blocking. Active = blocker state.type is non-terminal.
 */
function activeBlockerSuffix(issue: DetailIssueShape): string {
  const incoming = issue.inverseRelations?.nodes ?? [];
  const activeBlockers = incoming
    .filter((r) => r.type === "blocks")
    .map((r) => r.issue)
    .filter((i) => isNonClosedStateType(i.state.type));
  if (activeBlockers.length === 0) return "";
  if (activeBlockers.length === 1) {
    return ` · BLOCKED by ${activeBlockers[0].identifier}`;
  }
  return ` · BLOCKED by ${activeBlockers.length}`;
}

/**
 * The lowercase "type" string (e.g. `task`, `epic`, `bug`). Derived from
 * the Linear-Hack `type:*` label; defaults to `task`.
 */
function deriveTypeName(
  labels: { nodes: { name: string }[] } | null | undefined,
): string {
  const list = labels?.nodes ?? [];
  for (const l of list) {
    if (l.name.startsWith("type:")) {
      const t = l.name.slice("type:".length);
      if (t) return t;
    }
  }
  return "task";
}

function formatYmd(iso: string): string {
  // Render just the calendar date in UTC; the time portion is dropped.
  return iso.slice(0, 10);
}

/**
 * The minimal field shape `formatIssueDetail` reads from an Issue. Relations
 * carry title/priority/state so detail rows can render without an extra
 * lookup per edge.
 */
interface RelatedIssueShape {
  identifier: string;
  title: string;
  priority: number | null;
  state: { type: string };
  labels?: { nodes: { name: string }[] } | null;
}

interface DetailIssueShape extends ListIssueShape {
  description?: string | null;
  state: { type: string; name: string };
  assignee?: { name: string } | null;
  team?: { key?: string | null; name?: string | null } | null;
  project?: { name: string } | null;
  projectMilestone?: { name: string } | null;
  cycle?: { number?: number | null; name?: string | null } | null;
  estimate?: number | null;
  dueDate?: string | null;
  parent?: RelatedIssueShape | null;
  children?: {
    nodes: RelatedIssueShape[];
  } | null;
  relations?: {
    nodes: { type: string; relatedIssue: RelatedIssueShape }[];
  } | null;
  inverseRelations?: {
    nodes: { type: string; issue: RelatedIssueShape }[];
  } | null;
  createdAt: string;
  updatedAt: string;
}

// User-visible label filter: drop labels that already appear elsewhere
// in the detail view or that are purely Linear-Hack encoding artifacts.
// type:* → header bracket; deferred / deferred-until:* → summary banner;
// dep-type:* → relation type marker on edges, not on the issue itself.
function isUserVisibleLabel(name: string): boolean {
  if (name.startsWith("type:")) return false;
  if (name === "deferred" || name.startsWith("deferred-until:")) return false;
  if (name.startsWith("dep-type:")) return false;
  return true;
}

function relatedRow(prefix: string, r: RelatedIssueShape): string {
  const deferred = hasDeferredLabel({ labels: r.labels ?? undefined });
  const icon = statusIcon(r.state.type, { deferred });
  const pri = priorityCol(r.priority);
  // Format: `<glyph> <icon> <id>: <title> ● P<n>`. The priority suffix is
  // dropped entirely when the related issue has no priority (P0/null);
  // only explicit priorities emit `● P<n>`.
  const suffix = pri ? ` ● ${pri}` : "";
  return `  ${prefix} ${icon} ${r.identifier}: ${r.title}${suffix}`;
}

function parentRow(p: RelatedIssueShape): string {
  const deferred = hasDeferredLabel({ labels: p.labels ?? undefined });
  const icon = statusIcon(p.state.type, { deferred });
  const parentType = deriveTypeName(p.labels ?? undefined);
  const typeTag = parentType === "task" ? "" : `(${parentType.toUpperCase()}) `;
  const pri = priorityCol(p.priority);
  const suffix = pri ? ` ● ${pri}` : "";
  return `  ↑ ${icon} ${p.identifier}: ${typeTag}${p.title}${suffix}`;
}

/**
 * Render a detail card for a single issue. Sections appear in this order:
 * header, owner+type, dates, DESCRIPTION, CHILDREN, PARENT, DEPENDS ON,
 * BLOCKS. Empty sections are omitted.
 *
 * Each row's status icon comes from the related issue's own `state.type`,
 * so a BLOCKS row pointing at a closed issue renders `← ✓ <id>: …`.
 */
export function formatIssueDetail(issue: DetailIssueShape): string {
  const deferred = hasDeferredLabel(issue);
  const icon = statusIcon(issue.state.type, { deferred });
  const pri = priorityCol(issue.priority);
  const type = deriveTypeName(issue.labels ?? undefined);
  const typeBracket = type === "task" ? "" : `[${type.toUpperCase()}] `;
  const stateBanner = detailStateBanner(issue.state.name, deferred);
  const blockerSuffix = activeBlockerSuffix(issue);

  // Header layout: `<icon> <id>[ [TYPE]] · <title>   [● P<n> · STATE[ · BLOCKED by <id-or-count>]]`
  // 3-space gap before the `[…]` summary. lin-7ypt: an issue can be both
  // DEFERRED and BLOCKED — surface both reasons in the banner instead of
  // showing only the first one we detected.
  const summaryParts = ["●", pri, "·", stateBanner].filter((p) => p !== "");
  const summary = `[${summaryParts.join(" ")}${blockerSuffix}]`;
  const header = `${icon} ${issue.identifier} ${typeBracket}· ${issue.title}   ${summary}`;

  const lines: string[] = [header];
  const owner = issue.assignee?.name ?? "(unassigned)";
  lines.push(`Owner: ${owner} · Type: ${type}`);
  lines.push(
    `Created: ${formatYmd(issue.createdAt)} · Updated: ${formatYmd(issue.updatedAt)}`,
  );

  // lin-n5im: surface project / cycle / milestone / due / estimate in a
  // single metadata line near the top. Each field is suppressed when not
  // set; the whole line is suppressed when nothing applies.
  const metaParts: string[] = [];
  if (issue.project?.name) {
    metaParts.push(`Project: ${issue.project.name}`);
  }
  if (issue.projectMilestone?.name) {
    metaParts.push(`Milestone: ${issue.projectMilestone.name}`);
  }
  if (issue.cycle) {
    const cycleLabel = issue.cycle.name
      ? issue.cycle.name
      : issue.cycle.number != null
        ? `#${issue.cycle.number}`
        : null;
    if (cycleLabel) {
      metaParts.push(`Cycle: ${cycleLabel}`);
    }
  }
  if (typeof issue.estimate === "number") {
    metaParts.push(`Estimate: ${issue.estimate}`);
  }
  if (issue.dueDate) {
    metaParts.push(`Due: ${issue.dueDate}`);
  }
  if (metaParts.length > 0) {
    lines.push(metaParts.join(" · "));
  }

  // lin-n5im: show user-visible labels (filtering out type:*, deferred*,
  // dep-type:* which are encoded in other parts of the output). Without
  // this an agent had to flip to --json to see what the issue was tagged
  // with — labels like `good-first-issue` or `area:cli` drive triage.
  const visibleLabels = (issue.labels?.nodes ?? [])
    .map((l) => l.name)
    .filter(isUserVisibleLabel);
  if (visibleLabels.length > 0) {
    lines.push(`Labels: ${visibleLabels.join(", ")}`);
  }

  if (issue.description?.trim()) {
    lines.push("");
    lines.push("DESCRIPTION");
    lines.push(issue.description);
  }

  // Sort children by ID ascending (~= creation order). Linear's
  // `children.nodes` defaults to most-recent-first; sort by identifier
  // so the column appears in a stable order.
  const childList = [...(issue.children?.nodes ?? [])].sort((a, b) =>
    a.identifier.localeCompare(b.identifier, undefined, { numeric: true }),
  );
  if (childList.length > 0) {
    lines.push("");
    lines.push("CHILDREN");
    for (const c of childList) {
      lines.push(relatedRow("↳", c));
    }
    // Epic-progress summary: emit `  ◐ M/N complete (P%)` after the
    // children list when the issue is an epic. Linear has no native epic
    // type, so we drive this off the Linear-Hack `type:epic` label.
    if (type === "epic") {
      const total = childList.length;
      const done = childList.filter(
        (c) =>
          c.state.type === "completed" ||
          c.state.type === "canceled" ||
          c.state.type === "duplicate",
      ).length;
      const pct = total === 0 ? 0 : Math.round((done / total) * 100);
      lines.push(`  ◐ ${done}/${total} complete (${pct}%)`);
    }
  }

  if (issue.parent) {
    lines.push("");
    lines.push("PARENT");
    lines.push(parentRow(issue.parent));
  }

  const incomingBlocks = (issue.inverseRelations?.nodes ?? []).filter(
    (r) => r.type === "blocks",
  );
  if (incomingBlocks.length > 0) {
    lines.push("");
    lines.push("DEPENDS ON");
    for (const r of incomingBlocks) {
      lines.push(relatedRow("→", r.issue));
    }
  }

  const outgoingBlocks = (issue.relations?.nodes ?? []).filter(
    (r) => r.type === "blocks",
  );
  if (outgoingBlocks.length > 0) {
    lines.push("");
    lines.push("BLOCKS");
    for (const r of outgoingBlocks) {
      lines.push(relatedRow("←", r.relatedIssue));
    }
  }

  // Duplicate relations are directional in Linear: outgoing `duplicate` on X
  // means X duplicates Y (X is the closed dup); incoming means Y is a
  // duplicate of X (X is canonical). We split these into separate sections
  // so the section names are honest about the semantic.
  const duplicateOf = (issue.relations?.nodes ?? []).filter(
    (r) => r.type === "duplicate",
  );
  if (duplicateOf.length > 0) {
    lines.push("");
    lines.push("DUPLICATE OF");
    for (const r of duplicateOf) {
      lines.push(relatedRow("→", r.relatedIssue));
    }
  }

  const duplicates = (issue.inverseRelations?.nodes ?? []).filter(
    (r) => r.type === "duplicate",
  );
  if (duplicates.length > 0) {
    lines.push("");
    lines.push("DUPLICATES");
    for (const r of duplicates) {
      lines.push(relatedRow("←", r.issue));
    }
  }

  // lin-78df: surface `related` edges in the read view. `linear issues
  // supersede` and `linear depends add --type related/supersedes/…` all
  // create a Related relation, so without this section the outcome of
  // those verbs is invisible until the user runs `depends list`.
  //
  // Linear-Hack convention: depends add --type supersedes also puts a
  // `dep-type:supersedes` label on the source. When the related issue
  // carries that label we tag the row so the user can tell a supersede
  // edge from a plain related edge.
  const outgoingRelated = (issue.relations?.nodes ?? []).filter(
    (r) => r.type === "related",
  );
  const incomingRelated = (issue.inverseRelations?.nodes ?? []).filter(
    (r) => r.type === "related",
  );
  if (outgoingRelated.length > 0 || incomingRelated.length > 0) {
    lines.push("");
    lines.push("RELATED");
    for (const r of outgoingRelated) {
      lines.push(relatedRow("→", r.relatedIssue));
    }
    for (const r of incomingRelated) {
      lines.push(relatedRow("←", r.issue));
    }
  }

  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Appended-section formatters for `issues read --with-*` modes.
//
// Each formatter calls `formatIssueDetail` for the base card and then
// appends one extra section. Empty sections are omitted (matches the
// "Empty sections are omitted" rule in formatIssueDetail).
//
// `formatIssueDetail` returns a string ending in "\n"; the appended section
// starts with another "\n" so there's exactly one blank line of separation
// before the section heading.
// ---------------------------------------------------------------------------

interface AttachmentShape {
  url: string;
  title?: string | null;
}

interface DetailWithAttachmentsShape extends DetailIssueShape {
  attachments?: { nodes: AttachmentShape[] } | null;
}

export function formatIssueDetailWithAttachments(
  issue: DetailWithAttachmentsShape,
): string {
  const base = formatIssueDetail(issue);
  const nodes = issue.attachments?.nodes ?? [];
  if (nodes.length === 0) {
    return base;
  }
  const lines: string[] = [`ATTACHMENTS (${nodes.length})`];
  for (const a of nodes) {
    const title = a.title?.trim() ? ` · ${a.title}` : "";
    lines.push(`  → ${a.url}${title}`);
  }
  return `${base}\n${lines.join("\n")}\n`;
}

interface CommentShape {
  id: string;
  body: string;
  createdAt: string;
  parentId?: string | null;
  user?: { displayName?: string | null } | null;
}

interface DetailWithCommentsShape extends DetailIssueShape {
  comments?: { nodes: CommentShape[] } | null;
}

function firstBodyLine(body: string | null | undefined): string {
  // Comment preview is the first non-empty line, trimmed. Linear bodies
  // are markdown but we don't strip formatting — the raw first line is
  // what gets shown.
  for (const line of (body ?? "").split("\n")) {
    const trimmed = line.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return "";
}

function renderCommentRow(c: CommentShape, indent: string): string[] {
  const author = c.user?.displayName ?? "(unknown)";
  const date = formatYmd(c.createdAt);
  const lines = [`${indent}- @${author} · ${date}`];
  const preview = firstBodyLine(c.body);
  if (preview) {
    lines.push(`${indent}  ${preview}`);
  }
  return lines;
}

export function formatIssueDetailWithComments(
  issue: DetailWithCommentsShape,
): string {
  const base = formatIssueDetail(issue);
  const nodes = issue.comments?.nodes ?? [];
  if (nodes.length === 0) {
    return base;
  }
  const lines: string[] = [`COMMENTS (${nodes.length})`];
  for (const c of nodes) {
    lines.push(...renderCommentRow(c, "  "));
  }
  return `${base}\n${lines.join("\n")}\n`;
}

interface ThreadedCommentShape extends CommentShape {
  replies: ThreadedCommentShape[];
}

interface DetailWithCommentThreadsShape extends DetailIssueShape {
  comments?: { nodes: ThreadedCommentShape[] } | null;
}

function countAllComments(threads: readonly ThreadedCommentShape[]): number {
  let total = 0;
  for (const t of threads) {
    total += 1 + countAllComments(t.replies);
  }
  return total;
}

function renderThreadRows(t: ThreadedCommentShape, indent: string): string[] {
  const lines: string[] = [...renderCommentRow(t, indent)];
  for (const reply of t.replies) {
    lines.push(...renderThreadRows(reply, `${indent}  `));
  }
  return lines;
}

export function formatIssueDetailWithCommentThreads(
  issue: DetailWithCommentThreadsShape,
): string {
  const base = formatIssueDetail(issue);
  const threads = issue.comments?.nodes ?? [];
  if (threads.length === 0) {
    return base;
  }
  // Header count is the total across all threads (roots + replies), not
  // just the number of root threads — matches what a reader expects from
  // "COMMENTS (N)" given a folded `--with-comments` view.
  const total = countAllComments(threads);
  const lines: string[] = [`COMMENTS (${total})`];
  for (const t of threads) {
    lines.push(...renderThreadRows(t, "  "));
  }
  return `${base}\n${lines.join("\n")}\n`;
}

interface ReactionGroupShape {
  emoji: string;
  count: number;
}

interface DetailWithReactionsShape extends DetailIssueShape {
  reactions?: readonly ReactionGroupShape[] | null;
}

export function formatIssueDetailWithReactions(
  issue: DetailWithReactionsShape,
): string {
  const base = formatIssueDetail(issue);
  const groups = issue.reactions ?? [];
  if (groups.length === 0) {
    return base;
  }
  // Linear stores emoji as a shortcode (e.g. "thumbs_up"); we render as
  // `:shortcode:` rather than maps-to-unicode to avoid carrying an emoji
  // catalog. One summary line, dot-separated.
  const cells = groups.map((g) => `:${g.emoji}: ${g.count}`);
  return `${base}\nREACTIONS\n  ${cells.join(" · ")}\n`;
}

interface SearchRowShape {
  identifier: string;
  title: string;
  priority: number;
  state: { name: string; type: string };
  assignee?: { name: string } | null;
  labels?: { nodes: { name: string }[] } | null;
}

function extractTypeAndLabels(issue: SearchRowShape): {
  type: string;
  otherLabels: string[];
} {
  const labels = issue.labels?.nodes ?? [];
  let type = "task";
  const otherLabels: string[] = [];
  for (const l of labels) {
    if (l.name.startsWith("type:")) {
      const stripped = l.name.slice("type:".length);
      if (stripped) type = stripped;
    } else {
      otherLabels.push(l.name);
    }
  }
  return { type, otherLabels };
}

export function formatIssueSearch(
  result: { nodes: SearchRowShape[] },
  query: string,
): string {
  const issues = result.nodes;
  if (issues.length === 0) {
    return `\nNo issues found matching '${query}'.\n\n`;
  }

  const lines: string[] = [
    `Found ${issues.length} issues matching '${query}':`,
  ];
  for (const i of issues) {
    const parts: string[] = [i.identifier];
    const pri = priorityCol(i.priority);
    if (pri) parts.push(`[${pri}]`);
    const { type, otherLabels } = extractTypeAndLabels(i);
    parts.push(`[${type}]`);
    parts.push(i.state.name || i.state.type);
    if (i.assignee?.name) parts.push(`@${i.assignee.name}`);
    for (const l of otherLabels) parts.push(`[${l}]`);
    parts.push(`- ${i.title}`);
    lines.push(parts.join(" "));
  }

  return `${lines.join("\n")}\n`;
}

/**
 * Linear identifiers are immutable, so this verb renames the *title*.
 * Pencil icon + new title in the echo.
 */
export function formatIssueRename(row: TransitionRowShape): string {
  return `✏ Renamed ${row.identifier} — ${row.title}\n`;
}

/**
 * Format: `✓ Set priority of <id> — <title> to P<n>`. Priority 0 (Linear's
 * "No priority") is rejected by the action layer, so we never receive it here.
 */
export function formatIssuePriority(
  row: TransitionRowShape,
  priority: number,
): string {
  return `✓ Set priority of ${row.identifier} — ${row.title} to P${priority}\n`;
}

/**
 * Format: `✓ Added label "<name>" to <id> — <title>`.
 */
export function formatIssueTag(row: TransitionRowShape, label: string): string {
  return `✓ Added label "${label}" to ${row.identifier} — ${row.title}\n`;
}

/**
 * Format: `✓ Note added to <id> — <title>`.
 */
export function formatIssueNote(row: TransitionRowShape): string {
  return `✓ Note added to ${row.identifier} — ${row.title}\n`;
}

/**
 * Checklist toggle echo with progress:
 *   `✓ TES-815 [x] Header audit (12/117 done)`
 * Idempotent no-ops use the `→` preview arrow instead of `✓` so an agent
 * can see nothing was written.
 */
export function formatChecklistToggle(result: ChecklistToggleResult): string {
  const box = result.item.checked ? "[x]" : "[ ]";
  const progress = `(${result.checked_count}/${result.total_count} done)`;
  if (!result.changed) {
    return `→ ${result.identifier} ${box} ${result.item.text} — already in this state ${progress}\n`;
  }
  return `✓ ${result.identifier} ${box} ${result.item.text} ${progress}\n`;
}

interface SupersedeResultShape {
  status: "superseded";
  superseded: string;
  replacement: string;
  relation_id: string;
  closed_issue: { identifier: string; title: string };
}

export function formatIssueSupersede(
  result: SupersedeResultShape,
  replacementIdentifier: string,
): string {
  return [
    `Marked ${result.closed_issue.identifier} as superseded by ${replacementIdentifier}`,
    `  ${result.closed_issue.identifier}: ${result.closed_issue.title} (closed)`,
    `  relation: ${result.relation_id}`,
    "",
  ].join("\n");
}

interface MarkDuplicateResultShape {
  status: "marked-duplicate";
  duplicate: string;
  canonical: string;
  relation_id: string;
  closed_issue: { identifier: string; title: string };
}

export function formatIssueMarkDuplicate(
  result: MarkDuplicateResultShape,
  canonicalIdentifier: string,
): string {
  return [
    `Marked ${result.closed_issue.identifier} as duplicate of ${canonicalIdentifier}`,
    `  ${result.closed_issue.identifier}: ${result.closed_issue.title} (closed)`,
    `  relation: ${result.relation_id}`,
    "",
  ].join("\n");
}

interface StateValueShape {
  issue_identifier: string;
  dimension: string;
  value: string | null;
}

export function formatIssueStateValue(result: StateValueShape): string {
  if (result.value === null) {
    return `(no ${result.dimension} state set)\n`;
  }
  return `${result.value}\n`;
}

interface StateDimensionsShape {
  issue_identifier: string;
  states: Record<string, string>;
}

export function formatIssueStateList(result: StateDimensionsShape): string {
  const dims = Object.keys(result.states).sort();
  if (dims.length === 0) {
    return `\n${result.issue_identifier} has no state labels\n`;
  }
  const lines = ["", `📊 State for ${result.issue_identifier}:`];
  for (const dim of dims) {
    lines.push(`  ${dim}: ${result.states[dim]}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

interface SetStateResultShape {
  issue_identifier: string;
  dimension: string;
  old_value: string | null;
  new_value: string;
  comment_id: string | null;
  changed: boolean;
}

/**
 * Render the success echo for `issues create`. Priority line is omitted
 * when the value is 0 (Linear's "No priority") or null — Linear's scheme
 * is 1=urgent / 2=high / 3=medium / 4=low, so printing `P0` is actively
 * misleading (round-1 UX agents read it as "P0 = urgent"). Matches the
 * behaviour of `formatIssueCreateForm`.
 */
/**
 * Where the create command's target team came from, surfaced as a provenance
 * hint when `--team` was omitted (lin-4wvh). `flag` means the user passed
 * `--team` explicitly, so no hint is printed.
 */
export interface CreateTeamProvenance {
  team: string;
  source: "flag" | "LINEAR_TEAM" | "scope.team" | "team.default";
}

/**
 * Assemble the final issue description from the body input plus the
 * Linear-Hack section flags (`--design`, `--context`, `--acceptance`,
 * `--test`). Each non-empty flag is spliced in as a discrete `## Heading`
 * section via {@link replaceSection}, so re-running with a flag updates that
 * section in place. Returns `undefined` when nothing produced a body, so the
 * caller can omit `description` entirely (preserving the prior behaviour where
 * a bare `create <title>` sends no description).
 *
 * Pure (no network / stdin side effects beyond what `resolveBodyInput` already
 * does) so the create-time validation gate can run on the result before any
 * API call.
 */
/**
 * Resolve a `--metadata` flag value into a metadata object. Supports an
 * inline JSON string or `@path` to read JSON from a file, then
 * validates it is a JSON object. (lin-e64s)
 */
export function resolveMetadataInput(value: string): Metadata {
  const raw = value.startsWith("@")
    ? fs.readFileSync(value.slice(1), "utf8")
    : value;
  return parseMetadataJson(raw);
}

/** Commander coercion that accumulates a repeatable string option. */
function collectRepeatable(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/**
 * Augment a read result with a parsed `metadata` object extracted from its
 * description's ```metadata block, so `read --json` surfaces metadata as a
 * first-class field without the caller re-parsing the body. The
 * raw block stays in `description` — it IS the storage. (lin-e64s)
 */
function attachMetadata<T extends { description?: string | null }>(
  result: T,
): T & { metadata: Metadata | null } {
  return { ...result, metadata: extractMetadata(result.description) };
}

export function assembleCreateDescription(
  options: CreateOptions,
): string | undefined {
  const resolvedDescription = resolveBodyInput(options);
  const resolvedDesign = resolveDesignInput(options);

  let body = resolvedDescription ?? "";
  if (resolvedDesign !== undefined) {
    body = replaceSection(body, "## Design", resolvedDesign);
  }
  if (options.context !== undefined) {
    body = replaceSection(body, "## Context", options.context);
  }
  if (options.acceptance !== undefined) {
    body = replaceSection(body, "## Acceptance Criteria", options.acceptance);
  }
  if (options.test !== undefined) {
    body = replaceSection(body, "## Test Plan", options.test);
  }
  // Linear has no native `notes` field, so follow the established
  // Linear-Hack and fold --notes into a '## Notes' description section
  // (lin-8yl1.3).
  if (options.notes !== undefined) {
    body = replaceSection(body, "## Notes", options.notes);
  }

  // Nothing was supplied anywhere → keep the legacy "no description" shape.
  if (
    resolvedDescription === undefined &&
    resolvedDesign === undefined &&
    options.context === undefined &&
    options.acceptance === undefined &&
    options.test === undefined &&
    options.notes === undefined
  ) {
    return undefined;
  }
  return body;
}

export function formatIssueCreate(result: {
  identifier?: string | null;
  title?: string | null;
  priority?: number | null;
  state?: { name?: string | null } | null;
  team_provenance?: CreateTeamProvenance | null;
}): string {
  const id = result.identifier ?? "(unknown)";
  const title = result.title ?? "";
  const header = title
    ? `✓ Created issue: ${id}: ${title}`
    : `✓ Created issue: ${id}`;
  const lines = [header];
  if (typeof result.priority === "number" && result.priority > 0) {
    lines.push(`  Priority: P${result.priority}`);
  }
  if (result.state?.name) {
    lines.push(`  Status: ${result.state.name}`);
  }
  // Provenance hint only when the team was *implied* (not an explicit --team),
  // so an agent can see which config layer chose the team (lin-4wvh).
  const prov = result.team_provenance;
  if (prov && prov.source !== "flag") {
    lines.push(`  Team: ${prov.team} [from ${prov.source}]`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Resolved-but-uncommitted issue shape emitted by `issues create --dry-run`
 * (lin-jw2x). A dry-run preview: everything that *would* be created,
 * with no network mutation (labels are shown by name, never created).
 */
export interface CreateDryRunPreview {
  dry_run: true;
  title: string;
  team: string;
  team_source: string | null;
  type: string | null;
  priority: number | null;
  estimate: number | null;
  status: string | null;
  assignee: string | null;
  project: string | null;
  parent: string | null;
  labels: string[];
  description: string | null;
  metadata: Metadata | null;
  relations: { type: string; targets: string[] }[];
}

export function formatCreateDryRun(p: CreateDryRunPreview): string {
  const lines = ["⚠ [DRY RUN] Would create issue:"];
  lines.push(`  Title: ${p.title}`);
  lines.push(
    `  Team: ${p.team}${p.team_source && p.team_source !== "flag" ? ` [from ${p.team_source}]` : ""}`,
  );
  if (p.type) lines.push(`  Type: ${p.type}`);
  if (p.priority !== null) lines.push(`  Priority: P${p.priority}`);
  if (p.estimate !== null) lines.push(`  Estimate: ${p.estimate}`);
  if (p.status) lines.push(`  Status: ${p.status}`);
  if (p.assignee) lines.push(`  Assignee: ${p.assignee}`);
  if (p.project) lines.push(`  Project: ${p.project}`);
  if (p.parent) lines.push(`  Parent: ${p.parent}`);
  if (p.labels.length > 0) lines.push(`  Labels: ${p.labels.join(", ")}`);
  for (const r of p.relations) {
    lines.push(`  ${r.type}: ${r.targets.join(", ")}`);
  }
  if (p.description) {
    const firstLine = p.description.split("\n")[0];
    const preview =
      firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
    lines.push(`  Description: ${preview}`);
  }
  lines.push("  (nothing was created — re-run without --dry-run to apply)");
  return `${lines.join("\n")}\n`;
}

export function formatIssueUpdate(result: {
  identifier?: string | null;
  title?: string | null;
}): string {
  const id = result.identifier ?? "(unknown)";
  const title = result.title ?? "";
  return title
    ? `✓ Updated issue: ${id}: ${title}\n`
    : `✓ Updated issue: ${id}\n`;
}

export function formatIssueSetState(result: SetStateResultShape): string {
  if (!result.changed) {
    return `(no change: ${result.dimension} already set to ${result.new_value})\n`;
  }
  const lines = [
    `✓ Set ${result.dimension} = ${result.new_value} on ${result.issue_identifier}`,
  ];
  if (result.old_value !== null && result.old_value !== "") {
    lines.push(`  Previous: ${result.old_value}`);
  }
  if (result.comment_id) {
    lines.push(`  Comment: ${result.comment_id}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Render the result of `issues create-form`. Two shapes:
 *
 *   created  → multi-line block matching the `issues create` echo:
 *
 *     ✓ Created issue: <id> — <title>
 *       Priority: P<n>            (omitted when priority is 0/null)
 *       Status: <state name>
 *
 *   canceled → `✗ Create canceled\n` (single line)
 *
 * The shape is reused by the future `issues create` port so both verbs
 * land on the same human-facing echo.
 */
export interface CreateFormRowShape {
  identifier: string;
  title: string;
  priority?: number | null;
  state?: { name?: string | null } | null;
}

export function formatIssueCreateForm(
  result: CreateFormRowShape | { canceled: true },
): string {
  if ("canceled" in result && result.canceled) {
    return "✗ Create canceled\n";
  }
  const issue = result as CreateFormRowShape;
  const lines = [`✓ Created issue: ${issue.identifier} — ${issue.title}`];
  if (typeof issue.priority === "number" && issue.priority > 0) {
    lines.push(`  Priority: P${issue.priority}`);
  }
  const stateName = issue.state?.name;
  if (stateName) {
    lines.push(`  Status: ${stateName}`);
  }
  return `${lines.join("\n")}\n`;
}

export function setupIssuesCommands(program: Command): void {
  const issues = program.command("issues").description("Issue operations");

  issues.action(() => issues.help());

  registerIssueReportCommands(issues);
  registerIssueLintCommand(issues);
  registerIssueHistoryCommand(issues);
  registerIssueActivityCommand(issues);
  registerIssueSnapshotCommands(issues);
  registerIssueLifecycleCommands(issues);

  issues
    .command("rename <issue> <new-title>")
    .description("rename an issue (updates title; Linear IDs are immutable)")
    .addHelpText(
      "after",
      `\nLinear identifiers (e.g. ENG-123) are immutable. This command
updates the issue title only.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [issue, newTitle, , command] = args as [
          string,
          string,
          unknown,
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const issueId = await resolveIssueId(ctx.sdk, issue);
        const result = await updateIssue(ctx.gql, issueId, { title: newTitle });
        outputResult(
          result,
          (r) => formatIssueRename(r as TransitionRowShape),
          rootOpts,
        );
      }),
    );

  issues
    .command("supersede <issue>")
    .description(
      "mark <issue> as superseded by --with (creates Related relation and closes <issue>)",
    )
    .requiredOption(
      "--with <replacement>",
      "replacement issue identifier (the newer issue that supersedes)",
    )
    .addHelpText(
      "after",
      `\nLinear has no native 'supersedes' relation type; this command creates
a 'related' edge from the superseded issue to the replacement, and
transitions the superseded issue to the team's 'canceled' state. The
'related' edge preserves machine-readable traceability — use
\`linear depends list <issue>\` to find the replacement.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [issue, options, command] = args as [
          string,
          { with: string },
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);

        const [supersededId, replacementId] = await Promise.all([
          resolveIssueId(ctx.sdk, issue),
          resolveIssueId(ctx.sdk, options.with),
        ]);

        if (supersededId === replacementId) {
          throw invalidParameterError(
            "<issue>",
            "cannot supersede an issue with itself",
          );
        }

        const relation = await createIssueRelation(ctx.gql, {
          issueId: supersededId,
          relatedIssueId: replacementId,
          type: IssueRelationType.Related,
        });

        const superseded = await getIssue(ctx.gql, supersededId);
        const replacement = await getIssue(ctx.gql, replacementId);
        const teamId =
          "team" in superseded && superseded.team
            ? superseded.team.id
            : undefined;
        if (!teamId) {
          throw new Error(
            `Unable to determine team for issue ${issue} (cannot close)`,
          );
        }
        const canceledStateId = await resolveStateIdByType(
          ctx.sdk,
          teamId,
          "canceled",
        );
        const closed = await updateIssue(ctx.gql, supersededId, {
          stateId: canceledStateId,
        });

        const payload = {
          status: "superseded" as const,
          superseded: supersededId,
          replacement: replacementId,
          relation_id: relation.id,
          closed_issue: closed,
        };
        outputResult(
          payload,
          (p) => formatIssueSupersede(p, replacement.identifier),
          rootOpts,
        );
      }),
    );

  issues
    .command("mark-duplicate <issue>")
    .description(
      "mark <issue> as a duplicate of --of (creates Duplicate relation and closes <issue>)",
    )
    .requiredOption(
      "--of <canonical>",
      "canonical issue identifier (the one to keep open)",
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [issue, options, command] = args as [
          string,
          { of: string },
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);

        const [duplicateId, canonicalId] = await Promise.all([
          resolveIssueId(ctx.sdk, issue),
          resolveIssueId(ctx.sdk, options.of),
        ]);

        if (duplicateId === canonicalId) {
          throw invalidParameterError(
            "<issue>",
            "cannot mark an issue as a duplicate of itself",
          );
        }

        const relation = await createIssueRelation(ctx.gql, {
          issueId: duplicateId,
          relatedIssueId: canonicalId,
          type: IssueRelationType.Duplicate,
        });

        const duplicate = await getIssue(ctx.gql, duplicateId);
        const canonical = await getIssue(ctx.gql, canonicalId);
        const teamId =
          "team" in duplicate && duplicate.team ? duplicate.team.id : undefined;
        if (!teamId) {
          throw new Error(
            `Unable to determine team for issue ${issue} (cannot close)`,
          );
        }
        const canceledStateId = await resolveStateIdByType(
          ctx.sdk,
          teamId,
          "canceled",
        );
        const closed = await updateIssue(ctx.gql, duplicateId, {
          stateId: canceledStateId,
        });

        const payload = {
          status: "marked-duplicate" as const,
          duplicate: duplicateId,
          canonical: canonicalId,
          relation_id: relation.id,
          closed_issue: closed,
        };
        outputResult(
          payload,
          (p) => formatIssueMarkDuplicate(p, canonical.identifier),
          rootOpts,
        );
      }),
    );

  issues
    .command("priority <issue> <n>")
    .description("set the priority of an issue (1-4, or P1-P4 shorthand)")
    .addHelpText(
      "after",
      `\nShorthand for 'issues update <issue> --priority <n>'. Priority scale:
1 = Urgent, 2 = High, 3 = Medium, 4 = Low. Linear's 0 ('No priority') is
set by clearing the field on the issue elsewhere; this command rejects 0
to avoid ambiguity.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [issue, n, , command] = args as [
          string,
          string,
          unknown,
          Command,
        ];
        const priority = parsePriorityOption(n);
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const issueId = await resolveIssueId(ctx.sdk, issue);
        const result = await updateIssue(ctx.gql, issueId, { priority });
        outputResult(
          result,
          (r) => formatIssuePriority(r as TransitionRowShape, priority),
          rootOpts,
        );
      }),
    );

  issues
    .command("tag <issue> <label>")
    .description("add a single label to an issue")
    .addHelpText(
      "after",
      `\nShorthand for 'issues update <issue> --labels <label> --label-mode add'.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [issue, label, , command] = args as [
          string,
          string,
          unknown,
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const issueId = await resolveIssueId(ctx.sdk, issue);
        const [newLabelId] = await ensureWorkspaceLabelIds(ctx.gql, [label]);
        const current = await getIssue(ctx.gql, issueId);
        const currentLabelIds =
          "labels" in current && current.labels?.nodes
            ? current.labels.nodes.map((l) => l.id)
            : [];
        const labelIds = Array.from(new Set([...currentLabelIds, newLabelId]));
        const result = await updateIssue(ctx.gql, issueId, { labelIds });
        outputResult(
          result,
          (r) => formatIssueTag(r as TransitionRowShape, label),
          rootOpts,
        );
      }),
    );

  issues
    .command("note <issue> [text...]")
    .description(
      "append a note to an issue's description under a '## Notes' heading",
    )
    .option("--stdin", "read note text from stdin", false)
    .option("--body-file <path>", "read note text from a file")
    .option("--file <path>", "alias for --body-file (deprecated)")
    .addHelpText(
      "after",
      `\nLinear-Composite: Linear has no separate notes field, so notes are
appended to the issue's description under a '## Notes' heading. If the
heading is absent it is inserted on first use. Text sources are mutually
exclusive: --stdin > --body-file > positional args. Empty text or no
source is an error. (--file is a deprecated alias for --body-file.)`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [issue, textParts, options, command] = args as [
          string,
          string[],
          { stdin: boolean; file?: string; bodyFile?: string },
          Command,
        ];

        if (options.file !== undefined && options.bodyFile !== undefined) {
          throw invalidParameterError(
            "--file",
            "cannot be combined with --body-file — pick one",
          );
        }
        const filePath = options.bodyFile ?? options.file;

        if (options.stdin && filePath !== undefined) {
          throw invalidParameterError(
            "--stdin",
            "cannot be combined with --body-file",
          );
        }

        let text: string;
        if (options.stdin) {
          text = fs.readFileSync(0, "utf8").replace(/\n+$/, "");
        } else if (filePath !== undefined) {
          text = fs.readFileSync(filePath, "utf8");
        } else if (textParts && textParts.length > 0) {
          text = textParts.join(" ");
        } else {
          throw invalidParameterError(
            "<text>",
            "no note text provided (use positional args, --stdin, or --body-file)",
          );
        }

        if (text.length === 0) {
          throw invalidParameterError("<text>", "note text is empty");
        }

        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const issueId = await resolveIssueId(ctx.sdk, issue);
        const result = await appendNote(ctx.gql, issueId, text);
        outputResult(
          result,
          (r) => formatIssueNote(r as TransitionRowShape),
          rootOpts,
        );
      }),
    );

  issues
    .command("pull <issue>")
    .description(
      "write the issue description to a local file for editing (pairs with 'issues push')",
    )
    .option(
      "--force",
      "overwrite a local copy that has unpushed edits (it is backed up to <ID>.local.bak.md)",
      false,
    )
    .addHelpText(
      "after",
      `\nWrites the description to ~/.linear/edits/<ID>.md plus a baseline
snapshot of the server state at pull time. Edit the file with any tool,
then upload with 'linear issues push <id>' — push refuses (exit 3) when
the server copy changed since this pull, so concurrent edits made in the
Linear UI are never silently clobbered. Safe to re-run: a clean local
copy is refreshed in place; one with unpushed edits requires --force.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [issue, options, command] = args as [
          string,
          { force: boolean },
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const issueId = await resolveIssueId(ctx.sdk, issue);
        const result = await pullIssue(ctx.gql, issueId, {
          force: options.force,
        });
        outputResult(
          result,
          (r) => {
            const lines = [`✓ pulled ${r.identifier} → ${r.path}`];
            if (r.backup_path) {
              lines.push(`  previous local edits backed up → ${r.backup_path}`);
            }
            lines.push(
              `  edit the file, then: linear issues push ${r.identifier}`,
            );
            return `${lines.join("\n")}\n`;
          },
          rootOpts,
        );
      }),
    );

  issues
    .command("push <issue>")
    .description(
      "upload the local description file from 'issues pull' (conflict-guarded)",
    )
    .option(
      "--dry-run",
      "print the unified diff (server vs local) without writing",
      false,
    )
    .option(
      "--force",
      "overwrite the server copy even if it changed since pull",
      false,
    )
    .addHelpText(
      "after",
      `\nOptimistic concurrency: push re-reads the issue and compares it to the
baseline recorded at pull time. If someone edited the issue in the
meantime, push exits with code 3 and prints what changed on the server —
re-pull, re-apply your edit, and push again. Linear's API has no
server-side compare-and-swap, so a small race window remains between
push's read and write; the guard converts silent clobbering into a
visible, retryable error. (Exit codes: 0 pushed/no-op, 3 conflict.)`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [issue, options, command] = args as [
          string,
          { dryRun: boolean; force: boolean },
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const issueId = await resolveIssueId(ctx.sdk, issue);
        const result = await pushIssue(ctx.gql, issueId, {
          dryRun: options.dryRun,
          force: options.force,
        });
        outputResult(
          result,
          (r) => {
            if (r.action === "pushed") {
              return `✓ pushed ${r.identifier} (description updated)\n`;
            }
            if (r.action === "no_changes") {
              return `→ nothing to push for ${r.identifier} (local matches server)\n`;
            }
            // dry_run
            const lines: string[] = [];
            if (r.conflict) {
              lines.push(
                `⚠ server changed since pull — push would conflict (re-pull first)`,
              );
            }
            lines.push(
              r.diff && r.diff.length > 0
                ? r.diff
                : `→ no changes (local matches server)`,
            );
            return `${lines.join("\n")}\n`;
          },
          rootOpts,
        );
      }),
    );

  issues
    .command("check <issue> <item>")
    .alias("tick")
    .description(
      "tick one '- [ ]' checklist line in the description (by substring or number)",
    )
    .addHelpText(
      "after",
      `\nFlips exactly one checklist line server-side; the rest of the
description is untouched and no local copy is involved. <item> is a
case-insensitive substring of the item text, or its 1-based number
among the checklist lines. Ambiguous or missing matches fail with the
candidate list and write nothing. Already-checked items are an
idempotent success. Untick with 'issues uncheck'.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [issue, item, , command] = args as [
          string,
          string,
          unknown,
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const issueId = await resolveIssueId(ctx.sdk, issue);
        const result = await toggleChecklistItem(ctx.gql, issueId, item, true);
        outputResult(result, formatChecklistToggle, rootOpts);
      }),
    );

  issues
    .command("uncheck <issue> <item>")
    .alias("untick")
    .description("untick one '- [x]' checklist line in the description")
    .addHelpText(
      "after",
      "\nReverse of 'issues check' — same matching rules; see its help.",
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [issue, item, , command] = args as [
          string,
          string,
          unknown,
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const issueId = await resolveIssueId(ctx.sdk, issue);
        const result = await toggleChecklistItem(ctx.gql, issueId, item, false);
        outputResult(result, formatChecklistToggle, rootOpts);
      }),
    );

  const stateCmd = issues
    .command("state <issue> <dimension>")
    .description("read one state dimension back off an issue's labels")
    .addHelpText(
      "after",
      `\nLinear-Hack: the 'labels-as-state' convention encodes operational
state as '<dimension>:<value>' labels (e.g. patrol:active, mode:degraded).
This command reads one dimension; \`state list <issue>\` returns all of
them as a flat map. Mutation lives in \`issues set-state\`.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [issue, dimension, , command] = args as [
          string,
          string,
          unknown,
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const issueId = await resolveIssueId(ctx.sdk, issue);
        const result = await getStateValue(ctx.gql, issueId, dimension);
        outputResult(result, formatIssueStateValue, rootOpts);
      }),
    );

  stateCmd
    .command("list <issue>")
    .description("list every state dimension currently set on an issue")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [issue, , command] = args as [string, unknown, Command];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const issueId = await resolveIssueId(ctx.sdk, issue);
        const result = await listStateDimensions(ctx.gql, issueId);
        outputResult(result, formatIssueStateList, rootOpts);
      }),
    );

  issues
    .command("set-state <issue> <spec>")
    .description(
      "set a state dimension via the '<dimension>=<value>' labels convention",
    )
    .option(
      "-r, --reason <text>",
      "reason for the state change (added as a comment)",
    )
    .option("--reason-file <path>", "read reason from a file (use - for stdin)")
    .option("--reason-stdin", "read reason from stdin", false)
    .addHelpText(
      "after",
      `\nLinear-Composite: swaps any existing '<dimension>:*' label for
'<dimension>:<value>' on the issue. The new label is auto-created
workspace-wide on first use. The optional --reason text is appended
as a comment so the state-change rationale is visible in Linear.
Returns 'changed: false' (no mutation, no comment) when the dimension
is already set to the requested value.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [issue, spec, options, command] = args as [
          string,
          string,
          {
            reason?: string;
            reasonFile?: string;
            reasonStdin?: boolean;
          },
          Command,
        ];
        const eq = spec.indexOf("=");
        if (eq <= 0 || eq === spec.length - 1) {
          throw invalidParameterError(
            "<spec>",
            `must be '<dimension>=<value>' (got '${spec}')`,
          );
        }
        const dimension = spec.slice(0, eq);
        const value = spec.slice(eq + 1);
        const reason = resolveReasonInput(options);
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const issueId = await resolveIssueId(ctx.sdk, issue);
        const result = await setStateLabel(
          ctx.gql,
          issueId,
          dimension,
          value,
          reason,
        );
        outputResult(result, formatIssueSetState, rootOpts);
      }),
    );

  registerIssueAnalysisCommands(issues);

  addFilterOptions(
    issues
      .command("search <query>")
      .description("full-text search issues")
      .option("-l, --limit <n>", "max results", "50")
      .option("--after <cursor>", "cursor for next page"),
  ).action(
    handleCommand(async (...args: unknown[]) => {
      const [query, options, command] = args as [
        string,
        FilterOptions,
        Command,
      ];
      const rootOpts = getRootOpts(command);
      const ctx = createContext(rootOpts);

      const agentMode = Boolean(rootOpts.agentMode);
      const paginationOptions = {
        limit: resolveAgentLimit(
          parseLimit(options.limit),
          command.getOptionValueSource("limit"),
          agentMode,
        ),
        after: options.after,
      };

      const filterOptions = await resolveFilterOptions(
        ctx.sdk,
        prepareIssueFilterOptions(options),
        ctx.gql,
      );
      warnMissingLabels(filterOptions.missingLabels);
      const baseFilter = buildIssueFilter(filterOptions);
      const scope = resolveScopeOption(options.scope);
      const filter = applyScopeToFilter(baseFilter, scope);
      const result = await searchIssues(
        ctx.gql,
        query,
        paginationOptions,
        filter,
      );
      outputResult(
        withListMeta(result, {
          limit: paginationOptions.limit,
          scope: {
            team:
              options.team ??
              (options.allTeams ? null : (getDefaultTeam() ?? null)),
            project: options.project ?? null,
          },
          agentMode,
        }),
        (r) => formatIssueSearch(r, query),
        rootOpts,
      );
    }),
  );

  issues
    .command("read <issue>")
    .description("get full issue details including description")
    .option("--with-attachments", "include issue attachments")
    .option("--with-comments", "include full issue comments")
    .option(
      "--with-comment-threads",
      "group issue comments into root comments with replies",
    )
    .option("--with-reactions", "include normalized root issue reactions")
    .addHelpText(
      "after",
      `\nWhen passing issue IDs, both UUID and identifiers like ABC-123 are supported.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [issue, options, command] = args as [
          string,
          ReadOptions,
          Command,
        ];
        validateReadOptions(options);
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);

        if (options.withAttachments) {
          if (isUuid(issue)) {
            const result = await getIssueWithAttachments(ctx.gql, issue);
            outputResult(
              attachMetadata(result),
              formatIssueDetailWithAttachments,
              rootOpts,
            );
          } else {
            const { teamKey, issueNumber } = parseIssueIdentifier(issue);
            const result = await getIssueByIdentifierWithAttachments(
              ctx.gql,
              teamKey,
              issueNumber,
            );
            outputResult(
              attachMetadata(result),
              formatIssueDetailWithAttachments,
              rootOpts,
            );
          }
          return;
        }

        if (options.withCommentThreads) {
          if (isUuid(issue)) {
            const result = await getIssueWithCommentThreads(ctx.gql, issue);
            outputResult(
              attachMetadata(result),
              formatIssueDetailWithCommentThreads,
              rootOpts,
            );
          } else {
            const { teamKey, issueNumber } = parseIssueIdentifier(issue);
            const result = await getIssueByIdentifierWithCommentThreads(
              ctx.gql,
              teamKey,
              issueNumber,
            );
            outputResult(
              attachMetadata(result),
              formatIssueDetailWithCommentThreads,
              rootOpts,
            );
          }
          return;
        }

        if (options.withComments) {
          if (isUuid(issue)) {
            const result = await getIssueWithComments(ctx.gql, issue);
            outputResult(
              attachMetadata(result),
              formatIssueDetailWithComments,
              rootOpts,
            );
          } else {
            const { teamKey, issueNumber } = parseIssueIdentifier(issue);
            const result = await getIssueByIdentifierWithComments(
              ctx.gql,
              teamKey,
              issueNumber,
            );
            outputResult(
              attachMetadata(result),
              formatIssueDetailWithComments,
              rootOpts,
            );
          }
          return;
        }

        if (options.withReactions) {
          if (isUuid(issue)) {
            const result = await getIssueWithReactions(ctx.gql, issue);
            outputResult(
              attachMetadata(result),
              formatIssueDetailWithReactions,
              rootOpts,
            );
          } else {
            const { teamKey, issueNumber } = parseIssueIdentifier(issue);
            const result = await getIssueByIdentifierWithReactions(
              ctx.gql,
              teamKey,
              issueNumber,
            );
            outputResult(
              attachMetadata(result),
              formatIssueDetailWithReactions,
              rootOpts,
            );
          }
          return;
        }

        if (isUuid(issue)) {
          const result = await getIssue(ctx.gql, issue);
          outputResult(attachMetadata(result), formatIssueDetail, rootOpts);
        } else {
          const { teamKey, issueNumber } = parseIssueIdentifier(issue);
          const result = await getIssueByIdentifier(
            ctx.gql,
            teamKey,
            issueNumber,
          );
          outputResult(attachMetadata(result), formatIssueDetail, rootOpts);
        }
      }),
    );

  registerIssueDiscussionCommands(issues);

  issues
    .command("q [titleParts...]")
    .description(
      "quick-capture a task issue; prints ONLY the new identifier to stdout",
    )
    .option("--team <team>", "target team (key, name, or UUID)")
    .option(
      "-p, --priority <1-4>",
      "priority (1-4 or P1-P4); default 2 (High)",
      "2",
    )
    .option(
      "-t, --type <type>",
      "issue type (mapped to 'type:<value>' workspace label)",
      "task",
    )
    .option("-l, --labels <labels>", "comma-separated label names")
    .addHelpText(
      "after",
      `\nLinear-Hack: issue type is encoded as a 'type:<value>' label
(workspace-scoped, auto-created on first use). Stdout is exactly the
new identifier so 'ID=$(linear issues q "title" --team ENG)' works in
shell pipelines. Missing extra labels (--labels) are silently skipped —
only the type-label and core fields are required.

Falls back to the configured default team when --team is omitted; set
one with \`linear config set team.default <key>\` or LINEAR_TEAM.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [titleParts, options, command] = args as [
          string[],
          {
            team?: string;
            priority: string;
            type: string;
            labels?: string;
          },
          Command,
        ];
        if (!titleParts || titleParts.length === 0) {
          throw invalidParameterError("<title>", "title is required");
        }
        const title = titleParts.join(" ");
        const priority = parsePriorityOption(options.priority);
        const ctx = createContext(getRootOpts(command));
        const teamKey = options.team ?? getDefaultTeam();
        if (!teamKey) {
          throw invalidParameterError(
            "--team",
            "no team provided — pass --team <key>, set LINEAR_TEAM, or run `linear config set team.default <key>`",
          );
        }
        const teamId = await resolveTeamId(ctx.sdk, teamKey);

        const typeLabelId = await ensureWorkspaceLabel(
          ctx.gql,
          `type:${options.type}`,
          `Issue type '${options.type}' (linear convention).`,
        );

        const extraLabelIds: string[] = [];
        if (options.labels) {
          for (const name of options.labels
            .split(",")
            .map((l) => l.trim())
            .filter(Boolean)) {
            try {
              extraLabelIds.push(await resolveLabelId(ctx.sdk, name));
            } catch {
              // Silent ignore: missing labels do not block creation.
            }
          }
        }

        const labelIds = Array.from(new Set([typeLabelId, ...extraLabelIds]));

        const result = await createIssue(ctx.gql, {
          teamId,
          title,
          priority,
          labelIds,
        });
        outputIdOnly(result.identifier);
      }),
    );

  issues
    .command("query [expression...]")
    .description(
      "query issues with a structured expression language (compound boolean filters)",
    )
    .option("-n, --limit <n>", "max results (default: 50, 0 = unlimited)")
    .option(
      "-a, --all",
      "include closed issues (default: excluded unless query specifies status)",
      false,
    )
    .option(
      "--sort <field>",
      "sort by: priority, created, updated, completed, status, id, title, type, assignee",
    )
    .option("-r, --reverse", "reverse sort order", false)
    .option(
      "--parse-only",
      "parse and print the AST without executing (debug)",
      false,
    )
    .option(
      "--with-comment-counts",
      "include a per-issue comment count (commentCount) in each result; one batched query for the page (no N+1), matching `issues list --with-comment-counts`",
    )
    .addHelpText(
      "after",
      `\nExpression syntax:\n  field=value | field!=value | field<value | field<=value | field>value | field>=value\n  AND  OR  NOT  ( )\n\nSupported fields:\n  status (open|in_progress|blocked|deferred|closed),\n  priority (Linear scheme: 0=no, 1=urgent, 2=high, 3=medium, 4=low),\n  type (Linear-Hack: type:<value> label),\n  assignee (displayName, or "none" for unassigned),\n  label (or "none" for unlabeled),\n  title, description, id, parent,\n  created, updated, closed, started (durations like 7d/24h/2w, or YYYY-MM-DD),\n  metadata.<key> (matches the Linear-Hack metadata block client-side: metadata.sprint=12,\n    metadata.key=* for "key exists", metadata.key=none for "key absent"; = / != only; AND-context only)`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [exprParts, options, command] = args as [
          string[] | undefined,
          {
            limit?: string;
            all: boolean;
            sort?: string;
            reverse: boolean;
            parseOnly: boolean;
            withCommentCounts?: boolean;
          },
          Command,
        ];

        if (!exprParts || exprParts.length === 0) {
          throw invalidParameterError(
            "<expression>",
            "query expression is required",
          );
        }

        const expression = exprParts.join(" ");
        const node = parseQuery(expression);

        const rootOpts = getRootOpts(command);

        if (options.parseOnly) {
          outputResult(
            { ast: astToString(node) },
            (data) => `Parsed query: ${data.ast}\n`,
            rootOpts,
          );
          return;
        }

        const ctx = createContext(rootOpts);
        const { filter, metadataPredicates } = compile(node);
        const hasMetadata = metadataPredicates.length > 0;

        const finalFilter: IssueFilter =
          options.all || hasExplicitStatusFilter(node)
            ? filter
            : {
                and: [
                  {
                    state: { type: { nin: [...CLOSED_STATE_TYPES] } },
                  },
                  filter,
                ],
              };

        const limitRaw =
          options.limit !== undefined ? parseLimit(options.limit) : 50;
        // A metadata.<key> filter is matched client-side (no server-side
        // metadata index), so fetch the max page and apply the limit AFTER
        // filtering — otherwise the limit would count pre-filter rows.
        // (lin-ov30.1)
        const pageSize = hasMetadata
          ? 250
          : limitRaw === 0
            ? 250
            : Math.min(limitRaw, 250);

        // `--all` must propagate into the service layer too — listIssues
        // otherwise auto-wraps the filter with the default closed-state filter
        // when the user hasn't supplied an explicit state filter, which
        // silently strips closed issues even when the caller asked for them.
        const result = await listIssues(
          ctx.gql,
          { limit: pageSize },
          finalFilter,
          { includeClosed: options.all },
        );

        const matched = hasMetadata
          ? result.nodes.filter((issue) =>
              metadataPredicates.every((p) => p(issue.description)),
            )
          : result.nodes;

        const sorted = sortQueryResults(matched, options.sort, options.reverse);

        const limited = limitRaw === 0 ? sorted : sorted.slice(0, limitRaw);

        // Enrich AFTER metadata-filter + sort + slice so we count comments only
        // for the rows that actually ship — and only when asked. Reuses the
        // same batched, no-N+1 helper as `issues list`. (lin-ov30.8)
        const enriched = await attachCommentCounts(
          ctx,
          { nodes: limited, pageInfo: result.pageInfo },
          Boolean(options.withCommentCounts),
        );

        outputResult(enriched, (data) => formatIssueList(data), rootOpts);
      }),
    );

  issues
    .command("create <title>")
    .description("create new issue")
    .addHelpText(
      "after",
      `\nDescription input: pass --description <text>, --body-file <path> (use - for stdin), or --stdin. These are mutually exclusive.\n\nDesign input: pass --design <text>, --design-file <path>, or --design-stdin to attach architectural rationale as a '## Design' section appended to the description (Linear-Hack; Linear has no native design field).\n\nQuality sections: --context, --acceptance, --test, --notes populate the '## Context', '## Acceptance Criteria', '## Test Plan', '## Notes' sections (Linear-Hack: Linear has no native fields for these). --context/--acceptance/--test are required by the validation gate.\n\nType: --type <value> is stored as a 'type:<value>' label (Linear-Hack; Linear has no native issue-type field). Aliases: feat/enhancement→feature, dec/adr→decision.\n\nDeferral: --defer <when> files the issue already deferred, attaching the 'deferred' + 'deferred-until:<date>' labels so it is hidden from 'next' until then. Accepts the same grammar as 'snooze' (a date, ISO datetime, an anchor like tomorrow/next week/<weekday>, or a relative offset like 6h/7d/2w). Undo later with 'linear wake <id>'.\n\nValidation: blocked by default when those sections are missing (validation.on-create=error). Pass --no-validate to skip for one create, or 'linear config set validation.on-create off|warn|error' to change the default.`,
    )
    .option("--description <text>", "issue body")
    .option("--body-file <path>", "read issue body from file (use - for stdin)")
    .option("--stdin", "read issue body from stdin (alias for --body-file -)")
    .option(
      "--design <text>",
      "architectural rationale (stored as '## Design' section)",
    )
    .option("--design-file <path>", "read design from a file (use - for stdin)")
    .option("--design-stdin", "read design from stdin", false)
    .option(
      "--context <text>",
      "why this work exists / background (stored as '## Context' section; required by the validation gate)",
    )
    .option(
      "--acceptance <text>",
      "what 'done' looks like (stored as '## Acceptance Criteria' section; required by the validation gate)",
    )
    .option(
      "--test <text>",
      "how the change is verified (stored as '## Test Plan' section; required by the validation gate)",
    )
    .option(
      "--notes <text>",
      "supplementary context (stored as the '## Notes' section)",
    )
    .option(
      "--type <type>",
      "issue type (bug|feature|task|epic|chore|decision|...); stored as a 'type:<value>' label (Linear-Hack). Aliases: feat/enhancement→feature, dec/adr→decision",
    )
    .option(
      "--validate",
      "force required-section validation on, even if validation.on-create is off",
    )
    .option("--no-validate", "skip required-section validation for this create")
    .option(
      "--dry-run",
      "preview the resolved issue (title, team, type, priority, labels, relations, assembled description) without creating it or any labels",
    )
    .option("--assignee <user>", "assign to user")
    .option(
      "--no-assign",
      "leave the new issue unassigned (default: auto-assign the creator / @me)",
    )
    .option("--priority <1-4>", "1=urgent 2=high 3=medium 4=low")
    .option("--project <project>", "add to project")
    .option(
      "--team <team>",
      "target team (defaults to team.default config / LINEAR_TEAM)",
    )
    .option("--labels <labels>", "comma-separated label names or UUIDs")
    .option("--project-milestone <ms>", "set milestone (requires --project)")
    .option("--cycle <cycle>", "add to cycle (requires --team)")
    .option("--status <status>", "set status")
    .option("--estimate <n>", "set estimate")
    .option("--parent-ticket <issue>", "set parent issue")
    .option("--due-date <date>", "due date (YYYY-MM-DD)")
    .option("--blocks <issue>", "this issue blocks <issue>")
    .option("--blocked-by <issue>", "this issue is blocked by <issue>")
    .option("--relates-to <issue>", "this issue relates to <issue>")
    .option("--duplicate-of <issue>", "this issue duplicates <issue>")
    .option(
      "--no-scope",
      "do not auto-tag with the implicit repo scope label / project default",
    )
    .option(
      "--scope <label>",
      "auto-tag with this label instead of the implicit scope",
    )
    .option(
      "--external-ref <ref>",
      "external reference key (e.g. gh-123); stored as a queryable `ref:<value>` label (Linear-Hack for an external-reference field). Filter later with `--label ref:<value>`",
    )
    .option(
      "--metadata <json>",
      "attach JSON metadata (Linear-Hack for an arbitrary-JSON metadata field); stored as a fenced ```metadata block in the description and surfaced in `read --json`. Use @file.json to read from a file",
    )
    .option(
      "--defer <when>",
      "file the issue already deferred; applies the `deferred` + `deferred-until:<date>` labels so it is hidden from `next`. Accepts a date (YYYY-MM-DD), ISO datetime, natural-language anchor (tomorrow, next week, a weekday), or a relative offset (6h, 7d, 2w)",
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [title, options, command] = args as [
          string,
          CreateOptions,
          Command,
        ];
        const rootOpts = getRootOpts(command);

        // Parse --metadata up front (pure, no I/O beyond an optional @file read)
        // so a malformed value is rejected before any network call and the
        // resolved block is reflected in --dry-run too. (lin-e64s)
        const createMetadata = options.metadata
          ? resolveMetadataInput(options.metadata)
          : null;

        // Parse --defer up front too (pure), so a bad resurface date is rejected
        // before any write and the deferred labels show in --dry-run. The
        // resulting `deferred-until:` suffix drives the label pair below.
        // (lin-ov30.4)
        let deferUntil: string | undefined;
        if (options.defer !== undefined) {
          const raw = options.defer.trim();
          if (raw.length === 0) {
            throw invalidParameterError(
              "--defer",
              "expected a resurface date (e.g. tomorrow, 7d, 2026-06-10)",
            );
          }
          deferUntil = parseDeferWhen(raw, new Date());
          const untilMs = deferInstant(deferUntil);
          if (untilMs !== null && untilMs <= Date.now()) {
            console.error(
              `Warning: resurface date ${deferUntil} is in the past; issue will appear in 'next' immediately.`,
            );
          }
        }

        // Assemble the description and run the create-time quality gate BEFORE
        // any network call (lin-z3b3): a blocked create teaches the agent the
        // required sections without burning an API round-trip.
        // The gate is resolved from the issue's type, so an epic is asked for
        // `## Success Criteria` and a chore for neither criteria section --
        // exactly what `issues lint` will later demand of the same issue.
        // The gate returns the body to create with: a criteria section written
        // as bare lines is repaired into markdown here, so the issue that
        // reaches Linear is the one the template describes.
        const assembledDescription = enforceCreateValidation(
          assembleCreateDescription(options),
          options.validate,
          options.type ? normalizeIssueType(options.type) : null,
        );

        // The validation gate inspects the human body only; the metadata block
        // is appended AFTER it so a provenance block never satisfies (or
        // breaks) the required-section check. (lin-e64s)
        const finalDescription = createMetadata
          ? withMetadataBlock(assembledDescription, createMetadata)
          : assembledDescription;

        const ctx = createContext(rootOpts);

        const relationActions = parseRelationFlags(options);

        const parsedPriority =
          options.priority !== undefined
            ? parsePriorityOption(options.priority)
            : undefined;
        const parsedEstimate =
          options.estimate !== undefined
            ? parseEstimateOption(options.estimate)
            : undefined;

        // Provenance-aware team resolution (lin-4wvh): an explicit --team is
        // `flag`; otherwise the value + the config layer it came from so the
        // output can explain *why* this team was chosen.
        const teamProvenance: CreateTeamProvenance | null = (() => {
          if (options.team !== undefined) {
            return { team: options.team, source: "flag" };
          }
          const resolved = getDefaultTeamWithSource();
          return resolved.value && resolved.source
            ? { team: resolved.value, source: resolved.source }
            : null;
        })();

        const teamKey = teamProvenance?.team ?? null;
        if (!teamKey) {
          throw invalidParameterError(
            "--team",
            "no team provided — pass --team <key>, set LINEAR_TEAM, or run `linear config set team.default <key>`",
          );
        }

        const scope = resolveScopeOption(options.scope);

        // --dry-run previews the resolved issue WITHOUT any mutation
        // (lin-jw2x). It deliberately runs before the resolve*/ensure* network
        // calls because ensureWorkspaceLabel would otherwise CREATE labels —
        // a dry run must have zero side effects. Everything shown here is
        // derived from pure parsing already done above.
        if (options.dryRun) {
          const dryType = options.type
            ? normalizeIssueType(options.type)
            : null;
          const dryLabels = [
            ...(dryType ? [`type:${dryType}`] : []),
            ...(options.labels
              ? options.labels
                  .split(",")
                  .map((l) => l.trim())
                  .filter(Boolean)
              : []),
            ...(options.externalRef ? [refLabelName(options.externalRef)] : []),
            ...(deferUntil
              ? [DEFERRED_LABEL, `${DEFERRED_UNTIL_PREFIX}${deferUntil}`]
              : []),
            ...(scope?.label ? [scope.label] : []),
          ];
          const preview: CreateDryRunPreview = {
            dry_run: true,
            title,
            team: teamKey,
            team_source: teamProvenance?.source ?? null,
            type: dryType,
            priority: parsedPriority ?? null,
            estimate: parsedEstimate ?? null,
            status: options.status ?? null,
            assignee:
              options.assignee ?? (options.assign !== false ? "@me" : null),
            project: options.project ?? scope?.project ?? null,
            parent: options.parentTicket ?? null,
            labels: [...new Set(dryLabels)],
            description: finalDescription ?? null,
            metadata: createMetadata,
            relations: relationActions.map((r) => ({
              type: r.type,
              targets: r.targets,
            })),
          };
          outputResult(preview, formatCreateDryRun, rootOpts);
          return;
        }

        const teamEstimateContext =
          parsedEstimate !== undefined
            ? await resolveTeamEstimateContext(ctx.sdk, teamKey)
            : undefined;

        const teamId = teamEstimateContext
          ? teamEstimateContext.teamId
          : await resolveTeamId(ctx.sdk, teamKey);

        if (parsedEstimate !== undefined && teamEstimateContext) {
          validateEstimateAgainstTeamConfig(parsedEstimate, {
            teamKey: teamEstimateContext.teamKey,
            issueEstimationType: teamEstimateContext.issueEstimationType,
            issueEstimationExtended:
              teamEstimateContext.issueEstimationExtended,
            issueEstimationAllowZero:
              teamEstimateContext.issueEstimationAllowZero,
          });
        }

        const input: IssueCreateInput = {
          title,
          teamId,
        };

        if (finalDescription !== undefined) {
          input.description = finalDescription;
        }

        // Owner-on-create (lin-8yl1.4): assign the creator by default so a
        // `my-work` filter sees freshly created issues. Resolve an
        // explicit --assignee, else default to the token identity (@me) unless
        // --no-assign was passed.
        if (options.assignee) {
          input.assigneeId = await resolveUserId(ctx.sdk, options.assignee);
        } else if (options.assign !== false) {
          input.assigneeId = await resolveUserId(ctx.sdk, "@me");
        }

        if (parsedPriority !== undefined) {
          input.priority = parsedPriority;
        }

        if (parsedEstimate !== undefined) {
          input.estimate = parsedEstimate;
        }

        if (options.project) {
          input.projectId = await resolveProjectId(ctx.sdk, options.project);
        }

        if (options.labels) {
          const labelNames = options.labels.split(",").map((l) => l.trim());
          input.labelIds = await ensureWorkspaceLabelIds(ctx.gql, labelNames);
        }

        // `--type` maps to Linear's type:<value> label convention
        // (Linear-Hack — Linear has no native issue-type field). Normalize
        // the aliases, then ensure the workspace label and attach it
        // alongside any explicit --labels (lin-8yl1.2).
        if (options.type) {
          const typeName = normalizeIssueType(options.type);
          if (typeName.length > 0) {
            const typeLabelId = await ensureWorkspaceLabel(
              ctx.gql,
              `type:${typeName}`,
              `Issue type: ${typeName}`,
            );
            input.labelIds = [...(input.labelIds ?? []), typeLabelId];
          }
        }

        if (options.projectMilestone) {
          if (!options.project) {
            throw new Error(
              "--project-milestone requires --project to be specified",
            );
          }
          input.projectMilestoneId = await resolveMilestoneId(
            ctx.gql,
            ctx.sdk,
            options.projectMilestone,
            options.project,
          );
        }

        if (options.cycle) {
          input.cycleId = await resolveCycleId(ctx.sdk, options.cycle, teamKey);
        }

        if (options.status) {
          input.stateId = await resolveStatusId(
            ctx.sdk,
            options.status,
            teamId,
          );
        }

        if (options.parentTicket) {
          input.parentId = await resolveIssueId(ctx.sdk, options.parentTicket);
        }

        if (options.dueDate) {
          input.dueDate = parseDueDate(options.dueDate);
        }

        if (scope) {
          if (scope.project && !input.projectId) {
            input.projectId = await resolveProjectId(ctx.sdk, scope.project);
          }
          if (scope.label) {
            const [scopeLabelId] = await ensureWorkspaceLabelIds(ctx.gql, [
              scope.label,
            ]);
            input.labelIds = [...(input.labelIds ?? []), scopeLabelId];
          }
        }

        // external reference key → a queryable `ref:<value>` label
        // (Linear-Hack; Linear has no external-reference scalar). (lin-qev5)
        if (options.externalRef) {
          const refLabelId = await ensureWorkspaceLabel(
            ctx.gql,
            refLabelName(options.externalRef),
            "Linear-Hack: external reference key.",
          );
          input.labelIds = [...(input.labelIds ?? []), refLabelId];
        }

        // --defer: attach the `deferred` + `deferred-until:<suffix>` Linear-Hack
        // labels so the issue is born hidden from `next`.
        // Reuses the exact label names/descriptions snooze applies, so
        // `snooze verify` and `wake` treat a deferred-on-create issue identically.
        // (lin-ov30.4)
        if (deferUntil) {
          const deferredId = await ensureWorkspaceLabel(
            ctx.gql,
            DEFERRED_LABEL,
            "Linear-Hack: issue is deferred and hidden from `next`.",
          );
          const untilId = await ensureWorkspaceLabel(
            ctx.gql,
            `${DEFERRED_UNTIL_PREFIX}${deferUntil}`,
            "Linear-Hack: resurface date for a deferred issue.",
          );
          input.labelIds = [...(input.labelIds ?? []), deferredId, untilId];
        }

        const result = await createIssue(ctx.gql, input);

        if (relationActions.length > 0) {
          await resolveAndApplyRelations(ctx, result.id, relationActions);
        }

        // Attach the team provenance so both text and JSON callers can see
        // which config layer chose the team when --team was omitted (lin-4wvh).
        outputResult(
          { ...result, team_provenance: teamProvenance },
          formatIssueCreate,
          rootOpts,
        );
      }),
    );

  issues
    .command("create-form")
    .description(
      "interactively create an issue via a TTY form (agent-blocking)",
    )
    .option(
      "--parent <issue>",
      "parent issue ID — creates a child of an existing issue",
    )
    .addHelpText(
      "after",
      `\nAgent-blocking: requires a TTY. Agents must use \`linear issues create\` with explicit flags.\n\nFields collected: title (required), team (required), description, context, type, priority, assignee, labels, design, acceptance criteria, test.\n\nContext / design / acceptance criteria / test are stored as \`## Context\` / \`## Design\` / \`## Acceptance Criteria\` / \`## Test Plan\` sections in the description (Linear-Hack). The form warns (but does not block) if the required Context / Acceptance Criteria / Test sections are left empty. Type is stored as a \`type:<value>\` label (Linear-Hack).`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [{ parent?: string }, Command];

        if (!process.stdin.isTTY) {
          throw invalidParameterError(
            "create-form",
            "interactive form requires a TTY; use `linear issues create` with explicit flags for non-interactive use",
          );
        }

        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const result = await runCreateForm(ctx, { parent: options.parent });
        outputResult(result, formatIssueCreateForm, rootOpts);
      }),
    );

  issues
    .command("update <issue>")
    .description("update an existing issue")
    .addHelpText(
      "after",
      `\nWhen passing issue IDs, both UUID and identifiers like ABC-123 are supported.\n\nDescription input: pass --description <text>, --body-file <path> (use - for stdin), or --stdin. These are mutually exclusive.\n\nDesign input: pass --design <text>, --design-file <path>, or --design-stdin to replace the '## Design' section in the description (Linear-Hack). When combined with a description flag, the section merges into the new description; otherwise it merges into the existing one.\n\nSection editors: --context, --acceptance, --test, --notes each surgically replace one '## Heading' in place (the rest of the description is preserved), mirroring the same flags on 'issues create'. --append-notes adds to '## Notes' without discarding existing content (mutually exclusive with --notes). Without a description flag these splice into the issue's current body; with one, into the new description.`,
    )
    .option("--title <text>", "new title")
    .option("--description <text>", "new description")
    .option(
      "--body-file <path>",
      "read new description from file (use - for stdin)",
    )
    .option(
      "--stdin",
      "read new description from stdin (alias for --body-file -)",
    )
    .option(
      "--design <text>",
      "architectural rationale (replaces '## Design' section)",
    )
    .option("--design-file <path>", "read design from a file (use - for stdin)")
    .option("--design-stdin", "read design from stdin", false)
    .option(
      "--context <text>",
      "why this work exists / background (replaces '## Context' section in place)",
    )
    .option(
      "--acceptance <text>",
      "what 'done' looks like (replaces '## Acceptance Criteria' section in place)",
    )
    .option(
      "--test <text>",
      "how the change is verified (replaces '## Test Plan' section in place)",
    )
    .option(
      "--notes <text>",
      "supplementary context (replaces '## Notes' section in place)",
    )
    .option(
      "--append-notes <text>",
      "append to the '## Notes' section, preserving existing content. Mutually exclusive with --notes",
    )
    .option("--status <status>", "new status")
    .option("--priority <1-4>", "new priority")
    .option("--assignee <user>", "new assignee")
    .option("--clear-assignee", "unassign the issue")
    .option("--project <project>", "new project")
    .option("--labels <labels>", "labels to apply (comma-separated)")
    .option("--label-mode <mode>", "add | overwrite")
    .option("--clear-labels", "remove all labels")
    .option("--parent-ticket <issue>", "set parent issue")
    .option("--clear-parent-ticket", "clear parent")
    .option("--project-milestone <ms>", "set project milestone")
    .option("--clear-project-milestone", "clear project milestone")
    .option("--cycle <cycle>", "set cycle")
    .option("--clear-cycle", "clear cycle")
    .option("--estimate <n>", "new estimate")
    .option("--clear-estimate", "clear estimate")
    .option("--due-date <date>", "set due date (YYYY-MM-DD)")
    .option("--clear-due-date", "clear due date")
    .option("--blocks <issue>", "add blocks relation")
    .option("--blocked-by <issue>", "add blocked-by relation")
    .option("--relates-to <issue>", "add relates-to relation")
    .option("--duplicate-of <issue>", "add duplicate relation")
    .option("--remove-relation <issue>", "remove relation with <issue>")
    .option(
      "--external-ref <ref>",
      "set the external reference key (replaces any prior `ref:<value>` label; Linear-Hack for an external-reference field)",
    )
    .option(
      "--clear-external-ref",
      "remove the external reference (strip any `ref:<value>` label)",
    )
    .option(
      "--metadata <json>",
      "merge JSON metadata into the issue's ```metadata block (Linear-Hack for an arbitrary-JSON metadata field; @file.json supported). Mutually exclusive with --set/unset-metadata",
    )
    .option(
      "--set-metadata <key=value>",
      "set one metadata key (repeatable); value is JSON-coerced (number/bool/null) else string",
      collectRepeatable,
      [],
    )
    .option(
      "--unset-metadata <key>",
      "remove one metadata key (repeatable)",
      collectRepeatable,
      [],
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [issue, options, command] = args as [
          string,
          UpdateOptions,
          Command,
        ];
        if (options.parentTicket && options.clearParentTicket) {
          throw new Error(
            "Cannot use --parent-ticket and --clear-parent-ticket together",
          );
        }

        if (options.projectMilestone && options.clearProjectMilestone) {
          throw new Error(
            "Cannot use --project-milestone and --clear-project-milestone together",
          );
        }

        if (options.estimate !== undefined && options.clearEstimate) {
          throw new Error(
            "Cannot use --estimate and --clear-estimate together",
          );
        }

        if (options.cycle && options.clearCycle) {
          throw new Error("Cannot use --cycle and --clear-cycle together");
        }

        if (options.assignee !== undefined && options.clearAssignee) {
          throw new Error(
            "Cannot use --assignee and --clear-assignee together",
          );
        }

        if (options.dueDate && options.clearDueDate) {
          throw new Error(
            "Cannot use --due-date and --clear-due-date together",
          );
        }

        // Reject --notes + --append-notes together (replace vs
        // append are contradictory intents).
        if (options.notes !== undefined && options.appendNotes !== undefined) {
          throw new Error("Cannot use --notes and --append-notes together");
        }

        if (options.labelMode && !options.labels) {
          throw new Error("--label-mode requires --labels to be specified");
        }

        if (options.clearLabels && options.labels) {
          throw new Error("--clear-labels cannot be used with --labels");
        }

        if (options.clearLabels && options.labelMode) {
          throw new Error("--clear-labels cannot be used with --label-mode");
        }

        if (options.externalRef && options.clearExternalRef) {
          throw new Error(
            "Cannot use --external-ref and --clear-external-ref together",
          );
        }

        // External-ref labels are managed against the issue's current label
        // set, so combining with bulk label edits would race over the same
        // labelIds field. Keep them separate and predictable. (lin-qev5)
        const editsExternalRef =
          options.externalRef !== undefined || options.clearExternalRef;
        if (
          editsExternalRef &&
          (options.labels || options.clearLabels || options.labelMode)
        ) {
          throw new Error(
            "--external-ref / --clear-external-ref cannot be combined with --labels / --clear-labels / --label-mode; run them as separate updates",
          );
        }

        const setMeta = options.setMetadata ?? [];
        const unsetMeta = options.unsetMetadata ?? [];
        const editsMetadata =
          options.metadata !== undefined ||
          setMeta.length > 0 ||
          unsetMeta.length > 0;
        if (
          options.metadata !== undefined &&
          (setMeta.length > 0 || unsetMeta.length > 0)
        ) {
          throw new Error(
            "cannot combine --metadata with --set-metadata / --unset-metadata",
          );
        }

        if (
          options.labelMode &&
          !["add", "overwrite"].includes(options.labelMode)
        ) {
          throw new Error("--label-mode must be either 'add' or 'overwrite'");
        }

        const parsedPriority =
          options.priority !== undefined
            ? parsePriorityOption(options.priority)
            : undefined;
        const parsedEstimate =
          options.estimate !== undefined
            ? parseEstimateOption(options.estimate)
            : undefined;

        const relationActions = parseRelationFlags(options);

        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);

        const issueEstimateContext =
          parsedEstimate !== undefined
            ? await resolveIssueEstimateContext(ctx.sdk, issue)
            : undefined;

        const resolvedIssueId = issueEstimateContext
          ? issueEstimateContext.issueId
          : await resolveIssueId(ctx.sdk, issue);

        if (parsedEstimate !== undefined && issueEstimateContext) {
          validateEstimateAgainstTeamConfig(parsedEstimate, {
            teamKey: issueEstimateContext.team.teamKey,
            issueEstimationType: issueEstimateContext.team.issueEstimationType,
            issueEstimationExtended:
              issueEstimateContext.team.issueEstimationExtended,
            issueEstimationAllowZero:
              issueEstimateContext.team.issueEstimationAllowZero,
          });
        }

        const resolvedDescription = resolveBodyInput(options);
        const resolvedDesign = resolveDesignInput(options);

        // Any section-targeted editor (lin-ov30.2): each surgically replaces one
        // '## Heading' in place rather than rewriting the whole description, so
        // revising e.g. Acceptance Criteria can't clobber sibling sections.
        const editsSections =
          resolvedDesign !== undefined ||
          options.context !== undefined ||
          options.acceptance !== undefined ||
          options.test !== undefined ||
          options.notes !== undefined ||
          options.appendNotes !== undefined;

        const needsContext =
          options.status ||
          options.projectMilestone ||
          options.cycle ||
          (options.labels && options.labelMode === "add") ||
          editsExternalRef ||
          editsMetadata ||
          (editsSections && resolvedDescription === undefined);
        const issueContext = needsContext
          ? await getIssue(ctx.gql, resolvedIssueId)
          : undefined;

        const input: IssueUpdateInput = {};

        if (options.title) {
          input.title = options.title;
        }

        if (editsSections) {
          // Base is the new --description when provided, else the issue's
          // current body, so a section edit splices into existing content.
          let base =
            resolvedDescription ??
            (issueContext && "description" in issueContext
              ? (issueContext.description ?? "")
              : "");
          if (resolvedDesign !== undefined) {
            base = replaceSection(base, "## Design", resolvedDesign);
          }
          if (options.context !== undefined) {
            base = replaceSection(base, "## Context", options.context);
          }
          if (options.acceptance !== undefined) {
            base = replaceSection(
              base,
              "## Acceptance Criteria",
              options.acceptance,
            );
          }
          if (options.test !== undefined) {
            base = replaceSection(base, "## Test Plan", options.test);
          }
          if (options.notes !== undefined) {
            base = replaceSection(base, "## Notes", options.notes);
          }
          if (options.appendNotes !== undefined) {
            base = appendSection(base, "## Notes", options.appendNotes);
          }
          input.description = base;
        } else if (resolvedDescription !== undefined) {
          input.description = resolvedDescription;
        }

        // Metadata edits (lin-e64s): read the EXISTING metadata block, merge
        // (--metadata) or apply set/unset edits, then re-write the block onto
        // whatever description the update lands on (a freshly set one if
        // provided, else the issue's current body). Existing metadata always
        // comes from the issue's current description, never the new --description.
        if (editsMetadata) {
          const existingDescription =
            issueContext && "description" in issueContext
              ? (issueContext.description ?? "")
              : "";
          const existingMetadata = extractMetadata(existingDescription);
          const newMetadata =
            options.metadata !== undefined
              ? mergeMetadata(
                  existingMetadata,
                  resolveMetadataInput(options.metadata),
                )
              : applyMetadataEdits(existingMetadata, setMeta, unsetMeta);
          const baseDescription =
            input.description !== undefined &&
            typeof input.description === "string"
              ? input.description
              : existingDescription;
          input.description = withMetadataBlock(baseDescription, newMetadata);
        }

        if (options.status) {
          const teamId =
            issueContext && "team" in issueContext && issueContext.team
              ? issueContext.team.id
              : undefined;
          input.stateId = await resolveStatusId(
            ctx.sdk,
            options.status,
            teamId,
          );
        }

        if (parsedPriority !== undefined) {
          input.priority = parsedPriority;
        }

        if (options.clearEstimate) {
          input.estimate = null;
        } else if (parsedEstimate !== undefined) {
          input.estimate = parsedEstimate;
        }

        if (options.clearAssignee) {
          input.assigneeId = null;
        } else if (options.assignee) {
          input.assigneeId = await resolveUserId(ctx.sdk, options.assignee);
        }

        if (options.project) {
          input.projectId = await resolveProjectId(ctx.sdk, options.project);
        }

        if (options.clearLabels) {
          input.labelIds = [];
        } else if (options.labels) {
          const labelNames = options.labels.split(",").map((l) => l.trim());
          const labelIds = await ensureWorkspaceLabelIds(ctx.gql, labelNames);

          if (options.labelMode === "add") {
            const currentLabels =
              issueContext &&
              "labels" in issueContext &&
              issueContext.labels?.nodes
                ? issueContext.labels.nodes.map((l) => l.id)
                : [];
            input.labelIds = [...new Set([...currentLabels, ...labelIds])];
          } else {
            input.labelIds = labelIds;
          }
        }

        // External-ref management (lin-qev5): rewrite the label set as
        // (current labels minus any `ref:*`) plus the new `ref:<value>`.
        // The external ref is singular, so a re-set replaces the prior ref;
        // --clear-external-ref just strips it. Guarded above as mutually
        // exclusive with the bulk --labels edits.
        if (editsExternalRef) {
          const currentLabels =
            issueContext &&
            "labels" in issueContext &&
            issueContext.labels?.nodes
              ? issueContext.labels.nodes
              : [];
          const keptIds = currentLabels
            .filter((l) => !isRefLabel(l.name))
            .map((l) => l.id);
          if (options.externalRef !== undefined) {
            const refLabelId = await ensureWorkspaceLabel(
              ctx.gql,
              refLabelName(options.externalRef),
              "Linear-Hack: external reference key.",
            );
            input.labelIds = [...new Set([...keptIds, refLabelId])];
          } else {
            input.labelIds = keptIds;
          }
        }

        if (options.clearParentTicket) {
          input.parentId = null;
        } else if (options.parentTicket) {
          input.parentId = await resolveIssueId(ctx.sdk, options.parentTicket);
        }

        if (options.clearProjectMilestone) {
          input.projectMilestoneId = null;
        } else if (options.projectMilestone) {
          const projectName =
            issueContext &&
            "project" in issueContext &&
            issueContext.project?.name
              ? issueContext.project.name
              : undefined;
          input.projectMilestoneId = await resolveMilestoneId(
            ctx.gql,
            ctx.sdk,
            options.projectMilestone,
            projectName,
          );
        }

        if (options.clearCycle) {
          input.cycleId = null;
        } else if (options.cycle) {
          const teamKey =
            issueContext && "team" in issueContext && issueContext.team?.key
              ? issueContext.team.key
              : undefined;
          input.cycleId = await resolveCycleId(ctx.sdk, options.cycle, teamKey);
        }

        if (options.clearDueDate) {
          input.dueDate = null;
        } else if (options.dueDate) {
          input.dueDate = parseDueDate(options.dueDate);
        }

        const result = await updateIssue(ctx.gql, resolvedIssueId, input);

        if (relationActions.length > 0) {
          await resolveAndApplyRelations(ctx, resolvedIssueId, relationActions);
        }

        outputResult(result, formatIssueUpdate, rootOpts);
      }),
    );

  registerIssueTransferCommands(issues);

  issues
    .command("usage")
    .description("show detailed usage for issues")
    .action(() => {
      console.log(formatDomainUsage(issues, ISSUES_META));
    });
}
