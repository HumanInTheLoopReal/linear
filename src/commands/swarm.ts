import type { Command } from "commander";
import { createContext, getRootOpts } from "../common/context.js";
import { handleCommand, outputResult } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import { resolveIssueId } from "../resolvers/issue-resolver.js";
import {
  analyzeEpicForSwarm,
  createSwarmMolecule,
  findExistingSwarm,
  getSwarmStatus,
  listSwarmMolecules,
  prepareSwarmEpic,
} from "../services/swarm-service.js";

/**
 * Swarm is a Linear-Hack: a swarm is represented as a Linear issue with
 * the `swarm` label, linked to its epic via a `related` relation. Output
 * shape:
 *
 *   create   → `✓ Created swarm <id> for epic <epic-id>` + analysis line
 *              error variants: existing swarm / not-swarmable lines
 *   validate → swarmable: `✓ Epic <id> is swarmable: N issues, M waves, max parallelism K`
 *              not-swarmable: `✗ Epic <id> is not swarmable` + per-warning/error lines
 *   status   → epic header + Progress line + per-category sections
 *   list     → `📋 Swarms (N):` + per-swarm rows
 */

interface SwarmAnalysisShape {
  epic_id: string;
  epic_identifier: string;
  epic_title: string;
  total_issues: number;
  closed_issues: number;
  max_parallelism: number;
  estimated_sessions: number;
  warnings: string[];
  errors: string[];
  swarmable: boolean;
  ready_fronts: { wave: number; issues: string[] }[];
}

interface SwarmCreateSuccessShape {
  swarm_id: string;
  swarm_identifier: string;
  epic_id: string;
  epic_identifier: string;
  coordinator: string;
  analysis: SwarmAnalysisShape;
}

interface SwarmCreateExistingShape {
  error: "swarm already exists";
  existing_id: string;
  existing_identifier: string;
  existing_title: string;
}

interface SwarmCreateUnswarmableShape {
  error: "epic is not swarmable";
  analysis: SwarmAnalysisShape;
}

type SwarmCreateResult =
  | SwarmCreateSuccessShape
  | SwarmCreateExistingShape
  | SwarmCreateUnswarmableShape;

export function formatSwarmCreate(result: SwarmCreateResult): string {
  if ("error" in result && result.error === "swarm already exists") {
    return `✗ Swarm already exists: ${result.existing_identifier} (${result.existing_title})\n  use --force to create another\n`;
  }
  if ("error" in result && result.error === "epic is not swarmable") {
    const lines: string[] = [
      `✗ Epic ${result.analysis.epic_identifier} is not swarmable`,
    ];
    for (const e of result.analysis.errors) lines.push(`  ⚠ ${e}`);
    for (const w of result.analysis.warnings) lines.push(`  · ${w}`);
    return `${lines.join("\n")}\n`;
  }
  const ok = result;
  const a = ok.analysis;
  const lines: string[] = [
    `✓ Created swarm ${ok.swarm_identifier} for epic ${ok.epic_identifier}`,
    `  ${a.total_issues} issues · ${a.ready_fronts.length} waves · max parallelism ${a.max_parallelism}`,
  ];
  if (ok.coordinator) lines.push(`  coordinator: ${ok.coordinator}`);
  return `${lines.join("\n")}\n`;
}

export function formatSwarmValidate(analysis: SwarmAnalysisShape): string {
  if (!analysis.swarmable) {
    const lines: string[] = [
      `✗ Epic ${analysis.epic_identifier} is not swarmable`,
    ];
    for (const e of analysis.errors) lines.push(`  ⚠ ${e}`);
    for (const w of analysis.warnings) lines.push(`  · ${w}`);
    return `${lines.join("\n")}\n`;
  }
  const lines: string[] = [
    `✓ Epic ${analysis.epic_identifier} is swarmable: ${analysis.total_issues} issues, ${analysis.ready_fronts.length} waves, max parallelism ${analysis.max_parallelism}`,
  ];
  for (const w of analysis.warnings) lines.push(`  · ${w}`);
  return `${lines.join("\n")}\n`;
}

