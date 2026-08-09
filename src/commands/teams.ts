import type { Command } from "commander";
import { createContext, getRootOpts } from "../common/context.js";
import { handleCommand, outputResult, parseLimit } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import { resolveTeamId } from "../resolvers/team-resolver.js";
import { getTeam, listTeams, renameTeamKey } from "../services/team-service.js";

/**
 * Format consistent with `formatLabelList` / `formatProjectList` for the
 * list view, and `formatProjectDetail` for the detail view.
 *
 *   list   → `  <key-padded>  <name>` rows + `Total: N teams`
 *   read   → header + Issues/Estimation/Cycles info + DESCRIPTION + PARENT
 *   rename → action echo with linear-can't-rewrite-history warning
 */

interface TeamListRowShape {
  id: string;
  key: string;
  name: string;
}

export function formatTeamList(result: { nodes: TeamListRowShape[] }): string {
  if (result.nodes.length === 0) {
    return "No teams found.\n";
  }
  const keyWidth = Math.max(...result.nodes.map((t) => t.key.length));
  const lines: string[] = [];
  for (const t of result.nodes) {
    lines.push(`  ${t.key.padEnd(keyWidth)}  ${t.name}`);
  }
  lines.push("");
  lines.push(`Total: ${result.nodes.length} teams`);
  return `${lines.join("\n")}\n`;
}

interface TeamDetailShape {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  private?: boolean | null;
  timezone?: string | null;
  issueCount?: number | null;
  cyclesEnabled?: boolean | null;
  cycleDuration?: number | null;
  cycleStartDay?: number | null;
  triageEnabled?: boolean | null;
  issueEstimationType?: string | null;
  parent?: { key: string; name: string } | null;
}

export function formatTeamDetail(team: TeamDetailShape): string {
  const lines: string[] = [];
  const accessIcon = team.private ? " [private]" : "";
  lines.push(`${team.key}  ${team.name}${accessIcon}`);

  const infoBits: string[] = [];
  if (typeof team.issueCount === "number") {
    infoBits.push(`Issues: ${team.issueCount}`);
  }
  if (team.timezone) infoBits.push(`Timezone: ${team.timezone}`);
  if (team.issueEstimationType) {
    infoBits.push(`Estimation: ${team.issueEstimationType}`);
  }
  if (infoBits.length > 0) {
    lines.push(infoBits.join(" · "));
  }

  if (team.cyclesEnabled) {
    const duration = team.cycleDuration ?? "?";
    lines.push(`Cycles: enabled (${duration} weeks)`);
  } else {
    lines.push("Cycles: disabled");
  }

  if (team.triageEnabled) lines.push("Triage: enabled");

  if (team.parent) {
    lines.push(`Parent: ${team.parent.key} (${team.parent.name})`);
  }

  const desc = (team.description ?? "").trim();
  if (desc) {
    lines.push("");
    lines.push("DESCRIPTION");
    lines.push(desc);
  }

  return `${lines.join("\n")}\n`;
}

interface TeamRenameResultShape {
  team_id: string;
  old_key: string;
  new_key: string;
  changed: boolean;
  dry_run: boolean;
  warning?: string | null;
}

export function formatTeamRenamePrefix(result: TeamRenameResultShape): string {
  const lines: string[] = [];
  // No-op short-circuits both dry-run and real-run: the service already
  // bailed before calling the API, so "(no change)" is the truthful line.
  if (!result.changed) {
    lines.push(`· Team prefix already ${result.new_key} (no change)`);
  } else if (result.dry_run) {
    lines.push(
      `→ [dry-run] Would rename team prefix: ${result.old_key} → ${result.new_key}`,
    );
  } else {
    lines.push(`✏ Renamed team prefix: ${result.old_key} → ${result.new_key}`);
  }
  if (result.warning) {
    lines.push(`  ⚠ ${result.warning}`);
  }
  return `${lines.join("\n")}\n`;
}

export const TEAMS_META: DomainMeta = {
  name: "teams",
  summary: "organizational units owning issues and cycles",
  context: [
    "a team is a group of users that owns issues, cycles, statuses, and",
    "labels. teams are identified by a short key (e.g. ENG), name, or UUID.",
  ].join("\n"),
  arguments: {},
  seeAlso: [],
};

export function setupTeamsCommands(program: Command): void {
  const teams = program.command("teams").description("Team operations");

  teams.action(() => teams.help());

  teams
    .command("list")
    .description("list all teams")
    .option("-l, --limit <n>", "max results", "50")
    .option("--after <cursor>", "cursor for next page")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [
          { limit: string; after?: string },
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const result = await listTeams(ctx.gql, {
          limit: parseLimit(options.limit),
          after: options.after,
        });
        outputResult(result, formatTeamList, rootOpts);
      }),
    );

  teams
    .command("read <team>")
    .description("get team details")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const team = args[0] as string;
        const command = args.at(-1) as Command;
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const teamId = await resolveTeamId(ctx.sdk, team);
        const result = await getTeam(ctx.gql, { id: teamId });
        outputResult(result, formatTeamDetail, rootOpts);
      }),
    );

  teams
    .command("rename-prefix <team> <new-key>")
    .description(
      "rename a team's short key (issue prefix). NOTE: Linear issue identifiers are immutable post-creation; this affects only future issues. Linear cannot rewrite historical IDs or text refs.",
    )
    .option(
      "--dry-run",
      "validate the new key format without calling the API",
      false,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [team, newKey, options, command] = args as [
          string,
          string,
          { dryRun: boolean },
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const teamId = await resolveTeamId(ctx.sdk, team);
        const detail = await getTeam(ctx.gql, { id: teamId });
        const result = await renameTeamKey(ctx.gql, {
          teamId,
          currentKey: detail.key,
          newKey,
          dryRun: options.dryRun,
        });
        outputResult(result, formatTeamRenamePrefix, rootOpts);
      }),
    );

  teams
    .command("usage")
    .description("show detailed usage for teams")
    .action(() => {
      console.log(formatDomainUsage(teams, TEAMS_META));
    });
}
