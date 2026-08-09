import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/common/output.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/common/output.js")>();
  return { ...actual, outputSuccess: vi.fn(), outputResult: vi.fn() };
});

vi.mock("../../../src/services/hooks-service.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../src/services/hooks-service.js")
    >();
  return {
    ...actual,
    runHook: vi.fn(() => ({
      hook: "prepare-commit-msg",
      action: "applied",
      detail: "appended Executed-By: x",
    })),
    installHooks: vi.fn(() => ({
      recipe: "hooks",
      target: "lefthook",
      path: "/tmp/lefthook.local.yml",
      action: "installed",
      hook_names: ["prepare-commit-msg"],
    })),
    uninstallHooks: vi.fn(() => ({
      recipe: "hooks",
      target: "lefthook",
      path: "/tmp/lefthook.local.yml",
      action: "removed",
      hook_names: ["prepare-commit-msg"],
    })),
    checkHooksInstalled: vi.fn(() => ({
      recipe: "hooks",
      target: "lefthook",
      path: "/tmp/lefthook.local.yml",
      installed: false,
      lefthook_present: true,
      hook_names: ["prepare-commit-msg"],
    })),
  };
});

import { setupHooksCommands } from "../../../src/commands/hooks.js";
import { outputResult } from "../../../src/common/output.js";
import {
  checkHooksInstalled,
  installHooks,
  LefthookMissingError,
  runHook,
  uninstallHooks,
} from "../../../src/services/hooks-service.js";

function makeProgram(): Command {
  const program = new Command();
  setupHooksCommands(program);
  return program;
}

describe("linear hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("run prepare-commit-msg passes hook + args + actor through", async () => {
    await makeProgram().parseAsync([
      "node",
      "test",
      "hooks",
      "run",
      "prepare-commit-msg",
      "/tmp/msg",
      "--actor",
      "claude",
    ]);
    const call = vi.mocked(runHook).mock.calls[0]?.[0];
    expect(call?.hook).toBe("prepare-commit-msg");
    expect(call?.args).toEqual(["/tmp/msg"]);
    expect(call?.actor).toBe("claude");
    expect(outputResult).toHaveBeenCalled();
  });

  it("rejects an unknown hook name", async () => {
    let captured: unknown;
    vi.spyOn(console, "error").mockImplementation((m) => {
      captured = m;
    });
    await makeProgram().parseAsync([
      "node",
      "test",
      "hooks",
      "run",
      "post-receive",
    ]);
    expect(runHook).not.toHaveBeenCalled();
    expect(String(captured)).toMatch(/unknown hook 'post-receive'/);
  });

  it("list emits the managed hook catalog plus install state", async () => {
    await makeProgram().parseAsync(["node", "test", "hooks", "list"]);
    const payload = vi.mocked(outputResult).mock.calls[0]?.[0] as {
      managed: Array<{ hook: string; has_behavior: boolean }>;
      install: { installed: boolean; target: string };
      note: string;
    };
    expect(
      payload.managed.find((h) => h.hook === "prepare-commit-msg")
        ?.has_behavior,
    ).toBe(true);
    expect(
      payload.managed.find((h) => h.hook === "pre-commit")?.has_behavior,
    ).toBe(false);
    expect(checkHooksInstalled).toHaveBeenCalledWith({
      cwd: expect.any(String),
    });
    expect(payload.install.target).toBe("lefthook");
    expect(payload.install.installed).toBe(false);
    expect(payload.note).toMatch(/lefthook/i);
  });

  it("list surfaces all six managed hooks (lin-6f5k)", async () => {
    await makeProgram().parseAsync(["node", "test", "hooks", "list"]);
    const payload = vi.mocked(outputResult).mock.calls[0]?.[0] as {
      managed: Array<{ hook: string; has_behavior: boolean }>;
    };
    const names = payload.managed.map((m) => m.hook);
    expect(names).toEqual(
      expect.arrayContaining([
        "pre-commit",
        "post-merge",
        "pre-push",
        "post-checkout",
        "prepare-commit-msg",
        "post-commit",
      ]),
    );
    expect(names).toHaveLength(6);
    // active vs inert classification
    const active = payload.managed
      .filter((m) => m.has_behavior)
      .map((m) => m.hook)
      .sort();
    expect(active).toEqual(["post-commit", "prepare-commit-msg"]);
  });

  it("install calls installHooks with cwd and outputs the result", async () => {
    await makeProgram().parseAsync(["node", "test", "hooks", "install"]);
    expect(installHooks).toHaveBeenCalledWith({ cwd: expect.any(String) });
    expect(outputResult).toHaveBeenCalled();
  });

  it("install surfaces a LefthookMissingError with a structured error", async () => {
    vi.mocked(installHooks).mockImplementationOnce(() => {
      throw new LefthookMissingError("/some/dir");
    });
    let captured: unknown;
    vi.spyOn(console, "error").mockImplementation((m) => {
      captured = m;
    });
    await makeProgram().parseAsync(["node", "test", "hooks", "install"]);
    expect(String(captured)).toMatch(/lefthook\.yml not found/);
  });

  it("uninstall calls uninstallHooks with cwd", async () => {
    await makeProgram().parseAsync(["node", "test", "hooks", "uninstall"]);
    expect(uninstallHooks).toHaveBeenCalledWith({ cwd: expect.any(String) });
    expect(outputResult).toHaveBeenCalled();
  });
});
