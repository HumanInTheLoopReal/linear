/**
 * Issue-template resolution for the create-time quality gate. (lin-0nh0)
 *
 * The gate that blocks `linear issues create` (and, once the bypass is closed,
 * the epic/batch bulk paths) checks that an issue description contains a set of
 * required markdown section headings. Historically that set was the hardcoded
 * `REQUIRED_CREATE_SECTIONS` constant. This module turns it into *configurable
 * data*: a markdown **template** stored under the `template.create` config key
 * (per-user global, with an optional per-repo override), whose `#` headings
 * define the required sections.
 *
 * The template supplies the UNIVERSAL half of the contract. Which of its
 * sections a given issue type actually needs is decided by
 * `resolveRequiredSections` in `lint-service`, which substitutes the
 * type-specific slot; this module never looks at issue type.
 *
 * Resolution precedence mirrors `config-store` (local > global > built-in
 * default). When nothing is configured — or a configured template is malformed
 * (no headings) — we fall back to the built-in default, which is byte-for-byte
 * the previous hardcoded gate, so behavior is unchanged until a template is set.
 *
 * Pure except for `resolveCreateTemplate`, which reads config + may emit a
 * single stderr warning when a stored template is unusable. The gate is never
 * silently disabled by a bad template.
 */

import {
  type ConfigLayer,
  getConfig,
  readAll,
  setConfig,
  unsetConfig,
} from "../common/config-store.js";
import {
  REQUIRED_CREATE_SECTIONS,
  type RequiredSection,
  renderSkeleton,
  type TypeSectionSpec,
} from "../common/required-sections.js";
import { isSectionStyle, SECTION_STYLES } from "../common/section-shape.js";

/** Config key holding the active create-time issue template (markdown). */
export const TEMPLATE_CREATE_KEY = "template.create";

/**
 * Built-in default template — the markdown rendering of the canonical
 * `REQUIRED_CREATE_SECTIONS`. `template set --from-default` seeds from this,
 * and an unset / malformed `template.create` resolves to it. By construction
 * `requiredSectionsFromTemplate(DEFAULT_CREATE_TEMPLATE)` reproduces
 * `REQUIRED_CREATE_SECTIONS` (asserted in tests), so the gate is identical to
 * its pre-template behavior when no custom template exists.
 */
export const DEFAULT_CREATE_TEMPLATE = renderSkeleton(REQUIRED_CREATE_SECTIONS);

const HEADING_RE = /^#{1,6}\s+\S/;
const COMMENT_RE = /^<!--\s*(.*?)\s*-->$/;

/**
 * Derive the required-section list from a template's markdown headings.
 *
 * Every line that is a markdown ATX heading (`#`..`######` followed by text)
 * becomes a `RequiredSection` whose `heading` is the trimmed heading line
 * (e.g. `## Context`). If the first non-blank line after a heading is an HTML
 * comment (`<!-- ... -->`), its inner text becomes the section `hint` — the
 * exact shape `renderSkeleton` emits, so a `--from-default` template round-trips
 * its hints. Headings without a following comment get an empty hint.
 *
 * Matching downstream (in `validateCreateDescription`) stays lenient,
 * case-insensitive substring on the heading text, so this only needs to capture
 * the heading + hint, not enforce strict structure.
 */
export function requiredSectionsFromTemplate(
  template: string,
): RequiredSection[] {
  const lines = (template ?? "").replace(/\r\n/g, "\n").split("\n");
  const sections: RequiredSection[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!HEADING_RE.test(lines[i])) continue;
    const heading = lines[i].trim();
    let hint = "";
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === "") j++;
    if (j < lines.length) {
      const c = lines[j].trim().match(COMMENT_RE);
      if (c) hint = c[1].trim();
    }
    sections.push({ heading, hint });
  }
  return sections;
}

export type TemplateSource = "local" | "global" | "default";

export interface ResolvedCreateTemplate {
  /** The active template markdown. */
  template: string;
  /** Which layer it came from. */
  source: TemplateSource;
  /** Required sections parsed from the template (the gate's input). */
  sections: RequiredSection[];
}

/**
 * Resolve the active create-time template: per-repo `local` overrides per-user
 * `global`, which overrides the built-in default. A configured-but-malformed
 * template (no headings) would disable the gate, so it is rejected at read time
 * with a one-line stderr warning and the default is used instead.
 */
