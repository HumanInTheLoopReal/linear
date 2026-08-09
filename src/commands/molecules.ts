import path from "node:path";
import type { Command } from "commander";
import { getDefaultTeam } from "../common/config-store.js";
import { createContext, getRootOpts } from "../common/context.js";
import { invalidParameterError } from "../common/errors.js";
import { isClosedStateType } from "../common/issue-lifecycle.js";
import { handleCommand, outputResult } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import { type IssueCreateInput, IssueRelationType } from "../gql/graphql.js";
import { resolveIssueId } from "../resolvers/issue-resolver.js";
import { resolveTeamId } from "../resolvers/team-resolver.js";
import { resolveUserId } from "../resolvers/user-resolver.js";
import { validateToken } from "../services/auth-service.js";
import {
  createIssueRelation,
  listIssueRelations,
} from "../services/issue-relation-service.js";
import {
  createIssue,
  getIssue,
  listIssues,
} from "../services/issue-service.js";
import { ensureWorkspaceLabel } from "../services/label-service.js";
import {
  defaultSearchPaths,
  formatVariablesBlock,
  getProto,
  listProtos,
  type MoleculeIssueSpec,
  type MoleculeProto,
  parseVariablesBlock,
  substituteVariables,
  topologicalSort,
} from "../services/molecules-service.js";

/**
 * `linear molecules ...` — work-template (formula/molecule) system.
 * Provides `list`, `show`, and `pour` subcommands over reusable issue DAGs.
 */

export const MOLECULES_META: DomainMeta = {
  name: "molecules",
  summary: "work-template system: list/show/pour reusable issue DAGs",
  context: [
    "Molecules are reusable issue templates — a DAG of issues parameterized",
    "by `{{var}}` placeholders that get substituted at pour time. Always the",
    "full word `molecules`, never `mol` — by deliberate convention.",
    "",
    "Search paths (highest precedence first):",
    "  1. <cwd>/.linear/molecules/       — project-local overrides",
    "  2. ~/.linear/molecules/           — user-global protos",
    "  3. <dist>/molecules/builtin/      — starters shipped with linear",
    "",
    "Same-name protos in higher-precedence paths shadow lower ones, so a",
    "project can tweak a bundled formula without forking the package.",
  ].join("\n"),
  arguments: {},
  seeAlso: ["issues create", "depends graph"],
};

export interface ProtoSummary {
  name: string;
  description: string | null;
  /** Symbolic source bucket: "project" | "user" | "builtin" | "other". */
  source: "project" | "user" | "builtin" | "other";
  /** Absolute path of the .toml file on disk. */
  path: string;
  variables: { name: string; description: string | null }[];
  issue_count: number;
}

export interface MoleculesListResult {
  count: number;
  protos: ProtoSummary[];
}

/**
 * Map an absolute proto path back to its symbolic search-path bucket.
 * Falls back to `"other"` for explicit caller-supplied paths that don't
 * line up with any default.
 */
export function classifySource(
  protoPath: string,
  searchPaths: readonly string[],
): ProtoSummary["source"] {
  // searchPaths is in precedence order: [project, user, builtin].
  if (searchPaths[0] && protoPath.startsWith(`${searchPaths[0]}${path.sep}`)) {
    return "project";
  }
  if (searchPaths[1] && protoPath.startsWith(`${searchPaths[1]}${path.sep}`)) {
    return "user";
  }
  if (searchPaths[2] && protoPath.startsWith(`${searchPaths[2]}${path.sep}`)) {
    return "builtin";
  }
  return "other";
}

function toSummary(
  proto: MoleculeProto,
  searchPaths: readonly string[],
): ProtoSummary {
  return {
    name: proto.name,
    description: proto.description ?? null,
    source: classifySource(proto.source, searchPaths),
    path: proto.source,
    variables: proto.variables.map((v) => ({
      name: v.name,
      description: v.description ?? null,
    })),
    issue_count: proto.issues.length,
  };
}

const SOURCE_LABELS: Record<ProtoSummary["source"], string> = {
  project: ".linear/molecules/ (project)",
  user: "~/.linear/molecules/ (user)",
  builtin: "builtin/",
  other: "other/",
};

