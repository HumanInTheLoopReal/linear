import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENTS_BEGIN_MARKER,
  AGENTS_END_MARKER,
  AGENTS_INSTRUCTIONS_FILE,
  CLAUDE_HOOK_COMMAND,
  CLAUDE_HOOK_COMMAND_MEMORIES,
  CLAUDE_HOOK_COMMAND_STEALTH,
  CLAUDE_HOOK_EVENTS,
  CODEX_BEGIN_MARKER,
  CODEX_END_MARKER,
  CODEX_HOME_ENV_VAR,
  CODEX_INSTRUCTIONS_FILE,
  checkAgents,
  checkClaude,
  checkCodex,
  checkFactory,
  checkFileRecipe,
  checkGemini,
  checkMultiFileRecipe,
  checkMux,
  checkOpencode,
  FACTORY_BEGIN_MARKER,
  FACTORY_END_MARKER,
  FACTORY_INSTRUCTIONS_FILE,
  GEMINI_HOOK_COMMAND,
  GEMINI_HOOK_COMMAND_MEMORIES,
  GEMINI_HOOK_COMMAND_STEALTH,
  GEMINI_HOOK_EVENTS,
  GEMINI_INSTRUCTIONS_FILE,
  getRecipe,
  installAgents,
  installClaude,
  installCodex,
  installFactory,
  installFileRecipe,
  installGemini,
  installMultiFileRecipe,
  installMux,
  installOpencode,
  listRecipes,
  loadUserRecipes,
  MUX_BEGIN_MARKER,
  MUX_END_MARKER,
  MUX_INSTRUCTIONS_FILE,
  MUX_PROJECT_DIR,
  OPENCODE_BEGIN_MARKER,
  OPENCODE_END_MARKER,
  OPENCODE_INSTRUCTIONS_FILE,
  type RecipeDef,
  removeAgents,
  removeClaude,
  removeCodex,
  removeFactory,
  removeFileRecipe,
  removeGemini,
  removeMultiFileRecipe,
  removeMux,
  removeOpencode,
  saveUserRecipe,
} from "../../../src/services/setup-service.js";
import { AGENT_SKILL_SUPPORT_FILES } from "../../../src/templates/agent-skill.js";

let tmpRoot: string;
let tmpHome: string;
let homedirSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "setup-cwd-"));
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "setup-home-"));
  homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
});

afterEach(() => {
  homedirSpy.mockRestore();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("recipe catalog", () => {
  it("lists at least the eight file recipes plus claude", () => {
    const names = listRecipes().map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "cursor",
        "aider",
        "factory",
        "opencode",
        "junie",
        "windsurf",
        "cody",
        "kilocode",
        "claude",
        "agent-skill",
        "agents",
      ]),
    );
  });

  it("returns undefined for an unknown recipe", () => {
    expect(getRecipe("bogus")).toBeUndefined();
  });

  it("is case-insensitive on lookup", () => {
    expect(getRecipe("Cursor")?.name).toBe("cursor");
  });
});

describe("user recipes — `.linear/recipes.json`", () => {
  it("saveUserRecipe writes a kind=file entry that getRecipe can resolve", () => {
    const recipe = saveUserRecipe(tmpRoot, "MyTool", "tools/mytool.md");
    expect(recipe.name).toBe("mytool"); // normalized to lowercase
    expect(recipe.kind).toBe("file");
    expect(recipe.targetPath).toBe("tools/mytool.md");

    const file = path.join(tmpRoot, ".linear", "recipes.json");
    expect(fs.existsSync(file)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(parsed.recipes.mytool.targetPath).toBe("tools/mytool.md");

    // Lookup with cwd resolves the user recipe.
    expect(getRecipe("mytool", tmpRoot)?.targetPath).toBe("tools/mytool.md");
    // Without cwd, user recipes are invisible (built-ins only).
    expect(getRecipe("mytool")).toBeUndefined();
  });

  it("listRecipes(cwd) includes user recipes with source='user' tag", () => {
    saveUserRecipe(tmpRoot, "myrecipe", "docs/myrecipe.md");
    const entries = listRecipes(tmpRoot);
    const mine = entries.find((r) => r.name === "myrecipe");
    expect(mine).toBeDefined();
    expect(mine?.source).toBe("user");
    // Built-ins still show source='built-in'.
    expect(entries.find((r) => r.name === "cursor")?.source).toBe("built-in");
  });

  it("user recipes shadow built-ins of the same name", () => {
    saveUserRecipe(tmpRoot, "cursor", "custom/cursor-rules.mdc");
    const resolved = getRecipe("cursor", tmpRoot);
    expect(resolved?.targetPath).toBe("custom/cursor-rules.mdc");
    const entries = listRecipes(tmpRoot);
    const cursor = entries.find((r) => r.name === "cursor");
    expect(cursor?.source).toBe("user");
  });

  it("saveUserRecipe is idempotent — re-adding overwrites the prior entry", () => {
    saveUserRecipe(tmpRoot, "mytool", "first.md");
    saveUserRecipe(tmpRoot, "mytool", "second.md");
    expect(getRecipe("mytool", tmpRoot)?.targetPath).toBe("second.md");
    const file = path.join(tmpRoot, ".linear", "recipes.json");
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(Object.keys(parsed.recipes)).toEqual(["mytool"]);
  });

  it("a user recipe round-trips through installFileRecipe + checkFileRecipe", () => {
    saveUserRecipe(tmpRoot, "mytool", ".linear-out/mytool.md");
    const recipe = getRecipe("mytool", tmpRoot);
    expect(recipe).toBeDefined();
    const result = installFileRecipe(recipe!, tmpRoot);
    expect(result.action).toBe("installed");
    expect(fs.existsSync(result.path)).toBe(true);
    expect(checkFileRecipe(recipe!, tmpRoot).installed).toBe(true);
  });

  it("rejects a malformed recipes.json rather than silently overwriting", () => {
    const file = path.join(tmpRoot, ".linear", "recipes.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{ not valid json");
    expect(() => loadUserRecipes(tmpRoot)).toThrow(/Failed to parse/);
  });
});

describe("file recipes — install / check / remove", () => {
  it("installs cursor template at .cursor/rules/linear.mdc", () => {
    const recipe = getRecipe("cursor");
    const result = installFileRecipe(recipe!, tmpRoot);
    expect(result.action).toBe("installed");
    expect(result.path).toBe(path.join(tmpRoot, ".cursor/rules/linear.mdc"));
    const written = fs.readFileSync(result.path, "utf8");
    expect(written).toContain("alwaysApply: true");
    expect(written).toContain("linear");
  });

  it("creates parent directories on install", () => {
    // windsurf writes to `.windsurf/rules/linear.md` (Windsurf Wave 8+
    // per-rule-file layout). The .windsurf/rules/ dir does not exist in
    // the fresh tmpRoot, so install must mkdir -p the full chain.
    installFileRecipe(getRecipe("windsurf")!, tmpRoot);
    expect(fs.existsSync(path.join(tmpRoot, ".windsurf/rules/linear.md"))).toBe(
      true,
    );
  });

  it("check returns installed=false when target is missing", () => {
    // windsurf is a representative single-file recipe (.windsurf/rules.md).
    // aider and junie used to be tested here but were both converted to
    // multifile (in lin-d1p0 and lin-mlzj respectively); their coverage
    // now lives under per-recipe multifile describe blocks below.
    const result = checkFileRecipe(getRecipe("windsurf")!, tmpRoot);
    expect(result.installed).toBe(false);
    expect(result.action).toBe("checked");
  });

  it("check returns installed=true after install", () => {
    installFileRecipe(getRecipe("windsurf")!, tmpRoot);
    expect(checkFileRecipe(getRecipe("windsurf")!, tmpRoot).installed).toBe(
      true,
    );
  });

  it("remove unlinks the file and reports installed=true if it existed", () => {
    installFileRecipe(getRecipe("cody")!, tmpRoot);
    const result = removeFileRecipe(getRecipe("cody")!, tmpRoot);
    expect(result.installed).toBe(true);
    expect(fs.existsSync(result.path)).toBe(false);
  });

  it("remove is a no-op when the file is missing", () => {
    const result = removeFileRecipe(getRecipe("cody")!, tmpRoot);
    expect(result.installed).toBe(false);
  });

  // The agent-skill recipe was converted from kind:"file" to kind:"multifile"
  // in lin-qqi7 (writes the complete skill tree + cleans empty dirs).
  // Coverage now lives under the "agent-skill multifile" describe block
  // below and in tests/unit/templates/agent-skill.test.ts (drift guard).

  // ─── lin-fy93 path corrections: windsurf/cody/kilocode now use the
  // recipe-folder convention each tool's docs lead with. Below are
  // regression guards for the new paths AND the legacy-sweep so users
  // who had the old (.windsurf/rules.md, .sourcegraph/rules.md,
  // .kilocode/rules.md) layout get a clean migration.

  it("windsurf targets .windsurf/rules/linear.md per Windsurf Wave 8+ format", () => {
    const result = installFileRecipe(getRecipe("windsurf")!, tmpRoot);
    expect(result.path).toBe(path.join(tmpRoot, ".windsurf/rules/linear.md"));
    expect(fs.existsSync(result.path)).toBe(true);
  });

  it("windsurf install sweeps the legacy .windsurf/rules.md flat file", () => {
    // Simulate a pre-lin-fy93 install that wrote the workflow to the
    // legacy flat-file path (treating 'rules' as filename, not dir).
    const legacy = path.join(tmpRoot, ".windsurf/rules.md");
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, "stale legacy body");
    installFileRecipe(getRecipe("windsurf")!, tmpRoot);
    // Legacy gone, modern path present.
    expect(fs.existsSync(legacy)).toBe(false);
    expect(fs.existsSync(path.join(tmpRoot, ".windsurf/rules/linear.md"))).toBe(
      true,
    );
  });

  it("windsurf remove sweeps both current and legacy paths", () => {
    const current = path.join(tmpRoot, ".windsurf/rules/linear.md");
    const legacy = path.join(tmpRoot, ".windsurf/rules.md");
    fs.mkdirSync(path.dirname(current), { recursive: true });
    fs.writeFileSync(current, "x");
    fs.writeFileSync(legacy, "y");
    const result = removeFileRecipe(getRecipe("windsurf")!, tmpRoot);
    expect(result.installed).toBe(true);
    expect(fs.existsSync(current)).toBe(false);
    expect(fs.existsSync(legacy)).toBe(false);
  });

  it("cody targets .sourcegraph/linear.rule.md per Cody *.rule.md convention", () => {
    const result = installFileRecipe(getRecipe("cody")!, tmpRoot);
    expect(result.path).toBe(path.join(tmpRoot, ".sourcegraph/linear.rule.md"));
    expect(fs.existsSync(result.path)).toBe(true);
  });

  it("cody install sweeps the legacy .sourcegraph/rules.md flat file", () => {
    const legacy = path.join(tmpRoot, ".sourcegraph/rules.md");
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, "stale legacy body");
    installFileRecipe(getRecipe("cody")!, tmpRoot);
    expect(fs.existsSync(legacy)).toBe(false);
    expect(
      fs.existsSync(path.join(tmpRoot, ".sourcegraph/linear.rule.md")),
    ).toBe(true);
  });

  it("kilocode targets .kilocode/rules/linear.md per recommended folder layout", () => {
    const result = installFileRecipe(getRecipe("kilocode")!, tmpRoot);
    expect(result.path).toBe(path.join(tmpRoot, ".kilocode/rules/linear.md"));
    expect(fs.existsSync(result.path)).toBe(true);
  });

  it("kilocode install sweeps the legacy .kilocode/rules.md flat file", () => {
    const legacy = path.join(tmpRoot, ".kilocode/rules.md");
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, "stale legacy body");
    installFileRecipe(getRecipe("kilocode")!, tmpRoot);
    expect(fs.existsSync(legacy)).toBe(false);
    expect(fs.existsSync(path.join(tmpRoot, ".kilocode/rules/linear.md"))).toBe(
      true,
    );
  });
});

