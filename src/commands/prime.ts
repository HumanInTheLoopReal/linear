import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Command } from "commander";
import { isMCPActive } from "../common/claude-settings.js";
import { getRootOpts } from "../common/context.js";
import { listMemories } from "../common/memory-store.js";
import { handleCommand, outputResult } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";

export const PRIME_META: DomainMeta = {
  name: "prime",
  summary:
    "inject workflow context for agents (markdown for SessionStart hooks)",
  context: [
    "outputs an AI-optimized markdown brief: session close protocol, core",
    "rules, command reference, and any memories stored via `linear remember`.",
    "designed for direct injection into Claude SessionStart / PreCompact hooks.",
    "",
    "text-default like every other linear verb. The default mode writes the",
    "markdown brief straight to stdout (so `linear prime > /tmp/brief.md`",
    "captures exactly what an agent needs). Pass `--json` to get the",
    "envelope `{brief, stealth, memories_only}` — useful for callers that",
    "need to inspect mode metadata alongside the content.",
    "",
    "`--stealth` omits the git-ops session-close protocol — useful when the",
    "agent is operating on a managed branch, in a worktree without push",
    "rights, or behind a code-review gate. Pair with `linear setup claude",
    "--stealth` / `setup gemini --stealth` to wire it into hooks.",
    "",
    "`--export` dumps the default brief to stdout, bypassing any",
    "`PRIME.md` override — useful as the starting point for hand-editing",
    "an override (`linear prime --export > .linear/PRIME.md`). `--full`",
    "forces the full brief even with `--memories-only`. `--mcp` prefixes",
    "the brief with an MCP server hint pointing at `linear mcp`. When a",
    "`PRIME.md` override is present (cwd → `.linear/PRIME.md` →",
    "`~/.linear/PRIME.md`) and `--export` is not set, its body is used",
    "verbatim and the built-in brief is suppressed.",
    "",
    "MCP auto-detection: when a `linear` MCP server is configured in",
    "`~/.claude/settings.json`, `prime` auto-emits a compact (~50 token)",
    "MCP-oriented brief instead of the full CLI reference (the agent",
    "already has the surface as tool calls). Pass `--full` to force the",
    "full brief. `--hook-json` wraps the brief in the Claude Code",
    "SessionStart hook envelope `{hookSpecificOutput:{hookEventName,",
    "additionalContext}}` so it can be consumed directly by a",
    "SessionStart / PreCompact hook.",
  ].join("\n"),
  arguments: {},
  seeAlso: ["onboard", "memory"],
};

const SESSION_CLOSE_PROTOCOL = `# 🚨 SESSION CLOSE PROTOCOL 🚨

**CRITICAL**: The word "done" is earned. Work every step below first:

\`\`\`
[ ] 1. git status                  (see exactly what changed)
[ ] 2. run required gates          (prove the contract holds)
[ ] 3. git add <files>             (stage only what this task owns)
[ ] 4. git commit -m "..."         (message carries the issue linkage)
[ ] 5. git push                    (publish the branch)
[ ] 6. tend the PR / required gate (review, CI, merge as policy requires)
[ ] 7. post one Linear receipt and transition only after the real terminal event
\`\`\`

**NEVER skip this.** Pushed code is not a merged PR, and a merged PR is not a
finished task. Each of those is its own event, and only the last one closes an
issue.
`;

const STEALTH_SESSION_CLOSE_PROTOCOL = `# 🚨 SESSION CLOSE PROTOCOL 🚨

**CRITICAL**: The word "done" is earned. Leave a durable result behind first:

\`\`\`
[ ] run the gates available in this environment
[ ] post one Linear receipt / handoff with evidence and the exact next action
[ ] transition only if this actor owns the repository's terminal gate
\`\`\`

Stealth mode: git operations are intentionally omitted (managed branch / no-push workflow).
`;