interface SwarmStatusIssueShape {
  identifier: string;
  title: string;
  assignee_name?: string;
  blocked_by?: string[];
}

interface SwarmStatusShape {
  epic_identifier: string;
  epic_title: string;
  total_issues: number;
  completed: SwarmStatusIssueShape[];
  active: SwarmStatusIssueShape[];
  ready: SwarmStatusIssueShape[];
  blocked: SwarmStatusIssueShape[];
  active_count: number;
  ready_count: number;
  blocked_count: number;
  progress_percent: number;
}

function statusSection(
  header: string,
  rows: SwarmStatusIssueShape[],
  decorate?: (r: SwarmStatusIssueShape) => string,
): string[] {
  if (rows.length === 0) return [];
  const out: string[] = ["", `${header} (${rows.length}):`];
  for (const r of rows) {
    const extra = decorate ? decorate(r) : "";
    const who = r.assignee_name ? ` @${r.assignee_name}` : "";
    out.push(`  ${r.identifier}  ${r.title}${who}${extra}`);
  }
  return out;
}

export function formatSwarmStatus(status: SwarmStatusShape): string {
  const lines: string[] = [
    `Swarm status: ${status.epic_identifier}  ${status.epic_title}`,
    `Progress: ${status.completed.length}/${status.total_issues} closed (${status.progress_percent}%) · ${status.active_count} active · ${status.ready_count} ready · ${status.blocked_count} blocked`,
  ];
  lines.push(...statusSection("✓ Completed", status.completed));
  lines.push(...statusSection("◐ Active", status.active));
  lines.push(...statusSection("○ Ready", status.ready));
  lines.push(
    ...statusSection("● Blocked", status.blocked, (r) =>
      r.blocked_by && r.blocked_by.length > 0
        ? `  ← [${r.blocked_by.join(", ")}]`
        : "",
    ),
  );
  return `${lines.join("\n")}\n`;
}

interface SwarmListItemShape {
  swarm_identifier: string;
  swarm_title: string;
  epic_identifier: string | null;
  epic_title: string | null;
  coordinator: string;
  total_issues: number;
  closed_issues: number;
  wave_depth: number;
  max_parallelism: number;
  swarmable: boolean;
  analysis_error?: string;
}

