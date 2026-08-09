import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import {
  fetchLiveSnapshot,
  getSnapshotDir,
  getSnapshotPath,
  listSnapshots,
  loadSnapshotByRef,
  readSnapshot,
  resolveSnapshotRef,
  writeSnapshot,
} from "../../../src/services/snapshot-service.js";

let tmpHome: string;
let origHome: string | undefined;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "linear-snapshot-"));
  origHome = process.env.HOME;
  process.env.HOME = tmpHome;
  vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
});

afterEach(() => {
  vi.restoreAllMocks();
  if (origHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = origHome;
  }
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function mockClient(pages: Array<Record<string, unknown>>): GraphQLClient {
  const request = vi.fn();
  for (const page of pages) {
    request.mockResolvedValueOnce(page);
  }
  return { request } as unknown as GraphQLClient;
}

describe("getSnapshotDir / getSnapshotPath", () => {
  it("resolves under ~/.linear/snapshots", () => {
    expect(getSnapshotDir()).toBe(path.join(tmpHome, ".linear", "snapshots"));
    expect(getSnapshotPath("v1")).toBe(
      path.join(tmpHome, ".linear", "snapshots", "v1.jsonl"),
    );
  });

  it.each([
    "",
    "../escape",
    "/tmp/escape",
    "nested/escape",
    "nested\\escape",
    "control\u0000character",
  ])("rejects unsafe snapshot label %j", (label) => {
    expect(() => getSnapshotPath(label)).toThrow(/invalid snapshot label/);
  });

  it.each([
    "label with spaces",
    "résumé-版本",
    `a${"b".repeat(128)}`,
  ])("preserves safe legacy label %j", (label) => {
    expect(getSnapshotPath(label)).toBe(
      path.join(tmpHome, ".linear", "snapshots", `${label}.jsonl`),
    );
  });
});

describe("fetchLiveSnapshot", () => {
  it("paginates and shapes issues into SnapshotIssue records", async () => {
    const client = mockClient([
      {
        issues: {
          nodes: [
            {
              id: "u1",
              identifier: "TES-1",
              title: "first",
              description: "body",
              priority: 2,
              state: { type: "started" },
            },
          ],
          pageInfo: { hasNextPage: true, endCursor: "cur-1" },
        },
      },
      {
        issues: {
          nodes: [
            {
              id: "u2",
              identifier: "TES-2",
              title: "second",
              description: null,
              priority: 0,
              state: { type: "backlog" },
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    ]);

    const issues = await fetchLiveSnapshot(client);
    expect(issues.length).toBe(2);
    expect(issues[0]).toEqual({
      id: "u1",
      identifier: "TES-1",
      title: "first",
      description: "body",
      priority: 2,
      status: "started",
    });
    expect(issues[1].description).toBe("");
    expect(issues[1].status).toBe("backlog");
  });
});

describe("writeSnapshot / readSnapshot / listSnapshots", () => {
  it("writes a JSONL file with a metadata header and reads issues back", async () => {
    const client = mockClient([
      {
        issues: {
          nodes: [
            {
              id: "u1",
              identifier: "TES-1",
              title: "alpha",
              description: "",
              priority: 1,
              state: { type: "started" },
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    ]);

    const written = await writeSnapshot(client, "v1");
    expect(written.label).toBe("v1");
    expect(written.meta.issue_count).toBe(1);

    const contents = fs.readFileSync(written.path, "utf8").split("\n");
    expect(contents[0]).toMatch(/"_meta"/);

    const issues = readSnapshot(written.path);
    expect(issues.length).toBe(1);
    expect(issues[0].identifier).toBe("TES-1");

    const listed = listSnapshots();
    expect(listed.length).toBe(1);
    expect(listed[0].label).toBe("v1");
    expect(listed[0].issue_count).toBe(1);
  });

  it("defaults the label to a filesystem-safe ISO timestamp", async () => {
    const client = mockClient([
      {
        issues: {
          nodes: [],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    ]);
    const written = await writeSnapshot(client);
    expect(written.label).not.toContain(":");
    expect(written.label).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it("rejects an unsafe label before fetching or writing", async () => {
    const client = mockClient([]);

    await expect(writeSnapshot(client, "../../outside")).rejects.toThrow(
      /invalid snapshot label/,
    );
    expect(client.request).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(tmpHome, "outside.jsonl"))).toBe(false);
  });

  it("does not write through an existing snapshot symlink", async () => {
    const snapshotDir = getSnapshotDir();
    fs.mkdirSync(snapshotDir, { recursive: true });
    const outside = path.join(tmpHome, "outside.jsonl");
    fs.writeFileSync(outside, "outside\n");
    fs.symlinkSync(outside, getSnapshotPath("linked"));
    const client = mockClient([]);

    await expect(writeSnapshot(client, "linked")).rejects.toThrow(
      /unsafe snapshot file/,
    );
    expect(client.request).not.toHaveBeenCalled();
    expect(fs.readFileSync(outside, "utf8")).toBe("outside\n");
  });

  it("rejects a symlinked snapshot directory", async () => {
    const outsideDir = path.join(tmpHome, "outside-snapshots");
    fs.mkdirSync(path.join(tmpHome, ".linear"), { recursive: true });
    fs.mkdirSync(outsideDir);
    fs.symlinkSync(outsideDir, getSnapshotDir());
    const client = mockClient([]);

    await expect(writeSnapshot(client, "linked-dir")).rejects.toThrow(
      /unsafe snapshot directory/,
    );
    expect(client.request).not.toHaveBeenCalled();
    expect(fs.readdirSync(outsideDir)).toEqual([]);
  });
});

describe("resolveSnapshotRef", () => {
  it("returns 'live' for the live ref", () => {
    expect(resolveSnapshotRef("live")).toBe("live");
  });

  it("throws when the named snapshot does not exist", () => {
    expect(() => resolveSnapshotRef("missing")).toThrow(/snapshot not found/);
  });

  it("rejects traversal refs before probing the filesystem", () => {
    const existsSpy = vi.spyOn(fs, "existsSync");

    expect(() => resolveSnapshotRef("../../outside")).toThrow(
      /invalid snapshot label/,
    );
    expect(existsSpy).not.toHaveBeenCalled();
  });

  it("rejects a named snapshot symlink", () => {
    const snapshotDir = getSnapshotDir();
    fs.mkdirSync(snapshotDir, { recursive: true });
    const outside = path.join(tmpHome, "outside.jsonl");
    fs.writeFileSync(outside, "{}\n");
    fs.symlinkSync(outside, getSnapshotPath("linked"));

    expect(() => resolveSnapshotRef("linked")).toThrow(/unsafe snapshot file/);
  });

  it("throws when HEAD is requested but no snapshots exist", () => {
    expect(() => resolveSnapshotRef("HEAD")).toThrow(/no snapshots exist/);
  });

  it("resolves HEAD to the newest-created snapshot", async () => {
    const client = mockClient([
      {
        issues: {
          nodes: [],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
      {
        issues: {
          nodes: [],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    ]);
    await writeSnapshot(client, "older");
    // Pause briefly so that the metadata timestamps differ; if not, label
    // ordering still works because we sort by created_at desc.
    await new Promise((r) => setTimeout(r, 10));
    await writeSnapshot(client, "newer");
    const resolved = resolveSnapshotRef("HEAD");
    expect(resolved).not.toBe("live");
    if (resolved === "live") throw new Error("unreachable");
    expect(resolved.label).toBe("newer");
  });
});

describe("loadSnapshotByRef", () => {
  it("returns the live snapshot when ref='live'", async () => {
    const client = mockClient([
      {
        issues: {
          nodes: [
            {
              id: "u9",
              identifier: "TES-9",
              title: "live",
              description: "",
              priority: 0,
              state: { type: "started" },
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    ]);
    const result = await loadSnapshotByRef(client, "live");
    expect(result.label).toBe("live");
    expect(result.issues[0].identifier).toBe("TES-9");
  });
});