const CORE_RULES = `## Core Rules
- **Boundary**: Linear stores approved outcomes, decisions, independently resumable work, human gates, and what happens next. Use the host agent's task system for temporary execution steps.
- **Creation gate**: Discovery is not commitment. Workers may update their assigned issue and create necessary children beneath it; unrelated discoveries remain findings until triage.
- **Workflow**: Read repository policy, confirm \`linear where\`, select approved work, claim before code, and transition only after the real review/merge gate.
- **Communication**: Descriptions are contracts. Comments are sparse receipts, decisions, blockers, human requests, and handoffs - never command-by-command narration.
- **Memory**: Use \`linear remember "insight"\` for persistent knowledge across sessions; search with \`linear memories <keyword>\`. Avoid scattering notes into MEMORY.md files.
- **Output**: read-only verbs print human-readable text by default; pass \`--json\` to get the structured envelope (for scripting / agent parsing). Mutations and a few verbs without a meaningful text view still emit JSON unconditionally.
`;

const ESSENTIAL_COMMANDS = `## Essential Commands

### Finding Work
- \`linear next\` — issues with no active blockers (also aliased as \`linear ready\`)
- \`linear issues list --status open\` — open issues
- \`linear issues list --status "In Progress"\` — your active work
- \`linear issues stale --days 14\` — issues gone quiet
- \`linear issues read <id>\` — full details

### Creating & Updating
- \`linear issues create "Title" --team <key>\` — new issue
- \`linear issues update <id> --status <state> --priority <1-4>\` — edit fields
- \`linear issues tag <id> <label>\` — add a single label
- \`linear issues rename <id> <new-title>\` — update title (Linear IDs are immutable)
- \`linear issues children <id>\` — list child issues
- **Creation guard**: search first. Ordinary implementation work needs an approved parent; execution workers create only necessary children under their assigned issue. Bulk creation requires approved decomposition or an explicitly authorized campaign.
- **WARNING**: do NOT use \`linear edit <id>\` from an agent — it spawns \`$EDITOR\` and blocks until you exit. Use \`linear issues update\` for headless writes.
- **Structured descriptions are enforced.** \`create\` requires a \`--description\` whose markdown carries the template's required sections (default: \`## Context\`, \`## Acceptance Criteria\`, \`## Test Plan\`). Issues that omit them are rejected before any write — see \`linear template show\`. The gate runs on \`issues create\`, \`epic create\` (parent + every child), and \`batch\` \`create\` ops. Fill the sections, or use \`--acceptance\`/\`--design\`/\`--notes\` to compose them.

### Editing Descriptions (agent-safe — never replace the whole body to change part of it)
- \`linear issues pull <id>\` — description → local file; edit it with your file tools, then \`linear issues push <id>\`. Push exits 3 with a diff if the issue changed on the server since pull (re-pull, re-apply, push); \`push --dry-run\` previews the diff.
- \`linear issues check <id> "<item>"\` / \`uncheck\` — tick/untick one \`- [ ]\` checklist line by substring or number; nothing else in the body is touched.
- \`linear issues note <id> "text"\` — append under \`## Notes\`.
- \`linear issues update <id> --context|--acceptance|--test|--notes "text"\` — replace ONE section in place; \`--append-notes\` appends instead.
- \`linear comment <id> "text"\` — add one durable receipt, decision, blocker, human request, or handoff. Do not narrate routine commands or state changes. Comments render as **markdown** (pipe tables do NOT render — use bullets).

### Dependencies & Blocking
- \`linear depends add <issue> <depends-on>\` — add a blocks relation
- \`linear depends tree <id>\` — recursive dependency tree
- \`linear depends list <issue>\` — direct edges from an issue
- \`linear depends cycles\` — detect cycles in the graph
- \`linear blocked\` — all issues with unresolved blockers

### Search & Project Health
- \`linear issues search "<query>"\` — full-text search across the workspace
- \`linear issues status\` — aggregate counts (open / in_progress / blocked / closed)
- \`linear issues count\` — single integer for shell pipelines
- \`linear doctor\` — environment + auth + workspace sanity check
- \`linear preflight\` — pre-PR checks (lint, stale, orphans)
- \`linear where\` — resolved workspace + team context

### Quality Tools
- \`linear issues lint\` — flag issues with missing description sections (text mode exits 1 on warnings)
- \`linear issues create --acceptance "criteria" --design "decisions" --notes "context"\` — fill quality fields up front
- \`linear template show\` — print the active create template + its required sections (the gate every \`create\` is held to)
- \`linear template set --from-default | --file <path> | --stdin\` — customize the template (\`--local\` per-repo, else global); \`linear template unset\` reverts to the built-in
- \`linear config set validation.on-create <off|warn|error>\` — gate strictness (default \`error\`; per-call override with \`--validate\`/\`--no-validate\`)
- \`linear human list/respond/dismiss\` — escalate / triage human-decision flags
- \`linear audit list/record\` — append-only audit trail for sensitive actions

### Lifecycle & Hygiene
- \`linear issues close <id> --reason "..."\` — close with a rationale
- \`linear issues reopen <id>\` — reopen a closed issue
- \`linear issues archive <id>\` / \`unarchive <id>\` — toggle archived
- \`linear issues supersede <id>\` — mark superseded
- \`linear snooze <id> --until "<date>"\` — defer work to a future date (also aliased as \`linear defer\`)
- \`linear wake <id>\` — undo a snooze
- \`linear orphans\` — issues whose dependencies have been deleted

### Memory
- \`linear remember "insight" [--key <slug>]\` — persist a note
- \`linear recall <key>\` — retrieve a memory
- \`linear memories [search]\` — list / search memories
- \`linear forget <key>\` — delete a memory
`;

