import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { recordCliInvocation } from "../command-coverage-recorder.js";

const execFile = promisify(execFileCallback);
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CLI_PATH = path.join(REPO_ROOT, "dist/main.js");

export interface CliResult {
  stdout: string;
  stderr: string;
}

export interface RunLinearOptions {
  json?: boolean;
  timeout?: number;
}

export interface CliHarness {
  runLinear(
    args: readonly string[],
    options?: RunLinearOptions,
  ): Promise<CliResult>;
  cleanup(): void;
}

export const hasLiveApiToken = Boolean(process.env.LINEAR_API_TOKEN?.trim());

/**
 * Execute the compiled CLI without a shell in an isolated home and cwd.
 * Explicit env construction prevents developer config, stored credentials,
 * and repo scope from silently changing integration behavior.
 */
export function createCliHarness(): CliHarness {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "linear-cli-integration-"),
  );
  const home = path.join(root, "home");
  const cwd = path.join(root, "workspace");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });

  const env: NodeJS.ProcessEnv = {
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR ?? os.tmpdir(),
    LANG: process.env.LANG ?? "C.UTF-8",
    LINEAR_API_TOKEN: process.env.LINEAR_API_TOKEN,
    LINEAR_NO_AUTO_INIT: "1",
    LINEAR_AGENT_MODE: "0",
    NO_COLOR: "1",
    FORCE_COLOR: "0",
  };

  return {
    async runLinear(args, options = {}) {
      recordCliInvocation(args);
      const cliArgs = [
        CLI_PATH,
        ...(options.json === false ? [] : ["--json=compact"]),
        ...args,
      ];
      const { stdout, stderr } = await execFile(process.execPath, cliArgs, {
        cwd,
        env,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
        timeout: options.timeout ?? 30_000,
      });
      return { stdout, stderr };
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

export function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}
