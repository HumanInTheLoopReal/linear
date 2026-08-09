import fs from "node:fs";
import type { Command } from "commander";
import { getDefaultTeam } from "../common/config-store.js";
import { createContext, getRootOpts } from "../common/context.js";
import { fatalError, invalidParameterError } from "../common/errors.js";
import { handleCommand, outputResult } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import { resolveTeamId } from "../resolvers/team-resolver.js";
import {
  composeChildDescription,
  createEpicWithChildren,
  type EpicCreateResult,
  parseChildrenJsonl,
  withComposedDescription,
} from "../services/epic-service.js";
import { resolveRequiredSections } from "../services/lint-service.js";
import {
  checkAgainstTemplate,
  resolveCreateValidationMode,
} from "./_create-validation.js";
import { runCloseEligibleEpics, runEpicStatus } from "./_epic-status.js";

export const EPIC_META: DomainMeta = {
  name: "epic",
  summary: "atomic epic + children + dependency wiring in one call (lin-tij0)",
  context: [
    "Collapses the 10-step 'create epic, create N children, wire M",
    "dependency edges' planning workflow into a single verb. Reads",
    "the children spec as JSONL — one JSON object per line — and",
    "creates the epic, then each child with parentId=epic, then",
    "wires `blocked_by` references as Linear `Blocks` relations.",
    "",
    "Children spec fields per line:",
    "  title       (required) — child issue title",
    "  description (optional) — markdown body",
    "  priority    (optional) — 0..4 (0=No priority, 1=Urgent, …)",
    "  acceptance  (optional) — appended as `## Acceptance Criteria`",
    "  design      (optional) — appended as `## Design`",
    "  notes       (optional) — appended as `## Notes`",
    "  blocked_by  (optional) — array of OTHER child titles in this spec",
    "",
    "Unlike `linear molecules pour` (reusable template + variables),",
    "`epic create` is one-shot — feed the literal spec for this single",
    "epic. Use molecules for repeated workflows; use `epic create` for",
    "ad-hoc planning.",
    "",
    "Linear has no client-side transactions: on partial failure",
    "whatever already succeeded stays in Linear. The result includes",
    "all created identifiers so a caller can clean up.",
    "",
    "Management verbs:",
    "  • status [--team] [--eligible-only]  — child-completion dashboard",
    "    across every open epic (any open issue with children).",
    "  • close-eligible [--team] [--dry-run] — close epics whose children",
    "    are all done. Both are aliases of `issues epic-status` /",
    "    `issues close-eligible-epics` and reuse the same children data.",
  ].join("\n"),
  arguments: {
    title: "epic title (positional)",
  },
  seeAlso: [
    "issues epic-status",
    "issues close-eligible-epics",
    "molecules pour",
    "depends add",
  ],
};

export function formatEpicCreate(result: EpicCreateResult): string {
  const lines: string[] = [];
  lines.push(`✓ Created epic ${result.epic.identifier}: ${result.epic.title}`);
  for (const child of result.children) {
    lines.push(`  ✓ ${child.identifier}: ${child.title}`);
  }
  if (result.dependencies.length > 0) {
    lines.push(`\nDependencies (${result.dependencies.length}):`);
    for (const d of result.dependencies) {
      lines.push(`  ${d.from} blocked by ${d.to}`);
    }
  }
  return lines.join("\n");
}

interface EpicCreateOpts {
  team?: string;
  childrenFile?: string;
  children?: string;
  description?: string;
  validate?: boolean;
}

/**
 * Fail-fast pre-flight for the create gate (lin-fllv). Linear has no
 * client-side transaction, so `createEpicWithChildren` would leave a half-built
 * epic behind if a child failed validation mid-flight. Instead we validate the
 * parent and EVERY child description up front and block ONCE, listing every
 * offending issue so the agent can fix them all in a single pass.
 *
 * The parent is validated as an epic (`## Success Criteria` in place of the
 * template's type slot) and the children as untyped issues, both through the
 * same `resolveRequiredSections` the lint uses.
 *
 * Returns the bodies to create with. Shape repairs are applied to the parent and
 * every child, and reported once for the whole batch, so a twenty-child epic
 * does not emit twenty near-identical notices.
 */
