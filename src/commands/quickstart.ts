import type { Command } from "commander";
import { getRootOpts } from "../common/context.js";
import { handleCommand, outputResult } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";

export const QUICKSTART_META: DomainMeta = {
  name: "quickstart",
  summary: "static quick-start guide for new linear users (deprecated)",
  context: [
    "Deprecated in favor of `linear prime` (agent context) and",
    "`linear onboard` (human onboarding); kept for backward compatibility.",
    "The content describes Linear-backed workflows.",
    "",
    "Output is the static content block as text by default; pass `--json`",
    "to get `{content, deprecated, see_also}`. No Linear API calls either way.",
  ].join("\n"),
  arguments: {},
  seeAlso: ["prime", "onboard", "info"],
};

const QUICKSTART_CONTENT = [
  "linear — CLI for Linear.app (human-readable text by default, --json for agents)",
  "",
  "GETTING STARTED",
  "  linear auth login           Store your Linear API token",
  "  linear where                Confirm token + on-disk paths",
  "  linear info                 Show workspace, viewer, open count",
  "",
  "CREATING ISSUES",
  '  linear issues create "Fix login bug" --team ENG',
  '  linear issues create "Add auth" --priority 1 --team ENG',
  "",
  "VIEWING ISSUES",
  "  linear issues list                       List issues",
  "  linear issues list --status open         Filter by status",
  "  linear issues show ENG-1                 Show one issue",
  "",
  "FINDING WORK",
  "  linear next                              Next issue to claim",
  "  linear blocked                           Issues blocked by deps",
  "  linear depends list ENG-1                Show dependencies",
  "",
  "UPDATING ISSUES",
  "  linear issues update ENG-1 --status started",
  '  linear issues update ENG-1 --assignee "alice@acme.com"',
  "  linear issues update ENG-1 --priority 1",
  "",
  "CLOSING ISSUES",
  "  linear issues update ENG-1 --status completed",
  "",
  "AGENT CONTEXT",
  "  linear prime                Inject context into an agent session",
  "  linear memory remember ...  Persist insights across sessions",
  "  linear hooks run prepare-commit-msg  Append Executed-By trailer",
  "",
  "OUTPUT FORMAT",
  "  Read-only verbs emit human-readable text by default. Pass the global",
  "  `--json` flag to get a structured envelope (durable contract for agents",
  '  and scripts). Errors go to stderr as `{error: "..."}` with exit code 1.',
  "",
  "DEPRECATION NOTE",
  "  This command is preserved for backward compatibility. For new",
  "  workflows, use:",
  "    • `linear prime` for AI agent context injection",
  "    • `linear onboard` for guided first-time setup",
  "    • `linear usage --all` for the full surface area",
].join("\n");

interface QuickstartShape {
  content: string;
  deprecated: boolean;
  see_also: string[];
}

export function formatQuickstart(result: QuickstartShape): string {
  return `${result.content}\n`;
}

export function setupQuickstartCommands(program: Command): void {
  const quickstart = program
    .command("quickstart")
    .description(
      "static quick-start guide (deprecated — see `linear onboard` / `prime`)",
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [, command] = args as [unknown, Command];
        const rootOpts = getRootOpts(command);
        outputResult(
          {
            content: QUICKSTART_CONTENT,
            deprecated: true,
            see_also: ["prime", "onboard"],
          },
          formatQuickstart,
          rootOpts,
        );
      }),
    );

  quickstart
    .command("usage")
    .description("show detailed usage for quickstart")
    .action(() => {
      console.log(formatDomainUsage(quickstart, QUICKSTART_META));
    });
}
