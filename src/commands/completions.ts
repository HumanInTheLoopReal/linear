import type { Command } from "commander";
import { createContext, getRootOpts } from "../common/context.js";
import { handleCommand } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import {
  type CompletionShell,
  completionShells,
  generateScript,
  isCompletionShell,
  listIssueIdCompletions,
} from "../services/completions-service.js";

/**
 * `linear completion <shell>` — generate shell completion scripts.
 *
 * Commander.js has NO native completion generator, so the bash/zsh/fish scripts
 * are hand-authored in `src/common/completion-scripts.ts`. PowerShell is out of
 * scope for now (macOS/Linux are the priority for agent workflows — the
 * template approach can vendor it later).
 *
 * The generated scripts call back into a hidden `__complete` command for
 * dynamic issue-ID completion.
 */

export const COMPLETIONS_META: DomainMeta = {
  name: "completion",
  summary: "generate shell completion scripts (bash, zsh, fish)",
  context: [
    "Emits a shell completion script to stdout for the named shell. Source",
    "it to enable `<TAB>` completion of `linear` sub-commands, flags, and",
    "issue IDs.",
    "",
    "Commander.js has no built-in completion generator,",
    "so the scripts are hand-authored. The generated script shells back into",
    "a hidden `linear __complete` command for dynamic issue-ID completion;",
    "that lookup queries the Linear API for recent open issues and filters by",
    "identifier prefix client-side, degrading to no suggestions if the API or",
    "token is unavailable (a tab-completion call-back must never hang).",
    "",
    "Pass `--no-descriptions` to drop the issue-title column from completion",
    "output (identifier only). PowerShell is not supported.",
    "",
    "Install (bash):  source <(linear completion bash)",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal zsh syntax, not a JS template
    'Install (zsh):   linear completion zsh > "${fpath[1]}/_linear"',
    "Install (fish):  linear completion fish > ~/.config/fish/completions/linear.fish",
  ].join("\n"),
  arguments: {
    shell: "shell to generate completions for: bash, zsh, or fish",
  },
  seeAlso: ["info", "onboard", "quickstart"],
};

/** Completion directive: no file-completion fallback. */
const SHELL_COMP_DIRECTIVE_NO_FILE_COMP = 4;

const INSTALL_NOTES: Record<CompletionShell, string> = {
  bash: [
    "Load completions in the current shell session:",
    "  source <(linear completion bash)",
    "",
    "Load for every new session:",
    "  # Linux:",
    "  linear completion bash > /etc/bash_completion.d/linear",
    "  # macOS:",
    "  linear completion bash > $(brew --prefix)/etc/bash_completion.d/linear",
  ].join("\n"),
  zsh: [
    "If completion is not already enabled, run once:",
    '  echo "autoload -U compinit; compinit" >> ~/.zshrc',
    "",
    "Load completions in the current shell session:",
    "  source <(linear completion zsh)",
    "",
    "Load for every new session:",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal zsh syntax, not a JS template
    '  linear completion zsh > "${fpath[1]}/_linear"',
  ].join("\n"),
  fish: [
    "Load completions in the current shell session:",
    "  linear completion fish | source",
    "",
    "Load for every new session:",
    "  linear completion fish > ~/.config/fish/completions/linear.fish",
  ].join("\n"),
};

function registerShellCommand(
  completion: Command,
  shell: CompletionShell,
): void {
  completion
    .command(shell)
    .description(`generate the autocompletion script for ${shell}`)
    .option("--no-descriptions", "disable completion descriptions")
    .addHelpText("after", `\n${INSTALL_NOTES[shell]}\n`)
    .action((options: { descriptions?: boolean }) => {
      // Commander negates `--no-descriptions` into `options.descriptions`
      // (defaults to true; false when the flag is passed).
      const noDescriptions = options.descriptions === false;
      process.stdout.write(generateScript(shell, noDescriptions));
    });
}

export function setupCompletionsCommands(program: Command): void {
  const completion = program
    .command("completion")
    .description("generate shell completion scripts (bash, zsh, fish)");
  completion.action(() => completion.help());

  for (const shell of completionShells()) {
    registerShellCommand(completion, shell);
  }

  // Hidden call-back command the generated scripts invoke for dynamic
  // completion. It receives the in-progress command words after `--`; the
  // last word is the prefix being completed.
  // It emits one `value\tdescription` candidate per line, then a final
  // `:<directive>` sentinel line the shell functions strip off.
  program
    .command("__complete", { hidden: true })
    .allowUnknownOption(true)
    .argument("[words...]", "completion request words")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [words, , command] = args as [string[], unknown, Command];
        const list = Array.isArray(words) ? words : [];
        const prefix = list.length > 0 ? (list.at(-1) as string) : "";

        let lines = "";
        try {
          const ctx = createContext(getRootOpts(command));
          const completions = await listIssueIdCompletions(ctx.gql, prefix);
          lines = completions.map((c) => `${c.id}\t${c.title}`).join("\n");
        } catch {
          // createContext can throw when no token is configured; a completion
          // call-back must degrade to empty rather than surface an error.
          lines = "";
        }

        if (lines) process.stdout.write(`${lines}\n`);
        process.stdout.write(`:${SHELL_COMP_DIRECTIVE_NO_FILE_COMP}\n`);
      }),
    );

  completion
    .command("usage")
    .description("show detailed usage for completion")
    .action(() => {
      console.log(formatDomainUsage(completion, COMPLETIONS_META));
    });
}

export { isCompletionShell };
