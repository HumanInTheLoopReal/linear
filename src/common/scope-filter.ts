import type { IssueFilter } from "../gql/graphql.js";
import { getConfig } from "./config-store.js";

/**
 * Resolved scope for the current shell session, drawn from the merged
 * local + global config (env > local > global precedence). All fields
 * are optional — the absence of every field means "no scope, do not
 * filter and do not auto-tag".
 *
 *   - `label`   — the `git:<name>` marker label written by the implicit
 *                 bootstrap. AND-ed into read filters, auto-appended to
 *                 write `labelIds`.
 *   - `team`    — per-repo team key override (`scope.team`). Read by
 *                 `getDefaultTeam`; not surfaced as a read-side filter
 *                 here because team resolution already happens upstream
 *                 in the `--team` flow.
 *   - `project` — per-repo default project for `issues create`
 *                 (`scope.default_project`). Write-side only.
 */
export interface ActiveScope {
  label?: string;
  team?: string;
  project?: string;
}

/**
 * Return value for `--no-scope` overrides at the command layer. Equivalent
 * to "scope is not active for this call".
 */
export const NO_SCOPE: ActiveScope = {};

/**
 * Translate Commander's tri-state `options.scope` (from a `.option("--no-scope")`
 * + `.option("--scope <label>")` pair, with no explicit default) into a concrete
 * scope decision:
 *
 *   - `true`     — neither flag passed (default for negatable boolean)
 *                  → return the implicit scope from config.
 *   - `false`    — `--no-scope` was passed
 *                  → return `undefined` (caller should treat as "skip scope").
 *   - `string`   — `--scope <label>` was passed
 *                  → return scope with the supplied label as override.
 *
 * Commander does NOT set `options.noScope` — both flags map to the same
 * underlying attribute (`scope`). Read it as a sum type, not as two booleans.
 */
export function resolveScopeOption(
  optionScope: string | boolean | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ActiveScope | undefined {
  if (optionScope === false) return undefined;
  const override =
    typeof optionScope === "string" ? { label: optionScope } : undefined;
  return getActiveScope(env, override);
}

/**
 * Read scope-related keys out of the merged config layers. Empty fields
 * are omitted (callers test for presence, not for the empty string).
 *
 * The optional `override` parameter lets the `--scope <label>` flag
 * substitute a different label without changing the on-disk config.
 */
export function getActiveScope(
  env: NodeJS.ProcessEnv = process.env,
  override?: { label?: string },
): ActiveScope {
  const result: ActiveScope = {};
  const label = override?.label ?? getConfig("scope.label", env).value;
  if (label) result.label = label;
  const team = getConfig("scope.team", env).value;
  if (team) result.team = team;
  const project = getConfig("scope.default_project", env).value;
  if (project) result.project = project;
  return result;
}

/**
 * Build the IssueFilter fragments that AND scope into a query.
 *
 * Currently emits a single label fragment when `scope.label` is set; the
 * `team` and `project` fields on the scope are consumed elsewhere (team
 * by `getDefaultTeam`, project by the write-side default in
 * `issues create`). Returning fragments instead of mutating the input
 * lets each caller decide whether to AND or splice into a larger
 * boolean tree.
 */
export function buildScopeFragments(scope: ActiveScope): IssueFilter[] {
  const fragments: IssueFilter[] = [];
  if (scope.label) {
    fragments.push({ labels: { some: { name: { eq: scope.label } } } });
  }
  return fragments;
}

/**
 * Convenience for callers that already have a single composite
 * `IssueFilter` (or no filter at all) and just want scope AND-ed onto
 * it.
 *
 *   - `base = undefined, scope active`   → returns the bare scope filter
 *     (`{ labels: { some: ... } }`).
 *   - `base = undefined, scope absent`   → returns `undefined`, matching
 *     the "no filter" call shape downstream consumers already expect.
 *   - `base set, scope active`           → returns `{ and: [base, ...fragments] }`.
 *   - `base set, scope absent`           → returns `base` unchanged.
 */
export function applyScopeToFilter(
  base: IssueFilter | undefined,
  scope: ActiveScope | undefined,
): IssueFilter | undefined {
  if (!scope) return base;
  const fragments = buildScopeFragments(scope);
  if (fragments.length === 0) return base;
  if (!base) {
    return fragments.length === 1 ? fragments[0] : { and: fragments };
  }
  return { and: [base, ...fragments] };
}