export function formatMoleculesList(result: MoleculesListResult): string {
  if (result.count === 0) {
    return [
      "🧪 No molecules found.",
      "",
      "Drop a TOML under `.linear/molecules/` or `~/.linear/molecules/`,",
      "or check the bundled starters didn't get stripped from the install.",
      "",
    ].join("\n");
  }

  const sourceCount = new Set(result.protos.map((p) => p.source)).size;

  const grouped = new Map<ProtoSummary["source"], ProtoSummary[]>();
  for (const p of result.protos) {
    const bucket = grouped.get(p.source) ?? [];
    bucket.push(p);
    grouped.set(p.source, bucket);
  }

  const order: ProtoSummary["source"][] = [
    "project",
    "user",
    "builtin",
    "other",
  ];
  const nameColWidth = Math.max(12, ...result.protos.map((p) => p.name.length));

  const lines: string[] = [
    `🧪 Molecules (${result.count} from ${sourceCount} search path${sourceCount === 1 ? "" : "s"}):`,
    "",
  ];
  for (const source of order) {
    const bucket = grouped.get(source);
    if (!bucket || bucket.length === 0) continue;
    lines.push(`  ${SOURCE_LABELS[source]}`);
    for (const p of bucket) {
      const padded = p.name.padEnd(nameColWidth);
      const desc = p.description ?? "(no description)";
      lines.push(`    • ${padded}  ${desc}`);
    }
    lines.push("");
  }
  lines.push(
    "Use `linear molecules show <name>` for details, `linear molecules pour <name>` to spawn.",
  );
  return `${lines.join("\n")}\n`;
}

export interface MoleculeIssueDetail {
  key: string;
  title: string;
  type: string | null;
  priority: number | null;
  description: string | null;
  depends_on: string[];
}

export interface MoleculeShowResult {
  name: string;
  description: string | null;
  source: ProtoSummary["source"];
  path: string;
  variables: {
    name: string;
    description: string | null;
    default: string | null;
  }[];
  issues: MoleculeIssueDetail[];
}

function toShowResult(
  proto: MoleculeProto,
  searchPaths: readonly string[],
): MoleculeShowResult {
  const sorted = topologicalSort(proto.issues);
  return {
    name: proto.name,
    description: proto.description ?? null,
    source: classifySource(proto.source, searchPaths),
    path: proto.source,
    variables: proto.variables.map((v) => ({
      name: v.name,
      description: v.description ?? null,
      default: v.default ?? null,
    })),
    issues: sorted.map((i) => ({
      key: i.key,
      title: i.title,
      type: i.type ?? null,
      priority: i.priority ?? null,
      description: i.description ?? null,
      depends_on: i.depends_on ?? [],
    })),
  };
}

export function formatMoleculesShow(result: MoleculeShowResult): string {
  const lines: string[] = [
    `🧪 ${result.name}`,
    `   ${result.description ?? "(no description)"}`,
    "",
    `Source: ${result.source}`,
    `Path: ${result.path}`,
    "",
  ];

  if (result.variables.length === 0) {
    lines.push("Variables: (none)");
  } else {
    lines.push(`Variables (${result.variables.length}):`);
    const nameWidth = Math.max(
      6,
      ...result.variables.map((v) => v.name.length),
    );
    const descWidth = Math.max(
      20,
      ...result.variables.map((v) => (v.description ?? "").length),
    );
    for (const v of result.variables) {
      const trailing = v.default ? `(default: ${v.default})` : "(required)";
      lines.push(
        `  • ${v.name.padEnd(nameWidth)}  ${(v.description ?? "").padEnd(descWidth)}  ${trailing}`,
      );
    }
  }
  lines.push("");

  if (result.issues.length === 0) {
    lines.push("Issues: (none)");
  } else {
    lines.push(`Issues (${result.issues.length}):`);
    const keyWidth = Math.max(6, ...result.issues.map((i) => i.key.length));
    for (const i of result.issues) {
      const type = i.type ? `[${i.type}]` : "[task]";
      const dep =
        i.depends_on.length > 0
          ? `   ← depends on: ${i.depends_on.join(", ")}`
          : "";
      lines.push(
        `  ○ ${i.key.padEnd(keyWidth)}  ${type.padEnd(10)} ${i.title}${dep}`,
      );
    }
  }

  const requiredVars = result.variables
    .filter((v) => !v.default)
    .map((v) => v.name);
  const example =
    requiredVars.length > 0
      ? `linear molecules pour ${result.name} ${requiredVars.map((n) => `--var ${n}=<value>`).join(" ")}`
      : `linear molecules pour ${result.name}`;
  lines.push("", `Pour: ${example}`);

  return `${lines.join("\n")}\n`;
}

