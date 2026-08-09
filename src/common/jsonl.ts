/**
 * JSONL helpers for `linear issues export` (and future import).
 *
 * Two flavors of writer:
 *
 *   • {@link writeJsonlToFile} — serializes every object to a line, then
 *     writes the whole buffer to `${target}.tmp.${pid}` and renames
 *     atomically over the destination. POSIX rename is atomic within the
 *     same filesystem, so a crashed export never leaves a partial file.
 *
 *   • {@link writeJsonlToStdout} — writes lines directly to
 *     `process.stdout`. No atomicity is meaningful for stdout: the
 *     consumer either reads what we write or doesn't.
 *
 * One ToJSONL contract: each input value is JSON-serializable. Lines
 * are joined with `\n` and the file ends in a trailing newline so
 * tools like `jq -c` and `wc -l` count rows correctly.
 */

import fs from "node:fs";
import path from "node:path";

export function toJsonlString(lines: ReadonlyArray<unknown>): string {
  if (lines.length === 0) return "";
  return `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`;
}

export function writeJsonlToFile(
  target: string,
  lines: ReadonlyArray<unknown>,
): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, toJsonlString(lines), { mode: 0o644 });
  fs.renameSync(tmp, target);
}

export function writeJsonlToStdout(lines: ReadonlyArray<unknown>): void {
  for (const line of lines) {
    process.stdout.write(`${JSON.stringify(line)}\n`);
  }
}
