import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const RELEASING_TYPES = new Set(["feat", "fix", "perf", "revert"]);
const HEADER = /^(?<type>[a-z]+)(?:\((?<scope>[^)]*)\))?(?<breaking>!)?:\s/;

/** Pull releaseRules out of .releaserc.cjs so this never drifts from the config. */
export function loadReleaseRules(config) {
  for (const plugin of config.plugins ?? []) {
    if (!Array.isArray(plugin)) continue;
    const rules = plugin[1]?.releaseRules;
    if (Array.isArray(rules)) return rules;
  }
  return [];
}

export function classify(subject, body, rules) {
  const match = HEADER.exec(subject);
  if (!match?.groups) {
    return { releases: false, reason: "not a conventional commit" };
  }

  const { type, scope, breaking } = match.groups;
  if (breaking || /^BREAKING[ -]CHANGE:/m.test(body ?? "")) {
    return { releases: true, reason: "breaking change" };
  }

  for (const rule of rules) {
    if (rule.release !== false) continue;
    if (rule.type && rule.type !== type) continue;
    if (rule.scope && rule.scope !== scope) continue;
    if (!rule.type && !rule.scope) continue;
    const on = rule.type ? `type "${rule.type}"` : `scope "${rule.scope}"`;
    return { releases: false, reason: `suppressed by ${on}` };
  }

  return RELEASING_TYPES.has(type)
    ? { releases: true, reason: `type "${type}"` }
    : { releases: false, reason: `type "${type}" never releases` };
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function commitsSinceLastTag() {
  let range;
  try {
    range = `${git(["describe", "--tags", "--abbrev=0"])}..HEAD`;
  } catch {
    range = "HEAD";
  }
  const log = git(["log", range, "--format=%H%x1f%s%x1f%b%x1e"]);
  return log
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [sha, subject, body] = entry.split("\x1f");
      return { sha, subject, body };
    });
}

export function report(commits, rules) {
  const lines = [];
  let willRelease = false;

  for (const { sha, subject, body } of commits) {
    const { releases, reason } = classify(subject, body, rules);
    if (releases) willRelease = true;
    lines.push(
      `${releases ? "release" : "skip   "}  ${sha.slice(0, 7)}  ${subject}  (${reason})`,
    );
  }

  if (commits.length === 0) {
    lines.push("No commits since the last release tag.");
  }

  lines.push(
    "",
    willRelease
      ? "Verdict: pushing this to main publishes a new version."
      : "Verdict: NO release. Nothing will be published, and the workflow will still pass.",
  );

  return { text: lines.join("\n"), willRelease };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rules = loadReleaseRules(require("../../.releaserc.cjs"));
  const { text } = report(commitsSinceLastTag(), rules);
  process.stdout.write(`${text}\n`);
}
