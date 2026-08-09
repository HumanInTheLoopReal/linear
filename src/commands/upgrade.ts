import type { Command } from "commander";
import pkg from "../../package.json" with { type: "json" };
import { getRootOpts } from "../common/context.js";
import { handleCommand, outputResult } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import {
  formatUpgradeAck,
  formatUpgradeReview,
  formatUpgradeStatus,
  runUpgradeAck,
  runUpgradeReview,
  runUpgradeStatus,
} from "../services/upgrade-service.js";

/**
 * `linear upgrade` (status/review/ack).
 *
 * Tracks the CLI version the user last acknowledged (persisted in
 * ~/.linear/config.json) and surfaces what changed since. Pure local state —
 * no Linear API calls — so each subcommand reads `package.json` for the
 * current version and delegates all logic to `upgrade-service.ts`.
 */

export const UPGRADE_META: DomainMeta = {
  name: "upgrade",
  summary: "track CLI version changes and review what's new since last use",
  context: [
    "linear records the version you last acknowledged (in",
    "~/.linear/config.json, overridable with LINEAR_LAST_SEEN_VERSION) and",
    "compares it to the bundled package version on demand. There is no local",
    "database and no automatic migration — version tracking is advisory.",
    "",
    "Subcommands:",
    "  • status — has the CLI been upgraded since you last acknowledged?",
    "  • review — show the full changelog between last-seen and current.",
    "  • ack    — record the current version as seen (writes config.json).",
    "",
    "Unlike `linear info --whats-new` (a fixed highlight blurb), `upgrade",
    "review` shows ALL documented changes since your specific last version.",
    "Pass --json on any subcommand for the structured envelope.",
  ].join("\n"),
  arguments: {},
  seeAlso: ["info", "where"],
};

export function setupUpgradeCommands(program: Command): void {
  const upgrade = program
    .command("upgrade")
    .description("check and manage linear CLI version upgrades");

  upgrade.action(() => upgrade.help());

  upgrade
    .command("status")
    .description("check if linear has been upgraded since you last used it")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [, command] = args as [unknown, Command];
        const rootOpts = getRootOpts(command);
        const result = runUpgradeStatus({ currentVersion: pkg.version });
        outputResult(result, formatUpgradeStatus, rootOpts);
      }),
    );

  upgrade
    .command("review")
    .description("show changelog entries since your last-seen version")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [, command] = args as [unknown, Command];
        const rootOpts = getRootOpts(command);
        const result = runUpgradeReview({ currentVersion: pkg.version });
        outputResult(result, formatUpgradeReview, rootOpts);
      }),
    );

  upgrade
    .command("ack")
    .description("record the current version as seen")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [, command] = args as [unknown, Command];
        const rootOpts = getRootOpts(command);
        const result = runUpgradeAck({ currentVersion: pkg.version });
        outputResult(result, formatUpgradeAck, rootOpts);
      }),
    );

  upgrade
    .command("usage")
    .description("show detailed usage for upgrade")
    .action(() => {
      console.log(formatDomainUsage(upgrade, UPGRADE_META));
    });
}
