import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { buildProgram } from "../../src/program.js";
import {
  calculateCommandCoverage,
  collectCommandPaths,
  enforceCoverageThreshold,
  readRecordedCliArgv,
} from "../command-coverage.js";
import { installCommanderCoverageRecorder } from "../command-coverage-commander.js";
import {
  COMMAND_COVERAGE_DIR_ENV,
  recordCliInvocation,
} from "../command-coverage-recorder.js";

function withManifest<T>(run: (directory: string) => T): T {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "linear-command-coverage-test-"),
  );
  try {
    return run(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

describe("command coverage", () => {
  it("discovers command paths from the real Commander tree", () => {
    const paths = collectCommandPaths(buildProgram());

    expect(paths).toContain("issues create");
    expect(paths).toContain("depends graph check");
    expect(paths).toContain("assign");
  });

  it("aggregates executed argv from worker manifest shards", () => {
    withManifest((directory) => {
      fs.writeFileSync(
        path.join(directory, "worker-a.jsonl"),
        `${JSON.stringify(["issues", "list"])}\n`,
      );
      fs.writeFileSync(
        path.join(directory, "worker-b.jsonl"),
        `${JSON.stringify(["node", "test", "projects", "read", "P1"])}\n`,
      );

      expect(readRecordedCliArgv(directory)).toEqual([
        ["issues", "list"],
        ["node", "test", "projects", "read", "P1"],
      ]);
    });
  });

  it("credits executed invocations but not skipped or unreachable source", () => {
    withManifest((directory) => {
      fs.writeFileSync(
        path.join(directory, "unexecuted.test.ts"),
        `
          it.skipIf(!hasLiveApiToken)("live", () => runLinear(["users", "list"]));
          if (false) runLinear(["projects", "list"]);
        `,
      );
      recordCliInvocation(["node", "test", "issues", "list"], directory);

      const coverage = calculateCommandCoverage(directory);

      expect(coverage.tested).toContain("issues");
      expect(coverage.tested).toContain("issues list");
      expect(coverage.tested).not.toContain("users list");
      expect(coverage.tested).not.toContain("projects list");
    });
  });

  it("records a Commander path only when parse executes", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "linear-command-coverage-test-"),
    );
    const previousDirectory = process.env[COMMAND_COVERAGE_DIR_ENV];
    process.env[COMMAND_COVERAGE_DIR_ENV] = directory;
    const restore = installCommanderCoverageRecorder();
    const program = new Command();
    let executed = false;
    program
      .command("issues")
      .command("list")
      .action(() => {
        executed = true;
      });

    try {
      await program.parseAsync(["node", "test", "issues", "list"]);
      const coverage = calculateCommandCoverage(directory, program);

      expect(executed).toBe(true);
      expect(coverage.tested).toEqual(new Set(["issues", "issues list"]));
    } finally {
      restore();
      if (previousDirectory === undefined) {
        delete process.env[COMMAND_COVERAGE_DIR_ENV];
      } else {
        process.env[COMMAND_COVERAGE_DIR_ENV] = previousDirectory;
      }
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("records successful synchronous Commander execution", () => {
    withManifest((directory) => {
      const previousDirectory = process.env[COMMAND_COVERAGE_DIR_ENV];
      process.env[COMMAND_COVERAGE_DIR_ENV] = directory;
      const restore = installCommanderCoverageRecorder();
      const program = new Command();
      let executed = false;
      program.command("doctor").action(() => {
        executed = true;
      });

      try {
        program.parse(["node", "test", "doctor"]);

        expect(executed).toBe(true);
        expect(calculateCommandCoverage(directory, program).tested).toEqual(
          new Set(["doctor"]),
        );
      } finally {
        restore();
        if (previousDirectory === undefined) {
          delete process.env[COMMAND_COVERAGE_DIR_ENV];
        } else {
          process.env[COMMAND_COVERAGE_DIR_ENV] = previousDirectory;
        }
      }
    });
  });

  it.each([
    ["unknown option", ["node", "test", "issues", "list", "--bogus"]],
    ["unknown subcommand", ["node", "test", "issues", "bogus"]],
  ])("does not credit a failed Commander parse with an %s", async (_, argv) => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "linear-command-coverage-test-"),
    );
    const previousDirectory = process.env[COMMAND_COVERAGE_DIR_ENV];
    process.env[COMMAND_COVERAGE_DIR_ENV] = directory;
    const restore = installCommanderCoverageRecorder();
    const program = new Command().exitOverride();
    program
      .command("issues")
      .command("list")
      .action(() => {});

    try {
      await expect(program.parseAsync(argv)).rejects.toThrow();
      expect(readRecordedCliArgv(directory)).toEqual([]);
      expect(calculateCommandCoverage(directory, program).tested).toEqual(
        new Set(),
      );
    } finally {
      restore();
      if (previousDirectory === undefined) {
        delete process.env[COMMAND_COVERAGE_DIR_ENV];
      } else {
        process.env[COMMAND_COVERAGE_DIR_ENV] = previousDirectory;
      }
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects malformed runtime records", () => {
    withManifest((directory) => {
      fs.writeFileSync(path.join(directory, "worker.jsonl"), "not-json\n");

      expect(() => readRecordedCliArgv(directory)).toThrow(
        "invalid command coverage record",
      );
    });
  });

  it("fails when coverage is below the configured threshold", () => {
    expect(() => enforceCoverageThreshold(49.9, 50)).toThrow(
      "below the enforced 50.0% minimum",
    );
    expect(() => enforceCoverageThreshold(50, 50)).not.toThrow();
  });
});
