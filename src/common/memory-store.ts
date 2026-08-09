import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface MemoryEntry {
  value: string;
  updated_at: string;
}

export type MemoryMap = Record<string, MemoryEntry>;

const DIR_NAME = ".linear";
const FILE_NAME = "memory.json";

export function getMemoryDir(): string {
  return path.join(os.homedir(), DIR_NAME);
}

export function getMemoryPath(): string {
  return path.join(getMemoryDir(), FILE_NAME);
}

export function slugify(s: string): string {
  const lowered = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (lowered === "") return "";
  const parts = lowered.split("-");
  const limited = parts.slice(0, 8).join("-");
  if (limited.length <= 60) return limited;
  return limited.slice(0, 60).replace(/-+$/g, "");
}

function ensureDir(): void {
  const dir = getMemoryDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

export function readAll(): MemoryMap {
  const file = getMemoryPath();
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, "utf8");
  if (raw.trim() === "") return {};
  return JSON.parse(raw) as MemoryMap;
}

function writeAll(memories: MemoryMap): void {
  ensureDir();
  const file = getMemoryPath();
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(memories, null, 2)}\n`, {
    mode: 0o600,
  });
  fs.renameSync(tmp, file);
}

export function upsertMemory(
  key: string,
  value: string,
): { key: string; value: string; action: "remembered" | "updated" } {
  const memories = readAll();
  const action = key in memories ? "updated" : "remembered";
  memories[key] = { value, updated_at: new Date().toISOString() };
  writeAll(memories);
  return { key, value, action };
}

export function getMemory(key: string): MemoryEntry | undefined {
  const memories = readAll();
  return memories[key];
}

export function listMemories(search?: string): MemoryMap {
  const memories = readAll();
  if (!search) return memories;
  const needle = search.toLowerCase();
  const out: MemoryMap = {};
  for (const [k, v] of Object.entries(memories)) {
    if (
      k.toLowerCase().includes(needle) ||
      v.value.toLowerCase().includes(needle)
    ) {
      out[k] = v;
    }
  }
  return out;
}

export function deleteMemory(key: string): MemoryEntry | undefined {
  const memories = readAll();
  const existing = memories[key];
  if (!existing) return undefined;
  delete memories[key];
  writeAll(memories);
  return existing;
}
