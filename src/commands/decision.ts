import type { Command } from "commander";
import { resolveBodyInput } from "../common/body-input.js";
import { getDefaultTeam } from "../common/config-store.js";
import { createContext, getRootOpts } from "../common/context.js";
import { invalidParameterError, isNotFoundError } from "../common/errors.js";
import { replaceSection } from "../common/markdown-sections.js";
import { parsePriorityOption } from "../common/number-options.js";
import { handleCommand, outputResult } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import { IssueRelationType } from "../gql/graphql.js";
import { resolveIssueId } from "../resolvers/issue-resolver.js";
import { resolveWorkspaceLabelId } from "../resolvers/label-resolver.js";
import { resolveStateIdByType } from "../resolvers/status-resolver.js";
import { resolveTeamId } from "../resolvers/team-resolver.js";
import { createIssueRelation } from "../services/issue-relation-service.js";
import {
  createIssue,
  getIssue,
  listIssues,
  updateIssue,
} from "../services/issue-service.js";
import { ensureWorkspaceLabel } from "../services/label-service.js";
import { enforceCreateValidation } from "./_create-validation.js";

/**
 * `linear decision ...` — record / list / show / supersede architectural
 * decision records (ADRs) as Linear issues tagged with the `type:decision`
 * label. Linear has no native `decision` issue type, so the shape is a
 * Composite: a regular Linear issue + a `type:decision` label + a description
 * carrying the sections the create gate requires of a decision.
 *
 * Those sections are NOT listed here. `record` composes a body from its flags
 * and hands it to the same gate `issues create` uses, which resolves the
 * contract from the active template and any per-type override. A copy of the
 * section list in this file is precisely what let the command drift into
 * emitting bodies its own lint rejected.
 *
 * The surface is intentionally a thin wrapper over the existing
 * `create + label + relation` services rather than a new Linear primitive.
 */

export const DECISION_LABEL = "type:decision";
const DECISION_LABEL_DESC =
  "Architectural decision record (created by `linear decision`).";

export const DECISION_META: DomainMeta = {
  name: "decision",
  summary:
    "record / list / show / supersede project decisions as Linear issues tagged `type:decision`",
  context: [
    "Decision records (ADRs) are Linear issues stamped with the",
    "`type:decision` label and a sectioned description. The label is",
    "auto-created in the workspace on first use; subsequent decisions",
    "re-use the same label.",
    "",
    "`record` and `supersede` compose the body from flags that map 1:1 to",
    "sections — --context, --decision, --consequences, --alternatives,",
    "--revisit-when, --test — plus optional --affects. Pass the whole body",
    "instead with --body, --body-file <path>, or --stdin; section flags",
    "splice into it. (--rationale is the old spelling of --context.)",
    "",
    "Both run the same create gate `issues create` runs, resolved for the",
    "`decision` type, so `linear template show` is the authority on which",
    "sections are required and a repo override moves this command with it.",
    "A section nobody supplied is left out rather than filled with a",
    "placeholder, so the gate names it. --no-validate skips the check.",
    "",
    "Subcommands:",
    "  record    create a new decision issue.",
    "  list      list every issue carrying `type:decision`.",
    "  show      print full detail for one decision (alias for `linear show`).",
    "  supersede record a new decision, link it `related` to the old one,",
    "            and close the old one with a superseded reason.",
    "",
    "Why a label and not an issue type: Linear's issue-type field is a",
    "workspace setting that varies per team; a label works uniformly and",
    "is portable across teams.",
  ].join("\n"),
  arguments: {},
  seeAlso: ["create", "list", "show", "depends add"],
};

export interface DecisionRecordPayload {
  id: string;
  identifier: string;
  title: string;
  label: string;
}

export interface DecisionSupersedePayload {
  new_decision: DecisionRecordPayload;
  superseded_id: string;
  superseded_identifier: string;
  relation_created: boolean;
  closed: boolean;
}

export interface DecisionListEntry {
  id: string;
  identifier: string;
  title: string;
  state: string;
}

export function formatDecisionRecord(p: DecisionRecordPayload): string {
  return `✓ recorded · ${p.identifier} · ${p.title}\n  (label: ${p.label})\n`;
}

export function formatDecisionSupersede(p: DecisionSupersedePayload): string {
  const lines = [
    `✓ ${p.new_decision.identifier} supersedes ${p.superseded_identifier}`,
    `  new:   ${p.new_decision.identifier} — ${p.new_decision.title}`,
    `  old:   ${p.superseded_identifier} (closed: ${p.closed ? "yes" : "no"}, relation: ${p.relation_created ? "yes" : "no"})`,
  ];
  return `${lines.join("\n")}\n`;
}

