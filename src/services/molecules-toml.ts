/**
 * TOML parsing + validation for molecule proto files.
 *
 * Wraps {@link smol-toml}'s `parse` with a strict schema mapping so the
 * rest of the codebase can rely on a single typed shape regardless of
 * what the on-disk TOML looks like. Errors thrown here include the file
 * path so the user can find the bad proto.
 *
 * Schema (file-local v1):
 *   name        — required string, becomes the proto's identifier
 *   description — optional one-liner
 *   [[variables]] — array of {name, description?, default?}
 *   [[issues]]    — array of {key, title, type?, priority?, description?, depends_on?}
 *
 * Anything outside this schema is silently dropped on parse — we don't
 * want unknown-key strictness to break older TOMLs as the schema grows.
 */

import { parse as parseToml } from "smol-toml";

export interface MoleculeVariable {
  name: string;
  description?: string;
  default?: string;
}

export interface MoleculeIssueSpec {
  key: string;
  title: string;
  type?: string;
  priority?: number;
  description?: string;
  depends_on?: string[];
}

export interface MoleculeProto {
  /** Unique name across all search paths (used as the `getProto` key). */
  name: string;
  description?: string;
  variables: MoleculeVariable[];
  issues: MoleculeIssueSpec[];
  /** Absolute path the proto was loaded from — for error reporting. */
  source: string;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === "string") out.push(item);
  }
  return out;
}

/**
 * Parse a TOML string into a MoleculeProto. Throws when required fields
 * are missing or malformed — the caller is expected to surface the
 * source path so the user can fix the file.
 */
export function parseMoleculeToml(
  content: string,
  source: string,
): MoleculeProto {
  let raw: Record<string, unknown>;
  try {
    raw = parseToml(content) as Record<string, unknown>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`invalid TOML in ${source}: ${msg}`);
  }

  const name = asString(raw.name);
  if (!name) {
    throw new Error(`molecule TOML at ${source} is missing required \`name\``);
  }

  const variables: MoleculeVariable[] = [];
  if (Array.isArray(raw.variables)) {
    for (const v of raw.variables) {
      if (typeof v !== "object" || v === null) continue;
      const obj = v as Record<string, unknown>;
      const varName = asString(obj.name);
      if (!varName) continue;
      variables.push({
        name: varName,
        description: asString(obj.description),
        default: asString(obj.default),
      });
    }
  }

  const issues: MoleculeIssueSpec[] = [];
  if (Array.isArray(raw.issues)) {
    for (const item of raw.issues) {
      if (typeof item !== "object" || item === null) continue;
      const obj = item as Record<string, unknown>;
      const key = asString(obj.key);
      const title = asString(obj.title);
      if (!key || !title) {
        throw new Error(
          `molecule TOML at ${source} has an [[issues]] entry missing \`key\` or \`title\``,
        );
      }
      issues.push({
        key,
        title,
        type: asString(obj.type),
        priority: asNumber(obj.priority),
        description: asString(obj.description),
        depends_on: asStringArray(obj.depends_on),
      });
    }
  }

  return {
    name,
    description: asString(raw.description),
    variables,
    issues,
    source,
  };
}
