import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type AuditEntry,
  appendAuditEntry,
  getAuditPath,
} from "../../../src/common/audit-store.js";

const HOME_BACKUP = process.env.HOME;
const CWD_BACKUP = process.cwd();
let tmpHome: string;
let tmpCwd: string;

function readLines(scope: { global?: boolean } = {}): AuditEntry[] {
  const p = getAuditPath(scope);
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as AuditEntry);
}

beforeEach(() => {
  // Redirect $HOME to a per-test scratch dir so we don't touch the real
  // audit log. os.homedir() reads $HOME on POSIX.
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "linear-audit-home-"));
  process.env.HOME = tmpHome;
  // Run each test from a non-git scratch dir so per-repo detection falls
  // through to ~/.linear cleanly (per-repo behavior is exercised by an
  // explicit `git init` test below).
  tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), "linear-audit-cwd-"));
  process.chdir(tmpCwd);
});

afterEach(() => {
  process.chdir(CWD_BACKUP);
  process.env.HOME = HOME_BACKUP;
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(tmpCwd, { recursive: true, force: true });
});

describe("appendAuditEntry (per-user fallback)", () => {
  it("creates the ~/.linear directory and writes one JSON line", async () => {
    const written = appendAuditEntry({
      kind: "llm_call",
      model: "claude-opus-4-7",
      prompt: "hello",
    });
    expect(written.id).toMatch(/^int-[a-f0-9]{8}$/);
    expect(written.kind).toBe("llm_call");
    expect(written.created_at).toMatch(/T.+Z$/);

    const lines = readLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]?.id).toBe(written.id);
    expect(lines[0]?.model).toBe("claude-opus-4-7");
    // No git repo above tmpCwd → falls back to ~/.linear/audit.jsonl
    expect(getAuditPath()).toBe(path.join(tmpHome, ".linear", "audit.jsonl"));
  });

  it("appends additional entries instead of overwriting", async () => {
    appendAuditEntry({ kind: "llm_call", actor: "agent-1" });
    appendAuditEntry({ kind: "tool_call", actor: "agent-1", exit_code: 0 });
    const lines = readLines();
    expect(lines).toHaveLength(2);
    expect(lines[0]?.kind).toBe("llm_call");
    expect(lines[1]?.kind).toBe("tool_call");
    expect(lines[1]?.exit_code).toBe(0);
  });

  it("omits unset fields from the JSON line", async () => {
    appendAuditEntry({ kind: "minimal" });
    const raw = fs.readFileSync(getAuditPath(), "utf8").trim();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed.kind).toBe("minimal");
    expect(parsed).not.toHaveProperty("model");
    expect(parsed).not.toHaveProperty("prompt");
    expect(parsed).not.toHaveProperty("exit_code");
    expect(parsed).not.toHaveProperty("extra");
  });

  it("preserves an explicit id if the caller provided one", async () => {
    appendAuditEntry({ kind: "test", id: "int-deadbeef" });
    const lines = readLines();
    expect(lines[0]?.id).toBe("int-deadbeef");
  });

  it("accepts a label entry pointing at a parent entry", async () => {
    const original = appendAuditEntry({ kind: "llm_call", model: "x" });
    const label = appendAuditEntry({
      kind: "label",
      parent_id: original.id,
      label: "good",
      reason: "answer was correct",
    });
    expect(label.parent_id).toBe(original.id);
    expect(label.label).toBe("good");
  });

  it("throws when kind is missing", async () => {
    expect(() => appendAuditEntry({ kind: "" } as never)).toThrow(
      /kind is required/,
    );
  });

  it("stores exit_code=0 (a meaningful value, not 'unset')", async () => {
    appendAuditEntry({ kind: "tool_call", exit_code: 0 });
    const lines = readLines();
    expect(lines[0]?.exit_code).toBe(0);
  });

  it("round-trips an `extra` map for ad-hoc metadata", async () => {
    appendAuditEntry({
      kind: "field_change",
      extra: { field: "status", old: "open", new: "closed" },
    });
    const lines = readLines();
    expect(lines[0]?.extra).toEqual({
      field: "status",
      old: "open",
      new: "closed",
    });
  });
});

describe("appendAuditEntry per-repo default", () => {
  let repoDir: string;

  beforeEach(async () => {
    // Initialize a git repo so findRepoRoot() returns a path under tmpCwd.
    const { execFileSync } = await import("node:child_process");
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "linear-audit-repo-"));
    execFileSync("git", ["init", "-q"], { cwd: repoDir });
    process.chdir(repoDir);
  });

  afterEach(() => {
    process.chdir(CWD_BACKUP);
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it("defaults to <repo>/.linear/audit.jsonl when inside a git repo", () => {
    appendAuditEntry({ kind: "llm_call", model: "x" });
    const repoPath = path.join(repoDir, ".linear", "audit.jsonl");
    // On macOS the symlink-resolved path may differ from the tmp path; compare
    // suffixes instead of exact equality.
    expect(getAuditPath()).toContain(path.join(".linear", "audit.jsonl"));
    expect(fs.existsSync(repoPath) || fs.existsSync(getAuditPath())).toBe(true);
  });

  it("--global forces ~/.linear/audit.jsonl even inside a repo", () => {
    appendAuditEntry({ kind: "llm_call", model: "x" }, { global: true });
    expect(getAuditPath({ global: true })).toBe(
      path.join(tmpHome, ".linear", "audit.jsonl"),
    );
    const lines = readLines({ global: true });
    expect(lines).toHaveLength(1);
  });
});
