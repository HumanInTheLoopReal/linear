import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import {
  type ConfigLayer,
  findLocalConfigPath,
  getConfig,
  getGlobalConfigPath,
  LocalConfigUnavailableError,
  listConfig,
  type ResolvedValue,
  setConfig,
  setManyConfig,
  showConfig,
  unsetConfig,
  validateConfigKey,
} from "../common/config-store.js";
import { getRootOpts } from "../common/context.js";
import { invalidParameterError, notFoundError } from "../common/errors.js";
import { handleCommand, outputResult } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";

/**
 * `config get`: emit ONLY the value (no key, no decoration).
 * Lets `VAL=$(linear config get foo)` work without parsing. Missing keys
 * throw `notFoundError` upstream (exit 1) — matches `kv get` behavior,
 * the more script-safe default.
 */
export function formatConfigGet(result: { value: string | null }): string {
  return `${result.value ?? ""}\n`;
}

/**
 * `config set`: `Set <key> = <value>`. Same shape as `kv set`;
 * action ("set" vs "updated") is in the JSON envelope but the text echo
 * doesn't distinguish.
 */
export function formatConfigSet(result: {
  key: string;
  value: string;
}): string {
  return `Set ${result.key} = ${result.value}\n`;
}

/**
 * `config unset`: `Unset <key>`.
 */
export function formatConfigUnset(result: { key: string }): string {
  return `Unset ${result.key}\n`;
}

/**
 * `config set-many`: one `Set <key> = <value>` line per pair (no summary footer).
 */
export function formatConfigSetMany(result: {
  set: Array<{ key: string; value: string }>;
}): string {
  if (result.set.length === 0) return "";
  const lines = result.set.map(({ key, value }) => `Set ${key} = ${value}`);
  return `${lines.join("\n")}\n`;
}

/**
 * `config list`:
 *
 *   (blank line)
 *   Configuration:
 *     <key> = <value>
 *   (blank line)
 *   Tip: Run 'linear config show' for all effective config with provenance.
 *
 * Empty case: `No configuration set` (kv-style; `listConfig` only returns
 * file pairs, so empty means the file is empty or missing).
 */
export function formatConfigList(pairs: Record<string, string>): string {
  const keys = Object.keys(pairs);
  if (keys.length === 0) {
    return "No configuration set\n";
  }
  const lines = ["", "Configuration:"];
  for (const key of keys) {
    lines.push(`  ${key} = ${pairs[key]}`);
  }
  lines.push("");
  lines.push(
    "Tip: Run 'linear config show' for all effective config with provenance.",
  );
  return `${lines.join("\n")}\n`;
}

/**
 * `config show`: aligned 3-column rows.
 *
 *   <key padded to 41>= <value padded to 38>  (<source>)
 *
 * Empty case: `No configuration set` (matches list empty-case wording).
 * Source vocabulary is: env / file / default.
 */
const SHOW_KEY_WIDTH = 41;
const SHOW_VALUE_WIDTH = 38;

export function formatConfigShow(rows: ResolvedValue[]): string {
  if (rows.length === 0) {
    return "No configuration set\n";
  }
  const lines = rows.map((r) => {
    const key = r.key.padEnd(SHOW_KEY_WIDTH);
    const value = (r.value ?? "").padEnd(SHOW_VALUE_WIDTH);
    return `  ${key}= ${value}(${r.source})`;
  });
  return `${lines.join("\n")}\n`;
}

