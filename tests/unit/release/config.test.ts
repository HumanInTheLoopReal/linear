import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PLUGIN_VERSION_FILES } from "../../../scripts/release/plugin-versions.mjs";

const require = createRequire(import.meta.url);

interface ReleasePluginConfig {
  prepareCmd?: string;
  assets?: string[];
}

interface ReleaseConfig {
  plugins: Array<string | [string, ReleasePluginConfig]>;
}

const releaseConfig = require("../../../.releaserc.cjs") as ReleaseConfig;
const packageJson = JSON.parse(
  fs.readFileSync(
    fileURLToPath(new URL("../../../package.json", import.meta.url)),
    "utf8",
  ),
) as { scripts?: Record<string, string> };

function pluginOptions(name: string): ReleasePluginConfig {
  const plugin = releaseConfig.plugins.find(
    (entry) => Array.isArray(entry) && entry[0] === name,
  );
  if (!Array.isArray(plugin))
    throw new Error(`release plugin missing: ${name}`);
  return plugin[1];
}

describe("semantic-release configuration", () => {
  it("cleans dist before every build so deleted modules cannot ship", () => {
    expect(packageJson.scripts?.build).toMatch(/^npm run clean && /);
  });

  it("synchronizes, rebuilds, and verifies release artifacts before publish", () => {
    const prepare = pluginOptions("@semantic-release/exec").prepareCmd;

    expect(prepare).toContain(`plugin-versions.mjs \${nextRelease.version}`);
    expect(prepare).toContain("npm run build");
    expect(prepare).toContain("npm run verify:plugin-versions");
    expect(prepare).toContain("npm run verify:packed-binaries");
  });

  it("commits every synchronized plugin version surface", () => {
    const assets = pluginOptions("@semantic-release/git").assets ?? [];

    for (const relativePath of PLUGIN_VERSION_FILES) {
      expect(assets).toContain(relativePath);
    }
  });
});
