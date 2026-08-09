import { Command, Option } from "commander";
import pkg from "../package.json" with { type: "json" };
import { ADOPT_META, setupAdoptCommands } from "./commands/adopt.js";
import { ASSIGN_META, setupAssignCommands } from "./commands/assign.js";
import {
  ATTACHMENTS_META,
  setupAttachmentsCommands,
} from "./commands/attachments.js";
import { AUDIT_META, setupAuditCommands } from "./commands/audit.js";
import { AUTH_META, setupAuthCommands } from "./commands/auth.js";
import { BATCH_META, setupBatchCommands } from "./commands/batch.js";
import { BLOCKED_META, setupBlockedCommands } from "./commands/blocked.js";
import { BRANCH_META, setupBranchCommands } from "./commands/branch.js";
// codex-hook is an internal hook command (invoked by the Codex plugin), so it
// is registered but intentionally kept out of allMetas / the usage overview.
import { setupCodexHookCommands } from "./commands/codex-hook.js";
import { COMMENTS_META, setupCommentsCommands } from "./commands/comments.js";
import {
  COMPLETIONS_META,
  setupCompletionsCommands,
} from "./commands/completions.js";
import { CONFIG_META, setupConfigCommands } from "./commands/config.js";
import { CONTEXT_META, setupContextCommands } from "./commands/context.js";
import { CYCLES_META, setupCyclesCommands } from "./commands/cycles.js";
import { DECISION_META, setupDecisionCommands } from "./commands/decision.js";
import { DEPENDS_META, setupDependsCommands } from "./commands/depends.js";
import { DOCTOR_META, setupDoctorCommands } from "./commands/doctor.js";
import {
  DOCUMENTS_META,
  setupDocumentsCommands,
} from "./commands/documents.js";
import { EDIT_META, setupEditCommands } from "./commands/edit.js";
import { EPIC_META, setupEpicCommands } from "./commands/epic.js";
import { FILES_META, setupFilesCommands } from "./commands/files.js";
import { GATE_META, setupGateCommands } from "./commands/gate.js";
import { HOOKS_META, setupHooksCommands } from "./commands/hooks.js";
import { HUMAN_META, setupHumanCommands } from "./commands/human.js";
import { IMPORT_META, setupImportCommands } from "./commands/import.js";
import { INFO_META, setupInfoCommands } from "./commands/info.js";
import { INIT_META, setupInitCommands } from "./commands/init.js";
import {
  INITIATIVES_META,
  setupInitiativesCommands,
} from "./commands/initiatives/index.js";
import { ISSUES_META, setupIssuesCommands } from "./commands/issues.js";
import { KV_META, setupKvCommands } from "./commands/kv.js";
import { LABELS_META, setupLabelsCommands } from "./commands/labels.js";
import { MEMORY_META, setupMemoryCommands } from "./commands/memory.js";
import {
  MILESTONES_META,
  setupMilestonesCommands,
} from "./commands/milestones.js";
import {
  MOLECULES_META,
  setupMoleculesCommands,
} from "./commands/molecules.js";
import { NEXT_META, setupNextCommands } from "./commands/next.js";
import { ONBOARD_META, setupOnboardCommands } from "./commands/onboard.js";
import { ORPHANS_META, setupOrphansCommands } from "./commands/orphans.js";
import {
  PREFLIGHT_META,
  setupPreflightCommands,
} from "./commands/preflight.js";
import { PRIME_META, setupPrimeCommands } from "./commands/prime.js";
import { PROJECTS_META, setupProjectsCommands } from "./commands/projects.js";
import {
  QUICKSTART_META,
  setupQuickstartCommands,
} from "./commands/quickstart.js";
import { RULES_META, setupRulesCommands } from "./commands/rules.js";
import { SETUP_META, setupSetupCommands } from "./commands/setup.js";
import { SNOOZE_META, setupSnoozeCommands } from "./commands/snooze.js";
import { START_META, setupStartCommands } from "./commands/start.js";
import { SWARM_META, setupSwarmCommands } from "./commands/swarm.js";
import { SWITCH_META, setupSwitchCommands } from "./commands/switch.js";
import { setupTeamsCommands, TEAMS_META } from "./commands/teams.js";
import { setupTemplateCommands, TEMPLATE_META } from "./commands/template.js";
import { setupTipsCommands, TIPS_META } from "./commands/tips.js";
import { setupTodoCommands, TODO_META } from "./commands/todo.js";
import { setupUpgradeCommands, UPGRADE_META } from "./commands/upgrade.js";
import { setupUsersCommands, USERS_META } from "./commands/users.js";
import { setupWakeCommands, WAKE_META } from "./commands/wake.js";
import { setupWhereCommands, WHERE_META } from "./commands/where.js";
import { setupWorktreeCommands, WORKTREE_META } from "./commands/worktree.js";
import { parseFieldsList } from "./common/output.js";
import {
  type DomainMeta,
  formatDomainUsage,
  formatOverview,
} from "./common/usage.js";

