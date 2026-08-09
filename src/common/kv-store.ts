import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type KvMap = Record<string, string>;

const DIR_NAME = ".linear";
const FILE_NAME = "kv.json";

const RESERVED_PREFIXES = [
  "kv.",
  "sync.",
  "conflict.",
  "federation.",
  "jira.",
  "linear.",
  "export.",
];

export function getKvDir(): string {
  return path.join(os.homedir(), DIR_NAME);
}

export function getKvPath(): string {
  return path.join(getKvDir(), FILE_NAME);
}

export function validateKvKey(key: string): string | null {
  if (key === "") return "key cannot be empty";
  if (key.trim() === "") return "key cannot be only whitespace";
  for (const prefix of RESERVED_PREFIXES) {
    if (key.startsWith(prefix)) {
      return `key cannot start with reserved prefix "${prefix}"`;
    }
  }
  return null;
}

function ensureDir(): void {
  const dir = getKvDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

export function readAll(): KvMap {
  const file = getKvPath();
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, "utf8");
  if (raw.trim() === "") return {};
  return JSON.parse(raw) as KvMap;
}

function writeAll(pairs: KvMap): void {
  ensureDir();
  const file = getKvPath();
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(pairs, null, 2)}\n`, {
    mode: 0o600,
  });
  fs.renameSync(tmp, file);
}

export function setKv(
  key: string,
  value: string,
): { key: string; value: string; action: "set" | "updated" } {
  const pairs = readAll();
  const action = key in pairs ? "updated" : "set";
  pairs[key] = value;
  writeAll(pairs);
  return { key, value, action };
}

export function getKv(key: string): {
  key: string;
  value: string | null;
  found: boolean;
} {
  const pairs = readAll();
  if (key in pairs) {
    return { key, value: pairs[key], found: true };
  }
  return { key, value: null, found: false };
}

export function clearKv(key: string): boolean {
  const pairs = readAll();
  if (!(key in pairs)) return false;
  delete pairs[key];
  writeAll(pairs);
  return true;
}

export function listKv(): KvMap {
  const pairs = readAll();
  const sorted: KvMap = {};
  for (const k of Object.keys(pairs).sort()) {
    sorted[k] = pairs[k];
  }
  return sorted;
}
