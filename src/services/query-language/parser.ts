/**
 * Recursive-descent parser for the query expression language.
 *
 * Grammar:
 *   expr      := or
 *   or        := and (OR and)*
 *   and       := not (AND not)*
 *   not       := NOT not | primary
 *   primary   := '(' or ')' | comparison
 *   comparison:= IDENT op value
 *   op        := '=' | '!=' | '<' | '<=' | '>' | '>='
 *   value     := IDENT | STRING | NUMBER | DURATION
 */

import { Lexer, type Token, type TokenType } from "./lexer.js";

export type ComparisonOp = "=" | "!=" | "<" | "<=" | ">" | ">=";

export type ValueKind = "IDENT" | "STRING" | "NUMBER" | "DURATION";

export interface ComparisonNode {
  kind: "comparison";
  /** Canonical (lower-cased) field name, used for field resolution. */
  field: string;
  /**
   * The field exactly as typed (original case). Field resolution uses the
   * lower-cased `field`, but a `metadata.<key>` filter needs the original
   * case because JSON metadata keys are case-sensitive. (lin-ov30.1)
   */
  fieldRaw: string;
  op: ComparisonOp;
  value: string;
  valueKind: ValueKind;
}

export interface AndNode {
  kind: "and";
  left: Node;
  right: Node;
}

export interface OrNode {
  kind: "or";
  left: Node;
  right: Node;
}

export interface NotNode {
  kind: "not";
  operand: Node;
}

export type Node = ComparisonNode | AndNode | OrNode | NotNode;

const OP_BY_TOKEN: Partial<Record<TokenType, ComparisonOp>> = {
  EQUALS: "=",
  NOT_EQUALS: "!=",
  LESS: "<",
  LESS_EQ: "<=",
  GREATER: ">",
  GREATER_EQ: ">=",
};

const VALUE_KIND_BY_TOKEN: Partial<Record<TokenType, ValueKind>> = {
  IDENT: "IDENT",
  STRING: "STRING",
  NUMBER: "NUMBER",
  DURATION: "DURATION",
};

class Parser {
  private lex: Lexer;
  private current: Token;

  constructor(input: string) {
    this.lex = new Lexer(input);
    this.current = this.lex.nextToken();
  }

  parse(): Node {
    if (this.current.type === "EOF") {
      throw new Error("empty query");
    }
    const node = this.parseOr();
    if ((this.current.type as TokenType) !== "EOF") {
      throw new Error(
        `unexpected token '${this.current.value}' at position ${this.current.pos} (expected end of query)`,
      );
    }
    return node;
  }

  private advance(): void {
    this.current = this.lex.nextToken();
  }

  private parseOr(): Node {
    let left = this.parseAnd();
    while (this.current.type === "OR") {
      this.advance();
      const right = this.parseAnd();
      left = { kind: "or", left, right };
    }
    return left;
  }

  private parseAnd(): Node {
    let left = this.parseNot();
    while (this.current.type === "AND") {
      this.advance();
      const right = this.parseNot();
      left = { kind: "and", left, right };
    }
    return left;
  }

  private parseNot(): Node {
    if (this.current.type === "NOT") {
      this.advance();
      const operand = this.parseNot();
      return { kind: "not", operand };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Node {
    if (this.current.type === "LPAREN") {
      this.advance();
      const node = this.parseOr();
      if ((this.current.type as TokenType) !== "RPAREN") {
        throw new Error(
          `expected ')' at position ${this.current.pos}, got ${this.current.type}`,
        );
      }
      this.advance();
      return node;
    }
    return this.parseComparison();
  }

  private parseComparison(): ComparisonNode {
    if (this.current.type !== "IDENT") {
      throw new Error(
        `expected field name at position ${this.current.pos}, got ${this.current.type}`,
      );
    }
    const fieldRaw = this.current.value;
    const field = fieldRaw.toLowerCase();
    this.advance();

    const op = OP_BY_TOKEN[this.current.type];
    if (!op) {
      throw new Error(
        `expected comparison operator at position ${this.current.pos}, got ${this.current.type}`,
      );
    }
    this.advance();

    const kind = VALUE_KIND_BY_TOKEN[this.current.type];
    if (!kind) {
      throw new Error(
        `expected value at position ${this.current.pos}, got ${this.current.type}`,
      );
    }
    const node: ComparisonNode = {
      kind: "comparison",
      field,
      fieldRaw,
      op,
      value: this.current.value,
      valueKind: kind,
    };
    this.advance();
    return node;
  }
}

export function parseQuery(input: string): Node {
  return new Parser(input).parse();
}

export function astToString(node: Node): string {
  switch (node.kind) {
    case "comparison":
      return `${node.field}${node.op}${node.value}`;
    case "and":
      return `(${astToString(node.left)} AND ${astToString(node.right)})`;
    case "or":
      return `(${astToString(node.left)} OR ${astToString(node.right)})`;
    case "not":
      return `NOT ${astToString(node.operand)}`;
  }
}

export function hasExplicitStatusFilter(node: Node): boolean {
  switch (node.kind) {
    case "comparison":
      return node.field === "status";
    case "and":
    case "or":
      return (
        hasExplicitStatusFilter(node.left) ||
        hasExplicitStatusFilter(node.right)
      );
    case "not":
      return hasExplicitStatusFilter(node.operand);
  }
}
