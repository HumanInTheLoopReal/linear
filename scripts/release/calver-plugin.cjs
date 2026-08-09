const commitAnalyzer = require("@semantic-release/commit-analyzer");
const { computeCalverVersion, isMonthRollover } = require("./calver.cjs");

// semantic-release hardcodes 1.0.0 when a branch has no release tag, and no plugin
// can override it: plugins receive a deep clone of the release context. Calver cannot
// parse or continue from 1.0.0 either, so a repository has to be seeded by hand.
const NO_PRIOR_RELEASE =
  "calver-plugin: no previous release found on this branch. semantic-release starts " +
  "an untagged repository at 1.0.0, which is not a calver version. Tag the commit " +
  "preceding this release with the calver version it shipped as (v<year>.<month>.<patch>, " +
  "for example v2026.8.0), push the tag, then rerun.";

function mapCalverReleaseType({
  branchName,
  releaseType,
  lastVersion,
  nowIso,
}) {
  if (!releaseType) {
    return null;
  }

  if (branchName !== "main" && branchName !== "next") {
    return releaseType;
  }

  if (isMonthRollover({ lastVersion, branchName, nowIso })) {
    return "minor";
  }

  return "patch";
}

async function analyzeCommits(pluginConfig, context) {
  const releaseType = await commitAnalyzer.analyzeCommits(
    pluginConfig,
    context,
  );

  if (releaseType && !context.lastRelease?.version) {
    throw new Error(NO_PRIOR_RELEASE);
  }

  const branchName = context.branch?.name ?? "main";
  const lastVersion = context.lastRelease?.version;
  const nowIso = new Date().toISOString();

  const mappedReleaseType = mapCalverReleaseType({
    branchName,
    releaseType,
    lastVersion,
    nowIso,
  });

  if (releaseType !== mappedReleaseType) {
    context.logger.log(
      `calver-plugin: mapped release type ${releaseType} -> ${mappedReleaseType} on ${branchName}`,
    );
  }

  return mappedReleaseType;
}

async function verifyRelease(_, context) {
  const lastVersion = context.lastRelease?.version;
  const branchName = context.branch?.name ?? "main";
  const semanticVersion = context.nextRelease?.version;

  if (!lastVersion) {
    throw new Error(NO_PRIOR_RELEASE);
  }

  if (!semanticVersion) {
    throw new Error("calver-plugin: missing context.nextRelease.version");
  }

  const expectedVersion = computeCalverVersion({
    lastVersion,
    branchName,
    nowIso: new Date().toISOString(),
  });

  if (semanticVersion !== expectedVersion) {
    throw new Error(
      `calver-plugin: semantic-release computed ${semanticVersion} but calver requires ${expectedVersion}`,
    );
  }

  context.logger.log(
    `calver-plugin: verified semantic-release version ${semanticVersion}`,
  );
}

module.exports = {
  analyzeCommits,
  mapCalverReleaseType,
  verifyRelease,
};
