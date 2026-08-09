import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const VERSION_PATTERN = /\b\d{4}\.\d{1,2}\.\d+(?:-[0-9A-Za-z.-]+)?\b/g;
const VALID_VERSION = /^\d{4}\.\d{1,2}\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const JSON_TARGETS = [
  {
    path: ".claude-plugin/marketplace.json",
    get(data) {
      const plugin = data.plugins?.find((entry) => entry.name === "linear");
      return plugin?.version;
    },
    set(data, version) {
      const plugin = data.plugins?.find((entry) => entry.name === "linear");
      if (!plugin) throw new Error("linear marketplace entry is missing");
      plugin.version = version;
    },
  },
  {
    path: "plugins/linear/.claude-plugin/plugin.json",
    get: (data) => data.version,
    set: (data, version) => {
      data.version = version;
    },
  },
  {
    path: "plugins/linear/.codex-plugin/plugin.json",
    get: (data) => data.version,
    set: (data, version) => {
      data.version = version;
    },
  },
  {
    path: "plugins/linear/.copilot-plugin/plugin.json",
    get: (data) => data.version,
    set: (data, version) => {
      data.version = version;
    },
  },
];

const TEXT_TARGETS = [
  { path: "plugins/linear/skills/linear/SKILL.md", occurrences: 2 },
  {
    path: "plugins/linear/skills/linear/resources/CLI_REFERENCE.md",
    occurrences: 1,
  },
];

export const PLUGIN_VERSION_FILES = [
  ...JSON_TARGETS.map((target) => target.path),
  ...TEXT_TARGETS.map((target) => target.path),
];

function assertVersion(version) {
  if (!VALID_VERSION.test(version)) {
    throw new Error(`invalid release version: ${version}`);
  }
}

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function readExpectedVersion(root) {
  const value = readJson(root, "package.json").version;
  assertVersion(value);
  return value;
}

export function syncPluginVersions(version, root = process.cwd()) {
  assertVersion(version);
  const writes = [];

  for (const target of JSON_TARGETS) {
    const absolutePath = path.join(root, target.path);
    const data = readJson(root, target.path);
    target.set(data, version);
    writes.push({
      absolutePath,
      content: `${JSON.stringify(data, null, 2)}\n`,
    });
  }

  for (const target of TEXT_TARGETS) {
    const absolutePath = path.join(root, target.path);
    const original = fs.readFileSync(absolutePath, "utf8");
    const matches = original.match(VERSION_PATTERN) ?? [];
    if (matches.length !== target.occurrences) {
      throw new Error(
        `${target.path}: expected ${target.occurrences} release-version occurrences, found ${matches.length}`,
      );
    }
    writes.push({
      absolutePath,
      content: original.replaceAll(VERSION_PATTERN, version),
    });
  }

  for (const { absolutePath, content } of writes) {
    const temporaryPath = `${absolutePath}.tmp.${process.pid}`;
    fs.writeFileSync(temporaryPath, content);
    fs.renameSync(temporaryPath, absolutePath);
  }
}

export function verifyPluginVersions(expectedVersion, root = process.cwd()) {
  const resolvedVersion = expectedVersion ?? readExpectedVersion(root);
  assertVersion(resolvedVersion);
  const mismatches = [];

  for (const target of JSON_TARGETS) {
    const actual = target.get(readJson(root, target.path));
    if (actual !== resolvedVersion) {
      mismatches.push(`${target.path}: ${String(actual)}`);
    }
  }

  for (const target of TEXT_TARGETS) {
    const content = fs.readFileSync(path.join(root, target.path), "utf8");
    const matches = content.match(VERSION_PATTERN) ?? [];
    if (
      matches.length !== target.occurrences ||
      matches.some((version) => version !== resolvedVersion)
    ) {
      mismatches.push(`${target.path}: ${matches.join(", ") || "missing"}`);
    }
  }

  if (mismatches.length > 0) {
    throw new Error(
      `plugin versions must match package version ${resolvedVersion}:\n${mismatches
        .map((entry) => `- ${entry}`)
        .join("\n")}`,
    );
  }
}

function main() {
  const args = process.argv.slice(2);
  const check = args[0] === "--check";
  const version = check
    ? (args[1] ?? readExpectedVersion(process.cwd()))
    : args[0];

  if (!version) {
    throw new Error(
      "usage: plugin-versions.mjs <version> | plugin-versions.mjs --check [version]",
    );
  }

  if (check) {
    verifyPluginVersions(version);
    process.stdout.write(`plugin versions match ${version}\n`);
    return;
  }

  syncPluginVersions(version);
  verifyPluginVersions(version);
  process.stdout.write(`synchronized plugin versions to ${version}\n`);
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
