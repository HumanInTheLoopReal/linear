import type { Command } from "commander";
import { createContext, getRootOpts } from "../common/context.js";
import { handleCommand, outputResult } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import { resolveIssueId } from "../resolvers/issue-resolver.js";
import {
  branchNameFromIssue,
  currentBranch,
  isGitRepo,
  listBranches,
  switchToBranch,
} from "../services/git-service.js";
import { getIssue } from "../services/issue-service.js";

/**
 * `linear branch [id]` — git-branch integration verb.
 *
 * Two modes:
 *  - No args: list local branches with the current one marked.
 *  - With an issue id: derive a branch name `<id-lowercase>/<title-slug>`,
 *    create (or switch to) it from HEAD, and return a `{created}` envelope
 *    augmented with the linear-specific `{issue, action}` extras.
 *
 * No Linear-Direct support today — Linear can store a branch-name
 * attribute on the issue itself, but writing that back is deferred to a
 * follow-up so this change stays bounded.
 */

export const BRANCH_META: DomainMeta = {
  name: "branch",
  summary: "list git branches, or create one from a Linear issue",
  context: [
    "With no args, lists local branches with the current one marked",
    "(`🌿 Branches:` header, `*` marker on the current entry). With an",
    "issue id, derives a branch name from the issue identifier + title",
    "(`eng-42/add-search-filter`) and switches to it (creating it from",
    "HEAD if needed).",
    "",
    "The JSON envelope has stable field names (`current`/`branches`/`created`)",
    "so scripts can grep output reliably; the create-mode envelope",
    "additionally carries `issue` + `action` for the richer context.",
  ].join("\n"),
  arguments: {
    id: "(optional) issue identifier (e.g. ENG-42) or UUID — derives + switches to a branch for that issue",
  },
  seeAlso: ["issues read", "hooks install"],
};

export type BranchListResult = {
  current: string;
  branches: string[];
};

export type BranchCreateResult = {
  created: string;
  issue: { id: string; identifier: string; title: string };
  action: "created" | "switched";
};

export type BranchResult = BranchListResult | BranchCreateResult;

export function formatBranch(result: BranchResult): string {
  if ("created" in result) {
    const verb = result.action === "created" ? "Created" : "Switched to";
    return `${verb} branch: ${result.created}\n`;
  }
  const lines = ["", "🌿 Branches:", ""];
  for (const b of result.branches) {
    lines.push(b === result.current ? `  * ${b}` : `    ${b}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function setupBranchCommands(program: Command): void {
  program
    .command("branch [id]")
    .description(
      "list git branches, or derive + switch to a branch for an issue",
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [id, , command] = args as [string | undefined, unknown, Command];
        const rootOpts = getRootOpts(command);

        if (!isGitRepo()) {
          throw new Error(
            "linear branch: not inside a git working tree (run from a git repo)",
          );
        }

        if (!id) {
          const result: BranchListResult = {
            current: currentBranch(),
            branches: listBranches(),
          };
          outputResult(result, formatBranch, rootOpts);
          return;
        }

        const ctx = createContext(rootOpts);
        const issueId = await resolveIssueId(ctx.sdk, id);
        const issue = await getIssue(ctx.gql, issueId);
        const branchName = branchNameFromIssue(issue.identifier, issue.title);
        const action = switchToBranch(branchName);

        const result: BranchCreateResult = {
          created: branchName,
          issue: {
            id: issue.id,
            identifier: issue.identifier,
            title: issue.title,
          },
          action,
        };
        outputResult(result, formatBranch, rootOpts);
      }),
    );

  program
    .command("branch-usage")
    .description("show detailed usage for branch")
    .action(() => {
      const cmd = program.commands.find((c) => c.name() === "branch");
      if (cmd) console.log(formatDomainUsage(cmd, BRANCH_META));
    });
}
