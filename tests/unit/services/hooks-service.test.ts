import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildBeginMarker,
  buildEndMarker,
  checkHooksInstalled,
  GitRepoMissingError,
  HOOK_AUTH_MISSING_EXIT_CODE,
  HOOK_BEGIN_MARKER,
  HOOK_END_MARKER,
  HOOK_TIMEOUT_SECONDS,
  installHooks,
  isHookName,
  LEFTHOOK_FILE,
  LEFTHOOK_LOCAL_FILE,
  LINEAR_HOOKS_VERSION,
  MANAGED_HOOKS,
  PENDING_CLOSES_QUEUE_PATH,
  parseHookVersion,
  pendingClosesQueuePath,
  runHook,
  SHARED_HOOKS_DIR,
  TRAILER_KEY,
  uninstallHooks,
  WIRED_HOOKS,
} from "../../../src/services/hooks-service.js";

function makeFs(initial: Record<string, string>) {
  const store = { ...initial };
  // Per-path queue lines so tests can assert exactly what was appended.
  const queues: Record<string, string[]> = {};
  return {
    store,
    queues,
    adapter: {
      readFile: (p: string): string => {
        if (!(p in store)) throw new Error(`ENOENT: ${p}`);
        return store[p];
      },
      writeFile: (p: string, data: string): void => {
        store[p] = data;
      },
      appendQueue: (p: string, line: string): void => {
        queues[p] ??= [];
        queues[p].push(line.endsWith("\n") ? line.slice(0, -1) : line);
      },
    },
  };
}

describe("isHookName + MANAGED_HOOKS", () => {
  it("recognizes the five managed hooks", () => {
    for (const h of MANAGED_HOOKS) expect(isHookName(h)).toBe(true);
  });
  it("rejects anything else", () => {
    expect(isHookName("post-receive")).toBe(false);
    expect(isHookName("PRE-COMMIT")).toBe(false);
  });
});

describe("WIRED_HOOKS surface (inert four)", () => {
  it("includes pre-commit (lin-5zxw)", () => {
    expect(WIRED_HOOKS).toContain("pre-commit");
  });
  it("includes post-merge (lin-obzs)", () => {
    expect(WIRED_HOOKS).toContain("post-merge");
  });
  it("includes pre-push (lin-4va1)", () => {
    expect(WIRED_HOOKS).toContain("pre-push");
  });
  it("includes post-checkout (lin-8anv)", () => {
    expect(WIRED_HOOKS).toContain("post-checkout");
  });
});

describe("runHook — prepare-commit-msg", () => {
  it("appends Executed-By trailer when LINEAR_ACTOR is set", () => {
    const { store, adapter } = makeFs({ "/m": "initial body\n" });
    const result = runHook({
      hook: "prepare-commit-msg",
      args: ["/m"],
      actor: "claude-session-42",
      fsAdapter: adapter,
    });
    expect(result.action).toBe("applied");
    expect(store["/m"]).toContain(`${TRAILER_KEY}: claude-session-42`);
  });

  it("is a no-op when LINEAR_ACTOR is unset", () => {
    const { adapter } = makeFs({ "/m": "body" });
    const result = runHook({
      hook: "prepare-commit-msg",
      args: ["/m"],
      env: {},
      fsAdapter: adapter,
    });
    expect(result.action).toBe("skipped");
    expect(result.reason).toMatch(/LINEAR_ACTOR/);
  });

  it("is a no-op for merge commits (source=merge)", () => {
    const { store, adapter } = makeFs({ "/m": "Merge branch ..." });
    const result = runHook({
      hook: "prepare-commit-msg",
      args: ["/m", "merge"],
      actor: "a",
      fsAdapter: adapter,
    });
    expect(result.action).toBe("skipped");
    expect(result.reason).toMatch(/merge/);
    expect(store["/m"]).toBe("Merge branch ...");
  });

  it("does not duplicate the trailer on amend", () => {
    const { adapter } = makeFs({
      "/m": `body\n\n${TRAILER_KEY}: claude\n`,
    });
    const result = runHook({
      hook: "prepare-commit-msg",
      args: ["/m"],
      actor: "claude",
      fsAdapter: adapter,
    });
    expect(result.action).toBe("skipped");
    expect(result.reason).toMatch(/already present/);
  });

  it("skips gracefully when the message file is missing", () => {
    const { adapter } = makeFs({});
    const result = runHook({
      hook: "prepare-commit-msg",
      args: ["/nope"],
      actor: "a",
      fsAdapter: adapter,
    });
    expect(result.action).toBe("skipped");
    expect(result.reason).toMatch(/could not read/);
  });

  it("skips gracefully when no message file is provided", () => {
    const result = runHook({
      hook: "prepare-commit-msg",
      args: [],
      actor: "a",
    });
    expect(result.action).toBe("skipped");
    expect(result.reason).toMatch(/no message file/);
  });

  it("env LINEAR_ACTOR fallback works when actor opt is missing", () => {
    const { store, adapter } = makeFs({ "/m": "x" });
    const result = runHook({
      hook: "prepare-commit-msg",
      args: ["/m"],
      env: { LINEAR_ACTOR: "env-actor" },
      fsAdapter: adapter,
    });
    expect(result.action).toBe("applied");
    expect(store["/m"]).toContain("Executed-By: env-actor");
  });
});

