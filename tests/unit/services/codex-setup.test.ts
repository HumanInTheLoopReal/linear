import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkCodexNativeHooks,
  codexConfigPath,
  codexHooksFeatureEnabled,
  codexHooksPath,
  codexManagedHooksCurrent,
  installCodexNativeHooks,
  removeCodexHooksFeature,
  removeCodexNativeHooks,
  upsertCodexHooksFeature,
  upsertCodexManagedHooks,
} from "../../../src/services/setup/codex-setup.js";

let tmpRoot: string;
let tmpHome: string;
let homedirSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-setup-cwd-"));
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-setup-home-"));
  homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
});

afterEach(() => {
  homedirSpy.mockRestore();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("upsertCodexHooksFeature", () => {
  it("creates a [features] table on empty input", () => {
    const out = upsertCodexHooksFeature("");
    expect(out).toContain("[features]");
    expect(out).toContain("hooks = true");
    expect(codexHooksFeatureEnabled(out)).toBe(true);
  });

  it("adds hooks = true to an existing [features] table and preserves siblings", () => {
    const out = upsertCodexHooksFeature("[features]\nother = true\n");
    expect(out).toContain("other = true");
    expect(out).toContain("hooks = true");
    expect(codexHooksFeatureEnabled(out)).toBe(true);
  });

  it("preserves unrelated tables", () => {
    const out = upsertCodexHooksFeature('[model]\nname = "gpt-test"\n');
    expect(out).toContain('name = "gpt-test"');
    expect(out).toContain("[features]");
    expect(out).toContain("hooks = true");
  });

  it("migrates the deprecated codex_hooks key", () => {
    const out = upsertCodexHooksFeature(
      "[features]\ncodex_hooks = true\nother = true\n",
    );
    expect(out).not.toContain("codex_hooks");
    expect(out).toContain("hooks = true");
    expect(out).toContain("other = true");
    expect(codexHooksFeatureEnabled(out)).toBe(true);
  });

  it("is idempotent", () => {
    const once = upsertCodexHooksFeature("[features]\nother = true\n");
    expect(upsertCodexHooksFeature(once)).toBe(once);
  });
});

describe("removeCodexHooksFeature", () => {
  it("strips hooks flag but keeps the table and siblings", () => {
    const installed = upsertCodexHooksFeature("[features]\nother = true\n");
    const out = removeCodexHooksFeature(installed);
    expect(out).toContain("other = true");
    expect(codexHooksFeatureEnabled(out)).toBe(false);
  });
});

describe("managed hooks JSON upsert", () => {
  it("inserts the four managed events", () => {
    const config: Record<string, unknown> = {};
    upsertCodexManagedHooks(config);
    expect(codexManagedHooksCurrent(config)).toBe(true);
    const hooks = config.hooks as Record<string, unknown>;
    expect(Object.keys(hooks).sort()).toEqual([
      "PostCompact",
      "PreCompact",
      "SessionStart",
      "UserPromptSubmit",
    ]);
  });

  it("preserves user hooks and dedups managed ones on re-upsert", () => {
    const config: Record<string, unknown> = {
      hooks: {
        SessionStart: [
          {
            matcher: "startup",
            hooks: [{ type: "command", command: "echo keep" }],
          },
        ],
      },
    };
    upsertCodexManagedHooks(config);
    upsertCodexManagedHooks(config);
    const hooks = config.hooks as Record<string, unknown[]>;
    const serialized = JSON.stringify(hooks.SessionStart);
    expect(serialized).toContain("echo keep");
    expect(serialized).toContain("linear codex-hook SessionStart");
    // Exactly one managed SessionStart entry (deduped).
    const managed = (
      hooks.SessionStart as Array<{ hooks: Array<{ command: string }> }>
    ).filter((e) =>
      e.hooks.some((h) => h.command.startsWith("linear codex-hook ")),
    );
    expect(managed).toHaveLength(1);
  });
});

describe("installCodexNativeHooks — project scope", () => {
  it("writes config.toml feature flag and hooks.json managed entries", () => {
    const result = installCodexNativeHooks({ cwd: tmpRoot, global: false });
    expect(result.action).toBe("installed");
    expect(result.installed).toBe(true);
    expect(result.config_path).toBe(
      path.join(tmpRoot, ".codex", "config.toml"),
    );
    expect(result.hooks_path).toBe(path.join(tmpRoot, ".codex", "hooks.json"));

    const config = fs.readFileSync(result.config_path, "utf8");
    expect(codexHooksFeatureEnabled(config)).toBe(true);

    const hooks = JSON.parse(fs.readFileSync(result.hooks_path, "utf8"));
    expect(codexManagedHooksCurrent(hooks)).toBe(true);
  });

  it("is idempotent and preserves pre-existing config/hooks", () => {
    const configPath = codexConfigPath({ cwd: tmpRoot, global: false });
    const hooksPath = codexHooksPath({ cwd: tmpRoot, global: false });
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      '[model]\nname = "gpt-test"\n\n[features]\nother = true\n',
    );
    fs.writeFileSync(
      hooksPath,
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              matcher: "startup",
              hooks: [{ type: "command", command: "echo keep" }],
            },
          ],
        },
      }),
    );

    installCodexNativeHooks({ cwd: tmpRoot, global: false });
    const firstConfig = fs.readFileSync(configPath, "utf8");
    const firstHooks = fs.readFileSync(hooksPath, "utf8");
    installCodexNativeHooks({ cwd: tmpRoot, global: false });
    expect(fs.readFileSync(configPath, "utf8")).toBe(firstConfig);
    expect(fs.readFileSync(hooksPath, "utf8")).toBe(firstHooks);

    expect(firstConfig).toContain("other = true");
    expect(firstConfig).toContain("hooks = true");
    expect(firstHooks).toContain("echo keep");
    expect(firstHooks).toContain("linear codex-hook SessionStart");
  });
});

