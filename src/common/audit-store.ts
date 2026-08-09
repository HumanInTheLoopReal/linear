import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getGitTopLevel } from "./git-remote.js";

const DIR_NAME = ".linear";
const FILE_NAME = "audit.jsonl";
const ID_PREFIX = "int-";

export interface AuditEntry {
  id: string;
  kind: string;
  created_at: string;
  actor?: string;
  issue_id?: string;
  model?: string;
  prompt?: string;
  response?: string;
  error?: string;
  tool_name?: string;
  exit_code?: number;
  parent_id?: string;
  label?: string;
  reason?: string;
  extra?: Record<string, unknown>;
}

export interface AuditEntryInput {
  id?: string;
  kind: string;
  created_at?: string;
  actor?: string;
  issue_id?: string;
  model?: string;
  prompt?: string;
  response?: string;
  error?: string;
  tool_name?: string;
  exit_code?: number;
  parent_id?: string;
  label?: string;
  reason?: string;
  extra?: Record<string, unknown>;
}

export interface AuditScope {
  /**
   * When true, force the per-user `~/.linear/audit.jsonl` log even if the
   * caller is inside a git repository.
   */
  global?: boolean;
}

/**
 * Detect the enclosing git repository root. Returns an empty string when
 * not inside a repo (so the caller falls back to the per-user log). The
 * actual `git rev-parse` shellout lives in `git-remote.ts` so the implicit
 * scope feature and audit log share one implementation.
 */
function findRepoRoot(): string {
  return getGitTopLevel() ?? "";
}

/**
 * Resolve the directory that holds the audit log for the current scope.
 *
 * - global=true  → `~/.linear`
 * - global=false → `<repo-root>/.linear` when inside a git repo, otherwise
 *   `~/.linear` (so the command still works in a non-repo cwd).
 */
export function getAuditDir(scope: AuditScope = {}): string {
  if (!scope.global) {
    const root = findRepoRoot();
    if (root !== "") return path.join(root, DIR_NAME);
  }
  return path.join(os.homedir(), DIR_NAME);
}

export function getAuditPath(scope: AuditScope = {}): string {
  return path.join(getAuditDir(scope), FILE_NAME);
}

function newId(): string {
  return ID_PREFIX + crypto.randomBytes(4).toString("hex");
}

/**
 * Append a single JSON line. We marshal to a buffer first and write in one
 * syscall so concurrent O_APPEND writes can't interleave and corrupt lines.
 */
export function appendAuditEntry(
  input: AuditEntryInput,
  scope: AuditScope = {},
): AuditEntry {
  if (!input.kind || input.kind.trim() === "") {
    throw new Error("kind is required");
  }

  const dir = getAuditDir(scope);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const entry: AuditEntry = {
    id: input.id ?? newId(),
    kind: input.kind,
    created_at: input.created_at ?? new Date().toISOString(),
  };
  // Only include fields that are explicitly set so the JSONL stays
  // readable (skip undefined → no key in the JSON object).
  if (input.actor !== undefined) entry.actor = input.actor;
  if (input.issue_id !== undefined) entry.issue_id = input.issue_id;
  if (input.model !== undefined) entry.model = input.model;
  if (input.prompt !== undefined) entry.prompt = input.prompt;
  if (input.response !== undefined) entry.response = input.response;
  if (input.error !== undefined) entry.error = input.error;
  if (input.tool_name !== undefined) entry.tool_name = input.tool_name;
  if (input.exit_code !== undefined) entry.exit_code = input.exit_code;
  if (input.parent_id !== undefined) entry.parent_id = input.parent_id;
  if (input.label !== undefined) entry.label = input.label;
  if (input.reason !== undefined) entry.reason = input.reason;
  if (input.extra !== undefined) entry.extra = input.extra;

  const line = `${JSON.stringify(entry)}\n`;
  fs.appendFileSync(getAuditPath(scope), line, { mode: 0o644 });
  return entry;
}
