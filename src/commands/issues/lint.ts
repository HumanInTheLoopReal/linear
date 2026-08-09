import type { Command } from "commander";
import { createContext, getRootOpts } from "../../common/context.js";
import { invalidParameterError } from "../../common/errors.js";
import { isUuid } from "../../common/identifier.js";
import { stateTypesForLogicalStatus } from "../../common/issue-lifecycle.js";
import { handleCommand, outputResult } from "../../common/output.js";
import type {
  IssueFilter,
  IssueLintFieldsFragment,
} from "../../gql/graphql.js";
import { resolveIssueId } from "../../resolvers/issue-resolver.js";
import { updateIssue } from "../../services/issue-service.js";
import {
  buildLintFixes,
  buildLintSummary,
  fetchIssuesForLint,
  getIssueForLint,
  type LintFix,
} from "../../services/lint-service.js";

interface LintSummaryShape {
  total: number;
  issues: number;
  results: Array<{
    identifier: string | null;
    title: string;
    type: string;
    missing: string[];
    empty: string[];
  }>;
}

export function mapLintStatusToStateTypes(status: string): string[] | null {
  if (status !== "open" && status !== "in_progress" && status !== "closed") {
    return null;
  }
  const stateTypes = stateTypesForLogicalStatus(status);
  return stateTypes ? [...stateTypes] : null;
}

export function formatIssueLint(summary: LintSummaryShape): string {
  if (summary.results.length === 0) return "\n✓ No template warnings.\n\n";
  const lines: string[] = [
    `Template warnings (${summary.issues} issues, ${summary.total} warnings):`,
    "",
  ];
  for (const result of summary.results) {
    const id = result.identifier ?? "(no-id)";
    lines.push(`${id} [${result.type}]: ${result.title}`);
    for (const missing of result.missing) lines.push(`  ⚠ Missing: ${missing}`);
    for (const empty of result.empty) lines.push(`  ⚠ Empty: ${empty}`);
    lines.push("");
  }
  if (lines[lines.length - 1] === "") lines.pop();
  return `${lines.join("\n")}\n`;
}

export function formatIssueLintFix(result: {
  fixed: number;
  issues: LintFix[];
}): string {
  if (result.fixed === 0) {
    return "\n✓ Nothing to fix — every issue already has its required sections.\n\n";
  }
  const lines: string[] = [
    `Fixed ${result.fixed} issue${result.fixed === 1 ? "" : "s"} (placeholder sections appended):`,
    "",
  ];
  for (const issue of result.issues) {
    const id = issue.identifier ?? "(no-id)";
    lines.push(`${id} [${issue.type}]: ${issue.title}`);
    for (const heading of issue.added) lines.push(`  + ${heading}`);
    lines.push("");
  }
  if (lines[lines.length - 1] === "") lines.pop();
  return `${lines.join("\n")}\n`;
}

export function registerIssueLintCommand(issues: Command): void {
  issues
    .command("lint [issues...]")
    .description("check issues for missing template sections per issue type")
    .option(
      "-t, --type <type>",
      "filter by issue type (bug, task, feature, epic, ...)",
    )
    .option(
      "-s, --status <status>",
      "filter by status: open (default), in_progress, closed, all",
    )
    .option(
      "--fix",
      "append placeholder skeletons for each missing required section (preserves existing content) and save",
    )
    .addHelpText(
      "after",
      `\nLinear-Hack: issue type is derived from the first 'type:<value>' label
(workspace convention). Untyped issues have no required sections.

An issue's required sections are the active create template's universal
sections (see 'linear template show') with the type-specific block below
substituted for the template's type slot — the same resolution 'issues create'
validates against, so a body the create gate accepts passes the lint.

Built-in type-specific block (universal sections come from the template, so
none of these name ## Context or a verification section):
  bug:      ## Steps to Reproduce, ## Acceptance Criteria
  task:     ## Acceptance Criteria
  feature:  ## Acceptance Criteria
  story:    ## Acceptance Criteria
  epic:     ## Success Criteria
  decision: ## Decision, ## Rationale, ## Alternatives Considered
  spike:    ## Goal, ## Findings
  chore:    (none — universal sections only)

With the default template that means, e.g., an epic needs ## Context,
## Success Criteria and ## Test Plan, while a task needs ## Context,
## Acceptance Criteria and ## Test Plan.

A repo can replace any type's block via the
'template.required-sections-by-type' config key; 'linear template show' prints
the effective contract, and --fix injects whatever it resolves to.

Exit code: 1 when warnings exist in text mode (default), so a shell
pre-merge check can gate on \`linear issues lint\`. Always 0 with --json;
agents gate on the envelope's .total field instead.

--fix injects an empty '## Heading\n\n<!-- hint -->' block for every missing
section (existing content is preserved) and saves the issue, so a follow-up
lint passes. Shares the skeleton generator with 'issues create' validation.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [positionalIds, options, command] = args as [
          string[] | undefined,
          { type?: string; status?: string; fix?: boolean },
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        let issuesToCheck: IssueLintFieldsFragment[];
        if (positionalIds && positionalIds.length > 0) {
          issuesToCheck = await Promise.all(
            positionalIds.map(async (raw) => {
              const issueId = isUuid(raw)
                ? raw
                : await resolveIssueId(ctx.sdk, raw);
              return await getIssueForLint(ctx.gql, issueId);
            }),
          );
        } else {
          const filter: IssueFilter = {};
          const status = options.status ?? "open";
          if (status !== "all") {
            const stateTypes = mapLintStatusToStateTypes(status);
            if (stateTypes === null) {
              throw invalidParameterError(
                "--status",
                `unknown status '${status}'. supported: open, in_progress, closed, all`,
              );
            }
            filter.state = { type: { in: stateTypes } };
          }
          if (options.type) {
            filter.labels = { name: { eq: `type:${options.type}` } };
          }
          issuesToCheck = await fetchIssuesForLint(ctx.gql, filter);
        }

        if (options.fix) {
          const fixes = buildLintFixes(issuesToCheck);
          for (const fix of fixes) {
            await updateIssue(ctx.gql, fix.id, {
              description: fix.description,
            });
          }
          outputResult(
            { fixed: fixes.length, issues: fixes },
            formatIssueLintFix,
            rootOpts,
          );
          return;
        }
        const summary = buildLintSummary(issuesToCheck);
        outputResult(summary, formatIssueLint, rootOpts);
        if (!rootOpts.json && summary.total > 0) process.exit(1);
      }),
    );
}
