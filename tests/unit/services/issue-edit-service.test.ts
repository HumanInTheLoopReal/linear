import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import { EXIT_CONFLICT, LinearError } from "../../../src/common/errors.js";
import {
  hashDescription,
  pullIssue,
  pushIssue,
} from "../../../src/services/issue-edit-service.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "linear-edits-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Client whose first request resolves the issue read; later requests
 *  (issueUpdate) can be appended per test. */
function clientWithIssue(description: string, extra: unknown[] = []) {
  const request = vi.fn().mockResolvedValueOnce({
    issue: {
      id: "uuid-1",
      identifier: "TES-9",
      title: "Test issue",
      description,
      updatedAt: "2026-07-09T00:00:00.000Z",
    },
  });
  for (const response of extra) request.mockResolvedValueOnce(response);
  return { request } as unknown as GraphQLClient;
}

function issueUpdateResponse(description: string) {
  return {
    issueUpdate: {
      success: true,
      issue: {
        id: "uuid-1",
        identifier: "TES-9",
        title: "Test issue",
        description,
        updatedAt: "2026-07-09T01:00:00.000Z",
      },
    },
  };
}

describe("pullIssue", () => {
  it("writes working copy, baseline, and meta", async () => {
    const result = await pullIssue(clientWithIssue("hello\nworld"), "uuid-1", {
      dir,
    });
    expect(result.action).toBe("pulled");
    expect(result.path).toBe(path.join(dir, "TES-9.md"));
    expect(fs.readFileSync(result.path, "utf8")).toBe("hello\nworld\n");
    expect(fs.readFileSync(path.join(dir, "TES-9.base.md"), "utf8")).toBe(
      "hello\nworld\n",
    );
    const meta = JSON.parse(
      fs.readFileSync(path.join(dir, "TES-9.meta.json"), "utf8"),
    );
    expect(meta.identifier).toBe("TES-9");
    expect(meta.base_hash).toBe(hashDescription("hello\nworld"));
  });

  it("refuses to overwrite a dirty working copy without --force", async () => {
    await pullIssue(clientWithIssue("v1"), "uuid-1", { dir });
    fs.writeFileSync(path.join(dir, "TES-9.md"), "local edit\n");
    await expect(
      pullIssue(clientWithIssue("v1"), "uuid-1", { dir }),
    ).rejects.toThrow(/unpushed local edits/);
  });

  it("--force overwrites but backs up the dirty copy", async () => {
    await pullIssue(clientWithIssue("v1"), "uuid-1", { dir });
    fs.writeFileSync(path.join(dir, "TES-9.md"), "local edit\n");
    const result = await pullIssue(clientWithIssue("v2"), "uuid-1", {
      dir,
      force: true,
    });
    expect(result.backup_path).toBe(path.join(dir, "TES-9.local.bak.md"));
    expect(fs.readFileSync(result.backup_path as string, "utf8")).toBe(
      "local edit\n",
    );
    expect(fs.readFileSync(path.join(dir, "TES-9.md"), "utf8")).toBe("v2\n");
  });

  it("re-pull over a clean working copy refreshes silently", async () => {
    await pullIssue(clientWithIssue("v1"), "uuid-1", { dir });
    const result = await pullIssue(clientWithIssue("v2"), "uuid-1", { dir });
    expect(result.backup_path).toBeUndefined();
    expect(fs.readFileSync(path.join(dir, "TES-9.md"), "utf8")).toBe("v2\n");
  });
});

describe("pushIssue", () => {
  it("errors with a pull hint when nothing was pulled", async () => {
    await expect(
      pushIssue(clientWithIssue("v1"), "uuid-1", { dir }),
    ).rejects.toThrow(/no local copy/);
  });

  it("uploads local edits and refreshes the baseline", async () => {
    await pullIssue(clientWithIssue("v1"), "uuid-1", { dir });
    fs.writeFileSync(path.join(dir, "TES-9.md"), "v1 edited\n");
    const client = clientWithIssue("v1", [issueUpdateResponse("v1 edited")]);
    const result = await pushIssue(client, "uuid-1", { dir });
    expect(result.action).toBe("pushed");
    // Baseline refreshed → immediate second push is a no-op.
    const again = await pushIssue(clientWithIssue("v1 edited"), "uuid-1", {
      dir,
    });
    expect(again.action).toBe("no_changes");
  });

  it("no_changes when local matches server", async () => {
    await pullIssue(clientWithIssue("v1"), "uuid-1", { dir });
    const result = await pushIssue(clientWithIssue("v1"), "uuid-1", { dir });
    expect(result.action).toBe("no_changes");
  });

  it("conflicts with EXIT_CONFLICT and a server diff when the server moved", async () => {
    await pullIssue(clientWithIssue("v1"), "uuid-1", { dir });
    fs.writeFileSync(path.join(dir, "TES-9.md"), "local change\n");
    // Server moved v1 → v2 after our pull.
    let caught: unknown;
    try {
      await pushIssue(clientWithIssue("v2 (human edit)"), "uuid-1", { dir });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(LinearError);
    const err = caught as LinearError;
    expect(err.exitCode).toBe(EXIT_CONFLICT);
    expect(err.message).toContain("changed on the server since pull");
    expect(err.message).toContain("-v1");
    expect(err.message).toContain("+v2 (human edit)");
  });

  it("--force pushes over a moved server copy", async () => {
    await pullIssue(clientWithIssue("v1"), "uuid-1", { dir });
    fs.writeFileSync(path.join(dir, "TES-9.md"), "local wins\n");
    const client = clientWithIssue("v2", [issueUpdateResponse("local wins")]);
    const result = await pushIssue(client, "uuid-1", { dir, force: true });
    expect(result.action).toBe("pushed");
  });

  it("--dry-run returns the diff and conflict flag without writing", async () => {
    await pullIssue(clientWithIssue("v1"), "uuid-1", { dir });
    fs.writeFileSync(path.join(dir, "TES-9.md"), "local change\n");
    const client = clientWithIssue("v2");
    const result = await pushIssue(client, "uuid-1", { dir, dryRun: true });
    expect(result.action).toBe("dry_run");
    expect(result.conflict).toBe(true);
    expect(result.diff).toContain("-v2");
    expect(result.diff).toContain("+local change");
    // read-only: exactly one request (the issue fetch), no issueUpdate
    expect(
      (client as unknown as { request: { mock: { calls: unknown[] } } }).request
        .mock.calls,
    ).toHaveLength(1);
  });

  it("round-trips without newline accretion across pull/push cycles", async () => {
    await pullIssue(clientWithIssue("v1"), "uuid-1", { dir });
    // Untouched file pushed → no_changes (trailing newline stripped on read)
    const result = await pushIssue(clientWithIssue("v1"), "uuid-1", { dir });
    expect(result.action).toBe("no_changes");
  });
});
