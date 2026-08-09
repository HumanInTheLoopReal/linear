import { describe, expect, it, vi } from "vitest";
import {
  outputResult,
  outputSuccess,
  parseFieldsList,
  pickFields,
  resolveOutputMode,
} from "../../../src/common/output.js";

function captureStdout(run: () => void): string {
  const lines: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((value: unknown) => {
    lines.push(String(value));
  });
  const write = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((value: unknown) => {
      lines.push(String(value));
      return true;
    });
  try {
    run();
  } finally {
    log.mockRestore();
    write.mockRestore();
  }
  return lines.join("");
}

describe("parseFieldsList", () => {
  it("splits, trims, and drops empty segments", () => {
    expect(parseFieldsList("id, state.name ,, title")).toEqual([
      "id",
      "state.name",
      "title",
    ]);
  });

  it("returns an empty list for an empty value", () => {
    expect(parseFieldsList("")).toEqual([]);
    expect(parseFieldsList("  ,  ")).toEqual([]);
  });
});

describe("pickFields", () => {
  it("keeps only the named top-level keys", () => {
    const picked = pickFields({ id: "1", title: "T", body: "B" }, [
      ["id"],
      ["title"],
    ]);
    expect(picked).toEqual({ id: "1", title: "T" });
  });

  it("descends dot-paths and preserves nesting", () => {
    const picked = pickFields(
      { id: "1", state: { name: "Done", type: "completed", id: "s1" } },
      [["state", "name"]],
    );
    expect(picked).toEqual({ state: { name: "Done" } });
  });

  it("maps across arrays mid-path", () => {
    const picked = pickFields(
      {
        nodes: [
          { identifier: "ENG-1", title: "A", extra: 1 },
          { identifier: "ENG-2", title: "B", extra: 2 },
        ],
      },
      [["nodes", "identifier"]],
    );
    expect(picked).toEqual({
      nodes: [{ identifier: "ENG-1" }, { identifier: "ENG-2" }],
    });
  });

  it("keeps the whole subtree when a path stops at it", () => {
    const picked = pickFields({ state: { name: "Done", id: "s1" }, x: 1 }, [
      ["state"],
    ]);
    expect(picked).toEqual({ state: { name: "Done", id: "s1" } });
  });

  // `--fields nodes,nodes.identifier` asks for the whole node plus one of its
  // keys; the broader request has to win, in either argument order.
  it("lets a bare path outrank a narrower sibling", () => {
    const payload = { nodes: [{ identifier: "ENG-1", title: "A" }] };
    const whole = { nodes: [{ identifier: "ENG-1", title: "A" }] };

    expect(pickFields(payload, [["nodes"], ["nodes", "identifier"]])).toEqual(
      whole,
    );
    expect(pickFields(payload, [["nodes", "identifier"], ["nodes"]])).toEqual(
      whole,
    );
  });

  it("lets a bare path outrank a narrower sibling at depth", () => {
    const payload = { issue: { state: { name: "Done", id: "s1" }, id: "i1" } };

    expect(
      pickFields(payload, [
        ["issue", "state", "name"],
        ["issue", "state"],
      ]),
    ).toEqual({ issue: { state: { name: "Done", id: "s1" } } });
  });

  it("skips missing keys instead of emitting null", () => {
    expect(pickFields({ id: "1" }, [["id"], ["nope"]])).toEqual({ id: "1" });
  });

  it("ignores inherited members", () => {
    expect(pickFields({ id: "1" }, [["constructor"], ["toString"]])).toEqual(
      {},
    );
  });

  it("does not invoke the prototype setter for __proto__", () => {
    const picked = pickFields(JSON.parse('{"__proto__": {"polluted": true}}'), [
      ["__proto__"],
    ]) as Record<string, unknown>;
    expect(Object.hasOwn(picked, "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(picked)).toBe(Object.prototype);
  });

  it("returns scalars untouched when a path runs past them", () => {
    expect(pickFields({ id: "1" }, [["id", "deeper"]])).toEqual({ id: "1" });
    expect(pickFields(null, [["id"]])).toBeNull();
  });
});

describe("resolveOutputMode", () => {
  it("stays on the text path with no flags", () => {
    expect(resolveOutputMode({})).toBeNull();
  });

  it("treats --compact as implying JSON", () => {
    expect(resolveOutputMode({ compact: true })).toBe("compact");
  });

  it("lets --compact override --json=pretty", () => {
    expect(resolveOutputMode({ json: "pretty", compact: true })).toBe(
      "compact",
    );
  });

  it("treats --fields as implying pretty JSON", () => {
    expect(resolveOutputMode({ fields: ["id"] })).toBe("pretty");
  });

  it("keeps an explicit json mode when --fields is also set", () => {
    expect(resolveOutputMode({ json: "compact", fields: ["id"] })).toBe(
      "compact",
    );
  });

  it("ignores an empty --fields list", () => {
    expect(resolveOutputMode({ fields: [] })).toBeNull();
  });
});

describe("outputSuccess", () => {
  it("projects fields before serializing", () => {
    const out = captureStdout(() =>
      outputSuccess({ id: "1", title: "T" }, "compact", ["id"]),
    );
    expect(out).toBe('{"id":"1"}');
  });

  it("emits the full payload when no fields are given", () => {
    const out = captureStdout(() =>
      outputSuccess({ id: "1", title: "T" }, "compact"),
    );
    expect(out).toBe('{"id":"1","title":"T"}');
  });
});

describe("outputResult", () => {
  it("uses the text formatter when no output flags are set", () => {
    const out = captureStdout(() =>
      outputResult({ id: "1" }, () => "plain text", {}),
    );
    expect(out).toBe("plain text\n");
  });

  it("switches to single-line JSON for --compact alone", () => {
    const out = captureStdout(() =>
      outputResult({ id: "1", title: "T" }, () => "plain text", {
        compact: true,
      }),
    );
    expect(out).toBe('{"id":"1","title":"T"}');
  });

  it("switches to JSON and narrows for --fields alone", () => {
    const out = captureStdout(() =>
      outputResult(
        { nodes: [{ identifier: "ENG-1", title: "A" }] },
        () => "plain text",
        { fields: ["nodes.identifier"] },
      ),
    );
    expect(out).toBe(
      '{\n  "nodes": [\n    {\n      "identifier": "ENG-1"\n    }\n  ]\n}',
    );
  });

  it("combines --compact and --fields", () => {
    const out = captureStdout(() =>
      outputResult(
        { nodes: [{ identifier: "ENG-1", title: "A" }] },
        () => "plain text",
        { compact: true, fields: ["nodes.identifier"] },
      ),
    );
    expect(out).toBe('{"nodes":[{"identifier":"ENG-1"}]}');
  });
});