describe("multifile recipes — install / check / remove", () => {
  const sampleRecipe: RecipeDef = {
    name: "sample-multi",
    description: "test multifile",
    kind: "multifile",
    files: [
      { targetPath: ".sample/a.txt", template: "alpha\n" },
      { targetPath: ".sample/sub/b.txt", template: "beta\n" },
    ],
    emptyDirs: [".sample/sub", ".sample"],
  };

  it("install writes every entry under the right path", () => {
    const result = installMultiFileRecipe(sampleRecipe, tmpRoot);
    expect(result.action).toBe("installed");
    expect(result.entries).toHaveLength(2);
    expect(result.installed).toBe(true);
    for (const entry of result.entries) {
      expect(fs.existsSync(entry.path)).toBe(true);
    }
    expect(fs.readFileSync(path.join(tmpRoot, ".sample/a.txt"), "utf8")).toBe(
      "alpha\n",
    );
    expect(
      fs.readFileSync(path.join(tmpRoot, ".sample/sub/b.txt"), "utf8"),
    ).toBe("beta\n");
  });

  it("check reports installed=true only when every file matches the template", () => {
    expect(checkMultiFileRecipe(sampleRecipe, tmpRoot).installed).toBe(false);
    installMultiFileRecipe(sampleRecipe, tmpRoot);
    const after = checkMultiFileRecipe(sampleRecipe, tmpRoot);
    expect(after.installed).toBe(true);
    expect(after.entries.every((e) => e.installed)).toBe(true);
  });

  it("check reports a partial installation when one entry is missing", () => {
    installMultiFileRecipe(sampleRecipe, tmpRoot);
    fs.unlinkSync(path.join(tmpRoot, ".sample/sub/b.txt"));
    const result = checkMultiFileRecipe(sampleRecipe, tmpRoot);
    expect(result.installed).toBe(false);
    expect(result.entries[0].installed).toBe(true);
    expect(result.entries[1].installed).toBe(false);
  });

  it("check reports installed=false when a file's body has drifted", () => {
    installMultiFileRecipe(sampleRecipe, tmpRoot);
    fs.writeFileSync(path.join(tmpRoot, ".sample/a.txt"), "drift\n");
    const result = checkMultiFileRecipe(sampleRecipe, tmpRoot);
    expect(result.installed).toBe(false);
    expect(result.entries[0].installed).toBe(false);
    expect(result.entries[1].installed).toBe(true);
  });

  it("remove unlinks every entry and prunes empty parent dirs", () => {
    installMultiFileRecipe(sampleRecipe, tmpRoot);
    const result = removeMultiFileRecipe(sampleRecipe, tmpRoot);
    expect(result.installed).toBe(true);
    expect(result.entries.every((e) => e.installed)).toBe(true);
    for (const entry of result.entries) {
      expect(fs.existsSync(entry.path)).toBe(false);
    }
    expect(fs.existsSync(path.join(tmpRoot, ".sample/sub"))).toBe(false);
    expect(fs.existsSync(path.join(tmpRoot, ".sample"))).toBe(false);
  });

  it("remove is a soft no-op when nothing is installed", () => {
    const result = removeMultiFileRecipe(sampleRecipe, tmpRoot);
    expect(result.installed).toBe(false);
    expect(result.entries.every((e) => e.installed === false)).toBe(true);
  });

  it("remove keeps non-empty parent dirs intact", () => {
    installMultiFileRecipe(sampleRecipe, tmpRoot);
    // Drop an unrelated sibling file in `.sample/` so it should survive prune.
    fs.writeFileSync(path.join(tmpRoot, ".sample", "user.md"), "x");
    removeMultiFileRecipe(sampleRecipe, tmpRoot);
    expect(fs.existsSync(path.join(tmpRoot, ".sample", "user.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpRoot, ".sample"))).toBe(true);
  });

  it("throws when called with a non-multifile recipe", () => {
    const fileRecipe = getRecipe("cursor");
    expect(fileRecipe).toBeDefined();
    expect(() => installMultiFileRecipe(fileRecipe!, tmpRoot)).toThrow(
      /not a multifile recipe/,
    );
  });
});

describe("agent-skill multifile recipe — router + support files", () => {
  const expectedFileCount = 2 + AGENT_SKILL_SUPPORT_FILES.length;

  it("is registered with the router, interface, references, and resources", () => {
    const recipe = getRecipe("agent-skill");
    expect(recipe).toBeDefined();
    expect(recipe?.kind).toBe("multifile");
    expect(recipe?.files).toHaveLength(expectedFileCount);
    expect(recipe?.files?.[0].targetPath).toBe(
      ".agents/skills/linear/SKILL.md",
    );
    expect(recipe?.files?.[1].targetPath).toBe(
      ".agents/skills/linear/agents/openai.yaml",
    );
    // Snapshot-notice header MUST live on SKILL.md only (D1 contract).
    expect(recipe?.files?.[0].template).toMatch(/^<!-- This is a snapshot\./);
    expect(recipe?.files?.[1].template).not.toMatch(/snapshot/i);
    expect(recipe?.files?.map((entry) => entry.targetPath)).toEqual(
      expect.arrayContaining([
        ".agents/skills/linear/references/OPERATING_MODEL.md",
        ".agents/skills/linear/references/ISSUE_LIFECYCLE.md",
        ".agents/skills/linear/references/FINDINGS_AND_TRIAGE.md",
      ]),
    );
  });

  it("install writes the complete skill tree under .agents/skills/linear/", () => {
    const recipe = getRecipe("agent-skill")!;
    const result = installMultiFileRecipe(recipe, tmpRoot);
    expect(result.action).toBe("installed");
    expect(result.installed).toBe(true);
    const skillPath = path.join(tmpRoot, ".agents/skills/linear/SKILL.md");
    const yamlPath = path.join(
      tmpRoot,
      ".agents/skills/linear/agents/openai.yaml",
    );
    expect(fs.existsSync(skillPath)).toBe(true);
    expect(fs.existsSync(yamlPath)).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          tmpRoot,
          ".agents/skills/linear/references/OPERATING_MODEL.md",
        ),
      ),
    ).toBe(true);
    const skill = fs.readFileSync(skillPath, "utf8");
    // Header is on top, frontmatter follows, then the body.
    expect(skill).toMatch(
      /^<!-- This is a snapshot\. If your tool supports Claude Code plugins, install via `\/plugin install linear` instead\. -->\n---\nname: linear\n/,
    );
    const yaml = fs.readFileSync(yamlPath, "utf8");
    expect(yaml).toContain('display_name: "Linear"');
  });

  it("check round-trips after install", () => {
    const recipe = getRecipe("agent-skill")!;
    expect(checkMultiFileRecipe(recipe, tmpRoot).installed).toBe(false);
    installMultiFileRecipe(recipe, tmpRoot);
    const after = checkMultiFileRecipe(recipe, tmpRoot);
    expect(after.installed).toBe(true);
    expect(after.entries).toHaveLength(expectedFileCount);
    expect(after.entries.every((e) => e.installed)).toBe(true);
  });

  it("remove unlinks the complete skill tree and prunes nested dirs", () => {
    const recipe = getRecipe("agent-skill")!;
    installMultiFileRecipe(recipe, tmpRoot);
    const result = removeMultiFileRecipe(recipe, tmpRoot);
    expect(result.installed).toBe(true);
    expect(
      fs.existsSync(path.join(tmpRoot, ".agents/skills/linear/SKILL.md")),
    ).toBe(false);
    expect(
      fs.existsSync(
        path.join(tmpRoot, ".agents/skills/linear/agents/openai.yaml"),
      ),
    ).toBe(false);
    // Deepest-first prune: the agents/, linear/, skills/, and .agents/
    // dirs should all be gone since nothing else lived under them.
    expect(
      fs.existsSync(path.join(tmpRoot, ".agents/skills/linear/agents")),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(tmpRoot, ".agents/skills/linear/references")),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(tmpRoot, ".agents/skills/linear/resources")),
    ).toBe(false);
    expect(fs.existsSync(path.join(tmpRoot, ".agents/skills/linear"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(tmpRoot, ".agents/skills"))).toBe(false);
    expect(fs.existsSync(path.join(tmpRoot, ".agents"))).toBe(false);
  });

  it("remove preserves unrelated sibling files in shared parent dirs", () => {
    const recipe = getRecipe("agent-skill")!;
    installMultiFileRecipe(recipe, tmpRoot);
    // Drop an unrelated skill in `.agents/skills/` so the `.agents/`
    // and `.agents/skills/` dirs should NOT be pruned.
    fs.writeFileSync(
      path.join(tmpRoot, ".agents/skills/other.md"),
      "other tool",
    );
    removeMultiFileRecipe(recipe, tmpRoot);
    expect(fs.existsSync(path.join(tmpRoot, ".agents/skills/other.md"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(tmpRoot, ".agents/skills"))).toBe(true);
    expect(fs.existsSync(path.join(tmpRoot, ".agents/skills/linear"))).toBe(
      false,
    );
  });
});