export function formatSwarmList(result: {
  swarms: SwarmListItemShape[];
  count: number;
}): string {
  if (result.count === 0) return "\n📋 No swarms found.\n\n";
  const lines: string[] = ["", `📋 Swarms (${result.count}):`];
  for (const s of result.swarms) {
    const epic = s.epic_identifier
      ? `${s.epic_identifier} (${s.epic_title ?? ""})`
      : "(no linked epic)";
    const swarmable = s.swarmable ? "✓" : "✗";
    lines.push(`  ${s.swarm_identifier}  → ${epic}`);
    if (s.analysis_error) {
      lines.push(`    ⚠ ${s.analysis_error}`);
    } else {
      lines.push(
        `    ${swarmable} ${s.closed_issues}/${s.total_issues} closed · ${s.wave_depth} waves · max parallelism ${s.max_parallelism}${s.coordinator ? ` · coordinator: ${s.coordinator}` : ""}`,
      );
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export const SWARM_META: DomainMeta = {
  name: "swarm",
  summary: "coordinate parallel agent work across an epic's children",
  context: [
    "swarm is a Linear-Hack: a swarm has no native Linear equivalent, so",
    "it is represented as a Linear issue with the `swarm` label and a",
    "structured description block pointing at the epic. the swarm issue",
    "is linked to the epic via a `related` issueRelation.",
    "",
    "use `create` to instantiate a swarm molecule for an epic (auto-wrapping",
    "a single non-epic issue when needed), `validate` to dry-run the",
    "underlying analysis without mutating anything, and `list` to enumerate",
    "every swarm molecule in the workspace with high-level analysis",
    "(total/closed children, wave depth, max parallelism). create/validate",
    "share the same Kahn's-algorithm wave computation over the epic's",
    "children + their in-epic `blocks` relations.",
  ].join("\n"),
  arguments: {
    epic: "epic identifier or UUID; for `create`, a non-epic auto-wraps",
  },
  seeAlso: [
    "depends graph",
    "issues epic-status",
    "issues close-eligible-epics",
  ],
};

export function setupSwarmCommands(program: Command): void {
  const swarm = program
    .command("swarm")
    .description("coordinate parallel agent work across an epic's children");

  swarm.action(() => swarm.help());

  swarm
    .command("create <epic>")
    .description(
      "create a swarm molecule for an epic (auto-wraps a single issue into a wrapper epic)",
    )
    .option(
      "--coordinator <addr>",
      "coordinator agent address; stored verbatim in the molecule's description",
      "",
    )
    .option(
      "--force",
      "create a new swarm even if one already exists for the epic",
      false,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [input, options, command] = args as [
          string,
          { coordinator: string; force: boolean },
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const inputId = await resolveIssueId(ctx.sdk, input);
        const epic = await prepareSwarmEpic(ctx.gql, inputId, input);

        const existing = await findExistingSwarm(ctx.gql, epic.id);
        if (existing && !options.force) {
          outputResult(
            {
              error: "swarm already exists" as const,
              existing_id: existing.id,
              existing_identifier: existing.identifier,
              existing_title: existing.title,
            },
            formatSwarmCreate,
            rootOpts,
          );
          process.exit(1);
          return;
        }

        const analysis = await analyzeEpicForSwarm(ctx.gql, epic.id);
        if (!analysis.swarmable) {
          outputResult(
            { error: "epic is not swarmable" as const, analysis },
            formatSwarmCreate,
            rootOpts,
          );
          process.exit(1);
          return;
        }

        const molecule = await createSwarmMolecule(ctx.gql, {
          epic,
          coordinator: options.coordinator,
        });

        outputResult(
          {
            swarm_id: molecule.id,
            swarm_identifier: molecule.identifier,
            epic_id: epic.id,
            epic_identifier: epic.identifier,
            coordinator: options.coordinator,
            analysis,
          },
          formatSwarmCreate,
          rootOpts,
        );
      }),
    );

  swarm
    .command("validate <epic>")
    .description(
      "validate an epic's structure for swarming without creating a molecule",
    )
    .option(
      "--verbose",
      "include the detailed per-issue graph (`issues` map) in JSON output",
      false,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [input, options, command] = args as [
          string,
          { verbose: boolean },
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const epicId = await resolveIssueId(ctx.sdk, input);
        const analysis = await analyzeEpicForSwarm(ctx.gql, epicId);
        if (!options.verbose) {
          analysis.issues = undefined;
        }
        outputResult(analysis, formatSwarmValidate, rootOpts);
        if (!analysis.swarmable) process.exit(1);
      }),
    );

  swarm
    .command("status <epic-or-swarm>")
    .description(
      "show current swarm status (completed/active/ready/blocked + progress)",
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [input, , command] = args as [string, unknown, Command];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const targetId = await resolveIssueId(ctx.sdk, input);
        const status = await getSwarmStatus(ctx.gql, targetId);
        outputResult(status, formatSwarmStatus, rootOpts);
      }),
    );

  swarm
    .command("list")
    .description(
      "list every swarm molecule with high-level analysis (total/closed/wave depth)",
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [, command] = args as [unknown, Command];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const result = await listSwarmMolecules(ctx.gql);
        outputResult(result, formatSwarmList, rootOpts);
      }),
    );

  swarm
    .command("usage")
    .description("show detailed usage for swarm")
    .action(() => {
      console.log(formatDomainUsage(swarm, SWARM_META));
    });
}
