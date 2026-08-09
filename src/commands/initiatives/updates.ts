import type { Command } from "commander";
import { resolveBodyInput } from "../../common/body-input.js";
import { createContext, getRootOpts } from "../../common/context.js";
import { invalidParameterError } from "../../common/errors.js";
import {
  handleCommand,
  outputResult,
  parseLimit,
} from "../../common/output.js";
import {
  type InitiativeUpdateCreateInput,
  InitiativeUpdateHealthType,
  type InitiativeUpdateUpdateInput,
} from "../../gql/graphql.js";
import { resolveInitiativeId } from "../../resolvers/initiative-resolver.js";
import {
  archiveInitiativeUpdate,
  createInitiativeUpdate,
  getInitiativeUpdate,
  listInitiativeUpdates,
  unarchiveInitiativeUpdate,
  updateInitiativeUpdate,
} from "../../services/initiative-update-service.js";

interface InitiativeUpdatesListOptions {
  initiative: string;
  limit: string;
  after?: string;
  includeArchived?: boolean;
}

interface InitiativeUpdatesCreateOptions {
  initiative: string;
  body?: string;
  bodyFile?: string;
  stdin?: boolean;
  health?: string;
}

interface InitiativeUpdatesUpdateOptions {
  body?: string;
  bodyFile?: string;
  stdin?: boolean;
  health?: string;
}

function parseHealth(value?: string): InitiativeUpdateHealthType | undefined {
  if (!value) return undefined;

  const normalized = value.trim().toLowerCase();
  if (normalized === "ontrack") return InitiativeUpdateHealthType.OnTrack;
  if (normalized === "atrisk") return InitiativeUpdateHealthType.AtRisk;
  if (normalized === "offtrack") return InitiativeUpdateHealthType.OffTrack;

  throw invalidParameterError(
    "--health",
    'must be one of: "onTrack", "atRisk", "offTrack"',
  );
}

function updateFormatYmd(value: string | null | undefined): string {
  if (!value) return "";
  return value.slice(0, 10);
}

