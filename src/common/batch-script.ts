import { parsePriorityOption } from "./number-options.js";

export type BatchOpName =
  | "close"
  | "update"
  | "create"
  | "dep.add"
  | "dep.remove";

export interface BatchOp {
  line: number;
  raw: string;
  cmd: BatchOpName;
  args: string[];
}

export interface NormalizedBatchUpdate {
  status?: string;
  priority?: number;
  title?: string;
  assignee?: string;
}

export interface ResolvedBatchUpdateInput {
  stateId?: string;
  priority?: number;
  title?: string;
  assigneeId?: string;
}

export type BatchRelationType = "blocks" | "related" | "duplicate" | "similar";

interface NormalizedBatchBase {
  line: number;
  raw: string;
}

export type NormalizedBatchOp =
  | (NormalizedBatchBase & {
      cmd: "close";
      target: string;
      reason?: string;
    })
  | (NormalizedBatchBase & {
      cmd: "update";
      target: string;
      update: NormalizedBatchUpdate;
    })
  | (NormalizedBatchBase & {
      cmd: "create";
      issueType: string;
      title: string;
      priority: number;
    })
  | (NormalizedBatchBase & {
      cmd: "dep.add";
      from: string;
      to: string;
      type: BatchRelationType;
    })
  | (NormalizedBatchBase & {
      cmd: "dep.remove";
      from: string;
      to: string;
    });

interface ResolvedBatchBase {
  line: number;
  raw: string;
  target: string;
}

export type ResolvedBatchOp =
  | (ResolvedBatchBase & {
      cmd: "close";
      issueId: string;
      stateId: string;
      reason?: string;
    })
  | (ResolvedBatchBase & {
      cmd: "update";
      issueId: string;
      input: ResolvedBatchUpdateInput;
    })
  | (ResolvedBatchBase & {
      cmd: "create";
      teamId: string;
      issueType: string;
      title: string;
      priority: number;
      labelIds?: string[];
    })
  | (ResolvedBatchBase & {
      cmd: "dep.add";
      fromId: string;
      toId: string;
      type: BatchRelationType;
    })
  | (ResolvedBatchBase & {
      cmd: "dep.remove";
      fromId: string;
      toId: string;
    });

/**
 * Tokenize a single batch line into whitespace-separated tokens, honoring
 * double-quoted runs and `\"` / `\\` escapes inside them.
 */
export function tokenizeBatchLine(value: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote = false;
  let hasToken = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (inQuote) {
      if (character === "\\" && index + 1 < value.length) {
        const next = value[index + 1];
        if (next === '"' || next === "\\") {
          current += next;
          index += 1;
          continue;
        }
        current += character;
        continue;
      }
      if (character === '"') {
        inQuote = false;
        continue;
      }
      current += character;
      continue;
    }
    if (character === '"') {
      inQuote = true;
      hasToken = true;
      continue;
    }
    if (character === " " || character === "\t") {
      if (hasToken) {
        tokens.push(current);
        current = "";
        hasToken = false;
      }
      continue;
    }
    hasToken = true;
    current += character;
  }
  if (inQuote) {
    throw new Error("unterminated quoted string");
  }
  if (hasToken) tokens.push(current);
  return tokens;
}

/** Parse a complete batch script into typed, source-located operations. */
export function parseBatchScript(input: string): BatchOp[] {
  const operations: BatchOp[] = [];
  const lines = input.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = index + 1;
    const raw = lines[index] ?? "";
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    let tokens: string[];
    try {
      tokens = tokenizeBatchLine(trimmed);
    } catch (error) {
      throw new Error(`line ${line}: ${(error as Error).message}`);
    }
    if (tokens.length === 0) continue;

    const command = tokens[0] ?? "";
    if (command === "close" || command === "update" || command === "create") {
      operations.push({
        line,
        raw: trimmed,
        cmd: command,
        args: tokens.slice(1),
      });
      continue;
    }
    if (command === "dep") {
      if (tokens.length < 2) {
        throw new Error(
          `line ${line}: 'dep' requires a subcommand (add|remove)`,
        );
      }
      const subcommand = tokens[1];
      if (subcommand === "add") {
        operations.push({
          line,
          raw: trimmed,
          cmd: "dep.add",
          args: tokens.slice(2),
        });
        continue;
      }
      if (subcommand === "remove" || subcommand === "rm") {
        operations.push({
          line,
          raw: trimmed,
          cmd: "dep.remove",
          args: tokens.slice(2),
        });
        continue;
      }
      throw new Error(
        `line ${line}: unknown dep subcommand '${subcommand}' (want add|remove)`,
      );
    }
    throw new Error(
      `line ${line}: unsupported batch command '${command}' (supported: close, update, create, dep add, dep remove)`,
    );
  }
  return operations;
}