export const CONFIG_META: DomainMeta = {
  name: "config",
  summary: "per-user linear settings stored in ~/.linear/config.json",
  context: [
    "Stores per-user CLI preferences in `~/.linear/config.json`. Keys with",
    "env-var overrides (currently `linear.api_token` → LINEAR_API_TOKEN,",
    "`linear.endpoint` → LINEAR_ENDPOINT, `team.default` → LINEAR_TEAM)",
    "defer to the env var when set. Precedence: env > file > default.",
    "",
    "Reserved keys:",
    "  • team.default — fallback team for every --team-taking command",
    "    (set once via `linear config set team.default <key>` or `linear",
    "    init --team <key>` and stop typing --team).",
    "",
    "Subcommands:",
    "  • get / set / unset / list — straightforward key/value I/O",
    "  • set-many — atomic batch write (all-or-nothing validation)",
    "  • show — per-key value+source provenance",
    "",
    "If you need an arbitrary string→string store with no namespace",
    "expectations, prefer `linear kv` (separate file, no env overrides).",
  ].join("\n"),
  arguments: {
    key: "config key (e.g. linear.endpoint, output.title-length)",
    value: "string value to store",
  },
  seeAlso: ["kv", "auth", "where"],
};

function ensureValidKey(key: string): void {
  const err = validateConfigKey(key);
  if (err) {
    throw invalidParameterError("<key>", err);
  }
}

/**
 * Translate the `--local` / `--global` flag pair into a `ConfigLayer`. Both
 * flags map to the same Commander attribute pattern (`opts.local`,
 * `opts.global`), so we read them independently.
 *
 *   - Both set:    error (mutually exclusive).
 *   - `--global`:  global.
 *   - `--local`:   local; raises `LocalConfigUnavailableError` if not in a git
 *                  repo.
 *   - Neither + write op: local if in git repo, else global with stderr
 *                  warning ("git config" muscle memory).
 *   - Neither + read op:  caller passes `mode: "read"` to get `undefined`,
 *                  letting `getConfig` apply the merged precedence.
 */
function resolveLayerFlag(
  flags: { local?: boolean; global?: boolean },
  mode: "write" | "read",
): ConfigLayer | undefined {
  if (flags.local && flags.global) {
    throw invalidParameterError("--local / --global", "are mutually exclusive");
  }
  if (flags.global) return "global";
  if (flags.local) {
    if (!findLocalConfigPath()) {
      throw new LocalConfigUnavailableError();
    }
    return "local";
  }
  if (mode === "read") return undefined;
  if (findLocalConfigPath()) return "local";
  process.stderr.write(
    "linear: not inside a git repo — writing to ~/.linear/config.json (global). Pass --global to silence.\n",
  );
  return "global";
}

