//
// Format tests for files download / upload. Both verbs emit a one-line
// status:
//
//   download → `File downloaded successfully to <filePath>\n`
//   upload   → `File uploaded successfully: <assetUrl>\n`

import { describe, expect, it } from "vitest";
import {
  formatFileDownload,
  formatFileUpload,
} from "../../../src/commands/files.js";

describe("formatFileDownload", () => {
  it("renders `File downloaded successfully to <filePath>`", () => {
    expect(formatFileDownload({ filePath: "/tmp/icon.png" })).toBe(
      "File downloaded successfully to /tmp/icon.png\n",
    );
  });

  it("preserves whitespace and spaces in the path verbatim", () => {
    expect(
      formatFileDownload({ filePath: "/Users/me/My Docs/photo (1).jpg" }),
    ).toBe("File downloaded successfully to /Users/me/My Docs/photo (1).jpg\n");
  });

  it("falls back to (unknown path) when filePath is null/undefined", () => {
    expect(formatFileDownload({ filePath: null })).toBe(
      "File downloaded successfully to (unknown path)\n",
    );
    expect(formatFileDownload({})).toBe(
      "File downloaded successfully to (unknown path)\n",
    );
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatFileDownload({ filePath: "/tmp/x" });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

describe("formatFileUpload", () => {
  it("renders `File uploaded successfully: <assetUrl>`", () => {
    expect(
      formatFileUpload({
        assetUrl: "https://uploads.linear.app/abc-123/icon.png",
        filename: "icon.png",
      }),
    ).toBe(
      "File uploaded successfully: https://uploads.linear.app/abc-123/icon.png\n",
    );
  });

  it("preserves URL query params and fragments verbatim", () => {
    expect(
      formatFileUpload({
        assetUrl: "https://uploads.linear.app/x?token=abc&exp=999",
        filename: "x",
      }),
    ).toBe(
      "File uploaded successfully: https://uploads.linear.app/x?token=abc&exp=999\n",
    );
  });

  it("falls back to (no URL returned) when assetUrl is null/undefined", () => {
    expect(formatFileUpload({ assetUrl: null, filename: "x" })).toBe(
      "File uploaded successfully: (no URL returned)\n",
    );
    expect(formatFileUpload({})).toBe(
      "File uploaded successfully: (no URL returned)\n",
    );
  });

  it("does NOT include the filename in the text echo (URL is canonical)", () => {
    const out = formatFileUpload({
      assetUrl: "https://x.test/url",
      filename: "uniquely-named-file.png",
    });
    expect(out).not.toContain("uniquely-named-file.png");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatFileUpload({
      assetUrl: "https://x.test/x",
      filename: "x",
    });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});
