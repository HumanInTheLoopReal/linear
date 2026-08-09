#!/usr/bin/env tsx

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Command } from "commander";
import { buildProgram } from "../src/program.js";
import { COMMAND_COVERAGE_DIR_ENV } from "./command-coverage-recorder.js";

const DEFAULT_MINIMUM_PERCENT = 50;

export interface CommandCoverage {
  registered: Set<string>;
  tested: Set<string>;
  percentage: number;
}

/** Walk the authoritative Commander tree, including nested command paths. */
export function collectCommandPaths(program: Command): Set<string> {
  const paths = new Set<string>();

  function visit(command: Command, parents: string[]): void {
    for (const child of command.commands) {
      const commandPath = [...parents, child.name()];
      paths.add(commandPath.join(" "));
      visit(child, commandPath);
    }
  }

  visit(program, []);
  return paths;
}

/** Read argv records emitted by the executed test workers. */
export function readRecordedCliArgv(manifestDirectory: string): string[][] {
  if (!fs.existsSync(manifestDirectory)) {
    throw new Error(
      `command coverage manifest not found: ${manifestDirectory}`,
    );
  }

  const records: string[][] = [];
  const shards = fs
    .readdirSync(manifestDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => entry.name)
    .sort();

  for (const shard of shards) {
    const filename = path.join(manifestDirectory, shard);
    const lines = fs.readFileSync(filename, "utf8").split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (!line) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new Error(
          `invalid command coverage record ${filename}:${index + 1}`,
        );
      }
      if (
        !Array.isArray(parsed) ||
        parsed.length === 0 ||
        !parsed.every((token) => typeof token === "string")
      ) {
        throw new Error(
          `invalid command coverage record ${filename}:${index + 1}`,
        );
      }
      records.push(parsed);
    }
  }

  return records;
}

function commandPrefixesForArgv(
  program: Command,
  argv: readonly string[],
): string[] {
  const prefixes: string[] = [];
  const names: string[] = [];
  let parent = program;

  for (const token of argv) {
    if (token.startsWith("-")) continue;
    const child = parent.commands.find((command) => command.name() === token);
    if (!child) {
      if (names.length > 0) break;
      continue;
    }
    names.push(child.name());
    prefixes.push(names.join(" "));
    parent = child;
  }

  return prefixes;
}

export function calculateCommandCoverage(
  manifestDirectory: string,
  program = buildProgram(),
): CommandCoverage {
  const registered = collectCommandPaths(program);
  const tested = new Set<string>();

  for (const argv of readRecordedCliArgv(manifestDirectory)) {
    for (const commandPath of commandPrefixesForArgv(program, argv)) {
      tested.add(commandPath);
    }
  }

  const covered = [...tested].filter((commandPath) =>
    registered.has(commandPath),
  ).length;
  return {
    registered,
    tested,
    percentage: registered.size === 0 ? 0 : (covered / registered.size) * 100,
  };
}

export function enforceCoverageThreshold(
  percentage: number,
  minimum: number,
): void {
  if (!Number.isFinite(minimum) || minimum < 0 || minimum > 100) {
    throw new Error(`invalid command coverage threshold: ${minimum}`);
  }
  if (percentage < minimum) {
    throw new Error(
      `command coverage ${percentage.toFixed(1)}% is below the enforced ${minimum.toFixed(1)}% minimum`,
    );
  }
}

function main(): void {
  const manifestDirectory = process.env[COMMAND_COVERAGE_DIR_ENV];
  if (!manifestDirectory) {
    throw new Error(`${COMMAND_COVERAGE_DIR_ENV} is required`);
  }
  const minimum = Number.parseFloat(
    process.env.COMMAND_COVERAGE_MIN ?? String(DEFAULT_MINIMUM_PERCENT),
  );
  const coverage = calculateCommandCoverage(manifestDirectory);
  const covered = [...coverage.tested].filter((commandPath) =>
    coverage.registered.has(commandPath),
  );
  const missing = [...coverage.registered]
    .filter((commandPath) => !coverage.tested.has(commandPath))
    .sort();

  process.stdout.write("CLI command coverage\n\n");
  process.stdout.write(
    `${covered.length}/${coverage.registered.size} registered command paths covered (${coverage.percentage.toFixed(1)}%)\n`,
  );
  process.stdout.write(
    `Enforced minimum: ${minimum.toFixed(1)}% (override with COMMAND_COVERAGE_MIN)\n`,
  );
  if (missing.length > 0) {
    process.stdout.write(`\nUncovered paths (${missing.length}):\n`);
    const preview = missing.slice(0, 25);
    for (const commandPath of preview) {
      process.stdout.write(`- ${commandPath}\n`);
    }
    if (missing.length > preview.length) {
      process.stdout.write(
        `- ... and ${missing.length - preview.length} more\n`,
      );
    }
  }

  enforceCoverageThreshold(coverage.percentage, minimum);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