function commonWorkflowsSection(opts: { stealth: boolean }): string {
  const completingBlock = opts.stealth
    ? `**Completing or handing off work:**
\`\`\`bash
linear issues discuss <id> --body-file receipt.md  # durable result; git ops omitted
# transition only if this actor owns the terminal gate
\`\`\``
    : `**Completing work:**
\`\`\`bash
git status                                    # confirm task-owned scope
<run required gates>
git add <files> && git commit -m "..."        # include issue linkage
git push                                      # publish branch
<tend review / CI / merge per repository policy>
linear issues discuss <id> --body-file receipt.md
linear issues close <id> --reason "Merged and verified"  # only after the real terminal event
\`\`\``;
  return `## Common Workflows

**Starting work:**
\`\`\`bash
linear where                                 # verify workspace/scope
linear next                                  # find eligible approved work
linear issues read <id>                      # review details
linear start <id>                            # claim + In Progress; one selector owns selection
\`\`\`

${completingBlock}

**Creating an approved durable child:**
\`\`\`bash
linear issues search "<outcome>"             # avoid duplicates
linear issues create "<verb + outcome>" --parent-ticket <parent> \\
  --context "<why / upstream>" --acceptance "<observable outcome>" \\
  --test "<literal verification>" --dry-run
# rerun without --dry-run only after placement and authority are correct
\`\`\`

**Capturing unrelated discovered work:** batch it in the current TaskResult or one
checkpoint for triage. Do not create a sibling/top-level issue automatically.
`;
}

const TOP_LEVEL_ALIASES = `## Top-Level Aliases

Short top-level verbs that expand to the qualified linear paths before Commander parses:

- \`linear list\`              ≡  \`linear issues list\`
- \`linear show <id>\`         ≡  \`linear issues read <id>\`
- \`linear create "..."\`      ≡  \`linear issues create "..."\`
- \`linear update <id> ...\`   ≡  \`linear issues update <id> ...\`
- \`linear close <id>\`        ≡  \`linear issues close <id>\`
- \`linear ready\`             ≡  \`linear next\` (issues with no active blockers)
- \`linear dep tree <id>\`     ≡  \`linear depends tree <id>\`
- \`linear relate <a> <b>\`    ≡  \`linear depends relate <a> <b>\`
- \`linear defer <id>\`        ≡  \`linear snooze <id>\`

The full map lives in \`src/commands/aliases.ts\`. Aliases are additive — every qualified path keeps working.
`;

const INTEGRATIONS = `## Agent Integrations

- \`.claude/skills/linear/SKILL.md\` — Claude Code auto-loaded skill describing the full linear workflow surface (also satisfies the AGENTS.md skill loader via the \`.agents/skills/\` symlink).
- \`/linear:plan-to-linear\` — slash command that turns an approved plan into a Linear epic with correctly parented children and their dependency edges. Installed with the plugin alongside the other \`/linear:*\` commands; nothing to copy by hand.
`;

function renderMemoriesSection(): string {
  const memories = listMemories();
  const keys = Object.keys(memories).sort();
  if (keys.length === 0) {
    return `## Persistent Memories (0)

No memories stored. Add one with \`linear remember "insight"\`.
`;
  }
  const blocks = keys.map((k) => `### ${k}\n${memories[k].value}\n`).join("\n");
  return `## Persistent Memories (${keys.length})

Stored via \`linear remember\`. Update by re-running \`linear remember "..." --key ${keys[0]}\`. Search with \`linear memories <keyword>\`. Remove with \`linear forget <key>\`.

${blocks}`;
}

