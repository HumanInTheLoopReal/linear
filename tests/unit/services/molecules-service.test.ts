import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  formatVariablesBlock,
  getProto,
  listProtos,
  parseVariablesBlock,
  substituteVariables,
  topologicalSort,
  VARIABLES_HEADING,
} from "../../../src/services/molecules-service.js";
import { parseMoleculeToml } from "../../../src/services/molecules-toml.js";

describe("substituteVariables", () => {
  it("replaces {{key}} with the matching var value", () => {
    expect(substituteVariables("Audit {{pkg}}", { pkg: "src/foo" })).toBe(
      "Audit src/foo",
    );
  });

  it("supports {{ key }} (one space of padding)", () => {
    expect(substituteVariables("Audit {{ pkg }}", { pkg: "src/foo" })).toBe(
      "Audit src/foo",
    );
  });

  it("leaves unknown keys untouched", () => {
    expect(
      substituteVariables("Hi {{name}} and {{missing}}", { name: "x" }),
    ).toBe("Hi x and {{missing}}");
  });

  it("replaces every occurrence of the same key", () => {
    expect(substituteVariables("{{k}}/{{k}}/{{k}}", { k: "a" })).toBe("a/a/a");
  });

  it("ignores keys with characters outside [A-Za-z0-9_]", () => {
    // {{not a key}} contains a space — regex requires single-token keys
    expect(substituteVariables("{{not a key}}", { "not a key": "x" })).toBe(
      "{{not a key}}",
    );
  });
});

describe("topologicalSort", () => {
  it("orders issues so dependencies appear before dependents", () => {
    const out = topologicalSort([
      { key: "verify", title: "v", depends_on: ["execute"] },
      { key: "execute", title: "e", depends_on: ["plan"] },
      { key: "plan", title: "p", depends_on: ["audit"] },
      { key: "audit", title: "a" },
    ]);
    expect(out.map((i) => i.key)).toEqual([
      "audit",
      "plan",
      "execute",
      "verify",
    ]);
  });

  it("preserves issues with no dependencies in input order", () => {
    const out = topologicalSort([
      { key: "a", title: "a" },
      { key: "b", title: "b" },
      { key: "c", title: "c" },
    ]);
    expect(out.map((i) => i.key)).toEqual(["a", "b", "c"]);
  });

  it("throws on a cycle", () => {
    expect(() =>
      topologicalSort([
        { key: "a", title: "a", depends_on: ["b"] },
        { key: "b", title: "b", depends_on: ["a"] },
      ]),
    ).toThrow(/cycle/i);
  });

  it("throws when a depends_on references an unknown key", () => {
    expect(() =>
      topologicalSort([{ key: "a", title: "a", depends_on: ["ghost"] }]),
    ).toThrow(/unknown key/);
  });
});

describe("parseMoleculeToml", () => {
  it("parses a minimal proto", () => {
    const proto = parseMoleculeToml(
      `name = "x"\n[[issues]]\nkey = "k"\ntitle = "t"\n`,
      "/tmp/x.toml",
    );
    expect(proto.name).toBe("x");
    expect(proto.issues).toHaveLength(1);
    expect(proto.issues[0]).toMatchObject({ key: "k", title: "t" });
    expect(proto.source).toBe("/tmp/x.toml");
  });

  it("throws when name is missing", () => {
    expect(() =>
      parseMoleculeToml(`[[issues]]\nkey = "k"\ntitle = "t"\n`, "/tmp/x.toml"),
    ).toThrow(/missing required `name`/);
  });

  it("throws when an issue is missing key or title", () => {
    expect(() =>
      parseMoleculeToml(`name = "x"\n[[issues]]\nkey = "k"\n`, "/tmp/x.toml"),
    ).toThrow(/missing `key` or `title`/);
  });

  it("includes the source path in TOML syntax errors", () => {
    expect(() => parseMoleculeToml("name = ", "/tmp/x.toml")).toThrow(
      /invalid TOML in \/tmp\/x.toml/,
    );
  });
});