describe("runHook — prepare-commit-msg close-trailer queue (lin-c3m2)", () => {
  it("queues close-trailers to .linear/pending-closes.jsonl when message contains Closes/Fixes/Resolves", () => {
    const { queues, adapter } = makeFs({
      "/m": "feat: do thing\n\nCloses ENG-1, ENG-2\nFixes #eng-3\n",
    });
    const result = runHook({
      hook: "prepare-commit-msg",
      args: ["/m"],
      actor: "claude",
      fsAdapter: adapter,
      cwd: "/repo",
    });
    expect(result.action).toBe("applied");
    expect(result.detail).toMatch(/queued 3 close-trailers/);
    const queuePath = pendingClosesQueuePath("/repo");
    expect(queues[queuePath]).toHaveLength(1);
    const entry = JSON.parse(queues[queuePath][0]) as {
      commit_token: string;
      identifiers: string[];
    };
    expect(entry.commit_token).toBe("/m");
    expect(entry.identifiers).toEqual(["ENG-1", "ENG-2", "ENG-3"]);
  });

  it("does not write to the queue when no close-trailers present", () => {
    const { queues, adapter } = makeFs({ "/m": "chore: no close keywords\n" });
    runHook({
      hook: "prepare-commit-msg",
      args: ["/m"],
      actor: "claude",
      fsAdapter: adapter,
      cwd: "/repo",
    });
    expect(Object.keys(queues)).toHaveLength(0);
  });

  it("queues close-trailers even when LINEAR_ACTOR is unset (close-trailers are independent)", () => {
    const { queues, store, adapter } = makeFs({
      "/m": "Closes ENG-7\n",
    });
    const result = runHook({
      hook: "prepare-commit-msg",
      args: ["/m"],
      env: {},
      fsAdapter: adapter,
      cwd: "/repo",
    });
    expect(result.action).toBe("applied");
    expect(result.detail).toMatch(/queued 1 close-trailer/);
    // No actor → message file untouched.
    expect(store["/m"]).toBe("Closes ENG-7\n");
    const queuePath = pendingClosesQueuePath("/repo");
    expect(queues[queuePath]).toBeDefined();
  });

  it("queues both AND appends actor trailer when both apply", () => {
    const { queues, store, adapter } = makeFs({
      "/m": "feat: x\n\nResolves ENG-5\n",
    });
    const result = runHook({
      hook: "prepare-commit-msg",
      args: ["/m"],
      actor: "claude",
      fsAdapter: adapter,
      cwd: "/repo",
    });
    expect(result.action).toBe("applied");
    expect(result.detail).toContain("appended Executed-By: claude");
    expect(result.detail).toContain("queued 1 close-trailer");
    expect(store["/m"]).toContain("Executed-By: claude");
    const queuePath = pendingClosesQueuePath("/repo");
    expect(queues[queuePath]).toBeDefined();
  });

  it("skips queue write on merge commits (source=merge)", () => {
    const { queues, adapter } = makeFs({
      "/m": "Merge branch ...\n\nFixes ENG-9\n",
    });
    const result = runHook({
      hook: "prepare-commit-msg",
      args: ["/m", "merge"],
      actor: "claude",
      fsAdapter: adapter,
      cwd: "/repo",
    });
    expect(result.action).toBe("skipped");
    expect(Object.keys(queues)).toHaveLength(0);
  });

  it("re-running on the same message file re-queues identifiers (drain handles dedup)", () => {
    // Idempotency lives in the drain step (post-commit dedupes the
    // flattened identifier list), not in the queue write. This lets
    // `git commit --amend` re-record the trailer without us trying to
    // detect "did we already queue this for this commit-token?".
    const { queues, adapter } = makeFs({ "/m": "Closes ENG-1\n" });
    runHook({
      hook: "prepare-commit-msg",
      args: ["/m"],
      actor: "claude",
      fsAdapter: adapter,
      cwd: "/repo",
    });
    runHook({
      hook: "prepare-commit-msg",
      args: ["/m"],
      actor: "claude",
      fsAdapter: adapter,
      cwd: "/repo",
    });
    const queuePath = pendingClosesQueuePath("/repo");
    expect(queues[queuePath]).toHaveLength(2);
  });

  it("PENDING_CLOSES_QUEUE_PATH is a stable relative constant", () => {
    expect(PENDING_CLOSES_QUEUE_PATH).toBe(".linear/pending-closes.jsonl");
  });
});

