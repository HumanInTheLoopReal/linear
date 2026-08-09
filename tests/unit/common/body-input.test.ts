import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveBodyInput,
  resolveDesignInput,
  resolveDualBodyInput,
  resolveReasonInput,
} from "../../../src/common/body-input.js";

describe("resolveBodyInput", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns undefined when no source is provided", () => {
    expect(resolveBodyInput({})).toBeUndefined();
  });

  it("returns the inline --description value when only it is set", () => {
    expect(resolveBodyInput({ description: "hello" })).toBe("hello");
  });

  it("returns the inline --body value when only it is set", () => {
    expect(resolveBodyInput({ body: "hi" })).toBe("hi");
  });

  it("returns the inline --content value when only it is set", () => {
    expect(resolveBodyInput({ content: "doc" })).toBe("doc");
  });

  it("preserves the empty string as a valid inline value", () => {
    // An empty body is a real user choice (clear a field), not 'no source'.
    expect(resolveBodyInput({ description: "" })).toBe("");
  });

  it("reads the file at --body-file when set", () => {
    const spy = vi.spyOn(fs, "readFileSync").mockReturnValue("from-file");
    expect(resolveBodyInput({ bodyFile: "/tmp/x.md" })).toBe("from-file");
    expect(spy).toHaveBeenCalledWith("/tmp/x.md", "utf8");
  });

  it("reads stdin when --body-file is '-'", () => {
    const spy = vi.spyOn(fs, "readFileSync").mockReturnValue("from-stdin");
    expect(resolveBodyInput({ bodyFile: "-" })).toBe("from-stdin");
    expect(spy).toHaveBeenCalledWith(0, "utf8");
  });

  it("reads stdin when --stdin is set", () => {
    const spy = vi.spyOn(fs, "readFileSync").mockReturnValue("from-stdin");
    expect(resolveBodyInput({ stdin: true })).toBe("from-stdin");
    expect(spy).toHaveBeenCalledWith(0, "utf8");
  });

  it("throws when --description and --body-file are both set", () => {
    expect(() =>
      resolveBodyInput({ description: "x", bodyFile: "/tmp/x" }),
    ).toThrow(/--description.*cannot be combined with --body-file/);
  });

  it("throws when --body and --stdin are both set", () => {
    expect(() => resolveBodyInput({ body: "x", stdin: true })).toThrow(
      /--body.*cannot be combined with --stdin/,
    );
  });

  it("throws and names every extra source when multiple are set", () => {
    expect(() =>
      resolveBodyInput({ description: "x", bodyFile: "/tmp/x", stdin: true }),
    ).toThrow(/--description.*--body-file.*--stdin/);
  });
});

describe("resolveDualBodyInput", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty object when no source is provided", () => {
    expect(resolveDualBodyInput({})).toEqual({});
  });

  it("returns inline values for each field independently", () => {
    expect(resolveDualBodyInput({ description: "d", content: "c" })).toEqual({
      description: "d",
      content: "c",
    });
  });

  it("reads description from --description-file path", () => {
    const spy = vi.spyOn(fs, "readFileSync").mockReturnValue("desc-from-file");
    expect(resolveDualBodyInput({ descriptionFile: "/tmp/d.md" })).toEqual({
      description: "desc-from-file",
    });
    expect(spy).toHaveBeenCalledWith("/tmp/d.md", "utf8");
  });

  it("reads content from --content-file path", () => {
    const spy = vi.spyOn(fs, "readFileSync").mockReturnValue("content-data");
    expect(resolveDualBodyInput({ contentFile: "/tmp/c.md" })).toEqual({
      content: "content-data",
    });
    expect(spy).toHaveBeenCalledWith("/tmp/c.md", "utf8");
  });

  it("reads description from stdin when --description-file is '-'", () => {
    const spy = vi.spyOn(fs, "readFileSync").mockReturnValue("from-stdin");
    expect(resolveDualBodyInput({ descriptionFile: "-" })).toEqual({
      description: "from-stdin",
    });
    expect(spy).toHaveBeenCalledWith(0, "utf8");
  });

  it("reads content from stdin when --content-file is '-'", () => {
    const spy = vi.spyOn(fs, "readFileSync").mockReturnValue("from-stdin");
    expect(resolveDualBodyInput({ contentFile: "-" })).toEqual({
      content: "from-stdin",
    });
    expect(spy).toHaveBeenCalledWith(0, "utf8");
  });

  it("allows mixing inline description with content from file", () => {
    vi.spyOn(fs, "readFileSync").mockReturnValue("c-from-file");
    expect(
      resolveDualBodyInput({ description: "d-inline", contentFile: "/tmp/c" }),
    ).toEqual({ description: "d-inline", content: "c-from-file" });
  });

  it("throws when --description and --description-file are both set", () => {
    expect(() =>
      resolveDualBodyInput({ description: "x", descriptionFile: "/tmp/d" }),
    ).toThrow(/--description.*cannot be combined with --description-file/);
  });

  it("throws when --content and --content-file are both set", () => {
    expect(() =>
      resolveDualBodyInput({ content: "x", contentFile: "/tmp/c" }),
    ).toThrow(/--content.*cannot be combined with --content-file/);
  });
});

