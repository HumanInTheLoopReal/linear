/**
 * The SHAPE half of the issue-template contract: not "is the section there?"
 * but "is its body written the way that kind of section is meant to be written?"
 *
 * `required-sections` answers presence, and presence alone turns out to be a
 * weak contract. An agent that writes
 *
 *   ## Acceptance Criteria
 *   The session list renders every session.
 *   Selecting one opens it.
 *
 * satisfies the heading check completely, and produces a ticket nobody can tick
 * off line by line. The lines are criteria; they just are not markdown, so
 * Linear renders them as one soft-wrapped paragraph.
 *
 * Two rules follow, and they are deliberately asymmetric:
 *
 *   - Shape is REPAIRED, never refused. A missing list marker is a formatting
 *     slip with exactly one correct fix, so the CLI applies it and says what it
 *     changed. Refusing here would cost a round-trip to teach the agent
 *     something the CLI already knows.
 *   - Emptiness is REFUSED, never repaired. A required section with nothing
 *     under it (or nothing but the skeleton's own hint comment) is missing
 *     content, and no amount of formatting invents it.
 *
 * Style is a property of what a section IS, not of where its definition came
 * from — `## Acceptance Criteria` wants checkboxes whether it arrived from the
 * built-in defaults, a repo's `template.create` markdown, or a per-type
 * override. So the default style is keyed by heading text here, and an explicit
 * `style` on a `RequiredSection` overrides it.
 *
 * Pure: no config reads, no I/O.
 */

import {
  headingNeedle,
  type RequiredSection,
  type SectionStyle,
} from "./required-sections.js";

/**
 * What each {@link SectionStyle} means to the normalizer:
 *
 *   - `prose`     — free text. Never rewritten. The right answer for framing
 *                   and narrative sections, and for anything holding a command.
 *   - `bullets`   — an unordered list. Bare lines gain `- `; existing list
 *                   items of any marker are left alone.
 *   - `checklist` — a task list. Every item becomes `- [ ]`, so a reader
 *                   holding the diff can tick them one at a time.
 */
export type { SectionStyle };

export const SECTION_STYLES: readonly SectionStyle[] = [
  "prose",
  "bullets",
  "checklist",
];

export function isSectionStyle(value: unknown): value is SectionStyle {
  return (
    typeof value === "string" &&
    (SECTION_STYLES as readonly string[]).includes(value)
  );
}

/**
 * Default style per section, keyed by the same lower-cased heading text
 * `validateCreateDescription` matches on.
 *
 * Only sections whose meaning REQUIRES a list appear here. A criteria section
 * holds independently markable claims and a rejected-alternatives section holds
 * one entry per alternative; both are lists in every workspace that writes them
 * well. Everything absent from this map is prose, which is the safe default: a
 * style the CLI guessed wrong rewrites a body the author wrote on purpose.
 *
 * A verification section is deliberately NOT here. It commonly holds a fenced
 * command block, and a marker in front of a shell line is noise at best.
 */
const STYLE_BY_HEADING: Readonly<Record<string, SectionStyle>> = {
  "acceptance criteria": "checklist",
  "success criteria": "checklist",
  "steps to reproduce": "bullets",
  alternatives: "bullets",
  "alternatives considered": "bullets",
  consequences: "bullets",
  findings: "bullets",
};

/** The style a section uses: its explicit one, else the default for its name. */
export function styleFor(section: RequiredSection): SectionStyle {
  return (
    section.style ?? STYLE_BY_HEADING[headingNeedle(section.heading)] ?? "prose"
  );
}

const ATX_HEADING_RE = /^ {0,3}#{1,6}\s+\S/;
const FENCE_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const SETEXT_RULE_RE = /^ {0,3}(=+|-+)\s*$/;
const LIST_ITEM_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;
const TASK_MARKER_RE = /^\[[ xX]\]\s/;
const INDENTED_CODE_RE = /^(?: {4}|\t)/;

/**
 * What one line of a description is, decided once for the whole document before
 * anything reads it. Locating sections, judging emptiness, and repairing shape
 * all ask the same questions, and the bugs live in the places where separate
 * scanners answer them differently.
 */
interface LineFacts {
  /** Inside a fenced code block that closes, including both fence lines. */
  fenced: boolean;
  /** Inside a fence that never closes. See {@link scanLines} for why it differs. */
  drifting: boolean;
  /** The heading text this line carries, ATX or setext; null if it is not one. */
  headingText: string | null;
  /** The `===` or `---` underline of a setext heading. */
  setextRule: boolean;
  /** The line with HTML comment spans removed — what a reader would actually see. */
  visible: string;
}

