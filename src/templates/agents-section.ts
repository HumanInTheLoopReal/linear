/**
 * AGENTS.md managed-block rendering for `linear init`.
 *
 * A section body is wrapped in marker lines that carry the format
 * version, profile, and a hash of the body. Re-running init replaces
 * the block only when either the profile or body hash changes; existing
 * tooling that grep-edits around the markers continues to work.
 *
 * Two profiles ship:
 *
 *   - `minimal` — pointer-only block. Tells the agent the project uses
 *     `linear`, gives a quick reference, points at `linear prime` for
 *     the live brief. Default for Claude / Gemini hosts that wire a
 *     SessionStart hook.
 *   - `full`    — inline command reference for hookless agents (Codex,
 *     Factory, Mux).
 *
 * Both profiles include a one-line `/plugin install linear` pointer at
 * the Claude Code plugin bundle. The text is static and harmless when
 * the bundle is absent.
 */

import crypto from "node:crypto";

/** Marker format version. Bump only when the marker SHAPE changes. */
export const AGENTS_MARKER_VERSION = 1;

export type AgentsProfile = "minimal" | "full";

const AGENTS_BEGIN_PREFIX = "<!-- BEGIN LINEAR INTEGRATION";
const AGENTS_END_MARKER = "<!-- END LINEAR INTEGRATION -->";

/**
 * Closing checklist appended to both profiles. Shared so the two bodies
 * cannot drift apart; the rendered text is identical in each.
 */
const SESSION_COMPLETION = `## Session Completion

Before you end a work session, finish every step below. The session is not over until \`git push\` succeeds.

**Required sequence:**

1. **Sort what is left.** Open durable issues only for approved work; park unrelated findings for triage.
2. **Run the repository gates** if code changed: tests, linters, build.
3. **Leave it resumable.** Commit the changes this task owns, and write one durable checkpoint if the next agent would otherwise be lost.
4. **Push. This step is not optional:**
   \`\`\`bash
   git pull --rebase
   git push
   git status  # must report the branch is up to date with origin
   \`\`\`
5. **Tend the review.** Open or refresh the PR, clear required checks and review comments, and respect the repository's merge authority.
6. **Record the outcome in Linear.** Transition the issue only once the real completion gate is met.
7. **Hand off.** If the issue stays active, state the exact next action.

**Non-negotiable:**
- Unpushed work does not count as finished.
- Do not stop at the last commit. Stranded local work is the failure this checklist exists to prevent.
- Do not offer to push later or wait to be asked. Push.
- Treat a failed push as something to resolve and retry, not something to report and abandon.`;

/**
 * Minimal profile body — pointer at `linear prime` plus a 4-bullet
 * quick reference.
 */
const MINIMAL_BODY = `## Linear Issue Tracker

This project uses **linear** (Linear.app CLI) for issue tracking. Run \`linear prime\` to see the full workflow context and command reference.

### Quick Reference

\`\`\`bash
linear next                                       # find unblocked work
linear issues read <id>                           # view issue details
linear issues update <id> --status "In Progress"  # claim work
linear issues close <id>                          # complete work
\`\`\`

### Rules

- Use Linear for approved, durable product work and resumable coordination.
- Use TodoWrite, TaskCreate, or the host task system for temporary execution steps.
- Do not turn every discovery into an issue; capture findings for triage first.
- Run \`linear prime\` for detailed command reference and the session close protocol.
- Use \`linear remember\` for persistent knowledge — do NOT scatter notes into MEMORY.md files.

**Tip:** If your agent supports Claude Code plugins, install \`/plugin install linear\` to get \`/linear:*\` slash commands and auto-loaded reference docs.

${SESSION_COMPLETION}`;

/**
 * Full profile body — the inline command reference for hookless
 * agents. Stays in lock-step with the prime command's
 * essential-commands section: same verbs, same categories.
 */