export function setupConfigCommands(program: Command): void {
  const config = program
    .command("config")
    .description("manage local linear configuration");
  config.action(() => config.help());

  config
    .command("get <key>")
    .description("get a config value (env var overrides take precedence)")
    .option("--local", "read only the per-repo config layer")
    .option("--global", "read only the per-user config layer")
    .action(
      handleCommand(async (...cmdArgs: unknown[]) => {
        const [key, options, command] = cmdArgs as [
          string,
          { local?: boolean; global?: boolean },
          Command,
        ];
        const layer = resolveLayerFlag(options, "read");
        const result = getConfig(key, undefined, layer ? { layer } : undefined);
        if (!result.found) {
          throw notFoundError("Config key", key);
        }
        outputResult(result, formatConfigGet, getRootOpts(command));
      }),
    );

  config
    .command("set <key> <value>")
    .description("set a config value")
    .option(
      "--local",
      "write to per-repo `<repo>/.linear/config.json` (default in git repo)",
    )
    .option("--global", "write to per-user `~/.linear/config.json`")
    .action(
      handleCommand(async (...cmdArgs: unknown[]) => {
        const [key, value, options, command] = cmdArgs as [
          string,
          string,
          { local?: boolean; global?: boolean },
          Command,
        ];
        ensureValidKey(key);
        const layer = resolveLayerFlag(options, "write");
        outputResult(
          setConfig(key, value, { layer }),
          formatConfigSet,
          getRootOpts(command),
        );
      }),
    );

  config
    .command("unset <key>")
    .description("delete a config key")
    .option("--local", "delete from per-repo layer (default in git repo)")
    .option("--global", "delete from per-user layer")
    .action(
      handleCommand(async (...cmdArgs: unknown[]) => {
        const [key, options, command] = cmdArgs as [
          string,
          { local?: boolean; global?: boolean },
          Command,
        ];
        ensureValidKey(key);
        const layer = resolveLayerFlag(options, "write");
        const removed = unsetConfig(key, { layer });
        if (!removed) {
          throw notFoundError("Config key", key);
        }
        outputResult(
          { key, deleted: true },
          formatConfigUnset,
          getRootOpts(command),
        );
      }),
    );

  config
    .command("set-many <pair...>")
    .description("set multiple key=value pairs atomically")
    .option("--local", "write to per-repo layer (default in git repo)")
    .option("--global", "write to per-user layer")
    .action(
      handleCommand(async (...cmdArgs: unknown[]) => {
        const [rawPairs, options, command] = cmdArgs as [
          string[],
          { local?: boolean; global?: boolean },
          Command,
        ];
        if (!rawPairs || rawPairs.length === 0) {
          throw invalidParameterError(
            "<pair...>",
            "at least one key=value pair required",
          );
        }
        const parsed: Array<{ key: string; value: string }> = [];
        for (const pair of rawPairs) {
          const eq = pair.indexOf("=");
          if (eq <= 0) {
            throw invalidParameterError(
              `"${pair}"`,
              "expected key=value format",
            );
          }
          const key = pair.slice(0, eq);
          const value = pair.slice(eq + 1);
          const err = validateConfigKey(key);
          if (err) {
            throw invalidParameterError(`"${key}"`, err);
          }
          parsed.push({ key, value });
        }
        const layer = resolveLayerFlag(options, "write");
        outputResult(
          { set: setManyConfig(parsed, { layer }) },
          formatConfigSetMany,
          getRootOpts(command),
        );
      }),
    );

  config
    .command("list")
    .description("list all config keys for one layer (sorted)")
    .option("--local", "list per-repo layer")
    .option("--global", "list per-user layer (default)")
    .action(
      handleCommand(async (...cmdArgs: unknown[]) => {
        const [options, command] = cmdArgs as [
          { local?: boolean; global?: boolean },
          Command,
        ];
        const layer = options.local ? "local" : "global";
        outputResult(
          listConfig({ layer }),
          formatConfigList,
          getRootOpts(command),
        );
      }),
    );

  config
    .command("show")
    .description("show effective config with per-key source (env/local/global)")
    .action(
      handleCommand(async (...cmdArgs: unknown[]) => {
        const [, command] = cmdArgs as [unknown, Command];
        outputResult(showConfig(), formatConfigShow, getRootOpts(command));
      }),
    );

  config
    .command("edit")
    .description("open the config file in $EDITOR (default: vim)")
    .option(
      "--global",
      "edit `~/.linear/config.json` (default: per-repo when in a git repo)",
    )
    .action(
      handleCommand(async (...cmdArgs: unknown[]) => {
        const [options] = cmdArgs as [{ global?: boolean }, Command];
        const layer: ConfigLayer = options.global
          ? "global"
          : findLocalConfigPath()
            ? "local"
            : "global";
        if (layer === "local" && !findLocalConfigPath()) {
          throw new LocalConfigUnavailableError();
        }
        const filePath =
          layer === "local"
            ? (findLocalConfigPath() as string)
            : getGlobalConfigPath();
        // Materialize the file before invoking $EDITOR — editors error on
        // missing files, and we want safe perms even when the user just
        // wants to start a fresh config.
        if (!fs.existsSync(filePath)) {
          const dir = path.dirname(filePath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
          }
          fs.writeFileSync(filePath, "{}\n", { mode: 0o600 });
        }
        const editor = process.env.VISUAL ?? process.env.EDITOR ?? "vim";
        const result = spawnSync(editor, [filePath], { stdio: "inherit" });
        if (result.status !== 0) {
          process.exit(result.status ?? 1);
        }
      }),
    );

  config
    .command("usage")
    .description("show detailed usage for config")
    .action(() => {
      console.log(formatDomainUsage(config, CONFIG_META));
    });
}
