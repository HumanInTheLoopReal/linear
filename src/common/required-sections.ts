/**
 * Required-section vocabulary and the lenient heading matcher shared by every
 * surface that checks an issue body: the create-time quality gate, `issues
 * lint`, and the template resolver.
 *
 * This module deliberately holds no policy — it does not know which sections a
 * given issue type needs. `template-service` owns where the universal sections
 * come from (the configurable create template) and `lint-service` owns the
 * per-type contract; both depend on this module, which lets them depend on each
 * other's answers without an import cycle.
 */

/**
 * How a section's body is meant to be written. Declared here beside
 * `RequiredSection` rather than in `section-shape`, which owns the rules that
 * act on it, so the vocabulary module stays the one thing both depend on.
 */
export type SectionStyle = "prose" | "bullets" | "checklist";

export interface RequiredSection {
  heading: string;
  hint: string;
  /**
   * Overrides the default style for this heading (see `section-shape`). Set it
   * only when a workspace means something unusual by a familiar heading;
   * leaving it unset is what lets `## Acceptance Criteria` behave the same way
   * whether it came from the built-in defaults, a repo's template markdown, or
   * a per-type override.
   */
  style?: SectionStyle;
}

/**
 * The type-specific half of one issue type's section contract: the sections
 * substituted into the template's type slot, plus any universal heading this
 * type structurally cannot satisfy.
 *
 * Built-in values live in `REQUIRED_SECTIONS_BY_TYPE` (lint-service); a repo can
 * replace a type's spec through `template.required-sections-by-type`
 * (template-service). Both feed the one resolver.
 */
export interface TypeSectionSpec {
  /** Sections unique to this type, substituted into the template's slot. */
  sections: RequiredSection[];
  /**
   * Universal (template-owned) headings this type does not require. A decision
   * record and a spike land no product change, so neither carries a test plan;
   * matching is lenient, so a template that names its verification section
   * something else simply keeps it.
   */
  exempt?: string[];
}

/**
 * Sections of the built-in default create template: the universal framing and
 * verification sections plus the type-specific slot, which for the default
 * template is `## Acceptance Criteria`.
 *
 * `resolveRequiredSections` substitutes the slot with whatever the issue's type
 * actually requires (`## Success Criteria` for an epic, `## Goal` + `##
 * Findings` for a spike, nothing for a chore), so this list is the contract for
 * an untyped issue only.
 *
 *   - Context             — why this work exists / background.
 *   - Acceptance Criteria — what "done" looks like (the type-specific slot).
 *   - Test Plan           — how the change will be verified.
 */
export const REQUIRED_CREATE_SECTIONS: RequiredSection[] = [
  {
    heading: "## Context",
    hint: "Why this work exists and what it enables. Link upstream: the parent goal, a spec heading, or the path the work lands at",
  },
  {
    heading: "## Acceptance Criteria",
    hint: "What is TRUE when this is done, never how it was built. One checkbox per claim, each markable pass or fail on its own",
  },
  {
    heading: "## Test Plan",
    hint: "The command that must go green, or a named human action. Never 'verify it works'",
  },
];

/**
 * Strip the markdown heading prefix and lower-case, so a heading can be matched
 * anywhere in a (lower-cased) description and two headings can be compared
 * regardless of their `#` depth.
 */
export function headingNeedle(heading: string): string {
  return heading
    .replace(/^#+\s+/, "")
    .trim()
    .toLowerCase();
}

/**
 * Scan a description for the given required sections. Returns the list of
 * missing section headings (e.g. `["## Context", "## Test Plan"]`); an empty
 * array means the description satisfies the contract.
 *
 * Matching is case-insensitive substring on the heading text, so prose like
 * "Acceptance criteria: it works" counts the same as a real
 * `## Acceptance Criteria` heading. Every caller — create gate and lint alike —
 * goes through this function, so they cannot disagree about what "present"
 * means.
 */
export function validateCreateDescription(
  description: string,
  sections: RequiredSection[] = REQUIRED_CREATE_SECTIONS,
): string[] {
  const haystack = (description ?? "").toLowerCase();
  const missing: string[] = [];
  for (const section of sections) {
    if (!haystack.includes(headingNeedle(section.heading))) {
      missing.push(section.heading);
    }
  }
  return missing;
}

/**
 * Render a ready-to-paste markdown skeleton: each required section heading
 * followed by its one-line hint as an HTML comment. Shared by the create-time
 * teaching error, the built-in default template, and `issues lint --fix`, so
 * the same placeholder style is injected everywhere (lin-xn2c).
 */
export function renderSkeleton(
  sections: RequiredSection[] = REQUIRED_CREATE_SECTIONS,
): string {
  return sections
    .map((s) => (s.hint ? `${s.heading}\n\n<!-- ${s.hint} -->` : s.heading))
    .join("\n\n");
}

/**
 * Build the multi-line teaching error body shown when a create is blocked
 * (or warned). Lists each unsatisfied section with its hint, then prints the
 * paste-able skeleton.
 *
 * "Missing or empty" rather than "missing" because a heading with nothing under
 * it fails the same way and for the same reason: the section's content is what
 * the gate wants, and the heading alone was never the point.
 */
export function renderCreateValidationError(
  missing: string[],
  sections: RequiredSection[] = REQUIRED_CREATE_SECTIONS,
): string {
  const lines = ["required sections missing or empty:"];
  for (const heading of missing) {
    const section = sections.find((s) => s.heading === heading);
    const hint = section?.hint ? ` (${section.hint})` : "";
    lines.push(`  - ${heading}${hint}`);
  }
  lines.push("");
  lines.push("Add these sections to the description, e.g.:");
  lines.push("");
  lines.push(renderSkeleton(sections));
  return lines.join("\n");
}