const FULL_BODY = `## Issue Tracking with linear (Linear.app)

**IMPORTANT**: This project uses **linear** (the Linear.app CLI) for approved, durable product work. Temporary execution steps stay in the host agent's task system.

### Why linear?

- Workspace-global: issues live in Linear; every clone sees the same state.
- Dependency-aware: track blockers and relationships between issues.
- Agent-optimized: text-default output, structured \`--json\` envelopes for scripts, ready-work detection.
- Preserves human-readable project state without turning Linear into agent scratch space.

### Quick Start

**Check for ready work:**

\`\`\`bash
linear next                                  # issues with no active blockers
linear issues list --status open,in_progress # all non-terminal issues
\`\`\`

**Create new issues:**

\`\`\`bash
linear issues create "Issue title" --team <key> --priority 1 --description "Detailed context"
linear issues create "Approved follow-up" --team <key> --parent-ticket <parent> --acceptance "criteria" --design "decisions"
\`\`\`

**Claim and update:**

\`\`\`bash
linear issues update <id> --status "In Progress" --assignee me
linear issues update <id> --priority 1
\`\`\`

**Complete work:**

\`\`\`bash
linear issues close <id> --reason "completed"
\`\`\`

### Priorities

- \`1\` — Urgent (security, data loss, broken builds)
- \`2\` — High (major features, important bugs)
- \`3\` — Medium (default, nice-to-have)
- \`4\` — Low (polish, optimization)

### The loop an agent runs

1. **Find unblocked work**: \`linear next\` lists what is ready.
2. **Claim a task**: \`linear issues update <id> --status "In Progress" --assignee me\`.
3. **Work on it**: implement, test, document.
4. **Execute**: keep commands, inspections, edits, and test runs in the host task system.
5. **Discover unrelated work?** Capture a structured finding for triage; do not create an issue automatically.
6. **Need durable decomposition?** Create a child only when it is required by the current contract and independently resumable.
7. **Complete**: satisfy repository gates, push/tend review, then record the receipt and transition the issue.

### Dependencies & Blocking
- \`linear depends add <issue> <depends-on>\` — add a blocks relation
- \`linear depends tree <id>\` — recursive dependency tree
- \`linear depends list <issue>\` — direct edges from an issue
- \`linear blocked\` — all issues with unresolved blockers

### Search & Project Health
- \`linear issues search "<query>"\` — full-text search across the workspace
- \`linear issues status\` — aggregate counts (open / in_progress / blocked / closed)
- \`linear doctor\` — environment + auth + workspace sanity check
- \`linear preflight\` — pre-PR checks (lint, stale, orphans)
- \`linear where\` — resolved workspace + team context

### Quality Tools
- \`linear issues lint\` — flag issues with missing description sections
- \`linear template show\` — the active create template; every \`create\` (issues / epic / batch) is gated on its required sections (default \`## Context\`, \`## Acceptance Criteria\`, \`## Test Plan\`)
- \`linear template set --from-default | --file <path> | --stdin\` — customize the template; \`linear config set validation.on-create <off|warn|error>\` tunes strictness
- \`linear human list / respond / dismiss\` — escalate / triage human-decision flags
- \`linear audit list / record\` — append-only audit trail for sensitive actions

### Lifecycle & Hygiene
- \`linear issues close <id> --reason "..."\` — close with a rationale
- \`linear issues reopen <id>\` — reopen a closed issue
- \`linear issues archive <id>\` / \`unarchive <id>\` — toggle archived
- \`linear issues supersede <id>\` — mark superseded
- \`linear snooze <id> --until "<date>"\` — defer to a future date
- \`linear wake <id>\` — undo a snooze
- \`linear orphans\` — issues whose dependencies have been deleted

### Memory
- \`linear remember "insight" [--key <slug>]\` — persist a note
- \`linear recall <key>\` — retrieve a memory
- \`linear memories [search]\` — list / search memories
- \`linear forget <key>\` — delete a memory

### Important Rules

- Use Linear for approved durable work, dependencies, decisions, gates, and handoffs.
- Use the agent task system for reconstructable execution steps.
- Pass \`--json\` for programmatic use; default text output is human-readable.
- Check \`linear next\` before asking "what should I work on?".
- Do not create unrelated sibling or top-level issues from execution discoveries.
- Do not duplicate Git history, PR review threads, or CI logs into Linear.

**Tip:** If your agent supports Claude Code plugins, install \`/plugin install linear\` to get \`/linear:*\` slash commands and auto-loaded reference docs.

For more details, run \`linear prime\` or see USAGE.md.

${SESSION_COMPLETION}`;

/** Return the raw body text for a given profile (no markers). */
export function profileBody(profile: AgentsProfile): string {
  return profile === "full" ? FULL_BODY : MINIMAL_BODY;
}

/** First 8 hex chars of SHA-256 of the body. */
export function computeHash(body: string): string {
  const h = crypto.createHash("sha256").update(body, "utf8").digest("hex");
  return h.slice(0, 8);
}

/** Return the current hash for a profile (used for freshness detection). */
export function currentHash(profile: AgentsProfile): string {
  return computeHash(profileBody(profile));
}

/**
 * Render a complete managed section (begin marker + body + end marker)
 * for the given profile. Output ends with a single trailing newline so
 * the section can be concatenated cleanly into a larger AGENTS.md.
 */
export function renderSection(profile: AgentsProfile): string {
  const body = profileBody(profile);
  const hash = computeHash(body);
  const begin = `${AGENTS_BEGIN_PREFIX} v:${AGENTS_MARKER_VERSION} profile:${profile} hash:${hash} -->`;
  return `${begin}\n${body}\n${AGENTS_END_MARKER}\n`;
}

/** Parsed metadata from a BEGIN LINEAR INTEGRATION marker line. */
export interface SectionMeta {
  version?: number;
  profile?: AgentsProfile;
  hash?: string;
}

