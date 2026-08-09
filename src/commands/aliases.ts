/**
 * Top-level command aliases — convenient shortcuts for common verbs.
 *
 * Lets users drive linear with short verbs instead of qualified paths:
 *   linear list           ≡  linear issues list
 *   linear show TES-1     ≡  linear issues read TES-1
 *   linear ready          ≡  linear next
 *   linear dep tree TES-1 ≡  linear depends tree TES-1
 *   linear label add ...  ≡  linear labels add ...
 *   linear defer TES-1    ≡  linear snooze TES-1
 *
 * Implemented as a pre-parse argv rewriter: `applyTopLevelAliases(process.argv)`
 * runs before Commander sees the args. It replaces only the FIRST positional
 * token (preserving any leading global options); subsequent tokens pass through
 * unchanged so subcommands and arguments still reach the real command.
 *
 * Additive — every existing qualified path (`linear issues list`, etc.)
 * keeps working.
 */

/**
 * Alias verb → linear command path (one or more tokens that will be spliced
 * in place of the alias verb). Keys MUST NOT collide with an existing linear
 * top-level command (the unit test compares against the real Commander tree).
 *
 * Verbs that already match a linear top-level command (`gate`, `swarm`,
 * `blocked`, `todo`, `batch`, `doctor`, `audit`, `preflight`, `orphans`,
 * `rules`, `info`, `where`, `setup`, `init`, `config`, `context`, `kv`,
 * `hooks`, `human`, `quickstart`, `prime`, `onboard`, `remember`, `recall`,
 * `memories`, `forget`, `edit`) need no alias and are intentionally absent.
 */
export const ALIASES: Readonly<Record<string, readonly string[]>> = {
  // Issues CRUD / read
  list: ["issues", "list"],
  show: ["issues", "read"],
  read: ["issues", "read"],
  create: ["issues", "create"],
  "create-form": ["issues", "create-form"],
  update: ["issues", "update"],
  close: ["issues", "close"],
  done: ["issues", "close"],
  reopen: ["issues", "reopen"],
  delete: ["issues", "delete"],
  archive: ["issues", "archive"],
  unarchive: ["issues", "unarchive"],
  children: ["issues", "children"],

  // Filter / search / quick-capture
  count: ["issues", "count"],
  search: ["issues", "search"],
  query: ["issues", "query"],
  q: ["issues", "q"],

  // Status / types / lifecycle
  status: ["issues", "status"],
  stats: ["issues", "status"],
  statuses: ["issues", "statuses"],
  types: ["issues", "types"],
  priority: ["issues", "priority"],
  state: ["issues", "state"],
  "set-state": ["issues", "set-state"],

  // Notes / single-tag
  note: ["issues", "note"],
  tag: ["issues", "tag"],

  // Description edit workflow (pull → edit file → push) and checklist
  // toggles. `tick`/`untick` are the guessable synonyms; `check` stays
  // unaliased at top level to avoid reading like a lint/doctor verb.
  pull: ["issues", "pull"],
  push: ["issues", "push"],
  tick: ["issues", "check"],
  untick: ["issues", "uncheck"],

  // Lint / diff / history / snapshots / stale
  lint: ["issues", "lint"],
  diff: ["issues", "diff"],
  history: ["issues", "history"],
  snapshot: ["issues", "snapshot"],
  stale: ["issues", "stale"],

  // Export / import / rename
  export: ["issues", "export"],
  // `import` is now a top-level command per
  // PROCESS.md decision D4, so it must NOT appear as an alias here — Commander
  // resolves the real command and the alias would never fire.
  rename: ["issues", "rename"],

  // Duplicates / supersede / ship
  duplicate: ["issues", "mark-duplicate"],
  "mark-duplicate": ["issues", "mark-duplicate"],
  duplicates: ["issues", "find-duplicates"],
  "find-duplicates": ["issues", "find-duplicates"],
  "find-dups": ["issues", "find-duplicates"],
  supersede: ["issues", "supersede"],
  ship: ["issues", "ship"],

  // Comments / discussion. A bare `linear comment <id> "text"` posts a
  // top-level comment on an issue. Both `linear comments create` and
  // `linear issues discuss` create a top-level discussion thread — the
  // former is a deprecated compatibility facade, the latter is canonical.
  // Map to the canonical path so users land on the long-term-supported verb.
  comment: ["issues", "discuss"],
  discuss: ["issues", "discuss"],
  discussions: ["issues", "discussions"],
  replies: ["issues", "replies"],
  reply: ["issues", "reply"],

  // Reactions
  react: ["issues", "react"],
  unreact: ["issues", "unreact"],

  // Epic helpers
  "epic-status": ["issues", "epic-status"],
  "close-eligible-epics": ["issues", "close-eligible-epics"],

  // Short verbs → canonical linear top-level commands
  ready: ["next"],
  defer: ["snooze"],
  undefer: ["wake"],

  // Singular short forms → plural subdomains (rest of argv passes through)
  dep: ["depends"],
  label: ["labels"],

  // Single-token redirect into a subdomain verb
  graph: ["depends", "graph"],
  link: ["depends", "add"],
};