describe("resolveReasonInput", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns undefined when no source is provided", () => {
    expect(resolveReasonInput({})).toBeUndefined();
  });

  it("returns the inline --reason value when only it is set", () => {
    expect(resolveReasonInput({ reason: "shipped" })).toBe("shipped");
  });

  it("preserves the empty string as a valid inline value", () => {
    expect(resolveReasonInput({ reason: "" })).toBe("");
  });

  it("reads the file at --reason-file when set", () => {
    const spy = vi.spyOn(fs, "readFileSync").mockReturnValue("from-file");
    expect(resolveReasonInput({ reasonFile: "/tmp/r.md" })).toBe("from-file");
    expect(spy).toHaveBeenCalledWith("/tmp/r.md", "utf8");
  });

  it("reads stdin when --reason-file is '-'", () => {
    const spy = vi.spyOn(fs, "readFileSync").mockReturnValue("from-stdin");
    expect(resolveReasonInput({ reasonFile: "-" })).toBe("from-stdin");
    expect(spy).toHaveBeenCalledWith(0, "utf8");
  });

  it("reads stdin when --reason-stdin is set", () => {
    const spy = vi.spyOn(fs, "readFileSync").mockReturnValue("from-stdin");
    expect(resolveReasonInput({ reasonStdin: true })).toBe("from-stdin");
    expect(spy).toHaveBeenCalledWith(0, "utf8");
  });

  it("throws when --reason and --reason-file are both set", () => {
    expect(() =>
      resolveReasonInput({ reason: "x", reasonFile: "/tmp/r" }),
    ).toThrow(/--reason.*cannot be combined with --reason-file/);
  });

  it("throws when --reason and --reason-stdin are both set", () => {
    expect(() =>
      resolveReasonInput({ reason: "x", reasonStdin: true }),
    ).toThrow(/--reason.*cannot be combined with --reason-stdin/);
  });

  it("throws when --reason-file and --reason-stdin are both set", () => {
    expect(() =>
      resolveReasonInput({ reasonFile: "/tmp/r", reasonStdin: true }),
    ).toThrow(/--reason-file.*cannot be combined with --reason-stdin/);
  });
});

describe("resolveDesignInput", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns undefined when no source is provided", () => {
    expect(resolveDesignInput({})).toBeUndefined();
  });

  it("returns the inline --design value when only it is set", () => {
    expect(resolveDesignInput({ design: "ADR-42 says X" })).toBe(
      "ADR-42 says X",
    );
  });

  it("preserves the empty string as a valid inline value", () => {
    expect(resolveDesignInput({ design: "" })).toBe("");
  });

  it("reads the file at --design-file when set", () => {
    const spy = vi.spyOn(fs, "readFileSync").mockReturnValue("from-file");
    expect(resolveDesignInput({ designFile: "/tmp/d.md" })).toBe("from-file");
    expect(spy).toHaveBeenCalledWith("/tmp/d.md", "utf8");
  });

  it("reads stdin when --design-file is '-'", () => {
    const spy = vi.spyOn(fs, "readFileSync").mockReturnValue("from-stdin");
    expect(resolveDesignInput({ designFile: "-" })).toBe("from-stdin");
    expect(spy).toHaveBeenCalledWith(0, "utf8");
  });

  it("reads stdin when --design-stdin is set", () => {
    const spy = vi.spyOn(fs, "readFileSync").mockReturnValue("from-stdin");
    expect(resolveDesignInput({ designStdin: true })).toBe("from-stdin");
    expect(spy).toHaveBeenCalledWith(0, "utf8");
  });

  it("throws when --design and --design-file are both set", () => {
    expect(() =>
      resolveDesignInput({ design: "x", designFile: "/tmp/d" }),
    ).toThrow(/--design.*cannot be combined with --design-file/);
  });

  it("throws when --design and --design-stdin are both set", () => {
    expect(() =>
      resolveDesignInput({ design: "x", designStdin: true }),
    ).toThrow(/--design.*cannot be combined with --design-stdin/);
  });

  it("throws when --design-file and --design-stdin are both set", () => {
    expect(() =>
      resolveDesignInput({ designFile: "/tmp/d", designStdin: true }),
    ).toThrow(/--design-file.*cannot be combined with --design-stdin/);
  });
});
