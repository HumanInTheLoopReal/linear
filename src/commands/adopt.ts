import type { Command } from "commander";
import { getDefaultTeam } from "../common/config-store.js";
import { createContext, getRootOpts } from "../common/context.js";
import { invalidParameterError } from "../common/errors.js";
import { handleCommand, outputResult } from "../common/output.js";
import { getActiveScope } from "../common/scope-filter.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import { resolveProjectId } from "../resolvers/project-resolver.js";
import { resolveTeamId } from "../resolvers/team-resolver.js";
import {
  type AdoptCandidate,
  findUnscopedCandidates,
  type TaggedIssue,
  tagWithScope,
} from "../services/adopt-service.js";
import { ensureWorkspaceLabel } from "../services/label-service.js";

export const ADOPT_META: DomainMeta = {
  name: "adopt",
  summary:
    "retroactively tag pre-scope issues with the implicit `git:<name>` label",
  context: [
    "Most useful for teams migrating an existing Linear workspace onto the",
    "per-repo scope model. After `linear` derives a `scope.label` for the",
    "current repo (e.g. `git:linear-cli`), older issues that were created",
    "before the label existed are invisible to `linear next` / `linear list`",
    "until they're tagged. `linear adopt` finds those candidates and adds",
    "the scope label.",
    "",
    "Candidates: non-terminal issues (triage / backlog / unstarted / started) in",
    "the team (and optionally a project) that do NOT yet carry the scope",
    "label. Default narrowing is `scope.team` if set, else workspace-wide.",
    "",
    "Flags:",
    "  --all          tag every candidate without prompting",
    "  --project <id> narrow to a project (defaults to scope.default_project)",
    "  --team <key>   override team narrowing",
    "  --dry-run      print what would be tagged, change nothing",
    "  --scope <l>    override the implicit scope label",
    "",
    "Without `--all`, the command is currently dry-run only — interactive",
    "selection is not implemented yet. Pass `--all` for the non-interactive",
    "tag pass.",
  ].join("\n"),
  arguments: {},
  seeAlso: ["where", "config get scope.label", "issues tag"],
};

interface AdoptResult {
  scope_label: string;
  scope_label_id: string;
  candidates: AdoptCandidate[];
  tagged: TaggedIssue[];
  dry_run: boolean;
}

export function formatAdopt(result: AdoptResult): string {
  const { scope_label, candidates, tagged, dry_run } = result;
  if (candidates.length === 0) {
    return `No issues to adopt (every open issue already carries ${scope_label}).\n`;
  }
  if (dry_run) {
    const lines = [
      `Dry run: ${candidates.length} candidate(s) would be tagged with ${scope_label}:`,
      ...candidates.map((c) => `  ${c.identifier}: ${c.title}`),
      "",
      "Re-run with --all to apply.",
    ];
    return `${lines.join("\n")}\n`;
  }
  return `Tagged ${tagged.length} issue(s) with ${scope_label}.\n`;
}

export function setupAdoptCommands(program: Command): void {
  const adopt = program
    .command("adopt")
    .description(
      "tag pre-scope issues with the implicit repo label (migration helper)",
    )
    .option(
      "--all",
      "tag every candidate non-interactively (currently the only execute mode)",
    )
    .option(
      "--project <id>",
      "narrow to a single project (defaults to scope.default_project if set)",
    )
    .option(
      "--team <key>",
      "narrow to a single team (defaults to scope.team / team.default)",
    )
    .option("--dry-run", "print what would be tagged, change nothing")
    .option(
      "--scope <label>",
      "use this label instead of the resolved scope.label",
    )
    .option("--limit <n>", "stop after this many candidates", "1000")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [
          {
            all?: boolean;
            project?: string;
            team?: string;
            dryRun?: boolean;
            scope?: string;
            limit?: string;
          },
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);

        const scope = getActiveScope(
          process.env,
          options.scope ? { label: options.scope } : undefined,
        );
        const scopeLabel = scope.label;
        if (!scopeLabel) {
          throw invalidParameterError(
            "scope.label",
            "no scope label is configured for this repo; run inside a git repo or pass --scope <label>",
          );
        }

        const teamKey = options.team ?? getDefaultTeam() ?? undefined;
        const teamId = teamKey
          ? await resolveTeamId(ctx.sdk, teamKey)
          : undefined;
        const projectRef = options.project ?? scope.project;
        const projectId = projectRef
          ? await resolveProjectId(ctx.sdk, projectRef)
          : undefined;

        const limit = options.limit
          ? Number.parseInt(options.limit, 10)
          : undefined;
        if (limit !== undefined && (Number.isNaN(limit) || limit < 1)) {
          throw invalidParameterError("--limit", "must be a positive integer");
        }

        const candidates = await findUnscopedCandidates(ctx.gql, {
          teamId,
          projectId,
          scopeLabel,
          limit,
        });

        // The default mode (no --all) is dry-run-equivalent: list candidates
        // without mutating. --dry-run is the explicit form. --all is the
        // only path that actually writes.
        const isDryRun = !options.all || options.dryRun === true;

        if (isDryRun || candidates.length === 0) {
          outputResult(
            {
              scope_label: scopeLabel,
              scope_label_id: "",
              candidates,
              tagged: [],
              dry_run: true,
            },
            formatAdopt,
            rootOpts,
          );
          return;
        }

        const scopeLabelId = await ensureWorkspaceLabel(
          ctx.gql,
          scopeLabel,
          `Label '${scopeLabel}'.`,
        );
        const tagged = await tagWithScope(ctx.gql, candidates, scopeLabelId);

        outputResult(
          {
            scope_label: scopeLabel,
            scope_label_id: scopeLabelId,
            candidates,
            tagged,
            dry_run: false,
          },
          formatAdopt,
          rootOpts,
        );
      }),
    );

  adopt
    .command("usage")
    .description("show detailed usage for adopt")
    .action(() => {
      console.log(formatDomainUsage(adopt, ADOPT_META));
    });
}