/**
 * Parse a single `--var k=v` token. The value side may itself contain `=`
 * (e.g. `--var url=https://x.example/?a=1`), so we split on the FIRST `=`
 * only. Empty keys / unset values throw.
 */
export function parseVarToken(token: string): { key: string; value: string } {
  const eq = token.indexOf("=");
  if (eq < 1) {
    throw invalidParameterError(
      "--var",
      `expected k=v, got "${token}" (use --var key=value, repeatable)`,
    );
  }
  const key = token.slice(0, eq).trim();
  const value = token.slice(eq + 1);
  if (!key) {
    throw invalidParameterError(
      "--var",
      `empty key in "${token}" (use --var key=value)`,
    );
  }
  return { key, value };
}

/**
 * Apply variable substitution to every field of an issue spec where
 * `{{var}}` is meaningful (title + description). Returns a new spec;
 * does not mutate.
 */
export function substituteIssueFields(
  issue: MoleculeIssueSpec,
  vars: Readonly<Record<string, string>>,
): MoleculeIssueSpec {
  return {
    ...issue,
    title: substituteVariables(issue.title, vars),
    description:
      issue.description !== undefined
        ? substituteVariables(issue.description, vars)
        : undefined,
  };
}

export interface MoleculePourPlanIssue {
  key: string;
  title: string;
  description: string | null;
  type: string | null;
  priority: number | null;
  depends_on: string[];
}

export interface MoleculePourEpicRef {
  id: string;
  identifier: string;
  title: string;
}

export interface MoleculePourIssueRef {
  key: string;
  id: string;
  identifier: string;
  title: string;
}

export interface MoleculePourDependency {
  /** Dependent issue key (`from` blocks-on `to`). */
  from: string;
  /** Blocker issue key. */
  to: string;
}

/**
 * Common envelope for both real and dry-run pours. `dry_run: true` flips
 * `epic.id` / `issues[].id` / `issues[].identifier` to placeholder strings
 * (`(dry-run)`) so consumers can still inspect the plan.
 */
export interface MoleculePourResult {
  dry_run: boolean;
  proto: string;
  vars: Record<string, string>;
  team_key: string | null;
  /**
   * The `--assignee` value the caller passed (echoed verbatim), or `null`
   * when unset. Only the root epic is assigned — children keep their proto
   * assignee (root-only).
   */
  assignee: string | null;
  epic: MoleculePourEpicRef;
  issues: MoleculePourIssueRef[];
  dependencies: MoleculePourDependency[];
}

const PLACEHOLDER = "(dry-run)";

