/**
 * Canonical Linear skill assets installed by `linear setup agent-skill`.
 *
 * The public plugin tree is the single source of truth. Both source execution
 * (`src/templates`) and compiled execution (`dist/templates`) resolve the same
 * repository-root `plugins/` path, which is included in the npm package.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(
  here,
  "../../plugins/linear/skills/linear",
);

function readSkillFile(relativePath: string): string {
  return fs.readFileSync(path.join(skillRoot, relativePath), "utf8");
}

/** One-line notice prepended only to non-plugin SKILL.md snapshots. */
export const AGENT_SKILL_SNAPSHOT_HEADER =
  "<!-- This is a snapshot. If your tool supports Claude Code plugins, install via `/plugin install linear` instead. -->\n";

/** Canonical process-first skill router. */
export const AGENT_SKILL_BODY = readSkillFile("SKILL.md");

/** Canonical Codex skill interface. */
export const AGENT_SKILL_OPENAI_YAML = readSkillFile(
  "agents/openai.yaml",
);

/** Snapshot body written to `.agents/skills/linear/SKILL.md`. */
export const AGENT_SKILL_SNAPSHOT =
  `${AGENT_SKILL_SNAPSHOT_HEADER}${AGENT_SKILL_BODY}`;

export interface AgentSkillSupportFile {
  targetPath: string;
  template: string;
}

/**
 * Install every process reference and advanced resource beside the snapshot.
 * Sorted discovery keeps recipe output deterministic while allowing references
 * to evolve without duplicating their bodies in TypeScript constants.
 */
export const AGENT_SKILL_SUPPORT_FILES: readonly AgentSkillSupportFile[] = [
  "references",
  "resources",
].flatMap((directory) =>
  fs
    .readdirSync(path.join(skillRoot, directory))
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => ({
      targetPath: `.agents/skills/linear/${directory}/${name}`,
      template: readSkillFile(`${directory}/${name}`),
    })),
);