/**
 * Classify every line: fences, HTML comments, and headings of both markdown
 * spellings.
 *
 * A fence is tracked by delimiter character and opening length, because
 * markdown only lets a fence be closed by a run of the SAME character that is
 * at least as long. A boolean toggle gets this wrong in both directions, and
 * the wrong direction here means rewriting somebody's code sample.
 *
 * An unclosed fence is the interesting case, and the two readers of this data
 * want opposite answers. Markdown says it runs to the end of the document, so
 * a stray ``` would hide everything after it — and a section hidden from the
 * scanner is a section the gate never checks. So it gets its own flag: the
 * scanner sees through drifting lines and still finds the headings below them,
 * while repair treats them as code and leaves them alone. Each reader takes the
 * conservative option for its own job.
 */
function scanLines(lines: string[]): LineFacts[] {
  const facts: LineFacts[] = lines.map((line) => ({
    fenced: false,
    drifting: false,
    headingText: null,
    setextRule: false,
    visible: line,
  }));

  let open: { char: string; length: number; from: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(FENCE_RE);
    if (open) {
      facts[i].fenced = true;
      const closes =
        match !== null &&
        match[2][0] === open.char &&
        match[2].length >= open.length &&
        match[3].trim() === "";
      if (closes) open = null;
      continue;
    }
    // A backtick fence's info string may not itself contain a backtick, which
    // is what keeps an inline `code span` from opening a block.
    if (match && !(match[2][0] === "`" && match[3].includes("`"))) {
      open = { char: match[2][0], length: match[2].length, from: i };
      facts[i].fenced = true;
    }
  }
  if (open) {
    for (let i = open.from; i < lines.length; i++) {
      facts[i].fenced = false;
      facts[i].drifting = true;
    }
  }

  let inComment = false;
  for (let i = 0; i < lines.length; i++) {
    if (facts[i].fenced) continue;
    const line = lines[i];
    let visible = "";
    let at = 0;
    while (at < line.length) {
      if (inComment) {
        const close = line.indexOf("-->", at);
        if (close === -1) break;
        at = close + 3;
        inComment = false;
        continue;
      }
      const start = line.indexOf("<!--", at);
      if (start === -1) {
        visible += line.slice(at);
        break;
      }
      visible += line.slice(at, start);
      at = start + 4;
      inComment = true;
    }
    facts[i].visible = visible;
  }

  for (let i = 0; i < lines.length; i++) {
    if (facts[i].fenced) continue;
    if (ATX_HEADING_RE.test(lines[i])) {
      facts[i].headingText = lines[i].trim();
      continue;
    }
    if (i === 0 || !SETEXT_RULE_RE.test(lines[i])) continue;
    const previous = lines[i - 1];
    const eligible =
      !facts[i - 1].fenced &&
      facts[i - 1].headingText === null &&
      facts[i - 1].visible.trim() !== "" &&
      !LIST_ITEM_RE.test(previous);
    if (!eligible) continue;
    facts[i - 1].headingText = previous.trim();
    facts[i].setextRule = true;
  }

  return facts;
}

/** Lines that carry markdown structure of their own and are never rewritten. */
function isStructural(line: string): boolean {
  const t = line.trimStart();
  return (
    t.startsWith(">") ||
    t.startsWith("|") ||
    t.startsWith("<!--") ||
    t.startsWith("<") ||
    /^([-*_])\1{2,}\s*$/.test(t)
  );
}

/**
 * Rewrite one body line into the section's style. Returns the line unchanged
 * when it already conforms, or when touching it would damage markdown the
 * author wrote deliberately.
 *
 * `afterListItem` says whether the previous non-blank line was ALREADY a list
 * item before this pass touched anything. That is what separates the two ways a
 * bare line can show up: following a written claim it is a lazy continuation of
 * that claim, and following a blank line or another bare line it is a claim of
 * its own.
 */
