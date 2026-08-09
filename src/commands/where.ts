import type { Command } from "commander";
import pkg from "../../package.json" with { type: "json" };
import { createGraphQLClient, getRootOpts } from "../common/context.js";
import { handleCommand, outputResult } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import { runWhere, type WhereResult } from "../services/where-service.js";

/**
 * Render `linear where` as a text block: header line with CLI version +
 * cwd, then one indented row per filesystem path with a `[missing]` tag
 * when the path doesn't yet exist on disk. With `--viewer`, appends a
 * `Viewer:` block.
 */
export function formatWhere(result: WhereResult): string {
  const tagFor = (exists: boolean) => (exists ? "" : "  [missing]");
  const lines = [
    `linear v${result.cli_version}`,
    `  cwd:        ${result.cwd}`,
    `  token:      ${result.paths.token_path}${tagFor(result.paths.token_exists)}  [${result.token.source}]`,
    `  memory:     ${result.paths.memory_path}${tagFor(result.paths.memory_exists)}`,
    `  audit:      ${result.paths.audit_path}${tagFor(result.paths.audit_exists)}`,
    `  snapshots:  ${result.paths.snapshots_dir}${tagFor(result.paths.snapshots_exists)}`,
  ];

  const scope = result.scope ?? { source: "none" };
  lines.push("");
  lines.push("Scope:");
  if (scope.source === "none") {
    lines.push("  (none — running in firehose mode)");
  } else {
    // Per-value provenance: show which config key/layer each value came from
    // (e.g. `[scope.team local]`) so implicit-scope surprises are debuggable.
    const r = scope.resolved;
    const marker = (e?: { source: string; key: string }) =>
      e && e.source !== "none"
        ? `  [${e.key} ${e.source}]`
        : `  [${scope.source}]`;
    lines.push(`  label:      ${scope.label}${marker(r?.label)}`);
    if (scope.team) lines.push(`  team:       ${scope.team}${marker(r?.team)}`);
    if (scope.project)
      lines.push(`  project:    ${scope.project}${marker(r?.project)}`);
    if (scope.config_path) lines.push(`  config:     ${scope.config_path}`);
  }

  if (result.viewer) {
    lines.push("");
    lines.push("Viewer:");
    if (result.viewer.organization) {
      lines.push(`  workspace:  ${result.viewer.organization.name}`);
    }
    lines.push(`  email:      ${result.viewer.email}`);
  } else if (result.viewer_error) {
    lines.push("");
    lines.push(`Viewer error: ${result.viewer_error}`);
  }
  return `${lines.join("\n")}\n`;
}

export const WHERE_META: DomainMeta = {
  name: "where",
  summary: "show on-disk linear locations and (optionally) workspace identity",
  context: [
    "linear stores its data in Linear, not on disk; this command answers",
    "'where do my linear side-files live?'. It surfaces token, memory,",
    "audit-log, and snapshot paths plus the resolved token source. Use",
    "`--viewer` to also confirm the workspace the token authenticates against",
    "(this is the only mode that issues a network call).",
    "",
    "Output JSON shape: `{cli_version, platform, cwd, paths, token, viewer?,",
    "viewer_error?}`. Paths include both the absolute path and an `*_exists`",
    "boolean so callers can detect first-run state without a second stat.",
  ].join("\n"),
  arguments: {},
  seeAlso: ["auth status", "audit path", "memory list"],
};

export function setupWhereCommands(program: Command): void {
  const where = program
    .command("where")
    .description(
      "show on-disk linear locations and resolved token source (use --viewer for workspace identity)",
    )
    .option(
      "--viewer",
      "also call `viewer` to confirm which Linear workspace the token authenticates against",
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [{ viewer?: boolean }, Command];
        const root = getRootOpts(command);
        const result = await runWhere({
          cliVersion: pkg.version,
          includeViewer: options.viewer ?? false,
          apiToken: root.apiToken,
          makeClient: createGraphQLClient,
        });
        outputResult(result, formatWhere, root);
      }),
    );

  where
    .command("usage")
    .description("show detailed usage for where")
    .action(() => {
      console.log(formatDomainUsage(where, WHERE_META));
    });
}