describe("aider multifile recipe — conf + LINEAR.md + README.md", () => {
  it("is registered as kind:'multifile' with three sibling entries", () => {
    const recipe = getRecipe("aider");
    expect(recipe).toBeDefined();
    expect(recipe?.kind).toBe("multifile");
    expect(recipe?.files).toHaveLength(3);
    const paths = recipe!.files!.map((f) => f.targetPath);
    expect(paths).toEqual([
      ".aider.conf.yml",
      ".aider/LINEAR.md",
      ".aider/README.md",
    ]);
  });

  it("install writes all three files and points aider at LINEAR.md", () => {
    const recipe = getRecipe("aider")!;
    const result = installMultiFileRecipe(recipe, tmpRoot);
    expect(result.action).toBe("installed");
    expect(result.installed).toBe(true);
    const confPath = path.join(tmpRoot, ".aider.conf.yml");
    const linearPath = path.join(tmpRoot, ".aider/LINEAR.md");
    const readmePath = path.join(tmpRoot, ".aider/README.md");
    expect(fs.existsSync(confPath)).toBe(true);
    expect(fs.existsSync(linearPath)).toBe(true);
    expect(fs.existsSync(readmePath)).toBe(true);
    // The conf MUST point aider at `.aider/LINEAR.md` — that's the
    // whole reason this recipe is multifile. If the read: block ever
    // drifts to a different path the recipe stops auto-loading.
    const conf = fs.readFileSync(confPath, "utf8");
    expect(conf).toContain("read:");
    expect(conf).toContain("- .aider/LINEAR.md");
    // LINEAR.md uses the /run prefix (aider's execution model).
    const linear = fs.readFileSync(linearPath, "utf8");
    expect(linear).toContain("/run linear");
  });

  it("check round-trips after install", () => {
    const recipe = getRecipe("aider")!;
    expect(checkMultiFileRecipe(recipe, tmpRoot).installed).toBe(false);
    installMultiFileRecipe(recipe, tmpRoot);
    const after = checkMultiFileRecipe(recipe, tmpRoot);
    expect(after.installed).toBe(true);
    expect(after.entries).toHaveLength(3);
    expect(after.entries.every((e) => e.installed)).toBe(true);
  });

  it("check reports installed=false if .aider/LINEAR.md is missing", () => {
    const recipe = getRecipe("aider")!;
    installMultiFileRecipe(recipe, tmpRoot);
    fs.unlinkSync(path.join(tmpRoot, ".aider/LINEAR.md"));
    const result = checkMultiFileRecipe(recipe, tmpRoot);
    expect(result.installed).toBe(false);
  });

  it("remove deletes all three files and prunes empty .aider/", () => {
    const recipe = getRecipe("aider")!;
    installMultiFileRecipe(recipe, tmpRoot);
    const result = removeMultiFileRecipe(recipe, tmpRoot);
    expect(result.installed).toBe(true);
    expect(fs.existsSync(path.join(tmpRoot, ".aider.conf.yml"))).toBe(false);
    expect(fs.existsSync(path.join(tmpRoot, ".aider/LINEAR.md"))).toBe(false);
    expect(fs.existsSync(path.join(tmpRoot, ".aider/README.md"))).toBe(false);
    // `.aider/` is in emptyDirs and was emptied by remove — should
    // be pruned. The `.aider.conf.yml` file lives at the project
    // root so we never owned a "root" dir to clean up.
    expect(fs.existsSync(path.join(tmpRoot, ".aider"))).toBe(false);
  });

  it("remove preserves .aider/ if the user has added a sibling file", () => {
    const recipe = getRecipe("aider")!;
    installMultiFileRecipe(recipe, tmpRoot);
    fs.writeFileSync(path.join(tmpRoot, ".aider/user-prompt.md"), "custom");
    removeMultiFileRecipe(recipe, tmpRoot);
    // The user's sibling file survives; .aider/ is non-empty so the
    // prune step skips it.
    expect(fs.existsSync(path.join(tmpRoot, ".aider/user-prompt.md"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(tmpRoot, ".aider"))).toBe(true);
  });
});

describe("junie multifile recipe — guidelines + MCP config", () => {
  it("is registered as kind:'multifile' with two sibling entries", () => {
    const recipe = getRecipe("junie");
    expect(recipe).toBeDefined();
    expect(recipe?.kind).toBe("multifile");
    expect(recipe?.files).toHaveLength(2);
    const paths = recipe!.files!.map((f) => f.targetPath);
    expect(paths).toEqual([".junie/guidelines.md", ".junie/mcp/mcp.json"]);
  });

  it("install writes both files including a valid linear MCP block", () => {
    const recipe = getRecipe("junie")!;
    const result = installMultiFileRecipe(recipe, tmpRoot);
    expect(result.action).toBe("installed");
    expect(result.installed).toBe(true);
    expect(fs.existsSync(path.join(tmpRoot, ".junie/guidelines.md"))).toBe(
      true,
    );
    const mcpPath = path.join(tmpRoot, ".junie/mcp/mcp.json");
    expect(fs.existsSync(mcpPath)).toBe(true);
    // The mcp.json MUST parse as JSON and declare a `linear` server
    // entry. Without this junie wouldn't know to invoke `linear mcp`
    // as a tool surface — the whole reason this recipe is multifile.
    const mcp = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
    expect(mcp.mcpServers).toBeDefined();
    expect(mcp.mcpServers.linear).toBeDefined();
    expect(mcp.mcpServers.linear.command).toBe("linear");
    expect(mcp.mcpServers.linear.args).toEqual(["mcp"]);
  });

  it("check round-trips after install", () => {
    const recipe = getRecipe("junie")!;
    expect(checkMultiFileRecipe(recipe, tmpRoot).installed).toBe(false);
    installMultiFileRecipe(recipe, tmpRoot);
    const after = checkMultiFileRecipe(recipe, tmpRoot);
    expect(after.installed).toBe(true);
    expect(after.entries).toHaveLength(2);
    expect(after.entries.every((e) => e.installed)).toBe(true);
  });

  it("check reports installed=false if only one file is present", () => {
    const recipe = getRecipe("junie")!;
    installMultiFileRecipe(recipe, tmpRoot);
    fs.unlinkSync(path.join(tmpRoot, ".junie/mcp/mcp.json"));
    const result = checkMultiFileRecipe(recipe, tmpRoot);
    expect(result.installed).toBe(false);
    // guidelines.md still installed, mcp.json missing — per-entry
    // reporting should reflect that.
    expect(result.entries[0].installed).toBe(true);
    expect(result.entries[1].installed).toBe(false);
  });

  it("remove deletes both files and prunes .junie/mcp + .junie/", () => {
    const recipe = getRecipe("junie")!;
    installMultiFileRecipe(recipe, tmpRoot);
    const result = removeMultiFileRecipe(recipe, tmpRoot);
    expect(result.installed).toBe(true);
    expect(fs.existsSync(path.join(tmpRoot, ".junie/guidelines.md"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(tmpRoot, ".junie/mcp/mcp.json"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(tmpRoot, ".junie/mcp"))).toBe(false);
    expect(fs.existsSync(path.join(tmpRoot, ".junie"))).toBe(false);
  });

  it("remove preserves .junie/ if user files live alongside", () => {
    const recipe = getRecipe("junie")!;
    installMultiFileRecipe(recipe, tmpRoot);
    fs.writeFileSync(path.join(tmpRoot, ".junie/custom.md"), "user");
    removeMultiFileRecipe(recipe, tmpRoot);
    expect(fs.existsSync(path.join(tmpRoot, ".junie/custom.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpRoot, ".junie"))).toBe(true);
  });
});

describe("claude hook recipe — project scope", () => {
  it("installs SessionStart + PreCompact hooks into .claude/settings.json", () => {
    const result = installClaude({ cwd: tmpRoot, global: false });
    expect(result.scope).toBe("project");
    expect(result.events_added).toEqual([...CLAUDE_HOOK_EVENTS]);
    const settings = JSON.parse(fs.readFileSync(result.path, "utf8"));
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe(
      CLAUDE_HOOK_COMMAND,
    );
    // Compaction re-injects only the dynamic tail (TES-825).
    expect(settings.hooks.PreCompact[0].hooks[0].command).toBe(
      CLAUDE_HOOK_COMMAND_MEMORIES,
    );
    expect(result.commands).toEqual({
      SessionStart: CLAUDE_HOOK_COMMAND,
      PreCompact: CLAUDE_HOOK_COMMAND_MEMORIES,
    });
  });

  it("preserves existing hooks for unrelated events and commands", () => {
    const settingsPath = path.join(tmpRoot, ".claude", "settings.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        statusLine: { type: "command", command: "echo hi" },
        hooks: {
          SessionStart: [
            {
              matcher: "",
              hooks: [{ type: "command", command: "other-tool prime" }],
            },
          ],
        },
      }),
    );
    installClaude({ cwd: tmpRoot, global: false });
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    expect(settings.statusLine.command).toBe("echo hi");
    const sessionStart = settings.hooks.SessionStart;
    const commands = sessionStart.flatMap(
      (e: { hooks: Array<{ command: string }> }) =>
        e.hooks.map((h) => h.command),
    );
    expect(commands).toContain("other-tool prime");
    expect(commands).toContain(CLAUDE_HOOK_COMMAND);
  });

  it("is idempotent — re-install does not add a duplicate command", () => {
    installClaude({ cwd: tmpRoot, global: false });
    const second = installClaude({ cwd: tmpRoot, global: false });
    expect(second.events_added).toEqual([]);
    const settings = JSON.parse(fs.readFileSync(second.path, "utf8"));
    const commands = settings.hooks.SessionStart.flatMap(
      (e: { hooks: Array<{ command: string }> }) =>
        e.hooks.map((h) => h.command),
    );
    expect(
      commands.filter((c: string) => c === CLAUDE_HOOK_COMMAND),
    ).toHaveLength(1);
  });

  it("check returns installed=false on a clean tree", () => {
    expect(checkClaude({ cwd: tmpRoot, global: false }).installed).toBe(false);
  });

  it("check returns installed=true after install", () => {
    installClaude({ cwd: tmpRoot, global: false });
    expect(checkClaude({ cwd: tmpRoot, global: false }).installed).toBe(true);
  });

  it("remove strips the linear command and reports events_removed", () => {
    installClaude({ cwd: tmpRoot, global: false });
    const result = removeClaude({ cwd: tmpRoot, global: false });
    expect(result.events_removed).toEqual([...CLAUDE_HOOK_EVENTS]);
    expect(checkClaude({ cwd: tmpRoot, global: false }).installed).toBe(false);
  });

  it("remove preserves a sibling command on the same event", () => {
    installClaude({ cwd: tmpRoot, global: false });
    const settingsPath = path.join(tmpRoot, ".claude", "settings.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    settings.hooks.SessionStart.push({
      matcher: "",
      hooks: [{ type: "command", command: "other-tool prime" }],
    });
    fs.writeFileSync(settingsPath, JSON.stringify(settings));
    removeClaude({ cwd: tmpRoot, global: false });
    const after = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    const commands = (
      after.hooks.SessionStart as Array<{
        hooks: Array<{ command: string }>;
      }>
    ).flatMap((e) => e.hooks.map((h) => h.command));
    expect(commands).toEqual(["other-tool prime"]);
  });

  it("rejects a malformed settings.json rather than silently overwriting", () => {
    const settingsPath = path.join(tmpRoot, ".claude", "settings.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, "{ not valid json");
    expect(() => installClaude({ cwd: tmpRoot, global: false })).toThrow(
      /Failed to parse/,
    );
  });
});

describe("claude hook recipe — global scope", () => {
  it("targets ~/.claude/settings.json when --global", () => {
    const result = installClaude({ cwd: tmpRoot, global: true });
    expect(result.scope).toBe("global");
    expect(result.path).toBe(path.join(tmpHome, ".claude", "settings.json"));
    expect(fs.existsSync(result.path)).toBe(true);
  });
});

describe("claude hook recipe — legacy settings.local.json migration (lin-9svq)", () => {
  // Sweep legacy `.claude/settings.local.json` entries to the canonical
  // shared settings.json location.
  // Pre-correction installs (or hand-edits) may have placed `linear prime`
  // entries into `.claude/settings.local.json` (the per-developer Claude
  // Code overrides file). The canonical location is `.claude/settings.json`
  // (committed/shared), so install/remove should sweep stale entries out
  // of the legacy file to prevent double-firing.

  function legacyPath(): string {
    return path.join(tmpRoot, ".claude", "settings.local.json");
  }

  function writeLegacyWithCommand(command: string): void {
    fs.mkdirSync(path.dirname(legacyPath()), { recursive: true });
    fs.writeFileSync(
      legacyPath(),
      JSON.stringify(
        {
          hooks: {
            SessionStart: [
              { matcher: "", hooks: [{ type: "command", command }] },
            ],
            PreCompact: [
              { matcher: "", hooks: [{ type: "command", command }] },
            ],
          },
          // Unrelated user setting that must be preserved.
          theme: "dark",
        },
        null,
        2,
      ),
    );
  }

  it("install sweeps stale `linear prime` from .claude/settings.local.json", () => {
    writeLegacyWithCommand(CLAUDE_HOOK_COMMAND);
    const result = installClaude({ cwd: tmpRoot, global: false });
    expect(result.legacy_migrated).toBe(legacyPath());
    const data = JSON.parse(fs.readFileSync(legacyPath(), "utf8"));
    // Hook event arrays were pruned because the only command in them
    // was the linear-managed one we stripped.
    expect(data.hooks?.SessionStart).toBeUndefined();
    expect(data.hooks?.PreCompact).toBeUndefined();
    // Unrelated settings remain intact.
    expect(data.theme).toBe("dark");
  });

  it("install also sweeps the stealth variant from the legacy file", () => {
    writeLegacyWithCommand(CLAUDE_HOOK_COMMAND_STEALTH);
    const result = installClaude({ cwd: tmpRoot, global: false });
    expect(result.legacy_migrated).toBe(legacyPath());
  });

  it("install leaves unrelated hook commands alone in the legacy file", () => {
    fs.mkdirSync(path.dirname(legacyPath()), { recursive: true });
    fs.writeFileSync(
      legacyPath(),
      JSON.stringify(
        {
          hooks: {
            SessionStart: [
              {
                matcher: "",
                hooks: [
                  { type: "command", command: "echo user-hook" },
                  { type: "command", command: CLAUDE_HOOK_COMMAND },
                ],
              },
            ],
          },
        },
        null,
        2,
      ),
    );
    installClaude({ cwd: tmpRoot, global: false });
    const data = JSON.parse(fs.readFileSync(legacyPath(), "utf8"));
    const cmds = data.hooks.SessionStart[0].hooks.map(
      (h: { command: string }) => h.command,
    );
    expect(cmds).toEqual(["echo user-hook"]);
  });

  it("install does not report legacy_migrated when no managed hooks present", () => {
    fs.mkdirSync(path.dirname(legacyPath()), { recursive: true });
    fs.writeFileSync(
      legacyPath(),
      JSON.stringify(
        {
          hooks: {
            SessionStart: [
              {
                matcher: "",
                hooks: [{ type: "command", command: "echo something-else" }],
              },
            ],
          },
        },
        null,
        2,
      ),
    );
    const result = installClaude({ cwd: tmpRoot, global: false });
    expect(result.legacy_migrated).toBeUndefined();
  });

  it("install does not touch the legacy file when --global", () => {
    writeLegacyWithCommand(CLAUDE_HOOK_COMMAND);
    const before = fs.readFileSync(legacyPath(), "utf8");
    const result = installClaude({ cwd: tmpRoot, global: true });
    expect(result.legacy_migrated).toBeUndefined();
    expect(fs.readFileSync(legacyPath(), "utf8")).toBe(before);
  });

  it("install is a no-op when the legacy file is absent", () => {
    const result = installClaude({ cwd: tmpRoot, global: false });
    expect(result.legacy_migrated).toBeUndefined();
    expect(fs.existsSync(legacyPath())).toBe(false);
  });

  it("remove sweeps the legacy file too and reports installed=true if anything cleaned", () => {
    // Pre-condition: only the legacy file has the hook (current settings.json absent).
    writeLegacyWithCommand(CLAUDE_HOOK_COMMAND);
    const result = removeClaude({ cwd: tmpRoot, global: false });
    expect(result.legacy_migrated).toBe(legacyPath());
    // installed=true because we successfully cleaned something (the legacy file),
    // even though the canonical settings.json never existed.
    expect(result.installed).toBe(true);
  });

  it("remove does not touch a malformed legacy file (refuses to overwrite)", () => {
    fs.mkdirSync(path.dirname(legacyPath()), { recursive: true });
    fs.writeFileSync(legacyPath(), "{ this is not json");
    const before = fs.readFileSync(legacyPath(), "utf8");
    // Install canonical settings.json first so remove has something to clean
    installClaude({ cwd: tmpRoot, global: false });
    // Re-write malformed legacy after install (install would've tried to parse it)
    fs.writeFileSync(legacyPath(), "{ this is not json");
    const result = removeClaude({ cwd: tmpRoot, global: false });
    // Migration silently skips malformed files.
    expect(result.legacy_migrated).toBeUndefined();
    expect(fs.readFileSync(legacyPath(), "utf8")).toBe(before);
  });
});

describe("claude hook recipe — --stealth variant", () => {
  function readCommands(): string[] {
    const settingsPath = path.join(tmpRoot, ".claude", "settings.json");
    const data = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    const cmds: string[] = [];
    for (const event of CLAUDE_HOOK_EVENTS) {
      for (const entry of data.hooks?.[event] ?? []) {
        for (const h of entry.hooks ?? []) cmds.push(h.command);
      }
    }
    return cmds;
  }

  it("writes `linear prime --stealth` when stealth=true", () => {
    const result = installClaude({
      cwd: tmpRoot,
      global: false,
      stealth: true,
    });
    expect(result.stealth).toBe(true);
    expect(result.command).toBe(CLAUDE_HOOK_COMMAND_STEALTH);
    expect(readCommands()).toEqual([
      CLAUDE_HOOK_COMMAND_STEALTH,
      CLAUDE_HOOK_COMMAND_MEMORIES,
    ]);
  });

  it("install swap: stealth=true replaces a pre-existing non-stealth entry", () => {
    installClaude({ cwd: tmpRoot, global: false });
    expect(readCommands()).toEqual([
      CLAUDE_HOOK_COMMAND,
      CLAUDE_HOOK_COMMAND_MEMORIES,
    ]);
    installClaude({ cwd: tmpRoot, global: false, stealth: true });
    // The non-stealth SessionStart entry is gone; only stealth remains.
    expect(readCommands()).toEqual([
      CLAUDE_HOOK_COMMAND_STEALTH,
      CLAUDE_HOOK_COMMAND_MEMORIES,
    ]);
  });

  it("install swap: stealth=false replaces a pre-existing stealth entry", () => {
    installClaude({ cwd: tmpRoot, global: false, stealth: true });
    installClaude({ cwd: tmpRoot, global: false });
    expect(readCommands()).toEqual([
      CLAUDE_HOOK_COMMAND,
      CLAUDE_HOOK_COMMAND_MEMORIES,
    ]);
  });

  it("install migrates a pre-TES-825 full-brief PreCompact entry to --memories-only", () => {
    // Simulate an old install: full `linear prime` on BOTH events.
    const settingsPath = path.join(tmpRoot, ".claude", "settings.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              matcher: "",
              hooks: [{ type: "command", command: CLAUDE_HOOK_COMMAND }],
            },
          ],
          PreCompact: [
            {
              matcher: "",
              hooks: [{ type: "command", command: CLAUDE_HOOK_COMMAND }],
            },
          ],
        },
      }),
    );
    installClaude({ cwd: tmpRoot, global: false });
    expect(readCommands()).toEqual([
      CLAUDE_HOOK_COMMAND,
      CLAUDE_HOOK_COMMAND_MEMORIES,
    ]);
  });

  it("check reports installed=true only for the requested variant", () => {
    installClaude({ cwd: tmpRoot, global: false, stealth: true });
    expect(checkClaude({ cwd: tmpRoot, global: false }).installed).toBe(false);
    expect(
      checkClaude({ cwd: tmpRoot, global: false, stealth: true }).installed,
    ).toBe(true);
  });

  it("remove strips both variants regardless of stealth flag", () => {
    installClaude({ cwd: tmpRoot, global: false, stealth: true });
    // Insert a non-stealth entry by hand alongside the stealth one to simulate
    // a settings.json that was somehow touched outside `installClaude`.
    const settingsPath = path.join(tmpRoot, ".claude", "settings.json");
    const data = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    data.hooks.SessionStart.push({
      matcher: "",
      hooks: [{ type: "command", command: CLAUDE_HOOK_COMMAND }],
    });
    fs.writeFileSync(settingsPath, JSON.stringify(data));
    // remove without --stealth still nukes both variants.
    const result = removeClaude({ cwd: tmpRoot, global: false });
    expect(result.events_removed).toEqual(["SessionStart", "PreCompact"]);
    expect(readCommands()).toEqual([]);
  });
});