describe("runHook — recognized-but-no-op hooks", () => {
  it("returns skipped for pre-commit, post-merge, pre-push, post-checkout", () => {
    for (const h of [
      "pre-commit",
      "post-merge",
      "pre-push",
      "post-checkout",
    ] as const) {
      const r = runHook({ hook: h, args: [] });
      expect(r.action).toBe("skipped");
      // narrative comes from HOOK_NARRATIVES (lin-dnhj)
      expect(r.reason).toBeTruthy();
      expect(r.reason).toMatch(/No-op\.$/);
    }
  });

  it("pre-commit dispatch returns the spec narrative", () => {
    const r = runHook({ hook: "pre-commit", args: [] });
    expect(r.action).toBe("skipped");
    expect(r.reason).toContain("no local issue DB");
    expect(r.reason).toContain("source of truth");
  });

  it("post-merge dispatch returns the spec narrative", () => {
    const r = runHook({ hook: "post-merge", args: [] });
    expect(r.action).toBe("skipped");
    expect(r.reason).toContain("git pull");
    expect(r.reason).toContain("workspace-global");
  });

  it("pre-push dispatch returns the spec narrative", () => {
    const r = runHook({ hook: "pre-push", args: [] });
    expect(r.action).toBe("skipped");
    expect(r.reason).toContain("no local issue remote");
    expect(r.reason).toContain("GraphQL");
  });

  it("post-checkout dispatch returns the spec narrative", () => {
    const r = runHook({ hook: "post-checkout", args: [] });
    expect(r.action).toBe("skipped");
    expect(r.reason).toContain("per-branch");
    expect(r.reason).toContain("workspace-global");
  });
});

// ──────────────────────────────────────────────────────────────────────
// install / uninstall / check — managed lefthook.local.yml block
// ──────────────────────────────────────────────────────────────────────

