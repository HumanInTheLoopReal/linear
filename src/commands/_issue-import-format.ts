import type { ImportResult } from "../services/issue-import-service.js";

export function formatIssueImport(result: ImportResult): string {
  const verb = result.dry_run ? "Would import" : "Imported";
  const parts: string[] = [`${verb} ${result.created} issues`];
  if (result.memories_skipped > 0) {
    parts.push(` (${result.memories_skipped} memory rows skipped)`);
  }
  parts.push(` from ${result.source}`);
  if (result.dedup_skipped > 0) {
    parts.push(` (${result.dedup_skipped} duplicates skipped)`);
  }
  const lines: string[] = [parts.join("")];
  if (result.relations_created > 0) {
    lines.push(`Created ${result.relations_created} issue relations`);
  }
  if (result.errors.length > 0) {
    lines.push(`⚠ ${result.errors.length} errors:`);
    for (const error of result.errors) {
      const tag = error.identifier ? ` ${error.identifier}` : "";
      lines.push(`  line ${error.line_index}${tag}: ${error.message}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
