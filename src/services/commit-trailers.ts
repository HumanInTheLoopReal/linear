/**
 * Parse close-issue trailers out of a git commit message.
 *
 * Supports the Conventional Commits close keywords (`Closes`, `Fixes`,
 * `Resolves`) followed by a Linear issue identifier (`ENG-123`). Both the
 * keyword and the optional `#` prefix are case-insensitive; multiple
 * identifiers per keyword (comma- or space-separated) are extracted. The
 * parser is intentionally permissive about line position — keywords are
 * matched anywhere in the message, not only the trailer block — so a body
 * sentence like "This fixes ENG-1 and ENG-2." still triggers the close.
 *
 * Returns a de-duplicated, order-preserving list of identifiers. Empty
 * input or no matches → empty array.
 *
 * Examples:
 *   "Closes ENG-1"                  → ["ENG-1"]
 *   "fixes #eng-1, eng-2"           → ["ENG-1", "ENG-2"]
 *   "Resolves: ENG-9\nFixes ENG-9"  → ["ENG-9"]
 *   "no close keyword here"         → []
 *
 * Linear identifier shape: `[A-Z]{2,}-[0-9]+`. The team prefix is
 * uppercased on output so the closer can resolve consistently regardless
 * of how the trailer was written.
 */

const CLOSE_KEYWORDS = [
  "closes",
  "closed",
  "close",
  "fixes",
  "fixed",
  "fix",
  "resolves",
  "resolved",
  "resolve",
];
const KEYWORD_PATTERN = CLOSE_KEYWORDS.join("|");

// Captures the keyword followed by an optional ':' and then a run of
// identifier-shaped tokens separated by commas / 'and' / whitespace.
const TRAILER_REGEX = new RegExp(
  `\\b(?:${KEYWORD_PATTERN})\\b\\s*:?\\s*(#?[A-Za-z]{2,}-\\d+(?:\\s*(?:,|and)?\\s+#?[A-Za-z]{2,}-\\d+)*)`,
  "gi",
);

const IDENTIFIER_REGEX = /#?([A-Za-z]{2,}-\d+)/g;

export function parseCloseTrailers(message: string): string[] {
  if (!message) return [];

  const found = new Set<string>();
  const ordered: string[] = [];

  TRAILER_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null = TRAILER_REGEX.exec(message);
  while (match !== null) {
    const tail = match[1];
    IDENTIFIER_REGEX.lastIndex = 0;
    let idMatch: RegExpExecArray | null = IDENTIFIER_REGEX.exec(tail);
    while (idMatch !== null) {
      const id = idMatch[1].toUpperCase();
      if (!found.has(id)) {
        found.add(id);
        ordered.push(id);
      }
      idMatch = IDENTIFIER_REGEX.exec(tail);
    }
    match = TRAILER_REGEX.exec(message);
  }

  return ordered;
}
