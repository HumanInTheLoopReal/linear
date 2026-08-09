/**
 * The per-type section contract, and the single resolver that answers "which
 * sections must an issue of type T contain?".
 *
 * Two ingredients compose that answer:
 *
 *   1. The active create template (`template-service`) supplies the UNIVERSAL
 *      sections — the framing and verification headings every type needs, plus
 *      one type-specific SLOT. In the built-in default template those are
 *      `## Context`, `## Acceptance Criteria` (the slot) and `## Test Plan`.
 *      They come from the template MARKDOWN, so a repo that renames its
 *      verification section to `## Test` edits its template and every type
 *      follows; no universal heading is hardcoded per type.
 *   2. {@link REQUIRED_SECTIONS_BY_TYPE} supplies the sections unique to the
 *      type, which are substituted into that slot. A repo can replace any type's
 *      entry through the `template.required-sections-by-type` config key, so a
 *      workspace whose ADRs (say) have a different shape does not need the CLI's
 *      generic defaults to change.
 *
 * So for the default template, with no per-type overrides configured:
 *
 *   epic     → ## Context · ## Success Criteria · ## Test Plan
 *   task     → ## Context · ## Acceptance Criteria · ## Test Plan
 *   chore    → ## Context · ## Acceptance Criteria · ## Test Plan
 *   bug      → ## Context · ## Steps to Reproduce · ## Acceptance Criteria · ## Test Plan
 *   decision → ## Context · ## Decision · ## Consequences · ## Alternatives · ## Revisit when · ## Test Plan
 *   spike    → ## Context · ## Goal · ## Findings · ## Test Plan
 *
 * A type that genuinely has nothing to verify declares that in config
 * (`"exempt": ["## Test Plan"]`), naming the heading its own template uses.
 *
 * `linear issues create` and `linear issues lint` both go through
 * {@link resolveRequiredSections}, so the gate can never demand a section the
 * lint does not, or vice versa.
 *
 * Linear has no first-class issue type; we derive type from the first
 * `type:<value>` label on each issue (Linear-Hack). An issue with no `type:*`
 * label is "untyped": the lint skips it entirely, and the create gate holds it
 * to the template verbatim (slot included).
 */

import type { GraphQLClient } from "../client/graphql-client.js";
import { replaceSection } from "../common/markdown-sections.js";
import {
  headingNeedle,
  type RequiredSection,
  type TypeSectionSpec,
  validateCreateDescription,
} from "../common/required-sections.js";
import { findEmptySections } from "../common/section-shape.js";
import {
  GetIssueForLintDocument,
  type GetIssueForLintQuery,
  type IssueFilter,
  type IssueLintFieldsFragment,
  ListIssuesForLintDocument,
  type ListIssuesForLintQuery,
} from "../gql/graphql.js";
import {
  resolveCreateSections,
  resolveTypeSections,
} from "./template-service.js";

/**
 * The type-specific MIDDLE sections only. No entry here names a universal
 * heading — not `## Context`, not the template's verification section — because
 * those are the template's to name, and hardcoding them would mean a repo that
 * calls its verification section `## Test` instead of `## Test Plan` could not
 * rename it by editing its template.
 *
 * A repo replaces any entry through `template.required-sections-by-type`, whose
 * `exempt` field is where "this type needs no verification section" belongs: the
 * repo knows what its template calls that section, and the CLI does not.
 */
/**
 * The outcome section every type that lands a product change carries. Shared so
 * a task, a bug fix, and a chore are held to one standard: maintenance work has
 * observable outcomes exactly like feature work does, and a type that asks for
 * none produces tickets nobody can grade.
 */
const ACCEPTANCE_CRITERIA: RequiredSection = {
  heading: "## Acceptance Criteria",
  hint: "What is TRUE when this is done, never how it was built. One checkbox per claim, each markable pass or fail on its own",
};

export const REQUIRED_SECTIONS_BY_TYPE: Record<string, TypeSectionSpec> = {
  bug: {
    sections: [
      {
        heading: "## Steps to Reproduce",
        hint: "The shortest path to seeing the failure, starting from a state a reader can reach",
      },
      ACCEPTANCE_CRITERIA,
    ],
  },
  task: { sections: [ACCEPTANCE_CRITERIA] },
  feature: { sections: [ACCEPTANCE_CRITERIA] },
  story: { sections: [ACCEPTANCE_CRITERIA] },
  chore: { sections: [ACCEPTANCE_CRITERIA] },
  epic: {
    sections: [
      {
        heading: "## Success Criteria",
        hint: "The outcome this area delivers, one level above its children. Every child task moves one of these; none of them completes it alone",
      },
    ],
  },
  decision: {
    sections: [
      {
        heading: "## Decision",
        hint: "One sentence, imperative: what was decided",
      },
      {
        heading: "## Consequences",
        hint: "What gets easier, what gets harder, and what this defers",
      },
      {
        heading: "## Alternatives",
        hint: "Each option considered and why it was not chosen, one line each",
      },
      {
        heading: "## Revisit when",
        hint: "The concrete trigger that reopens this decision",
      },
    ],
  },
  spike: {
    sections: [
      {
        heading: "## Goal",
        hint: "The question this answers, and what becomes decidable once it is answered",
      },
      {
        heading: "## Findings",
        hint: "What was learned, and what it rules in or out (fill in when complete)",
      },
    ],
  },
};