describe("installHooks / uninstallHooks / checkHooksInstalled — lefthook target", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "linear-hooks-")),
    );
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  function writeLefthook(): void {
    fs.writeFileSync(
      path.join(cwd, LEFTHOOK_FILE),
      "pre-commit:\n  commands:\n    sample:\n      run: echo hi\n",
    );
  }

  it("throws GitRepoMissingError when neither lefthook nor .git is present", () => {
    expect(() => installHooks({ cwd })).toThrow(GitRepoMissingError);
  });

  it("writes a fresh lefthook.local.yml when none exists", () => {
    writeLefthook();
    const result = installHooks({ cwd });
    expect(result.action).toBe("installed");
    expect(result.path).toBe(path.join(cwd, LEFTHOOK_LOCAL_FILE));
    expect(result.hook_names).toEqual(WIRED_HOOKS);

    const written = fs.readFileSync(result.path, "utf8");
    expect(written).toContain(HOOK_BEGIN_MARKER);
    expect(written).toContain(HOOK_END_MARKER);
    expect(written).toContain("prepare-commit-msg:");
    expect(written).toContain("linear hooks run prepare-commit-msg {1}");
  });

  it("preserves existing lefthook.local.yml content outside the managed block", () => {
    writeLefthook();
    const localPath = path.join(cwd, LEFTHOOK_LOCAL_FILE);
    fs.writeFileSync(
      localPath,
      "post-merge:\n  commands:\n    foo:\n      run: echo foo\n",
    );

    const result = installHooks({ cwd });
    expect(result.action).toBe("installed");

    const written = fs.readFileSync(localPath, "utf8");
    // user's content is still there
    expect(written).toContain("run: echo foo");
    // the managed block is appended below
    expect(written).toContain(HOOK_BEGIN_MARKER);
    // managed block sits *after* the user's content
    expect(written.indexOf(HOOK_BEGIN_MARKER)).toBeGreaterThan(
      written.indexOf("run: echo foo"),
    );
  });

  it("returns 'current' when the managed block is already up to date", () => {
    writeLefthook();
    installHooks({ cwd });
    const result = installHooks({ cwd });
    expect(result.action).toBe("current");
  });

  it("replaces a stale managed block in place ('updated')", () => {
    writeLefthook();
    const localPath = path.join(cwd, LEFTHOOK_LOCAL_FILE);
    fs.writeFileSync(
      localPath,
      `${HOOK_BEGIN_MARKER}\nstale: stuff\n${HOOK_END_MARKER}\n`,
    );
    const result = installHooks({ cwd });
    expect(result.action).toBe("updated");

    const written = fs.readFileSync(localPath, "utf8");
    expect(written).not.toContain("stale: stuff");
    expect(written).toContain("linear hooks run prepare-commit-msg {1}");
  });

  it("uninstall is a no-op when no lefthook.local.yml exists", () => {
    const result = uninstallHooks({ cwd });
    expect(result.action).toBe("absent");
  });

  it("uninstall is a no-op when the file exists without the managed block", () => {
    const localPath = path.join(cwd, LEFTHOOK_LOCAL_FILE);
    fs.writeFileSync(localPath, "user-only:\n  commands: {}\n");
    const result = uninstallHooks({ cwd });
    expect(result.action).toBe("absent");
    // file is untouched
    expect(fs.readFileSync(localPath, "utf8")).toContain("user-only");
  });

  it("uninstall removes the managed block and preserves user content", () => {
    writeLefthook();
    const localPath = path.join(cwd, LEFTHOOK_LOCAL_FILE);
    fs.writeFileSync(localPath, "user-line: 1\n");
    installHooks({ cwd });
    const result = uninstallHooks({ cwd });
    expect(result.action).toBe("removed");
    const after = fs.readFileSync(localPath, "utf8");
    expect(after).toContain("user-line: 1");
    expect(after).not.toContain(HOOK_BEGIN_MARKER);
  });

  it("uninstall deletes the file if removing the managed block empties it", () => {
    writeLefthook();
    const localPath = path.join(cwd, LEFTHOOK_LOCAL_FILE);
    installHooks({ cwd });
    expect(fs.existsSync(localPath)).toBe(true);
    const result = uninstallHooks({ cwd });
    expect(result.action).toBe("removed");
    expect(fs.existsSync(localPath)).toBe(false);
  });

  it("checkHooksInstalled reports installed=false / lefthook_present=false / target=git-hooks on a bare dir", () => {
    const status = checkHooksInstalled({ cwd });
    expect(status.installed).toBe(false);
    expect(status.lefthook_present).toBe(false);
    expect(status.target).toBe("git-hooks");
    expect(status.hook_names).toEqual(WIRED_HOOKS);
  });

  it("checkHooksInstalled flips to installed=true after install", () => {
    writeLefthook();
    expect(checkHooksInstalled({ cwd }).installed).toBe(false);
    installHooks({ cwd });
    const status = checkHooksInstalled({ cwd });
    expect(status.installed).toBe(true);
    expect(status.lefthook_present).toBe(true);
  });

  it("checkHooksInstalled flips back to installed=false after uninstall", () => {
    writeLefthook();
    installHooks({ cwd });
    uninstallHooks({ cwd });
    expect(checkHooksInstalled({ cwd }).installed).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────
// install / uninstall / check — .git/hooks shim fallback (no lefthook)
// ──────────────────────────────────────────────────────────────────────

describe("installHooks / uninstallHooks / checkHooksInstalled — git-hooks target", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "linear-hooks-git-")),
    );
    // Fake-init: just create .git/hooks. Real `git init` is overkill for unit tests.
    fs.mkdirSync(path.join(cwd, ".git", "hooks"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  function hookPath(name: string): string {
    return path.join(cwd, ".git", "hooks", name);
  }

  it("writes a marker-bracketed shim into .git/hooks/<name> when no lefthook is present", () => {
    const result = installHooks({ cwd });
    expect(result.target).toBe("git-hooks");
    expect(result.action).toBe("installed");
    expect(result.hook_names).toEqual(WIRED_HOOKS);

    const content = fs.readFileSync(hookPath("prepare-commit-msg"), "utf8");
    expect(content.startsWith("#!/bin/sh")).toBe(true);
    expect(content).toContain(HOOK_BEGIN_MARKER);
    expect(content).toContain(HOOK_END_MARKER);
    expect(content).toContain("linear hooks run prepare-commit-msg");
  });

  it("chmods the shim to 0755", () => {
    installHooks({ cwd });
    const mode = fs.statSync(hookPath("prepare-commit-msg")).mode & 0o777;
    expect(mode).toBe(0o755);
  });

  it("preserves user content outside the managed block in an existing hook", () => {
    fs.writeFileSync(
      hookPath("prepare-commit-msg"),
      "#!/bin/sh\necho 'user hook body'\n",
    );
    installHooks({ cwd });
    const content = fs.readFileSync(hookPath("prepare-commit-msg"), "utf8");
    expect(content).toContain("user hook body");
    expect(content).toContain(HOOK_BEGIN_MARKER);
    // user content stays before the managed block
    expect(content.indexOf("user hook body")).toBeLessThan(
      content.indexOf(HOOK_BEGIN_MARKER),
    );
  });

  it("does not re-add a shebang if one is already present", () => {
    fs.writeFileSync(hookPath("prepare-commit-msg"), "#!/bin/bash\necho hi\n");
    installHooks({ cwd });
    const content = fs.readFileSync(hookPath("prepare-commit-msg"), "utf8");
    expect(content.startsWith("#!/bin/bash")).toBe(true);
    expect(content.split("\n").filter((l) => l.startsWith("#!")).length).toBe(
      1,
    );
  });

  it("returns 'current' when the managed block is already up to date", () => {
    installHooks({ cwd });
    const result = installHooks({ cwd });
    expect(result.action).toBe("current");
  });

  it("replaces a stale managed block in place ('updated')", () => {
    fs.writeFileSync(
      hookPath("prepare-commit-msg"),
      `#!/bin/sh\n${HOOK_BEGIN_MARKER}\necho stale\n${HOOK_END_MARKER}\n`,
    );
    const result = installHooks({ cwd });
    expect(result.action).toBe("updated");
    const content = fs.readFileSync(hookPath("prepare-commit-msg"), "utf8");
    expect(content).not.toContain("echo stale");
    expect(content).toContain("linear hooks run prepare-commit-msg");
  });

  it("uninstall removes the managed block and deletes the file when nothing else remains", () => {
    installHooks({ cwd });
    const result = uninstallHooks({ cwd });
    expect(result.target).toBe("git-hooks");
    expect(result.action).toBe("removed");
    expect(fs.existsSync(hookPath("prepare-commit-msg"))).toBe(false);
  });

  it("uninstall preserves user content outside the managed block", () => {
    fs.writeFileSync(
      hookPath("prepare-commit-msg"),
      "#!/bin/sh\necho 'keep me'\n",
    );
    installHooks({ cwd });
    const result = uninstallHooks({ cwd });
    expect(result.action).toBe("removed");
    const content = fs.readFileSync(hookPath("prepare-commit-msg"), "utf8");
    expect(content).toContain("keep me");
    expect(content).not.toContain(HOOK_BEGIN_MARKER);
  });

  it("uninstall is a no-op when the hook file does not exist", () => {
    const result = uninstallHooks({ cwd });
    expect(result.action).toBe("absent");
  });

  it("uninstall is a no-op when the hook file exists without the managed block", () => {
    fs.writeFileSync(
      hookPath("prepare-commit-msg"),
      "#!/bin/sh\necho user-only\n",
    );
    const result = uninstallHooks({ cwd });
    expect(result.action).toBe("absent");
    const content = fs.readFileSync(hookPath("prepare-commit-msg"), "utf8");
    expect(content).toContain("user-only");
  });

  it("checkHooksInstalled flips to installed=true after install (git-hooks target)", () => {
    expect(checkHooksInstalled({ cwd }).installed).toBe(false);
    installHooks({ cwd });
    const status = checkHooksInstalled({ cwd });
    expect(status.installed).toBe(true);
    expect(status.target).toBe("git-hooks");
    expect(status.lefthook_present).toBe(false);
  });

  it("checkHooksInstalled flips back to installed=false after uninstall (git-hooks target)", () => {
    installHooks({ cwd });
    uninstallHooks({ cwd });
    expect(checkHooksInstalled({ cwd }).installed).toBe(false);
  });

  // ── --force / --chain (lin-j1bp) ──────────────────────────────────────

  it("--force re-stamps an already-current block ('updated' not 'current')", () => {
    installHooks({ cwd });
    expect(installHooks({ cwd }).action).toBe("current");
    const forced = installHooks({ cwd, force: true });
    expect(forced.action).toBe("updated");
    // The block is still well-formed after the forced rewrite.
    const content = fs.readFileSync(hookPath("prepare-commit-msg"), "utf8");
    expect(content).toContain(HOOK_BEGIN_MARKER);
    expect(content).toContain("linear hooks run prepare-commit-msg");
  });

  it("reports chained=true when pre-existing user content is preserved", () => {
    fs.writeFileSync(
      hookPath("prepare-commit-msg"),
      "#!/bin/sh\necho 'user hook body'\n",
    );
    const result = installHooks({ cwd, chain: true });
    expect(result.chained).toBe(true);
    expect(result.shared).toBe(false);
    const content = fs.readFileSync(hookPath("prepare-commit-msg"), "utf8");
    // user content runs before the managed dispatch (chained in-place)
    expect(content.indexOf("user hook body")).toBeLessThan(
      content.indexOf(HOOK_BEGIN_MARKER),
    );
  });

  it("reports chained=false for a fresh install with no pre-existing hook", () => {
    const result = installHooks({ cwd });
    expect(result.chained).toBe(false);
    expect(result.shared).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Versioned markers + shim renderer (lin-g4s7)
// ──────────────────────────────────────────────────────────────────────

describe("versioned markers", () => {
  it("buildBeginMarker emits the versioned begin line", () => {
    expect(buildBeginMarker("9.9.9")).toBe(
      "# --- BEGIN LINEAR HOOKS v9.9.9 ---",
    );
  });

  it("buildEndMarker emits the versioned end line", () => {
    expect(buildEndMarker("9.9.9")).toBe("# --- END LINEAR HOOKS v9.9.9 ---");
  });

  it("HOOK_BEGIN_MARKER is now the prefix (no version)", () => {
    expect(HOOK_BEGIN_MARKER).toBe("# --- BEGIN LINEAR HOOKS");
    expect(HOOK_END_MARKER).toBe("# --- END LINEAR HOOKS");
  });

  it("parseHookVersion extracts the version from a marker line", () => {
    expect(parseHookVersion("# --- BEGIN LINEAR HOOKS v2026.4.9 ---")).toBe(
      "2026.4.9",
    );
    expect(parseHookVersion("# --- END LINEAR HOOKS v9.9.9 ---")).toBe("9.9.9");
  });

  it("parseHookVersion returns undefined for legacy unversioned markers", () => {
    expect(parseHookVersion("# --- BEGIN LINEAR HOOKS ---")).toBeUndefined();
  });

  it("LINEAR_HOOKS_VERSION is a non-empty string", () => {
    expect(typeof LINEAR_HOOKS_VERSION).toBe("string");
    expect(LINEAR_HOOKS_VERSION.length).toBeGreaterThan(0);
  });
});

describe("git-hooks shim renderer (buildGitHookShim via installHooks)", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "linear-hooks-shim-")),
    );
    fs.mkdirSync(path.join(cwd, ".git", "hooks"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  function readShim(name: string): string {
    return fs.readFileSync(path.join(cwd, ".git", "hooks", name), "utf8");
  }

  it("emits a version-stamped begin/end marker", () => {
    installHooks({ cwd });
    const shim = readShim("prepare-commit-msg");
    expect(shim).toContain(buildBeginMarker(LINEAR_HOOKS_VERSION));
    expect(shim).toContain(buildEndMarker(LINEAR_HOOKS_VERSION));
  });

  it("includes the LINEAR_GIT_HOOK env export", () => {
    installHooks({ cwd });
    expect(readShim("prepare-commit-msg")).toContain(
      "export LINEAR_GIT_HOOK=1",
    );
  });

  it("includes the timeout wrap with LINEAR_HOOK_TIMEOUT default", () => {
    installHooks({ cwd });
    const shim = readShim("prepare-commit-msg");
    expect(shim).toContain(
      `_lin_timeout=\${LINEAR_HOOK_TIMEOUT:-${HOOK_TIMEOUT_SECONDS}}`,
    );
    expect(shim).toContain("command -v timeout");
    expect(shim).toContain(
      'timeout "$_lin_timeout" linear hooks run prepare-commit-msg',
    );
  });

  it("includes the timeout-124 graceful skip branch", () => {
    installHooks({ cwd });
    const shim = readShim("prepare-commit-msg");
    expect(shim).toContain("[ $_lin_exit -eq 124 ]");
    expect(shim).toContain("timed out");
  });

  it("includes the exit-3 auth-missing graceful skip branch", () => {
    installHooks({ cwd });
    const shim = readShim("prepare-commit-msg");
    expect(shim).toContain(`[ $_lin_exit -eq ${HOOK_AUTH_MISSING_EXIT_CODE} ]`);
    expect(shim).toContain("auth not configured");
  });

  it("includes the fallback path when 'timeout' is missing", () => {
    installHooks({ cwd });
    const shim = readShim("prepare-commit-msg");
    // The else branch invokes linear hooks run directly (no `timeout` wrap)
    expect(shim).toMatch(/else\n\s+linear hooks run prepare-commit-msg/);
  });

  it("propagates non-zero exit codes via exit $_lin_exit", () => {
    installHooks({ cwd });
    expect(readShim("prepare-commit-msg")).toContain(
      "if [ $_lin_exit -ne 0 ]; then exit $_lin_exit; fi",
    );
  });

  it("detects an outdated installed block (legacy unversioned)", () => {
    const hookPath = path.join(cwd, ".git", "hooks", "prepare-commit-msg");
    fs.writeFileSync(
      hookPath,
      `#!/bin/sh\n# --- BEGIN LINEAR HOOKS ---\necho legacy\n# --- END LINEAR HOOKS ---\n`,
    );
    const status = checkHooksInstalled({ cwd });
    expect(status.installed).toBe(true);
    expect(status.outdated).toBe(true);
    expect(status.current_version).toBe(LINEAR_HOOKS_VERSION);
  });

  it("detects an outdated installed block (mismatched version)", () => {
    const hookPath = path.join(cwd, ".git", "hooks", "prepare-commit-msg");
    fs.writeFileSync(
      hookPath,
      `#!/bin/sh\n# --- BEGIN LINEAR HOOKS v0.0.0 ---\necho old\n# --- END LINEAR HOOKS v0.0.0 ---\n`,
    );
    const status = checkHooksInstalled({ cwd });
    expect(status.installed).toBe(true);
    expect(status.outdated).toBe(true);
    expect(status.installed_version).toBe("0.0.0");
  });

  it("reports outdated=false right after a fresh install", () => {
    installHooks({ cwd });
    const status = checkHooksInstalled({ cwd });
    expect(status.installed).toBe(true);
    expect(status.outdated).toBe(false);
    expect(status.installed_version).toBe(LINEAR_HOOKS_VERSION);
  });
});

describe("lefthook section renderer", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "linear-hooks-leftshim-")),
    );
    fs.writeFileSync(
      path.join(cwd, LEFTHOOK_FILE),
      "pre-commit:\n  commands:\n    sample:\n      run: echo hi\n",
    );
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("emits version-stamped markers", () => {
    installHooks({ cwd });
    const text = fs.readFileSync(path.join(cwd, LEFTHOOK_LOCAL_FILE), "utf8");
    expect(text).toContain(buildBeginMarker(LINEAR_HOOKS_VERSION));
    expect(text).toContain(buildEndMarker(LINEAR_HOOKS_VERSION));
  });

  it("wires every WIRED_HOOKS entry", () => {
    installHooks({ cwd });
    const text = fs.readFileSync(path.join(cwd, LEFTHOOK_LOCAL_FILE), "utf8");
    for (const hook of WIRED_HOOKS) {
      expect(text).toContain(`${hook}:`);
      expect(text).toContain(`linear-${hook}:`);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// install/uninstall --shared (lin-j1bp): committable .linear-hooks/ dir
// + core.hooksPath. Needs a real git repo so `git config core.hooksPath`
// and `git rev-parse` resolve.
// ──────────────────────────────────────────────────────────────────────

describe("installHooks / uninstallHooks --shared (git-hooks, shared dir)", () => {
  let cwd: string;

  // Never throws: `git config --get <missing-key>` exits non-zero, which we
  // map to "" so tests can assert an unset key cleanly.
  function gitC(args: string[]): string {
    try {
      return execFileSync("git", ["-C", cwd, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return "";
    }
  }

  beforeEach(() => {
    cwd = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "linear-hooks-shared-")),
    );
    execFileSync("git", ["-C", cwd, "init", "-q"], { stdio: "ignore" });
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("writes shims into .linear-hooks/ and sets core.hooksPath (absolute)", () => {
    const result = installHooks({ cwd, shared: true });
    expect(result.shared).toBe(true);
    expect(result.target).toBe("git-hooks");
    expect(result.action).toBe("installed");

    const sharedDir = path.join(cwd, SHARED_HOOKS_DIR);
    expect(result.hooks_path).toBe(sharedDir);
    // shim lives in the committable dir, not .git/hooks
    const shim = path.join(sharedDir, "prepare-commit-msg");
    expect(fs.existsSync(shim)).toBe(true);
    expect(fs.readFileSync(shim, "utf8")).toContain(
      "linear hooks run prepare-commit-msg",
    );
    // core.hooksPath points at the absolute shared dir (worktree-safe)
    expect(path.resolve(gitC(["config", "--get", "core.hooksPath"]))).toBe(
      path.resolve(sharedDir),
    );
  });

  it("chmods shared shims executable", () => {
    installHooks({ cwd, shared: true });
    const mode =
      fs.statSync(path.join(cwd, SHARED_HOOKS_DIR, "post-commit")).mode & 0o777;
    expect(mode).toBe(0o755);
  });

  it("uninstall --shared strips shims and resets core.hooksPath", () => {
    installHooks({ cwd, shared: true });
    const result = uninstallHooks({ cwd, shared: true });
    expect(result.shared).toBe(true);
    expect(result.action).toBe("removed");
    expect(result.hooks_path_reset).toBe(true);
    expect(fs.existsSync(path.join(cwd, SHARED_HOOKS_DIR, "post-commit"))).toBe(
      false,
    );
    // core.hooksPath was unset (gitC maps the non-zero "unset key" exit to "")
    expect(gitC(["config", "--get", "core.hooksPath"])).toBe("");
  });

  it("uninstall --shared does NOT reset a user-set core.hooksPath", () => {
    installHooks({ cwd, shared: true });
    // user repoints core.hooksPath somewhere of their own
    const custom = path.join(cwd, "my-hooks");
    fs.mkdirSync(custom, { recursive: true });
    gitC(["config", "core.hooksPath", custom]);
    const result = uninstallHooks({ cwd, shared: true });
    expect(result.hooks_path_reset).toBe(false);
    expect(path.resolve(gitC(["config", "--get", "core.hooksPath"]))).toBe(
      path.resolve(custom),
    );
  });

  it("--force re-stamps the shared block ('updated')", () => {
    installHooks({ cwd, shared: true });
    expect(installHooks({ cwd, shared: true }).action).toBe("current");
    expect(installHooks({ cwd, shared: true, force: true }).action).toBe(
      "updated",
    );
  });
});
