/**
 * Shared `linear setup` types. Collapses the per-recipe common shape into
 * one module so every recipe in `src/services/setup/` works against the
 * same vocabulary.
 *
 * Kept deliberately small — recipe-specific result envelopes (Claude hook,
 * Codex section, Mux layered) keep their richer shape next to their
 * implementations. This file is the cross-cutting taxonomy only.
 */

export type RecipeKind = "file" | "hook" | "section" | "multifile";

/**
 * One entry in a multifile recipe — a (targetPath, template) pair the
 * shared install/check/remove trio writes / verifies / unlinks atomically.
 * Every entry in `paths` is a sibling that must round-trip together.
 */
export interface MultiFileEntry {
  /** Relative-to-CWD target path (joined via `path.join` at install time). */
  targetPath: string;
  /** Template body written to `targetPath`. */
  template: string;
}

export interface RecipeDef {
  name: string;
  description: string;
  kind: RecipeKind;
  /** File recipes: relative-to-CWD target path. Undefined for hook recipes. */
  targetPath?: string;
  /** File recipes: template content. Undefined for hook recipes. */
  template?: string;
  /**
   * File recipes: pre-rebrand target path. When set, install removes any
   * orphaned file at this path, and remove sweeps it alongside `targetPath`.
   * Check ignores it — the new path is the only one considered current.
   */
  legacyTargetPath?: string;
  /**
   * Multifile recipes: list of sibling (targetPath, template) entries written
   * atomically together. Install creates every parent dir and writes each
   * file; check reports per-file status + an aggregate `installed`; remove
   * unlinks each present file and prunes empty parent dirs.
   */
  files?: MultiFileEntry[];
  /**
   * Multifile recipes: list of parent directories (relative-to-CWD) that
   * `remove` should prune when empty after the file unlinks. Ordered
   * deepest-first so `.aider/foo` is tried before `.aider`. Optional —
   * empty/undefined means just unlink the files and leave dirs alone.
   */
  emptyDirs?: string[];
}

export interface RecipeListEntry extends RecipeDef {
  source: "built-in" | "user";
}

export interface FileRecipeResult {
  recipe: string;
  path: string;
  action: "installed" | "checked" | "removed";
  installed?: boolean;
}

export interface MultiFileEntryResult {
  path: string;
  /** True iff the file exists and (on check) matches the recipe template. */
  installed: boolean;
}

export interface MultiFileRecipeResult {
  recipe: string;
  paths: string[];
  action: "installed" | "checked" | "removed";
  entries: MultiFileEntryResult[];
  /**
   * Aggregate status:
   *   - install: true once every entry has been written (always true on
   *     success, since we always overwrite).
   *   - check: true iff every entry exists AND its body matches the
   *     template byte-for-byte.
   *   - remove: true iff at least one file actually existed and was unlinked
   *     ("did anything happen?" semantics).
   */
  installed: boolean;
}
