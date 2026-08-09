import { getConfig } from "../common/config-store.js";
import { fatalError } from "../common/errors.js";
import {
  type RequiredSection,
  renderCreateValidationError,
  validateCreateDescription,
} from "../common/required-sections.js";
import {
  findEmptySections,
  normalizeSectionShape,
  renderShapeNotice,
} from "../common/section-shape.js";
import { resolveRequiredSections } from "../services/lint-service.js";

export type CreateValidationMode = "off" | "warn" | "error";

/** Resolve the effective create-time validation mode for every create surface. */
export function resolveCreateValidationMode(
  validateFlag: boolean | undefined,
  env?: NodeJS.ProcessEnv,
): CreateValidationMode {
  if (validateFlag === false) return "off";
  if (validateFlag === true) return "error";

  const configured = getConfig("validation.on-create", env).value;
  if (configured === "off" || configured === "warn" || configured === "error") {
    return configured;
  }
  return "error";
}

/**
 * Hold one description to the template, repairing what has a single correct
 * fix and reporting what does not.
 *
 * Returns the description to actually create with — identical to the input
 * unless a section's body was reshaped. Callers MUST use the return value;
 * ignoring it silently discards the repair.
 *
 * Split from {@link enforceCreateValidation} so the epic path, which validates
 * a parent and its children together and reports them in one message, gets the
 * same repair and the same problem list without duplicating either.
 */
export function checkAgainstTemplate(
  description: string | undefined,
  sections: RequiredSection[],
): { description: string; problems: string[]; notice: string | null } {
  const missing = validateCreateDescription(description ?? "", sections);
  const shaped = normalizeSectionShape(description ?? "", sections);
  const empty = findEmptySections(shaped.description, sections);

  const problems: string[] = [];
  if (missing.length > 0) problems.push(...missing);
  for (const heading of empty) {
    if (!missing.includes(heading)) problems.push(heading);
  }

  return {
    description: shaped.description,
    problems,
    notice:
      shaped.changes.length > 0 ? renderShapeNotice(shaped.changes) : null,
  };
}

/**
 * Apply the shared create-time quality gate before a command performs writes,
 * and return the description to create with.
 *
 * Callers pass the issue's type (the normalized `--type` value, or `null` for an
 * untyped issue) and nothing else: the required sections are resolved from it by
 * `resolveRequiredSections`, the same resolver `issues lint` uses, so a body the
 * gate accepts is a body the lint accepts.
 *
 * Two failure kinds, treated differently on purpose. A body whose criteria are
 * bare lines is REPAIRED into markdown and reported on stderr, because there is
 * exactly one right answer and making the agent guess it costs a round-trip. A
 * required section that is missing, or present with nothing under it, is
 * REFUSED, because no formatting rule invents content that was never written.
 */
export function enforceCreateValidation(
  description: string | undefined,
  validateFlag: boolean | undefined,
  type?: string | null,
  env?: NodeJS.ProcessEnv,
): string {
  const mode = resolveCreateValidationMode(validateFlag, env);
  if (mode === "off") return description ?? "";

  const sections = resolveRequiredSections(type, env);
  const checked = checkAgainstTemplate(description, sections);

  if (checked.notice) process.stderr.write(`✎ ${checked.notice}\n`);
  if (checked.problems.length === 0) return checked.description;

  const body = renderCreateValidationError(checked.problems, sections);
  if (mode === "error") {
    throw fatalError(body, {
      hint: "fill in the sections above, or pass --no-validate (or set `linear config set validation.on-create off`) to skip",
    });
  }
  process.stderr.write(`⚠ ${body}\n`);
  return checked.description;
}
