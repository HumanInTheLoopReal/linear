import { isClosedStateType } from "../../common/issue-lifecycle.js";
import {
  priorityCol,
  renderFooter,
  renderTree,
  statusIcon,
  type TreeRow,
  typeLabel,
} from "../_format.js";

export interface ListIssueShape {
  identifier: string;
  title: string;
  priority: number;
  state: { type: string };
  labels?: { nodes: { name: string }[] } | null;
  parent?: { identifier: string } | null;
  commentCount?: number;
}

export interface FormatIssueListOptions {
  includeClosed?: boolean;
}

export function hasDeferredLabel(issue: {
  labels?: { nodes: { name: string }[] } | null;
}): boolean {
  const nodes = issue.labels?.nodes ?? [];
  return nodes.some(
    (label) =>
      label.name === "deferred" || label.name.startsWith("deferred-until:"),
  );
}

function formatIssueLine(issue: ListIssueShape): string {
  const icon = statusIcon(issue.state.type, {
    deferred: hasDeferredLabel(issue),
  });
  const priority = priorityCol(issue.priority);
  const type = typeLabel(issue.labels ?? undefined);
  const parts = [
    icon,
    issue.identifier,
    "●",
    priority,
    type,
    issue.title,
  ].filter((part) => part !== "");
  if (issue.commentCount !== undefined) parts.push(`💬${issue.commentCount}`);
  return parts.join(" ");
}

interface TreeNode extends ListIssueShape {
  __children: TreeNode[];
}

function buildIssueTree(issues: ListIssueShape[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const issue of issues) {
    byId.set(issue.identifier, { ...issue, __children: [] });
  }
  const roots: TreeNode[] = [];
  for (const issue of issues) {
    const node = byId.get(issue.identifier);
    if (!node) continue;
    const parentId = issue.parent?.identifier;
    const parentNode = parentId ? byId.get(parentId) : undefined;
    if (parentNode) parentNode.__children.push(node);
    else roots.push(node);
  }
  return roots;
}

export function sortByPriorityThenId<
  T extends { priority: number; identifier: string },
>(nodes: T[]): T[] {
  return [...nodes].sort((a, b) => {
    const aPriority = a.priority > 0 ? a.priority : 99;
    const bPriority = b.priority > 0 ? b.priority : 99;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return a.identifier.localeCompare(b.identifier);
  });
}

function appendDescendantRows(
  parent: TreeNode,
  ancestorContinues: boolean[],
  out: TreeRow[],
): void {
  const children = sortByPriorityThenId(parent.__children);
  children.forEach((child, index) => {
    const isLast = index === children.length - 1;
    out.push({
      ancestorContinues,
      isLast,
      content: formatIssueLine(child),
    });
    if (child.__children.length > 0) {
      appendDescendantRows(child, [...ancestorContinues, !isLast], out);
    }
  });
}

function summarizeIssueCounts(issues: ListIssueShape[]): {
  total: number;
  toDo: number;
  inProgress: number;
  closed: number;
} {
  let toDo = 0;
  let inProgress = 0;
  let closed = 0;
  for (const issue of issues) {
    if (hasDeferredLabel(issue)) continue;
    if (isClosedStateType(issue.state.type)) {
      closed += 1;
      continue;
    }
    switch (issue.state.type) {
      case "started":
        inProgress += 1;
        break;
      case "triage":
      case "backlog":
      case "unstarted":
        toDo += 1;
        break;
    }
  }
  return { total: issues.length, toDo, inProgress, closed };
}

export function formatIssueList(
  result: { nodes: ListIssueShape[] },
  opts: FormatIssueListOptions = {},
): string {
  const issues = opts.includeClosed
    ? result.nodes.slice()
    : result.nodes.filter((issue) => !isClosedStateType(issue.state.type));
  if (issues.length === 0) return "No issues found.\n";

  const roots = sortByPriorityThenId(buildIssueTree(issues));
  const lines: string[] = [];
  for (const root of roots) {
    lines.push(formatIssueLine(root));
    if (root.__children.length > 0) {
      const descendants: TreeRow[] = [];
      appendDescendantRows(root, [], descendants);
      lines.push(renderTree(descendants));
    }
  }

  const counts = summarizeIssueCounts(issues);
  const closedSummary = counts.closed > 0 ? `, ${counts.closed} closed` : "";
  lines.push("");
  lines.push(
    renderFooter(
      `Total: ${counts.total} issues (${counts.toDo} to do, ${counts.inProgress} in progress${closedSummary})`,
    ),
  );
  return `${lines.join("\n")}\n`;
}