export function enforceEpicCreateValidation(
  title: string,
  description: string | undefined,
  children: { title: string }[],
  childDescriptions: (string | undefined)[],
  validateFlag: boolean | undefined,
): {
  description: string | undefined;
  childDescriptions: (string | undefined)[];
} {
  const unchanged = { description, childDescriptions };
  const mode = resolveCreateValidationMode(validateFlag);
  if (mode === "off") return unchanged;

  const childSections = resolveRequiredSections(null);
  const epicSections = resolveRequiredSections("epic");
  const problems: string[] = [];
  let repaired = 0;

  const parent = checkAgainstTemplate(description, epicSections);
  if (parent.notice) repaired++;
  if (parent.problems.length > 0) {
    problems.push(`epic "${title}": ${parent.problems.join(", ")}`);
  }

  const checkedChildren = children.map((child, i) => {
    const checked = checkAgainstTemplate(childDescriptions[i], childSections);
    if (checked.notice) repaired++;
    if (checked.problems.length > 0) {
      problems.push(`child "${child.title}": ${checked.problems.join(", ")}`);
    }
    return childDescriptions[i] === undefined ? undefined : checked.description;
  });

  if (repaired > 0) {
    process.stderr.write(
      `✎ formatted ${repaired} description${repaired === 1 ? "" : "s"} to match the template\n`,
    );
  }

  const result = {
    description: description === undefined ? undefined : parent.description,
    childDescriptions: checkedChildren,
  };
  if (problems.length === 0) return result;

  const body = [
    "epic create blocked — required sections missing or empty:",
    ...problems.map((p) => `  - ${p}`),
    "",
    "Every issue must contain the gate's sections (see `linear template show`).",
    "Add them to the epic --description and each child (description / acceptance),",
    "or pass --no-validate to skip.",
  ].join("\n");

  if (mode === "error") {
    throw fatalError(body, {
      hint: "fill in the missing sections above, or pass --no-validate to skip",
    });
  }
  process.stderr.write(`⚠ ${body}\n`);
  return result;
}

function readChildrenInput(opts: EpicCreateOpts): string {
  if (opts.children === "-") {
    return fs.readFileSync(0, "utf8");
  }
  if (opts.children) {
    return opts.children;
  }
  if (opts.childrenFile) {
    return fs.readFileSync(opts.childrenFile, "utf8");
  }
  throw invalidParameterError(
    "--children",
    "pass --children-file <path>, --children '-' (read stdin), or --children <jsonl-string>",
  );
}

