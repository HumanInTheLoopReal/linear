import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/common/context.js", () => ({
  createContext: vi.fn(() => ({
    gql: { request: vi.fn() },
    sdk: { sdk: {} },
  })),
  getRootOpts: vi.fn(() => ({ apiToken: "test-token" })),
}));

vi.mock("../../../src/common/output.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/common/output.js")>();
  return {
    ...actual,
    outputSuccess: vi.fn(),
    outputResult: vi.fn(),
  };
});

vi.mock("../../../src/resolvers/issue-resolver.js", () => ({
  resolveIssueId: vi
    .fn()
    .mockImplementation(async (_sdk, id: string) => `uuid-${id}`),
}));

vi.mock("../../../src/services/deferred-service.js", () => ({
  snoozeIssue: vi.fn().mockImplementation(async (_gql, issueId: string) => ({
    id: issueId,
    identifier: "ENG-1",
  })),
  listDeferredIssues: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../../src/resolvers/team-resolver.js", () => ({
  resolveTeamId: vi
    .fn()
    .mockImplementation(async (_sdk, key: string) => `team-${key}`),
}));

import {
  formatSnoozeVerify,
  type SnoozeVerifyResult,
  setupSnoozeCommands,
} from "../../../src/commands/snooze.js";
import { outputResult } from "../../../src/common/output.js";
import { resolveIssueId } from "../../../src/resolvers/issue-resolver.js";
import {
  listDeferredIssues,
  snoozeIssue,
} from "../../../src/services/deferred-service.js";

function createProgram(): Command {
  const program = new Command();
  program.option("--api-token <token>");
  setupSnoozeCommands(program);
  return program;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
});

describe("snooze", () => {
  it("resolves each issue ID and calls snoozeIssue without until", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "test", "snooze", "ENG-1", "ENG-2"]);

    expect(resolveIssueId).toHaveBeenCalledTimes(2);
    expect(resolveIssueId).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      "ENG-1",
    );
    expect(resolveIssueId).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "ENG-2",
    );
    expect(snoozeIssue).toHaveBeenCalledTimes(2);
    expect(snoozeIssue).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      "uuid-ENG-1",
      undefined,
    );
    expect(outputResult).toHaveBeenCalledOnce();
  });

  it("forwards --until to snoozeIssue when valid", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "snooze",
      "ENG-1",
      "--until",
      "2099-01-01",
    ]);

    expect(snoozeIssue).toHaveBeenCalledWith(
      expect.anything(),
      "uuid-ENG-1",
      "2099-01-01",
    );
  });

  it("warns on stderr when --until is in the past", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "snooze",
      "ENG-1",
      "--until",
      "2000-01-01",
    ]);

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "Warning: resurface date 2000-01-01 is in the past",
      ),
    );
    expect(snoozeIssue).toHaveBeenCalledWith(
      expect.anything(),
      "uuid-ENG-1",
      "2000-01-01",
    );
  });

  it("rejects invalid --until format and exits 1", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "snooze",
      "ENG-1",
      "--until",
      "someday",
    ]);

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(snoozeIssue).not.toHaveBeenCalled();
  });

  // lin-b7hb / lin-ipd3: --until accepts natural-language anchors, ISO
  // datetimes, and --for accepts an `h` unit — all encoded as the
  // `deferred-until:` suffix snoozeIssue attaches.
  describe("natural-language + sub-day resurface (lin-b7hb, lin-ipd3)", () => {
    it("resolves --until tomorrow to today + 1 day", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-01T09:00:00Z"));
      try {
        const program = createProgram();
        await program.parseAsync([
          "node",
          "test",
          "snooze",
          "ENG-1",
          "--until",
          "tomorrow",
        ]);

        expect(snoozeIssue).toHaveBeenCalledWith(
          expect.anything(),
          "uuid-ENG-1",
          "2026-06-02",
        );
        expect(process.exit).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("encodes a naive ISO datetime as a UTC deferred-until timestamp", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "snooze",
        "ENG-1",
        "--until",
        "2099-06-01T14:30",
      ]);

      expect(snoozeIssue).toHaveBeenCalledWith(
        expect.anything(),
        "uuid-ENG-1",
        "2099-06-01T1430",
      );
    });

    it("converts --for 6h to a sub-day UTC timestamp", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-01T09:15:00Z"));
      try {
        const program = createProgram();
        await program.parseAsync([
          "node",
          "test",
          "snooze",
          "ENG-1",
          "--for",
          "6h",
        ]);

        expect(snoozeIssue).toHaveBeenCalledWith(
          expect.anything(),
          "uuid-ENG-1",
          "2026-06-01T1515",
        );
        expect(process.exit).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("warns when a sub-day --until instant has already passed", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-01T18:00:00Z"));
      try {
        const program = createProgram();
        await program.parseAsync([
          "node",
          "test",
          "snooze",
          "ENG-1",
          "--until",
          "2026-06-01T09:00",
        ]);

        expect(console.error).toHaveBeenCalledWith(
          expect.stringContaining("is in the past"),
        );
        expect(snoozeIssue).toHaveBeenCalledWith(
          expect.anything(),
          "uuid-ENG-1",
          "2026-06-01T0900",
        );
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // lin-j56l: --for / --days compute the YYYY-MM-DD against `now`, so
  // tests pin the system clock via vi.useFakeTimers to keep them stable.
  describe("--for / --days", () => {
    it("converts --for 1w to today + 7 days", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 4, 18)); // 2026-05-18
      try {
        const program = createProgram();
        await program.parseAsync([
          "node",
          "test",
          "snooze",
          "ENG-1",
          "--for",
          "1w",
        ]);

        expect(snoozeIssue).toHaveBeenCalledWith(
          expect.anything(),
          "uuid-ENG-1",
          "2026-05-25",
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("converts --days 14 to today + 14 days", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 4, 18));
      try {
        const program = createProgram();
        await program.parseAsync([
          "node",
          "test",
          "snooze",
          "ENG-1",
          "--days",
          "14",
        ]);

        expect(snoozeIssue).toHaveBeenCalledWith(
          expect.anything(),
          "uuid-ENG-1",
          "2026-06-01",
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("rejects combining --until + --for and exits 1", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "snooze",
        "ENG-1",
        "--until",
        "2099-01-01",
        "--for",
        "1w",
      ]);

      expect(process.exit).toHaveBeenCalledWith(1);
      expect(snoozeIssue).not.toHaveBeenCalled();
    });

    it("rejects non-integer --days and exits 1", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "snooze",
        "ENG-1",
        "--days",
        "7.5",
      ]);

      expect(process.exit).toHaveBeenCalledWith(1);
      expect(snoozeIssue).not.toHaveBeenCalled();
    });

    it("rejects malformed --for (e.g. '1 week') and exits 1", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "snooze",
        "ENG-1",
        "--for",
        "1 week",
      ]);

      expect(process.exit).toHaveBeenCalledWith(1);
      expect(snoozeIssue).not.toHaveBeenCalled();
    });
  });
});

