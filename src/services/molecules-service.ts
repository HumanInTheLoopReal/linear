/**
 * Foundation layer for `linear molecules ...` — the work-template
 * (formula/molecule) system. No CLI verbs here; those land in follow-ons.
 * This module provides:
 *
 *  - `MoleculeProto` shape (re-exported from {@link molecules-toml})
 *  - Search-path resolution (project → user → bundled, in that order)
 *  - `listProtos` / `getProto` enumeration + lookup with dedupe by name
 *  - `substituteVariables` for `{{key}}` placeholder expansion
 *  - `topologicalSort` for ordering pour creation by `depends_on`
 *
 * Search paths (highest precedence first):
 *
 *   1. `<cwd>/.linear/molecules/`            — project-local overrides
 *   2. `~/.linear/molecules/`                — user-global protos
 *   3. `<dist>/molecules/builtin/`           — bundled starters that ship
 *                                              with linear itself
 *
 * Dedupe rule: when the same `name:` appears in multiple paths, the
 * earlier (project > user > builtin) wins — a project tweak overrides a
 * bundled formula without forking the package.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type MoleculeIssueSpec,
  type MoleculeProto,
  parseMoleculeToml,
} from "./molecules-toml.js";

export type {
  MoleculeIssueSpec,
  MoleculeProto,
  MoleculeVariable,
} from "./molecules-toml.js";

/**
 * Resolve the bundled `molecules/builtin/` directory. Lives next to
 * this file's compiled location so it works both in `tsx src/main.ts`
 * (dev: `src/services/...` → `src/molecules/builtin/`) and in the
 * shipped package (`dist/services/...` → `dist/molecules/builtin/`).
 */
function bundledBuiltinDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "molecules", "builtin");
}

/**
 * Default search paths, project first. Caller may pass an explicit list
 * to override (e.g. for tests).
 */
export function defaultSearchPaths(): string[] {
  return [
    path.resolve(process.cwd(), ".linear", "molecules"),
    path.resolve(os.homedir(), ".linear", "molecules"),
    bundledBuiltinDir(),
  ];
}

function loadProtosFromDir(dir: string): MoleculeProto[] {
  if (!fs.existsSync(dir)) return [];
  const out: MoleculeProto[] = [];
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith(".toml")) continue;
    const file = path.join(dir, entry);
    const content = fs.readFileSync(file, "utf8");
    out.push(parseMoleculeToml(content, file));
  }
  return out;
}

/**
 * Enumerate all protos across the supplied (or default) search paths.
 * Dedupes by `name` keeping the first occurrence — search paths are
 * ordered highest-precedence-first.
 */
export function listProtos(searchPaths?: string[]): MoleculeProto[] {
  const paths = searchPaths ?? defaultSearchPaths();
  const seen = new Map<string, MoleculeProto>();
  for (const dir of paths) {
    for (const proto of loadProtosFromDir(dir)) {
      if (!seen.has(proto.name)) {
        seen.set(proto.name, proto);
      }
    }
  }
  return [...seen.values()];
}

/**
 * Look up a single proto by name (case-sensitive — TOML names are
 * stable identifiers, not free text). Returns undefined when the name
 * is unknown.
 */
export function getProto(
  name: string,
  searchPaths?: string[],
): MoleculeProto | undefined {
  return listProtos(searchPaths).find((p) => p.name === name);
}

/**
 * Replace every `{{key}}` placeholder in `template` with `vars[key]`.
 * Unknown keys are left as `{{key}}` so callers can decide whether to
 * error (e.g. on pour) or pass through (e.g. on `molecules show`).
 *
 * Keys are case-sensitive and match `/{{ ?key ?}}/` — single-space
 * padding tolerated for human-readability.
 */
export function substituteVariables(
  template: string,
  vars: Readonly<Record<string, string>>,
): string {
  return template.replace(/\{\{ ?([A-Za-z0-9_]+) ?\}\}/g, (match, key) => {
    return key in vars ? vars[key] : match;
  });
}

/**
 * Marker heading used in poured-epic descriptions to record the
 * variable assignments. Must stay byte-stable — `molecules current`
 * parses against this exact string.
 */
export const VARIABLES_HEADING = "## Variables";

/**
 * Serialize a substitution map as the `## Variables` block that pour
 * writes into the epic description and `current` parses back. Format:
 *
 *     ## Variables
 *
 *     - key1: value1
 *     - key2: value2
 *
 * Returns `""` when no vars are supplied.
 */
export function formatVariablesBlock(vars: Record<string, string>): string {
  const entries = Object.entries(vars);
  if (entries.length === 0) return "";
  const lines = [VARIABLES_HEADING, ""];
  for (const [k, v] of entries) {
    lines.push(`- ${k}: ${v}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Inverse of {@link formatVariablesBlock}. Reads a `## Variables` block
 * out of an epic description and returns the parsed map. Tolerates
 * surrounding content (other markdown sections); the block ends at the
 * next `## ` heading or end-of-text. Returns `{}` when no block is found.
 */
export function parseVariablesBlock(
  description: string | null | undefined,
): Record<string, string> {
  if (!description) return {};
  const lines = description.split("\n");
  const start = lines.findIndex((l) => l.trim() === VARIABLES_HEADING);
  if (start < 0) return {};
  const out: Record<string, string> = {};
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("## ")) break;
    const match = line.match(/^-\s+([A-Za-z0-9_]+):\s*(.*)$/);
    if (match) out[match[1]] = match[2];
  }
  return out;
}

/**
 * Order `issues` so every issue appears AFTER the issues it depends on
 * (Kahn's algorithm). Throws when the graph contains a cycle — pour
 * cannot resolve that, so we surface it loudly rather than silently
 * truncating.
 */
export function topologicalSort(
  issues: readonly MoleculeIssueSpec[],
): MoleculeIssueSpec[] {
  const byKey = new Map(issues.map((i) => [i.key, i]));
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const issue of issues) {
    incoming.set(issue.key, 0);
    outgoing.set(issue.key, []);
  }
  for (const issue of issues) {
    for (const dep of issue.depends_on ?? []) {
      if (!byKey.has(dep)) {
        throw new Error(
          `molecule issue \`${issue.key}\` depends on unknown key \`${dep}\``,
        );
      }
      incoming.set(issue.key, (incoming.get(issue.key) ?? 0) + 1);
      outgoing.get(dep)?.push(issue.key);
    }
  }

  const queue: string[] = [];
  for (const [key, count] of incoming) {
    if (count === 0) queue.push(key);
  }

  const out: MoleculeIssueSpec[] = [];
  while (queue.length > 0) {
    const key = queue.shift() as string;
    const issue = byKey.get(key);
    if (issue) out.push(issue);
    for (const next of outgoing.get(key) ?? []) {
      const remaining = (incoming.get(next) ?? 0) - 1;
      incoming.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }

  if (out.length !== issues.length) {
    const remaining = issues
      .filter((i) => !out.includes(i))
      .map((i) => i.key)
      .join(", ");
    throw new Error(`molecule has a depends_on cycle involving: ${remaining}`);
  }

  return out;
}
