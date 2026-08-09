import fs from "node:fs";
import type { Command } from "commander";
import {
  type ConfigLayer,
  findLocalConfigPath,
  getConfigPath,
  LocalConfigUnavailableError,
  setConfig,
  unsetConfig,
} from "../common/config-store.js";
import { getRootOpts } from "../common/context.js";
import { invalidParameterError } from "../common/errors.js";
import { handleCommand, outputResult } from "../common/output.js";
import {
  type RequiredSection,
  renderSkeleton,
} from "../common/required-sections.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import {
  REQUIRED_SECTIONS_BY_TYPE,
  resolveTypeRequirements,
} from "../services/lint-service.js";
import {
  DEFAULT_CREATE_TEMPLATE,
  requiredSectionsFromTemplate,
  resolveCreateTemplate,
  resolveTypeSections,
  setTypeSpec,
  TEMPLATE_CREATE_KEY,
  unsetTypeSpec,
} from "../services/template-service.js";
import { CORE_TYPES } from "../services/types-service.js";

export const TEMPLATE_META: DomainMeta = {
  name: "template",
  summary: "set the markdown template the create-time quality gate enforces",
  context: [
    "Defines the required-section structure every newly-created issue must",
    "contain. The template is plain markdown; its `#` headings ARE the",
    "required sections the create gate checks (`validation.on-create`,",
    "default `error`). Stored under the `template.create` config key:",
    "per-user `~/.linear/config.json` by default, or per-repo with `--local`",
    "(local overrides global; both fall back to a built-in default).",
    "",
    "The gate runs on EVERY create path — `issues create`, `batch`, and epic",
    "children — so agents cannot create unstructured issues. The default",
    "template requires `## Context`, `## Acceptance Criteria`, and",
    "`## Test Plan`.",
    "",
    "The gate checks SHAPE as well as presence. A criteria section written as",
    "bare lines is rewritten into `- [ ]` checkboxes and the change is reported",
    "on stderr; a required section that is missing, or present with nothing",
    "under it, is refused. Formatting has one right answer, so the CLI applies",
    "it; missing content does not, so the CLI asks for it.",
    "",
    "The template owns the UNIVERSAL sections plus one type-specific slot. What",
    "fills that slot depends on the issue's type (`## Success Criteria` for an",
    "epic, the ADR block for a decision), which is why `show` prints the",
    "effective sections per type. Set one type's block from the CLI:",
    "",
    "  linear template set --type decision --file adr-sections.md --local",
    "  linear template set --type chore --from-default",
    "  linear template unset --type decision --local",
    "",
    "Those write the `template.required-sections-by-type` config key, which can",
    "also be edited directly — a JSON object keyed by type, each value an array",
    "of sections or `{ sections, exempt }`. A section is a heading string or",
    "`{ heading, hint, style }`, where style is `prose`, `bullets`, or",
    "`checklist`; `exempt` lists universal headings the type does not need. An",
    "entry replaces that type's built-in block outright. `issues create` and",
    "`issues lint` resolve through the same code, so an override moves both at",
    "once.",
    "",
    "Subcommands:",
    "  • show              print the active template + its source",
    "  • set               write a template (--file / --stdin / --from-default)",
    "  • unset             remove a template (revert to the lower layer/default)",
    "  • path              print the config file backing a layer",
    "",
    "A template must contain at least one heading; a heading-free template",
    "would disable the gate and is rejected.",
  ].join("\n"),
  arguments: {},
  seeAlso: ["issues", "config", "batch", "epic"],
};

/**
 * Resolve the write/read target layer for the `template` verbs. Unlike
 * `config` (which defaults to the per-repo layer), a template is usually a
 * per-user / per-org default, so the default here is **global**; `--local`
 * opts into a per-repo override (and requires a git repo).
 */
function resolveTemplateLayer(flags: {
  local?: boolean;
  global?: boolean;
}): ConfigLayer {
  if (flags.local && flags.global) {
    throw invalidParameterError("--local / --global", "are mutually exclusive");
  }
  if (flags.local) {
    if (!findLocalConfigPath()) {
      throw new LocalConfigUnavailableError();
    }
    return "local";
  }
  return "global";
}

