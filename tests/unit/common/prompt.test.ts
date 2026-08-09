//
// Unit tests for the dependency-free prompt shim. Covers:
//   - resolveInteractiveMode flag/env/CI/TTY precedence
//   - promptString default-on-empty
//   - promptYesNo capitalization-shown default
//   - promptMultiPick "all"/"none"/comma-separated parsing

import { describe, expect, it } from "vitest";
import {
  type PromptIO,
  promptMultiPick,
  promptString,
  promptYesNo,
  resolveInteractiveMode,
} from "../../../src/common/prompt.js";

function fakeIO(answers: string[]): PromptIO & { writes: string[] } {
  const writes: string[] = [];
  let i = 0;
  return {
    writes,
    question: async (_q: string) => {
      const ans = answers[i] ?? "";
      i += 1;
      return ans;
    },
    write: (s: string) => {
      writes.push(s);
    },
    close: () => {},
  };
}

describe("resolveInteractiveMode", () => {
  it("--non-interactive returns false even with TTY", () => {
    expect(
      resolveInteractiveMode({ nonInteractive: true, env: {}, isTTY: true }),
    ).toBe(false);
  });

  it("--quiet returns false", () => {
    expect(resolveInteractiveMode({ quiet: true, env: {}, isTTY: true })).toBe(
      false,
    );
  });

  it("LINEAR_NON_INTERACTIVE=1 returns false", () => {
    expect(
      resolveInteractiveMode({
        env: { LINEAR_NON_INTERACTIVE: "1" },
        isTTY: true,
      }),
    ).toBe(false);
  });

  it("LINEAR_NON_INTERACTIVE=0 returns TTY state", () => {
    expect(
      resolveInteractiveMode({
        env: { LINEAR_NON_INTERACTIVE: "0" },
        isTTY: true,
      }),
    ).toBe(true);
    expect(
      resolveInteractiveMode({
        env: { LINEAR_NON_INTERACTIVE: "0" },
        isTTY: false,
      }),
    ).toBe(false);
  });

  it("CI=true returns false", () => {
    expect(resolveInteractiveMode({ env: { CI: "true" }, isTTY: true })).toBe(
      false,
    );
  });

  it("falls back to TTY state when nothing is set", () => {
    expect(resolveInteractiveMode({ env: {}, isTTY: true })).toBe(true);
    expect(resolveInteractiveMode({ env: {}, isTTY: false })).toBe(false);
  });
});

describe("promptString", () => {
  it("returns the default on empty answer", async () => {
    const io = fakeIO([""]);
    expect(await promptString(io, "Team key", "ENG")).toBe("ENG");
  });

  it("trims and returns user answer", async () => {
    const io = fakeIO(["  ACME  "]);
    expect(await promptString(io, "Team key", "ENG")).toBe("ACME");
  });
});

describe("promptYesNo", () => {
  it("default-no returns false on empty answer", async () => {
    const io = fakeIO([""]);
    expect(await promptYesNo(io, "ok?", false)).toBe(false);
  });

  it("default-yes returns true on empty answer", async () => {
    const io = fakeIO([""]);
    expect(await promptYesNo(io, "ok?", true)).toBe(true);
  });

  it("y/yes parses to true; n/no/anything-else to false", async () => {
    expect(await promptYesNo(fakeIO(["y"]), "?", false)).toBe(true);
    expect(await promptYesNo(fakeIO(["YES"]), "?", false)).toBe(true);
    expect(await promptYesNo(fakeIO(["no"]), "?", true)).toBe(false);
    expect(await promptYesNo(fakeIO(["x"]), "?", true)).toBe(false);
  });
});

describe("promptMultiPick", () => {
  const choices = ["claude", "cursor", "codex"];

  it("returns defaults on empty answer", async () => {
    const io = fakeIO([""]);
    expect(await promptMultiPick(io, "pick", choices, ["claude"])).toEqual([
      "claude",
    ]);
  });

  it("'all' returns every choice", async () => {
    const io = fakeIO(["all"]);
    expect(await promptMultiPick(io, "pick", choices, [])).toEqual(choices);
  });

  it("'none' returns an empty array", async () => {
    const io = fakeIO(["none"]);
    expect(await promptMultiPick(io, "pick", choices, ["claude"])).toEqual([]);
  });

  it("intersects comma-separated names against valid set", async () => {
    const io = fakeIO(["claude, cursor, bogus"]);
    expect(await promptMultiPick(io, "pick", choices, [])).toEqual([
      "claude",
      "cursor",
    ]);
  });

  it("dedupes repeated names", async () => {
    const io = fakeIO(["claude,claude,cursor"]);
    expect(await promptMultiPick(io, "pick", choices, [])).toEqual([
      "claude",
      "cursor",
    ]);
  });
});
