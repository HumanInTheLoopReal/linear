import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearKv,
  getKv,
  getKvPath,
  listKv,
  readAll,
  setKv,
  validateKvKey,
} from "../../../src/common/kv-store.js";

let tmpHome: string;
let homedirSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "kv-store-"));
  homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
});

afterEach(() => {
  homedirSpy.mockRestore();
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("validateKvKey", () => {
  it("accepts ordinary keys", () => {
    expect(validateKvKey("foo")).toBeNull();
    expect(validateKvKey("api_endpoint")).toBeNull();
    expect(validateKvKey("a.b.c")).toBeNull();
  });

  it("rejects empty / whitespace keys", () => {
    expect(validateKvKey("")).toMatch(/empty/);
    expect(validateKvKey("   ")).toMatch(/whitespace/);
  });

  it("rejects reserved prefixes (incl. kv.* to avoid nested confusion)", () => {
    for (const prefix of [
      "kv.",
      "sync.",
      "conflict.",
      "federation.",
      "jira.",
      "linear.",
      "export.",
    ]) {
      expect(validateKvKey(`${prefix}thing`)).toMatch(/reserved prefix/);
    }
  });
});

describe("kv-store CRUD", () => {
  it("setKv creates the file with the value and reports action 'set'", () => {
    const result = setKv("k1", "v1");
    expect(result).toEqual({ key: "k1", value: "v1", action: "set" });
    expect(fs.existsSync(getKvPath())).toBe(true);
    expect(readAll()).toEqual({ k1: "v1" });
  });

  it("setKv on existing key reports action 'updated'", () => {
    setKv("k1", "v1");
    const second = setKv("k1", "v2");
    expect(second.action).toBe("updated");
    expect(readAll()).toEqual({ k1: "v2" });
  });

  it("getKv returns found=true with the value when present", () => {
    setKv("hello", "world");
    expect(getKv("hello")).toEqual({
      key: "hello",
      value: "world",
      found: true,
    });
  });

  it("getKv returns found=false with null value when missing", () => {
    expect(getKv("missing")).toEqual({
      key: "missing",
      value: null,
      found: false,
    });
  });

  it("clearKv deletes a present key and returns true", () => {
    setKv("a", "1");
    setKv("b", "2");
    expect(clearKv("a")).toBe(true);
    expect(readAll()).toEqual({ b: "2" });
  });

  it("clearKv returns false when key is absent", () => {
    expect(clearKv("never-was-here")).toBe(false);
  });

  it("listKv returns keys sorted alphabetically", () => {
    setKv("c", "3");
    setKv("a", "1");
    setKv("b", "2");
    expect(Object.keys(listKv())).toEqual(["a", "b", "c"]);
  });

  it("listKv returns {} on a fresh home", () => {
    expect(listKv()).toEqual({});
  });

  it("file is written with 0600 perms", () => {
    setKv("x", "y");
    const stat = fs.statSync(getKvPath());
    expect(stat.mode & 0o777).toBe(0o600);
  });
});