describe("gemini hook recipe — project scope", () => {
  it("installs SessionStart + PreCompress hooks into .gemini/settings.json", () => {
    const result = installGemini({ cwd: tmpRoot, global: false });
    expect(result.scope).toBe("project");
    expect(result.events_added).toEqual([...GEMINI_HOOK_EVENTS]);
    expect(result.path).toBe(path.join(tmpRoot, ".gemini", "settings.json"));
    const settings = JSON.parse(fs.readFileSync(result.path, "utf8"));
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe(
      GEMINI_HOOK_COMMAND,
    );
    expect(settings.hooks.PreCompress[0].hooks[0].command).toBe(
      GEMINI_HOOK_COMMAND_MEMORIES,
    );
  });

  it("writes GEMINI.md companion on install", () => {
    const result = installGemini({ cwd: tmpRoot, global: false });
    expect(result.instructions_file).toBe(
      path.join(tmpRoot, GEMINI_INSTRUCTIONS_FILE),
    );
    expect(result.instructions_action).toBe("written");
    const written = fs.readFileSync(result.instructions_file, "utf8");
    expect(written).toContain("linear");
  });

  it("GEMINI.md uses the minimal profile body (lin-rfje)", () => {
    // The Gemini hook fires `linear prime` on SessionStart, so GEMINI.md
    // only needs to be a short pointer at that command + the
    // `/plugin install linear` hint.
    const result = installGemini({ cwd: tmpRoot, global: false });
    const body = fs.readFileSync(result.instructions_file, "utf8");
    // Minimal body should reference `linear prime` (the hook target)…
    expect(body).toContain("linear prime");
    // …and the plugin install hint for Claude Code users.
    expect(body).toContain("/plugin install linear");
    // …but should NOT inline the full command cheat sheet that the
    // hookless (full-profile) recipes embed.
    expect(body).not.toContain("linear depends add");
    expect(body).not.toContain("Quick Reference");
  });

  it("leaves existing GEMINI.md untouched and reports exists", () => {
    const insPath = path.join(tmpRoot, GEMINI_INSTRUCTIONS_FILE);
    fs.writeFileSync(insPath, "custom user content\n");
    const result = installGemini({ cwd: tmpRoot, global: false });
    expect(result.instructions_action).toBe("exists");
    expect(fs.readFileSync(insPath, "utf8")).toBe("custom user content\n");
  });

  it("is idempotent — re-install does not add a duplicate command", () => {
    installGemini({ cwd: tmpRoot, global: false });
    const second = installGemini({ cwd: tmpRoot, global: false });
    expect(second.events_added).toEqual([]);
    const settings = JSON.parse(fs.readFileSync(second.path, "utf8"));
    const commands = settings.hooks.SessionStart.flatMap(
      (e: { hooks: Array<{ command: string }> }) =>
        e.hooks.map((h) => h.command),
    );
    expect(
      commands.filter((c: string) => c === GEMINI_HOOK_COMMAND),
    ).toHaveLength(1);
  });

  it("preserves an unrelated hook command on the same event", () => {
    const settingsPath = path.join(tmpRoot, ".gemini", "settings.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              matcher: "",
              hooks: [{ type: "command", command: "other-tool prime" }],
            },
          ],
        },
      }),
    );
    installGemini({ cwd: tmpRoot, global: false });
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    const commands = settings.hooks.SessionStart.flatMap(
      (e: { hooks: Array<{ command: string }> }) =>
        e.hooks.map((h) => h.command),
    );
    expect(commands).toContain("other-tool prime");
    expect(commands).toContain(GEMINI_HOOK_COMMAND);
  });

  it("check returns installed=false on a clean tree", () => {
    expect(checkGemini({ cwd: tmpRoot, global: false }).installed).toBe(false);
  });

  it("check returns installed=true after install", () => {
    installGemini({ cwd: tmpRoot, global: false });
    const result = checkGemini({ cwd: tmpRoot, global: false });
    expect(result.installed).toBe(true);
    expect(result.instructions_action).toBe("exists");
  });

  it("check returns installed=false when GEMINI.md is missing", () => {
    installGemini({ cwd: tmpRoot, global: false });
    fs.rmSync(path.join(tmpRoot, GEMINI_INSTRUCTIONS_FILE));

    const result = checkGemini({ cwd: tmpRoot, global: false });

    expect(result.installed).toBe(false);
    expect(result.instructions_action).toBe("absent");
  });

  it("remove strips the linear command and unlinks GEMINI.md", () => {
    installGemini({ cwd: tmpRoot, global: false });
    const result = removeGemini({ cwd: tmpRoot, global: false });
    expect(result.events_removed).toEqual([...GEMINI_HOOK_EVENTS]);
    expect(result.instructions_action).toBe("removed");
    expect(fs.existsSync(result.instructions_file)).toBe(false);
    expect(checkGemini({ cwd: tmpRoot, global: false }).installed).toBe(false);
  });

  it("remove is a soft no-op when nothing is installed", () => {
    const result = removeGemini({ cwd: tmpRoot, global: false });
    expect(result.events_removed).toEqual([]);
    expect(result.instructions_action).toBe("absent");
    expect(result.installed).toBe(false);
  });
});