const EMPTY_SPEC: TypeSectionSpec = { sections: [] };

/**
 * The resolved configuration the contract is composed from. Read once per
 * command run and threaded through, so a bulk lint over hundreds of issues does
 * not re-read config per issue (and cannot repeat a malformed-config warning
 * hundreds of times).
 */
export interface SectionContext {
  /** Universal sections, in template order. */
  universal: RequiredSection[];
  /** Per-type specs: config overrides layered over the built-in map. */
  specs: Record<string, TypeSectionSpec>;
  /** Types whose spec came from config rather than the built-in map. */
  overridden: ReadonlySet<string>;
  /**
   * Every heading some type claims as its own. A template heading in this set is
   * the type-specific slot, so it is replaced rather than required as-is — that
   * is what stops an epic from being asked for `## Acceptance Criteria` just
   * because the template lists it.
   */
  slotHeadings: ReadonlySet<string>;
}

/**
 * Read the template and the per-type overrides, and layer them: a configured
 * type REPLACES its built-in spec outright (`exempt` included), any type the
 * config does not mention keeps the built-in one.
 */
export function resolveSectionContext(env?: NodeJS.ProcessEnv): SectionContext {
  const { overrides } = resolveTypeSections(env);
  const specs: Record<string, TypeSectionSpec> = {
    ...REQUIRED_SECTIONS_BY_TYPE,
    ...overrides,
  };
  return {
    universal: resolveCreateSections(env),
    specs,
    overridden: new Set(Object.keys(overrides)),
    slotHeadings: new Set(
      Object.values(specs).flatMap((spec) =>
        spec.sections.map((s) => headingNeedle(s.heading)),
      ),
    ),
  };
}

/**
 * Compose one type's contract. Split out from {@link resolveRequiredSections} so
 * a bulk lint resolves every issue through exactly the same logic off a single
 * config read.
 *
 * A template with no type-specific slot (say `## Context` + `## Test Plan`) is
 * still valid: the type's own sections are appended after the universal ones.
 */
function composeRequiredSections(
  type: string | null | undefined,
  ctx: SectionContext,
): RequiredSection[] {
  if (!type) return ctx.universal;

  const spec = ctx.specs[type] ?? EMPTY_SPEC;
  const exempt = new Set((spec.exempt ?? []).map(headingNeedle));
  const out: RequiredSection[] = [];
  let slotFilled = false;

  for (const section of ctx.universal) {
    const needle = headingNeedle(section.heading);
    if (ctx.slotHeadings.has(needle)) {
      if (!slotFilled) {
        out.push(...spec.sections);
        slotFilled = true;
      }
      continue;
    }
    if (exempt.has(needle)) continue;
    out.push(section);
  }
  if (!slotFilled) out.push(...spec.sections);

  return out;
}

/**
 * THE resolver: the sections an issue of `type` must contain, in the order they
 * should appear. Pass `null`/`undefined` for an issue with no `type:*` label,
 * which yields the template verbatim.
 *
 * Reads the active template and per-type overrides, so a per-repo config changes
 * what the create gate and the lint demand together, never one without the
 * other.
 */
export function resolveRequiredSections(
  type: string | null | undefined,
  env?: NodeJS.ProcessEnv,
): RequiredSection[] {
  return composeRequiredSections(type, resolveSectionContext(env));
}

/**
 * The effective contract for every type the CLI or the config knows about, for
 * `template show`. `overridden` marks the types whose spec came from config.
 */
export function resolveTypeRequirements(
  knownTypes: string[],
  env?: NodeJS.ProcessEnv,
): Array<{ type: string; sections: string[]; overridden: boolean }> {
  const ctx = resolveSectionContext(env);
  const types = [...new Set([...knownTypes, ...Object.keys(ctx.specs)])];
  return types.map((type) => ({
    type,
    sections: composeRequiredSections(type, ctx).map((s) => s.heading),
    overridden: ctx.overridden.has(type),
  }));
}

export interface LintResult {
  id: string;
  identifier: string | null;
  title: string;
  type: string;
  /** Required headings the description does not contain at all. */
  missing: string[];
  /** Required headings that are present but carry no content. */
  empty: string[];
  warnings: number;
}

const TYPE_PREFIX = "type:";

export function deriveTypeFromLabels(
  labels: Array<{ name: string }>,
): string | null {
  for (const l of labels) {
    if (l.name.startsWith(TYPE_PREFIX)) {
      return l.name.slice(TYPE_PREFIX.length);
    }
  }
  return null;
}