// Top-level help banner. The flat verb list below is Commander's auto-
// generated command list — kept alphabetical for `--help` parseability —
// and this banner+footer pair gives a workflow-shaped entry point on top
// of it. The same grouping is what `linear prime` outputs for agent
// SessionStart hooks; keep them in sync.
const TOP_HELP_BEFORE = `
Common workflows:

  Find work        linear next · linear list · linear blocked · linear issues stale
  Create / update  linear create "..." --team <key> · linear update <id> ... · linear close <id...>
  Dependencies     linear depends add · linear depends tree <id> · linear depends cycles
  Search & health  linear issues search · linear issues status · linear doctor · linear preflight
  Quality          linear issues lint · linear human list · linear audit
  Lifecycle        linear snooze · linear wake · linear issues archive · linear issues supersede
  Memory           linear remember "..." · linear recall <key> · linear memories [query]

Most commonly used verbs are aliased at the top level (e.g. \`linear list\` →
\`linear issues list\`). Run \`linear prime\` for the full agent workflow brief.
`;

const TOP_HELP_AFTER = `
Verb groups (see \`linear <group> --help\` for the full surface):

  Issue work         issues · comments · labels · assign · todo · branch · worktree
  Dependencies       depends · blocked · orphans
  Discovery          next · snooze · wake · audit · gate
  Quality / hygiene  doctor · preflight · rules · adopt · import
  Knowledge          memory · remember · recall · memories · forget · decision
  Workspace          teams · users · projects · cycles · milestones · initiatives · documents
  Setup / config     init · setup · auth · config · context · hooks · where · info · kv
  Help               prime · onboard · quickstart · tips · usage

Tip: most read-only verbs default to text; pass --json for the structured
envelope used by agents and scripts.
`;

/**
 * Every user-facing domain's metadata, in the order shown by the usage
 * overview. `codex-hook` is intentionally excluded (internal plugin hook).
 */
export const allMetas: DomainMeta[] = [
  ADOPT_META,
  AUTH_META,
  ISSUES_META,
  COMMENTS_META,
  LABELS_META,
  PROJECTS_META,
  CYCLES_META,
  MILESTONES_META,
  DOCUMENTS_META,
  FILES_META,
  ATTACHMENTS_META,
  TEAMS_META,
  USERS_META,
  INITIATIVES_META,
  MEMORY_META,
  PRIME_META,
  ONBOARD_META,
  DEPENDS_META,
  SWARM_META,
  SWITCH_META,
  START_META,
  BLOCKED_META,
  AUDIT_META,
  GATE_META,
  TODO_META,
  NEXT_META,
  SNOOZE_META,
  WAKE_META,
  ORPHANS_META,
  RULES_META,
  PREFLIGHT_META,
  BATCH_META,
  DOCTOR_META,
  EDIT_META,
  EPIC_META,
  WHERE_META,
  SETUP_META,
  INFO_META,
  HUMAN_META,
  HOOKS_META,
  KV_META,
  CONFIG_META,
  TEMPLATE_META,
  CONTEXT_META,
  QUICKSTART_META,
  INIT_META,
  ASSIGN_META,
  TIPS_META,
  BRANCH_META,
  WORKTREE_META,
  MOLECULES_META,
  IMPORT_META,
  DECISION_META,
  COMPLETIONS_META,
  UPGRADE_META,
];

