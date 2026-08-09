/**
 * Local snapshot storage for `linear issues snapshot` /
 * `linear issues diff`. Linear has no point-in-time issue store,
 * so we capture the current issue set into `~/.linear/snapshots/
 * <label>.jsonl` and let `diff` compare two snapshot files.
 *
 * Each snapshot is JSONL (one issue per line) so we can read
 * incrementally and keep file sizes manageable. The header line
 * (first record) is a metadata object: `{ "_meta": { ... } }`.
 *
 * Ref resolution:
 *   - `HEAD`  → most-recently-modified snapshot file
 *   - `live`  → fetched fresh from Linear (only valid for diff's
 *               to-ref; not a stored snapshot)
 *   - other   → snapshot file named `<ref>.jsonl`
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { GraphQLClient } from "../client/graphql-client.js";
import {
  type IssueSnapshotFieldsFragment,
  ListIssuesForSnapshotDocument,
  type ListIssuesForSnapshotQuery,
} from "../gql/graphql.js";

export interface SnapshotIssue {
  id: string;
  identifier: string;
  title: string;
  description: string;
  status: string;
  priority: number;
}

export interface SnapshotMeta {
  label: string;
  created_at: string;
  issue_count: number;
}

const DIR_NAME = ".linear";
const SUBDIR = "snapshots";
const EXT = ".jsonl";

function hasUnsafeSnapshotCharacter(label: string): boolean {
  if (label.includes("/") || label.includes("\\")) return true;
  return Array.from(label).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

export function getSnapshotDir(): string {
  return path.join(os.homedir(), DIR_NAME, SUBDIR);
}

export function getSnapshotPath(label: string): string {
  if (
    label.length === 0 ||
    label === "." ||
    label === ".." ||
    hasUnsafeSnapshotCharacter(label)
  ) {
    throw new Error(
      "invalid snapshot label: use a single filename component without control characters",
    );
  }

  const snapshotDir = path.resolve(getSnapshotDir());
  const snapshotPath = path.resolve(snapshotDir, `${label}${EXT}`);
  if (path.dirname(snapshotPath) !== snapshotDir) {
    throw new Error("invalid snapshot label: path escapes snapshot directory");
  }
  return snapshotPath;
}

function assertSnapshotDirSafe(): void {
  const dir = getSnapshotDir();
  const stat = fs.lstatSync(dir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("unsafe snapshot directory: expected a real directory");
  }

  const expected = path.join(fs.realpathSync(os.homedir()), DIR_NAME, SUBDIR);
  if (fs.realpathSync(dir) !== expected) {
    throw new Error(
      "unsafe snapshot directory: path escapes the home directory",
    );
  }
}

function ensureSnapshotDir(): void {
  fs.mkdirSync(getSnapshotDir(), { recursive: true });
  assertSnapshotDirSafe();
}

function assertRegularSnapshotFile(filePath: string): void {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error("unsafe snapshot file: expected a regular file");
  }
}

function snapshotIssueFromFragment(
  fragment: IssueSnapshotFieldsFragment,
): SnapshotIssue {
  return {
    id: fragment.id,
    identifier: fragment.identifier,
    title: fragment.title,
    description: fragment.description ?? "",
    status: fragment.state.type,
    priority: fragment.priority,
  };
}

export async function fetchLiveSnapshot(
  client: GraphQLClient,
): Promise<SnapshotIssue[]> {
  const issues: SnapshotIssue[] = [];
  let after: string | undefined;
  while (true) {
    const res = await client.request<ListIssuesForSnapshotQuery>(
      ListIssuesForSnapshotDocument,
      { first: 250, after },
    );
    for (const node of res.issues.nodes) {
      issues.push(snapshotIssueFromFragment(node));
    }
    if (!res.issues.pageInfo.hasNextPage) break;
    after = res.issues.pageInfo.endCursor ?? undefined;
    if (!after) break;
  }
  return issues;
}

export async function writeSnapshot(
  client: GraphQLClient,
  label?: string,
): Promise<{ label: string; path: string; meta: SnapshotMeta }> {
  const resolvedLabel = label ?? new Date().toISOString().replace(/:/g, "-");
  const filePath = getSnapshotPath(resolvedLabel);
  ensureSnapshotDir();
  if (fs.existsSync(filePath)) assertRegularSnapshotFile(filePath);
  const issues = await fetchLiveSnapshot(client);
  const meta: SnapshotMeta = {
    label: resolvedLabel,
    created_at: new Date().toISOString(),
    issue_count: issues.length,
  };
  const lines = [JSON.stringify({ _meta: meta })];
  for (const issue of issues) {
    lines.push(JSON.stringify(issue));
  }
  const tempPath = path.join(
    getSnapshotDir(),
    `.${resolvedLabel}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    fs.writeFileSync(tempPath, `${lines.join("\n")}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    fs.renameSync(tempPath, filePath);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
  return { label: resolvedLabel, path: filePath, meta };
}

export function listSnapshots(): SnapshotMeta[] {
  const dir = getSnapshotDir();
  if (!fs.existsSync(dir)) return [];
  assertSnapshotDirSafe();
  const entries: SnapshotMeta[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.isSymbolicLink()) continue;
    const name = entry.name;
    if (!name.endsWith(EXT)) continue;
    const label = name.slice(0, -EXT.length);
    let filePath: string;
    try {
      filePath = getSnapshotPath(label);
    } catch {
      continue;
    }
    const meta = readSnapshotMeta(filePath, label);
    entries.push(meta);
  }
  // Newest-first by created_at
  entries.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return entries;
}

function readSnapshotMeta(filePath: string, label: string): SnapshotMeta {
  assertRegularSnapshotFile(filePath);
  const stat = fs.statSync(filePath);
  const fallback: SnapshotMeta = {
    label,
    created_at: stat.mtime.toISOString(),
    issue_count: 0,
  };
  try {
    const first = readFirstLine(filePath);
    if (first.startsWith('{"_meta"')) {
      const parsed = JSON.parse(first) as { _meta?: SnapshotMeta };
      if (parsed._meta) return parsed._meta;
    }
  } catch {
    // fall through to fallback
  }
  return fallback;
}

function readFirstLine(filePath: string): string {
  const buf = fs.readFileSync(filePath, "utf8");
  const newline = buf.indexOf("\n");
  return newline === -1 ? buf : buf.slice(0, newline);
}

export function resolveSnapshotRef(
  ref: string,
): { label: string; path: string } | "live" {
  if (ref === "live") return "live";
  if (ref === "HEAD") {
    const snapshots = listSnapshots();
    if (snapshots.length === 0) {
      throw new Error("HEAD requested but no snapshots exist");
    }
    return {
      label: snapshots[0].label,
      path: getSnapshotPath(snapshots[0].label),
    };
  }
  const filePath = getSnapshotPath(ref);
  const dir = getSnapshotDir();
  if (fs.existsSync(dir)) assertSnapshotDirSafe();
  if (!fs.existsSync(filePath)) {
    throw new Error(`snapshot not found: ${ref} (looked at ${filePath})`);
  }
  assertRegularSnapshotFile(filePath);
  return { label: ref, path: filePath };
}

export function readSnapshot(filePath: string): SnapshotIssue[] {
  const text = fs.readFileSync(filePath, "utf8");
  const issues: SnapshotIssue[] = [];
  for (const line of text.split("\n")) {
    if (line.length === 0) continue;
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if ("_meta" in parsed) continue;
    issues.push(parsed as unknown as SnapshotIssue);
  }
  return issues;
}

export async function loadSnapshotByRef(
  client: GraphQLClient,
  ref: string,
): Promise<{ label: string; issues: SnapshotIssue[] }> {
  const resolved = resolveSnapshotRef(ref);
  if (resolved === "live") {
    const issues = await fetchLiveSnapshot(client);
    return { label: "live", issues };
  }
  return { label: resolved.label, issues: readSnapshot(resolved.path) };
}