describe("gemini hook recipe — global scope", () => {
  it("targets ~/.gemini/settings.json when --global, GEMINI.md still at cwd", () => {
    const result = installGemini({ cwd: tmpRoot, global: true });
    expect(result.scope).toBe("global");
    expect(result.path).toBe(path.join(tmpHome, ".gemini", "settings.json"));
    expect(fs.existsSync(result.path)).toBe(true);
    expect(result.instructions_file).toBe(
      path.join(tmpRoot, GEMINI_INSTRUCTIONS_FILE),
    );
    expect(fs.existsSync(result.instructions_file)).toBe(true);
  });
});

describe("gemini hook recipe — --stealth variant", () => {
  function readCommands(): string[] {
    const settingsPath = path.join(tmpRoot, ".gemini", "settings.json");
    const data = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    const cmds: string[] = [];
    for (const event of GEMINI_HOOK_EVENTS) {
      for (const entry of data.hooks?.[event] ?? []) {
        for (const h of entry.hooks ?? []) cmds.push(h.command);
      }
    }
    return cmds;
  }

  it("writes `linear prime --stealth` when stealth=true", () => {
    const result = installGemini({
      cwd: tmpRoot,
      global: false,
      stealth: true,
    });
    expect(result.stealth).toBe(true);
    expect(result.command).toBe(GEMINI_HOOK_COMMAND_STEALTH);
    expect(readCommands()).toEqual([
      GEMINI_HOOK_COMMAND_STEALTH,
      GEMINI_HOOK_COMMAND_MEMORIES,
    ]);
  });

  it("install swap: stealth=true replaces a pre-existing non-stealth entry", () => {
    installGemini({ cwd: tmpRoot, global: false });
    installGemini({ cwd: tmpRoot, global: false, stealth: true });
    expect(readCommands()).toEqual([
      GEMINI_HOOK_COMMAND_STEALTH,
      GEMINI_HOOK_COMMAND_MEMORIES,
    ]);
  });

  it("check reports installed=true only for the requested variant", () => {
    installGemini({ cwd: tmpRoot, global: false, stealth: true });
    expect(checkGemini({ cwd: tmpRoot, global: false }).installed).toBe(false);
    expect(
      checkGemini({ cwd: tmpRoot, global: false, stealth: true }).installed,
    ).toBe(true);
  });
});

describe("codex section recipe — project scope", () => {
  it("writes AGENTS.md with begin/end markers on a clean tree", () => {
    const result = installCodex({ cwd: tmpRoot, global: false });
    expect(result.scope).toBe("project");
    expect(result.path).toBe(path.join(tmpRoot, CODEX_INSTRUCTIONS_FILE));
    expect(result.instructions_action).toBe("written");
    const data = fs.readFileSync(result.path, "utf8");
    expect(data).toContain(CODEX_BEGIN_MARKER);
    expect(data).toContain(CODEX_END_MARKER);
    expect(data).toContain("linear");
  });

  it("preserves user content outside the marker block", () => {
    const filePath = path.join(tmpRoot, CODEX_INSTRUCTIONS_FILE);
    fs.writeFileSync(filePath, "# My project AGENTS notes\n\nuser-text\n");
    installCodex({ cwd: tmpRoot, global: false });
    const data = fs.readFileSync(filePath, "utf8");
    expect(data).toContain("# My project AGENTS notes");
    expect(data).toContain("user-text");
    expect(data).toContain(CODEX_BEGIN_MARKER);
  });

  it("updates the managed block in place on re-install", () => {
    installCodex({ cwd: tmpRoot, global: false });
    const filePath = path.join(tmpRoot, CODEX_INSTRUCTIONS_FILE);
    // Hand-edit the managed block to simulate drift.
    const first = fs.readFileSync(filePath, "utf8");
    const drifted = first.replace(
      `${CODEX_BEGIN_MARKER}\n`,
      `${CODEX_BEGIN_MARKER}\nSTALE_LINE\n`,
    );
    fs.writeFileSync(filePath, drifted);
    const second = installCodex({ cwd: tmpRoot, global: false });
    expect(second.instructions_action).toBe("updated");
    const after = fs.readFileSync(filePath, "utf8");
    expect(after).not.toContain("STALE_LINE");
    // Exactly one managed block remains.
    expect(after.match(new RegExp(CODEX_BEGIN_MARKER, "g"))?.length).toBe(1);
  });

  it("check returns absent when AGENTS.md is missing", () => {
    const result = checkCodex({ cwd: tmpRoot, global: false });
    expect(result.installed).toBe(false);
    expect(result.instructions_action).toBe("absent");
  });

  it("check reports missing-marker when AGENTS.md has no managed block", () => {
    fs.writeFileSync(
      path.join(tmpRoot, CODEX_INSTRUCTIONS_FILE),
      "just user content, no markers\n",
    );
    const result = checkCodex({ cwd: tmpRoot, global: false });
    expect(result.installed).toBe(false);
    expect(result.instructions_action).toBe("missing-marker");
  });

  it("check returns current after a fresh install", () => {
    installCodex({ cwd: tmpRoot, global: false });
    const result = checkCodex({ cwd: tmpRoot, global: false });
    expect(result.installed).toBe(true);
    expect(result.instructions_action).toBe("current");
  });

  it("check returns stale when the managed block has drifted", () => {
    installCodex({ cwd: tmpRoot, global: false });
    const filePath = path.join(tmpRoot, CODEX_INSTRUCTIONS_FILE);
    const drifted = fs
      .readFileSync(filePath, "utf8")
      .replace(`${CODEX_BEGIN_MARKER}\n`, `${CODEX_BEGIN_MARKER}\nDRIFT\n`);
    fs.writeFileSync(filePath, drifted);
    const result = checkCodex({ cwd: tmpRoot, global: false });
    expect(result.installed).toBe(false);
    expect(result.instructions_action).toBe("stale");
  });

  it("remove strips the managed block but keeps user content", () => {
    const filePath = path.join(tmpRoot, CODEX_INSTRUCTIONS_FILE);
    fs.writeFileSync(filePath, "# Notes\n\nuser-keep\n");
    installCodex({ cwd: tmpRoot, global: false });
    const result = removeCodex({ cwd: tmpRoot, global: false });
    expect(result.instructions_action).toBe("removed");
    const data = fs.readFileSync(filePath, "utf8");
    expect(data).toContain("user-keep");
    expect(data).not.toContain(CODEX_BEGIN_MARKER);
  });

  it("remove is a soft no-op when AGENTS.md is absent", () => {
    const result = removeCodex({ cwd: tmpRoot, global: false });
    expect(result.installed).toBe(false);
    expect(result.instructions_action).toBe("absent");
  });
});

