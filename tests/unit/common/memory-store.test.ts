import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteMemory,
  getMemory,
  getMemoryPath,
  listMemories,
  slugify,
  upsertMemory,
} from "../../../src/common/memory-store.js";

describe("slugify", () => {
  it("lowercases and replaces non-alphanumeric runs with hyphens", () => {
    expect(slugify("Always run tests with -race flag")).toBe(
      "always-run-tests-with-race-flag",
    );
  });

  it("limits to the first 8 hyphen-separated words", () => {
    expect(slugify("one two three four five six seven eight nine ten")).toBe(
      "one-two-three-four-five-six-seven-eight",
    );
  });

  it("caps total length at 60 characters and trims trailing hyphens", () => {
    const long = "abcdefghij".repeat(8);
    const out = slugify(long);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.endsWith("-")).toBe(false);
  });

  it("returns empty string when input has no alphanumeric characters", () => {
    expect(slugify("---!!!")).toBe("");
  });
});

describe("MemoryStore IO", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "linear-memory-test-"));
    vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("creates the file on first upsert and reports 'remembered'", () => {
    const result = upsertMemory("test-key", "test value");
    expect(result.action).toBe("remembered");
    expect(fs.existsSync(getMemoryPath())).toBe(true);
    const raw = JSON.parse(fs.readFileSync(getMemoryPath(), "utf8"));
    expect(raw["test-key"].value).toBe("test value");
    expect(typeof raw["test-key"].updated_at).toBe("string");
  });

  it("updates existing keys in place and reports 'updated'", () => {
    upsertMemory("k", "first");
    const result = upsertMemory("k", "second");
    expect(result.action).toBe("updated");
    expect(getMemory("k")?.value).toBe("second");
  });

  it("listMemories filters by case-insensitive substring across key and value", () => {
    upsertMemory("auth-jwt", "auth module uses JWT not sessions");
    upsertMemory("cache-tips", "cache phantom DBs hide in three places");
    upsertMemory("misc", "unrelated");

    const matches = listMemories("CACHE");
    expect(Object.keys(matches).sort()).toEqual(["cache-tips"]);

    const matchesByValue = listMemories("jwt");
    expect(Object.keys(matchesByValue).sort()).toEqual(["auth-jwt"]);
  });

  it("deleteMemory returns the removed entry and absent for missing keys", () => {
    upsertMemory("k", "v");
    expect(deleteMemory("k")?.value).toBe("v");
    expect(getMemory("k")).toBeUndefined();
    expect(deleteMemory("k")).toBeUndefined();
  });

  it("returns empty object when file is missing", () => {
    expect(listMemories()).toEqual({});
    expect(getMemory("anything")).toBeUndefined();
  });
});
