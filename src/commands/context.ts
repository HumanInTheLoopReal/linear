import type { Command } from "commander";
import pkg from "../../package.json" with { type: "json" };
import { createContext, getRootOpts } from "../common/context.js";
import { handleCommand, outputResult } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import { type ContextResult, runContext } from "../services/context-service.js";

/**
 * Render `linear context` as a text block with three sections:
 * Workspace / Viewer / Default team.
 *
 * Sub-query failures (carried by `result.errors`) print as a trailing
 * `Errors:` block so degraded context is still useful for diagnostics
 * — matches the JSON contract where `errors[]` doesn't fail the call.
 */
export function formatContext(result: ContextResult): string {
  const lines: string[] = [`linear v${result.cli_version}`];

  if (result.workspace) {
    lines.push("");
    lines.push("Workspace:");
    lines.push(`  name:        ${result.workspace.name}`);
    lines.push(`  url key:     ${result.workspace.url_key}`);
  }

  if (result.viewer) {
    lines.push("");
    lines.push("Viewer:");
    lines.push(`  name:        ${result.viewer.name}`);
    lines.push(`  email:       ${result.viewer.email}`);
  }

  lines.push("");
  lines.push("Default team:");
  const team = result.default_team;
  if (team.configured === null) {
    lines.push(
      "  (none configured — set with `linear config set team.default <KEY>`)",
    );
  } else if (team.resolved) {
    lines.push(`  configured:  ${team.configured}`);
    lines.push(`  resolved:    ${team.resolved.key} (${team.resolved.name})`);
  } else {
    lines.push(`  configured:  ${team.configured}`);
    lines.push(
      `  resolved:    (unresolved${team.error ? `: ${team.error}` : ""})`,
    );
  }

  if (result.errors && result.errors.length > 0) {
    lines.push("");
    lines.push("Errors:");
    for (const err of result.errors) {
      lines.push(`  - ${err}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export const CONTEXT_META: DomainMeta = {
  name: "context",
  summary: "show effective Linear identity (workspace + default team)",
  context: [
    "Reports the effective Linear identity: which workspace + default",
    "team does my token resolve to?",
    "",
    "Differs from `linear where`:",
    "  • `where` is filesystem-first, offline by default. Reports paths.",
    "  • `context` is Linear-first, always online. Reports identity.",
    "",
    "Errors from sub-queries (viewer / team lookup) land in `errors[]`",
    "rather than failing the whole call — degraded context is still",
    "useful for diagnostics.",
  ].join("\n"),
  arguments: {},
  seeAlso: ["where", "info", "auth status"],
};

export function setupContextCommands(program: Command): void {
  const context = program
    .command("context")
    .description(
      "show effective Linear identity (workspace, viewer, default team)",
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [, command] = args as [Record<string, never>, Command];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const result = await runContext({
          client: ctx.gql,
          cliVersion: pkg.version,
        });
        outputResult(result, formatContext, rootOpts);
      }),
    );

  context
    .command("usage")
    .description("show detailed usage for context")
    .action(() => {
      console.log(formatDomainUsage(context, CONTEXT_META));
    });
}