export function parseUpdateKVs(kvs: string[]): NormalizedBatchUpdate {
  const output: NormalizedBatchUpdate = {};
  for (const kv of kvs) {
    const separator = kv.indexOf("=");
    if (separator <= 0) {
      throw new Error(`update: expected key=value, got '${kv}'`);
    }
    const key = kv.slice(0, separator).trim();
    const value = kv.slice(separator + 1);
    switch (key) {
      case "status":
        if (value.trim() === "") {
          throw new Error("update: status cannot be empty");
        }
        output.status = value;
        break;
      case "priority":
        output.priority = parsePriorityOption(value);
        break;
      case "title":
        if (value.trim() === "") {
          throw new Error("update: title cannot be empty");
        }
        output.title = value;
        break;
      case "assignee":
        output.assignee = value;
        break;
      default:
        throw new Error(
          `update: unsupported key '${key}' (allowed: status, priority, title, assignee)`,
        );
    }
  }
  return output;
}

const BATCH_RELATION_TYPES = new Set<BatchRelationType>([
  "blocks",
  "related",
  "duplicate",
  "similar",
]);

function normalizeBatchOp(
  op: BatchOp,
  hasDefaultTeam: boolean,
): NormalizedBatchOp {
  switch (op.cmd) {
    case "close": {
      if (op.args.length < 1) throw new Error("close requires <id>");
      const target = op.args[0] as string;
      const reason = op.args.slice(1).join(" ").trim();
      return {
        line: op.line,
        raw: op.raw,
        cmd: "close",
        target,
        ...(reason ? { reason } : {}),
      };
    }
    case "update": {
      if (op.args.length < 2) {
        throw new Error("update requires <id> and at least one key=value");
      }
      return {
        line: op.line,
        raw: op.raw,
        cmd: "update",
        target: op.args[0] as string,
        update: parseUpdateKVs(op.args.slice(1)),
      };
    }
    case "create": {
      if (op.args.length < 3) {
        throw new Error("create requires <type> <priority> <title>");
      }
      if (!hasDefaultTeam) {
        throw new Error(
          "create requires --team (or team.default) to anchor the new issue",
        );
      }
      const [typeRaw, priorityRaw, ...titleParts] = op.args as [
        string,
        string,
        ...string[],
      ];
      const issueType = typeRaw.trim().toLowerCase();
      if (!issueType) throw new Error("create: type cannot be empty");
      const title = titleParts.join(" ").trim();
      if (!title) throw new Error("create: title cannot be empty");
      return {
        line: op.line,
        raw: op.raw,
        cmd: "create",
        issueType,
        title,
        priority: parsePriorityOption(priorityRaw),
      };
    }
    case "dep.add":
    case "dep.remove": {
      const verb = op.cmd === "dep.add" ? "dep add" : "dep remove";
      if (op.args.length < 2) {
        throw new Error(`${verb} requires <from-id> <to-id>`);
      }
      const from = op.args[0] as string;
      const to = op.args[1] as string;
      if (op.cmd === "dep.remove") {
        return { line: op.line, raw: op.raw, cmd: "dep.remove", from, to };
      }
      const type = (op.args[2] ?? "blocks").toLowerCase();
      if (!BATCH_RELATION_TYPES.has(type as BatchRelationType)) {
        throw new Error(
          `dep add: invalid dependency type '${type}' (allowed: blocks, related, duplicate, similar)`,
        );
      }
      return {
        line: op.line,
        raw: op.raw,
        cmd: "dep.add",
        from,
        to,
        type: type as BatchRelationType,
      };
    }
  }
}

/** Pure grammar and value validation shared by dry-run and execution. */
export function normalizeBatchOps(
  ops: BatchOp[],
  options: { hasDefaultTeam: boolean },
): NormalizedBatchOp[] {
  return ops.map((op) => {
    try {
      return normalizeBatchOp(op, options.hasDefaultTeam);
    } catch (error) {
      throw new Error(
        `line ${op.line} (${op.raw}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}
