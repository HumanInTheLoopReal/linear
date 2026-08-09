/**
 * Shared install/check/remove for `kind: "file"` recipes — every recipe
 * that owns a single file at a fixed project-relative path
 * (cursor, windsurf, cody, kilocode, etc.).
 *
 * One file, overwrite-on-install, unlink-on-remove, exists-check. The
 * optional `legacyTargetPath` field lets a recipe sweep an older file
 * location (e.g. a renamed config file) on install/remove.
 */

import fs from "node:fs";
import path from "node:path";
import type { FileRecipeResult, RecipeDef } from "./types.js";

export function ensureParentDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (dir && dir !== "." && dir !== "/") {
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  }
}

export function installFileRecipe(
  recipe: RecipeDef,
  cwd: string,
): FileRecipeResult {
  if (recipe.kind !== "file" || !recipe.targetPath || !recipe.template) {
    throw new Error(
      `recipe '${recipe.name}' is not a file recipe (kind=${recipe.kind})`,
    );
  }
  if (recipe.legacyTargetPath) {
    const legacyPath = path.join(cwd, recipe.legacyTargetPath);
    if (fs.existsSync(legacyPath)) fs.unlinkSync(legacyPath);
  }
  const fullPath = path.join(cwd, recipe.targetPath);
  ensureParentDir(fullPath);
  fs.writeFileSync(fullPath, recipe.template, { mode: 0o644 });
  return {
    recipe: recipe.name,
    path: fullPath,
    action: "installed",
  };
}

export function checkFileRecipe(
  recipe: RecipeDef,
  cwd: string,
): FileRecipeResult {
  if (recipe.kind !== "file" || !recipe.targetPath) {
    throw new Error(
      `recipe '${recipe.name}' is not a file recipe (kind=${recipe.kind})`,
    );
  }
  const fullPath = path.join(cwd, recipe.targetPath);
  return {
    recipe: recipe.name,
    path: fullPath,
    action: "checked",
    installed: fs.existsSync(fullPath),
  };
}

export function removeFileRecipe(
  recipe: RecipeDef,
  cwd: string,
): FileRecipeResult {
  if (recipe.kind !== "file" || !recipe.targetPath) {
    throw new Error(
      `recipe '${recipe.name}' is not a file recipe (kind=${recipe.kind})`,
    );
  }
  const fullPath = path.join(cwd, recipe.targetPath);
  const existed = fs.existsSync(fullPath);
  if (existed) fs.unlinkSync(fullPath);
  let legacyExisted = false;
  if (recipe.legacyTargetPath) {
    const legacyPath = path.join(cwd, recipe.legacyTargetPath);
    if (fs.existsSync(legacyPath)) {
      fs.unlinkSync(legacyPath);
      legacyExisted = true;
    }
  }
  return {
    recipe: recipe.name,
    path: fullPath,
    action: "removed",
    installed: existed || legacyExisted,
  };
}