describe("listProtos / getProto (with temp search paths)", () => {
  let tmpProject: string;
  let tmpUser: string;
  let tmpBuiltin: string;

  beforeEach(() => {
    tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), "mol-proj-"));
    tmpUser = fs.mkdtempSync(path.join(os.tmpdir(), "mol-user-"));
    tmpBuiltin = fs.mkdtempSync(path.join(os.tmpdir(), "mol-builtin-"));
  });

  afterEach(() => {
    fs.rmSync(tmpProject, { recursive: true, force: true });
    fs.rmSync(tmpUser, { recursive: true, force: true });
    fs.rmSync(tmpBuiltin, { recursive: true, force: true });
  });

  function writeProto(dir: string, name: string, body: string) {
    fs.writeFileSync(path.join(dir, `${name}.toml`), body);
  }

  it("enumerates protos across all supplied dirs", () => {
    writeProto(tmpProject, "a", 'name = "a"\n');
    writeProto(tmpUser, "b", 'name = "b"\n');
    writeProto(tmpBuiltin, "c", 'name = "c"\n');

    const protos = listProtos([tmpProject, tmpUser, tmpBuiltin]);
    expect(protos.map((p) => p.name).sort()).toEqual(["a", "b", "c"]);
  });

  it("project shadows user shadows builtin (first-occurrence wins)", () => {
    writeProto(
      tmpProject,
      "shared",
      'name = "shared"\ndescription = "project"\n',
    );
    writeProto(tmpUser, "shared", 'name = "shared"\ndescription = "user"\n');
    writeProto(
      tmpBuiltin,
      "shared",
      'name = "shared"\ndescription = "builtin"\n',
    );

    const protos = listProtos([tmpProject, tmpUser, tmpBuiltin]);
    expect(protos).toHaveLength(1);
    expect(protos[0].description).toBe("project");
  });

  it("user shadows builtin when project has no entry", () => {
    writeProto(tmpUser, "shared", 'name = "shared"\ndescription = "user"\n');
    writeProto(
      tmpBuiltin,
      "shared",
      'name = "shared"\ndescription = "builtin"\n',
    );

    const protos = listProtos([tmpProject, tmpUser, tmpBuiltin]);
    expect(protos[0].description).toBe("user");
  });

  it("skips non-TOML files in the dir", () => {
    writeProto(tmpProject, "x", 'name = "x"\n');
    fs.writeFileSync(path.join(tmpProject, "README.md"), "noop");
    fs.writeFileSync(path.join(tmpProject, "x.json"), "{}");

    const protos = listProtos([tmpProject]);
    expect(protos.map((p) => p.name)).toEqual(["x"]);
  });

  it("treats missing search dirs as empty (no error)", () => {
    const protos = listProtos([path.join(tmpProject, "does-not-exist")]);
    expect(protos).toEqual([]);
  });

  it("getProto returns undefined for unknown names", () => {
    writeProto(tmpProject, "x", 'name = "x"\n');
    expect(getProto("ghost", [tmpProject])).toBeUndefined();
    expect(getProto("x", [tmpProject])?.name).toBe("x");
  });
});

describe("bundled builtin protos (sanity check)", () => {
  it("listProtos() default paths includes the three bundled starters", () => {
    const protos = listProtos();
    const names = new Set(protos.map((p) => p.name));
    expect(names.has("refactor-package")).toBe(true);
    expect(names.has("feature-with-tests")).toBe(true);
    expect(names.has("bug-investigation")).toBe(true);
  });

  it("each bundled starter has a description and at least one issue", () => {
    for (const name of [
      "refactor-package",
      "feature-with-tests",
      "bug-investigation",
    ]) {
      const proto = getProto(name);
      expect(proto, `expected to find proto ${name}`).toBeDefined();
      expect(proto?.description).toBeTruthy();
      expect((proto?.issues.length ?? 0) > 0).toBe(true);
    }
  });

  it("topologicalSort succeeds on every bundled starter (no cycles)", () => {
    for (const name of [
      "refactor-package",
      "feature-with-tests",
      "bug-investigation",
    ]) {
      const proto = getProto(name);
      expect(() => topologicalSort(proto?.issues ?? [])).not.toThrow();
    }
  });
});

describe("formatVariablesBlock / parseVariablesBlock (round-trip)", () => {
  it("formats with `## Variables` heading + `- key: value` lines", () => {
    const out = formatVariablesBlock({ pkg: "src/foo", owner: "fk" });
    expect(out).toContain(VARIABLES_HEADING);
    expect(out).toContain("- pkg: src/foo");
    expect(out).toContain("- owner: fk");
  });
  it("returns empty string for an empty map", () => {
    expect(formatVariablesBlock({})).toBe("");
  });
  it("parses back what it formats (round-trip)", () => {
    const vars = { pkg: "src/issues", owner: "fahad" };
    const text = formatVariablesBlock(vars);
    expect(parseVariablesBlock(text)).toEqual(vars);
  });
  it("ignores other markdown content around the block", () => {
    const desc = [
      "# Title",
      "Some narrative.",
      "",
      "## Variables",
      "",
      "- a: 1",
      "- b: 2",
      "",
      "## Notes",
      "- not a var",
    ].join("\n");
    expect(parseVariablesBlock(desc)).toEqual({ a: "1", b: "2" });
  });
  it("returns {} when the description has no `## Variables` block", () => {
    expect(parseVariablesBlock("# Title\n\nNo block here.")).toEqual({});
  });
  it("returns {} for null/undefined input", () => {
    expect(parseVariablesBlock(null)).toEqual({});
    expect(parseVariablesBlock(undefined)).toEqual({});
  });
});