export function resolveCreateTemplate(
  env?: NodeJS.ProcessEnv,
): ResolvedCreateTemplate {
  const r = getConfig(TEMPLATE_CREATE_KEY, env);
  if (r.found && r.value && r.value.trim() !== "") {
    const sections = requiredSectionsFromTemplate(r.value);
    if (sections.length > 0) {
      const source: TemplateSource =
        r.source === "local" || r.source === "global" ? r.source : "global";
      return { template: r.value, source, sections };
    }
    process.stderr.write(
      "linear: template.create has no markdown headings; using the built-in default template.\n",
    );
  }
  return {
    template: DEFAULT_CREATE_TEMPLATE,
    source: "default",
    sections: REQUIRED_CREATE_SECTIONS,
  };
}

/** Convenience: the active template's required sections (the gate's input). */
export function resolveCreateSections(
  env?: NodeJS.ProcessEnv,
): RequiredSection[] {
  return resolveCreateTemplate(env).sections;
}

/**
 * Config key holding per-type overrides of the type-specific section block, as
 * a JSON object keyed by issue type:
 *
 *   {
 *     "decision": {
 *       "sections": [
 *         { "heading": "## Decision", "hint": "one sentence, imperative" },
 *         { "heading": "## Consequences", "style": "bullets" },
 *         "## Alternatives"
 *       ],
 *       "exempt": ["## Test Plan"]
 *     }
 *   }
 *
 * A type's value may be the `sections` array on its own when it needs no
 * exemptions, and a section may be a bare heading string when it needs neither
 * hint nor style. `style` is one of `prose`, `bullets`, or `checklist` and
 * overrides the default `section-shape` picks from the heading text; set it only
 * when a familiar heading means something unusual here.
 *
 * An entry REPLACES that type's built-in spec outright, `exempt` included, so
 * the effective contract is readable from the config alone; the universal
 * template sections still apply on top.
 */
export const TEMPLATE_SECTIONS_BY_TYPE_KEY =
  "template.required-sections-by-type";

function parseSectionEntry(entry: unknown, where: string): RequiredSection {
  if (typeof entry === "string") {
    if (entry.trim() === "") throw new Error(`${where}: empty heading`);
    return { heading: entry.trim(), hint: "" };
  }
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const { heading, hint, style } = entry as {
      heading?: unknown;
      hint?: unknown;
      style?: unknown;
    };
    if (typeof heading !== "string" || heading.trim() === "") {
      throw new Error(`${where}: each section needs a non-empty "heading"`);
    }
    if (hint !== undefined && typeof hint !== "string") {
      throw new Error(`${where}: "hint" must be a string`);
    }
    if (style !== undefined && !isSectionStyle(style)) {
      throw new Error(
        `${where}: "style" must be one of ${SECTION_STYLES.join(", ")}`,
      );
    }
    const section: RequiredSection = {
      heading: heading.trim(),
      hint: (hint ?? "").trim(),
    };
    if (style !== undefined) section.style = style;
    return section;
  }
  throw new Error(
    `${where}: expected a heading string or { heading, hint } object`,
  );
}

function parseSpec(value: unknown, type: string): TypeSectionSpec {
  const where = `${TEMPLATE_SECTIONS_BY_TYPE_KEY}.${type}`;
  const raw = Array.isArray(value) ? { sections: value } : value;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(
      `${where}: expected an array of sections or { sections, exempt }`,
    );
  }
  const { sections, exempt } = raw as { sections?: unknown; exempt?: unknown };
  if (!Array.isArray(sections)) {
    throw new Error(`${where}: "sections" must be an array`);
  }
  if (exempt !== undefined && !Array.isArray(exempt)) {
    throw new Error(`${where}: "exempt" must be an array of headings`);
  }
  const spec: TypeSectionSpec = {
    sections: sections.map((s) => parseSectionEntry(s, where)),
  };
  if (exempt !== undefined) {
    spec.exempt = exempt.map((h) => {
      if (typeof h !== "string" || h.trim() === "") {
        throw new Error(`${where}: "exempt" entries must be headings`);
      }
      return h.trim();
    });
  }
  return spec;
}

/**
 * Parse the per-type override map. Throws with a pointed message on a malformed
 * shape so the caller can warn and fall back rather than silently enforcing a
 * contract nobody wrote.
 */
