import type { Command } from "commander";
import { getRootOpts } from "../common/context.js";
import { invalidParameterError, notFoundError } from "../common/errors.js";
import {
  clearKv,
  getKv,
  listKv,
  setKv,
  validateKvKey,
} from "../common/kv-store.js";
import { handleCommand, outputResult } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";

/**
 * Echo for `kv set`: `Set <key> = <value>`. setKv returns
 * action="set" for first write and "updated" for upsert; both render
 * as `Set` for a uniform message.
 */
export function formatKvSet(result: { key: string; value: string }): string {
  return `Set ${result.key} = ${result.value}\n`;
}

/**
 * `kv get`: emit ONLY the value (no decoration). Lets
 * `VALUE=$(linear kv get foo)` work without parsing.
 */
export function formatKvGet(result: { value: string | null }): string {
  return `${result.value ?? ""}\n`;
}

/**
 * `kv list`:
 *
 *   (blank line)
 *   Key-Value Store:
 *     <key> = <value>
 *
 * Empty case prints `No key-value pairs set`. Keys are already sorted
 * by the service layer.
 */
export function formatKvList(pairs: Record<string, string>): string {
  const keys = Object.keys(pairs);
  if (keys.length === 0) {
    return "No key-value pairs set\n";
  }
  const lines = ["", "Key-Value Store:"];
  for (const key of keys) {
    lines.push(`  ${key} = ${pairs[key]}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * `kv clear`: `Cleared <key>`.
 */
export function formatKvClear(result: { key: string }): string {
  return `Cleared ${result.key}\n`;
}

export const KV_META: DomainMeta = {
  name: "kv",
  summary: "general-purpose local key-value store",
  context: [
    "Flat key→value pairs persisted in `~/.linear/kv.json` for flags,",
    "env settings, or other user-defined data that should survive across",
    "CLI invocations. Local to a single machine — not synced through",
    "Linear. Distinct from `memory` (which is injected into `linear prime`);",
    "`kv` is plain ephemeral storage.",
    "",
    "Reserved prefixes: keys starting with `kv.`, `sync.`, `conflict.`,",
    "`federation.`, `jira.`, `linear.`, or `export.` are rejected so they",
    "don't get mistaken for internal config namespaces.",
  ].join("\n"),
  arguments: {
    key: "user-defined key (no reserved prefix)",
    value: "string value to store",
  },
  seeAlso: ["memory", "where"],
};

function ensureValidKey(key: string): void {
  const err = validateKvKey(key);
  if (err) {
    throw invalidParameterError("<key>", err);
  }
}

export function setupKvCommands(program: Command): void {
  const kv = program
    .command("kv")
    .description("local key-value store (flags, env, user-defined data)");
  kv.action(() => kv.help());

  kv.command("set <key> <value>")
    .description("store a key-value pair")
    .action(
      handleCommand(async (...cmdArgs: unknown[]) => {
        const [key, value, , command] = cmdArgs as [
          string,
          string,
          unknown,
          Command,
        ];
        ensureValidKey(key);
        outputResult(setKv(key, value), formatKvSet, getRootOpts(command));
      }),
    );

  kv.command("get <key>")
    .description("retrieve a value by key (exit 1 if not found)")
    .action(
      handleCommand(async (...cmdArgs: unknown[]) => {
        const [key, , command] = cmdArgs as [string, unknown, Command];
        const result = getKv(key);
        if (!result.found) {
          throw notFoundError("Key", key);
        }
        outputResult(result, formatKvGet, getRootOpts(command));
      }),
    );

  kv.command("clear <key>")
    .description("delete a key")
    .action(
      handleCommand(async (...cmdArgs: unknown[]) => {
        const [key, , command] = cmdArgs as [string, unknown, Command];
        ensureValidKey(key);
        const removed = clearKv(key);
        if (!removed) {
          throw notFoundError("Key", key);
        }
        outputResult(
          { key, deleted: true },
          formatKvClear,
          getRootOpts(command),
        );
      }),
    );

  kv.command("list")
    .description("list all key-value pairs (flat map, sorted by key)")
    .action(
      handleCommand(async (...cmdArgs: unknown[]) => {
        const [, command] = cmdArgs as [unknown, Command];
        outputResult(listKv(), formatKvList, getRootOpts(command));
      }),
    );

  kv.command("usage")
    .description("show detailed usage for kv")
    .action(() => {
      console.log(formatDomainUsage(kv, KV_META));
    });
}
