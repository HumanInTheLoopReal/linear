import fs from "node:fs";
import { invalidParameterError } from "./errors.js";

export interface BodyInputOptions {
  description?: string;
  body?: string;
  content?: string;
  bodyFile?: string;
  stdin?: boolean;
}

/**
 * Resolves the long-form text body for a command that accepts a single
 * long-text field via one of: `--description` / `--body` / `--content`
 * (inline), `--body-file <path>` (file, or `-` for stdin), or `--stdin`
 * (alias for `--body-file -`).
 *
 * Returns the resolved string, or `undefined` if no source was provided.
 * Throws `invalidParameterError` when more than one source is specified.
 *
 * The `--body-file` / `--stdin` pair lets agents and scripts pipe markdown
 * in without shell-escaping.
 */
export function resolveBodyInput(opts: BodyInputOptions): string | undefined {
  const inlineFlag =
    opts.description !== undefined
      ? "--description"
      : opts.body !== undefined
        ? "--body"
        : opts.content !== undefined
          ? "--content"
          : null;
  const inlineValue =
    opts.description ?? opts.body ?? opts.content ?? undefined;

  const sources: string[] = [];
  if (inlineFlag !== null) sources.push(inlineFlag);
  if (opts.bodyFile !== undefined) sources.push("--body-file");
  if (opts.stdin) sources.push("--stdin");

  if (sources.length > 1) {
    throw invalidParameterError(
      sources[0],
      `cannot be combined with ${sources.slice(1).join(", ")} — pick one body source`,
    );
  }

  if (inlineValue !== undefined) return inlineValue;
  if (opts.stdin || opts.bodyFile === "-") {
    return fs.readFileSync(0, "utf8");
  }
  if (opts.bodyFile !== undefined) {
    return fs.readFileSync(opts.bodyFile, "utf8");
  }
  return undefined;
}

export interface DualBodyInputOptions {
  description?: string;
  content?: string;
  descriptionFile?: string;
  contentFile?: string;
}

export interface DualBodyResolved {
  description?: string;
  content?: string;
}

/**
 * Resolves both a description AND a separate content field independently,
 * each from its own inline flag (`--description` / `--content`) or a
 * field-specific file flag (`--description-file` / `--content-file`,
 * with `-` for stdin).
 *
 * Used by commands like `projects create` and `initiatives create` that
 * take both fields. A unified `--body-file` is intentionally NOT exposed
 * for these commands because it would be ambiguous which field to fill.
 */
export function resolveDualBodyInput(
  opts: DualBodyInputOptions,
): DualBodyResolved {
  if (opts.description !== undefined && opts.descriptionFile !== undefined) {
    throw invalidParameterError(
      "--description",
      "cannot be combined with --description-file — pick one description source",
    );
  }
  if (opts.content !== undefined && opts.contentFile !== undefined) {
    throw invalidParameterError(
      "--content",
      "cannot be combined with --content-file — pick one content source",
    );
  }

  const result: DualBodyResolved = {};
  if (opts.description !== undefined) {
    result.description = opts.description;
  } else if (opts.descriptionFile === "-") {
    result.description = fs.readFileSync(0, "utf8");
  } else if (opts.descriptionFile !== undefined) {
    result.description = fs.readFileSync(opts.descriptionFile, "utf8");
  }

  if (opts.content !== undefined) {
    result.content = opts.content;
  } else if (opts.contentFile === "-") {
    result.content = fs.readFileSync(0, "utf8");
  } else if (opts.contentFile !== undefined) {
    result.content = fs.readFileSync(opts.contentFile, "utf8");
  }

  return result;
}

export interface ReasonInputOptions {
  reason?: string;
  reasonFile?: string;
  reasonStdin?: boolean;
}

/**
 * Resolves the body text for a single-line `--reason` field (close, reopen,
 * done, set-state). The `--reason-file` / `--reason` pair lets a longer
 * post-mortem comment be piped in without shell-quoting.
 *
 * Sources are mutually exclusive. Trailing newlines are preserved verbatim
 * because the value is sent straight to `commentCreate`; markdown renders
 * the same whether the body ends with `\n` or not.
 */
export function resolveReasonInput(
  opts: ReasonInputOptions,
): string | undefined {
  const sources: string[] = [];
  if (opts.reason !== undefined) sources.push("--reason");
  if (opts.reasonFile !== undefined) sources.push("--reason-file");
  if (opts.reasonStdin) sources.push("--reason-stdin");

  if (sources.length > 1) {
    throw invalidParameterError(
      sources[0],
      `cannot be combined with ${sources.slice(1).join(", ")} — pick one reason source`,
    );
  }

  if (opts.reason !== undefined) return opts.reason;
  if (opts.reasonStdin || opts.reasonFile === "-") {
    return fs.readFileSync(0, "utf8");
  }
  if (opts.reasonFile !== undefined) {
    return fs.readFileSync(opts.reasonFile, "utf8");
  }
  return undefined;
}

export interface DesignInputOptions {
  design?: string;
  designFile?: string;
  designStdin?: boolean;
}

/**
 * Resolves the body text for the architectural-rationale `--design` field.
 * Linear has no dedicated `design` column, so the caller is expected to
 * splice the returned text into the issue description as a `## Design`
 * markdown section via `replaceSection`. This helper only collects +
 * validates the input; the section-splice happens at the call site so we
 * don't drag a GraphQL dependency into common/.
 */
export function resolveDesignInput(
  opts: DesignInputOptions,
): string | undefined {
  const sources: string[] = [];
  if (opts.design !== undefined) sources.push("--design");
  if (opts.designFile !== undefined) sources.push("--design-file");
  if (opts.designStdin) sources.push("--design-stdin");

  if (sources.length > 1) {
    throw invalidParameterError(
      sources[0],
      `cannot be combined with ${sources.slice(1).join(", ")} — pick one design source`,
    );
  }

  if (opts.design !== undefined) return opts.design;
  if (opts.designStdin || opts.designFile === "-") {
    return fs.readFileSync(0, "utf8");
  }
  if (opts.designFile !== undefined) {
    return fs.readFileSync(opts.designFile, "utf8");
  }
  return undefined;
}