/**
 * Construct (but do not parse) the fully-wired linear program. Kept separate
 * from the `main.ts` entry point so tests can build the real command tree
 * without triggering `parse()` / argv side effects. Returns a fresh
 * `Command` each call, so callers (and tests) are hermetic. (lin-ay7q)
 */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name("linear")
    .description("CLI for Linear.app — text-default output with --json opt-in")
    .version(pkg.version)
    .option("--api-token <token>", "Linear API token")
    .option(
      "--json [mode]",
      "emit the JSON envelope (for agents / scripts). Bare --json emits multi-line 2-space-indented JSON (or single-line compact under agent mode — see LINEAR_AGENT_MODE); --json=pretty always pretty, --json=compact always single-line.",
    )
    .option(
      "--compact",
      "emit single-line JSON. Implies --json and overrides --json=pretty.",
    )
    .option(
      "--fields <list>",
      "comma-separated dot-paths to keep in the JSON envelope (e.g. nodes.identifier,nodes.state.name). Implies --json; list verbs narrow through nodes.",
      parseFieldsList,
    )
    .addHelpText("before", TOP_HELP_BEFORE)
    .addHelpText("after", TOP_HELP_AFTER);

  program.action(() => console.log(formatOverview(pkg.version, allMetas)));

  setupAdoptCommands(program);
  setupAuthCommands(program);
  setupIssuesCommands(program);
  setupCommentsCommands(program);
  setupLabelsCommands(program);
  setupProjectsCommands(program);
  setupCyclesCommands(program);
  setupMilestonesCommands(program);
  setupFilesCommands(program);
  setupAttachmentsCommands(program);
  setupTeamsCommands(program);
  setupUsersCommands(program);
  setupInitiativesCommands(program);
  setupDocumentsCommands(program);
  setupMemoryCommands(program);
  setupPrimeCommands(program);
  setupOnboardCommands(program);
  setupDependsCommands(program);
  setupSwarmCommands(program);
  setupSwitchCommands(program);
  setupStartCommands(program);
  setupBlockedCommands(program);
  setupAuditCommands(program);
  setupGateCommands(program);
  setupTodoCommands(program);
  setupNextCommands(program);
  setupSnoozeCommands(program);
  setupWakeCommands(program);
  setupOrphansCommands(program);
  setupRulesCommands(program);
  setupPreflightCommands(program);
  setupBatchCommands(program);
  setupDoctorCommands(program);
  setupEditCommands(program);
  setupEpicCommands(program);
  setupWhereCommands(program);
  setupSetupCommands(program);
  setupInfoCommands(program);
  setupHumanCommands(program);
  setupHooksCommands(program);
  setupKvCommands(program);
  setupConfigCommands(program);
  setupTemplateCommands(program);
  setupContextCommands(program);
  setupQuickstartCommands(program);
  setupInitCommands(program);
  setupAssignCommands(program);
  setupTipsCommands(program);
  setupBranchCommands(program);
  setupWorktreeCommands(program);
  setupMoleculesCommands(program);
  setupImportCommands(program);
  setupDecisionCommands(program);
  setupCodexHookCommands(program);
  setupCompletionsCommands(program);
  setupUpgradeCommands(program);

  program
    .command("usage")
    .description("show overview of all domains")
    .addOption(
      new Option("--all", "output all domain usages concatenated")
        .default(false)
        .hideHelp(),
    )
    .action((options: { all: boolean }) => {
      console.log(formatOverview(pkg.version, allMetas));
      if (options.all) {
        for (const meta of allMetas) {
          console.log("\n---\n");
          const cmd = program.commands.find((c) => c.name() === meta.name);
          if (cmd) {
            console.log(formatDomainUsage(cmd, meta));
          }
        }
      }
    });

  return program;
}