describe("checkCodexNativeHooks", () => {
  it("reports not installed on a clean tree", () => {
    const result = checkCodexNativeHooks({ cwd: tmpRoot, global: false });
    expect(result.installed).toBe(false);
  });

  it("reports installed after install", () => {
    installCodexNativeHooks({ cwd: tmpRoot, global: false });
    expect(
      checkCodexNativeHooks({ cwd: tmpRoot, global: false }).installed,
    ).toBe(true);
  });

  it("detects stale hooks.json", () => {
    installCodexNativeHooks({ cwd: tmpRoot, global: false });
    fs.writeFileSync(
      codexHooksPath({ cwd: tmpRoot, global: false }),
      JSON.stringify({ hooks: { SessionStart: [] } }),
    );
    expect(
      checkCodexNativeHooks({ cwd: tmpRoot, global: false }).installed,
    ).toBe(false);
  });
});

describe("removeCodexNativeHooks", () => {
  it("removes the feature flag and managed hooks, keeping user hooks", () => {
    const hooksPath = codexHooksPath({ cwd: tmpRoot, global: false });
    fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
    fs.writeFileSync(
      hooksPath,
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              matcher: "startup",
              hooks: [{ type: "command", command: "echo keep" }],
            },
          ],
        },
      }),
    );
    installCodexNativeHooks({ cwd: tmpRoot, global: false });

    const result = removeCodexNativeHooks({ cwd: tmpRoot, global: false });
    expect(result.installed).toBe(true);

    const config = fs.readFileSync(result.config_path, "utf8");
    expect(codexHooksFeatureEnabled(config)).toBe(false);
    const hooks = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
    expect(JSON.stringify(hooks)).toContain("echo keep");
    expect(JSON.stringify(hooks)).not.toContain("linear codex-hook");
  });

  it("deletes hooks.json entirely when only managed hooks existed", () => {
    installCodexNativeHooks({ cwd: tmpRoot, global: false });
    const hooksPath = codexHooksPath({ cwd: tmpRoot, global: false });
    removeCodexNativeHooks({ cwd: tmpRoot, global: false });
    expect(fs.existsSync(hooksPath)).toBe(false);
  });

  it("is a soft no-op on a clean tree", () => {
    const result = removeCodexNativeHooks({ cwd: tmpRoot, global: false });
    expect(result.installed).toBe(false);
  });
});

describe("installCodexNativeHooks — global scope respects CODEX_HOME", () => {
  afterEach(() => {
    delete process.env.CODEX_HOME;
  });

  it("targets ~/.codex when CODEX_HOME unset", () => {
    delete process.env.CODEX_HOME;
    const result = installCodexNativeHooks({ cwd: tmpRoot, global: true });
    expect(result.config_path).toBe(
      path.join(tmpHome, ".codex", "config.toml"),
    );
    expect(fs.existsSync(result.config_path)).toBe(true);
  });

  it("honors $CODEX_HOME", () => {
    const customHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-home-"));
    process.env.CODEX_HOME = customHome;
    const result = installCodexNativeHooks({ cwd: tmpRoot, global: true });
    expect(result.config_path).toBe(path.join(customHome, "config.toml"));
    expect(result.hooks_path).toBe(path.join(customHome, "hooks.json"));
    expect(fs.existsSync(result.hooks_path)).toBe(true);
    fs.rmSync(customHome, { recursive: true, force: true });
  });
});
