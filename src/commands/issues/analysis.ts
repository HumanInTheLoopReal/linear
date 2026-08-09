import type { Command } from "commander";
import { getDefaultTeam } from "../../common/config-store.js";
import { createContext, getRootOpts } from "../../common/context.js";
import { invalidParameterError } from "../../common/errors.js";
import { stateTypesForLogicalStatus } from "../../common/issue-lifecycle.js";
import { handleCommand, outputResult } from "../../common/output.js";
import type { DuplicateDetectionFieldsFragment } from "../../gql/graphql.js";
import { resolveStateIdByType } from "../../resolvers/status-resolver.js";
import { resolveTeamId } from "../../resolvers/team-resolver.js";
import { shipCapability } from "../../services/capability-service.js";
import {
  fetchOpenIssuesForMerge,
  findDuplicateGroups,
  findMarkedDuplicates,
  type MarkedDuplicatePair,
  type MergeResult,
  mergeDuplicateGroup,
} from "../../services/duplicate-detection-service.js";
import {
  AI_DEFAULT_MODEL,
  runAIDuplicateDetection,
  runMechanicalDuplicateDetection,
} from "../../services/duplicate-similarity-service.js";
import { runCloseEligibleEpics, runEpicStatus } from "../_epic-status.js";

export interface ShipResultShape {
  status: "shipped" | "already_shipped" | "dry_run";
  capability: string;
  issue_identifier: string;
  label?: string;
  would_add?: string;
}

export function formatIssueShip(result: ShipResultShape): string {
  const { status, capability, issue_identifier: id } = result;
  if (status === "shipped") {
    return `✓ Shipped ${capability} via ${id} (label: ${result.label})\n`;
  }
  if (status === "already_shipped") {
    return `✓ Capability ${capability} already shipped via ${id}\n`;
  }
  return `→ [dry-run] Would ship ${capability} via ${id} (would add label: ${result.would_add})\n`;
}

