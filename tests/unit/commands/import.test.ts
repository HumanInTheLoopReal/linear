import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/common/context.js", () => ({
  createContext: vi.fn(() => ({
    gql: { request: vi.fn() },
    sdk: { sdk: {} },
  })),
  getRootOpts: vi.fn(() => ({ apiToken: "test-token" })),
}));

vi.mock("../../../src/common/output.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/common/output.js")>();
  return {
    ...actual,
    outputSuccess: vi.fn(),
    outputResult: vi.fn(),
  };
});

vi.mock("../../../src/services/issue-import-service.js", () => ({
  importIssues: vi.fn(async (opts: { source: string; dryRun?: boolean }) => ({
    action: opts.dryRun ? "planned" : "imported",
    source: opts.source,
    dry_run: opts.dryRun ?? false,
    parsed: 2,
    created: opts.dryRun ? 0 : 2,
    dedup_skipped: 0,
    memories_skipped: 0,
    ids: opts.dryRun ? [] : ["ENG-1", "ENG-2"],
    relations_created: 0,
    errors: [],
  })),
}));

import { setupImportCommands } from "../../../src/commands/import.js";
import { outputResult } from "../../../src/common/output.js";
import { importIssues } from "../../../src/services/issue-import-service.js";

function createProgram(): Command {
  const program = new Command();
  setupImportCommands(program);
  return program;
}

let scratchDir: string;
let scratchFile: string;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  // Per default, behave as a TTY so the no-file path triggers the
  // missing-input error instead of trying to read process.stdin.
  Object.defineProperty(process.stdin, "isTTY", {
    value: true,
    configurable: true,
  });
  scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "linear-import-"));
  scratchFile = path.join(scratchDir, "issues.jsonl");
});

afterEach(() => {
  fs.rmSync(scratchDir, { recursive: true, force: true });
});

describe("linear import", () => {
  it("reads a JSONL file from disk and invokes importIssues", async () => {
    fs.writeFileSync(
      scratchFile,
      [
        '{"identifier":"X-1","title":"first","team":{"key":"ENG"}}',
        '{"identifier":"X-2","title":"second","team":{"key":"ENG"}}',
      ].join("\n"),
    );
    const program = createProgram();
    await program.parseAsync(["node", "test", "import", scratchFile]);

    expect(importIssues).toHaveBeenCalledWith(
      expect.objectContaining({
        source: scratchFile,
        dryRun: false,
        dedup: false,
      }),
    );
    expect(outputResult).toHaveBeenCalled();
  });

  it("--dry-run forwards dryRun=true to the service", async () => {
    fs.writeFileSync(scratchFile, '{"title":"first","team":{"key":"ENG"}}');
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "import",
      scratchFile,
      "--dry-run",
    ]);

    expect(importIssues).toHaveBeenCalledWith(
      expect.objectContaining({ source: scratchFile, dryRun: true }),
    );
  });

  it("--dedup forwards dedup=true to the service", async () => {
    fs.writeFileSync(scratchFile, '{"title":"first","team":{"key":"ENG"}}');
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "import",
      scratchFile,
      "--dedup",
    ]);

    expect(importIssues).toHaveBeenCalledWith(
      expect.objectContaining({ source: scratchFile, dedup: true }),
    );
  });

  it("errors when invoked with no file argument under a TTY", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "import"]);
    expect(importIssues).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("errors when the file is empty", async () => {
    fs.writeFileSync(scratchFile, "");
    const program = createProgram();
    await program.parseAsync(["node", "test", "import", scratchFile]);
    expect(importIssues).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("reads from stdin when invoked with `-`", async () => {
    // Simulate a piped stdin by replacing process.stdin with a small
    // async-iterable Readable.
    const { Readable } = await import("node:stream");
    const stdinStream = Readable.from([
      Buffer.from('{"title":"first","team":{"key":"ENG"}}'),
    ]) as unknown as NodeJS.ReadStream;
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });
    const origStdin = process.stdin;
    Object.defineProperty(process, "stdin", {
      value: Object.assign(stdinStream, { isTTY: false }),
      configurable: true,
    });

    const program = createProgram();
    try {
      await program.parseAsync(["node", "test", "import", "-"]);
      expect(importIssues).toHaveBeenCalledWith(
        expect.objectContaining({ source: "<stdin>" }),
      );
    } finally {
      Object.defineProperty(process, "stdin", {
        value: origStdin,
        configurable: true,
      });
    }
  });

  it("`linear import usage` renders DomainMeta without invoking importIssues", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "import", "usage"]);
    expect(importIssues).not.toHaveBeenCalled();
    // The usage subcommand writes the meta to console.log; the spy in beforeEach
    // captures it. Just verify *some* output was emitted.
    expect(
      (console.log as unknown as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBeGreaterThan(0);
  });
});
