/**
 * Shared marker-bracketed managed-section infrastructure for `linear setup`
 * recipes that own a slice of a user file (e.g. AGENTS.md) rather than the
 * whole file. Used by codex, mux (every layer), agents, factory, opencode.
 *
 * Exposes upsert/extract/remove helpers parameterized by a BEGIN/END
 * marker pair. The previous inline implementation in `setup-service.ts`
 * had subtle drift between codex, mux, and agents call sites; this
 * module is the single primitive every section recipe now resolves to.
 *
 * Each recipe supplies a `SectionMarkers` (BEGIN comment, END comment,
 * fallback "empty file" header, optional alternate body) plus a
 * `SectionRecipeCtx` (file path + primary + legacy markers for migration
 * sweep). The shared `runSectionRecipe(op, ctx)` returns a normalized
 * `SectionOutcome` the caller maps onto its own result envelope.
 */

import fs from "node:fs";
import path from "node:path";
import { WORKFLOW_BODY } from "../../templates/workflow.js";

export interface SectionMarkers {
  /** BEGIN comment line (e.g. `<!-- BEGIN LINEAR CODEX SETUP: ... -->`). */
  begin: string;
  /** END comment line (e.g. `<!-- END LINEAR CODEX SETUP -->`). */
  end: string;
  /** Header to use when a fresh file is being created (no existing content). */
  emptyHeader: string;
  /**
   * Managed-block body. Defaults to the full workflow text used by
   * codex/mux. The agents recipe overrides this with a short snippet that
   * points at `linear prime` instead of duplicating the workflow.
   */
  body?: string;
}

export interface SectionLocation {
  found: boolean;
  start: number;
  end: number;
  current: string;
}

/**
 * Normalized vocabulary every section op resolves to. Per-domain wrappers
 * (codex / agents / one mux layer) translate this into their own public
 * envelope shape, which preserves their existing JSON contracts
 * (`installed?: boolean`, `instructions_action`, …).
 */
export type SectionOutcome =
  | "written"
  | "updated"
  | "current"
  | "stale"
  | "removed"
  | "absent"
  | "missing-marker";

export type SectionOp = "install" | "check" | "remove";

export interface SectionRecipeCtx {
  filePath: string;
  markers: SectionMarkers;
}

export function buildSection(markers: SectionMarkers): string {
  const body = markers.body ?? WORKFLOW_BODY;
  return `${markers.begin}\n${body}\n${markers.end}`;
}

export function extractManagedSection(
  content: string,
  markers: SectionMarkers,
): SectionLocation {
  const start = content.indexOf(markers.begin);
  const endMarker = content.indexOf(markers.end);
  if (start === -1 || endMarker === -1 || start > endMarker) {
    return { found: false, start: -1, end: -1, current: "" };
  }
  const end = endMarker + markers.end.length;
  return { found: true, start, end, current: content.slice(start, end) };
}

export function upsertManagedSection(
  content: string,
  markers: SectionMarkers,
): string {
  const section = buildSection(markers);
  const loc = extractManagedSection(content, markers);
  if (loc.found) {
    return content.slice(0, loc.start) + section + content.slice(loc.end);
  }
  if (content.trim() === "") {
    return `${markers.emptyHeader}\n\n${section}\n`;
  }
  const base = content.endsWith("\n") ? content : `${content}\n`;
  return `${base}\n${section}\n`;
}

export function stripManagedSection(
  content: string,
  markers: SectionMarkers,
): { next: string; stripped: boolean } {
  const loc = extractManagedSection(content, markers);
  if (!loc.found) return { next: content, stripped: false };
  let end = loc.end;
  if (end < content.length && content[end] === "\n") end += 1;
  return {
    next: content.slice(0, loc.start) + content.slice(end),
    stripped: true,
  };
}

function ensureParentDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (dir && dir !== "." && dir !== "/") {
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  }
}

/**
 * Single primitive for every BEGIN/END-marker managed block. The three
 * domain trios (codex, agents, per-layer mux) used to ship a near-byte
 * copy of this body each; collapsing them eliminates the rule-of-three
 * duplication while preserving every wrapper's public envelope shape.
 *
 * Returns a normalized outcome the caller maps onto its own result
 * type — `written`/`updated` for install, `current`/`stale`/`absent`/
 * `missing-marker` for check, `removed`/`absent`/`missing-marker` for
 * remove.
 */
export function runSectionRecipe(
  op: SectionOp,
  ctx: SectionRecipeCtx,
): SectionOutcome {
  if (op === "install") {
    ensureParentDir(ctx.filePath);
    let current = "";
    let hadSection = false;
    if (fs.existsSync(ctx.filePath)) {
      current = fs.readFileSync(ctx.filePath, "utf8");
      hadSection = extractManagedSection(current, ctx.markers).found;
    }
    const next = upsertManagedSection(current, ctx.markers);
    fs.writeFileSync(ctx.filePath, next, { mode: 0o644 });
    return hadSection ? "updated" : "written";
  }
  if (op === "check") {
    if (!fs.existsSync(ctx.filePath)) return "absent";
    const data = fs.readFileSync(ctx.filePath, "utf8");
    const loc = extractManagedSection(data, ctx.markers);
    if (!loc.found) return "missing-marker";
    return loc.current === buildSection(ctx.markers) ? "current" : "stale";
  }
  // op === "remove"
  if (!fs.existsSync(ctx.filePath)) return "absent";
  const data = fs.readFileSync(ctx.filePath, "utf8");
  const primary = stripManagedSection(data, ctx.markers);
  if (!primary.stripped) return "missing-marker";
  fs.writeFileSync(ctx.filePath, primary.next, { mode: 0o644 });
  return "removed";
}
