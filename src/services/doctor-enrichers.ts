/**
 * `linear doctor` — ZFC enrichment (lin-ktsk).
 *
 * The doctor checks populate the agent-readable ZFC fields
 * (`observed_state`, `expected_state`, `explanation`, `commands`,
 * `severity`) *inline* on each path. Historically that was inconsistent:
 * an `ok` path might set `observed_state` but omit `explanation`, while an
 * `error` path often dropped `observed_state`/`commands` entirely. Agents
 * consuming `--agent` output then saw blank fields on some paths.
 *
 * This module is the single seam that guarantees consistency. It is a
 * `checkName → enrich(base)` dispatch map that synthesizes the ZFC fields
 * from whatever the check already carries (message/detail/fix/status), so
 * every check on every path ends up with non-empty values.
 *
 * Wiring: `doctor-service.ts` calls `enrichCheck(check)` once per produced
 * check. The enricher fills only the fields the check left empty — values
 * the check set inline win, but no ZFC field is ever left blank. A check
 * with no specialized enricher falls back to `genericEnrich`.
 *
 * linear's `DoctorCheck.severity` is the simple `info | warning | error`
 * triple that maps 1:1 from `status`, so `severityFromStatus` is the
 * canonical derivation and enrichers never hard-code a severity.
 */

import type { CheckStatus, DoctorCheck } from "../common/doctor-types.js";

/** The ZFC fields an enricher is responsible for filling. */
export interface AgentEnrichment {
  observed_state: string;
  expected_state: string;
  explanation: string;
  commands: string[];
  severity: "info" | "warning" | "error";
}

/** An enricher synthesizes ZFC fields from a partially-populated check. */
export type Enricher = (check: DoctorCheck) => AgentEnrichment;

/**
 * Canonical status → severity mapping. linear's severity triple mirrors
 * the status triple 1:1 (info/warning/error), so callers don't have to
 * translate back.
 */
export function severityFromStatus(
  status: CheckStatus,
): AgentEnrichment["severity"] {
  if (status === "error") return "error";
  if (status === "warning") return "warning";
  return "info";
}

/**
 * Generic fallback used for any check without a specialized enricher (and
 * as the base every specialized enricher layers on top of). Synthesizes
 * each ZFC field from the check's existing message/detail/fix so the field
 * is never blank.
 */
export function genericEnrich(check: DoctorCheck): AgentEnrichment {
  const observedParts = [check.message];
  if (check.detail) observedParts.push(check.detail);

  const explanationParts = [
    `${check.name} check reported ${check.status}: ${check.message}`,
  ];
  if (check.detail) explanationParts.push(check.detail);
  if (check.fix) explanationParts.push(`To fix: ${check.fix}`);

  return {
    observed_state: observedParts.join(" — "),
    expected_state: `${check.name} check passes (status ok)`,
    explanation: explanationParts.join(" "),
    commands: check.fix ? [check.fix] : [`linear doctor --check ${check.name}`],
    severity: severityFromStatus(check.status),
  };
}

/**
 * Build a specialized enricher from per-status explanation text plus a
 * stable expected-state and command list. Keeps each entry in the dispatch
 * table a single declarative object instead of a hand-rolled function,
 * while still letting the explanation vary by status (ok vs warn vs error).
 */
function makeEnricher(spec: {
  expected: string;
  commands: string[];
  /** Explanation by status; falls back to the generic prose if unset. */
  explain: Partial<Record<CheckStatus, string>>;
}): Enricher {
  return (check) => {
    const generic = genericEnrich(check);
    return {
      observed_state: generic.observed_state,
      expected_state: spec.expected,
      explanation: spec.explain[check.status] ?? generic.explanation,
      commands: spec.commands,
      severity: severityFromStatus(check.status),
    };
  };
}

/**
 * Name → specialized enricher dispatch table. Covers every workspace and
 * hygiene check produced by doctor-service.ts. The four integration-health
 * checks (claude_plugin/settings/hooks, cli_in_path) already populate rich
 * ZFC fields inline in doctor-agent-service.ts, so they intentionally fall
 * through to `genericEnrich` here — `enrichCheck` preserves their inline
 * values and only backfills anything missing.
 */
