//
// Format tests for the attachments suite (list / create / delete).
//
//   list (empty)     → `\n📎 No attachments.\n\n`
//   list (populated) → `📎 Attachments (N):` header + indented rows
//                       `<id-prefix>  <title>[ [sourceType]]  <url>`
//   create           → `Created attachment <id-prefix>: <title>\n`
//   delete           → `Deleted attachment <id-prefix>\n`

import { describe, expect, it } from "vitest";
import {
  formatAttachmentCreate,
  formatAttachmentDelete,
  formatAttachmentList,
} from "../../../src/commands/attachments.js";

describe("formatAttachmentList", () => {
  it("renders the empty-state hint", () => {
    expect(formatAttachmentList([])).toBe("\n📎 No attachments.\n\n");
  });

  it("renders a row per attachment with id-prefix, title, url", () => {
    const out = formatAttachmentList([
      {
        id: "00000000-0000-0000-0000-000000000001",
        title: "PR #42",
        url: "https://github.com/org/repo/pull/42",
      },
    ]);
    expect(out).toContain("📎 Attachments (1):\n");
    expect(out).toContain(
      "  00000000  PR #42  https://github.com/org/repo/pull/42\n",
    );
  });

  it("appends source-type bracket when present", () => {
    const out = formatAttachmentList([
      {
        id: "abcd1234-0000-0000-0000-000000000001",
        title: "PR #42",
        url: "https://github.com/org/repo/pull/42",
        sourceType: "github",
      },
    ]);
    expect(out).toContain(
      "  abcd1234  PR #42 [github]  https://github.com/org/repo/pull/42\n",
    );
  });

  it("omits source-type bracket when null", () => {
    const out = formatAttachmentList([
      {
        id: "abcd1234-0000-0000-0000-000000000001",
        title: "Link",
        url: "https://example.com",
        sourceType: null,
      },
    ]);
    expect(out).toContain("  abcd1234  Link  https://example.com\n");
    expect(out).not.toContain("[null]");
    expect(out).not.toContain("[]");
  });

  it("renders multiple rows in order with header count matching", () => {
    const out = formatAttachmentList([
      {
        id: "11111111-0000-0000-0000-000000000001",
        title: "A",
        url: "https://a.test",
      },
      {
        id: "22222222-0000-0000-0000-000000000002",
        title: "B",
        url: "https://b.test",
        sourceType: "slack",
      },
    ]);
    expect(out).toContain("📎 Attachments (2):\n");
    expect(out).toContain("  11111111  A  https://a.test\n");
    expect(out).toContain("  22222222  B [slack]  https://b.test\n");
  });

  it("ends with a trailing blank-line separator (mirrors formatLabelList)", () => {
    const out = formatAttachmentList([
      {
        id: "11111111-0000-0000-0000-000000000001",
        title: "A",
        url: "https://a.test",
      },
    ]);
    // Pattern: header + rows + "" (blank line) joined by \n, then final \n.
    // → trailing `\n\n`, matching `formatLabelList` shape.
    expect(out.endsWith("\n\n")).toBe(true);
    expect(out.endsWith("\n\n\n")).toBe(false);
  });

  it("preserves special characters in title and url verbatim", () => {
    const out = formatAttachmentList([
      {
        id: "abcd1234-0000-0000-0000-000000000001",
        title: 'Quote "test" & co.',
        url: "https://example.com/?q=a+b&x=y",
      },
    ]);
    expect(out).toContain('Quote "test" & co.');
    expect(out).toContain("https://example.com/?q=a+b&x=y");
  });
});

describe("formatAttachmentCreate", () => {
  it("renders `Created attachment <id-prefix>: <title>`", () => {
    expect(
      formatAttachmentCreate({
        id: "abcd1234-0000-0000-0000-000000000001",
        title: "My PR",
      }),
    ).toBe("Created attachment abcd1234: My PR\n");
  });

  it("falls back to (untitled) when title is null", () => {
    expect(
      formatAttachmentCreate({
        id: "abcd1234-0000-0000-0000-000000000001",
        title: null,
      }),
    ).toBe("Created attachment abcd1234: (untitled)\n");
  });

  it("falls back to (untitled) when title is undefined", () => {
    expect(
      formatAttachmentCreate({
        id: "abcd1234-0000-0000-0000-000000000001",
      }),
    ).toBe("Created attachment abcd1234: (untitled)\n");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatAttachmentCreate({
      id: "abcd1234-0000-0000-0000-000000000001",
      title: "x",
    });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

describe("formatAttachmentDelete", () => {
  it("renders `Deleted attachment <id-prefix>`", () => {
    expect(
      formatAttachmentDelete({
        id: "abcd1234-0000-0000-0000-000000000001",
      }),
    ).toBe("Deleted attachment abcd1234\n");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatAttachmentDelete({
      id: "abcd1234-0000-0000-0000-000000000001",
    });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});
