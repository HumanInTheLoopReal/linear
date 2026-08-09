/**
 * Shared install/check/remove for `kind: "multifile"` recipes — every
 * recipe that writes multiple sibling files atomically (aider's
 * .aider.conf.yml + .aider/LINEAR.md + .aider/README.md, junie's
 * guidelines.md + mcp/mcp.json, agent-skill's router + references/resources +
 * agents/openai.yaml).
 *
 * Each entry in `recipe.files` is an independent (targetPath, template)
 * pair; the trio dispatches over the list with shared semantics:
 *
 *   - install: ensure each parent dir, write each file with 0o644.
 *   - check: each file present and body byte-equal to the template? Aggregate
 *     `installed` is true iff every entry is current.
 *   - remove: unlink each present file, then prune `emptyDirs` deepest-first
 *     when the dir is empty.
 */

import fs from "node:fs";
import path from "node:path";
import { ensureParentDir } from "./file-recipe.js";
import type {
  MultiFileEntry,
  MultiFileEntryResult,
  MultiFileRecipeResult,
  RecipeDef,
} from "./types.js";

function assertMultiFile(
  recipe: RecipeDef,
): asserts recipe is RecipeDef & { files: MultiFileEntry[] } {
  if (
    recipe.kind !== "multifile" ||
    !recipe.files ||
    recipe.files.length === 0
  ) {
    throw new Error(
      `recipe '${recipe.name}' is not a multifile recipe (kind=${recipe.kind})`,
    );
  }
}

export function installMultiFileRecipe(
  recipe: RecipeDef,
  cwd: string,
): MultiFileRecipeResult {
  assertMultiFile(recipe);
  const entries: MultiFileEntryResult[] = [];
  const paths: string[] = [];
  for (const entry of recipe.files) {
    const fullPath = path.join(cwd, entry.targetPath);
    ensureParentDir(fullPath);
    fs.writeFileSync(fullPath, entry.template, { mode: 0o644 });
    entries.push({ path: fullPath, installed: true });
    paths.push(fullPath);
  }
  return {
    recipe: recipe.name,
    paths,
    action: "installed",
    entries,
    installed: true,
  };
}

export function checkMultiFileRecipe(
  recipe: RecipeDef,
  cwd: string,
): MultiFileRecipeResult {
  assertMultiFile(recipe);
  const entries: MultiFileEntryResult[] = [];
  const paths: string[] = [];
  let allCurrent = true;
  for (const entry of recipe.files) {
    const fullPath = path.join(cwd, entry.targetPath);
    paths.push(fullPath);
    let installed = false;
    if (fs.existsSync(fullPath)) {
      const current = fs.readFileSync(fullPath, "utf8");
      installed = current === entry.template;
    }
    if (!installed) allCurrent = false;
    entries.push({ path: fullPath, installed });
  }
  return {
    recipe: recipe.name,
    paths,
    action: "checked",
    entries,
    installed: allCurrent,
  };
}

export function removeMultiFileRecipe(
  recipe: RecipeDef,
  cwd: string,
): MultiFileRecipeResult {
  assertMultiFile(recipe);
  const entries: MultiFileEntryResult[] = [];
  const paths: string[] = [];
  let anyRemoved = false;
  for (const entry of recipe.files) {
    const fullPath = path.join(cwd, entry.targetPath);
    paths.push(fullPath);
    const existed = fs.existsSync(fullPath);
    if (existed) {
      fs.unlinkSync(fullPath);
      anyRemoved = true;
    }
    // `installed` here records whether the file was actually present
    // pre-remove.
    entries.push({ path: fullPath, installed: existed });
  }
  // Prune now-empty parent dirs. Deepest-first ordering is the caller's
  // responsibility — we just try-remove each in order, silently ignoring
  // non-empty / nonexistent dirs.
  if (recipe.emptyDirs) {
    for (const dir of recipe.emptyDirs) {
      const fullDir = path.join(cwd, dir);
      try {
        const items = fs.readdirSync(fullDir);
        if (items.length === 0) fs.rmdirSync(fullDir);
      } catch {
        // Dir doesn't exist or isn't empty — both fine, skip.
      }
    }
  }
  return {
    recipe: recipe.name,
    paths,
    action: "removed",
    entries,
    installed: anyRemoved,
  };
}
