/**
 * Local edit workflow for issue descriptions: `linear issues pull` /
 * `linear issues push`.
 *
 * Whole-description writes via `update --description` are last-write-wins:
 * an agent holding a stale copy silently clobbers edits made in the
 * Linear UI in the meantime. Linear's GraphQL API has no server-side
 * precondition, so this service implements optimistic concurrency
 * client-side:
 *
 *   pull  → write the description to `~/.linear/edits/<ID>.md` (the
 *           working copy the agent edits with its own file tools) plus
 *           `<ID>.base.md` + `<ID>.meta.json` (the immutable baseline:
 *           content + hash as of pull time).
 *   push  → re-fetch the issue. If hash(server) != baseline hash, the
 *           server moved since pull: refuse with EXIT_CONFLICT and a
 *           diff of what changed remotely. Otherwise upload the working
 *           copy and refresh the baseline.
 *
 * A small TOCTOU window remains between push's read and write — the API
 * offers nothing stronger — but silent data loss becomes a visible,
 * retryable error. (TES-822 / TES-823)
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { GraphQLClient } from "../client/graphql-client.js";
import { EXIT_CONFLICT, fatalError } from "../common/errors.js";
import { unifiedDiff } from "../common/unified-diff.js";
import { getIssue, updateIssue } from "./issue-service.js";

/** Default working-copy directory, sibling to `~/.linear/snapshots`. */
export function getEditsDir(): string {
  return path.join(os.homedir(), ".linear", "edits");
}

export interface EditMeta {
  /** Issue UUID (stable even if the identifier is ever re-keyed). */
  id: string;
  identifier: string;
  title: string;
  /** sha256 of the description as of pull time — the push precondition. */
  base_hash: string;
  /** Server `updatedAt` as of pull time (informational). */
  updated_at: string;
  pulled_at: string;
}

export interface PullResult {
  identifier: string;
  title: string;
  /** Working-copy path the caller should edit. */
  path: string;
  action: "pulled";
  /** Set when a dirty working copy was overwritten via --force. */
  backup_path?: string;
}

export interface PushResult {
  identifier: string;
  action: "pushed" | "no_changes" | "dry_run";
  path: string;
  /** Unified diff server→local; present on dry_run (empty = no changes). */
  diff?: string;
  /** dry_run only: true when the server moved since pull (push would conflict). */
  conflict?: boolean;
}

function workingPath(dir: string, identifier: string): string {
  return path.join(dir, `${identifier}.md`);
}
function basePath(dir: string, identifier: string): string {
  return path.join(dir, `${identifier}.base.md`);
}
function metaPath(dir: string, identifier: string): string {
  return path.join(dir, `${identifier}.meta.json`);
}

export function hashDescription(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Working files are written with a trailing newline (editor-friendly);
 * reads strip exactly one so content round-trips byte-identical to the
 * server value and repeated pull/push cycles don't accrete newlines.
 */
function readNormalized(filePath: string): string {
  return fs.readFileSync(filePath, "utf8").replace(/\n$/, "");
}
function writeNormalized(filePath: string, content: string): void {
  fs.writeFileSync(filePath, `${content}\n`, { mode: 0o644 });
}

function readMeta(dir: string, identifier: string): EditMeta | null {
  const p = metaPath(dir, identifier);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as EditMeta;
  } catch {
    return null;
  }
}

function writeBaseline(
  dir: string,
  meta: Omit<EditMeta, "pulled_at">,
  description: string,
): void {
  fs.mkdirSync(dir, { recursive: true });
  writeNormalized(basePath(dir, meta.identifier), description);
  fs.writeFileSync(
    metaPath(dir, meta.identifier),
    `${JSON.stringify({ ...meta, pulled_at: new Date().toISOString() }, null, 2)}\n`,
    { mode: 0o644 },
  );
}

/**
 * Fetch the issue and write working copy + baseline. Refuses to
 * overwrite a working copy that has unpushed local edits unless
 * `force` — and even then saves the dirty copy to `<ID>.local.bak.md`
 * so a conflict-recovery pull can't destroy the agent's work.
 */
