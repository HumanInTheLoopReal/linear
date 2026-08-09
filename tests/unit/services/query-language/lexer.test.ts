import { describe, expect, it } from "vitest";
import { tokenize } from "../../../../src/services/query-language/lexer.js";

describe("lexer", () => {
  it("tokenizes a basic comparison", () => {
    const toks = tokenize("status=open");
    expect(toks.map((t) => t.type)).toEqual([
      "IDENT",
      "EQUALS",
      "IDENT",
      "EOF",
    ]);
    expect(toks[0].value).toBe("status");
    expect(toks[2].value).toBe("open");
  });

  it("tokenizes an unquoted label glob as one IDENT value (lin-ym1m)", () => {
    const toks = tokenize("label=type:*");
    expect(toks.map((t) => t.type)).toEqual([
      "IDENT",
      "EQUALS",
      "IDENT",
      "EOF",
    ]);
    expect(toks[2].value).toBe("type:*");
  });

  it("tokenizes a leading-star glob value (lin-ym1m)", () => {
    const toks = tokenize("label=*debt*");
    expect(toks[2].type).toBe("IDENT");
    expect(toks[2].value).toBe("*debt*");
  });

  it("recognizes all comparison operators", () => {
    const toks = tokenize("a=1 b!=2 c<3 d<=4 e>5 f>=6");
    const types = toks.map((t) => t.type);
    expect(types).toContain("EQUALS");
    expect(types).toContain("NOT_EQUALS");
    expect(types).toContain("LESS");
    expect(types).toContain("LESS_EQ");
    expect(types).toContain("GREATER");
    expect(types).toContain("GREATER_EQ");
  });

  it("recognizes AND/OR/NOT as keywords case-insensitively", () => {
    const toks = tokenize("a=1 and b=2 OR c=3 Not d=4");
    const types = toks.map((t) => t.type);
    expect(types).toContain("AND");
    expect(types).toContain("OR");
    expect(types).toContain("NOT");
  });

  it("handles parentheses and tokenizes grouping", () => {
    const toks = tokenize("(a=1)");
    expect(toks.map((t) => t.type)).toEqual([
      "LPAREN",
      "IDENT",
      "EQUALS",
      "NUMBER",
      "RPAREN",
      "EOF",
    ]);
  });

  it("emits DURATION tokens for relative dates", () => {
    const toks = tokenize("updated>7d");
    expect(toks[2]).toMatchObject({ type: "DURATION", value: "7d" });
  });

  it("emits STRING tokens for double- and single-quoted values", () => {
    const toks = tokenize(`title="hello world" desc='foo'`);
    expect(toks[2]).toMatchObject({ type: "STRING", value: "hello world" });
    expect(toks[5]).toMatchObject({ type: "STRING", value: "foo" });
  });

  it("allows colon-namespaced labels as bare idents", () => {
    const toks = tokenize("label=type:bug");
    expect(toks[2]).toMatchObject({ type: "IDENT", value: "type:bug" });
  });

  it("throws on bare '!' that isn't part of '!='", () => {
    expect(() => tokenize("a!b")).toThrow(/unexpected character '!'/);
  });

  it("throws on unterminated strings", () => {
    expect(() => tokenize('a="unclosed')).toThrow(/unterminated string/);
  });
});
