//
// Unit tests for the agent-safe confirmation guard (lin-iowg). Covers the
// four-way decision contract:
//   --force/--yes      → "forced"           (proceed, no prompt)
//   non-interactive    → "non-interactive"  (proceed, no prompt — agent-safe)
//   TTY human + yes    → "confirmed"         (proceed)
//   TTY human + no     → "declined"          (do NOT mutate)

import { describe, expect, it } from "vitest";
import {
  type ConfirmDecision,
  confirmGuard,
  proceedConfirmed,
} from "../../../src/common/confirm.js";
import type { PromptIO } from "../../../src/common/prompt.js";

function fakeIO(
  answer: string,
): PromptIO & { asked: string[]; closed: number } {
  const asked: string[] = [];
  const io = {
    asked,
    closed: 0,
    question: async (q: string) => {
      asked.push(q);
      return answer;
    },
    write: () => {},
    close: () => {
      io.closed += 1;
    },
  };
  return io;
}

describe("confirmGuard", () => {
  it("returns 'forced' when --force is set, without touching the prompt", async () => {
    const io = fakeIO("n");
    const decision = await confirmGuard("Close 3 issues?", {
      force: true,
      io,
      isTTY: true,
      env: {},
    });
    expect(decision).toBe("forced");
    expect(io.asked).toHaveLength(0);
  });

  it("proceeds non-interactively when stdin is not a TTY (agent-safe)", async () => {
    const io = fakeIO("n");
    const decision = await confirmGuard("Close 3 issues?", {
      io,
      isTTY: false,
      env: {},
    });
    expect(decision).toBe("non-interactive");
    expect(io.asked).toHaveLength(0);
  });

  it("proceeds non-interactively under CI even with a TTY", async () => {
    const decision = await confirmGuard("Close 3 issues?", {
      isTTY: true,
      env: { CI: "true" },
      io: fakeIO("n"),
    });
    expect(decision).toBe("non-interactive");
  });

  it("proceeds non-interactively under LINEAR_NON_INTERACTIVE", async () => {
    const decision = await confirmGuard("Close 3 issues?", {
      isTTY: true,
      env: { LINEAR_NON_INTERACTIVE: "1" },
      io: fakeIO("n"),
    });
    expect(decision).toBe("non-interactive");
  });

  it("returns 'confirmed' when a TTY human answers yes", async () => {
    const io = fakeIO("y");
    const decision = await confirmGuard("Close 3 issues?", {
      io,
      isTTY: true,
      env: {},
    });
    expect(decision).toBe("confirmed");
    expect(io.asked[0]).toContain("Close 3 issues?");
  });

  it("returns 'confirmed' when a TTY human just hits Enter (default yes)", async () => {
    const decision = await confirmGuard("Close 3 issues?", {
      io: fakeIO(""),
      isTTY: true,
      env: {},
    });
    expect(decision).toBe("confirmed");
  });

  it("returns 'declined' when a TTY human answers no", async () => {
    const decision = await confirmGuard("Close 3 issues?", {
      io: fakeIO("n"),
      isTTY: true,
      env: {},
    });
    expect(decision).toBe("declined");
  });

  it("honors defaultYes:false so a bare Enter declines", async () => {
    const decision = await confirmGuard("Delete everything?", {
      io: fakeIO(""),
      isTTY: true,
      env: {},
      defaultYes: false,
    });
    expect(decision).toBe("declined");
  });

  it("does not close an injected IO (caller owns it)", async () => {
    const io = fakeIO("y");
    await confirmGuard("Close?", { io, isTTY: true, env: {} });
    expect(io.closed).toBe(0);
  });
});

describe("proceedConfirmed", () => {
  it("treats every decision except 'declined' as proceed", () => {
    const proceed: ConfirmDecision[] = [
      "forced",
      "non-interactive",
      "confirmed",
    ];
    for (const d of proceed) expect(proceedConfirmed(d)).toBe(true);
    expect(proceedConfirmed("declined")).toBe(false);
  });
});
