import fs from "node:fs";
import path from "node:path";
import { threadId } from "node:worker_threads";

export const COMMAND_COVERAGE_DIR_ENV = "LINEAR_COMMAND_COVERAGE_DIR";

function resolveManifestDirectory(
  manifestDirectory?: string,
): string | undefined {
  return manifestDirectory ?? process.env[COMMAND_COVERAGE_DIR_ENV];
}

/** Record one CLI invocation in a worker-specific JSONL shard. */
export function recordCliInvocation(
  argv: readonly string[],
  manifestDirectory?: string,
): void {
  const directory = resolveManifestDirectory(manifestDirectory);
  if (!directory) return;

  fs.mkdirSync(directory, { recursive: true });
  const shard = path.join(directory, `${process.pid}-${threadId}.jsonl`);
  fs.appendFileSync(shard, `${JSON.stringify([...argv])}\n`, "utf8");
}
