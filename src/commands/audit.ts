import fs from "node:fs";
import type { Command } from "commander";
import { appendAuditEntry, getAuditPath } from "../common/audit-store.js";
import { getRootOpts } from "../common/context.js";
import { handleCommand, outputResult } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";

export function formatAuditRecorded(payload: {
  id: string;
  kind: string;
}): string {
  return `✓ recorded · ${payload.id} · ${payload.kind}`;
}

export function formatAuditLabeled(payload: {
  id: string;
  parent_id: string;
  label: string;
}): string {
  return `✓ labeled · ${payload.id} → ${payload.parent_id} · ${payload.label}`;
}

export function formatAuditPath(payload: { path: string }): string {
  return payload.path;
}

export const AUDIT_META: DomainMeta = {
  name: "audit",
  summary:
    "append agent-interaction entries to .linear/audit.jsonl (per-repo) or ~/.linear/audit.jsonl (--global)",
  context: [
    "Local-only: agent interaction logs are high-write and agent-private, so",
    "they live in a JSONL file rather than Linear comments. By default the",
    "log is per-repo at `<repo>/.linear/audit.jsonl` (intended to be",
    "git-tracked alongside the repo); `--global` switches to per-user",
    "`~/.linear/audit.jsonl`. When invoked outside any git repo the per-user",
    "path is used automatically.",
    "",
    "the file is append-only JSONL — each line is one entry. callers must",
    "never mutate existing lines; corrections are made by appending a new",
    "`label` entry that references the original via `parent_id`.",
    "",
    "the entry shape has stable fields (id, kind, actor, issue_id, model,",
    "prompt, response, tool_name, exit_code, error, parent_id, label,",
    "reason, extra, created_at) so dataset pipelines can rely on the schema.",
  ].join("\n"),
  arguments: {},
  seeAlso: ["memory list", "prime"],
};

export function setupAuditCommands(program: Command): void {
  const audit = program
    .command("audit")
    .description("record and label agent interactions (append-only JSONL)");

  audit.action(() => audit.help());

  audit
    .command("record")
    .description(
      "append one interaction entry to .linear/audit.jsonl (per-repo) or ~/.linear/audit.jsonl (--global)",
    )
    .option("--kind <kind>", "entry kind (llm_call, tool_call, etc.)")
    .option("--actor <name>", "actor name (agent or user)")
    .option("--issue-id <id>", "related Linear issue identifier (e.g. ENG-7)")
    .option("--model <name>", "model name (llm_call entries)")
    .option("--prompt <text>", "prompt text (llm_call entries)")
    .option("--response <text>", "response text (llm_call entries)")
    .option("--tool-name <name>", "tool name (tool_call entries)")
    .option(
      "--exit-code <n>",
      "exit code (tool_call entries); omit if no process ran",
      (v) => Number.parseInt(v, 10),
    )
    .option("--error <text>", "error text")
    .option(
      "--stdin",
      "read a full JSON entry from stdin (must match the audit.Entry shape)",
      false,
    )
    .option(
      "--global",
      "write to the per-user ~/.linear/audit.jsonl log instead of the per-repo log",
      false,
    )
    .addHelpText(
      "after",
      `\nStdin auto-detection: if stdin is piped and no record flags are set,
the JSON on stdin is consumed automatically without needing --stdin.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [
          {
            kind?: string;
            actor?: string;
            issueId?: string;
            model?: string;
            prompt?: string;
            response?: string;
            toolName?: string;
            exitCode?: number;
            error?: string;
            stdin: boolean;
            global: boolean;
          },
          Command,
        ];

        const stdinPiped = !process.stdin.isTTY;
        const noFieldsProvided =
          !options.kind &&
          !options.model &&
          !options.prompt &&
          !options.response &&
          !options.issueId &&
          !options.toolName &&
          options.exitCode === undefined &&
          !options.error;

        let entry: Parameters<typeof appendAuditEntry>[0];

        if (options.stdin || (stdinPiped && noFieldsProvided)) {
          const buf = fs.readFileSync(0, "utf8");
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(buf) as Record<string, unknown>;
          } catch (err) {
            throw new Error(`invalid JSON on stdin: ${(err as Error).message}`);
          }
          if (typeof parsed.kind !== "string" || parsed.kind === "") {
            throw new Error("stdin JSON must include a non-empty 'kind'");
          }
          entry = parsed as unknown as Parameters<typeof appendAuditEntry>[0];
          if (options.actor) entry.actor = options.actor;
        } else {
          if (!options.kind) {
            throw new Error("--kind is required");
          }
          entry = {
            kind: options.kind,
            actor: options.actor,
            issue_id: options.issueId,
            model: options.model,
            prompt: options.prompt,
            response: options.response,
            tool_name: options.toolName,
            exit_code: options.exitCode,
            error: options.error,
          };
        }

        const written = appendAuditEntry(entry, { global: options.global });
        outputResult(
          { id: written.id, kind: written.kind },
          formatAuditRecorded,
          getRootOpts(command),
        );
      }),
    );

  audit
    .command("label <entry-id>")
    .description(
      "append a label entry referencing an existing interaction (append-only correction)",
    )
    .requiredOption("--label <value>", `label value (e.g. "good" or "bad")`)
    .option("--reason <text>", "human/pipeline reason for the label")
    .option("--actor <name>", "actor recording the label")
    .option(
      "--global",
      "write to the per-user ~/.linear/audit.jsonl log instead of the per-repo log",
      false,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [entryId, options, command] = args as [
          string,
          {
            label: string;
            reason?: string;
            actor?: string;
            global: boolean;
          },
          Command,
        ];
        const written = appendAuditEntry(
          {
            kind: "label",
            parent_id: entryId,
            label: options.label,
            reason: options.reason,
            actor: options.actor,
          },
          { global: options.global },
        );
        outputResult(
          {
            id: written.id,
            parent_id: entryId,
            label: options.label,
          },
          formatAuditLabeled,
          getRootOpts(command),
        );
      }),
    );

  audit
    .command("path")
    .description("print the absolute path to the audit log file")
    .option(
      "--global",
      "print the per-user ~/.linear/audit.jsonl path instead of the per-repo path",
      false,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [{ global: boolean }, Command];
        outputResult(
          { path: getAuditPath({ global: options.global }) },
          formatAuditPath,
          getRootOpts(command),
        );
      }),
    );

  audit
    .command("usage")
    .description("show detailed usage for audit")
    .action(() => {
      console.log(formatDomainUsage(audit, AUDIT_META));
    });
}