describe("codex section recipe — global scope", () => {
  afterEach(() => {
    delete process.env[CODEX_HOME_ENV_VAR];
  });

  it("targets ~/.codex/AGENTS.md when $CODEX_HOME is unset", () => {
    delete process.env[CODEX_HOME_ENV_VAR];
    const result = installCodex({ cwd: tmpRoot, global: true });
    expect(result.scope).toBe("global");
    expect(result.path).toBe(
      path.join(tmpHome, ".codex", CODEX_INSTRUCTIONS_FILE),
    );
    expect(fs.existsSync(result.path)).toBe(true);
  });

  it("honors $CODEX_HOME for the install target", () => {
    const customHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-home-"));
    process.env[CODEX_HOME_ENV_VAR] = customHome;
    try {
      const result = installCodex({ cwd: tmpRoot, global: true });
      expect(result.path).toBe(path.join(customHome, CODEX_INSTRUCTIONS_FILE));
      expect(fs.existsSync(result.path)).toBe(true);
    } finally {
      fs.rmSync(customHome, { recursive: true, force: true });
    }
  });
});

describe("codex composite — agent-skill + AGENTS.md section", () => {
  // The codex composite installs the agent-skill files before the
  // AGENTS.md section (and remove/check follow the same composition).
  // The CodexSectionResult envelope carries `agent_skill` alongside
  // `instructions_action`, and `installed` is true only when BOTH legs
  // are current. For --global, the agent-skill base is os.homedir() —
  // NOT $CODEX_HOME, which only governs the AGENTS.md target.
  it("install writes the complete agent skill and the AGENTS.md section", () => {
    const result = installCodex({ cwd: tmpRoot, global: false });
    expect(result.agent_skill).toBeDefined();
    expect(result.agent_skill?.installed).toBe(true);
    expect(result.agent_skill?.paths).toHaveLength(
      2 + AGENT_SKILL_SUPPORT_FILES.length,
    );
    // Agent-skill files materialized at .agents/skills/linear/...
    expect(
      fs.existsSync(path.join(tmpRoot, ".agents/skills/linear/SKILL.md")),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(tmpRoot, ".agents/skills/linear/agents/openai.yaml"),
      ),
    ).toBe(true);
    // AGENTS.md section also present.
    expect(
      fs
        .readFileSync(path.join(tmpRoot, CODEX_INSTRUCTIONS_FILE), "utf8")
        .includes(CODEX_BEGIN_MARKER),
    ).toBe(true);
  });

  it("check reports installed=false when section is current but skill is stale", () => {
    installCodex({ cwd: tmpRoot, global: false });
    // Corrupt SKILL.md to simulate skill drift while keeping the
    // AGENTS.md section pristine — composite check should still flip
    // installed to false.
    fs.writeFileSync(
      path.join(tmpRoot, ".agents/skills/linear/SKILL.md"),
      "DRIFTED",
    );
    const result = checkCodex({ cwd: tmpRoot, global: false });
    expect(result.instructions_action).toBe("current");
    expect(result.agent_skill?.installed).toBe(false);
    expect(result.installed).toBe(false);
  });

  it("check reports installed=false when skill is current but section is stale", () => {
    installCodex({ cwd: tmpRoot, global: false });
    // Drift the AGENTS.md section while keeping the skill files clean.
    const filePath = path.join(tmpRoot, CODEX_INSTRUCTIONS_FILE);
    const drifted = fs
      .readFileSync(filePath, "utf8")
      .replace(`${CODEX_BEGIN_MARKER}\n`, `${CODEX_BEGIN_MARKER}\nDRIFT\n`);
    fs.writeFileSync(filePath, drifted);
    const result = checkCodex({ cwd: tmpRoot, global: false });
    expect(result.instructions_action).toBe("stale");
    expect(result.agent_skill?.installed).toBe(true);
    expect(result.installed).toBe(false);
  });

  it("rerun install is idempotent on both legs", () => {
    const first = installCodex({ cwd: tmpRoot, global: false });
    const second = installCodex({ cwd: tmpRoot, global: false });
    expect(first.instructions_action).toBe("written");
    expect(second.instructions_action).toBe("updated");
    // Both legs report installed=true after the second run.
    expect(second.agent_skill?.installed).toBe(true);
    // Single managed block (idempotent section upsert).
    const agentsFile = fs.readFileSync(
      path.join(tmpRoot, CODEX_INSTRUCTIONS_FILE),
      "utf8",
    );
    expect(agentsFile.match(new RegExp(CODEX_BEGIN_MARKER, "g"))?.length).toBe(
      1,
    );
    // Skill files still byte-identical to templates.
    expect(checkCodex({ cwd: tmpRoot, global: false }).installed).toBe(true);
  });

  it("remove cleans up BOTH the AGENTS.md section AND the skill files", () => {
    installCodex({ cwd: tmpRoot, global: false });
    const skillPath = path.join(tmpRoot, ".agents/skills/linear/SKILL.md");
    const openaiPath = path.join(
      tmpRoot,
      ".agents/skills/linear/agents/openai.yaml",
    );
    expect(fs.existsSync(skillPath)).toBe(true);
    expect(fs.existsSync(openaiPath)).toBe(true);

    const result = removeCodex({ cwd: tmpRoot, global: false });
    expect(result.instructions_action).toBe("removed");
    expect(fs.existsSync(skillPath)).toBe(false);
    expect(fs.existsSync(openaiPath)).toBe(false);
    // emptyDirs cleanup pruned `.agents/skills/linear/agents` and
    // `.agents/skills/linear`.
    expect(fs.existsSync(path.join(tmpRoot, ".agents/skills/linear"))).toBe(
      false,
    );
  });

  it("--global writes the skill files under os.homedir(), not $CODEX_HOME", () => {
    // Set $CODEX_HOME to verify the skill files do NOT land there.
    const customHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-home-"));
    process.env[CODEX_HOME_ENV_VAR] = customHome;
    try {
      const result = installCodex({ cwd: tmpRoot, global: true });
      // AGENTS.md lands in $CODEX_HOME.
      expect(result.path).toBe(path.join(customHome, CODEX_INSTRUCTIONS_FILE));
      // Skill files land under tmpHome (os.homedir() mock), NOT customHome.
      expect(
        fs.existsSync(path.join(tmpHome, ".agents/skills/linear/SKILL.md")),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(customHome, ".agents/skills/linear/SKILL.md")),
      ).toBe(false);
    } finally {
      delete process.env[CODEX_HOME_ENV_VAR];
      fs.rmSync(customHome, { recursive: true, force: true });
    }
  });
});

