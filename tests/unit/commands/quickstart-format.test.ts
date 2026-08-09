//
// Format tests for `linear quickstart`. Text-default in linear (was JSON-default,
// flipped under lin-zxgm). Output is the static content block + a single trailing
// newline. The `--json` envelope is the legacy `{content, deprecated, see_also}`
// shape, validated by the global --json dispatcher path.

import { describe, expect, it } from "vitest";
import { formatQuickstart } from "../../../src/commands/quickstart.js";

describe("formatQuickstart", () => {
  function makeResult() {
    return {
      content:
        "linear — CLI for Linear.app (human-readable text by default, --json for agents)\n\nGETTING STARTED\n  linear auth login           Store your Linear API token",
      deprecated: true,
      see_also: ["prime", "onboard"],
    };
  }

  it("emits the content block verbatim", () => {
    const out = formatQuickstart(makeResult());
    expect(out).toContain("CLI for Linear.app");
    expect(out).toContain("GETTING STARTED");
    expect(out).toContain("  linear auth login");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatQuickstart(makeResult());
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});
