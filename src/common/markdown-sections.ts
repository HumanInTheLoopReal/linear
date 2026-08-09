/**
 * Pure helpers for reading and writing named `## Heading` sections within
 * a markdown document. Used by the Linear-Hack convention that maps
 * `design` / `notes` / `acceptance_criteria` fields onto discrete
 * sections inside a Linear issue's description.
 *
 * "Section body" is everything between a `## Heading` line and the next
 * `## ` line (or EOF). Comparison is done on the trimmed heading so
 * surrounding whitespace is tolerated. Headings are case-sensitive.
 */

const SECTION_PREFIX = "## ";

function findHeadingIndex(lines: string[], heading: string): number {
  return lines.findIndex((line) => line.trimEnd() === heading);
}

function findNextSectionIndex(lines: string[], startIdx: number): number {
  for (let i = startIdx; i < lines.length; i++) {
    if (lines[i].startsWith(SECTION_PREFIX)) return i;
  }
  return lines.length;
}

/**
 * Return the body of the named section, trimmed. Empty string if the
 * section is absent or has no content.
 */
export function getSection(description: string, heading: string): string {
  const lines = description.split("\n");
  const headingIdx = findHeadingIndex(lines, heading);
  if (headingIdx === -1) return "";

  const nextIdx = findNextSectionIndex(lines, headingIdx + 1);
  return lines
    .slice(headingIdx + 1, nextIdx)
    .join("\n")
    .trim();
}

/**
 * Replace the body of the named section. Behavior matrix:
 *   - Section present, newBody non-empty → swap in the new body.
 *   - Section present, newBody empty → remove the heading and its body.
 *   - Section absent, newBody non-empty → append a new section at the end.
 *   - Section absent, newBody empty → no-op (return the original).
 *
 * Surrounding whitespace is normalised so we don't accumulate blank
 * lines after repeated edits.
 */
export function replaceSection(
  description: string,
  heading: string,
  newBody: string,
): string {
  const trimmedBody = newBody.trim();
  const lines = description.split("\n");
  const headingIdx = findHeadingIndex(lines, heading);

  if (headingIdx === -1) {
    if (trimmedBody.length === 0) return description;
    const base = description.trimEnd();
    if (base.length === 0) return `${heading}\n\n${trimmedBody}`;
    return `${base}\n\n${heading}\n\n${trimmedBody}`;
  }

  const nextIdx = findNextSectionIndex(lines, headingIdx + 1);
  const before = lines.slice(0, headingIdx).join("\n").trimEnd();
  const after = lines.slice(nextIdx).join("\n").trimStart();

  if (trimmedBody.length === 0) {
    if (before.length === 0 && after.length === 0) return "";
    if (before.length === 0) return after;
    if (after.length === 0) return before;
    return `${before}\n\n${after}`;
  }

  const middle = `${heading}\n\n${trimmedBody}`;
  if (before.length === 0 && after.length === 0) return middle;
  if (before.length === 0) return `${middle}\n\n${after}`;
  if (after.length === 0) return `${before}\n\n${middle}`;
  return `${before}\n\n${middle}\n\n${after}`;
}

/**
 * Append text to the named section's body, for the `--append-notes` flag.
 * When the section is absent it is
 * created; when present, the addition is joined to the existing body with a
 * blank-line separator. Here the body is rendered as markdown inside the issue
 * description, so a blank line is required to keep successive appends as distinct
 * paragraphs instead of soft-wrapping into one (a strictly better rendering,
 * never worse). Appending empty/whitespace text is a no-op.
 */
export function appendSection(
  description: string,
  heading: string,
  addition: string,
): string {
  const trimmed = addition.trim();
  if (trimmed.length === 0) return description;
  const existing = getSection(description, heading);
  const merged = existing.length === 0 ? trimmed : `${existing}\n\n${trimmed}`;
  return replaceSection(description, heading, merged);
}