/**
 * Parse a single BEGIN LINEAR INTEGRATION marker line. Returns null if
 * the line isn't a recognized BEGIN marker. Returns an empty meta when
 * the marker is the legacy unversioned form (`<!-- BEGIN LINEAR
 * INTEGRATION -->`), which is treated as "needs upgrade".
 */
export function parseMarker(line: string): SectionMeta | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith(AGENTS_BEGIN_PREFIX)) return null;
  let inner = trimmed.slice(AGENTS_BEGIN_PREFIX.length);
  inner = inner.endsWith("-->") ? inner.slice(0, -3) : inner;
  inner = inner.trim();
  const meta: SectionMeta = {};
  if (inner === "") return meta;
  for (const part of inner.split(/\s+/)) {
    const idx = part.indexOf(":");
    if (idx < 0) continue;
    const k = part.slice(0, idx);
    const v = part.slice(idx + 1);
    switch (k) {
      case "v": {
        const n = Number.parseInt(v, 10);
        if (!Number.isNaN(n)) meta.version = n;
        break;
      }
      case "profile":
        if (v === "minimal" || v === "full") meta.profile = v;
        break;
      case "hash":
        meta.hash = v;
        break;
      default:
        // Ignore unknown keys for forward compatibility.
        break;
    }
  }
  return meta;
}

/** Locate the managed section bounds in a file's contents. */
export interface SectionBounds {
  /** Byte offset of the start of the BEGIN marker line. */
  begin: number;
  /** Byte offset one past the END marker line's `-->`. */
  end: number;
  /** Raw BEGIN line (no trailing newline). */
  beginLine: string;
}

/** Find the managed section in content; returns null when absent. */
export function findSection(content: string): SectionBounds | null {
  const beginIdx = content.indexOf(AGENTS_BEGIN_PREFIX);
  if (beginIdx < 0) return null;
  const endIdx = content.indexOf(AGENTS_END_MARKER, beginIdx);
  if (endIdx < 0) return null;
  let nlIdx = content.indexOf("\n", beginIdx);
  if (nlIdx < 0) nlIdx = content.length;
  const beginLine = content.slice(beginIdx, nlIdx);
  const end = endIdx + AGENTS_END_MARKER.length;
  return { begin: beginIdx, end, beginLine };
}

export interface UpsertOutcome {
  /** Final file contents after the upsert. */
  next: string;
  /**
   * - "created"   — file did not exist before, full template written
   * - "appended"  — file existed without a managed block, body appended
   * - "replaced"  — managed block existed and content changed
   * - "current"   — managed block existed and is already up to date
   * - "preserved" — file already carries the full profile and a downgrade
   *                 to minimal was requested; full is preserved.
   */
  action: "created" | "appended" | "replaced" | "current" | "preserved";
  /** Effective profile written (may differ from requested if preserved). */
  profile: AgentsProfile;
}

/**
 * Upsert an AGENTS.md managed block into existing content.
 *
 * - If no content exists, returns a freshly rendered section.
 * - If content exists without our markers, appends the section.
 * - If content exists with our markers, replaces the block in place
 *   (unless already current per the marker's hash + profile metadata).
 * - Profile-preservation rule: when the existing block is `full` and a
 *   `minimal` re-run is requested, keep `full` to avoid information loss.
 */
export function upsertSection(
  content: string | null,
  requestedProfile: AgentsProfile,
): UpsertOutcome {
  if (content === null || content === "") {
    const rendered = renderSection(requestedProfile);
    return { next: rendered, action: "created", profile: requestedProfile };
  }

  const bounds = findSection(content);
  if (!bounds) {
    // No managed block — append (one blank line of separator).
    const base = content.endsWith("\n") ? content : `${content}\n`;
    const rendered = renderSection(requestedProfile);
    return {
      next: `${base}\n${rendered}`,
      action: "appended",
      profile: requestedProfile,
    };
  }

  // Existing managed block — decide effective profile.
  const existing = parseMarker(bounds.beginLine);
  let effective = requestedProfile;
  if (existing?.profile === "full" && requestedProfile === "minimal") {
    effective = "full";
  }

  // Already current? (Same profile + same hash.)
  if (
    existing?.profile === effective &&
    existing?.hash === currentHash(effective)
  ) {
    return {
      next: content,
      action: effective !== requestedProfile ? "preserved" : "current",
      profile: effective,
    };
  }

  const rendered = renderSection(effective);
  // Strip exactly one trailing newline after the END marker before
  // splicing so the replaced block lines up with the surrounding
  // content.
  let end = bounds.end;
  if (end < content.length && content[end] === "\n") end += 1;
  const next = content.slice(0, bounds.begin) + rendered + content.slice(end);
  return {
    next,
    action: effective !== requestedProfile ? "preserved" : "replaced",
    profile: effective,
  };
}
