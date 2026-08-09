import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pendingClosesQueuePath } from "../../../src/services/hooks-service.js";
import {
  type AutoCloseOutcome,
  runPostCommitAutoClose,
} from "../../../src/services/post-commit-auto-close.js";

describe("runPostCommitAutoClose", () => {
  it("returns 'skipped' with empty entries when the message has no trailer", async () => {
    const result = await runPostCommitAutoClose({
      readCommitMessage: () => "feat: refactor without close",
      closeIssue: vi.fn(),
    });

    expect(result.hook).toBe("post-commit");
    expect(result.action).toBe("skipped");
    expect(result.parsed).toEqual([]);
    expect(result.entries).toEqual([]);
    expect(result.reason).toMatch(/no close-trailers/);
  });

  it("invokes closeIssue once per parsed identifier", async () => {
    const closeIssue = vi
      .fn<(id: string) => Promise<AutoCloseOutcome>>()
      .mockResolvedValue("closed");

    const result = await runPostCommitAutoClose({
      readCommitMessage: () => "fix: stuff\n\nCloses ENG-1, ENG-2\nFixes ENG-3",
      closeIssue,
    });

    expect(closeIssue).toHaveBeenCalledTimes(3);
    expect(closeIssue.mock.calls.map((c) => c[0])).toEqual([
      "ENG-1",
      "ENG-2",
      "ENG-3",
    ]);
    expect(result.action).toBe("applied");
    expect(result.entries.map((e) => e.identifier)).toEqual([
      "ENG-1",
      "ENG-2",
      "ENG-3",
    ]);
    expect(result.entries.every((e) => e.outcome === "closed")).toBe(true);
    expect(result.detail).toBe("parsed 3, closed 3");
  });

  it("records per-issue errors without aborting the dispatch", async () => {
    const closeIssue = vi
      .fn<(id: string) => Promise<AutoCloseOutcome>>()
      .mockImplementationOnce(() => Promise.resolve("closed"))
      .mockImplementationOnce(() =>
        Promise.reject(new Error("network unreachable")),
      )
      .mockImplementationOnce(() => Promise.resolve("already-closed"));

    const result = await runPostCommitAutoClose({
      readCommitMessage: () => "Closes ENG-1, ENG-2, ENG-3",
      closeIssue,
    });

    expect(result.entries).toEqual([
      { identifier: "ENG-1", outcome: "closed" },
      {
        identifier: "ENG-2",
        outcome: "error",
        reason: "network unreachable",
      },
      { identifier: "ENG-3", outcome: "already-closed" },
    ]);
    expect(result.action).toBe("applied"); // at least one closed
    expect(result.detail).toBe("parsed 3, closed 1");
  });

  it("treats 'not-found' / 'already-closed' as a skip when nothing closed", async () => {
    const closeIssue = vi
      .fn<(id: string) => Promise<AutoCloseOutcome>>()
      .mockResolvedValueOnce("not-found")
      .mockResolvedValueOnce("already-closed");

    const result = await runPostCommitAutoClose({
      readCommitMessage: () => "Closes ENG-1, ENG-2",
      closeIssue,
    });

    expect(result.action).toBe("skipped");
    expect(result.detail).toBe("parsed 2, closed 0");
  });

  it("uppercases lowercase identifiers when passing to closeIssue", async () => {
    const closeIssue = vi
      .fn<(id: string) => Promise<AutoCloseOutcome>>()
      .mockResolvedValue("closed");

    await runPostCommitAutoClose({
      readCommitMessage: () => "Fixes eng-42",
      closeIssue,
    });

    expect(closeIssue).toHaveBeenCalledWith("ENG-42");
  });
});

