import type { Command } from "commander";
import pkg from "../../package.json" with { type: "json" };
import { createContext, getRootOpts } from "../common/context.js";
import { handleCommand, outputResult } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import { runInfo } from "../services/info-service.js";

/**
 * Info renders a top-line banner + Workspace + Viewer + Counts blocks,
 * with an optional `What's new` block when --whats-new is passed.
 */

interface InfoResultShape {
  cli_version: string;
  platform: { key: string };
  workspace: { name: string; url_key: string } | null;
  viewer: { name: string; email: string } | null;
  counts: { open: number; open_saturated: boolean };
  whats_new?: string;
  errors?: string[];
}

export function formatInfo(result: InfoResultShape): string {
  const lines: string[] = [
    `linear ${result.cli_version}  (${result.platform.key})`,
  ];
  lines.push("");
  lines.push("Workspace:");
  if (result.workspace) {
    lines.push(`  Name: ${result.workspace.name}`);
    lines.push(`  URL:  https://linear.app/${result.workspace.url_key}`);
  } else {
    lines.push("  (unresolved — check auth)");
  }
  lines.push("");
  lines.push("Viewer:");
  if (result.viewer) {
    lines.push(`  ${result.viewer.name} <${result.viewer.email}>`);
  } else {
    lines.push("  (unresolved)");
  }
  lines.push("");
  lines.push("Counts:");
  const openSuffix = result.counts.open_saturated ? "+" : "";
  lines.push(`  Open issues: ${result.counts.open}${openSuffix}`);
  if (result.whats_new) {
    lines.push("");
    lines.push("What's new:");
    for (const line of result.whats_new.split("\n")) lines.push(`  ${line}`);
  }
  if (result.errors && result.errors.length > 0) {
    lines.push("");
    lines.push(`Errors (${result.errors.length}):`);
    for (const e of result.errors) lines.push(`  ⚠ ${e}`);
  }
  return `${lines.join("\n")}\n`;
}

export const INFO_META: DomainMeta = {
  name: "info",
  summary: "show workspace identity, viewer, and open-issue count",
  context: [
    "Workspace-shape probe: who am I authenticated as, which Linear",
    "workspace is that token bound to, and how much open work does it",
    "contain?",
    "",
    "Output JSON shape: `{cli_version, platform, workspace, viewer, counts,",
    "whats_new?, errors?}`. `workspace.url_key` is the slug Linear uses in",
    "URLs (e.g. `linear.app/<url_key>/...`).",
    "",
    "Errors from individual sub-queries (viewer / counts) are captured into",
    "`errors[]` rather than throwing, so a partial workspace-down state still",
    "yields a useful payload.",
  ].join("\n"),
  arguments: {},
  seeAlso: ["doctor", "where", "auth status"],
};

export function setupInfoCommands(program: Command): void {
  const info = program
    .command("info")
    .description(
      "show workspace identity, viewer, and open-issue count for the configured token",
    )
    .option(
      "--whats-new",
      "include a short blurb describing notable linear features",
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [{ whatsNew?: boolean }, Command];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const result = await runInfo({
          client: ctx.gql,
          cliVersion: pkg.version,
          whatsNew: options.whatsNew ?? false,
        });
        outputResult(result, formatInfo, rootOpts);
      }),
    );

  info
    .command("usage")
    .description("show detailed usage for info")
    .action(() => {
      console.log(formatDomainUsage(info, INFO_META));
    });
}