export async function pullIssue(
  client: GraphQLClient,
  id: string,
  opts: { dir?: string; force?: boolean } = {},
): Promise<PullResult> {
  const dir = opts.dir ?? getEditsDir();
  const issue = await getIssue(client, id);
  const identifier = issue.identifier;
  const description = issue.description ?? "";
  const wPath = workingPath(dir, identifier);
  const meta = readMeta(dir, identifier);

  let backupPath: string | undefined;
  if (fs.existsSync(wPath) && meta) {
    const local = readNormalized(wPath);
    const dirty =
      hashDescription(local) !== meta.base_hash && local !== description;
    if (dirty && !opts.force) {
      throw fatalError(`${identifier} has unpushed local edits at ${wPath}`, {
        hint: `push them first (linear issues push ${identifier}), or re-pull with --force to take the server copy (your local copy is backed up to ${identifier}.local.bak.md)`,
      });
    }
    if (dirty) {
      backupPath = path.join(dir, `${identifier}.local.bak.md`);
      writeNormalized(backupPath, local);
    }
  }

  fs.mkdirSync(dir, { recursive: true });
  writeNormalized(wPath, description);
  writeBaseline(
    dir,
    {
      id: issue.id,
      identifier,
      title: issue.title ?? "",
      base_hash: hashDescription(description),
      updated_at: issue.updatedAt ?? "",
    },
    description,
  );

  const result: PullResult = {
    identifier,
    title: issue.title ?? "",
    path: wPath,
    action: "pulled",
  };
  if (backupPath) result.backup_path = backupPath;
  return result;
}

/**
 * Upload the working copy, guarded by the pull-time baseline. See the
 * module doc for the conflict contract.
 */
export async function pushIssue(
  client: GraphQLClient,
  id: string,
  opts: { dir?: string; dryRun?: boolean; force?: boolean } = {},
): Promise<PushResult> {
  const dir = opts.dir ?? getEditsDir();
  const issue = await getIssue(client, id);
  const identifier = issue.identifier;
  const wPath = workingPath(dir, identifier);
  const meta = readMeta(dir, identifier);

  if (!meta || !fs.existsSync(wPath)) {
    throw fatalError(`no local copy of ${identifier} to push`, {
      hint: `run \`linear issues pull ${identifier}\` first, edit ${wPath}, then push`,
    });
  }

  const local = readNormalized(wPath);
  const server = issue.description ?? "";
  const serverMoved = hashDescription(server) !== meta.base_hash;

  if (opts.dryRun) {
    return {
      identifier,
      action: "dry_run",
      path: wPath,
      diff: unifiedDiff(server, local, {
        oldLabel: `${identifier} (server)`,
        newLabel: `${identifier} (local)`,
      }),
      conflict: serverMoved,
    };
  }

  if (serverMoved && !opts.force) {
    const base = fs.existsSync(basePath(dir, identifier))
      ? readNormalized(basePath(dir, identifier))
      : "";
    const remoteDiff = unifiedDiff(base, server, {
      oldLabel: `${identifier} (as pulled)`,
      newLabel: `${identifier} (server now)`,
    });
    throw fatalError(
      `push conflict: ${identifier} changed on the server since pull\n${remoteDiff}`,
      {
        exitCode: EXIT_CONFLICT,
        hint: `re-pull with \`linear issues pull ${identifier} --force\` (your local copy is backed up to ${identifier}.local.bak.md), re-apply your edit, then push again — or push --force to overwrite the server copy`,
      },
    );
  }

  if (local === server) {
    // Nothing to upload; refresh the baseline so a stale hash doesn't
    // produce phantom conflicts later.
    writeBaseline(
      dir,
      {
        id: issue.id,
        identifier,
        title: issue.title ?? "",
        base_hash: hashDescription(server),
        updated_at: issue.updatedAt ?? "",
      },
      server,
    );
    return { identifier, action: "no_changes", path: wPath };
  }

  const updated = await updateIssue(client, id, { description: local });
  writeBaseline(
    dir,
    {
      id: issue.id,
      identifier,
      title: updated.title ?? issue.title ?? "",
      base_hash: hashDescription(local),
      updated_at: updated.updatedAt ?? "",
    },
    local,
  );
  return { identifier, action: "pushed", path: wPath };
}