export function formatDecisionList(rows: DecisionListEntry[]): string {
  if (rows.length === 0) {
    return "No decisions found (no issues with the `type:decision` label).\n";
  }
  const lines = rows.map(
    (r) => `${r.identifier}  ${r.state.padEnd(12)} ${r.title}`,
  );
  return `${lines.join("\n")}\n`;
}

/**
 * Every section flag `record` and `supersede` accept: the heading it writes, the
 * option key commander parses it into, and its help text.
 *
 * This is the single source for all three. The flags are REGISTERED from this
 * table rather than listed separately, which is what makes it impossible to add
 * a flag that fills no heading — the failure mode where a value is accepted and
 * then silently dropped. `record` and `supersede` compose identical bodies, so a
 * second copy of any part of this is also how the two would drift apart.
 *
 * Order is the order sections appear in a composed body: the `decision` type's
 * contract first, then `## Affects`, which the contract does not require but
 * this command has always offered.
 */
const DECISION_SECTIONS = [
  {
    key: "context",
    heading: "## Context",
    flag: "--context <text>",
    help: "the forces that made this decision necessary",
  },
  {
    key: "decision",
    heading: "## Decision",
    flag: "--decision <text>",
    help: "one sentence, imperative: what was decided",
  },
  {
    key: "consequences",
    heading: "## Consequences",
    flag: "--consequences <text>",
    help: "what gets easier, what gets harder, what this defers",
  },
  {
    key: "alternatives",
    heading: "## Alternatives",
    flag: "--alternatives <text>",
    help: "each option considered and why it was not chosen",
  },
  {
    key: "revisitWhen",
    heading: "## Revisit when",
    flag: "--revisit-when <text>",
    help: "the concrete trigger that reopens this decision",
  },
  {
    key: "test",
    heading: "## Test Plan",
    flag: "--test <text>",
    help: "which stubs or tests build against this decision",
  },
  {
    key: "affects",
    heading: "## Affects",
    flag: "--affects <text>",
    help: "issue IDs or area descriptions impacted",
  },
] as const;

type DecisionSectionKey = (typeof DECISION_SECTIONS)[number]["key"];

export type DecisionBodyOptions = {
  [K in DecisionSectionKey]?: string;
} & {
  /** Deprecated spelling of `--context`; the old flag filled the same ground. */
  rationale?: string;
  body?: string;
  bodyFile?: string;
  stdin?: boolean;
};

/**
 * Compose a decision body, either from the section flags or from a body supplied
 * whole by `--body` / `--body-file` / `--stdin`.
 *
 * A section nobody supplied is OMITTED rather than filled with a placeholder.
 * That is the whole correction: this command used to emit
 * `<one-sentence summary of what was decided>` under `## Decision`, which reads
 * as filled content to every check that looks at it, so the one part of an ADR
 * that cannot be guessed was the one part nothing asked for. An absent heading,
 * by contrast, is exactly what the create gate refuses by name.
 *
 * Returns `undefined` when no source was given at all, so the gate reports the
 * whole contract rather than judging an empty string.
 */
export function buildDecisionDescription(
  input: DecisionBodyOptions,
): string | undefined {
  if (input.context !== undefined && input.rationale !== undefined) {
    throw invalidParameterError(
      "--rationale",
      "cannot be combined with --context — both fill '## Context'",
    );
  }

  const supplied = DECISION_SECTIONS.filter(
    ({ key }) =>
      (key === "context" ? (input.context ?? input.rationale) : input[key]) !==
      undefined,
  );

  const base = resolveBodyInput({
    body: input.body,
    bodyFile: input.bodyFile,
    stdin: input.stdin,
  });

  // A whole body and the section flags are mutually exclusive, because splicing
  // one into the other cannot be done safely with the tools available here.
  // `replaceSection` matches a heading case-sensitively and treats only `## ` as
  // a boundary, while the create gate matches case-insensitively at any depth.
  // So a body carrying `## decision` gets a SECOND `## Decision` appended and
  // the gate accepts both, and replacing a section followed by `###` subsections
  // deletes them. Refusing is the honest answer: use the flags, or write the
  // whole body and edit it yourself.
  if (base !== undefined && supplied.length > 0) {
    throw invalidParameterError(
      supplied[0].flag.split(" ")[0],
      "cannot be combined with --body / --body-file / --stdin — pass the whole body, or build it from section flags",
    );
  }

  if (base !== undefined) return base;
  if (supplied.length === 0) return undefined;

  let body = "";
  for (const { key, heading } of supplied) {
    const value =
      key === "context" ? (input.context ?? input.rationale) : input[key];
    body = replaceSection(body, heading, (value as string).trim());
  }
  return body;
}