describe("mux section recipe — layered AGENTS.md", () => {
  it("writes only the base layer when neither --project nor --global", () => {
    const result = installMux({ cwd: tmpRoot, project: false, global: false });
    expect(result.layers.map((l) => l.layer)).toEqual(["base"]);
    expect(result.layers[0].action).toBe("written");
    expect(result.layers[0].path).toBe(
      path.join(tmpRoot, MUX_INSTRUCTIONS_FILE),
    );
    expect(fs.existsSync(result.layers[0].path)).toBe(true);
  });

  it("with --project also writes .mux/AGENTS.md", () => {
    const result = installMux({ cwd: tmpRoot, project: true, global: false });
    expect(result.layers.map((l) => l.layer)).toEqual(["base", "project"]);
    const projectPath = path.join(
      tmpRoot,
      MUX_PROJECT_DIR,
      MUX_INSTRUCTIONS_FILE,
    );
    expect(result.layers[1].path).toBe(projectPath);
    expect(fs.existsSync(projectPath)).toBe(true);
    const data = fs.readFileSync(projectPath, "utf8");
    expect(data).toContain(MUX_BEGIN_MARKER);
    expect(data).toContain(MUX_END_MARKER);
  });

  it("with --global also writes ~/.mux/AGENTS.md", () => {
    const result = installMux({ cwd: tmpRoot, project: false, global: true });
    expect(result.layers.map((l) => l.layer)).toEqual(["base", "global"]);
    const globalPath = path.join(
      tmpHome,
      MUX_PROJECT_DIR,
      MUX_INSTRUCTIONS_FILE,
    );
    expect(result.layers[1].path).toBe(globalPath);
    expect(fs.existsSync(globalPath)).toBe(true);
  });

  it("with both --project and --global writes all three layers", () => {
    const result = installMux({ cwd: tmpRoot, project: true, global: true });
    expect(result.layers.map((l) => l.layer)).toEqual([
      "base",
      "project",
      "global",
    ]);
    expect(result.layers.every((l) => l.action === "written")).toBe(true);
  });

  it("--project and --global are additive, not mutually exclusive (lin-p9qq)", () => {
    // Regression guard: mux emits all three layers when both flags
    // are passed (base + .mux + ~/.mux). The command layer must not
    // reintroduce a mutual-exclusion check (lin-p9qq spec §2 row 10).
    // install + check + remove must all accept the combined flag set
    // without throwing, and the install must materialize all three
    // layer files.
    expect(() =>
      installMux({ cwd: tmpRoot, project: true, global: true }),
    ).not.toThrow();
    // All three layers now exist on disk.
    expect(fs.existsSync(path.join(tmpRoot, MUX_INSTRUCTIONS_FILE))).toBe(true);
    expect(
      fs.existsSync(path.join(tmpRoot, MUX_PROJECT_DIR, MUX_INSTRUCTIONS_FILE)),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(tmpHome, MUX_PROJECT_DIR, MUX_INSTRUCTIONS_FILE)),
    ).toBe(true);
    // check with both flags reports all three layers and installed=true.
    const checked = checkMux({ cwd: tmpRoot, project: true, global: true });
    expect(checked.layers.map((l) => l.layer)).toEqual([
      "base",
      "project",
      "global",
    ]);
    expect(checked.installed).toBe(true);
    // remove with both flags strips the managed block from every layer.
    const removed = removeMux({
      cwd: tmpRoot,
      project: true,
      global: true,
    });
    expect(removed.layers.map((l) => l.layer)).toEqual([
      "base",
      "project",
      "global",
    ]);
    expect(removed.layers.every((l) => l.action === "removed")).toBe(true);
    // Re-checking after remove reports the managed block is gone from
    // every layer (the AGENTS.md files themselves remain — managed
    // section recipes only own the marker block, not the whole file).
    const recheck = checkMux({ cwd: tmpRoot, project: true, global: true });
    expect(recheck.layers.every((l) => l.action === "missing-marker")).toBe(
      true,
    );
  });

  it("preserves user content outside markers on the base layer", () => {
    const basePath = path.join(tmpRoot, MUX_INSTRUCTIONS_FILE);
    fs.writeFileSync(basePath, "# Project notes\nkeep-me\n");
    installMux({ cwd: tmpRoot, project: false, global: false });
    const data = fs.readFileSync(basePath, "utf8");
    expect(data).toContain("# Project notes");
    expect(data).toContain("keep-me");
    expect(data).toContain(MUX_BEGIN_MARKER);
  });

  it("re-install reports 'updated' on layers with an existing section", () => {
    installMux({ cwd: tmpRoot, project: true, global: false });
    const second = installMux({ cwd: tmpRoot, project: true, global: false });
    expect(second.layers.every((l) => l.action === "updated")).toBe(true);
  });

  it("check reports current on installed layers and absent on missing", () => {
    installMux({ cwd: tmpRoot, project: false, global: false });
    const result = checkMux({ cwd: tmpRoot, project: true, global: false });
    const byLayer = Object.fromEntries(result.layers.map((l) => [l.layer, l]));
    expect(byLayer.base.action).toBe("current");
    expect(byLayer.project.action).toBe("absent");
    expect(result.installed).toBe(false);
  });

  it("check installed=true only when all requested layers are current", () => {
    installMux({ cwd: tmpRoot, project: true, global: true });
    const result = checkMux({ cwd: tmpRoot, project: true, global: true });
    expect(result.layers.every((l) => l.action === "current")).toBe(true);
    expect(result.installed).toBe(true);
  });

  it("remove strips sections layer-by-layer and preserves outside content", () => {
    const basePath = path.join(tmpRoot, MUX_INSTRUCTIONS_FILE);
    fs.writeFileSync(basePath, "# Project notes\nkeep-me\n");
    installMux({ cwd: tmpRoot, project: true, global: false });
    const result = removeMux({ cwd: tmpRoot, project: true, global: false });
    expect(result.layers.every((l) => l.action === "removed")).toBe(true);
    expect(fs.readFileSync(basePath, "utf8")).toContain("keep-me");
    expect(fs.readFileSync(basePath, "utf8")).not.toContain(MUX_BEGIN_MARKER);
  });

  it("remove on a clean tree is a soft no-op", () => {
    const result = removeMux({ cwd: tmpRoot, project: true, global: true });
    expect(result.layers.every((l) => l.action === "absent")).toBe(true);
    expect(result.installed).toBe(false);
  });

  it("codex and mux sections coexist in the same AGENTS.md", () => {
    installCodex({ cwd: tmpRoot, global: false });
    installMux({ cwd: tmpRoot, project: false, global: false });
    const data = fs.readFileSync(
      path.join(tmpRoot, MUX_INSTRUCTIONS_FILE),
      "utf8",
    );
    expect(data).toContain(CODEX_BEGIN_MARKER);
    expect(data).toContain(MUX_BEGIN_MARKER);
    // Sanity: removing one preserves the other.
    removeMux({ cwd: tmpRoot, project: false, global: false });
    const after = fs.readFileSync(
      path.join(tmpRoot, MUX_INSTRUCTIONS_FILE),
      "utf8",
    );
    expect(after).toContain(CODEX_BEGIN_MARKER);
    expect(after).not.toContain(MUX_BEGIN_MARKER);
  });
});

describe("agents section recipe — project scope", () => {
  it("writes AGENTS.md with begin/end markers on a clean tree", () => {
    const result = installAgents({ cwd: tmpRoot, global: false });
    expect(result.scope).toBe("project");
    expect(result.path).toBe(path.join(tmpRoot, AGENTS_INSTRUCTIONS_FILE));
    expect(result.instructions_action).toBe("written");
    const data = fs.readFileSync(result.path, "utf8");
    expect(data).toContain(AGENTS_BEGIN_MARKER);
    expect(data).toContain(AGENTS_END_MARKER);
    // The snippet body points at `linear prime`, not the full workflow.
    expect(data).toContain("linear prime");
    expect(data).toContain("Issue Tracking");
  });

  it("preserves user content outside the marker block", () => {
    const filePath = path.join(tmpRoot, AGENTS_INSTRUCTIONS_FILE);
    fs.writeFileSync(filePath, "# My project AGENTS notes\n\nuser-text\n");
    installAgents({ cwd: tmpRoot, global: false });
    const data = fs.readFileSync(filePath, "utf8");
    expect(data).toContain("# My project AGENTS notes");
    expect(data).toContain("user-text");
    expect(data).toContain(AGENTS_BEGIN_MARKER);
  });

  it("rerun is idempotent: action='updated' with one block remaining", () => {
    const first = installAgents({ cwd: tmpRoot, global: false });
    expect(first.instructions_action).toBe("written");
    const second = installAgents({ cwd: tmpRoot, global: false });
    expect(second.instructions_action).toBe("updated");
    const data = fs.readFileSync(
      path.join(tmpRoot, AGENTS_INSTRUCTIONS_FILE),
      "utf8",
    );
    expect(data.match(new RegExp(AGENTS_BEGIN_MARKER, "g"))?.length).toBe(1);
  });

  it("check returns absent when AGENTS.md is missing", () => {
    const result = checkAgents({ cwd: tmpRoot, global: false });
    expect(result.installed).toBe(false);
    expect(result.instructions_action).toBe("absent");
  });

  it("check returns current after a fresh install", () => {
    installAgents({ cwd: tmpRoot, global: false });
    const result = checkAgents({ cwd: tmpRoot, global: false });
    expect(result.installed).toBe(true);
    expect(result.instructions_action).toBe("current");
  });

  it("check returns stale when the managed block has drifted", () => {
    installAgents({ cwd: tmpRoot, global: false });
    const filePath = path.join(tmpRoot, AGENTS_INSTRUCTIONS_FILE);
    const drifted = fs
      .readFileSync(filePath, "utf8")
      .replace(`${AGENTS_BEGIN_MARKER}\n`, `${AGENTS_BEGIN_MARKER}\nDRIFT\n`);
    fs.writeFileSync(filePath, drifted);
    const result = checkAgents({ cwd: tmpRoot, global: false });
    expect(result.installed).toBe(false);
    expect(result.instructions_action).toBe("stale");
  });

  it("check reports missing-marker when AGENTS.md has no managed block", () => {
    fs.writeFileSync(
      path.join(tmpRoot, AGENTS_INSTRUCTIONS_FILE),
      "just user content, no markers\n",
    );
    const result = checkAgents({ cwd: tmpRoot, global: false });
    expect(result.installed).toBe(false);
    expect(result.instructions_action).toBe("missing-marker");
  });

  it("remove strips the managed block but keeps user content", () => {
    const filePath = path.join(tmpRoot, AGENTS_INSTRUCTIONS_FILE);
    fs.writeFileSync(filePath, "# Notes\n\nuser-keep\n");
    installAgents({ cwd: tmpRoot, global: false });
    const result = removeAgents({ cwd: tmpRoot, global: false });
    expect(result.instructions_action).toBe("removed");
    const data = fs.readFileSync(filePath, "utf8");
    expect(data).toContain("user-keep");
    expect(data).not.toContain(AGENTS_BEGIN_MARKER);
  });

  it("remove is a soft no-op when AGENTS.md is absent", () => {
    const result = removeAgents({ cwd: tmpRoot, global: false });
    expect(result.installed).toBe(false);
    expect(result.instructions_action).toBe("absent");
  });

  it("agents and codex sections coexist in the same AGENTS.md", () => {
    installAgents({ cwd: tmpRoot, global: false });
    installCodex({ cwd: tmpRoot, global: false });
    const data = fs.readFileSync(
      path.join(tmpRoot, AGENTS_INSTRUCTIONS_FILE),
      "utf8",
    );
    expect(data).toContain(AGENTS_BEGIN_MARKER);
    expect(data).toContain(CODEX_BEGIN_MARKER);
    // Removing agents preserves codex.
    removeAgents({ cwd: tmpRoot, global: false });
    const after = fs.readFileSync(
      path.join(tmpRoot, AGENTS_INSTRUCTIONS_FILE),
      "utf8",
    );
    expect(after).not.toContain(AGENTS_BEGIN_MARKER);
    expect(after).toContain(CODEX_BEGIN_MARKER);
  });
});

describe("agents section recipe — global scope", () => {
  it("targets ~/.config/AGENTS.md under --global", () => {
    const result = installAgents({ cwd: tmpRoot, global: true });
    expect(result.scope).toBe("global");
    expect(result.path).toBe(
      path.join(tmpHome, ".config", AGENTS_INSTRUCTIONS_FILE),
    );
    expect(fs.existsSync(result.path)).toBe(true);
  });
});

