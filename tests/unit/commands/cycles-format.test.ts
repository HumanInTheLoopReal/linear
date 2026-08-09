//
// Format tests for the cycles suite (list / read). Cycles is a
// linear-native concept; format consistent with the projects formatters.
//
//   list (empty)     → `No cycles found.`
//   list (populated) → `  #<n>  <name>  <start>–<end>  [state]` rows + footer
//   read             → header (`#<n>  <name>   [state]`) + Dates + ISSUES

import { describe, expect, it } from "vitest";
import {
  formatCycleDetail,
  formatCycleList,
} from "../../../src/commands/cycles.js";

describe("formatCycleList", () => {
  it("renders the empty-state hint", () => {
    expect(formatCycleList({ nodes: [] })).toBe("No cycles found.\n");
  });

  it("renders a row per cycle with number, name, dates, state", () => {
    const out = formatCycleList({
      nodes: [
        {
          id: "c-1",
          number: 12,
          name: "Sprint 12",
          startsAt: "2026-05-01T00:00:00.000Z",
          endsAt: "2026-05-14T00:00:00.000Z",
          isActive: true,
        },
      ],
    });
    expect(out).toContain(
      "  #12  Sprint 12  2026-05-01–2026-05-14  [active]\n",
    );
  });

  it("falls back to `Cycle <n>` when name is missing", () => {
    const out = formatCycleList({
      nodes: [
        {
          id: "c-1",
          number: 7,
          name: null,
          startsAt: "2026-04-01",
          endsAt: "2026-04-14",
          isActive: true,
        },
      ],
    });
    expect(out).toContain("  #7  Cycle 7  2026-04-01–2026-04-14  [active]\n");
  });

  it("maps state flags to the right bracket label", () => {
    const cases: Array<
      [
        Partial<{ isActive: boolean; isNext: boolean; isPrevious: boolean }>,
        string,
      ]
    > = [
      [{ isActive: true }, "[active]"],
      [{ isNext: true }, "[upcoming]"],
      [{ isPrevious: true }, "[past]"],
      [{}, "[scheduled]"],
    ];
    for (const [flags, label] of cases) {
      const out = formatCycleList({
        nodes: [
          {
            id: "c-1",
            number: 1,
            name: "X",
            startsAt: "2026-04-01",
            endsAt: "2026-04-14",
            ...flags,
          },
        ],
      });
      expect(out).toContain(label);
    }
  });

  it("renders `(no date)` placeholders when dates are missing", () => {
    const out = formatCycleList({
      nodes: [
        {
          id: "c-1",
          number: 1,
          name: "X",
          startsAt: null,
          endsAt: null,
          isActive: true,
        },
      ],
    });
    expect(out).toContain("(no date)–(no date)");
  });

  it("appends `Total: N cycles` footer with a blank-line separator", () => {
    const out = formatCycleList({
      nodes: [
        {
          id: "c-1",
          number: 1,
          name: "A",
          startsAt: "2026-04-01",
          endsAt: "2026-04-14",
        },
        {
          id: "c-2",
          number: 2,
          name: "B",
          startsAt: "2026-04-15",
          endsAt: "2026-04-28",
        },
      ],
    });
    expect(out).toContain("\nTotal: 2 cycles\n");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatCycleList({
      nodes: [
        {
          id: "c-1",
          number: 1,
          name: "X",
          startsAt: "2026-04-01",
          endsAt: "2026-04-14",
        },
      ],
    });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

describe("formatCycleDetail", () => {
  function makeDetail(
    overrides: Partial<Parameters<typeof formatCycleDetail>[0]> = {},
  ) {
    return {
      id: "c-uuid-1",
      number: 5,
      name: "Sprint 5",
      startsAt: "2026-04-01T00:00:00.000Z",
      endsAt: "2026-04-14T00:00:00.000Z",
      isActive: true,
      issues: [],
      ...overrides,
    };
  }

  it("renders the header line with number, name, state", () => {
    const out = formatCycleDetail(makeDetail());
    expect(out.startsWith("#5  Sprint 5   [active]\n")).toBe(true);
  });

  it("renders the Dates: line as YYYY-MM-DD range", () => {
    const out = formatCycleDetail(makeDetail());
    expect(out).toContain("Dates: 2026-04-01–2026-04-14\n");
  });

  it("renders ISSUES block when present", () => {
    const out = formatCycleDetail(
      makeDetail({
        issues: [
          {
            identifier: "TES-1",
            title: "First task",
            state: { name: "Todo" },
          },
          {
            identifier: "TES-2",
            title: "Second task",
            state: { name: "In Progress" },
          },
        ],
      }),
    );
    expect(out).toContain("ISSUES (2)\n");
    expect(out).toContain("  · TES-1  [Todo]  First task\n");
    expect(out).toContain("  · TES-2  [In Progress]  Second task\n");
  });

  it("omits ISSUES block when empty", () => {
    expect(formatCycleDetail(makeDetail({ issues: [] }))).not.toContain(
      "ISSUES",
    );
  });

  it("falls back to (no state) when issue state is null", () => {
    const out = formatCycleDetail(
      makeDetail({
        issues: [{ identifier: "TES-1", title: "x", state: null }],
      }),
    );
    expect(out).toContain("  · TES-1  [(no state)]  x\n");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatCycleDetail(makeDetail());
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});