/** Lint against an already-resolved section context (bulk-run path). */
function lintIssueAgainst(
  issue: IssueLintFieldsFragment,
  ctx: SectionContext,
): LintResult | null {
  const type = deriveTypeFromLabels(issue.labels.nodes) ?? "";
  if (type === "") return null;

  const required = composeRequiredSections(type, ctx);
  if (required.length === 0) return null;

  // Presence and emptiness together, because the create gate refuses both. A
  // lint that only counted headings would call an issue clean that `issues
  // create` would not accept — including the skeletons `--fix` itself appends.
  const description = issue.description ?? "";
  const missing = validateCreateDescription(description, required);
  const empty = findEmptySections(description, required).filter(
    (heading: string) => !missing.includes(heading),
  );
  if (missing.length === 0 && empty.length === 0) return null;

  return {
    id: issue.id,
    identifier: issue.identifier ?? null,
    title: issue.title,
    type,
    missing,
    empty,
    warnings: missing.length + empty.length,
  };
}

/**
 * Run the section check against a single issue.
 * Returns `null` if the issue has no warnings (passes).
 */
export function lintIssue(
  issue: IssueLintFieldsFragment,
  env?: NodeJS.ProcessEnv,
): LintResult | null {
  return lintIssueAgainst(issue, resolveSectionContext(env));
}

export interface LintSummary {
  total: number;
  issues: number;
  results: LintResult[];
}

export function buildLintSummary(
  issues: IssueLintFieldsFragment[],
  env?: NodeJS.ProcessEnv,
): LintSummary {
  const ctx = resolveSectionContext(env);
  const results: LintResult[] = [];
  let total = 0;
  for (const issue of issues) {
    const r = lintIssueAgainst(issue, ctx);
    if (r) {
      results.push(r);
      total += r.warnings;
    }
  }
  return { total, issues: results.length, results };
}

/**
 * Resolve the missing heading strings reported by {@link lintIssue} back to
 * their full {@link RequiredSection} (heading + hint) for the given type, so
 * `--fix` can inject a hinted placeholder rather than a bare heading.
 */
export function sectionsForType(
  type: string,
  headings: string[],
  env?: NodeJS.ProcessEnv,
): RequiredSection[] {
  return pickSections(resolveRequiredSections(type, env), headings);
}

function pickSections(
  available: RequiredSection[],
  headings: string[],
): RequiredSection[] {
  const out: RequiredSection[] = [];
  for (const heading of headings) {
    const section = available.find((s) => s.heading === heading);
    if (section) out.push(section);
  }
  return out;
}

/**
 * Append placeholder skeletons for the absent sections to an existing
 * description, preserving everything already there. Uses {@link replaceSection}
 * so a heading that somehow already exists is left untouched (idempotent).
 */
export function appendMissingSections(
  description: string,
  sections: RequiredSection[],
): string {
  let out = description ?? "";
  for (const s of sections) {
    out = replaceSection(out, s.heading, `<!-- ${s.hint} -->`);
  }
  return out;
}

/** One issue's planned `--fix`: the headings added + the rewritten body. */
export interface LintFix {
  id: string;
  identifier: string | null;
  title: string;
  type: string;
  added: string[];
  description: string;
}

/**
 * Build the description rewrites for every issue that the lint flags as missing
 * sections (lin-xn2c). Pure apart from reading the active contract: produces the
 * planned new descriptions; the command layer decides whether to apply them (so
 * `--fix` can be combined with a dry-run preview later without changing this
 * code).
 */
export function buildLintFixes(
  issues: IssueLintFieldsFragment[],
  env?: NodeJS.ProcessEnv,
): LintFix[] {
  const ctx = resolveSectionContext(env);
  const fixes: LintFix[] = [];
  for (const issue of issues) {
    const r = lintIssueAgainst(issue, ctx);
    if (!r) continue;
    const sections = pickSections(
      composeRequiredSections(r.type, ctx),
      r.missing,
    );
    if (sections.length === 0) continue;
    fixes.push({
      id: r.id,
      identifier: r.identifier,
      title: r.title,
      type: r.type,
      added: sections.map((s) => s.heading),
      description: appendMissingSections(issue.description ?? "", sections),
    });
  }
  return fixes;
}

export async function getIssueForLint(
  client: GraphQLClient,
  issueId: string,
): Promise<IssueLintFieldsFragment> {
  const result = await client.request<GetIssueForLintQuery>(
    GetIssueForLintDocument,
    { id: issueId },
  );
  if (!result.issue) {
    throw new Error(`issue not found: ${issueId}`);
  }
  return result.issue;
}

export async function fetchIssuesForLint(
  client: GraphQLClient,
  filter: IssueFilter | undefined,
): Promise<IssueLintFieldsFragment[]> {
  const out: IssueLintFieldsFragment[] = [];
  let after: string | undefined;
  let hasNext = true;
  while (hasNext) {
    const res = await client.request<ListIssuesForLintQuery>(
      ListIssuesForLintDocument,
      { first: 100, after, filter },
    );
    out.push(...res.issues.nodes);
    hasNext = res.issues.pageInfo.hasNextPage;
    after = res.issues.pageInfo.endCursor ?? undefined;
    if (!after) break;
  }
  return out;
}
