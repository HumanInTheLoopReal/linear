import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PLUGIN_VERSION_FILES,
  syncPluginVersions,
  verifyPluginVersions,
} from "../../../scripts/release/plugin-versions.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function copyVersionFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-versions-"));
  for (const relativePath of PLUGIN_VERSION_FILES) {
    const destination = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, relativePath), destination);
  }
  return root;
}

describe("plugin release versions", () => {
  it("keeps every committed plugin surface aligned with package.json", () => {
    expect(() => verifyPluginVersions(undefined, REPO_ROOT)).not.toThrow();
  });

  it("synchronizes manifests, marketplace metadata, and the canonical skill", () => {
    const root = copyVersionFixture();
    try {
      syncPluginVersions("2099.7.3-next.2", root);
      expect(() => verifyPluginVersions("2099.7.3-next.2", root)).not.toThrow();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails verification when one target drifts", () => {
    const root = copyVersionFixture();
    try {
      syncPluginVersions("2099.7.3", root);
      const manifestPath = path.join(
        root,
        "plugins/linear/.codex-plugin/plugin.json",
      );
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      manifest.version = "2099.7.2";
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

      expect(() => verifyPluginVersions("2099.7.3", root)).toThrow(
        "plugins/linear/.codex-plugin/plugin.json: 2099.7.2",
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("validates every target before changing any file", () => {
    const root = copyVersionFixture();
    try {
      const manifestPath = path.join(
        root,
        "plugins/linear/.claude-plugin/plugin.json",
      );
      const referencePath = path.join(
        root,
        "plugins/linear/skills/linear/resources/CLI_REFERENCE.md",
      );
      const originalManifest = fs.readFileSync(manifestPath, "utf8");
      fs.appendFileSync(referencePath, "\nUnexpected version 2098.1.1\n");

      expect(() => syncPluginVersions("2099.7.3", root)).toThrow(
        "expected 1 release-version occurrences, found 2",
      );
      expect(fs.readFileSync(manifestPath, "utf8")).toBe(originalManifest);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
