/**
 * `.linear/recipes.json` loader + writer for user-defined recipes
 * (added via `linear setup --add <name> <path>`).
 *
 * Recipes are persisted as JSON (no TOML dependency) with the shape
 * `{ "recipes": { "<name>": { name, kind: "file", targetPath, ... } } }`.
 * User recipes are always `kind: "file"`, so install/check/remove
 * dispatch through the existing `installFileRecipe` trio.
 */

import fs from "node:fs";
import path from "node:path";
import { WORKFLOW_BODY } from "../../templates/workflow.js";
import { ensureParentDir } from "./file-recipe.js";
import type { RecipeDef } from "./types.js";

export const USER_RECIPES_DIR = ".linear";
export const USER_RECIPES_FILE = "recipes.json";

export interface UserRecipesFile {
  recipes: Record<string, RecipeDef>;
}

function userRecipesPath(cwd: string): string {
  return path.join(cwd, USER_RECIPES_DIR, USER_RECIPES_FILE);
}

/**
 * Read `.linear/recipes.json` from cwd. Returns `{}` (no error) if the
 * file is absent — having no user recipes is the common case.
 */
export function loadUserRecipes(cwd: string): Record<string, RecipeDef> {
  const filePath = userRecipesPath(cwd);
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) return {};
  let parsed: UserRecipesFile;
  try {
    parsed = JSON.parse(raw) as UserRecipesFile;
  } catch (e) {
    throw new Error(
      `Failed to parse ${filePath}: ${(e as Error).message}. Refusing to overwrite.`,
    );
  }
  return parsed.recipes ?? {};
}

/**
 * Persist a user recipe to `.linear/recipes.json` (creates the dir/file
 * on first write). User recipes are always `kind: "file"` and always
 * carry the linear workflow template — exposing template overrides via
 * `--add` is out of scope.
 *
 * `targetPath` may be relative (resolved from cwd at install time) or
 * absolute. Existing entries with the same name are overwritten.
 */
export function saveUserRecipe(
  cwd: string,
  name: string,
  targetPath: string,
): RecipeDef {
  const filePath = userRecipesPath(cwd);
  const existing = loadUserRecipes(cwd);
  const normalized = name.toLowerCase();
  const recipe: RecipeDef = {
    name: normalized,
    description: `user-defined recipe → ${targetPath}`,
    kind: "file",
    targetPath,
    template: WORKFLOW_BODY,
  };
  existing[normalized] = recipe;
  ensureParentDir(filePath);
  fs.writeFileSync(
    filePath,
    `${JSON.stringify({ recipes: existing }, null, 2)}\n`,
    { mode: 0o644 },
  );
  return recipe;
}
