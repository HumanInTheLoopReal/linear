/**
 * Minimal line-based unified diff, used by `issues push` (dry-run
 * preview and conflict reports). Descriptions are small (hundreds of
 * lines), so a plain LCS table is fast enough — no external diff
 * dependency needed.
 */

interface DiffOp {
  type: " " | "-" | "+";
  line: string;
}

/** LCS backtrack into a flat op list (equal / removed / added lines). */
function diffOps(oldLines: string[], newLines: string[]): DiffOp[] {
  const n = oldLines.length;
  const m = newLines.length;
  // lcs[i][j] = LCS length of oldLines[i..] vs newLines[j..]
  const width = m + 1;
  const lcs = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] =
        oldLines[i] === newLines[j]
          ? lcs[(i + 1) * width + j + 1] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ type: " ", line: oldLines[i] });
      i++;
      j++;
    } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
      ops.push({ type: "-", line: oldLines[i] });
      i++;
    } else {
      ops.push({ type: "+", line: newLines[j] });
      j++;
    }
  }
  for (; i < n; i++) ops.push({ type: "-", line: oldLines[i] });
  for (; j < m; j++) ops.push({ type: "+", line: newLines[j] });
  return ops;
}

/**
 * Render a unified diff between two texts. Returns "" when the texts
 * are identical, so callers can use truthiness for "anything changed?".
 */
export function unifiedDiff(
  oldText: string,
  newText: string,
  opts: { oldLabel?: string; newLabel?: string; context?: number } = {},
): string {
  if (oldText === newText) return "";
  const context = opts.context ?? 3;
  const ops = diffOps(oldText.split("\n"), newText.split("\n"));

  // Group changed ops into hunks with `context` lines of surround.
  const changed = ops
    .map((op, idx) => (op.type === " " ? -1 : idx))
    .filter((idx) => idx >= 0);
  const hunks: Array<{ start: number; end: number }> = [];
  for (const idx of changed) {
    const start = Math.max(0, idx - context);
    const end = Math.min(ops.length - 1, idx + context);
    const last = hunks[hunks.length - 1];
    if (last && start <= last.end + 1) {
      last.end = Math.max(last.end, end);
    } else {
      hunks.push({ start, end });
    }
  }

  const out: string[] = [
    `--- ${opts.oldLabel ?? "old"}`,
    `+++ ${opts.newLabel ?? "new"}`,
  ];
  // Track 1-based line cursors per side as we walk the full op list.
  let oldLine = 1;
  let newLine = 1;
  let opIdx = 0;
  for (const hunk of hunks) {
    for (; opIdx < hunk.start; opIdx++) {
      if (ops[opIdx].type !== "+") oldLine++;
      if (ops[opIdx].type !== "-") newLine++;
    }
    const oldStart = oldLine;
    const newStart = newLine;
    const body: string[] = [];
    let oldCount = 0;
    let newCount = 0;
    for (; opIdx <= hunk.end; opIdx++) {
      const op = ops[opIdx];
      body.push(`${op.type}${op.line}`);
      if (op.type !== "+") {
        oldLine++;
        oldCount++;
      }
      if (op.type !== "-") {
        newLine++;
        newCount++;
      }
    }
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    out.push(...body);
  }
  return out.join("\n");
}