/**
 * The issue type a template command targets, or `undefined` for the universal
 * template.
 *
 * Absent and blank must not collapse into the same answer. `--type "  "` is a
 * caller trying to name a type and failing, and treating it as "no type given"
 * would quietly redirect the write onto the universal template — overwriting
 * every type's framing instead of one type's block.
 */
function resolveTypeOption(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const type = raw.trim().toLowerCase();
  if (type === "") {
    throw invalidParameterError(
      "--type",
      "cannot be blank; name an issue type",
    );
  }
  return type;
}

export interface TemplateTypeRequirement {
  type: string;
  sections: string[];
  /** True when this type's spec came from config, not the CLI's built-in map. */
  overridden: boolean;
}

export interface TemplateShowResult {
  source: "local" | "global" | "default";
  template: string;
  sections: string[];
  /** Where the per-type overrides came from ("default" = none configured). */
  types_source: "local" | "global" | "default";
  /** The effective contract per issue type, universal sections included. */
  types: TemplateTypeRequirement[];
}

export function formatTemplateShow(result: TemplateShowResult): string {
  const lines = [
    `Issue template (source: ${result.source})`,
    "",
    result.template.replace(/\n+$/, ""),
    "",
    `Required sections (untyped): ${result.sections.join(", ")}`,
    "",
    `Effective sections per type (overrides: ${result.types_source}):`,
  ];
  const width = Math.max(...result.types.map((t) => t.type.length));
  for (const t of result.types) {
    const mark = t.overridden ? "*" : " ";
    lines.push(
      `  ${t.type.padEnd(width)} ${mark} ${t.sections.join(", ") || "(none)"}`,
    );
  }
  if (result.types.some((t) => t.overridden)) {
    lines.push("");
    lines.push("  * overridden by template.required-sections-by-type config");
  }
  return `${lines.join("\n")}\n`;
}

/**
 * The CLI's own type-specific block for one type, for `set --type --from-default`.
 * An unknown type has no built-in block, which is a stop rather than an empty
 * seed: seeding nothing would write an override that says "this type requires
 * no sections", which is a real contract and never what a typo meant.
 */
function builtInSectionsForType(type: string): RequiredSection[] {
  const spec = REQUIRED_SECTIONS_BY_TYPE[type];
  if (!spec) {
    throw invalidParameterError(
      "--type",
      `no built-in block for '${type}' to seed from (known: ${Object.keys(REQUIRED_SECTIONS_BY_TYPE).sort().join(", ")}); use --file or --stdin to author one`,
    );
  }
  return spec.sections;
}

export interface TemplateSetResult {
  layer: ConfigLayer;
  path: string;
  sections: string[];
  /** Present when the write targeted one issue type's block. */
  type?: string;
}

export function formatTemplateSet(result: TemplateSetResult): string {
  const what = result.type ? `'${result.type}' sections` : "issue template";
  return [
    `✓ Saved ${what} to ${result.layer} config (${result.path})`,
    `  Required sections: ${result.sections.join(", ")}`,
    "",
  ].join("\n");
}

export interface TemplateUnsetResult {
  layer: ConfigLayer;
  removed: boolean;
  /** Present when the removal targeted one issue type's block. */
  type?: string;
}

export function formatTemplateUnset(result: TemplateUnsetResult): string {
  const what = result.type ? `'${result.type}' sections` : "issue template";
  return result.removed
    ? `✓ Removed ${what} from ${result.layer} config (reverted to built-in default)\n`
    : `No ${what} set in ${result.layer} config (already using a lower layer / the built-in default)\n`;
}

export function formatTemplatePath(result: {
  layer: ConfigLayer;
  path: string;
}): string {
  return `${result.path}\n`;
}

