import type { Command } from "commander";
import { getDefaultTeam } from "../common/config-store.js";
import {
  type CommandOptions,
  createContext,
  getRootOpts,
} from "../common/context.js";
import {
  invalidParameterError,
  notFoundError,
  requiresParameterError,
} from "../common/errors.js";
import { handleCommand, outputResult, parseLimit } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import { resolveCycleId } from "../resolvers/cycle-resolver.js";
import { resolveTeamId } from "../resolvers/team-resolver.js";
import { type Cycle, getCycle, listCycles } from "../services/cycle-service.js";

/**
 * Format mirrors the structure of `formatProjectList` / `formatProjectDetail`:
 * per-cycle row in list, header + sectioned blocks in detail.
 *
 * State derives from boolean flags (a cycle can only carry one of the four
 * relative-position flags):
 *   isActive   → [active]
 *   isNext     → [upcoming]
 *   isPrevious → [past]
 *   else       → [scheduled]
 *
 * `cyclesFormatYmd` slices the leading 10 chars (YYYY-MM-DD) off an ISO
 * timestamp, or returns `(no date)` when missing.
 */
function cyclesFormatYmd(value: string | null | undefined): string {
  if (!value) return "(no date)";
  return value.slice(0, 10);
}

interface CycleRowShape {
  id: string;
  number: number;
  name?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  isActive?: boolean | null;
  isNext?: boolean | null;
  isPrevious?: boolean | null;
}

function cycleState(c: CycleRowShape): string {
  if (c.isActive) return "[active]";
  if (c.isNext) return "[upcoming]";
  if (c.isPrevious) return "[past]";
  return "[scheduled]";
}

export function formatCycleList(result: { nodes: CycleRowShape[] }): string {
  if (result.nodes.length === 0) {
    return "No cycles found.\n";
  }
  const lines: string[] = [];
  for (const c of result.nodes) {
    const name = c.name ?? `Cycle ${c.number}`;
    const start = cyclesFormatYmd(c.startsAt);
    const end = cyclesFormatYmd(c.endsAt);
    lines.push(`  #${c.number}  ${name}  ${start}–${end}  ${cycleState(c)}`);
  }
  lines.push("");
  lines.push(`Total: ${result.nodes.length} cycles`);
  return `${lines.join("\n")}\n`;
}

interface CycleDetailShape extends CycleRowShape {
  issues?: Array<{
    identifier: string;
    title: string;
    state?: { name?: string | null } | null;
  }> | null;
}

export function formatCycleDetail(c: CycleDetailShape): string {
  const name = c.name ?? `Cycle ${c.number}`;
  const header = `#${c.number}  ${name}   ${cycleState(c)}`;
  const lines: string[] = [header];

  const start = cyclesFormatYmd(c.startsAt);
  const end = cyclesFormatYmd(c.endsAt);
  lines.push(`Dates: ${start}–${end}`);

  const issues = c.issues ?? [];
  if (issues.length > 0) {
    lines.push("");
    lines.push(`ISSUES (${issues.length})`);
    for (const i of issues) {
      const state = i.state?.name ?? "(no state)";
      lines.push(`  · ${i.identifier}  [${state}]  ${i.title}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

interface CycleListOptions extends CommandOptions {
  team?: string;
  active?: boolean;
  window?: string;
  limit: string;
  after?: string;
}

interface CycleReadOptions extends CommandOptions {
  team?: string;
  limit?: string;
}

export const CYCLES_META: DomainMeta = {
  name: "cycles",
  summary: "time-boxed iterations (sprints) per team",
  context: [
    "a cycle is a sprint belonging to one team. each team can have one",
    "active cycle at a time. cycles contain issues and have start/end dates.",
  ].join("\n"),
  arguments: {
    cycle: "cycle identifier (UUID or name)",
  },
  seeAlso: ["issues create --cycle", "issues update --cycle"],
};

export function setupCyclesCommands(program: Command): void {
  const cycles = program.command("cycles").description("Cycle operations");

  cycles.action(() => cycles.help());

  cycles
    .command("list")
    .description("list cycles")
    .option("--team <team>", "filter by team (key, name, or UUID)")
    .option("--active", "only show active cycles")
    .option("--window <n>", "active cycle +/- n neighbors (requires --team)")
    .option("-l, --limit <n>", "max results", "50")
    .option("--after <cursor>", "cursor for next page")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [CycleListOptions, Command];
        const teamKey = options.team ?? getDefaultTeam() ?? undefined;
        if (options.window && !teamKey) {
          throw requiresParameterError("--window", "--team");
        }
        if (options.window && options.after) {
          throw invalidParameterError(
            "--after",
            "cannot be used with --window",
          );
        }

        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);

        const teamId = teamKey
          ? await resolveTeamId(ctx.sdk, teamKey)
          : undefined;

        const result = await listCycles(
          ctx.gql,
          teamId,
          options.active || false,
          { limit: parseLimit(options.limit), after: options.after },
        );

        if (options.window) {
          const n = parseInt(options.window, 10);
          if (Number.isNaN(n) || n < 0) {
            throw invalidParameterError(
              "--window",
              "requires a non-negative integer",
            );
          }

          const activeCycle = result.nodes.find((c: Cycle) => c.isActive);
          if (!activeCycle) {
            throw notFoundError("Active cycle", teamKey ?? "", "for team");
          }

          const activeNumber = activeCycle.number;
          const min = activeNumber - n;
          const max = activeNumber + n;

          const filteredNodes = result.nodes
            .filter((c: Cycle) => c.number >= min && c.number <= max)
            .sort((a: Cycle, b: Cycle) => a.number - b.number);

          outputResult(
            {
              nodes: filteredNodes,
              pageInfo: { hasNextPage: false, endCursor: null },
            },
            formatCycleList,
            rootOpts,
          );
          return;
        }

        outputResult(result, formatCycleList, rootOpts);
      }),
    );

  cycles
    .command("read <cycle>")
    .description("get cycle details including issues")
    .option("--team <team>", "scope name lookup to team")
    .option("--limit <n>", "max issues to fetch", "50")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [cycle, options, command] = args as [
          string,
          CycleReadOptions,
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);

        const teamKey = options.team ?? getDefaultTeam() ?? undefined;
        const cycleId = await resolveCycleId(ctx.sdk, cycle, teamKey);

        const cycleResult = await getCycle(
          ctx.gql,
          cycleId,
          parseLimit(options.limit || "50"),
        );

        outputResult(cycleResult, formatCycleDetail, rootOpts);
      }),
    );

  cycles
    .command("usage")
    .description("show detailed usage for cycles")
    .action(() => {
      console.log(formatDomainUsage(cycles, CYCLES_META));
    });
}