describe("formatSnoozeVerify (lin-ay7q)", () => {
  it("renders a clean summary with no drift", () => {
    const result: SnoozeVerifyResult = {
      scanned: 4,
      drifted: 0,
      truncated: false,
      issues: [],
    };
    expect(formatSnoozeVerify(result)).toBe(
      "✓ No snooze drift found (4 deferred issue(s) scanned)",
    );
  });

  it("notes the cap when a clean scan is truncated", () => {
    const result: SnoozeVerifyResult = {
      scanned: 250,
      drifted: 0,
      truncated: true,
      issues: [],
    };
    expect(formatSnoozeVerify(result)).toContain("scan capped at 250");
  });

  it("lists each drifted issue with friendly problem labels and a summary", () => {
    const result: SnoozeVerifyResult = {
      scanned: 3,
      drifted: 2,
      truncated: false,
      issues: [
        {
          identifier: "ENG-1",
          title: "Old work",
          team: "ENG",
          problems: [
            { kind: "stale", detail: "resurface date 2025-01-01 has passed" },
          ],
        },
        {
          identifier: "ENG-2",
          title: "Bad date",
          team: "ENG",
          problems: [
            { kind: "malformed-date", detail: "deferred-until:next-week" },
          ],
        },
      ],
    };
    const text = formatSnoozeVerify(result);
    expect(text).toContain("✗ ENG-1");
    expect(text).toContain("stale (already resurfaced)");
    expect(text).toContain("malformed date: deferred-until:next-week");
    expect(text).toContain("2 of 3 deferred issue(s) have snooze drift.");
  });
});

describe("snooze verify action (lin-ay7q)", () => {
  function makeIssue(identifier: string, labelNames: string[]) {
    return {
      identifier,
      title: `${identifier} title`,
      team: { key: "ENG" },
      labels: { nodes: labelNames.map((name) => ({ name })) },
    };
  }

  it("scans clean snoozes without exiting non-zero", async () => {
    vi.mocked(listDeferredIssues).mockResolvedValueOnce([
      // biome-ignore lint/suspicious/noExplicitAny: minimal issue stub
      makeIssue("ENG-1", ["deferred", "deferred-until:2099-01-01"]) as any,
    ]);
    const program = createProgram();
    await program.parseAsync(["node", "test", "snooze", "verify"]);

    expect(outputResult).toHaveBeenCalledOnce();
    const arg = vi.mocked(outputResult).mock.calls[0][0] as SnoozeVerifyResult;
    expect(arg.scanned).toBe(1);
    expect(arg.drifted).toBe(0);
    expect(process.exit).not.toHaveBeenCalled();
  });

  it("exits 1 in text mode when drift is found", async () => {
    vi.mocked(listDeferredIssues).mockResolvedValueOnce([
      // biome-ignore lint/suspicious/noExplicitAny: minimal issue stub
      makeIssue("ENG-1", ["deferred-until:next-week"]) as any,
    ]);
    const program = createProgram();
    await program.parseAsync(["node", "test", "snooze", "verify"]);

    const arg = vi.mocked(outputResult).mock.calls[0][0] as SnoozeVerifyResult;
    expect(arg.drifted).toBe(1);
    expect(arg.issues[0].identifier).toBe("ENG-1");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("resolves --team to a team filter for the scan", async () => {
    vi.mocked(listDeferredIssues).mockResolvedValueOnce([]);
    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "snooze",
      "verify",
      "--team",
      "ENG",
    ]);

    expect(listDeferredIssues).toHaveBeenCalledWith(
      expect.anything(),
      "team-ENG",
    );
  });
});
