import { describe, expect, it } from "vitest";
import {
  bashCompletionScript,
  type CompletionShell,
  completionShells,
  fishCompletionScript,
  generateCompletionScript,
  isCompletionShell,
  zshCompletionScript,
} from "../../../src/common/completion-scripts.js";

describe("completion-scripts", () => {
  describe("isCompletionShell", () => {
    it("accepts the supported shells", () => {
      expect(isCompletionShell("bash")).toBe(true);
      expect(isCompletionShell("zsh")).toBe(true);
      expect(isCompletionShell("fish")).toBe(true);
    });

    it("rejects unsupported shells", () => {
      expect(isCompletionShell("powershell")).toBe(false);
      expect(isCompletionShell("nu")).toBe(false);
      expect(isCompletionShell("")).toBe(false);
    });
  });

  describe("completionShells", () => {
    it("lists bash, zsh, fish in order (no powershell)", () => {
      expect(completionShells()).toEqual(["bash", "zsh", "fish"]);
    });
  });

  describe("generateCompletionScript", () => {
    it.each([
      "bash",
      "zsh",
      "fish",
    ] as CompletionShell[])("returns a non-empty script for %s", (shell) => {
      const script = generateCompletionScript(shell);
      expect(script.length).toBeGreaterThan(100);
      expect(script).toContain("linear");
    });

    it("dispatches to the same output as the per-shell function", () => {
      expect(generateCompletionScript("bash")).toBe(
        bashCompletionScript(false),
      );
      expect(generateCompletionScript("zsh")).toBe(zshCompletionScript(false));
      expect(generateCompletionScript("fish")).toBe(
        fishCompletionScript(false),
      );
    });
  });

  describe("bash script", () => {
    it("registers __start_linear with linear-namespaced function names", () => {
      const script = bashCompletionScript(false);
      expect(script).toContain("__start_linear");
      expect(script).toContain("complete -o default -F __start_linear linear");
      // no leftover legacy function names
      expect(script).not.toContain("__bd");
      expect(script).not.toContain("__start_bd");
    });

    it("calls __complete with descriptions and __completeNoDesc without", () => {
      expect(bashCompletionScript(false)).toContain(" __complete ");
      expect(bashCompletionScript(true)).toContain(" __completeNoDesc ");
    });
  });

  describe("zsh script", () => {
    it("emits a #compdef stub for linear", () => {
      const script = zshCompletionScript(false);
      expect(script.startsWith("#compdef linear")).toBe(true);
      expect(script).toContain("_linear");
      expect(script).not.toContain("_bd");
    });

    it("uses _describe with descriptions and compadd without", () => {
      expect(zshCompletionScript(false)).toContain("_describe");
      expect(zshCompletionScript(true)).toContain("compadd");
      expect(zshCompletionScript(true)).not.toContain("_describe");
    });
  });

  describe("fish script", () => {
    it("registers completion for linear and rebrands helpers", () => {
      const script = fishCompletionScript(false);
      expect(script).toContain("complete -c linear");
      expect(script).toContain("__linear_perform_completion");
      expect(script).not.toContain("__fish_bd");
    });

    it("includes the -d description arg only with descriptions", () => {
      expect(fishCompletionScript(false)).toContain('-d "$description"');
      expect(fishCompletionScript(true)).not.toContain('-d "$description"');
    });
  });
});