/**
 * Add the body-composition flags to `record` and `supersede` alike.
 *
 * None of the section flags is a `requiredOption`, deliberately. What a decision
 * must contain is the create gate's answer, resolved from the active template
 * and any `template.required-sections-by-type` override — so a workspace whose
 * ADRs have a different shape changes its config, and commander does not go on
 * demanding the sections this CLI happens to ship.
 */
function withDecisionBodyOptions(command: Command): Command {
  for (const { flag, help } of DECISION_SECTIONS) {
    command.option(flag, help);
  }
  return command
    .option(
      "--rationale <text>",
      "deprecated spelling of --context; fills the same section",
    )
    .option("--body <text>", "the whole decision body as markdown")
    .option("--body-file <path>", "read the body from a file (use - for stdin)")
    .option("--stdin", "read the body from stdin (alias for --body-file -)")
    .option(
      "--validate",
      "force required-section validation on for this create",
    )
    .option(
      "--no-validate",
      "skip required-section validation for this create",
    );
}

export function setupDecisionCommands(program: Command): void {
  const decision = program
    .command("decision")
    .description(
      "record / list / show / supersede project decisions (ADRs) as Linear issues",
    );

  decision.action(() => decision.help());

  withDecisionBodyOptions(
    decision
      .command("record")
      .description(
        "create a new decision issue (adds the `type:decision` label and the ADR sections the create gate requires)",
      )
      .requiredOption("--title <title>", "one-line summary of the decision")
      .option(
        "--team <team>",
        "team key, name, or UUID; defaults to team.default config",
      )
      .option(
        "--priority <n>",
        "Linear priority (1=urgent, 2=high, 3=medium, 4=low; P1-P4 accepted); default 2",
        parsePriorityOption,
      ),
  ).action(
    handleCommand(async (...args: unknown[]) => {
      const [options, command] = args as [
        DecisionBodyOptions & {
          title: string;
          team?: string;
          priority?: number;
          validate?: boolean;
        },
        Command,
      ];
      const rootOpts = getRootOpts(command);

      // Validate before touching the workspace. `ensureWorkspaceLabel` CREATES
      // the convention label, so gating after it would leave that label behind
      // on a create the gate then refused.
      //
      // The gate is `issues create`'s own, resolved for `decision`, so this
      // command owns no copy of the contract and cannot fall behind it again.
      // The bullets repair reaching --alternatives comes free with it.
      const description = enforceCreateValidation(
        buildDecisionDescription(options),
        options.validate,
        "decision",
      );
      const ctx = createContext(rootOpts);

      const teamKey = options.team ?? getDefaultTeam() ?? undefined;
      if (!teamKey) {
        throw invalidParameterError(
          "--team",
          "no team supplied and no team.default configured",
        );
      }
      const teamId = await resolveTeamId(ctx.sdk, teamKey);
      const labelId = await ensureWorkspaceLabel(
        ctx.gql,
        DECISION_LABEL,
        DECISION_LABEL_DESC,
      );

      const created = await createIssue(ctx.gql, {
        title: options.title,
        description,
        teamId,
        labelIds: [labelId],
        priority: options.priority ?? 2,
      });

      const payload: DecisionRecordPayload = {
        id: created.id,
        identifier: created.identifier,
        title: created.title,
        label: DECISION_LABEL,
      };
      outputResult(payload, formatDecisionRecord, rootOpts);
    }),
  );

  decision
    .command("list")
    .description(
      "list every issue carrying the `type:decision` label (the decision log)",
    )
    .option(
      "--limit <n>",
      "max rows to return (default 50)",
      (v) => Number.parseInt(v, 10),
      50,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [{ limit: number }, Command];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);

        // Read-only label lookup: listing decisions must never create the
        // convention label merely because it does not exist yet.
        let labelId: string | null;
        try {
          labelId = await resolveWorkspaceLabelId(ctx.sdk, DECISION_LABEL);
        } catch (error) {
          if (!isNotFoundError(error)) throw error;
          labelId = null;
        }

        if (!labelId) {
          outputResult([] as DecisionListEntry[], formatDecisionList, rootOpts);
          return;
        }

        const page = await listIssues(
          ctx.gql,
          { limit: options.limit },
          { labels: { some: { id: { in: [labelId] } } } },
          { includeClosed: true },
        );
        const rows: DecisionListEntry[] = page.nodes.map((n) => ({
          id: n.id,
          identifier: n.identifier,
          title: n.title,
          state: n.state?.name ?? "—",
        }));
        outputResult(rows, formatDecisionList, rootOpts);
      }),
    );

  decision
    .command("show <id>")
    .description(
      "print full detail for one decision (thin alias for `linear show`)",
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [id, , command] = args as [string, unknown, Command];
        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const issueId = await resolveIssueId(ctx.sdk, id);
        const issue = await getIssue(ctx.gql, issueId);
        // Plain JSON dump in --json mode; text mode shows the title +
        // description body so the four-section template is visible.
        outputResult(
          issue,
          (i) =>
            `${i.identifier}  ${i.title}\n\n${i.description ?? "(no description)"}\n`,
          rootOpts,
        );
      }),
    );

  withDecisionBodyOptions(
    decision
      .command("supersede <old-decision>")
      .description(
        "record a new decision, link it `related` to the old one, and close the old decision",
      )
      .requiredOption("--title <title>", "title of the new decision")
      .option(
        "--team <team>",
        "team key, name, or UUID; defaults to team.default config",
      )
      .option(
        "--priority <n>",
        "Linear priority for the new decision (1=urgent … 4=low; P1-P4 accepted); default 2",
        parsePriorityOption,
      ),
  ).action(
    handleCommand(async (...args: unknown[]) => {
      const [oldArg, options, command] = args as [
        string,
        DecisionBodyOptions & {
          title: string;
          team?: string;
          priority?: number;
          validate?: boolean;
        },
        Command,
      ];
      const rootOpts = getRootOpts(command);

      // Validate before touching the workspace. `ensureWorkspaceLabel` CREATES
      // the convention label, so gating after it would leave that label behind
      // on a create the gate then refused.
      //
      // The gate is `issues create`'s own, resolved for `decision`, so this
      // command owns no copy of the contract and cannot fall behind it again.
      // The bullets repair reaching --alternatives comes free with it.
      const description = enforceCreateValidation(
        buildDecisionDescription(options),
        options.validate,
        "decision",
      );
      const ctx = createContext(rootOpts);

      const oldIssueId = await resolveIssueId(ctx.sdk, oldArg);
      const oldIssue = await getIssue(ctx.gql, oldIssueId);
      const oldIdentifier = oldIssue.identifier;

      const teamKey =
        options.team ?? oldIssue.team?.key ?? getDefaultTeam() ?? undefined;
      if (!teamKey) {
        throw invalidParameterError(
          "--team",
          "no team supplied, no team on superseded issue, and no team.default configured",
        );
      }
      const teamId = await resolveTeamId(ctx.sdk, teamKey);
      const labelId = await ensureWorkspaceLabel(
        ctx.gql,
        DECISION_LABEL,
        DECISION_LABEL_DESC,
      );

      const created = await createIssue(ctx.gql, {
        title: options.title,
        description,
        teamId,
        labelIds: [labelId],
        priority: options.priority ?? 2,
      });

      // Wire new → old as `related` and close the old one. Each side is
      // attempted independently so a partial failure still reports
      // exactly what landed.
      let relationCreated = false;
      try {
        await createIssueRelation(ctx.gql, {
          issueId: created.id,
          relatedIssueId: oldIssueId,
          type: IssueRelationType.Related,
        });
        relationCreated = true;
      } catch {
        relationCreated = false;
      }

      let closed = false;
      try {
        const completedStateId = await resolveStateIdByType(
          ctx.sdk,
          teamId,
          "completed",
        );
        await updateIssue(ctx.gql, oldIssueId, { stateId: completedStateId });
        closed = true;
      } catch {
        closed = false;
      }

      const payload: DecisionSupersedePayload = {
        new_decision: {
          id: created.id,
          identifier: created.identifier,
          title: created.title,
          label: DECISION_LABEL,
        },
        superseded_id: oldIssueId,
        superseded_identifier: oldIdentifier,
        relation_created: relationCreated,
        closed,
      };
      outputResult(payload, formatDecisionSupersede, rootOpts);
    }),
  );

  decision
    .command("usage")
    .description("show detailed usage for decision")
    .action(() => {
      console.log(formatDomainUsage(decision, DECISION_META));
    });
}