const TRUNCATION_DIRECTIVE =
  "[linear prime] Some hosts show only the first part of this brief. If yours did, open the persisted hook output and read the rest before you act; the part you cannot see carries this project's stored memories and session rules.";

function renderFullBrief(opts: { stealth: boolean }): string {
  return [
    TRUNCATION_DIRECTIVE,
    "",
    "# Linear Workflow Context",
    "",
    "> **Context Recovery**: Run `linear prime` after compaction, clear, or new session.",
    "> Recommended as a Claude `SessionStart` / `PreCompact` hook so agents keep workflow context across compactions.",
    "",
    opts.stealth ? STEALTH_SESSION_CLOSE_PROTOCOL : SESSION_CLOSE_PROTOCOL,
    CORE_RULES,
    ESSENTIAL_COMMANDS,
    commonWorkflowsSection({ stealth: opts.stealth }),
    TOP_LEVEL_ALIASES,
    INTEGRATIONS,
    renderMemoriesSection(),
  ].join("\n");
}

function renderMemoriesOnly(): string {
  return renderMemoriesSection();
}

/**
 * MCP hint — prepended to the brief when `--mcp` is passed. Advises the
 * agent that an MCP server is available.
 */
const MCP_HINT = `> **MCP available**: this project ships a Linear MCP server. Start it with \`linear mcp\` (or wire it via your agent's MCP config). The CLI commands below still work; MCP just exposes the same surface as structured tool calls.\n\n`;

/**
 * Compact (~50 token) MCP-oriented brief. Emitted automatically when a
 * `linear` MCP server is detected in `~/.claude/settings.json` (and `--full`
 * is not passed). The agent already has the Linear surface as structured tool
 * calls, so it only needs the close protocol and core rules — not the full CLI
 * command reference.
 */
function renderMCPBrief(opts: { stealth: boolean }): string {
  const closeProtocol = opts.stealth
    ? 'Before saying "done": post one durable Linear receipt/handoff; transition only if this actor owns the terminal gate.'
    : 'Before saying "done": run gates, commit/push, tend review/merge, then post one Linear receipt and transition after the real terminal event.';
  return [
    TRUNCATION_DIRECTIVE,
    "",
    "# Linear Issue Tracker Active (MCP)",
    "",
    "# 🚨 SESSION CLOSE PROTOCOL 🚨",
    "",
    closeProtocol,
    "",
    "## Core Rules",
    "- **Boundary**: Linear stores durable outcomes, decisions, resumable work, human gates, and next actions; agent tasks store temporary execution steps.",
    "- **Creation gate**: discovery is not commitment; workers create only necessary children under their assigned issue, while unrelated findings wait for triage.",
    "- **Workflow**: verify scope, claim approved work before code, and transition only after the repository's actual review/merge gate.",
    "- **Communication**: comments are sparse receipts, decisions, blockers, requests, and handoffs - never command narration.",
    "- **Memory**: Use `linear remember` for persistent knowledge across sessions.",
    "",
    "Start: check `linear next` (or the equivalent MCP tool) for available work.",
    "",
  ].join("\n");
}

/**
 * PRIME.md override lookup. Checks (in order):
 *   1. `.linear/PRIME.md` under cwd (project override).
 *   2. `~/.linear/PRIME.md` (user-global override).
 *
 * Returns the file contents and resolved path, or null when neither exists.
 */
function loadPrimeOverride(
  cwd: string = process.cwd(),
): { path: string; body: string } | null {
  const projectOverride = path.join(cwd, ".linear", "PRIME.md");
  if (fs.existsSync(projectOverride)) {
    return {
      path: projectOverride,
      body: fs.readFileSync(projectOverride, "utf8"),
    };
  }
  const globalOverride = path.join(os.homedir(), ".linear", "PRIME.md");
  if (fs.existsSync(globalOverride)) {
    return {
      path: globalOverride,
      body: fs.readFileSync(globalOverride, "utf8"),
    };
  }
  return null;
}

