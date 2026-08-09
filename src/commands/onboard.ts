import type { Command } from "commander";
import { getRootOpts } from "../common/context.js";
import { handleCommand, outputResult } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import {
  AGENTS_SNIPPET,
  COPILOT_INSTRUCTIONS_SNIPPET,
} from "../templates/agents-snippet.js";

export const ONBOARD_META: DomainMeta = {
  name: "onboard",
  summary: "print a minimal AGENTS.md snippet pointing at `linear prime`",
  context: [
    "outputs a short markdown snippet that users can paste into AGENTS.md",
    "(or .github/copilot-instructions.md) so coding agents know to call",
    "`linear prime` for dynamic workflow context instead of duplicating it.",
    "",
    "Use `linear setup agents` to install the same snippet into AGENTS.md",
    "as a managed block that can be re-rendered on upgrade.",
  ].join("\n"),
  arguments: {},
  seeAlso: ["prime", "setup"],
};

interface OnboardShape {
  snippet: string;
  copilot: string;
}

export function formatOnboard(result: OnboardShape): string {
  return `linear onboarding

Add this minimal snippet to AGENTS.md (or create it):

--- BEGIN AGENTS.MD CONTENT ---
${result.snippet}--- END AGENTS.MD CONTENT ---

For GitHub Copilot users:
Copilot reads .github/copilot-instructions.md on every completion, so it gets a tighter variant:

--- BEGIN COPILOT-INSTRUCTIONS.MD CONTENT ---
${result.copilot}--- END COPILOT-INSTRUCTIONS.MD CONTENT ---

How it works:
   • linear prime provides dynamic workflow context (~150 lines, always current)
   • linear hooks install auto-injects \`linear prime\` at session start (lefthook or .git/hooks/)
   • AGENTS.md only needs this minimal pointer, not full instructions

This keeps AGENTS.md lean while linear prime provides up-to-date workflow details.

For Claude Code users:
   • Run \`/plugin install linear\` inside Claude Code to pull the official
     plugin bundle (slash commands + auto-loaded reference docs under
     \`plugins/linear/skills/linear/resources/\`). Pairs with the
     SessionStart hook the wizard installs.

For hookless agents (Codex, Factory, Mux):
   • Pass \`--agents-profile=full\` to \`linear init\` to inline the command
     reference into AGENTS.md. Hooked agents (Claude, Gemini) should keep
     the default \`minimal\` profile so the brief stays in \`linear prime\`.
`;
}

export function setupOnboardCommands(program: Command): void {
  program
    .command("onboard")
    .description("print an AGENTS.md snippet pointing at `linear prime`")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [, command] = args as [unknown, Command];
        const rootOpts = getRootOpts(command);
        outputResult(
          { snippet: AGENTS_SNIPPET, copilot: COPILOT_INSTRUCTIONS_SNIPPET },
          formatOnboard,
          rootOpts,
        );
      }),
    );

  program
    .command("onboard-usage")
    .description("show detailed usage for onboard")
    .action(() => {
      const cmd = program.commands.find((c) => c.name() === "onboard");
      if (cmd) console.log(formatDomainUsage(cmd, ONBOARD_META));
    });
}
