import type { Command } from "commander";
import { getDefaultTeam } from "../common/config-store.js";
import { createContext, getRootOpts } from "../common/context.js";
import { outputResult } from "../common/output.js";
import { resolveStateIdByType } from "../resolvers/status-resolver.js";
import { resolveTeamId } from "../resolvers/team-resolver.js";
import { getEpicStatuses } from "../services/epic-service.js";
import { updateIssue } from "../services/issue-service.js";
import { statusIcon } from "./_format.js";

interface EpicStatusShape {
  epic: {
    identifier: string;
    title: string;
    state: { name: string; type: string };
  };
  total_children: number;
  closed_children: number;
}

export function formatIssueEpicStatus(rows: EpicStatusShape[]): string {
  if (rows.length === 0) {
    return "\nNo open issues with children found.\n\n";
  }

  const lines: string[] = [];
  for (const row of rows) {
    const icon = statusIcon(row.epic.state.type);
    const percent =
      row.total_children > 0
        ? Math.round((row.closed_children / row.total_children) * 100)
        : 0;
    lines.push("");
    lines.push(`${icon} ${row.epic.identifier} ${row.epic.title}`);
    lines.push(
      `   Progress: ${row.closed_children}/${row.total_children} children closed (${percent}%)`,
    );
  }

  return `${lines.join("\n")}\n`;
}

export function formatCloseEligibleEpicsDryRun(result: {
  dry_run: boolean;
  eligible: EpicStatusShape[];
  count: number;
}): string {
  if (result.count === 0) {
    return "DRY-RUN: no eligible epics found.\n";
  }
  const header = `DRY-RUN: would close ${result.count} eligible epic${result.count === 1 ? "" : "s"}`;
  return `${header}\n${formatIssueEpicStatus(result.eligible)}`;
}

export function formatCloseEligibleEpicsClosed(result: {
  closed: { id: string; identifier: string }[];
  count: number;
}): string {
  if (result.count === 0) {
    return "No eligible epics to close.\n";
  }
  const lines = [
    `Closed ${result.count} epic${result.count === 1 ? "" : "s"}:`,
    "",
  ];
  for (const closed of result.closed) {
    lines.push(`  ✓ ${closed.identifier}`);
  }
  lines.push("");
  return lines.join("\n");
}

export async function runEpicStatus(
  command: Command,
  options: { team?: string; eligibleOnly?: boolean },
): Promise<void> {
  const rootOpts = getRootOpts(command);
  const ctx = createContext(rootOpts);
  const teamKey = options.team ?? getDefaultTeam() ?? undefined;
  const teamId = teamKey ? await resolveTeamId(ctx.sdk, teamKey) : undefined;
  const statuses = await getEpicStatuses(ctx.gql, {
    teamId,
    eligibleOnly: options.eligibleOnly ?? false,
  });
  outputResult(statuses, formatIssueEpicStatus, rootOpts);
}

export async function runCloseEligibleEpics(
  command: Command,
  options: { team?: string; dryRun?: boolean },
): Promise<void> {
  const rootOpts = getRootOpts(command);
  const ctx = createContext(rootOpts);
  const teamKey = options.team ?? getDefaultTeam() ?? undefined;
  const teamId = teamKey ? await resolveTeamId(ctx.sdk, teamKey) : undefined;
  const statuses = await getEpicStatuses(ctx.gql, {
    teamId,
    eligibleOnly: true,
  });

  if (options.dryRun) {
    outputResult(
      { dry_run: true, eligible: statuses, count: statuses.length },
      formatCloseEligibleEpicsDryRun,
      rootOpts,
    );
    return;
  }

  const closed: Array<{ id: string; identifier: string }> = [];
  for (const status of statuses) {
    const completedStateId = await resolveStateIdByType(
      ctx.sdk,
      status.epic.team.id,
      "completed",
    );
    await updateIssue(ctx.gql, status.epic.id, { stateId: completedStateId });
    closed.push({
      id: status.epic.id,
      identifier: status.epic.identifier,
    });
  }
  outputResult(
    { closed, count: closed.length },
    formatCloseEligibleEpicsClosed,
    rootOpts,
  );
}
