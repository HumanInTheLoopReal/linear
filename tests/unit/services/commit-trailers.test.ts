import { describe, expect, it } from "vitest";
import { parseCloseTrailers } from "../../../src/services/commit-trailers.js";

describe("parseCloseTrailers", () => {
  it("returns [] for empty input", () => {
    expect(parseCloseTrailers("")).toEqual([]);
    expect(parseCloseTrailers("   ")).toEqual([]);
  });

  it("returns [] when no close keyword is present", () => {
    expect(parseCloseTrailers("feat: add new feature")).toEqual([]);
    expect(parseCloseTrailers("ENG-1 alone in a sentence")).toEqual([]);
  });

  it("matches Closes / Fixes / Resolves and their tense variants", () => {
    expect(parseCloseTrailers("Closes ENG-1")).toEqual(["ENG-1"]);
    expect(parseCloseTrailers("Closed ENG-1")).toEqual(["ENG-1"]);
    expect(parseCloseTrailers("Close ENG-1")).toEqual(["ENG-1"]);
    expect(parseCloseTrailers("Fixes ENG-2")).toEqual(["ENG-2"]);
    expect(parseCloseTrailers("Fixed ENG-2")).toEqual(["ENG-2"]);
    expect(parseCloseTrailers("Fix ENG-2")).toEqual(["ENG-2"]);
    expect(parseCloseTrailers("Resolves ENG-3")).toEqual(["ENG-3"]);
    expect(parseCloseTrailers("Resolved ENG-3")).toEqual(["ENG-3"]);
    expect(parseCloseTrailers("Resolve ENG-3")).toEqual(["ENG-3"]);
  });

  it("is case-insensitive on the keyword", () => {
    expect(parseCloseTrailers("closes ENG-1")).toEqual(["ENG-1"]);
    expect(parseCloseTrailers("CLOSES ENG-1")).toEqual(["ENG-1"]);
    expect(parseCloseTrailers("Closes ENG-1")).toEqual(["ENG-1"]);
  });

  it("strips an optional `#` prefix from the identifier", () => {
    expect(parseCloseTrailers("Closes #ENG-1")).toEqual(["ENG-1"]);
    expect(parseCloseTrailers("Fixes #eng-7")).toEqual(["ENG-7"]);
  });

  it("uppercases the team prefix", () => {
    expect(parseCloseTrailers("Closes eng-1")).toEqual(["ENG-1"]);
    expect(parseCloseTrailers("Closes Lin-99")).toEqual(["LIN-99"]);
  });

  it("accepts an optional colon after the keyword", () => {
    expect(parseCloseTrailers("Closes: ENG-1")).toEqual(["ENG-1"]);
    expect(parseCloseTrailers("Fixes:  ENG-2")).toEqual(["ENG-2"]);
  });

  it("extracts multiple identifiers per keyword (comma-separated)", () => {
    expect(parseCloseTrailers("Closes ENG-1, ENG-2, ENG-3")).toEqual([
      "ENG-1",
      "ENG-2",
      "ENG-3",
    ]);
  });

  it("extracts multiple identifiers per keyword ('and'-separated)", () => {
    expect(parseCloseTrailers("Fixes ENG-1 and ENG-2")).toEqual([
      "ENG-1",
      "ENG-2",
    ]);
  });

  it("de-duplicates repeats across keywords while preserving first-seen order", () => {
    expect(
      parseCloseTrailers("Closes ENG-2\nFixes ENG-1\nResolves ENG-2"),
    ).toEqual(["ENG-2", "ENG-1"]);
  });

  it("extracts from a multi-line commit body / trailer block", () => {
    const message = [
      "feat(api): add /healthcheck endpoint",
      "",
      "Adds a lightweight /healthcheck for load balancers.",
      "",
      "Closes ENG-1",
      "Fixes ENG-2",
    ].join("\n");
    expect(parseCloseTrailers(message)).toEqual(["ENG-1", "ENG-2"]);
  });

  it("matches keywords appearing inside body sentences", () => {
    expect(parseCloseTrailers("This fixes ENG-1 finally.")).toEqual(["ENG-1"]);
    expect(parseCloseTrailers("Fixes ENG-1 and ENG-2.")).toEqual([
      "ENG-1",
      "ENG-2",
    ]);
  });

  it("ignores identifiers not preceded by a close keyword", () => {
    expect(parseCloseTrailers("ENG-1 mentioned only.\nCloses ENG-2")).toEqual([
      "ENG-2",
    ]);
  });

  it("ignores single-letter team prefixes (Linear uses 2+ letters)", () => {
    expect(parseCloseTrailers("Closes A-1")).toEqual([]);
    expect(parseCloseTrailers("Closes AB-1")).toEqual(["AB-1"]);
  });

  it("ignores zero-length numeric portion", () => {
    expect(parseCloseTrailers("Closes ENG-")).toEqual([]);
    expect(parseCloseTrailers("Closes ENG")).toEqual([]);
  });

  it("handles trailing punctuation cleanly", () => {
    expect(parseCloseTrailers("Closes ENG-1.")).toEqual(["ENG-1"]);
    expect(parseCloseTrailers("Closes ENG-1,")).toEqual(["ENG-1"]);
    expect(parseCloseTrailers("(Closes ENG-1)")).toEqual(["ENG-1"]);
  });
});