describe("runPostCommitAutoClose — queue drain (lin-c3m2)", () => {
  it("prefers the queue from prepare-commit-msg over git log", async () => {
    const clear = vi.fn();
    const readCommitMessage = vi.fn(() => "Closes ENG-99"); // should NOT be called
    const closeIssue = vi
      .fn<(id: string) => Promise<AutoCloseOutcome>>()
      .mockResolvedValue("closed");

    const result = await runPostCommitAutoClose({
      readQueue: () => ({ identifiers: ["ENG-1", "ENG-2"], clear }),
      readCommitMessage,
      closeIssue,
    });

    expect(readCommitMessage).not.toHaveBeenCalled();
    expect(closeIssue.mock.calls.map((c) => c[0])).toEqual(["ENG-1", "ENG-2"]);
    expect(result.parsed).toEqual(["ENG-1", "ENG-2"]);
    expect(result.detail).toBe("parsed 2, closed 2");
    expect(clear).toHaveBeenCalledOnce();
  });

  it("clears the queue even when no closes happened (idempotency over retry-forever)", async () => {
    const clear = vi.fn();
    const closeIssue = vi
      .fn<(id: string) => Promise<AutoCloseOutcome>>()
      .mockResolvedValue("already-closed");

    await runPostCommitAutoClose({
      readQueue: () => ({ identifiers: ["ENG-1"], clear }),
      closeIssue,
    });

    expect(clear).toHaveBeenCalledOnce();
  });

  it("clears the queue when it is empty (no entries to drain)", async () => {
    const clear = vi.fn();

    const result = await runPostCommitAutoClose({
      readQueue: () => ({ identifiers: [], clear }),
      readCommitMessage: () => "irrelevant",
      closeIssue: vi.fn(),
    });

    expect(result.action).toBe("skipped");
    expect(result.parsed).toEqual([]);
    expect(clear).toHaveBeenCalledOnce();
  });

  it("retains the queue after recording a per-issue error so it can retry", async () => {
    const clear = vi.fn();
    const closeIssue = vi
      .fn<(id: string) => Promise<AutoCloseOutcome>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("closed");

    const result = await runPostCommitAutoClose({
      readQueue: () => ({ identifiers: ["ENG-1", "ENG-2"], clear }),
      closeIssue,
    });

    expect(result.entries[0]).toEqual({
      identifier: "ENG-1",
      outcome: "error",
      reason: "boom",
    });
    expect(result.entries[1]).toEqual({
      identifier: "ENG-2",
      outcome: "closed",
    });
    expect(clear).not.toHaveBeenCalled();
  });

  it("falls back to git-log parsing when no queue file is present", async () => {
    const closeIssue = vi
      .fn<(id: string) => Promise<AutoCloseOutcome>>()
      .mockResolvedValue("closed");

    const result = await runPostCommitAutoClose({
      readQueue: () => null, // no queue → fall back to git log
      readCommitMessage: () => "Fixes ENG-7",
      closeIssue,
    });

    expect(closeIssue).toHaveBeenCalledWith("ENG-7");
    expect(result.parsed).toEqual(["ENG-7"]);
  });
});

describe("runPostCommitAutoClose — default readQueue (real fs)", () => {
  let tmpdir: string;

  beforeEach(() => {
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "linear-pcac-"));
  });
  afterEach(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  });

  it("reads JSONL entries from .linear/pending-closes.jsonl and unlinks on drain", async () => {
    const queuePath = pendingClosesQueuePath(tmpdir);
    fs.mkdirSync(path.dirname(queuePath), { recursive: true });
    fs.writeFileSync(
      queuePath,
      `${JSON.stringify({ commit_token: "/m1", identifiers: ["ENG-1", "ENG-2"] })}\n${JSON.stringify({ commit_token: "/m2", identifiers: ["ENG-2", "ENG-3"] })}\n`,
    );

    const closeIssue = vi
      .fn<(id: string) => Promise<AutoCloseOutcome>>()
      .mockResolvedValue("closed");

    const result = await runPostCommitAutoClose({
      cwd: tmpdir,
      closeIssue,
    });

    // De-duplication: ENG-2 appears in both entries but is closed once.
    expect(result.parsed).toEqual(["ENG-1", "ENG-2", "ENG-3"]);
    expect(closeIssue).toHaveBeenCalledTimes(3);
    // Queue file is unlinked after drain.
    expect(fs.existsSync(queuePath)).toBe(false);
  });

  it("returns null (falls back) when the queue file does not exist", async () => {
    const closeIssue = vi
      .fn<(id: string) => Promise<AutoCloseOutcome>>()
      .mockResolvedValue("closed");

    const result = await runPostCommitAutoClose({
      cwd: tmpdir,
      readCommitMessage: () => "Closes ENG-42",
      closeIssue,
    });

    expect(closeIssue).toHaveBeenCalledWith("ENG-42");
    expect(result.parsed).toEqual(["ENG-42"]);
  });

  it("skips unparseable JSONL lines without aborting the drain", async () => {
    const queuePath = pendingClosesQueuePath(tmpdir);
    fs.mkdirSync(path.dirname(queuePath), { recursive: true });
    fs.writeFileSync(
      queuePath,
      [
        "not-json",
        JSON.stringify({ commit_token: "/m", identifiers: ["ENG-1"] }),
        "{}", // missing identifiers
        "",
      ].join("\n"),
    );

    const closeIssue = vi
      .fn<(id: string) => Promise<AutoCloseOutcome>>()
      .mockResolvedValue("closed");

    const result = await runPostCommitAutoClose({
      cwd: tmpdir,
      closeIssue,
    });

    expect(result.parsed).toEqual(["ENG-1"]);
    expect(fs.existsSync(queuePath)).toBe(false);
  });
});