describe("factory section recipe — managed AGENTS.md block", () => {
  // The factory recipe converted from kind:"file" (overwrote whole
  // AGENTS.md) to kind:"section" in lin-ugqd. It now uses its own
  // BEGIN/END marker pair so user content outside the block survives.
  // Factory is project-only (no --global layering surface).
  it("declares factory as a section recipe (not file)", () => {
    expect(getRecipe("factory")?.kind).toBe("section");
  });

  it("writes AGENTS.md with begin/end markers on a clean tree", () => {
    const result = installFactory({ cwd: tmpRoot });
    expect(result.scope).toBe("project");
    expect(result.path).toBe(path.join(tmpRoot, FACTORY_INSTRUCTIONS_FILE));
    expect(result.instructions_action).toBe("written");
    const data = fs.readFileSync(result.path, "utf8");
    expect(data).toContain(FACTORY_BEGIN_MARKER);
    expect(data).toContain(FACTORY_END_MARKER);
    // Factory ships the full workflow body, not the prime-pointer snippet.
    expect(data).toContain("linear");
  });

  it("preserves user content outside the marker block", () => {
    const filePath = path.join(tmpRoot, FACTORY_INSTRUCTIONS_FILE);
    fs.writeFileSync(filePath, "# My project AGENTS notes\n\nuser-text\n");
    installFactory({ cwd: tmpRoot });
    const data = fs.readFileSync(filePath, "utf8");
    expect(data).toContain("# My project AGENTS notes");
    expect(data).toContain("user-text");
    expect(data).toContain(FACTORY_BEGIN_MARKER);
  });

  it("rerun is idempotent: action='updated' with one block remaining", () => {
    const first = installFactory({ cwd: tmpRoot });
    expect(first.instructions_action).toBe("written");
    const second = installFactory({ cwd: tmpRoot });
    expect(second.instructions_action).toBe("updated");
    const data = fs.readFileSync(
      path.join(tmpRoot, FACTORY_INSTRUCTIONS_FILE),
      "utf8",
    );
    expect(data.match(new RegExp(FACTORY_BEGIN_MARKER, "g"))?.length).toBe(1);
  });

  it("check returns absent when AGENTS.md is missing", () => {
    const result = checkFactory({ cwd: tmpRoot });
    expect(result.installed).toBe(false);
    expect(result.instructions_action).toBe("absent");
  });

  it("check returns current after a fresh install", () => {
    installFactory({ cwd: tmpRoot });
    const result = checkFactory({ cwd: tmpRoot });
    expect(result.installed).toBe(true);
    expect(result.instructions_action).toBe("current");
  });

  it("check returns stale when the managed block has drifted", () => {
    installFactory({ cwd: tmpRoot });
    const filePath = path.join(tmpRoot, FACTORY_INSTRUCTIONS_FILE);
    const drifted = fs
      .readFileSync(filePath, "utf8")
      .replace(`${FACTORY_BEGIN_MARKER}\n`, `${FACTORY_BEGIN_MARKER}\nDRIFT\n`);
    fs.writeFileSync(filePath, drifted);
    const result = checkFactory({ cwd: tmpRoot });
    expect(result.installed).toBe(false);
    expect(result.instructions_action).toBe("stale");
  });

  it("check reports missing-marker when AGENTS.md has no managed block", () => {
    fs.writeFileSync(
      path.join(tmpRoot, FACTORY_INSTRUCTIONS_FILE),
      "just user content, no markers\n",
    );
    const result = checkFactory({ cwd: tmpRoot });
    expect(result.installed).toBe(false);
    expect(result.instructions_action).toBe("missing-marker");
  });

  it("remove strips the managed block but keeps user content", () => {
    const filePath = path.join(tmpRoot, FACTORY_INSTRUCTIONS_FILE);
    fs.writeFileSync(filePath, "# Notes\n\nuser-keep\n");
    installFactory({ cwd: tmpRoot });
    const result = removeFactory({ cwd: tmpRoot });
    expect(result.instructions_action).toBe("removed");
    const data = fs.readFileSync(filePath, "utf8");
    expect(data).toContain("user-keep");
    expect(data).not.toContain(FACTORY_BEGIN_MARKER);
  });

  it("remove is a soft no-op when AGENTS.md is absent", () => {
    const result = removeFactory({ cwd: tmpRoot });
    expect(result.installed).toBe(false);
    expect(result.instructions_action).toBe("absent");
  });

  it("factory and codex sections coexist in the same AGENTS.md", () => {
    installFactory({ cwd: tmpRoot });
    installCodex({ cwd: tmpRoot, global: false });
    const data = fs.readFileSync(
      path.join(tmpRoot, FACTORY_INSTRUCTIONS_FILE),
      "utf8",
    );
    expect(data).toContain(FACTORY_BEGIN_MARKER);
    expect(data).toContain(CODEX_BEGIN_MARKER);
    // Removing factory preserves codex.
    removeFactory({ cwd: tmpRoot });
    const after = fs.readFileSync(
      path.join(tmpRoot, FACTORY_INSTRUCTIONS_FILE),
      "utf8",
    );
    expect(after).not.toContain(FACTORY_BEGIN_MARKER);
    expect(after).toContain(CODEX_BEGIN_MARKER);
  });
});

describe("opencode section recipe — managed AGENTS.md block", () => {
  // The opencode recipe converted from kind:"file" (overwrote whole
  // AGENTS.md) to kind:"section" in lin-csnl. Mirrors factory exactly —
  // same agentsIntegration shape. Project-only (OpenCode reads
  // <cwd>/AGENTS.md and has no $OPENCODE_HOME analog).
  it("declares opencode as a section recipe (not file)", () => {
    expect(getRecipe("opencode")?.kind).toBe("section");
  });

  it("writes AGENTS.md with begin/end markers on a clean tree", () => {
    const result = installOpencode({ cwd: tmpRoot });
    expect(result.scope).toBe("project");
    expect(result.path).toBe(path.join(tmpRoot, OPENCODE_INSTRUCTIONS_FILE));
    expect(result.instructions_action).toBe("written");
    const data = fs.readFileSync(result.path, "utf8");
    expect(data).toContain(OPENCODE_BEGIN_MARKER);
    expect(data).toContain(OPENCODE_END_MARKER);
    // Opencode ships the full workflow body (no hook fallback).
    expect(data).toContain("linear");
  });

  it("preserves user content outside the marker block", () => {
    const filePath = path.join(tmpRoot, OPENCODE_INSTRUCTIONS_FILE);
    fs.writeFileSync(filePath, "# My project AGENTS notes\n\nuser-text\n");
    installOpencode({ cwd: tmpRoot });
    const data = fs.readFileSync(filePath, "utf8");
    expect(data).toContain("# My project AGENTS notes");
    expect(data).toContain("user-text");
    expect(data).toContain(OPENCODE_BEGIN_MARKER);
  });

  it("rerun is idempotent: action='updated' with one block remaining", () => {
    const first = installOpencode({ cwd: tmpRoot });
    expect(first.instructions_action).toBe("written");
    const second = installOpencode({ cwd: tmpRoot });
    expect(second.instructions_action).toBe("updated");
    const data = fs.readFileSync(
      path.join(tmpRoot, OPENCODE_INSTRUCTIONS_FILE),
      "utf8",
    );
    expect(data.match(new RegExp(OPENCODE_BEGIN_MARKER, "g"))?.length).toBe(1);
  });

  it("check returns absent when AGENTS.md is missing", () => {
    const result = checkOpencode({ cwd: tmpRoot });
    expect(result.installed).toBe(false);
    expect(result.instructions_action).toBe("absent");
  });

  it("check returns current after a fresh install", () => {
    installOpencode({ cwd: tmpRoot });
    const result = checkOpencode({ cwd: tmpRoot });
    expect(result.installed).toBe(true);
    expect(result.instructions_action).toBe("current");
  });

  it("check returns stale when the managed block has drifted", () => {
    installOpencode({ cwd: tmpRoot });
    const filePath = path.join(tmpRoot, OPENCODE_INSTRUCTIONS_FILE);
    const drifted = fs
      .readFileSync(filePath, "utf8")
      .replace(
        `${OPENCODE_BEGIN_MARKER}\n`,
        `${OPENCODE_BEGIN_MARKER}\nDRIFT\n`,
      );
    fs.writeFileSync(filePath, drifted);
    const result = checkOpencode({ cwd: tmpRoot });
    expect(result.installed).toBe(false);
    expect(result.instructions_action).toBe("stale");
  });

  it("check reports missing-marker when AGENTS.md has no managed block", () => {
    fs.writeFileSync(
      path.join(tmpRoot, OPENCODE_INSTRUCTIONS_FILE),
      "just user content, no markers\n",
    );
    const result = checkOpencode({ cwd: tmpRoot });
    expect(result.installed).toBe(false);
    expect(result.instructions_action).toBe("missing-marker");
  });

  it("remove strips the managed block but keeps user content", () => {
    const filePath = path.join(tmpRoot, OPENCODE_INSTRUCTIONS_FILE);
    fs.writeFileSync(filePath, "# Notes\n\nuser-keep\n");
    installOpencode({ cwd: tmpRoot });
    const result = removeOpencode({ cwd: tmpRoot });
    expect(result.instructions_action).toBe("removed");
    const data = fs.readFileSync(filePath, "utf8");
    expect(data).toContain("user-keep");
    expect(data).not.toContain(OPENCODE_BEGIN_MARKER);
  });

  it("remove is a soft no-op when AGENTS.md is absent", () => {
    const result = removeOpencode({ cwd: tmpRoot });
    expect(result.installed).toBe(false);
    expect(result.instructions_action).toBe("absent");
  });

  it("opencode coexists with factory and codex in the same AGENTS.md", () => {
    installFactory({ cwd: tmpRoot });
    installOpencode({ cwd: tmpRoot });
    installCodex({ cwd: tmpRoot, global: false });
    const data = fs.readFileSync(
      path.join(tmpRoot, OPENCODE_INSTRUCTIONS_FILE),
      "utf8",
    );
    expect(data).toContain(FACTORY_BEGIN_MARKER);
    expect(data).toContain(OPENCODE_BEGIN_MARKER);
    expect(data).toContain(CODEX_BEGIN_MARKER);
    // Removing opencode preserves factory + codex.
    removeOpencode({ cwd: tmpRoot });
    const after = fs.readFileSync(
      path.join(tmpRoot, OPENCODE_INSTRUCTIONS_FILE),
      "utf8",
    );
    expect(after).not.toContain(OPENCODE_BEGIN_MARKER);
    expect(after).toContain(FACTORY_BEGIN_MARKER);
    expect(after).toContain(CODEX_BEGIN_MARKER);
  });
});
