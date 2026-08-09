/**
 * Drift guard for the agent-skill snapshot contract (PROCESS.md D1).
 *
 * The `linear setup agent-skill` recipe writes a snapshot of the
 * canonical files under `plugins/linear/skills/linear/` (owned by
 * sub-project A) into the consumer's `.agents/skills/linear/` tree.
 * The runtime templates read the canonical public plugin tree directly.
 * The npm package includes that tree so source and installed consumers use
 * the same router, references, resources, and interface.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AGENT_SKILL_BODY,
  AGENT_SKILL_OPENAI_YAML,
  AGENT_SKILL_SNAPSHOT,
  AGENT_SKILL_SNAPSHOT_HEADER,
  AGENT_SKILL_SUPPORT_FILES,
} from "../../../src/templates/agent-skill.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const PLUGIN_SKILL_ROOT = path.join(
  repoRoot,
  "plugins",
  "linear",
  "skills",
  "linear",
);
const PLUGIN_SKILL_PATH = path.join(PLUGIN_SKILL_ROOT, "SKILL.md");
const PLUGIN_OPENAI_YAML_PATH = path.join(
  PLUGIN_SKILL_ROOT,
  "agents",
  "openai.yaml",
);

describe("agent-skill snapshot contract (D1)", () => {
  it("AGENT_SKILL_BODY matches plugins/linear/skills/linear/SKILL.md byte-for-byte", () => {
    const canonical = fs.readFileSync(PLUGIN_SKILL_PATH, "utf8");
    expect(AGENT_SKILL_BODY).toBe(canonical);
  });

  it("AGENT_SKILL_OPENAI_YAML matches plugins/linear/skills/linear/agents/openai.yaml byte-for-byte", () => {
    const canonical = fs.readFileSync(PLUGIN_OPENAI_YAML_PATH, "utf8");
    expect(AGENT_SKILL_OPENAI_YAML).toBe(canonical);
  });

  it("AGENT_SKILL_SNAPSHOT_HEADER is the canonical one-line notice", () => {
    // PROCESS.md D1 contract: the snapshot recipe prepends this exact
    // header to SKILL.md (and NOT to openai.yaml). Verbatim match here
    // because any change to the wording would propagate to every
    // consumer of the agent-skill recipe — we want drift to surface.
    expect(AGENT_SKILL_SNAPSHOT_HEADER).toBe(
      "<!-- This is a snapshot. If your tool supports Claude Code plugins, install via `/plugin install linear` instead. -->\n",
    );
  });

  it("AGENT_SKILL_SNAPSHOT is header + body in that order", () => {
    expect(AGENT_SKILL_SNAPSHOT).toBe(
      `${AGENT_SKILL_SNAPSHOT_HEADER}${AGENT_SKILL_BODY}`,
    );
    // Sanity: header lives on top, frontmatter starts after it.
    expect(AGENT_SKILL_SNAPSHOT.indexOf(AGENT_SKILL_SNAPSHOT_HEADER)).toBe(0);
    expect(AGENT_SKILL_SNAPSHOT.indexOf("---\nname: linear\n")).toBeGreaterThan(
      0,
    );
  });

  it("openai.yaml declares the Codex per-skill interface", () => {
    // B-codex spec §3.2 mandates the 4-line file shape. We don't
    // re-validate every field (the byte-for-byte check above already
    // does), but assert the structural contract surface — display_name,
    // short_description, default_prompt — is present so a future
    // refactor of the canonical file doesn't accidentally strip them.
    expect(AGENT_SKILL_OPENAI_YAML).toContain("interface:");
    expect(AGENT_SKILL_OPENAI_YAML).toContain('display_name: "Linear"');
    expect(AGENT_SKILL_OPENAI_YAML).toContain("short_description:");
    expect(AGENT_SKILL_OPENAI_YAML).toContain("default_prompt:");
  });

  it("installs every canonical process reference and advanced resource", () => {
    expect(AGENT_SKILL_SUPPORT_FILES.length).toBeGreaterThan(10);
    expect(AGENT_SKILL_SUPPORT_FILES.map((entry) => entry.targetPath)).toEqual(
      expect.arrayContaining([
        ".agents/skills/linear/references/OPERATING_MODEL.md",
        ".agents/skills/linear/references/ISSUE_CREATION.md",
        ".agents/skills/linear/references/ISSUE_LIFECYCLE.md",
        ".agents/skills/linear/references/WORKFLOWS.md",
        ".agents/skills/linear/resources/DEPENDENCIES.md",
      ]),
    );
    for (const entry of AGENT_SKILL_SUPPORT_FILES) {
      const relative = entry.targetPath.replace(".agents/skills/linear/", "");
      expect(entry.template).toBe(
        fs.readFileSync(path.join(PLUGIN_SKILL_ROOT, relative), "utf8"),
      );
    }
  });

  it("keeps every local Markdown link in the installed skill tree resolvable", () => {
    const markdownFiles = [
      PLUGIN_SKILL_PATH,
      ...AGENT_SKILL_SUPPORT_FILES.map((entry) =>
        path.join(
          PLUGIN_SKILL_ROOT,
          entry.targetPath.replace(".agents/skills/linear/", ""),
        ),
      ),
    ];

    for (const file of markdownFiles) {
      const body = fs.readFileSync(file, "utf8");
      const links = [...body.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map(
        (match) => match[1].split("#", 1)[0],
      );

      for (const link of links) {
        if (!link || /^[a-z]+:/i.test(link)) continue;
        expect(
          fs.existsSync(path.resolve(path.dirname(file), link)),
          `${path.relative(repoRoot, file)} -> ${link}`,
        ).toBe(true);
      }
    }
  });
});
