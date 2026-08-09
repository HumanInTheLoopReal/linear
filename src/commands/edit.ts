import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Command } from "commander";
import { createContext, getRootOpts } from "../common/context.js";
import { invalidParameterError } from "../common/errors.js";
import { handleCommand, outputResult } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import { resolveIssueId } from "../resolvers/issue-resolver.js";
import {
  type EditableField,
  getEditableFieldValue,
  setEditableFieldValue,
} from "../services/issue-service.js";

/**
 * Result shape `linear edit` emits. `changed=false` is a no-op (the user
 * exited the editor without saving changes); `changed=true` carries the
 * updated issue. The text formatter consumes this shape.
 */
export interface EditResultShape {
  id: string;
  field: EditableField;
  changed: boolean;
  issue?: { identifier?: string | null; title?: string | null } | null;
}

/**
 * Render the result of `linear edit`. Two shapes:
 *
 *   changed=false → `· No change to <field> on <id>`
 *   changed=true  → `✓ Updated <field> on <id> — <title>`
 *
 * The `typedRef` argument is the identifier as the user typed it on the
 * command line (e.g. `TES-466`), used in the no-op path where the result
 * payload doesn't carry an identifier and we want to avoid echoing the
 * raw UUID back.
 */
export function formatEdit(result: EditResultShape, typedRef: string): string {
  const id = result.issue?.identifier ?? typedRef;
  if (!result.changed) {
    return `· No change to ${result.field} on ${id}\n`;
  }
  const title = result.issue?.title ?? "";
  return `✓ Updated ${result.field} on ${id} — ${title}\n`;
}

export const EDIT_META: DomainMeta = {
  name: "edit",
  summary:
    "open one of an issue's fields in `$EDITOR` and save the result back to Linear",
  context: [
    "edit is the agent-blocking counterpart of `linear issues update`:",
    "it spawns the user's `$EDITOR` (or `$VISUAL`) on a temp file",
    "seeded with the current value of the chosen field, and on save",
    "writes the new value back via `issueUpdate`.",
    "",
    "fields:",
    "  --title         the issue title (top-level Linear field)",
    "  --description   the full description (top-level Linear field; default)",
    "  --design        the body of a `## Design` section within the description",
    "  --notes         the body of a `## Notes` section within the description",
    "  --acceptance    the body of a `## Acceptance Criteria` section",
    "",
    "the section-based fields are a Linear-Hack — Linear has no native",
    "design/notes/acceptance columns, so the convention is to keep them",
    "as named markdown sections inside the description body.",
    "",
    "agents that cannot drive an interactive editor should use",
    "`linear issues update --title|--description ...` instead.",
  ].join("\n"),
  arguments: {
    issue: "issue identifier (UUID or ABC-123)",
  },
  seeAlso: ["issues update", "issues note"],
};

const FIELD_FLAGS = [
  "title",
  "description",
  "design",
  "notes",
  "acceptance",
] as const;

type EditOptions = {
  title: boolean;
  description: boolean;
  design: boolean;
  notes: boolean;
  acceptance: boolean;
};

function pickEditor(): string[] | undefined {
  const env = process.env.EDITOR ?? process.env.VISUAL;
  if (env && env.trim().length > 0) return env.trim().split(/\s+/);
  return undefined;
}

export function setupEditCommands(program: Command): void {
  const edit = program
    .command("edit <issue>")
    .description(
      "open an issue field in $EDITOR (agent-blocking; use `issues update` for headless writes)",
    )
    .option("--title", "edit the title", false)
    .option("--description", "edit the description (default)", false)
    .option(
      "--design",
      "edit the '## Design' section of the description",
      false,
    )
    .option("--notes", "edit the '## Notes' section of the description", false)
    .option(
      "--acceptance",
      "edit the '## Acceptance Criteria' section of the description",
      false,
    )
    .addHelpText(
      "after",
      `\nRequires a TTY and \`$EDITOR\` (or \`$VISUAL\`). Saving an unchanged
value emits {"changed": false} and skips the update mutation. The
design/notes/acceptance fields map to named \`## Section\` blocks
within the issue description (Linear-Hack).`,
    )
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [issue, options, command] = args as [
          string,
          EditOptions,
          Command,
        ];

        const selected = FIELD_FLAGS.filter((f) => options[f]);
        if (selected.length > 1) {
          throw invalidParameterError(
            "--<field>",
            "only one field flag may be set",
          );
        }
        const field: EditableField =
          selected.length === 1 ? selected[0] : "description";

        const editor = pickEditor();
        if (!editor) {
          throw invalidParameterError(
            "$EDITOR",
            "no editor found; set $EDITOR or $VISUAL",
          );
        }

        const rootOpts = getRootOpts(command);
        const ctx = createContext(rootOpts);
        const issueId = await resolveIssueId(ctx.sdk, issue);
        const before = await getEditableFieldValue(ctx.gql, issueId, field);

        const tmpPath = path.join(
          os.tmpdir(),
          `linear-edit-${field}-${process.pid}-${Date.now()}.md`,
        );
        fs.writeFileSync(tmpPath, before, "utf8");

        try {
          const [bin, ...argv] = editor;
          const status = spawnSync(bin, [...argv, tmpPath], {
            stdio: "inherit",
          });
          if (status.error || (status.status ?? 0) !== 0) {
            throw new Error(
              `editor exited with non-zero status${
                status.error ? `: ${status.error.message}` : ""
              }`,
            );
          }
          const after = fs.readFileSync(tmpPath, "utf8");
          const normalized =
            field === "title" ? after.trim() : after.replace(/\r\n/g, "\n");

          if (normalized === before) {
            outputResult(
              { id: issueId, field, changed: false },
              (r) => formatEdit(r as EditResultShape, issue),
              rootOpts,
            );
            return;
          }
          const updated = await setEditableFieldValue(
            ctx.gql,
            issueId,
            field,
            normalized,
          );
          outputResult(
            { id: issueId, field, changed: true, issue: updated },
            (r) => formatEdit(r as EditResultShape, issue),
            rootOpts,
          );
        } finally {
          try {
            fs.unlinkSync(tmpPath);
          } catch {
            // leave the temp file behind if cleanup fails — preserves user's edits.
          }
        }
      }),
    );

  edit
    .command("usage")
    .description("show detailed usage for edit")
    .action(() => {
      console.log(formatDomainUsage(edit, EDIT_META));
    });
}
