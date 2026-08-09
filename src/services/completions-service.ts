/**
 * `linear completion` — shell completion support.
 *
 * Two responsibilities:
 *
 *   1. Static script generation — delegates to the pure templates in
 *      `src/common/completion-scripts.ts`. Kept behind this service so the
 *      command layer never imports the template module directly (mirrors the
 *      service-owns-business-logic convention used by `info` / `doctor`).
 *
 *   2. Dynamic issue-ID completion. Linear has no API-level prefix filter, so
 *      we fetch a bounded page of recent open issues via the existing
 *      `listIssues` service and filter client-side on the human identifier
 *      (e.g. `ENG-123`). Results are returned as `{ id, title }` and rendered
 *      as `id\ttitle` lines (tab-separated), the format the shell scripts in
 *      `completion-scripts.ts` parse.
 *
 * Degradation: any failure (no token, network error, timeout) yields an empty
 * completion list rather than throwing — a shell completion call-back must
 * never hang or crash the user's tab-completion.
 */

import type { GraphQLClient } from "../client/graphql-client.js";
import {
  type CompletionShell,
  generateCompletionScript,
} from "../common/completion-scripts.js";
import { listIssues } from "./issue-service.js";

export {
  type CompletionShell,
  completionShells,
  isCompletionShell,
} from "../common/completion-scripts.js";

/**
 * How many recent issues to scan when offering issue-ID completion. Linear's
 * GraphQL API has no prefix filter, so we fetch this many recent open issues
 * and prefix-filter client-side. Bounded so a tab-completion round-trip stays
 * fast.
 */
const ISSUE_COMPLETION_SCAN_LIMIT = 50;

/** A single issue-ID completion candidate. */
export interface IssueCompletion {
  /** The human identifier shown/inserted (e.g. `ENG-123`). */
  id: string;
  /** The issue title, used as the completion description. */
  title: string;
}

/**
 * Generate a shell completion script. Thin wrapper over the pure template
 * dispatcher so the command layer goes through the service.
 */
export function generateScript(
  shell: CompletionShell,
  noDescriptions = false,
): string {
  return generateCompletionScript(shell, noDescriptions);
}

/**
 * Filter a list of issues to those whose identifier starts with `prefix`
 * (case-insensitive), returning `{ id, title }` pairs.
 *
 * Pure helper extracted for direct unit testing — the client-side prefix
 * filter over fetched issues.
 */
export function filterIssueCompletions(
  issues: ReadonlyArray<{ identifier?: string | null; title?: string | null }>,
  prefix: string,
): IssueCompletion[] {
  const needle = prefix.toLowerCase();
  const out: IssueCompletion[] = [];
  for (const issue of issues) {
    const id = issue.identifier;
    if (!id) continue;
    if (needle && !id.toLowerCase().startsWith(needle)) continue;
    out.push({ id, title: issue.title ?? "" });
  }
  return out;
}

/**
 * Render completion candidates as newline-separated `id\ttitle` lines (the
 * format the bash/zsh/fish scripts parse). When `noDescriptions` is set, only
 * the identifier is emitted (the title column is dropped).
 *
 * Pure function — no IO — so it's trivially testable.
 */
export function formatIssueCompletions(
  completions: ReadonlyArray<IssueCompletion>,
  noDescriptions = false,
): string {
  return completions
    .map((c) => (noDescriptions ? c.id : `${c.id}\t${c.title}`))
    .join("\n");
}

/**
 * Dynamic issue-ID completion.
 *
 * Fetches a bounded page of recent open issues and filters by identifier
 * prefix client-side. Never throws: on any error (auth, network) it returns an
 * empty array so the shell completion call-back degrades to "no suggestions"
 * rather than failing.
 */
export async function listIssueIdCompletions(
  client: GraphQLClient,
  prefix: string,
  scanLimit: number = ISSUE_COMPLETION_SCAN_LIMIT,
): Promise<IssueCompletion[]> {
  try {
    const result = await listIssues(client, { limit: scanLimit });
    return filterIssueCompletions(result.nodes, prefix);
  } catch {
    return [];
  }
}
