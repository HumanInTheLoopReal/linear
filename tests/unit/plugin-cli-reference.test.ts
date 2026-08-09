import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildProgram } from "../../src/program.js";

const REFERENCE_PATH = fileURLToPath(
  new URL(
    "../../plugins/linear/skills/linear/resources/CLI_REFERENCE.md",
    import.meta.url,
  ),
);

function reference(): string {
  return fs.readFileSync(REFERENCE_PATH, "utf8");
}

describe("plugin CLI reference", () => {
  it("documents only doctor check names accepted by the real command", () => {
    const doctor = buildProgram().commands.find(
      (command) => command.name() === "doctor",
    );
    const checkDescription = doctor?.options.find((option) =>
      option.flags.includes("--check"),
    )?.description;
    const documented = [
      ...reference().matchAll(/linear doctor --check=([\w-]+)/g),
    ].map((match) => match[1]);

    expect(documented.length).toBeGreaterThan(0);
    for (const check of documented) {
      expect(checkDescription).toMatch(new RegExp(`\\b${check}\\b`));
    }
  });

  it("keeps stale status examples within the command's accepted vocabulary", () => {
    const issues = buildProgram().commands.find(
      (command) => command.name() === "issues",
    );
    const stale = issues?.commands.find(
      (command) => command.name() === "stale",
    );
    const statusDescription = stale?.options.find((option) =>
      option.flags.includes("--status"),
    )?.description;
    const documented = [
      ...reference().matchAll(/linear stale[^\n]*--status\s+"?([\w-]+)"?/g),
    ].map((match) => match[1]);

    expect(documented.length).toBeGreaterThan(0);
    for (const status of documented) {
      expect(statusDescription).toMatch(new RegExp(`\\b${status}\\b`));
    }
  });

  it("uses the implemented endpoint environment variable", () => {
    expect(reference()).toContain("LINEAR_ENDPOINT=");
    expect(reference()).not.toContain("LINEAR_API_URL=");
  });

  it("does not document --team as a global option", () => {
    expect(reference()).not.toMatch(/linear\s+--team\b/);
    expect(reference()).toContain("linear issues list --team ENG");
  });

  it("uses implemented audit record flags", () => {
    const audit = buildProgram().commands.find(
      (command) => command.name() === "audit",
    );
    const record = audit?.commands.find(
      (command) => command.name() === "record",
    );
    const flags = new Set(record?.options.map((option) => option.long));

    expect(flags).toContain("--kind");
    expect(flags).toContain("--tool-name");
    expect(flags).toContain("--issue-id");
    expect(reference()).not.toContain("audit record --action");
    expect(reference()).not.toContain("--target ENG-42");
  });
});
