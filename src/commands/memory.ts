import type { Command } from "commander";
import { getRootOpts } from "../common/context.js";
import { invalidParameterError, notFoundError } from "../common/errors.js";
import {
  deleteMemory,
  getMemory,
  listMemories,
  slugify,
  upsertMemory,
} from "../common/memory-store.js";
import { handleCommand, outputResult } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";

/**
 * `remember` / `forget` echo: `Remembered [<key>]: <value>` (or
 * `Updated [<key>]: <value>` on upsert). The bracketed key + colon + value
 * form on a single line keeps the key visually scannable in shell scrollback.
 */
export function formatMemoryRemember(result: {
  key: string;
  value: string;
  action: "remembered" | "updated";
}): string {
  const verb = result.action === "updated" ? "Updated" : "Remembered";
  return `${verb} [${result.key}]: ${result.value}\n`;
}

/**
 * `recall`: emit the raw value, nothing else. Lets users pipe
 * `linear recall <key>` directly into other tools without parsing.
 */
export function formatMemoryRecall(result: { value: string }): string {
  return `${result.value}\n`;
}

/**
 * `memories` list block:
 *
 *   Memories (N):
 *
 *     <key>
 *       <value>
 *
 * with a blank line separating entries. Empty case prints:
 * `No memories stored. Use 'linear remember "insight"' to add one.`
 *
 * Keys are sorted by the caller (`listAction` slices Object.keys.sort()).
 */
export function formatMemoryList(entries: Record<string, string>): string {
  const keys = Object.keys(entries);
  if (keys.length === 0) {
    return "No memories stored. Use 'linear remember \"insight\"' to add one.\n";
  }
  const lines = [`Memories (${keys.length}):`, ""];
  for (const key of keys) {
    lines.push(`  ${key}`);
    lines.push(`    ${entries[key]}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

/**
 * `forget`: `Forgot [<key>]: <value>`.
 */
export function formatMemoryForget(result: {
  key: string;
  value: string;
}): string {
  return `Forgot [${result.key}]: ${result.value}\n`;
}

export const MEMORY_META: DomainMeta = {
  name: "memory",
  summary: "persistent insights and rules stored on the local machine",
  context: [
    "memories are free-form text entries (insights, rules, decisions) that",
    "persist across CLI sessions in ~/.linear/memory.json. they are intended",
    "to be injected into agent context via `linear prime`. memory is local",
    "to a single machine — not synced through Linear.",
  ].join("\n"),
  arguments: {
    key: "stable handle for a memory (auto-slugified from content if omitted)",
    insight: "free-form text body of a memory",
  },
  seeAlso: ["prime", "onboard"],
};

interface RememberOptions {
  key?: string;
}

interface ListOptions {
  search?: string;
}

function rememberAction(
  insight: string,
  options: RememberOptions,
  rootOpts: { json?: boolean | string },
): void {
  const trimmed = insight.trim();
  if (trimmed === "") {
    throw invalidParameterError("<insight>", "memory content cannot be empty");
  }
  const key = options.key ?? slugify(insight);
  if (key === "") {
    throw invalidParameterError(
      "--key",
      "could not derive a key from content; specify --key explicitly",
    );
  }
  outputResult(upsertMemory(key, insight), formatMemoryRemember, rootOpts);
}

function recallAction(
  key: string,
  rootOpts: { json?: boolean | string },
): void {
  const entry = getMemory(key);
  if (!entry) {
    throw notFoundError("Memory", key);
  }
  outputResult(
    { key, value: entry.value, found: true },
    formatMemoryRecall,
    rootOpts,
  );
}

function listAction(
  search: string | undefined,
  rootOpts: { json?: boolean | string },
): void {
  const entries = listMemories(search);
  const flat: Record<string, string> = {};
  for (const k of Object.keys(entries).sort()) {
    flat[k] = entries[k].value;
  }
  outputResult(flat, formatMemoryList, rootOpts);
}

function forgetAction(
  key: string,
  rootOpts: { json?: boolean | string },
): void {
  const removed = deleteMemory(key);
  if (!removed) {
    throw notFoundError("Memory", key);
  }
  // JSON contract: { key, deleted: true } stays. Text formatter wants
  // the value too, so we pass it as an additive field; JSON consumers
  // that check `.deleted` keep working.
  outputResult(
    { key, value: removed.value, deleted: true },
    formatMemoryForget,
    rootOpts,
  );
}

export function setupMemoryCommands(program: Command): void {
  const memory = program
    .command("memory")
    .description("manage local persistent memories");

  memory.action(() => memory.help());

  memory
    .command("remember <insight>")
    .description("store a memory; key is auto-slugified if --key is omitted")
    .option("--key <key>", "explicit memory key (upserts if it already exists)")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [insight, options, command] = args as [
          string,
          RememberOptions,
          Command,
        ];
        rememberAction(insight, options, getRootOpts(command));
      }),
    );

  memory
    .command("recall <key>")
    .description("retrieve a memory by key")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [key, , command] = args as [string, unknown, Command];
        recallAction(key, getRootOpts(command));
      }),
    );

  memory
    .command("list [search]")
    .description(
      "list memories, optionally filtered by case-insensitive substring",
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [search, , command] = args as [
          string | undefined,
          ListOptions,
          Command,
        ];
        listAction(search, getRootOpts(command));
      }),
    );

  memory
    .command("forget <key>")
    .description("delete a memory by key")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [key, , command] = args as [string, unknown, Command];
        forgetAction(key, getRootOpts(command));
      }),
    );

  memory
    .command("usage")
    .description("show detailed usage for memory")
    .action(() => {
      console.log(formatDomainUsage(memory, MEMORY_META));
    });

  program
    .command("remember <insight>")
    .description("alias for `memory remember <insight>`")
    .option("--key <key>", "explicit memory key (upserts if it already exists)")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [insight, options, command] = args as [
          string,
          RememberOptions,
          Command,
        ];
        rememberAction(insight, options, getRootOpts(command));
      }),
    );

  program
    .command("recall <key>")
    .description("alias for `memory recall <key>`")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [key, , command] = args as [string, unknown, Command];
        recallAction(key, getRootOpts(command));
      }),
    );

  program
    .command("memories [search]")
    .description("alias for `memory list [search]`")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [search, , command] = args as [
          string | undefined,
          unknown,
          Command,
        ];
        listAction(search, getRootOpts(command));
      }),
    );

  program
    .command("forget <key>")
    .description("alias for `memory forget <key>`")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [key, , command] = args as [string, unknown, Command];
        forgetAction(key, getRootOpts(command));
      }),
    );
}
