import { describe, expect, it } from "vitest";
import {
  normalizeBatchOps,
  parseBatchScript,
  parseUpdateKVs,
  tokenizeBatchLine,
} from "../../../src/common/batch-script.js";

describe("tokenizeBatchLine", () => {
  it("splits on whitespace", () => {
    expect(tokenizeBatchLine("close lin-1 done")).toEqual([
      "close",
      "lin-1",
      "done",
    ]);
  });

  it("preserves spaces inside double quotes", () => {
    expect(tokenizeBatchLine('close lin-1 "test reason here"')).toEqual([
      "close",
      "lin-1",
      "test reason here",
    ]);
  });

  it('handles escaped quotes and backslashes (\\" and \\\\)', () => {
    expect(tokenizeBatchLine('update lin-1 title="say \\"hi\\""')).toEqual([
      "update",
      "lin-1",
      'title=say "hi"',
    ]);
  });

  it("rejects an unterminated quote", () => {
    expect(() => tokenizeBatchLine('close lin-1 "oops')).toThrow(
      "unterminated quoted string",
    );
  });
});

describe("parseBatchScript", () => {
  it("ignores blank lines and comments while preserving source lines", () => {
    const operations = parseBatchScript(
      [
        "# header",
        "",
        "close lin-1",
        "  # indented comment",
        "update lin-2 status=closed",
      ].join("\n"),
    );
    expect(
      operations.map((operation) => [operation.line, operation.cmd]),
    ).toEqual([
      [3, "close"],
      [5, "update"],
    ]);
  });

  it("normalizes dependency subcommands", () => {
    const operations = parseBatchScript(
      ["dep add lin-1 lin-2 blocks", "dep rm lin-3 lin-4"].join("\n"),
    );
    expect(operations.map((operation) => operation.cmd)).toEqual([
      "dep.add",
      "dep.remove",
    ]);
  });

  it("rejects unknown commands with the offending line number", () => {
    expect(() => parseBatchScript("close lin-1\nbogus lin-2")).toThrow(
      /line 2: unsupported batch command 'bogus'/,
    );
  });
});

describe("parseUpdateKVs", () => {
  it("accepts the four documented keys", () => {
    expect(
      parseUpdateKVs([
        "status=in_progress",
        "priority=2",
        "title=Hello world",
        "assignee=alex@example.com",
      ]),
    ).toEqual({
      status: "in_progress",
      priority: 2,
      title: "Hello world",
      assignee: "alex@example.com",
    });
  });

  it("rejects malformed and unsupported assignments", () => {
    expect(() => parseUpdateKVs(["foo=bar"])).toThrow(/unsupported key 'foo'/);
    expect(() => parseUpdateKVs(["statusclosed"])).toThrow(
      /expected key=value/,
    );
  });

  it.each([
    "abc",
    "2junk",
    "0",
    "5",
    "-1",
  ])("rejects invalid priority %s", (priority) => {
    expect(() => parseUpdateKVs([`priority=${priority}`])).toThrow(
      /must be 1-4/,
    );
  });

  it("accepts P1-P4 shorthand through the canonical parser", () => {
    expect(parseUpdateKVs(["priority=P4"])).toEqual({ priority: 4 });
  });
});

describe("normalizeBatchOps", () => {
  it("preserves and canonicalizes the create issue type", () => {
    const [operation] = normalizeBatchOps(
      parseBatchScript('create BuG P2 "Broken button"'),
      { hasDefaultTeam: true },
    );

    expect(operation).toEqual({
      line: 1,
      raw: 'create BuG P2 "Broken button"',
      cmd: "create",
      issueType: "bug",
      title: "Broken button",
      priority: 2,
    });
  });
});