export function setupEpicCommands(program: Command): void {
  const epic = program
    .command("epic")
    .description(
      "epic management: atomic create + completion status + close-eligible",
    );

  epic
    .command("create <title>")
    .description("create an epic with children and dependencies in one call")
    .option(
      "--team <team>",
      "team key/name/UUID for the epic + children (defaults to config team)",
    )
    .option(
      "--children-file <path>",
      "path to a JSONL file with one child object per line",
    )
    .option(
      "--children <jsonl>",
      "inline JSONL string, or '-' to read JSONL from stdin",
    )
    .option(
      "--description <text>",
      "markdown body for the epic itself (optional)",
    )
    .option(
      "--validate",
      "force required-section validation on, even if validation.on-create is off",
    )
    .option(
      "--no-validate",
      "skip required-section validation for this epic + children",
    )
    .addHelpText(
      "after",
      `\nExamples:
  linear epic create "Q3 Auth Refactor" --team ENG --children-file plan.jsonl
  cat plan.jsonl | linear epic create "Plan" --team ENG --children -
  linear epic create "Tiny" --team ENG --children '{"title":"Setup"}\\n{"title":"Done","blocked_by":["Setup"]}'

JSONL line example:
  {"title":"Implement A","priority":2,"blocked_by":["Setup"]}

Notes:
  - blocked_by references OTHER child titles in the same spec.
  - Each child inherits the epic's team. No cross-team children.
  - On partial failure, ids that succeeded stay in Linear (no rollback).`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [title, options, command] = args as [
          string,
          EpicCreateOpts,
          Command,
        ];
        if (!title || title.trim() === "") {
          throw invalidParameterError("<title>", "epic title is required");
        }
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);

        const teamKey = options.team ?? getDefaultTeam() ?? undefined;
        if (!teamKey) {
          throw invalidParameterError(
            "--team",
            "pass --team <key> or set a default team via `linear config set team.default <key>`",
          );
        }

        const childrenInput = readChildrenInput(options);
        const children = parseChildrenJsonl(childrenInput);
        if (children.length === 0) {
          throw invalidParameterError(
            "--children",
            "at least one child is required (got 0)",
          );
        }

        // Pre-flight the gate across the parent + all children BEFORE any
        // network call, so a malformed spec is rejected without touching Linear
        // and never leaves a half-built epic behind. The gate also hands back
        // repaired bodies, which are folded into the specs so the fix survives
        // the composition `createEpicWithChildren` does on its own.
        const composed = children.map((spec) => composeChildDescription(spec));
        const checked = enforceEpicCreateValidation(
          title,
          options.description,
          children,
          composed,
          options.validate,
        );
        const validatedChildren = children.map((spec, i) =>
          checked.childDescriptions[i] === composed[i]
            ? spec
            : withComposedDescription(spec, checked.childDescriptions[i]),
        );

        const teamId = await resolveTeamId(ctx.sdk, teamKey);
        const result = await createEpicWithChildren(ctx.gql, {
          teamId,
          title,
          description: checked.description,
          children: validatedChildren,
        });
        outputResult(result, formatEpicCreate, rootOpts);
      }),
    );

  // The `epic` group exposes management verbs `status` and
  // `close-eligible` alongside creation. linear's epic-completion dashboard
  // and close-eligible listing already live under `issues epic-status` /
  // `issues close-eligible-epics` (+ top-level aliases); surface them here too
  // so the `epic` namespace is self-contained. Both delegate to the shared
  // shared runners — no logic duplication. (lin-xzcf)
  epic
    .command("status")
    .description(
      "show child-completion progress for every open issue that has children",
    )
    .option(
      "--team <team>",
      "scope to one team (key, name, or UUID); without this, scans the whole workspace",
    )
    .option(
      "--eligible-only",
      "only show epics whose every child is closed (ready to be closed)",
      false,
    )
    .addHelpText(
      "after",
      `\nAlias of \`linear issues epic-status\`. Linear has no native epic type —
any open issue with at least one child is treated as an epic.
'closed_children' counts children in a terminal state (completed, canceled, or duplicate).`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [
          { team?: string; eligibleOnly?: boolean },
          Command,
        ];
        await runEpicStatus(command, options);
      }),
    );

  epic
    .command("close-eligible")
    .description(
      "close every open epic whose every child is closed (transitions to 'completed')",
    )
    .option(
      "--team <team>",
      "scope to one team (key, name, or UUID); without this, scans the whole workspace",
    )
    .option("--dry-run", "preview eligible epics without closing them", false)
    .addHelpText(
      "after",
      `\nAlias of \`linear issues close-eligible-epics\`. Use --dry-run to preview
the eligible set before transitioning any epic to 'completed'.`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [
          { team?: string; dryRun?: boolean },
          Command,
        ];
        await runCloseEligibleEpics(command, options);
      }),
    );

  epic
    .command("usage")
    .description("show detailed usage for epic")
    .action(() => {
      console.log(formatDomainUsage(epic, EPIC_META));
    });
}