export function setupTemplateCommands(program: Command): void {
  const template = program
    .command("template")
    .description("manage the issue template enforced by the create gate");
  template.action(() => template.help());

  template
    .command("show")
    .description("print the active issue template and where it came from")
    .action(
      handleCommand(async (...cmdArgs: unknown[]) => {
        const [, command] = cmdArgs as [unknown, Command];
        const resolved = resolveCreateTemplate();
        const result: TemplateShowResult = {
          source: resolved.source,
          template: resolved.template,
          sections: resolved.sections.map((s) => s.heading),
          types_source: resolveTypeSections().source,
          types: resolveTypeRequirements(CORE_TYPES.map((t) => t.name)),
        };
        outputResult(result, formatTemplateShow, getRootOpts(command));
      }),
    );

  template
    .command("set")
    .description("set the issue template (one source required)")
    .option("--file <path>", "read the template markdown from a file")
    .option("--stdin", "read the template markdown from stdin")
    .option("--from-default", "seed from the built-in default template")
    .option(
      "--type <type>",
      "set the type-specific block for one issue type instead of the universal template",
    )
    .option(
      "--local",
      "write to per-repo `<repo>/.linear/config.json` (default: global)",
    )
    .option("--global", "write to per-user `~/.linear/config.json` (default)")
    .action(
      handleCommand(async (...cmdArgs: unknown[]) => {
        const [options, command] = cmdArgs as [
          {
            file?: string;
            stdin?: boolean;
            fromDefault?: boolean;
            type?: string;
            local?: boolean;
            global?: boolean;
          },
          Command,
        ];

        const sources: string[] = [];
        if (options.file !== undefined) sources.push("--file");
        if (options.stdin) sources.push("--stdin");
        if (options.fromDefault) sources.push("--from-default");
        if (sources.length === 0) {
          throw invalidParameterError(
            "template source",
            "one of --file <path>, --stdin, or --from-default is required",
          );
        }
        if (sources.length > 1) {
          throw invalidParameterError(
            sources[0],
            `cannot be combined with ${sources.slice(1).join(", ")} — pick one source`,
          );
        }

        const layer = resolveTemplateLayer(options);
        const type = resolveTypeOption(options.type);

        // A per-type block and the universal template are both authored as
        // markdown headings, so one reader serves both; only the config key
        // they land under differs.
        let body: string;
        if (options.fromDefault) {
          body = type
            ? renderSkeleton(builtInSectionsForType(type))
            : DEFAULT_CREATE_TEMPLATE;
        } else if (options.stdin) {
          body = fs.readFileSync(0, "utf8");
        } else {
          body = fs.readFileSync(options.file as string, "utf8");
        }

        const sections = requiredSectionsFromTemplate(body);
        if (sections.length === 0) {
          throw invalidParameterError(
            "template",
            type
              ? `must contain at least one markdown heading; to give '${type}' no type-specific section, use \`template unset --type ${type}\``
              : "must contain at least one markdown heading (e.g. '## Context'); an empty template would disable the create gate",
          );
        }

        if (type) {
          setTypeSpec(type, { sections }, layer);
        } else {
          setConfig(TEMPLATE_CREATE_KEY, body, { layer });
        }
        const result: TemplateSetResult = {
          layer,
          path: getConfigPath(layer),
          sections: sections.map((s) => s.heading),
          ...(type ? { type } : {}),
        };
        outputResult(result, formatTemplateSet, getRootOpts(command));
      }),
    );

  template
    .command("unset")
    .description("remove the issue template (revert to lower layer / default)")
    .option(
      "--type <type>",
      "remove one issue type's override instead of the universal template",
    )
    .option("--local", "remove from per-repo layer")
    .option("--global", "remove from per-user layer (default)")
    .action(
      handleCommand(async (...cmdArgs: unknown[]) => {
        const [options, command] = cmdArgs as [
          { type?: string; local?: boolean; global?: boolean },
          Command,
        ];
        const layer = resolveTemplateLayer(options);
        const type = resolveTypeOption(options.type);
        const removed = type
          ? unsetTypeSpec(type, layer)
          : unsetConfig(TEMPLATE_CREATE_KEY, { layer });
        outputResult(
          { layer, removed, ...(type ? { type } : {}) },
          formatTemplateUnset,
          getRootOpts(command),
        );
      }),
    );

  template
    .command("path")
    .description("print the config file backing the template for a layer")
    .option("--local", "the per-repo config file")
    .option("--global", "the per-user config file (default)")
    .action(
      handleCommand(async (...cmdArgs: unknown[]) => {
        const [options, command] = cmdArgs as [
          { local?: boolean; global?: boolean },
          Command,
        ];
        const layer = resolveTemplateLayer(options);
        outputResult(
          { layer, path: getConfigPath(layer) },
          formatTemplatePath,
          getRootOpts(command),
        );
      }),
    );

  template
    .command("usage")
    .description("show detailed usage for template")
    .action(() => {
      console.log(formatDomainUsage(template, TEMPLATE_META));
    });
}
