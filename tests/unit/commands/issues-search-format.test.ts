//
// Format tests for `linear issues search`. Output format:
//   Found N issues matching '<query>':
//   <id> [P<n>] [<type>] <state> @<assignee> [<label>...] - <title>
//
// Notes:
// - <state> comes from Linear's workspace state.name (Backlog/In Progress/…).
// - <type> comes from the Linear-Hack `type:*` label, defaulting to `task`
//   for plain task issues.
// - non-type labels are rendered as additional `[<label>]` chips after the
//   assignee (e.g. `bug` or `type:chore`).

import { describe, expect, it } from "vitest";
import { formatIssueSearch } from "../../../src/commands/issues.js";

type Row = {
  identifier: string;
  title: string;
  priority: number;
  state: { name: string; type: string };
  assignee?: { name: string } | null;
  labels?: { nodes: { name: string }[] } | null;
};

function row(o: Partial<Row> = {}): Row {
  return {
    identifier: "TES-1",
    title: "match",
    priority: 2,
    state: { name: "Backlog", type: "backlog" },
    ...o,
  };
}

describe("formatIssueSearch", () => {
  it("renders the empty case with a leading + trailing blank line", () => {
    expect(formatIssueSearch({ nodes: [] }, "missing")).toBe(
      "\nNo issues found matching 'missing'.\n\n",
    );
  });

  it("emits the 'Found N issues matching <q>:' banner", () => {
    const out = formatIssueSearch({ nodes: [row({})] }, "seed");
    expect(out.startsWith("Found 1 issues matching 'seed':\n")).toBe(true);
  });

  it("renders id, priority chip, default [task] type, state.name, title for a plain row", () => {
    const out = formatIssueSearch(
      { nodes: [row({ identifier: "TES-2", title: "x", priority: 2 })] },
      "x",
    );
    const line = out.split("\n")[1];
    expect(line).toBe("TES-2 [P2] [task] Backlog - x");
  });

  it("uses the Linear-Hack `type:*` label as the type bracket (overrides default)", () => {
    const out = formatIssueSearch(
      {
        nodes: [
          row({
            identifier: "TES-3",
            title: "Q2",
            labels: { nodes: [{ name: "type:epic" }] },
          }),
        ],
      },
      "Q2",
    );
    const line = out.split("\n")[1];
    expect(line).toContain("[epic]");
    expect(line).not.toContain("[task]");
  });

  it("prepends @<assignee> when the issue has one, between state and labels", () => {
    const out = formatIssueSearch(
      {
        nodes: [
          row({
            identifier: "TES-4",
            title: "deploy",
            assignee: { name: "Alice" },
          }),
        ],
      },
      "deploy",
    );
    const line = out.split("\n")[1];
    expect(line).toBe("TES-4 [P2] [task] Backlog @Alice - deploy");
  });

  it("renders non-type labels as additional [<label>] chips after assignee", () => {
    const out = formatIssueSearch(
      {
        nodes: [
          row({
            identifier: "TES-5",
            title: "bug fix",
            assignee: { name: "Bob" },
            labels: { nodes: [{ name: "bug" }, { name: "frontend" }] },
          }),
        ],
      },
      "bug",
    );
    const line = out.split("\n")[1];
    expect(line).toBe(
      "TES-5 [P2] [task] Backlog @Bob [bug] [frontend] - bug fix",
    );
  });

  it("omits the priority bracket when priority is 0 (No priority)", () => {
    const out = formatIssueSearch(
      { nodes: [row({ identifier: "TES-6", priority: 0, title: "x" })] },
      "x",
    );
    const line = out.split("\n")[1];
    expect(line).toBe("TES-6 [task] Backlog - x");
  });

  it("uses Linear's workspace state.name (not status buckets)", () => {
    const out = formatIssueSearch(
      {
        nodes: [
          row({
            identifier: "TES-7",
            state: { name: "In Review", type: "started" },
            title: "wip",
          }),
        ],
      },
      "wip",
    );
    const line = out.split("\n")[1];
    expect(line).toContain("In Review");
    expect(line).not.toContain("started");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatIssueSearch({ nodes: [row({})] }, "q");
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});