export function formatMarkedDuplicates(pairs: MarkedDuplicatePair[]): string {
  if (pairs.length === 0) return "";
  const lines: string[] = [
    `Marked duplicates (${pairs.length}) — Linear-native Duplicate relations:`,
    "",
  ];
  for (const pair of pairs) {
    lines.push(
      `  ⚑ marked  ${pair.issue_a_id} "${pair.issue_a_title}"  ←→  ${pair.issue_b_id} "${pair.issue_b_title}"`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

export function formatDuplicatePairs(result: {
  pairs: {
    issue_a_id: string;
    issue_b_id: string;
    issue_a_title: string;
    issue_b_title: string;
    similarity: number;
    method: string;
    reason?: string;
  }[];
  count: number;
  method: string;
  threshold: number;
  candidates_evaluated?: number;
  model?: string;
  marked_duplicates?: MarkedDuplicatePair[];
}): string {
  const marked = result.marked_duplicates ?? [];
  const markedBlock = formatMarkedDuplicates(marked);
  if (result.count === 0) {
    const headline = `No duplicate pairs found (method: ${result.method}, threshold: ${result.threshold}).\n`;
    return markedBlock ? `${headline}\n${markedBlock}` : headline;
  }
  const header = `Found ${result.count} duplicate pair${result.count === 1 ? "" : "s"} (method: ${result.method}, threshold: ${result.threshold}):`;
  const lines: string[] = [header, ""];
  for (const pair of result.pairs) {
    const percent = Math.round(pair.similarity * 100);
    lines.push(
      `  ${percent}%  ${pair.issue_a_id} "${pair.issue_a_title}"  ←→  ${pair.issue_b_id} "${pair.issue_b_title}"`,
    );
    if (pair.reason) lines.push(`       reason: ${pair.reason}`);
  }
  if (result.method === "ai") {
    lines.push("");
    lines.push(`candidates_evaluated: ${result.candidates_evaluated ?? 0}`);
    if (result.model) lines.push(`model: ${result.model}`);
  }
  lines.push("");
  return markedBlock ? `${lines.join("\n")}\n${markedBlock}` : lines.join("\n");
}

export function formatDuplicateGroups(result: {
  duplicate_groups: number;
  groups: {
    title: string;
    issues: { identifier: string; weight: number; is_merge_target: boolean }[];
    suggested_target: string;
    suggested_sources: string[];
    suggested_action: string;
    note: string;
  }[];
  merge_commands?: string[];
  merge_results?: {
    target: string;
    sources: string[];
    closed: string[];
    linked: string[];
    reparented: string[];
    errors: string[];
  }[];
  dry_run?: boolean;
  marked_duplicates?: MarkedDuplicatePair[];
}): string {
  const marked = result.marked_duplicates ?? [];
  const markedBlock = formatMarkedDuplicates(marked);
  if (result.duplicate_groups === 0) {
    const headline = "No duplicate groups found.\n";
    return markedBlock ? `${headline}\n${markedBlock}` : headline;
  }
  const lines: string[] = [
    `Found ${result.duplicate_groups} duplicate group${result.duplicate_groups === 1 ? "" : "s"}:`,
    "",
  ];
  result.groups.forEach((group, index) => {
    lines.push(`Group ${index + 1}: "${group.title}"`);
    for (const issue of group.issues) {
      const marker = issue.is_merge_target ? "▶ target" : "◇ source";
      const suffix = issue.is_merge_target
        ? ""
        : " — close + link as duplicate";
      lines.push(
        `  ${marker}: ${issue.identifier} (weight ${issue.weight})${suffix}`,
      );
    }
    if (group.note) lines.push(`  note: ${group.note}`);
    lines.push("");
  });
  if (result.merge_commands && result.merge_commands.length > 0) {
    const header = result.dry_run ? "Merge plan (dry-run):" : "Merge commands:";
    lines.push(header);
    for (const command of result.merge_commands) lines.push(`  ${command}`);
    lines.push("");
  }
  if (result.merge_results && result.merge_results.length > 0) {
    lines.push("Merge results:");
    for (const merge of result.merge_results) {
      const parts: string[] = [];
      if (merge.closed.length)
        parts.push(`closed [${merge.closed.join(", ")}]`);
      if (merge.linked.length)
        parts.push(`linked [${merge.linked.join(", ")}]`);
      if (merge.reparented.length) {
        parts.push(`reparented [${merge.reparented.join(", ")}]`);
      }
      const status = merge.errors.length === 0 ? "✓" : "✗";
      lines.push(`  ${status} ${merge.target}: ${parts.join(", ")}`);
      for (const error of merge.errors) lines.push(`      error: ${error}`);
    }
    lines.push("");
  }
  const body = lines.join("\n");
  return markedBlock ? `${body}\n${markedBlock}` : body;
}

function mapDuplicateStatusToStateTypes(status: string): string[] | null {
  if (status !== "open" && status !== "in_progress" && status !== "closed") {
    return null;
  }
  const stateTypes = stateTypesForLogicalStatus(status);
  return stateTypes ? [...stateTypes] : null;
}

export function registerIssueAnalysisCommands(issues: Command): void {
  issues
    .command("ship <capability>")
    .description(
      "publish a capability by adding 'provides:<capability>' to the issue tagged 'export:<capability>'",
    )
    .option(
      "--force",
      "ship even if the export-issue is not yet completed",
      false,
    )
    .option("--dry-run", "preview the change without writing", false)
    .addHelpText(
      "after",
      `\nLinear-Hack: capabilities are a label-only convention. An issue exporting
a capability carries label 'export:<capability>'; once shipped, it
additionally carries 'provides:<capability>'. The provides-label is
created on first use as a workspace-wide label. External projects
consume the capability via 'depends add <issue> external:<this-project>:<capability>'.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [capability, options, command] = args as [
          string,
          { force: boolean; dryRun: boolean },
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const result = await shipCapability(ctx.gql, capability, {
          force: options.force,
          dryRun: options.dryRun,
        });
        outputResult(result, formatIssueShip, rootOpts);
      }),
    );

  issues
    .command("epic-status")
    .description(
      "show child-completion progress for every open issue that has children",
    )
    .option(
      "--team <team>",
      "scope to one team (key, name, or UUID); without this, scans the whole workspace",
    )
    .option(
      "--eligible-only",
      "only show issues whose every child is closed (ready to be closed)",
      false,
    )
    .addHelpText(
      "after",
      `\nLinear has no native epic type — any open issue with at least one
child is treated as an epic. 'closed_children' counts children in the
'completed', 'canceled', or 'duplicate' state.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [
          { team?: string; eligibleOnly: boolean },
          Command,
        ];
        await runEpicStatus(command, options);
      }),
    );

  issues
    .command("close-eligible-epics")
    .description(
      "close every open issue whose every child is closed (transitions to 'completed')",
    )
    .option(
      "--team <team>",
      "scope to one team (key, name, or UUID); without this, scans the whole workspace",
    )
    .option("--dry-run", "preview eligible epics without closing them", false)
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [
          { team?: string; dryRun: boolean },
          Command,
        ];
        await runCloseEligibleEpics(command, options);
      }),
    );

  issues
    .command("find-duplicates")
    .alias("find-dups")
    .description(
      "find duplicate issues — exact title+description grouping by default, or token-similarity ranking via --method mechanical",
    )
    .option(
      "--team <team>",
      "scope to one team (key, name, or UUID); without this, scans the whole workspace",
    )
    .option(
      "--method <method>",
      "detection algorithm: 'exact' (default, group-based), 'mechanical' (Jaccard+cosine similarity), or 'ai' (Claude-based semantic comparison)",
      "exact",
    )
    .option(
      "--threshold <n>",
      "similarity threshold for --method mechanical|ai (0.0–1.0)",
      "0.5",
    )
    .option(
      "-n, --limit <n>",
      "max pairs to return for --method mechanical|ai (0 = all)",
      "50",
    )
    .option(
      "-s, --status <status>",
      "filter for --method mechanical|ai: open (default), in_progress, closed, all",
    )
    .option(
      "--model <model>",
      `Anthropic model id for --method ai (default: ${AI_DEFAULT_MODEL})`,
      AI_DEFAULT_MODEL,
    )
    .option(
      "--auto-merge",
      "(--method exact only) close each source, link it as a duplicate of the chosen target, re-parent its children",
      false,
    )
    .option(
      "--dry-run",
      "with --auto-merge, preview the merge plan without writing",
      false,
    )
    .addHelpText(
      "after",
      `\nDefault (--method exact): groups issues by lowercased title + trimmed
description and emits {duplicate_groups, groups}. Optionally
--auto-merge / --dry-run closes sources and links them as duplicates.

--method mechanical: token similarity. Tokenizes title +
description, scores pairs via average of Jaccard + cosine, filters
by --threshold, and emits {pairs, count, method, threshold}.
Comparison is client-side O(N²); slow above ~10K issues.

--method ai: pre-filters mechanically at 0.5×threshold (floor 0.15),
takes the top 100 candidates, then batches 10 at a time to Claude.
Requires ANTHROPIC_API_KEY in the environment. Emits the same shape
as mechanical plus a per-pair 'reason' and top-level
'candidates_evaluated' and 'model'.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [
          {
            team?: string;
            method: string;
            threshold: string;
            limit: string;
            status?: string;
            model: string;
            autoMerge: boolean;
            dryRun: boolean;
          },
          Command,
        ];
        const ctx = createContext(getRootOpts(command));
        const teamKey = options.team ?? getDefaultTeam() ?? undefined;
        const teamId = teamKey
          ? await resolveTeamId(ctx.sdk, teamKey)
          : undefined;

        const allIssuesForMarked = await fetchOpenIssuesForMerge(ctx.gql, {
          teamId,
          stateTypes: null,
        });
        const markedDuplicates = findMarkedDuplicates(
          allIssuesForMarked.values(),
        );

        if (options.method === "mechanical" || options.method === "ai") {
          const threshold = Number.parseFloat(options.threshold);
          if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
            throw invalidParameterError(
              "--threshold",
              "must be a number in [0.0, 1.0]",
            );
          }
          const limit = Number.parseInt(options.limit, 10);
          if (!Number.isFinite(limit) || limit < 0) {
            throw invalidParameterError(
              "--limit",
              "must be a non-negative integer (0 = all)",
            );
          }
          let stateTypes: string[] | null | undefined;
          if (options.status) {
            if (options.status === "all") {
              stateTypes = null;
            } else {
              const types = mapDuplicateStatusToStateTypes(options.status);
              if (types === null) {
                throw invalidParameterError(
                  "--status",
                  `unknown status '${options.status}'. supported: open, in_progress, closed, all`,
                );
              }
              stateTypes = types;
            }
          }

          if (options.method === "mechanical") {
            const result = await runMechanicalDuplicateDetection(ctx.gql, {
              teamId,
              threshold,
              limit,
              stateTypes,
            });
            outputResult(
              { ...result, marked_duplicates: markedDuplicates },
              formatDuplicatePairs,
              getRootOpts(command),
            );
            return;
          }

          const apiKey = process.env.ANTHROPIC_API_KEY;
          if (!apiKey || apiKey.trim() === "") {
            throw invalidParameterError(
              "--method",
              "'ai' requires ANTHROPIC_API_KEY to be set in the environment",
            );
          }
          const { default: Anthropic } = await import("@anthropic-ai/sdk");
          const anthropic = new Anthropic({ apiKey });
          const result = await runAIDuplicateDetection(ctx.gql, anthropic, {
            teamId,
            threshold,
            limit,
            stateTypes,
            model: options.model,
          });
          outputResult(
            { ...result, marked_duplicates: markedDuplicates },
            formatDuplicatePairs,
            getRootOpts(command),
          );
          return;
        }

        if (options.method !== "exact") {
          throw invalidParameterError(
            "--method",
            `unknown method '${options.method}'. supported: exact, mechanical, ai`,
          );
        }

        const groups = await findDuplicateGroups(ctx.gql, { teamId });
        const rootOpts = getRootOpts(command);
        if (!options.autoMerge) {
          outputResult(
            {
              duplicate_groups: groups.length,
              groups,
              marked_duplicates: markedDuplicates,
            },
            formatDuplicateGroups,
            rootOpts,
          );
          return;
        }

        const mergeCommands = groups.flatMap((group) =>
          group.suggested_sources.map(
            (source) =>
              `linear issues mark-duplicate ${source} --of ${group.suggested_target}`,
          ),
        );
        if (options.dryRun) {
          outputResult(
            {
              duplicate_groups: groups.length,
              groups,
              merge_commands: mergeCommands,
              merge_results: [],
              dry_run: true,
              marked_duplicates: markedDuplicates,
            },
            formatDuplicateGroups,
            rootOpts,
          );
          return;
        }

        const fullIssues = await fetchOpenIssuesForMerge(ctx.gql, { teamId });
        const sourceTeamIds = new Set<string>();
        for (const group of groups) {
          for (const sourceId of group.suggested_sources) {
            const source = fullIssues.get(sourceId);
            if (source) sourceTeamIds.add(source.team.id);
          }
        }
        const canceledStateIdByTeam = new Map<string, string>();
        for (const teamUuid of sourceTeamIds) {
          canceledStateIdByTeam.set(
            teamUuid,
            await resolveStateIdByType(ctx.sdk, teamUuid, "canceled"),
          );
        }

        const mergeResults: MergeResult[] = [];
        for (const group of groups) {
          mergeResults.push(
            await mergeDuplicateGroup(
              ctx.gql,
              group,
              fullIssues as Map<string, DuplicateDetectionFieldsFragment>,
              canceledStateIdByTeam,
            ),
          );
        }
        outputResult(
          {
            duplicate_groups: groups.length,
            groups,
            merge_commands: mergeCommands,
            merge_results: mergeResults,
            marked_duplicates: markedDuplicates,
          },
          formatDuplicateGroups,
          rootOpts,
        );
      }),
    );
}