export function typeSectionSpecsFromJson(
  raw: string,
): Record<string, TypeSectionSpec> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`invalid JSON: ${(err as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("expected a JSON object keyed by issue type");
  }
  const out: Record<string, TypeSectionSpec> = {};
  for (const [type, value] of Object.entries(parsed)) {
    out[type.trim().toLowerCase()] = parseSpec(value, type);
  }
  return out;
}

/**
 * Serialize a per-type override map back to the config value.
 *
 * Compact rather than indented: the config file is machine-owned, and
 * `linear template show` is where a human reads the effective contract.
 * A section with neither hint nor style collapses to its heading string, which
 * is the shape a hand-written override usually takes.
 */
export function typeSectionSpecsToJson(
  specs: Record<string, TypeSectionSpec>,
): string {
  const out: Record<string, unknown> = {};
  for (const [type, spec] of Object.entries(specs)) {
    const sections = spec.sections.map((s) =>
      s.hint === "" && s.style === undefined
        ? s.heading
        : {
            heading: s.heading,
            ...(s.hint ? { hint: s.hint } : {}),
            ...(s.style ? { style: s.style } : {}),
          },
    );
    out[type] = spec.exempt?.length
      ? { sections, exempt: spec.exempt }
      : { sections };
  }
  return JSON.stringify(out);
}

/**
 * The per-type overrides written at ONE layer, ignoring every other layer.
 *
 * `resolveTypeSections` answers "what is in force"; this answers "what is
 * written here", which is what a read-modify-write of a single type's entry
 * needs. Editing the resolved view would silently copy the global layer's
 * entries into the local file.
 *
 * A malformed stored value throws, so `template set --type` refuses rather than
 * overwriting a file it could not read.
 */
export function readTypeSpecsAtLayer(
  layer: ConfigLayer,
): Record<string, TypeSectionSpec> {
  const raw = readAll(layer)[TEMPLATE_SECTIONS_BY_TYPE_KEY];
  if (!raw || raw.trim() === "") return {};
  return typeSectionSpecsFromJson(raw);
}

/** Write one type's spec at one layer, leaving every other type's entry alone. */
export function setTypeSpec(
  type: string,
  spec: TypeSectionSpec,
  layer: ConfigLayer,
): void {
  const specs = readTypeSpecsAtLayer(layer);
  specs[type.trim().toLowerCase()] = spec;
  setConfig(TEMPLATE_SECTIONS_BY_TYPE_KEY, typeSectionSpecsToJson(specs), {
    layer,
  });
}

/**
 * Remove one type's override at one layer. Returns whether anything was
 * removed. The whole key is dropped once its last entry goes, so an emptied
 * override leaves no `{}` behind to suggest a contract that is not there.
 */
export function unsetTypeSpec(type: string, layer: ConfigLayer): boolean {
  const specs = readTypeSpecsAtLayer(layer);
  const key = type.trim().toLowerCase();
  if (!(key in specs)) return false;
  delete specs[key];
  if (Object.keys(specs).length === 0) {
    unsetConfig(TEMPLATE_SECTIONS_BY_TYPE_KEY, { layer });
    return true;
  }
  setConfig(TEMPLATE_SECTIONS_BY_TYPE_KEY, typeSectionSpecsToJson(specs), {
    layer,
  });
  return true;
}

export interface ResolvedTypeSections {
  /** Per-type overrides, keyed by lower-cased type name (empty when unset). */
  overrides: Record<string, TypeSectionSpec>;
  /** Which layer they came from. */
  source: TemplateSource;
}

/**
 * Resolve the per-type overrides: per-repo `local` beats per-user `global`, and
 * an unset or malformed value means "no overrides" (the built-in specs stand).
 * A malformed value would silently change what every create and lint demands,
 * so it is reported on stderr rather than swallowed.
 */
export function resolveTypeSections(
  env?: NodeJS.ProcessEnv,
): ResolvedTypeSections {
  const r = getConfig(TEMPLATE_SECTIONS_BY_TYPE_KEY, env);
  if (r.found && r.value && r.value.trim() !== "") {
    try {
      const overrides = typeSectionSpecsFromJson(r.value);
      const source: TemplateSource =
        r.source === "local" || r.source === "global" ? r.source : "global";
      return { overrides, source };
    } catch (err) {
      process.stderr.write(
        `linear: ${TEMPLATE_SECTIONS_BY_TYPE_KEY} ignored (${(err as Error).message}); using the built-in per-type sections.\n`,
      );
    }
  }
  return { overrides: {}, source: "default" };
}