function applyStyle(
  line: string,
  style: SectionStyle,
  afterListItem: boolean,
): string {
  if (line.trim() === "") return line;
  if (isStructural(line)) return line;
  // Four spaces or a tab makes an indented code block, and its contents are
  // whatever the author typed, list markers included.
  if (INDENTED_CODE_RE.test(line)) return line;

  const item = line.match(LIST_ITEM_RE);
  if (item) {
    const [, indent, rest] = item;
    // A nested bullet elaborates the item above it. Promoting it to a checkbox
    // would make a supporting detail independently tickable.
    if (indent.length >= 2) return line;
    if (style !== "checklist") return line;
    if (TASK_MARKER_RE.test(rest)) return line;
    return `${indent}- [ ] ${rest}`;
  }

  if (/^\s{2,}\S/.test(line)) return line;
  if (afterListItem) return line;

  const marker = style === "checklist" ? "- [ ] " : "- ";
  return `${marker}${line.trimStart()}`;
}

/** What `normalizeSectionShape` changed, for the notice printed to the caller. */
export interface ShapeChange {
  heading: string;
  style: SectionStyle;
  /** Body lines that gained or upgraded a list marker. */
  lines: number;
}

export interface ShapeResult {
  description: string;
  changes: ShapeChange[];
}

interface SectionSpan {
  section: RequiredSection;
  /** First body line index (exclusive of the heading). */
  start: number;
  /** One past the last body line. */
  end: number;
}

/**
 * Locate each required section's body. A section runs from its heading to the
 * next heading of any depth, matching `validateCreateDescription`'s leniency
 * about `#` depth so the two agree on where a section is.
 */
function locateSections(
  facts: LineFacts[],
  sections: RequiredSection[],
): SectionSpan[] {
  const wanted = new Map(sections.map((s) => [headingNeedle(s.heading), s]));
  const spans: SectionSpan[] = [];
  let open: { section: RequiredSection; start: number } | null = null;

  for (let i = 0; i < facts.length; i++) {
    const heading = facts[i].headingText;
    if (facts[i].fenced || heading === null) continue;

    if (open) spans.push({ ...open, end: i });
    const match = wanted.get(headingNeedle(heading));
    // A setext heading is two lines, so its body starts one line further on.
    const bodyStart = facts[i + 1]?.setextRule ? i + 2 : i + 1;
    open = match ? { section: match, start: bodyStart } : null;
  }
  if (open) spans.push({ ...open, end: facts.length });
  return spans;
}

/**
 * Give every required section's body the markdown shape its style calls for.
 *
 * Sections absent from the description are left to the presence check; this
 * function never invents a heading, because a section the author did not write
 * is a content gap rather than a formatting one.
 */
export function normalizeSectionShape(
  description: string,
  sections: RequiredSection[],
): ShapeResult {
  const source = description ?? "";
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const facts = scanLines(lines);
  const changes: ShapeChange[] = [];

  for (const span of locateSections(facts, sections)) {
    const style = styleFor(span.section);
    if (style === "prose") continue;

    let touched = 0;
    let afterListItem = false;
    for (let i = span.start; i < span.end; i++) {
      const line = lines[i];
      if (
        facts[i].fenced ||
        facts[i].drifting ||
        facts[i].setextRule ||
        facts[i].headingText !== null ||
        line.trim() === ""
      ) {
        afterListItem = false;
        continue;
      }
      const next = applyStyle(line, style, afterListItem);
      afterListItem = LIST_ITEM_RE.test(line);
      if (next !== line) {
        lines[i] = next;
        touched++;
      }
    }
    if (touched > 0) {
      changes.push({ heading: span.section.heading, style, lines: touched });
    }
  }

  if (changes.length === 0) return { description: source, changes };
  return { description: lines.join("\n"), changes };
}

/**
 * Required sections that are present but carry no content.
 *
 * Blank lines and HTML comments do not count as content: the comment case is
 * the skeleton this CLI itself prints, so an agent that pastes the skeleton and
 * fills nothing in must not pass the gate that skeleton exists to teach.
 */
export function findEmptySections(
  description: string,
  sections: RequiredSection[],
): string[] {
  const lines = (description ?? "").replace(/\r\n/g, "\n").split("\n");
  const facts = scanLines(lines);
  const empty: string[] = [];

  for (const span of locateSections(facts, sections)) {
    const hasContent = facts
      .slice(span.start, span.end)
      .some((line) => !line.setextRule && line.visible.trim() !== "");
    if (!hasContent) empty.push(span.section.heading);
  }
  return empty;
}

/** One-line summary of a repair, for the stderr notice. */
export function renderShapeNotice(changes: ShapeChange[]): string {
  const parts = changes.map(
    (c) =>
      `${c.heading} (${c.lines} line${c.lines === 1 ? "" : "s"} → ${
        c.style === "checklist" ? "- [ ]" : "-"
      })`,
  );
  return `formatted to match the template: ${parts.join(", ")}`;
}
