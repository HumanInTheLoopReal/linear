import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  toJsonlString,
  writeJsonlToFile,
  writeJsonlToStdout,
} from "../../../src/common/jsonl.js";

describe("toJsonlString", () => {
  it("returns empty string when no lines", () => {
    expect(toJsonlString([])).toBe("");
  });

  it("joins lines with newline and ends with a trailing newline", () => {
    const out = toJsonlString([{ a: 1 }, { b: 2 }]);
    expect(out).toBe('{"a":1}\n{"b":2}\n');
  });
});

describe("writeJsonlToFile", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "jsonl-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("writes via temp file + rename so final contents are atomic", () => {
    const target = path.join(dir, "out.jsonl");
    writeJsonlToFile(target, [{ id: "x" }, { id: "y" }]);
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.readFileSync(target, "utf8")).toBe('{"id":"x"}\n{"id":"y"}\n');
    const stragglers = fs.readdirSync(dir).filter((f) => f.includes(".tmp."));
    expect(stragglers).toEqual([]);
  });

  it("creates parent directory when missing", () => {
    const target = path.join(dir, "nested", "deep", "out.jsonl");
    writeJsonlToFile(target, [{ k: 1 }]);
    expect(fs.existsSync(target)).toBe(true);
  });

  it("writes empty file when no lines are given", () => {
    const target = path.join(dir, "empty.jsonl");
    writeJsonlToFile(target, []);
    expect(fs.readFileSync(target, "utf8")).toBe("");
  });
});

describe("writeJsonlToStdout", () => {
  it("writes one line per object with trailing newlines", () => {
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    writeJsonlToStdout([{ a: 1 }, { b: 2 }]);
    expect(writeSpy).toHaveBeenCalledTimes(2);
    expect(writeSpy.mock.calls[0]?.[0]).toBe('{"a":1}\n');
    expect(writeSpy.mock.calls[1]?.[0]).toBe('{"b":2}\n');
    writeSpy.mockRestore();
  });
});