function formatVarsBlock(vars: Record<string, string>): string {
  const entries = Object.entries(vars);
  if (entries.length === 0) return "";
  const nameWidth = Math.max(...entries.map(([k]) => k.length));
  const lines = ["Variables:"];
  for (const [k, v] of entries) {
    lines.push(`  ${k.padEnd(nameWidth)} = ${v}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function formatMoleculesPour(result: MoleculePourResult): string {
  const prefix = result.dry_run ? "(dry-run) " : "";
  const lines: string[] = [
    `🧪 ${result.dry_run ? "Would pour" : "Pouring"} ${result.proto}…`,
    "",
  ];
  const varsBlock = formatVarsBlock(result.vars);
  if (varsBlock) lines.push(varsBlock.trimEnd(), "");

  const assigneeTail = result.assignee ? ` (assignee: ${result.assignee})` : "";
  lines.push(
    `✓ ${prefix}Created epic ${result.epic.identifier}: ${result.epic.title}${assigneeTail}`,
  );

  const keyWidth = Math.max(6, ...result.issues.map((i) => i.key.length));
  const idWidth = Math.max(3, ...result.issues.map((i) => i.identifier.length));

  // Index deps so we can show "← depends on: X, Y" inline per child.
  // In dry-run mode identifiers are placeholders, so fall back to the key
  // so the line stays informative.
  const depsByFrom = new Map<string, string[]>();
  for (const d of result.dependencies) {
    const list = depsByFrom.get(d.from) ?? [];
    const blockerIssue = result.issues.find((i) => i.key === d.to);
    const label =
      result.dry_run || !blockerIssue ? d.to : blockerIssue.identifier;
    list.push(label);
    depsByFrom.set(d.from, list);
  }

  for (const i of result.issues) {
    const deps = depsByFrom.get(i.key);
    const depTail =
      deps && deps.length > 0 ? `   ← depends on ${deps.join(", ")}` : "";
    lines.push(
      `✓ ${prefix}Created ${i.identifier.padEnd(idWidth)} (${i.key.padEnd(keyWidth)}): ${i.title}${depTail}`,
    );
  }

  lines.push(
    "",
    `Molecule ${result.dry_run ? "would be" : ""} poured: ${result.issues.length} issues + 1 epic, ${result.dependencies.length} dependencies${result.dry_run ? " would be" : ""} wired.`.replace(
      /\s+/g,
      " ",
    ),
  );

  if (!result.dry_run) {
    lines.push(
      `Track progress: linear molecules progress ${result.epic.identifier}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

/**
 * Build the substitution map for a pour. Validates every non-defaulted
 * proto variable was supplied via `--var`; injects `{{LINEAR_USER}}`
 * default expansion from the viewer query when needed.
 */
async function buildVarMap(
  proto: MoleculeProto,
  cliVars: Record<string, string>,
  viewerName: string | null,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const v of proto.variables) {
    if (v.name in cliVars) {
      out[v.name] = cliVars[v.name];
      continue;
    }
    if (v.default !== undefined) {
      // Resolve the magic `{{LINEAR_USER}}` default token.
      out[v.name] =
        v.default === "{{LINEAR_USER}}" && viewerName ? viewerName : v.default;
      continue;
    }
    missing.push(v.name);
  }
  // Allow callers to pass extra vars the proto didn't declare — TOML
  // descriptions/titles can reference adhoc placeholders.
  for (const [k, v] of Object.entries(cliVars)) {
    if (!(k in out)) out[k] = v;
  }
  if (missing.length > 0) {
    throw invalidParameterError(
      "--var",
      `missing required variable${missing.length === 1 ? "" : "s"}: ${missing.join(", ")} (proto "${proto.name}")`,
    );
  }
  return out;
}

export interface PourExecOpts {
  proto: MoleculeProto;
  cliVars: Record<string, string>;
  teamKey?: string;
  dryRun: boolean;
}

const MOLECULE_LABEL_PREFIX = "linear:molecule:";
const TEMPLATE_INSTANCE_LABEL = "linear:template-instance";

export interface MoleculeCurrentEntry {
  proto: string;
  epic: {
    id: string;
    identifier: string;
    title: string;
    state: string;
    state_type: string;
  };
  children_total: number;
  children_closed: number;
  percent_complete: number;
  poured_at: string;
  variables: Record<string, string>;
}

export interface MoleculesCurrentResult {
  count: number;
  molecules: MoleculeCurrentEntry[];
}

/** Shape of an issue node from `listIssues` that `current` consumes. */
interface IssueForCurrent {
  id: string;
  identifier: string;
  title: string;
  createdAt: string;
  description?: string | null;
  state?: { name: string; type: string } | null;
  labels?: { nodes: ReadonlyArray<{ name: string }> } | null;
  children?: {
    nodes: ReadonlyArray<{ state?: { type: string } | null }>;
  } | null;
}

/**
 * Project a raw Linear issue (as returned by `listIssues`) into the
 * `current` entry shape. Drops issues that don't carry a
 * `linear:molecule:<name>` label — those aren't template instances
 * (the `template-instance` label alone is not enough).
 */
export function toCurrentEntry(
  issue: IssueForCurrent,
): MoleculeCurrentEntry | null {
  const labels = issue.labels?.nodes ?? [];
  const proto = labels
    .map((l) => l.name)
    .find((n) => n.startsWith(MOLECULE_LABEL_PREFIX))
    ?.slice(MOLECULE_LABEL_PREFIX.length);
  if (!proto) return null;

  const children = issue.children?.nodes ?? [];
  const closed = children.filter((c) =>
    isClosedStateType(c.state?.type ?? ""),
  ).length;
  const percent =
    children.length === 0 ? 0 : Math.round((closed / children.length) * 100);

  return {
    proto,
    epic: {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      state: issue.state?.name ?? "",
      state_type: issue.state?.type ?? "",
    },
    children_total: children.length,
    children_closed: closed,
    percent_complete: percent,
    poured_at: issue.createdAt,
    variables: parseVariablesBlock(issue.description),
  };
}

function stateIcon(stateType: string): string {
  switch (stateType) {
    case "completed":
      return "✓";
    case "canceled":
      return "✓";
    case "started":
      return "◐";
    case "backlog":
    case "triage":
    case "unstarted":
      return "○";
    default:
      return "○";
  }
}

export interface MoleculeProgressChild {
  id: string;
  identifier: string;
  title: string;
  state: string;
  state_type: string;
  blocked_by: string[];
  blocking: string[];
}

export interface MoleculeProgressResult {
  epic: {
    id: string;
    identifier: string;
    title: string;
    state: string;
    state_type: string;
  };
  proto: string;
  percent_complete: number;
  poured_at: string;
  variables: Record<string, string>;
  children: MoleculeProgressChild[];
  counts: {
    closed: number;
    in_progress: number;
    open: number;
    blocked: number;
  };
}

function bucketCount(children: ReadonlyArray<MoleculeProgressChild>): {
  closed: number;
  in_progress: number;
  open: number;
  blocked: number;
} {
  let closed = 0;
  let in_progress = 0;
  let open = 0;
  let blocked = 0;
  for (const c of children) {
    if (isClosedStateType(c.state_type)) {
      closed++;
    } else if (c.state_type === "started") {
      in_progress++;
    } else {
      open++;
    }
    // "Blocked" overlay: any non-closed child with an open blocker
    // counts as blocked regardless of its own state.
    if (!isClosedStateType(c.state_type) && c.blocked_by.length > 0) {
      blocked++;
    }
  }
  return { closed, in_progress, open, blocked };
}

export function formatMoleculesProgress(
  result: MoleculeProgressResult,
): string {
  const lines: string[] = [
    `🧪 ${result.epic.identifier}  ${result.epic.title}`,
    `   Proto: ${result.proto}  ·  ${result.percent_complete}% complete  ·  Poured: ${result.poured_at.slice(0, 10)}`,
    "",
  ];

  const varEntries = Object.entries(result.variables);
  if (varEntries.length > 0) {
    lines.push("Variables:");
    const nameWidth = Math.max(...varEntries.map(([k]) => k.length));
    for (const [k, v] of varEntries) {
      lines.push(`  ${k.padEnd(nameWidth)} = ${v}`);
    }
    lines.push("");
  }

  if (result.children.length === 0) {
    lines.push("Molecule has no children.");
    return `${lines.join("\n")}\n`;
  }

  lines.push(`Children (${result.children.length}):`);
  const idWidth = Math.max(...result.children.map((c) => c.identifier.length));
  const titleWidth = Math.max(...result.children.map((c) => c.title.length));
  for (const c of result.children) {
    const icon = stateIcon(c.state_type);
    let tail = "";
    if (c.blocking.length > 0) {
      tail = `  ← currently blocking ${c.blocking.join(", ")}`;
    } else if (c.blocked_by.length > 0) {
      tail = `  ← blocked by ${c.blocked_by.join(", ")}`;
    }
    lines.push(
      `  ${icon} ${c.identifier.padEnd(idWidth)}  ${c.title.padEnd(titleWidth)}  ${c.state}${tail}`,
    );
  }
  lines.push("");
  lines.push(
    `${result.counts.closed} closed · ${result.counts.in_progress} in progress · ${result.counts.open} open${result.counts.blocked > 0 ? ` · ${result.counts.blocked} blocked` : ""}`,
  );

  return `${lines.join("\n")}\n`;
}

export function formatMoleculesCurrent(result: MoleculesCurrentResult): string {
  if (result.count === 0) {
    return "🧪 No molecules currently poured. Use `linear molecules pour <name>` to spawn one.\n";
  }

  const lines: string[] = [`🧪 Current molecules (${result.count}):`, ""];

  const byProto = new Map<string, MoleculeCurrentEntry[]>();
  for (const m of result.molecules) {
    const bucket = byProto.get(m.proto) ?? [];
    bucket.push(m);
    byProto.set(m.proto, bucket);
  }

  for (const [proto, entries] of byProto) {
    lines.push(`${proto} (${entries.length})`);
    const idWidth = Math.max(...entries.map((e) => e.epic.identifier.length));
    for (const e of entries) {
      const icon = stateIcon(e.epic.state_type);
      const id = e.epic.identifier.padEnd(idWidth);
      const progress =
        e.children_total > 0
          ? `${e.percent_complete}% (${e.children_closed}/${e.children_total} children closed)`
          : "(no children)";
      lines.push(`  ${icon} ${id}  ${e.epic.title}    ${progress}`);

      const pouredDate = e.poured_at.slice(0, 10);
      const varStr = Object.entries(e.variables)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      const tail = varStr
        ? `Poured: ${pouredDate}  ·  Variables: ${varStr}`
        : `Poured: ${pouredDate}`;
      lines.push(`            ${tail}`);
    }
    lines.push("");
  }

  lines.push(
    "Use `linear molecules progress <epic-id>` for per-issue breakdown.",
  );
  return `${lines.join("\n")}\n`;
}

export function setupMoleculesCommands(program: Command): void {
  const molecules = program
    .command("molecules")
    .description("work-template system: list/show/pour reusable issue DAGs");

  molecules
    .command("list")
    .description(
      "list available molecule templates from project, user, and bundled paths",
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [, command] = args as [unknown, Command];
        const rootOpts = getRootOpts(command);
        const paths = defaultSearchPaths();
        const protos = listProtos(paths);
        const result: MoleculesListResult = {
          count: protos.length,
          protos: protos.map((p) => toSummary(p, paths)),
        };
        outputResult(result, formatMoleculesList, rootOpts);
      }),
    );

  molecules
    .command("show <name>")
    .description("display a molecule template's structure and variables")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [name, , command] = args as [string, unknown, Command];
        const rootOpts = getRootOpts(command);
        const paths = defaultSearchPaths();
        const proto = getProto(name, paths);
        if (!proto) {
          throw new Error(
            `unknown molecule "${name}" (use \`linear molecules list\` to see available)`,
          );
        }
        const result = toShowResult(proto, paths);
        outputResult(result, formatMoleculesShow, rootOpts);
      }),
    );

  molecules
    .command("pour <name>")
    .description(
      "spawn a molecule template into real Linear issues (epic + children + deps)",
    )
    .option(
      "--var <kv>",
      "variable as k=v (repeatable: --var pkg=src/foo --var owner=fahad)",
      (val: string, prev: string[]) => prev.concat(val),
      [] as string[],
    )
    .option(
      "--team <team>",
      "target team (defaults to team.default config / LINEAR_TEAM)",
    )
    .option(
      "--assignee <user>",
      "assign the root epic to this user (name, email, UUID, or @me)",
    )
    .option(
      "--dry-run",
      "plan the pour without creating anything in Linear",
      false,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [name, options, command] = args as [
          string,
          { var: string[]; team?: string; assignee?: string; dryRun?: boolean },
          Command,
        ];
        const rootOpts = getRootOpts(command);

        const paths = defaultSearchPaths();
        const proto = getProto(name, paths);
        if (!proto) {
          throw new Error(
            `unknown molecule "${name}" (use \`linear molecules list\` to see available)`,
          );
        }

        const cliVars: Record<string, string> = {};
        for (const raw of options.var ?? []) {
          const { key, value } = parseVarToken(raw);
          cliVars[key] = value;
        }

        const dryRun = options.dryRun === true;
        const teamKey = options.team ?? getDefaultTeam() ?? undefined;
        if (!dryRun && !teamKey) {
          throw invalidParameterError(
            "--team",
            "no team provided — pass --team <key>, set LINEAR_TEAM, or run `linear config set team.default <key>`",
          );
        }

        const ctx = createContext(rootOpts);

        // Resolve {{LINEAR_USER}} only when a default actually needs it,
        // and only outside dry-run (dry-run can run unauthenticated).
        let viewerName: string | null = null;
        const needsViewer =
          !dryRun &&
          proto.variables.some(
            (v) => v.default === "{{LINEAR_USER}}" && !(v.name in cliVars),
          );
        if (needsViewer) {
          try {
            viewerName = (await validateToken(ctx.gql)).name;
          } catch {
            // Fall through — buildVarMap will report it as missing if the
            // default cannot be substituted.
          }
        }

        const vars = await buildVarMap(proto, cliVars, viewerName);

        const substituted = proto.issues.map((i) =>
          substituteIssueFields(i, vars),
        );
        const sorted = topologicalSort(substituted);

        const epicTitle = proto.description
          ? substituteVariables(proto.description, vars)
          : `Molecule: ${proto.name}`;

        const dependencies: MoleculePourDependency[] = [];
        for (const issue of sorted) {
          for (const dep of issue.depends_on ?? []) {
            dependencies.push({ from: issue.key, to: dep });
          }
        }

        if (dryRun) {
          const result: MoleculePourResult = {
            dry_run: true,
            proto: proto.name,
            vars,
            team_key: teamKey ?? null,
            assignee: options.assignee ?? null,
            epic: {
              id: PLACEHOLDER,
              identifier: PLACEHOLDER,
              title: epicTitle,
            },
            issues: sorted.map((i) => ({
              key: i.key,
              id: PLACEHOLDER,
              identifier: PLACEHOLDER,
              title: i.title,
            })),
            dependencies,
          };
          outputResult(result, formatMoleculesPour, rootOpts);
          return;
        }

        const teamId = await resolveTeamId(ctx.sdk, teamKey as string);

        // Ensure both Linear-Hack labels exist on the workspace.
        const molLabelId = await ensureWorkspaceLabel(
          ctx.gql,
          `linear:molecule:${proto.name}`,
          `Issues poured from the "${proto.name}" molecule template.`,
        );
        const tplLabelId = await ensureWorkspaceLabel(
          ctx.gql,
          "linear:template-instance",
          "Issues instantiated from a molecule template.",
        );

        // Resolve the optional assignee once and pin it to the root epic
        // (--assignee is root-only; children keep their proto
        // assignee). Done only for a real pour so dry-runs stay offline.
        const assigneeId = options.assignee
          ? await resolveUserId(ctx.sdk, options.assignee)
          : undefined;

        // Embed the variable map in the epic description so
        // `molecules current` can recover the assignments later.
        const varsBlock = formatVariablesBlock(vars);
        const epicInput: IssueCreateInput = {
          teamId,
          title: epicTitle,
          labelIds: [molLabelId, tplLabelId],
        };
        if (varsBlock) {
          epicInput.description = varsBlock;
        }
        if (assigneeId) {
          epicInput.assigneeId = assigneeId;
        }
        const epic = await createIssue(ctx.gql, epicInput);

        const createdByKey = new Map<string, MoleculePourIssueRef>();
        for (const spec of sorted) {
          const childInput: IssueCreateInput = {
            teamId,
            title: spec.title,
            parentId: epic.id,
            labelIds: [molLabelId],
          };
          if (spec.description !== undefined) {
            childInput.description = spec.description;
          }
          if (spec.priority !== undefined) {
            childInput.priority = spec.priority;
          }
          const created = await createIssue(ctx.gql, childInput);
          createdByKey.set(spec.key, {
            key: spec.key,
            id: created.id,
            identifier: created.identifier,
            title: created.title,
          });
        }

        // Wire deps: createIssueRelation({issueId: blocker, relatedIssueId: dependent, Blocks})
        // means "blocker blocks dependent" in Linear's model.
        for (const dep of dependencies) {
          const dependent = createdByKey.get(dep.from);
          const blocker = createdByKey.get(dep.to);
          if (!dependent || !blocker) continue;
          await createIssueRelation(ctx.gql, {
            issueId: blocker.id,
            relatedIssueId: dependent.id,
            type: IssueRelationType.Blocks,
          });
        }

        const result: MoleculePourResult = {
          dry_run: false,
          proto: proto.name,
          vars,
          team_key: teamKey ?? null,
          assignee: options.assignee ?? null,
          epic: {
            id: epic.id,
            identifier: epic.identifier,
            title: epic.title,
          },
          issues: sorted.map(
            (i) =>
              createdByKey.get(i.key) ?? {
                key: i.key,
                id: PLACEHOLDER,
                identifier: PLACEHOLDER,
                title: i.title,
              },
          ),
          dependencies,
        };
        outputResult(result, formatMoleculesPour, rootOpts);
      }),
    );

  molecules
    .command("progress <epic-id>")
    .description(
      "show per-child progress of a single poured molecule (epic identifier or UUID)",
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [epicArg, , command] = args as [string, unknown, Command];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);

        const epicId = await resolveIssueId(ctx.sdk, epicArg);
        const epic = await getIssue(ctx.gql, epicId);

        const labels = epic.labels?.nodes?.map((l) => l.name) ?? [];
        if (!labels.includes(TEMPLATE_INSTANCE_LABEL)) {
          throw new Error(
            `${epic.identifier} is not a poured molecule (missing ${TEMPLATE_INSTANCE_LABEL} label)`,
          );
        }
        const proto = labels
          .find((n) => n.startsWith(MOLECULE_LABEL_PREFIX))
          ?.slice(MOLECULE_LABEL_PREFIX.length);
        if (!proto) {
          throw new Error(
            `${epic.identifier} is missing its ${MOLECULE_LABEL_PREFIX}<name> label`,
          );
        }

        const rawChildren = epic.children?.nodes ?? [];

        // One round-trip per child for relations. Acceptable for typical
        // molecule sizes (3-6 children); a single batched query would
        // mean a new GraphQL doc — defer until the cost actually shows.
        const children: MoleculeProgressChild[] = [];
        for (const c of rawChildren) {
          const rels = await listIssueRelations(ctx.gql, c.id, {
            direction: "both",
            type: "blocks",
          });
          const blocked_by: string[] = [];
          const blocking: string[] = [];
          for (const r of rels) {
            // direction === "down" → "what this issue depends on" (its blockers)
            // direction === "up"   → "what this issue blocks"     (its dependents)
            // Only include relations where the OTHER end is also a child of
            // the same molecule (filter via identifier presence in rawChildren).
            const isPeer = rawChildren.some(
              (rc) => rc.identifier === r.identifier,
            );
            if (!isPeer) continue;
            if (r.direction === "down") blocked_by.push(r.identifier);
            else blocking.push(r.identifier);
          }
          children.push({
            id: c.id,
            identifier: c.identifier,
            title: c.title,
            state: c.state?.name ?? "",
            state_type: c.state?.type ?? "",
            blocked_by,
            blocking,
          });
        }

        const counts = bucketCount(children);
        const percent =
          children.length === 0
            ? 0
            : Math.round((counts.closed / children.length) * 100);

        const result: MoleculeProgressResult = {
          epic: {
            id: epic.id,
            identifier: epic.identifier,
            title: epic.title,
            state: epic.state?.name ?? "",
            state_type: epic.state?.type ?? "",
          },
          proto,
          percent_complete: percent,
          poured_at: epic.createdAt,
          variables: parseVariablesBlock(epic.description),
          children,
          counts,
        };
        outputResult(result, formatMoleculesProgress, rootOpts);
      }),
    );

  molecules
    .command("current")
    .description(
      "list currently spawned (poured) molecule epics with completion %",
    )
    .option("--team <team>", "filter to a specific team key/name/uuid")
    .option(
      "--assignee <user>",
      "filter to molecules whose root epic is assigned to this user (@me/name/email/uuid)",
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [
          { team?: string; assignee?: string },
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);

        const filter: {
          labels: { name: { eq: string } };
          team?: { key: { eq: string } };
          assignee?: { id: { eq: string } };
        } = {
          labels: { name: { eq: TEMPLATE_INSTANCE_LABEL } },
        };
        if (options.team) {
          filter.team = { key: { eq: options.team } };
        }
        // pour pins the assignee to the molecule's ROOT epic
        // (root-only), so filtering the poured epics by assignee yields that
        // agent's molecules. Resolve once via the same vocabulary pour uses
        // (@me/name/email/uuid). (lin-ov30.9)
        if (options.assignee) {
          const assigneeId = await resolveUserId(ctx.sdk, options.assignee);
          filter.assignee = { id: { eq: assigneeId } };
        }

        const page = await listIssues(ctx.gql, { limit: 50 }, filter as never);
        const entries: MoleculeCurrentEntry[] = [];
        for (const issue of page.nodes) {
          const entry = toCurrentEntry(issue as IssueForCurrent);
          if (entry) entries.push(entry);
        }

        // Newest first (Linear orders by updatedAt by default; we
        // override to createdAt-desc so the freshest pours surface first).
        entries.sort((a, b) => b.poured_at.localeCompare(a.poured_at));

        const result: MoleculesCurrentResult = {
          count: entries.length,
          molecules: entries,
        };
        outputResult(result, formatMoleculesCurrent, rootOpts);
      }),
    );

  molecules
    .command("usage")
    .description("show detailed usage for molecules")
    .action(() => {
      console.log(formatDomainUsage(molecules, MOLECULES_META));
    });
}
