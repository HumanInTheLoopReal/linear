import fs from "node:fs";
import type { Command } from "commander";
import {
  type BatchOp,
  normalizeBatchOps,
  parseBatchScript,
} from "../common/batch-script.js";
import { getDefaultTeam } from "../common/config-store.js";
import { createContext, getRootOpts } from "../common/context.js";
import { fatalError } from "../common/errors.js";
import { handleCommand, outputResult } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import { resolveBatchOps } from "../resolvers/batch-resolver.js";
import { resolveTeamId } from "../resolvers/team-resolver.js";
import {
  type BatchDryRunResult,
  type BatchRunResult,
  buildDryRunResult,
  runBatchOps,
} from "../services/batch-service.js";
import { resolveCreateSections } from "../services/template-service.js";
import { resolveCreateValidationMode } from "./_create-validation.js";

export function formatBatchDryRun(result: BatchDryRunResult): string {
  const lines: string[] = [];
  for (const r of result.results) {
    lines.push(`line ${r.line}: ${r.raw}`);
  }
  lines.push(
    `${result.operations} operations parsed (dry-run, nothing executed)`,
  );
  return `${lines.join("\n")}\n`;
}

export function formatBatchRun(result: BatchRunResult): string {
  if (result.operations === 0) {
    return "batch: 0 operations (no-op)\n";
  }
  const lines: string[] = [`batch: ${result.operations} operations committed`];
  for (const r of result.results) {
    const target = r.target ?? "";
    lines.push(`  line ${r.line}: ${r.op} ${target}`.trimEnd());
  }
  return `${lines.join("\n")}\n`;
}

export const BATCH_META: DomainMeta = {
  name: "batch",
  summary:
    "run multiple write operations from a small line-oriented script in one invocation",
  context: [
    "Reads commands from a file (`-f`) or stdin and executes them",
    "sequentially against Linear. Useful for shell scripts that would",
    "otherwise spawn `linear` once per operation.",
    "",
    "Grammar (one command per line; `#` lines and blank lines ignored):",
    "  close <id> [reason...]",
    "  update <id> <key>=<value> [...]   (keys: status, priority, title, assignee)",
    "  create <type> <priority> <title>  (requires --team)",
    "  dep add <from-id> <to-id> [type]  (types: blocks, related, duplicate, similar)",
    "  dep remove <from-id> <to-id>",
    "",
    "Create types use the existing `type:<value>` workspace label; when",
    "that label does not exist, the create proceeds without a type label.",
    "",
    "Important: Linear has no client-side transaction. Operations run",
    "sequentially; on first failure the run stops and exits non-zero,",
    "but ops that already succeeded are NOT rolled back. Treat this as",
    "best-effort batching, not atomicity.",
  ].join("\n"),
  arguments: {},
  seeAlso: ["issues close", "issues update", "depends add", "depends remove"],
};

/**
 * Apply the create-time quality gate to a batch's `create` ops (lin-fllv).
 * The `batch create <type> <priority> <title>` grammar has no description
 * field, so a batch create can never satisfy the template gate — under the
 * default `error` mode we block the whole run (honoring "block by default
 * everywhere") and point the caller at the structured create commands. `warn`
 * proceeds with a stderr notice; `--no-validate` / `validation.on-create=off`
 * skips entirely.
 */
function enforceBatchCreateValidation(
  ops: BatchOp[],
  validateFlag: boolean | undefined,
): void {
  const mode = resolveCreateValidationMode(validateFlag);
  if (mode === "off") return;
  const createCount = ops.filter((op) => op.cmd === "create").length;
  if (createCount === 0) return;

  const sections = resolveCreateSections().map((s) => s.heading);
  const body = [
    `batch has ${createCount} create op(s), but \`batch create\` carries no description`,
    `field and cannot satisfy the issue template gate (requires ${sections.join(", ")}).`,
    "Use `linear issues create` / `linear epic create` for structured issues,",
    "or pass --no-validate to allow title-only batch creates.",
  ].join("\n");

  if (mode === "error") {
    throw fatalError(body, {
      hint: "use `linear issues create` for structured issues, or pass --no-validate to allow title-only creates",
    });
  }
  process.stderr.write(`⚠ ${body}\n`);
}

function readScriptSync(filePath: string | undefined): string {
  if (filePath) {
    return fs.readFileSync(filePath, "utf8");
  }
  // Synchronously drain stdin — agent-blocking if stdin is a TTY without
  // piped input, which is a deliberate foot-protection (a typo'd file path
  // won't silently hang forever; the caller sees an obvious prompt).
  return fs.readFileSync(0, "utf8");
}

export function setupBatchCommands(program: Command): void {
  const batch = program
    .command("batch")
    .description(
      "run a batch script of write operations (close/update/create/dep)",
    )
    .option("-f, --file <path>", "read commands from a file instead of stdin")
    .option("--dry-run", "parse and validate without writing to Linear")
    .option(
      "--team <team>",
      "team (key, name, or UUID) used by `create` ops in the script",
    )
    .option(
      "-m, --message <text>",
      "no-op: accepted for compatibility (Linear has no per-commit message)",
    )
    .option(
      "--no-validate",
      "allow title-only `create` ops (skip the issue template gate)",
    )
    .option(
      "--validate",
      "force the template gate on for `create` ops, even if validation.on-create is off",
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [
          {
            file?: string;
            dryRun?: boolean;
            team?: string;
            message?: string;
            validate?: boolean;
          },
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const input = readScriptSync(options.file);
        const ops = parseBatchScript(input);
        const hasCreate = ops.some((op) => op.cmd === "create");
        const teamKey = options.team ?? getDefaultTeam() ?? undefined;
        const normalizedOps = normalizeBatchOps(ops, {
          hasDefaultTeam: teamKey !== undefined,
        });

        if (hasCreate) {
          enforceBatchCreateValidation(ops, options.validate);
        }

        if (options.dryRun) {
          outputResult(buildDryRunResult(ops), formatBatchDryRun, rootOpts);
          return;
        }
        if (ops.length === 0) {
          outputResult(
            { operations: 0, status: "ok" as const, results: [] },
            formatBatchRun,
            rootOpts,
          );
          return;
        }

        const ctx = createContext(rootOpts);
        const defaultTeamId = teamKey
          ? await resolveTeamId(ctx.sdk, teamKey)
          : undefined;
        if (hasCreate && !defaultTeamId) {
          throw new Error(
            "batch contains `create` ops; pass --team <team> to anchor them",
          );
        }

        const resolvedOps = await resolveBatchOps(ctx.sdk, normalizedOps, {
          defaultTeamId,
        });
        const result = await runBatchOps(resolvedOps, { gql: ctx.gql });
        outputResult(result, formatBatchRun, rootOpts);
      }),
    );

  batch
    .command("usage")
    .description("show detailed usage for batch")
    .action(() => {
      console.log(formatDomainUsage(batch, BATCH_META));
    });
}