/**
 * Root-level options on the linear program that consume a value via space
 * (e.g. `--api-token lin_api_...`). These must not be misread as a verb.
 * `--api-token=foo` is one token and needs no special handling.
 */
const VALUE_OPTIONS_WITH_SPACE: ReadonlySet<string> = new Set(["--api-token"]);

/**
 * Find the index of the first positional argument in argv, skipping any
 * leading global options. Returns -1 when argv has no positional token.
 */
function findFirstPositional(argv: readonly string[]): number {
  let i = 2;
  while (i < argv.length) {
    const tok = argv[i];
    if (!tok.startsWith("-")) return i;
    if (
      VALUE_OPTIONS_WITH_SPACE.has(tok) &&
      i + 1 < argv.length &&
      !argv[i + 1].startsWith("-")
    ) {
      i += 2;
      continue;
    }
    i += 1;
  }
  return -1;
}

/**
 * Recognized explicit values for the `--json` mode option. Tokens matching
 * one of these may follow a bare `--json`; everything else is treated as a
 * positional (subcommand or argument) and the `--json` is upgraded to the
 * `--json=auto` sentinel to prevent Commander from eagerly consuming it.
 */
const JSON_MODE_VALUES: ReadonlySet<string> = new Set(["pretty", "compact"]);

/**
 * Sentinel the rewriter substitutes for a bare `--json`. It preserves the
 * "no explicit mode chosen" intent through Commander so `resolveJsonMode`
 * can pick pretty (human) vs compact (agent mode) at output time — see
 * lin-g1hy. Rewriting to a concrete `--json=pretty` here would have baked
 * in pretty before agent detection ran.
 */
const JSON_AUTO_SENTINEL = "--json=auto";

/**
 * Stop Commander's optional-value parser from eating the next positional.
 * Commander's `--json [mode]` syntax eagerly consumes the next token unless
 * it starts with `-`. So `linear --json issues read X` parses with
 * `mode="issues"` and then complains about extra arguments. Pre-normalize:
 * if `--json` is followed by a token that isn't a known mode value (and
 * isn't a flag), rewrite it to `--json=auto` so Commander treats both
 * tokens correctly while leaving the mode unresolved. `--json=value` and
 * `--json pretty|compact` pass through.
 */
function normalizeJsonOption(argv: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i];
    if (tok !== "--json") {
      out.push(tok);
      continue;
    }
    const next = i + 1 < argv.length ? argv[i + 1] : undefined;
    if (
      next === undefined ||
      next.startsWith("-") ||
      !JSON_MODE_VALUES.has(next)
    ) {
      out.push(JSON_AUTO_SENTINEL);
      continue;
    }
    out.push(tok);
  }
  return out;
}

/**
 * Rewrite argv if its first positional matches an ALIASES key. Returns a
 * fresh array; argv is never mutated. Safe to call unconditionally — non-alias
 * verbs and arg-free invocations pass through unchanged. Also normalizes the
 * global `--json` option so bare `--json` does not eat the next positional.
 */
export function applyTopLevelAliases(argv: readonly string[]): string[] {
  const normalized = normalizeJsonOption(argv);
  const idx = findFirstPositional(normalized);
  if (idx < 0) return normalized;
  const verb = normalized[idx];
  const expansion = ALIASES[verb];
  if (!expansion) return normalized;
  return [
    ...normalized.slice(0, idx),
    ...expansion,
    ...normalized.slice(idx + 1),
  ];
}