/**
 * SessionStart hook envelope. Claude Code (and Gemini CLI / Codex) read
 * `hookSpecificOutput.{hookEventName, additionalContext}` from a hook's stdout
 * and inject `additionalContext` into the session.
 */
export interface HookJSONEnvelope {
  hookSpecificOutput: {
    hookEventName: string;
    additionalContext: string;
  };
}

/** Wrap a brief in the SessionStart hook envelope. */
export function toHookJSON(content: string): HookJSONEnvelope {
  return {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: content,
    },
  };
}

/**
 * Envelope shape for `linear --json prime`. The default text path emits
 * just `brief` so the markdown lands on stdout unwrapped; --json keeps
 * the mode flags alongside the content for callers that want both.
 */
export interface PrimeEnvelope {
  brief: string;
  stealth: boolean;
  memories_only: boolean;
  /** When set, the brief was loaded from this PRIME.md override. */
  override_path?: string;
  /** True iff --export forced the default brief, bypassing any override. */
  exported?: boolean;
  /** True iff the MCP hint was prepended to the brief. */
  mcp: boolean;
}

export function formatPrime(envelope: PrimeEnvelope): string {
  return envelope.brief;
}

export function setupPrimeCommands(program: Command): void {
  program
    .command("prime")
    .description(
      "print an agent-optimized workflow brief in markdown (for SessionStart hooks)",
    )
    .option(
      "--memories-only",
      "print just the memory section (for PreCompact hooks)",
      false,
    )
    .option(
      "--stealth",
      "omit the git-ops session-close protocol (managed-branch / no-push workflows)",
      false,
    )
    .option(
      "--full",
      "force the full brief even with --memories-only (useful for diffing)",
      false,
    )
    .option(
      "--mcp",
      "prepend an MCP-available hint pointing at `linear mcp`",
      false,
    )
    .option(
      "--export",
      "dump the default brief to stdout, bypassing any PRIME.md override (starting point for hand-edited override; pipe with `>`)",
      false,
    )
    .option(
      "--hook-json",
      "wrap the brief in the Claude Code SessionStart hook envelope `{hookSpecificOutput:{hookEventName,additionalContext}}` (consumable directly by a SessionStart/PreCompact hook)",
      false,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [
          {
            memoriesOnly: boolean;
            stealth: boolean;
            full: boolean;
            mcp: boolean;
            export: boolean;
            hookJson: boolean;
          },
          Command,
        ];
        // MCP auto-detection: when a `linear` MCP server is wired into
        // ~/.claude/settings.json the agent already has the surface as tool
        // calls, so we emit a compact MCP brief instead of the full CLI
        // reference. `--full` forces the full brief; `--mcp` forces MCP.
        let mcpMode = isMCPActive();
        if (options.full) mcpMode = false;
        if (options.mcp) mcpMode = true;

        const override = options.export ? null : loadPrimeOverride();
        let brief: string;
        if (override) {
          brief = override.body;
        } else if (options.memoriesOnly && !options.full) {
          brief = renderMemoriesOnly();
        } else if (mcpMode) {
          brief = renderMCPBrief({ stealth: options.stealth });
        } else {
          brief = renderFullBrief({ stealth: options.stealth });
        }
        // `--mcp` additionally prefixes the explicit MCP hint (unchanged
        // behavior); auto-detected MCP mode does not, since the compact
        // brief is already MCP-oriented.
        if (options.mcp) brief = `${MCP_HINT}${brief}`;

        // `--hook-json` wraps the brief in the SessionStart hook
        // envelope and emits it as JSON regardless of the global `--json`
        // flag — a hook host requires stdout to be valid JSON.
        if (options.hookJson) {
          outputResult(
            toHookJSON(brief),
            (env) => JSON.stringify(env),
            getRootOpts(command),
          );
          return;
        }

        const envelope: PrimeEnvelope = {
          brief,
          stealth: options.stealth,
          memories_only: options.memoriesOnly,
          mcp: options.mcp,
          ...(override ? { override_path: override.path } : {}),
          ...(options.export ? { exported: true } : {}),
        };
        outputResult(envelope, formatPrime, getRootOpts(command));
      }),
    );

  program
    .command("prime-usage")
    .description("show detailed usage for prime")
    .action(() => {
      const cmd = program.commands.find((c) => c.name() === "prime");
      if (cmd) console.log(formatDomainUsage(cmd, PRIME_META));
    });
}