const ENRICHERS: Record<string, Enricher> = {
  auth: makeEnricher({
    expected: "viewer query returns an authenticated user",
    commands: ["linear auth status", "linear auth"],
    explain: {
      ok: "The configured API token resolved to a Linear user, so authenticated requests will succeed.",
      error:
        "The configured API token did not resolve to a user. Most often this means the token has been rotated or revoked; re-run `linear auth` to mint a fresh one.",
    },
  }),
  stale: makeEnricher({
    expected: "0 non-terminal issues older than the stale-days threshold",
    commands: [
      "linear blocked",
      "linear issues list --status open,in_progress --updated-before 30d",
    ],
    explain: {
      ok: "No non-terminal issues have gone stale, so the backlog is being actively triaged.",
      warning:
        "Non-terminal issues have not been updated within the stale-days window. This is a backlog-hygiene smell — review each for closure, defer, or reassignment.",
      error:
        "The stale-issue query failed before a count could be computed, so backlog staleness is currently unknown.",
    },
  }),
  unassigned: makeEnricher({
    expected: "0 non-terminal issues without an assignee",
    commands: ["linear issues list --assignee null"],
    explain: {
      ok: "Every open issue has an assignee, so no work is sitting unclaimed.",
      warning:
        "Non-terminal issues have no assignee. Unassigned work accumulates when issues are filed but never claimed; triage and assign owners.",
      error:
        "The unassigned-issue query failed before a count could be computed, so assignment coverage is currently unknown.",
    },
  }),
  labels: makeEnricher({
    expected: "every required label is present in the workspace",
    commands: ["linear labels list", "linear labels create <name>"],
    explain: {
      ok: "All required labels are present (or none are configured), so the label convention is satisfied.",
      warning:
        "One or more required labels are missing from the workspace. Workflow steps that filter on those labels will silently match nothing until they are created.",
      error:
        "The label-list query failed, so required-label coverage could not be verified.",
    },
  }),
  scope_label_exists: makeEnricher({
    expected: "the configured scope.label exists as a Linear label",
    commands: ["linear labels list", "linear adopt --all"],
    explain: {
      ok: "The configured scope label exists in Linear, so scoped reads and writes resolve to it correctly.",
      warning:
        "The configured scope label does not yet exist in Linear. Label creation is deferred until the first write, so scoped reads return zero results until then. Run `linear adopt --all` or create once to materialize it.",
      error:
        "Querying Linear for the scope label failed, so its existence could not be verified.",
    },
  }),
  scope_drift: makeEnricher({
    expected:
      "scope.label matches the label linear would derive from the current git remote",
    commands: ["git remote get-url origin", "linear config get scope.label"],
    explain: {
      ok: "The configured scope label matches what git derivation would produce now, so there is no drift between the repo and its scope.",
      warning:
        "The configured scope.label no longer matches what linear would derive from the current git remote. The remote (or repo basename) changed after the local scope was written. Adopt the new derivation or keep the existing label if intentional.",
    },
  }),
  scope_coverage: makeEnricher({
    expected:
      "every open issue in scope.default_project carries the scope label",
    commands: ["linear adopt --dry-run", "linear adopt --all"],
    explain: {
      ok: "Every open issue in the default project carries the scope label, so scoped reads see the full project.",
      warning:
        "Some open issues in scope.default_project are missing the scope label. Untagged work in this project is invisible to scoped reads (e.g. `linear next`). Backfill with `linear adopt --all`.",
      error:
        "The scope-coverage query failed, so it is unknown whether the default project is fully tagged.",
    },
  }),
  closed_not_archived: makeEnricher({
    expected: "closed-but-not-archived issue count is under the warn threshold",
    commands: [
      "linear issues list --status closed --all",
      "linear issues archive <id>",
    ],
    explain: {
      ok: "The number of closed-but-not-archived issues is under the threshold, which is normal for a healthy workspace.",
      warning:
        "Many closed issues have not been archived. Archiving completed work keeps the active board uncluttered; Linear's auto-archive setting can automate this.",
      error:
        "The closed-not-archived query failed, so archive backlog could not be measured.",
    },
  }),
  broken_parent_edges: makeEnricher({
    expected: "0 open issues whose parent has been archived",
    commands: [
      "linear issues list --has-blockers",
      "linear issues update <child> --parent <new-parent>",
    ],
    explain: {
      ok: "No open issue points at an archived parent, so the issue tree has no tombstone edges.",
      warning:
        "Open issues reference a parent that has been archived. Linear preserves parentId after archive, so children end up with a tombstone parent — confusing for tree views and reports. Reassign them to a live parent or close them out.",
      error:
        "The broken-parent-edges query failed, so tombstone-edge presence could not be determined.",
    },
  }),
  stale_by_team_default: makeEnricher({
    expected: "0 non-terminal issues in team.default older than the threshold",
    commands: ["linear issues stale", "linear config get team.default"],
    explain: {
      ok: "No issues in the default team have gone stale, so the primary team's backlog is current.",
      warning:
        "Either the configured team.default could not be resolved, or it contains stale non-terminal issues. Both are hygiene smells inside the user's primary team — triage with `linear issues stale`.",
      error:
        "The team-scoped stale-issue query failed, so staleness inside team.default is currently unknown.",
    },
  }),
};

/**
 * Backfill the ZFC fields on a single check so all five
 * (`observed_state`, `expected_state`, `explanation`, `commands`,
 * `severity`) are non-empty, regardless of which path produced the check.
 *
 * Values the check set inline always win; the enricher only fills blanks.
 * `severity` is always reconciled to match `status` (the inline checks set
 * it, but this is the one field where an enricher-derived value must agree
 * with the final status). Returns a new object — the input is not mutated.
 */
export function enrichCheck(check: DoctorCheck): DoctorCheck {
  const enricher = ENRICHERS[check.name] ?? genericEnrich;
  const e = typeof enricher === "function" ? enricher(check) : enricher;

  const commands =
    check.commands && check.commands.length > 0 ? check.commands : e.commands;

  return {
    ...check,
    observed_state: nonEmpty(check.observed_state) ?? e.observed_state,
    expected_state: nonEmpty(check.expected_state) ?? e.expected_state,
    explanation: nonEmpty(check.explanation) ?? e.explanation,
    commands,
    severity: check.severity ?? e.severity,
  };
}

/** Returns the string if it is non-empty after trimming, else undefined. */
function nonEmpty(s: string | undefined): string | undefined {
  return s && s.trim() !== "" ? s : undefined;
}
