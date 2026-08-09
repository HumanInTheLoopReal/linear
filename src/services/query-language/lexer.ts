/**
 * Tokenizer for the `linear issues query <expr>` query language.
 *
 * Grammar essentials:
 *   field=value | field!=value | field<value | field<=value | field>value | field>=value
 *   AND / OR / NOT  (case-insensitive)
 *   ( ... )         grouping
 *   "..." / '...'   quoted string values
 *   7d / 24h / 2w   duration values
 */

export type TokenType =
  | "EOF"
  | "IDENT"
  | "STRING"
  | "NUMBER"
  | "DURATION"
  | "EQUALS"
  | "NOT_EQUALS"
  | "LESS"
  | "LESS_EQ"
  | "GREATER"
  | "GREATER_EQ"
  | "AND"
  | "OR"
  | "NOT"
  | "LPAREN"
  | "RPAREN"
  | "COMMA";

export interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

function isLetter(c: string): boolean {
  return /^[A-Za-z]$/.test(c);
}

function isDigit(c: string): boolean {
  return c >= "0" && c <= "9";
}

function isSpace(c: string): boolean {
  return c === " " || c === "\t" || c === "\n" || c === "\r";
}

function isIdentStart(c: string): boolean {
  // `*` / `?` may begin a value-position glob (`label=*-debt`); they are only
  // meaningful as label patterns, and a glob in a field position fails field
  // resolution downstream with a clear error. (lin-ym1m)
  return isLetter(c) || c === "_" || c === "*" || c === "?";
}

function isIdentChar(c: string): boolean {
  return (
    isLetter(c) ||
    isDigit(c) ||
    c === "_" ||
    c === "-" ||
    c === "." ||
    c === ":" ||
    // Glob wildcards so `label=type:*` / `label=*debt*` lex as one token.
    c === "*" ||
    c === "?"
  );
}

function isDurationSuffix(c: string): boolean {
  return "hdwmyHDWMY".includes(c);
}

export class Lexer {
  private pos = 0;

  constructor(private readonly input: string) {}

  private peekChar(): string {
    return this.pos < this.input.length ? this.input[this.pos] : "";
  }

  private nextChar(): string {
    if (this.pos >= this.input.length) return "";
    const c = this.input[this.pos];
    this.pos += 1;
    return c;
  }

  private skipWhitespace(): void {
    while (this.pos < this.input.length && isSpace(this.input[this.pos])) {
      this.pos += 1;
    }
  }

  nextToken(): Token {
    this.skipWhitespace();
    const startPos = this.pos;
    const c = this.nextChar();

    if (c === "") return { type: "EOF", value: "", pos: startPos };

    switch (c) {
      case "(":
        return { type: "LPAREN", value: "(", pos: startPos };
      case ")":
        return { type: "RPAREN", value: ")", pos: startPos };
      case ",":
        return { type: "COMMA", value: ",", pos: startPos };
      case "=":
        return { type: "EQUALS", value: "=", pos: startPos };
      case "!":
        if (this.peekChar() === "=") {
          this.nextChar();
          return { type: "NOT_EQUALS", value: "!=", pos: startPos };
        }
        throw new Error(
          `unexpected character '!' at position ${startPos} (did you mean '!=' or 'NOT'?)`,
        );
      case "<":
        if (this.peekChar() === "=") {
          this.nextChar();
          return { type: "LESS_EQ", value: "<=", pos: startPos };
        }
        return { type: "LESS", value: "<", pos: startPos };
      case ">":
        if (this.peekChar() === "=") {
          this.nextChar();
          return { type: "GREATER_EQ", value: ">=", pos: startPos };
        }
        return { type: "GREATER", value: ">", pos: startPos };
      case '"':
      case "'":
        return this.readString(c, startPos);
      default:
        if (isDigit(c) || c === "-" || c === "+") {
          this.pos -= 1;
          return this.readNumberOrDuration(startPos);
        }
        if (isIdentStart(c)) {
          this.pos -= 1;
          return this.readIdent(startPos);
        }
        throw new Error(`unexpected character '${c}' at position ${startPos}`);
    }
  }

  private readString(quote: string, startPos: number): Token {
    let out = "";
    while (true) {
      const c = this.nextChar();
      if (c === "") {
        throw new Error(`unterminated string starting at position ${startPos}`);
      }
      if (c === quote) {
        return { type: "STRING", value: out, pos: startPos };
      }
      if (c === "\\") {
        const escaped = this.nextChar();
        if (escaped === "") {
          throw new Error(
            `unterminated escape sequence at position ${this.pos - 1}`,
          );
        }
        switch (escaped) {
          case "n":
            out += "\n";
            break;
          case "t":
            out += "\t";
            break;
          case "\\":
            out += "\\";
            break;
          case '"':
            out += '"';
            break;
          case "'":
            out += "'";
            break;
          default:
            out += escaped;
        }
      } else {
        out += c;
      }
    }
  }

  private readNumberOrDuration(startPos: number): Token {
    let out = "";
    let c = this.nextChar();
    if (c === "-" || c === "+") {
      out += c;
      c = this.nextChar();
    }
    if (!isDigit(c)) {
      this.pos -= 1;
      throw new Error(`expected digit at position ${this.pos}`);
    }
    out += c;
    while (true) {
      c = this.nextChar();
      if (!isDigit(c)) break;
      out += c;
    }
    if (c !== "" && isDurationSuffix(c)) {
      out += c;
      return { type: "DURATION", value: out, pos: startPos };
    }
    if (c !== "") this.pos -= 1;
    return { type: "NUMBER", value: out, pos: startPos };
  }

  private readIdent(startPos: number): Token {
    let out = "";
    while (true) {
      const c = this.nextChar();
      if (c === "" || !isIdentChar(c)) {
        if (c !== "") this.pos -= 1;
        break;
      }
      out += c;
    }
    const upper = out.toUpperCase();
    if (upper === "AND") return { type: "AND", value: out, pos: startPos };
    if (upper === "OR") return { type: "OR", value: out, pos: startPos };
    if (upper === "NOT") return { type: "NOT", value: out, pos: startPos };
    return { type: "IDENT", value: out, pos: startPos };
  }
}

export function tokenize(input: string): Token[] {
  const lex = new Lexer(input);
  const out: Token[] = [];
  while (true) {
    const t = lex.nextToken();
    out.push(t);
    if (t.type === "EOF") break;
  }
  return out;
}
