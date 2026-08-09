//
// Format tests for the documents suite (list / read / create / update / delete).
//
//   list (empty)     → `\n📄 No documents found.\n\n`
//   list (populated) → `📄 Documents (N):` + indented rows
//   read             → `[icon ]<title>` + Created/Updated/URL + body content
//   create / update  → `<Verb> document <id-prefix>: <title>`
//   delete           → `Deleted document <id-prefix>`

import { describe, expect, it } from "vitest";
import {
  formatDocumentCreate,
  formatDocumentDelete,
  formatDocumentList,
  formatDocumentRead,
  formatDocumentUpdate,
} from "../../../src/commands/documents.js";

describe("formatDocumentList", () => {
  it("renders the empty-state hint", () => {
    expect(formatDocumentList({ nodes: [] })).toBe(
      "\n📄 No documents found.\n\n",
    );
  });

  it("renders a row per doc with id-prefix, title, updated date", () => {
    const out = formatDocumentList({
      nodes: [
        {
          id: "abcd1234-0000-0000-0000-000000000001",
          title: "Design Doc",
          updatedAt: "2026-05-01T12:00:00.000Z",
        },
      ],
    });
    expect(out).toContain("📄 Documents (1):\n");
    expect(out).toContain("  abcd1234  Design Doc  (updated 2026-05-01)\n");
  });

  it("prepends icon when present", () => {
    const out = formatDocumentList({
      nodes: [
        {
          id: "abcd1234-0000-0000-0000-000000000001",
          title: "Notes",
          updatedAt: "2026-05-01",
          icon: "📝",
        },
      ],
    });
    expect(out).toContain("  abcd1234  📝 Notes  (updated 2026-05-01)\n");
  });

  it("falls back to `(unknown)` for missing updatedAt", () => {
    const out = formatDocumentList({
      nodes: [
        {
          id: "abcd1234-0000-0000-0000-000000000001",
          title: "X",
          updatedAt: null,
        },
      ],
    });
    expect(out).toContain("(updated (unknown))");
  });

  it("ends with trailing blank-line separator (mirrors attachments)", () => {
    const out = formatDocumentList({
      nodes: [
        {
          id: "abcd1234-0000-0000-0000-000000000001",
          title: "X",
          updatedAt: "2026-05-01",
        },
      ],
    });
    expect(out.endsWith("\n\n")).toBe(true);
    expect(out.endsWith("\n\n\n")).toBe(false);
  });
});

describe("formatDocumentRead", () => {
  function makeDoc(
    overrides: Partial<Parameters<typeof formatDocumentRead>[0]> = {},
  ) {
    return {
      id: "abcd1234-0000-0000-0000-000000000001",
      title: "Design Doc",
      content: "# Heading\n\nBody paragraph.",
      createdAt: "2026-03-01T10:00:00.000Z",
      updatedAt: "2026-05-01T12:00:00.000Z",
      url: "https://linear.app/workspace/document/design-doc-abc123",
      ...overrides,
    };
  }

  it("renders the title as the first line", () => {
    const out = formatDocumentRead(makeDoc());
    expect(out.startsWith("Design Doc\n")).toBe(true);
  });

  it("prepends icon when present", () => {
    const out = formatDocumentRead(makeDoc({ icon: "📝" }));
    expect(out.startsWith("📝 Design Doc\n")).toBe(true);
  });

  it("renders Created/Updated as YYYY-MM-DD", () => {
    const out = formatDocumentRead(makeDoc());
    expect(out).toContain("Created: 2026-03-01 · Updated: 2026-05-01\n");
  });

  it("renders URL line when present", () => {
    const out = formatDocumentRead(makeDoc());
    expect(out).toContain(
      "URL: https://linear.app/workspace/document/design-doc-abc123\n",
    );
  });

  it("omits URL line when missing", () => {
    expect(formatDocumentRead(makeDoc({ url: null }))).not.toContain("URL:");
  });

  it("renders body content after a blank-line separator", () => {
    const out = formatDocumentRead(makeDoc());
    expect(out).toContain("\n\n# Heading\n\nBody paragraph.\n");
  });

  it("omits body block when content is empty/null", () => {
    const out = formatDocumentRead(makeDoc({ content: null }));
    expect(out).not.toContain("\n\n");
    // (only one trailing \n)
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatDocumentRead(makeDoc({ content: null, url: null }));
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

describe("formatDocumentCreate / formatDocumentUpdate", () => {
  const row = {
    id: "abcd1234-0000-0000-0000-000000000001",
    title: "Design Doc",
  };

  it("formatDocumentCreate renders `Created document <id-prefix>: <title>`", () => {
    expect(formatDocumentCreate(row)).toBe(
      "Created document abcd1234: Design Doc\n",
    );
  });

  it("formatDocumentUpdate renders `Updated document <id-prefix>: <title>`", () => {
    expect(formatDocumentUpdate(row)).toBe(
      "Updated document abcd1234: Design Doc\n",
    );
  });

  it("falls back to (untitled) when title is missing", () => {
    expect(
      formatDocumentCreate({
        id: "abcd1234-0000-0000-0000-000000000001",
      }),
    ).toBe("Created document abcd1234: (untitled)\n");
  });

  it("both formatters end with exactly one trailing newline", () => {
    for (const out of [formatDocumentCreate(row), formatDocumentUpdate(row)]) {
      expect(out.endsWith("\n")).toBe(true);
      expect(out.endsWith("\n\n")).toBe(false);
    }
  });
});

describe("formatDocumentDelete", () => {
  it("renders `Deleted document <id-prefix>`", () => {
    expect(
      formatDocumentDelete({
        id: "abcd1234-0000-0000-0000-000000000001",
      }),
    ).toBe("Deleted document abcd1234\n");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatDocumentDelete({
      id: "abcd1234-0000-0000-0000-000000000001",
    });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});
