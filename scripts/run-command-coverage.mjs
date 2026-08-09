import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const manifestDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), "linear-command-coverage-"),
);
const coverageEnv = {
  ...process.env,
  LINEAR_COMMAND_COVERAGE_DIR: manifestDirectory,
};

function run(command, args, env = coverageEnv) {
  const result = spawnSync(command, args, { stdio: "inherit", env });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

try {
  const steps = [
    {
      command: npx,
      args: ["vitest", "run", "--config", "vitest.command-coverage.config.ts"],
      env: coverageEnv,
    },
    {
      command: npm,
      args: ["run", "test:integration"],
      env: { ...coverageEnv, LINEAR_API_TOKEN: "" },
    },
    {
      command: npx,
      args: ["tsx", "tests/command-coverage.ts"],
      env: coverageEnv,
    },
  ];

  for (const step of steps) {
    const status = run(step.command, step.args, step.env);
    if (status !== 0) {
      process.exitCode = status;
      break;
    }
  }
} finally {
  fs.rmSync(manifestDirectory, { recursive: true, force: true });
}