function indentBody(body: string | null | undefined, prefix = "  "): string {
  if (!body) return "";
  return body
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

interface InitiativeUpdateRowShape {
  id: string;
  body?: string | null;
  health?: string | null;
  createdAt?: string | null;
  user?: { name?: string | null } | null;
}

export function formatInitiativeUpdateList(result: {
  nodes: InitiativeUpdateRowShape[];
}): string {
  if (result.nodes.length === 0) return "No initiative updates found.\n";
  const lines: string[] = [];
  for (const u of result.nodes) {
    const author = u.user?.name ?? "(unknown)";
    const ts = updateFormatYmd(u.createdAt) || "(unknown)";
    const health = u.health ?? "(none)";
    lines.push(`◆ ${author} · ${ts}  [health: ${health}]`);
    const body = indentBody(u.body);
    if (body) lines.push(body);
    lines.push(`  id: ${u.id}`);
    lines.push("");
  }
  lines.push(`Total: ${result.nodes.length} updates`);
  return `${lines.join("\n")}\n`;
}

export function formatInitiativeUpdateDetail(
  update: InitiativeUpdateRowShape,
): string {
  const author = update.user?.name ?? "(unknown)";
  const ts = updateFormatYmd(update.createdAt) || "(unknown)";
  const health = update.health ?? "(none)";
  const lines: string[] = [
    `◆ Initiative update by ${author} · ${ts}`,
    `Health: ${health}`,
    `id: ${update.id}`,
  ];
  const body = indentBody(update.body);
  if (body) {
    lines.push("");
    lines.push(body);
  }
  return `${lines.join("\n")}\n`;
}

interface InitiativeUpdateMutationShape {
  id: string;
}

function updateMutationLine(
  verb: "Created" | "Updated" | "Archived" | "Unarchived",
  result: InitiativeUpdateMutationShape,
): string {
  return `${verb} initiative update (id: ${result.id})\n`;
}

export function formatInitiativeUpdateCreated(
  result: InitiativeUpdateMutationShape,
): string {
  return updateMutationLine("Created", result);
}

export function formatInitiativeUpdateUpdated(
  result: InitiativeUpdateMutationShape,
): string {
  return updateMutationLine("Updated", result);
}

export function formatInitiativeUpdateArchived(
  result: InitiativeUpdateMutationShape,
): string {
  return updateMutationLine("Archived", result);
}

export function formatInitiativeUpdateUnarchived(
  result: InitiativeUpdateMutationShape,
): string {
  return updateMutationLine("Unarchived", result);
}

export function setupInitiativeUpdateCommands(initiatives: Command): void {
  const updates = initiatives
    .command("updates")
    .description("initiative update operations");

  updates.action(() => updates.help());

  updates
    .command("list")
    .description("list initiative updates")
    .requiredOption("--initiative <initiative>", "initiative name or UUID")
    .option("-l, --limit <n>", "max results", "50")
    .option("--after <cursor>", "cursor for next page")
    .option("--include-archived", "include archived updates")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [
          InitiativeUpdatesListOptions,
          Command,
        ];
        const ctx = createContext(getRootOpts(command));

        const initiativeId = await resolveInitiativeId(
          ctx.sdk,
          options.initiative,
        );

        const result = await listInitiativeUpdates(ctx.gql, {
          initiativeId,
          limit: parseLimit(options.limit),
          after: options.after,
          includeArchived: options.includeArchived ?? false,
        });

        outputResult(result, formatInitiativeUpdateList, getRootOpts(command));
      }),
    );

  updates
    .command("read <update>")
    .description("get initiative update details")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [updateId, , command] = args as [string, unknown, Command];
        const ctx = createContext(getRootOpts(command));
        const result = await getInitiativeUpdate(ctx.gql, updateId);
        outputResult(
          result,
          formatInitiativeUpdateDetail,
          getRootOpts(command),
        );
      }),
    );

  updates
    .command("create")
    .description("create an initiative update")
    .addHelpText(
      "after",
      "\nBody input: pass --body <text>, --body-file <path> (use - for stdin), or --stdin. These are mutually exclusive.",
    )
    .requiredOption("--initiative <initiative>", "initiative name or UUID")
    .option("--body <text>", "update body (markdown)")
    .option("--body-file <path>", "read body from file (use - for stdin)")
    .option("--stdin", "read body from stdin (alias for --body-file -)")
    .option("--health <health>", "onTrack, atRisk, offTrack")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [options, command] = args as [
          InitiativeUpdatesCreateOptions,
          Command,
        ];
        const ctx = createContext(getRootOpts(command));

        const initiativeId = await resolveInitiativeId(
          ctx.sdk,
          options.initiative,
        );

        const input: InitiativeUpdateCreateInput = { initiativeId };

        const resolvedBody = resolveBodyInput(options);
        if (resolvedBody !== undefined) {
          input.body = resolvedBody;
        }

        const health = parseHealth(options.health);
        if (health) {
          input.health = health;
        }

        const result = await createInitiativeUpdate(ctx.gql, input);
        outputResult(
          result,
          formatInitiativeUpdateCreated,
          getRootOpts(command),
        );
      }),
    );

  updates
    .command("update <update>")
    .description("update an initiative update")
    .addHelpText(
      "after",
      "\nBody input: pass --body <text>, --body-file <path> (use - for stdin), or --stdin. These are mutually exclusive.",
    )
    .option("--body <text>", "new body (markdown)")
    .option("--body-file <path>", "read new body from file (use - for stdin)")
    .option("--stdin", "read new body from stdin (alias for --body-file -)")
    .option("--health <health>", "onTrack, atRisk, offTrack")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [updateId, options, command] = args as [
          string,
          InitiativeUpdatesUpdateOptions,
          Command,
        ];
        const ctx = createContext(getRootOpts(command));

        const input: InitiativeUpdateUpdateInput = {};

        const resolvedBody = resolveBodyInput(options);
        if (resolvedBody !== undefined) {
          input.body = resolvedBody;
        }

        const health = parseHealth(options.health);
        if (health) {
          input.health = health;
        }

        if (Object.keys(input).length === 0) {
          throw invalidParameterError(
            "update options",
            "at least one option must be provided",
          );
        }

        const result = await updateInitiativeUpdate(ctx.gql, updateId, input);
        outputResult(
          result,
          formatInitiativeUpdateUpdated,
          getRootOpts(command),
        );
      }),
    );

  updates
    .command("archive <update>")
    .description("archive an initiative update")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [updateId, , command] = args as [string, unknown, Command];
        const ctx = createContext(getRootOpts(command));
        const result = await archiveInitiativeUpdate(ctx.gql, updateId);
        outputResult(
          result,
          formatInitiativeUpdateArchived,
          getRootOpts(command),
        );
      }),
    );

  updates
    .command("unarchive <update>")
    .description("unarchive an initiative update")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [updateId, , command] = args as [string, unknown, Command];
        const ctx = createContext(getRootOpts(command));
        const result = await unarchiveInitiativeUpdate(ctx.gql, updateId);
        outputResult(
          result,
          formatInitiativeUpdateUnarchived,
          getRootOpts(command),
        );
      }),
    );
}
