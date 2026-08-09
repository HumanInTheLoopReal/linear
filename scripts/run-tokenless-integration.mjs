import { spawnSync } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npm, ["run", "test:integration"], {
  stdio: "inherit",
  env: { ...process.env, LINEAR_API_TOKEN: "" },
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
