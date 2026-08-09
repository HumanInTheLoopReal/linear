import { describe, expect, it } from "vitest";
import {
  applyMetadataEdits,
  extractMetadata,
  mergeMetadata,
  parseMetadataJson,
  serializeMetadataBlock,
  stripMetadataBlock,
  withMetadataBlock,
} from "../../../src/common/metadata-block.js";

describe("parseMetadataJson (lin-e64s)", () => {
  it("accepts a JSON object", () => {
    expect(parseMetadataJson('{"a":1,"b":"x"}')).toEqual({ a: 1, b: "x" });
  });

  it("rejects invalid JSON", () => {
    expect(() => parseMetadataJson("{not json")).toThrow(/must be valid JSON/);
  });

  it("rejects non-object JSON (array / scalar)", () => {
    expect(() => parseMetadataJson("[1,2]")).toThrow(/must be a JSON object/);
    expect(() => parseMetadataJson("42")).toThrow(/must be a JSON object/);
  });
});

describe("extractMetadata / stripMetadataBlock round-trip", () => {
  const body = "The real description.\n\nMore body.";
  const withBlock = `${body}\n\n\`\`\`metadata\n{\n  "run_id": "abc"\n}\n\`\`\``;

  it("extracts the parsed object from a fenced block", () => {
    expect(extractMetadata(withBlock)).toEqual({ run_id: "abc" });
  });

  it("returns null when there is no block", () => {
    expect(extractMetadata(body)).toBeNull();
    expect(extractMetadata("")).toBeNull();
    expect(extractMetadata(null)).toBeNull();
  });

  it("returns null for a malformed block (lenient read)", () => {
    const bad = "x\n\n```metadata\n{not json\n```";
    expect(extractMetadata(bad)).toBeNull();
  });

  it("strips the block back to the human body", () => {
    expect(stripMetadataBlock(withBlock)).toBe(body);
  });

  it("strip is a no-op when there is no block", () => {
    expect(stripMetadataBlock(body)).toBe(body);
  });
});

describe("serializeMetadataBlock", () => {
  it("emits a fenced block with sorted keys (stable diffs)", () => {
    const block = serializeMetadataBlock({ b: 2, a: 1 });
    expect(block).toBe('```metadata\n{\n  "a": 1,\n  "b": 2\n}\n```');
  });
});

describe("withMetadataBlock", () => {
  it("appends the block after the body", () => {
    const out = withMetadataBlock("Body", { a: 1 });
    expect(out).toBe('Body\n\n```metadata\n{\n  "a": 1\n}\n```');
    expect(extractMetadata(out)).toEqual({ a: 1 });
  });

  it("replaces an existing block rather than stacking", () => {
    const first = withMetadataBlock("Body", { a: 1 });
    const second = withMetadataBlock(first, { a: 2, b: 3 });
    expect((second.match(/```metadata/g) ?? []).length).toBe(1);
    expect(extractMetadata(second)).toEqual({ a: 2, b: 3 });
  });

  it("removes the block when metadata is null or empty", () => {
    const withIt = withMetadataBlock("Body", { a: 1 });
    expect(withMetadataBlock(withIt, null)).toBe("Body");
    expect(withMetadataBlock(withIt, {})).toBe("Body");
  });

  it("emits only the block when the body is empty", () => {
    expect(withMetadataBlock("", { a: 1 })).toBe(
      '```metadata\n{\n  "a": 1\n}\n```',
    );
  });
});

describe("mergeMetadata", () => {
  it("shallow-merges incoming over existing", () => {
    expect(mergeMetadata({ a: 1, b: 2 }, { b: 3, c: 4 })).toEqual({
      a: 1,
      b: 3,
      c: 4,
    });
  });

  it("treats null existing as empty", () => {
    expect(mergeMetadata(null, { a: 1 })).toEqual({ a: 1 });
  });
});

describe("applyMetadataEdits", () => {
  it("sets key=value, coercing JSON types (number/bool), else string", () => {
    expect(
      applyMetadataEdits(null, ["count=5", "ok=true", "name=foo"], []),
    ).toEqual({ count: 5, ok: true, name: "foo" });
  });

  it("unsets keys", () => {
    expect(applyMetadataEdits({ a: 1, b: 2 }, [], ["a"])).toEqual({ b: 2 });
  });

  it("applies sets then unsets over existing", () => {
    expect(
      applyMetadataEdits({ a: 1, keep: 9 }, ["a=2", "c=3"], ["keep"]),
    ).toEqual({ a: 2, c: 3 });
  });

  it("rejects a set without key=value", () => {
    expect(() => applyMetadataEdits(null, ["noequals"], [])).toThrow(
      /expected key=value/,
    );
    expect(() => applyMetadataEdits(null, ["=novalue"], [])).toThrow(
      /expected key=value/,
    );
  });
});
