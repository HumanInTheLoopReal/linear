import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/common/context.js", () => ({
  getRootOpts: vi.fn(() => ({ apiToken: "test-token" })),
  createContext: vi.fn(() => ({
    gql: { request: vi.fn() },
    sdk: { sdk: {} },
  })),
}));

vi.mock("../../../src/common/config-store.js", () => ({
  getDefaultTeam: vi.fn(() => "TES"),
}));

vi.mock("../../../src/resolvers/team-resolver.js", () => ({
  resolveTeamId: vi.fn(async () => "team-uuid"),
}));

vi.mock("../../../src/services/issue-service.js", () => ({
  createIssue: vi.fn(),
  listIssues: vi.fn(),
  getIssue: vi.fn(),
}));

vi.mock("../../../src/services/issue-relation-service.js", () => ({
  createIssueRelation: vi.fn(async () => ({ id: "rel-uuid" })),
  listIssueRelations: vi.fn(async () => []),
}));

vi.mock("../../../src/resolvers/issue-resolver.js", () => ({
  resolveIssueId: vi.fn(async (_c: unknown, id: string) => `uuid-${id}`),
}));

vi.mock("../../../src/resolvers/user-resolver.js", () => ({
  resolveUserId: vi.fn(async (_c: unknown, user: string) => `user-${user}`),
}));

vi.mock("../../../src/services/label-service.js", () => ({
  ensureWorkspaceLabel: vi.fn(async (_c, name: string) => `label-${name}`),
}));

vi.mock("../../../src/services/auth-service.js", () => ({
  validateToken: vi.fn(),
}));

vi.mock("../../../src/common/output.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/common/output.js")>();
  return {
    ...actual,
    outputResult: vi.fn(),
    outputSuccess: vi.fn(),
  };
});

vi.mock(
  "../../../src/services/molecules-service.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../src/services/molecules-service.js")
      >();
    return {
      ...actual,
      defaultSearchPaths: vi.fn(),
      listProtos: vi.fn(),
      getProto: vi.fn(),
    };
  },
);

import {
  classifySource,
  formatMoleculesCurrent,
  formatMoleculesList,
  formatMoleculesPour,
  formatMoleculesProgress,
  formatMoleculesShow,
  parseVarToken,
  setupMoleculesCommands,
  substituteIssueFields,
  toCurrentEntry,
} from "../../../src/commands/molecules.js";
import { outputResult } from "../../../src/common/output.js";
import { resolveUserId } from "../../../src/resolvers/user-resolver.js";
import { validateToken } from "../../../src/services/auth-service.js";
import * as relService from "../../../src/services/issue-relation-service.js";
import * as issueService from "../../../src/services/issue-service.js";
import * as molService from "../../../src/services/molecules-service.js";

function createProgram(): Command {
  const program = new Command();
  setupMoleculesCommands(program);
  return program;
}

describe("classifySource", () => {
  const paths = [
    "/proj/.linear/molecules",
    "/home/u/.linear/molecules",
    "/dist/molecules/builtin",
  ];

  it("project takes precedence", () => {
    expect(classifySource("/proj/.linear/molecules/x.toml", paths)).toBe(
      "project",
    );
  });
  it("user when not project", () => {
    expect(classifySource("/home/u/.linear/molecules/x.toml", paths)).toBe(
      "user",
    );
  });
  it("builtin when not project or user", () => {
    expect(classifySource("/dist/molecules/builtin/x.toml", paths)).toBe(
      "builtin",
    );
  });
  it("'other' for paths not in defaults", () => {
    expect(classifySource("/somewhere/else/x.toml", paths)).toBe("other");
  });
});

describe("formatMoleculesList", () => {
  it("renders the 🧪 header with count + search-path count", () => {
    const out = formatMoleculesList({
      count: 2,
      protos: [
        {
          name: "a",
          description: "first",
          source: "builtin",
          path: "/dist/molecules/builtin/a.toml",
          variables: [],
          issue_count: 1,
        },
        {
          name: "b",
          description: "second",
          source: "builtin",
          path: "/dist/molecules/builtin/b.toml",
          variables: [],
          issue_count: 1,
        },
      ],
    });
    expect(out).toMatch(/🧪 Molecules \(2 from 1 search path\)/);
    expect(out).toContain("builtin/");
    expect(out).toContain("a");
    expect(out).toContain("first");
    expect(out).toContain("Use `linear molecules show <name>`");
  });

  it("groups protos by source bucket with project shown first", () => {
    const out = formatMoleculesList({
      count: 3,
      protos: [
        {
          name: "from-proj",
          description: "p",
          source: "project",
          path: "/proj/.linear/molecules/from-proj.toml",
          variables: [],
          issue_count: 1,
        },
        {
          name: "from-user",
          description: "u",
          source: "user",
          path: "/home/u/.linear/molecules/from-user.toml",
          variables: [],
          issue_count: 1,
        },
        {
          name: "from-builtin",
          description: "b",
          source: "builtin",
          path: "/dist/molecules/builtin/from-builtin.toml",
          variables: [],
          issue_count: 1,
        },
      ],
    });
    const projectIdx = out.indexOf(".linear/molecules/ (project)");
    const userIdx = out.indexOf("(user)");
    const builtinIdx = out.indexOf("builtin/");
    expect(projectIdx).toBeGreaterThan(-1);
    expect(userIdx).toBeGreaterThan(projectIdx);
    expect(builtinIdx).toBeGreaterThan(userIdx);
  });

  it("emits the empty-state message when count is 0", () => {
    const out = formatMoleculesList({ count: 0, protos: [] });
    expect(out).toContain("No molecules found");
    expect(out).toContain(".linear/molecules/");
  });

  it("uses '(no description)' fallback when description is null", () => {
    const out = formatMoleculesList({
      count: 1,
      protos: [
        {
          name: "x",
          description: null,
          source: "builtin",
          path: "/dist/molecules/builtin/x.toml",
          variables: [],
          issue_count: 1,
        },
      ],
    });
    expect(out).toContain("(no description)");
  });
});

describe("linear molecules list (command dispatch)", () => {
  let tmpProject: string;
  let tmpBuiltin: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), "mol-cmd-proj-"));
    tmpBuiltin = fs.mkdtempSync(path.join(os.tmpdir(), "mol-cmd-builtin-"));
    vi.mocked(molService.defaultSearchPaths).mockReturnValue([
      tmpProject,
      "/home/nonexistent",
      tmpBuiltin,
    ]);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    fs.rmSync(tmpProject, { recursive: true, force: true });
    fs.rmSync(tmpBuiltin, { recursive: true, force: true });
  });

  it("emits {count, protos[]} envelope with source classification", async () => {
    vi.mocked(molService.listProtos).mockReturnValueOnce([
      {
        name: "alpha",
        description: "first",
        variables: [{ name: "k" }],
        issues: [{ key: "a", title: "x" }],
        source: path.join(tmpProject, "alpha.toml"),
      },
      {
        name: "beta",
        description: "second",
        variables: [],
        issues: [
          { key: "a", title: "x" },
          { key: "b", title: "y" },
        ],
        source: path.join(tmpBuiltin, "beta.toml"),
      },
    ]);

    const program = createProgram();
    await program.parseAsync(["node", "test", "molecules", "list"]);

    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({
        count: 2,
        protos: expect.arrayContaining([
          expect.objectContaining({
            name: "alpha",
            source: "project",
            issue_count: 1,
            variables: [{ name: "k", description: null }],
          }),
          expect.objectContaining({
            name: "beta",
            source: "builtin",
            issue_count: 2,
          }),
        ]),
      }),
      expect.any(Function),
      expect.any(Object),
    );
  });

  it("emits an empty envelope when no protos exist", async () => {
    vi.mocked(molService.listProtos).mockReturnValueOnce([]);

    const program = createProgram();
    await program.parseAsync(["node", "test", "molecules", "list"]);

    expect(outputResult).toHaveBeenCalledWith(
      { count: 0, protos: [] },
      expect.any(Function),
      expect.any(Object),
    );
  });
});

describe("formatMoleculesShow", () => {
  it("renders proto header, variables, issues (in DAG order), pour example", () => {
    const out = formatMoleculesShow({
      name: "refactor-package",
      description: "Refactor a package",
      source: "builtin",
      path: "/dist/molecules/builtin/refactor-package.toml",
      variables: [
        { name: "pkg", description: "Package", default: null },
        { name: "owner", description: "Engineer", default: "{{LINEAR_USER}}" },
      ],
      issues: [
        {
          key: "audit",
          title: "Audit",
          type: "task",
          priority: 2,
          description: null,
          depends_on: [],
        },
        {
          key: "plan",
          title: "Plan",
          type: "task",
          priority: 2,
          description: null,
          depends_on: ["audit"],
        },
      ],
    });
    expect(out).toContain("🧪 refactor-package");
    expect(out).toContain("Refactor a package");
    expect(out).toContain("Source: builtin");
    expect(out).toContain("Variables (2):");
    expect(out).toContain("(required)");
    expect(out).toContain("(default: {{LINEAR_USER}})");
    expect(out).toContain("Issues (2):");
    expect(out).toContain("← depends on: audit");
    // pour example shows only required (non-default) vars
    expect(out).toContain(
      "Pour: linear molecules pour refactor-package --var pkg=<value>",
    );
  });

  it("handles protos with no variables / no issues", () => {
    const out = formatMoleculesShow({
      name: "empty",
      description: null,
      source: "builtin",
      path: "/x",
      variables: [],
      issues: [],
    });
    expect(out).toContain("(no description)");
    expect(out).toContain("Variables: (none)");
    expect(out).toContain("Issues: (none)");
    expect(out).toContain("Pour: linear molecules pour empty");
  });
});

describe("linear molecules show (command dispatch)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(molService.defaultSearchPaths).mockReturnValue([
      "/proj/.linear/molecules",
      "/home/u/.linear/molecules",
      "/dist/molecules/builtin",
    ]);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("emits MoleculeShowResult envelope for a known name", async () => {
    vi.mocked(molService.getProto).mockReturnValueOnce({
      name: "x",
      description: "desc",
      variables: [{ name: "v" }],
      issues: [
        { key: "a", title: "A" },
        { key: "b", title: "B", depends_on: ["a"] },
      ],
      source: "/dist/molecules/builtin/x.toml",
    });

    const program = createProgram();
    await program.parseAsync(["node", "test", "molecules", "show", "x"]);

    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "x",
        source: "builtin",
        variables: [{ name: "v", description: null, default: null }],
        issues: [
          expect.objectContaining({ key: "a", depends_on: [] }),
          expect.objectContaining({ key: "b", depends_on: ["a"] }),
        ],
      }),
      expect.any(Function),
      expect.any(Object),
    );
  });

  it("exits with error when the name is unknown", async () => {
    vi.mocked(molService.getProto).mockReturnValueOnce(undefined);
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    const program = createProgram();
    await program.parseAsync(["node", "test", "molecules", "show", "ghost"]);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(outputResult).not.toHaveBeenCalled();
  });
});

describe("parseVarToken", () => {
  it("splits on the first = (preserves = in value)", () => {
    expect(parseVarToken("url=https://x.example/?a=1")).toEqual({
      key: "url",
      value: "https://x.example/?a=1",
    });
  });
  it("rejects empty key (`=foo`)", () => {
    expect(() => parseVarToken("=foo")).toThrow(/--var/);
  });
  it("rejects tokens with no =", () => {
    expect(() => parseVarToken("badvar")).toThrow(/--var/);
  });
  it("allows empty value", () => {
    expect(parseVarToken("k=")).toEqual({ key: "k", value: "" });
  });
});

describe("substituteIssueFields", () => {
  it("substitutes title and description", () => {
    const out = substituteIssueFields(
      {
        key: "x",
        title: "Audit {{pkg}}",
        description: "Owner: {{owner}}",
      },
      { pkg: "src/foo", owner: "fk" },
    );
    expect(out.title).toBe("Audit src/foo");
    expect(out.description).toBe("Owner: fk");
  });
  it("preserves undefined description", () => {
    const out = substituteIssueFields({ key: "x", title: "T" }, {});
    expect(out.description).toBeUndefined();
  });
});

describe("formatMoleculesPour", () => {
  it("real-mode output shows ✓ Created lines, dep tail, and progress hint", () => {
    const out = formatMoleculesPour({
      dry_run: false,
      proto: "refactor-package",
      vars: { pkg: "src/foo" },
      team_key: "TES",
      assignee: null,
      epic: { id: "u1", identifier: "TES-100", title: "Refactor src/foo" },
      issues: [
        {
          key: "audit",
          id: "u2",
          identifier: "TES-101",
          title: "Audit src/foo",
        },
        {
          key: "plan",
          id: "u3",
          identifier: "TES-102",
          title: "Plan refactor of src/foo",
        },
      ],
      dependencies: [{ from: "plan", to: "audit" }],
    });
    expect(out).toContain("🧪 Pouring refactor-package");
    expect(out).toContain("Variables:");
    expect(out).toContain("pkg = src/foo");
    expect(out).toContain("✓ Created epic TES-100: Refactor src/foo");
    expect(out).toContain("✓ Created TES-101");
    expect(out).toContain("✓ Created TES-102");
    expect(out).toContain("← depends on TES-101");
    expect(out).toContain("Molecule poured: 2 issues + 1 epic, 1 dependencies");
    expect(out).toContain("Track progress: linear molecules progress TES-100");
  });

  it("dry-run output prefixes Created lines with (dry-run) and omits track hint", () => {
    const out = formatMoleculesPour({
      dry_run: true,
      proto: "x",
      vars: {},
      team_key: null,
      assignee: null,
      epic: { id: "(dry-run)", identifier: "(dry-run)", title: "X" },
      issues: [
        { key: "a", id: "(dry-run)", identifier: "(dry-run)", title: "A" },
      ],
      dependencies: [],
    });
    expect(out).toContain("🧪 Would pour x");
    expect(out).toContain("✓ (dry-run) Created epic");
    expect(out).toContain("✓ (dry-run) Created");
    expect(out).not.toContain("Track progress:");
  });

  it("appends an (assignee: …) tail to the epic line when set", () => {
    const out = formatMoleculesPour({
      dry_run: false,
      proto: "x",
      vars: {},
      team_key: "TES",
      assignee: "fahad",
      epic: { id: "u1", identifier: "TES-1", title: "X" },
      issues: [{ key: "a", id: "u2", identifier: "TES-2", title: "A" }],
      dependencies: [],
    });
    expect(out).toContain("✓ Created epic TES-1: X (assignee: fahad)");
    // Children never carry the assignee tail (root-only).
    expect(out).not.toContain("TES-2: A (assignee");
  });
});

describe("linear molecules pour (command dispatch)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(molService.defaultSearchPaths).mockReturnValue([
      "/proj",
      "/usr",
      "/builtin",
    ]);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("dry-run emits dry_run:true envelope and never calls createIssue", async () => {
    vi.mocked(molService.getProto).mockReturnValueOnce({
      name: "demo",
      description: "Demo {{pkg}}",
      variables: [{ name: "pkg" }],
      issues: [
        { key: "audit", title: "Audit {{pkg}}" },
        { key: "plan", title: "Plan {{pkg}}", depends_on: ["audit"] },
      ],
      source: "/proj/demo.toml",
    });

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "molecules",
      "pour",
      "demo",
      "--var",
      "pkg=src/foo",
      "--dry-run",
    ]);

    expect(issueService.createIssue).not.toHaveBeenCalled();
    expect(relService.createIssueRelation).not.toHaveBeenCalled();
    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({
        dry_run: true,
        proto: "demo",
        vars: { pkg: "src/foo" },
        epic: expect.objectContaining({ title: "Demo src/foo" }),
        issues: [
          expect.objectContaining({ key: "audit", title: "Audit src/foo" }),
          expect.objectContaining({ key: "plan", title: "Plan src/foo" }),
        ],
        dependencies: [{ from: "plan", to: "audit" }],
      }),
      expect.any(Function),
      expect.any(Object),
    );
  });

  it("errors with `missing required variables` when a non-defaulted var is omitted", async () => {
    vi.mocked(molService.getProto).mockReturnValueOnce({
      name: "demo",
      description: null,
      variables: [{ name: "pkg" }, { name: "owner" }],
      issues: [{ key: "a", title: "T" }],
      source: "/proj/demo.toml",
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "molecules",
      "pour",
      "demo",
      "--dry-run",
    ]);

    expect(exitSpy).toHaveBeenCalledWith(1);
    const errText = errSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(errText).toMatch(/missing required variables.*pkg.*owner/);
    expect(issueService.createIssue).not.toHaveBeenCalled();
  });

  it("errors when the proto name is unknown", async () => {
    vi.mocked(molService.getProto).mockReturnValueOnce(undefined);
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "molecules",
      "pour",
      "ghost",
      "--dry-run",
    ]);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(issueService.createIssue).not.toHaveBeenCalled();
  });

  it("real mode creates epic + children with parentId, wires deps via Blocks", async () => {
    vi.mocked(molService.getProto).mockReturnValueOnce({
      name: "demo",
      description: "Demo {{pkg}}",
      variables: [{ name: "pkg" }],
      issues: [
        { key: "audit", title: "Audit {{pkg}}" },
        { key: "plan", title: "Plan {{pkg}}", depends_on: ["audit"] },
      ],
      source: "/proj/demo.toml",
    });

    // Each createIssue call returns a distinct id/identifier.
    const created: Array<{ id: string; identifier: string; title: string }> = [
      { id: "epic-uuid", identifier: "TES-100", title: "Demo src/foo" },
      { id: "audit-uuid", identifier: "TES-101", title: "Audit src/foo" },
      { id: "plan-uuid", identifier: "TES-102", title: "Plan src/foo" },
    ];
    vi.mocked(issueService.createIssue).mockImplementation(async () => {
      const next = created.shift();
      if (!next) throw new Error("ran out of mock issues");
      return next as never;
    });

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "molecules",
      "pour",
      "demo",
      "--var",
      "pkg=src/foo",
      "--team",
      "TES",
    ]);

    expect(issueService.createIssue).toHaveBeenCalledTimes(3);
    // Epic call has the molecule label + template-instance label, no parentId.
    const epicCall = vi.mocked(issueService.createIssue).mock.calls[0][1];
    expect(epicCall.labelIds).toEqual(
      expect.arrayContaining([
        "label-linear:molecule:demo",
        "label-linear:template-instance",
      ]),
    );
    expect(epicCall.parentId).toBeUndefined();
    // Child calls carry parentId = epic.id.
    const auditCall = vi.mocked(issueService.createIssue).mock.calls[1][1];
    expect(auditCall.parentId).toBe("epic-uuid");
    expect(auditCall.title).toBe("Audit src/foo");

    // One dep was wired: blocker=audit, dependent=plan.
    expect(relService.createIssueRelation).toHaveBeenCalledTimes(1);
    expect(relService.createIssueRelation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        issueId: "audit-uuid",
        relatedIssueId: "plan-uuid",
      }),
    );

    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({
        dry_run: false,
        proto: "demo",
        epic: expect.objectContaining({
          id: "epic-uuid",
          identifier: "TES-100",
        }),
        issues: expect.arrayContaining([
          expect.objectContaining({ key: "audit", identifier: "TES-101" }),
          expect.objectContaining({ key: "plan", identifier: "TES-102" }),
        ]),
        dependencies: [{ from: "plan", to: "audit" }],
      }),
      expect.any(Function),
      expect.any(Object),
    );
  });

  it("resolves LINEAR_USER defaults through the auth service", async () => {
    vi.mocked(molService.getProto).mockReturnValueOnce({
      name: "owned-work",
      description: "Work owned by {{owner}}",
      variables: [{ name: "owner", default: "{{LINEAR_USER}}" }],
      issues: [{ key: "deliver", title: "Deliver for {{owner}}" }],
      source: "/proj/owned-work.toml",
    });
    vi.mocked(validateToken).mockResolvedValueOnce({
      id: "viewer-1",
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
    vi.mocked(issueService.createIssue)
      .mockResolvedValueOnce({
        id: "epic-uuid",
        identifier: "TES-100",
        title: "Work owned by Ada Lovelace",
      } as never)
      .mockResolvedValueOnce({
        id: "child-uuid",
        identifier: "TES-101",
        title: "Deliver for Ada Lovelace",
      } as never);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "molecules",
      "pour",
      "owned-work",
      "--team",
      "TES",
    ]);

    expect(validateToken).toHaveBeenCalledWith(expect.anything());
    expect(issueService.createIssue).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ title: "Work owned by Ada Lovelace" }),
    );
    expect(issueService.createIssue).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ title: "Deliver for Ada Lovelace" }),
    );
  });

  it("--assignee resolves the user and pins assigneeId to the root epic only", async () => {
    vi.mocked(molService.getProto).mockReturnValueOnce({
      name: "demo",
      description: "Demo {{pkg}}",
      variables: [{ name: "pkg" }],
      issues: [
        { key: "audit", title: "Audit {{pkg}}" },
        { key: "plan", title: "Plan {{pkg}}", depends_on: ["audit"] },
      ],
      source: "/proj/demo.toml",
    });
    const created = [
      { id: "epic-uuid", identifier: "TES-100", title: "Demo src/foo" },
      { id: "audit-uuid", identifier: "TES-101", title: "Audit src/foo" },
      { id: "plan-uuid", identifier: "TES-102", title: "Plan src/foo" },
    ];
    vi.mocked(issueService.createIssue).mockImplementation(async () => {
      const next = created.shift();
      if (!next) throw new Error("ran out of mock issues");
      return next as never;
    });

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "molecules",
      "pour",
      "demo",
      "--var",
      "pkg=src/foo",
      "--team",
      "TES",
      "--assignee",
      "fahad",
    ]);

    expect(resolveUserId).toHaveBeenCalledWith(expect.anything(), "fahad");
    // Epic (first create) carries the resolved assigneeId.
    const epicCall = vi.mocked(issueService.createIssue).mock.calls[0][1];
    expect(epicCall.assigneeId).toBe("user-fahad");
    // Children (subsequent creates) do NOT — assignment is root-only.
    expect(
      vi.mocked(issueService.createIssue).mock.calls[1][1].assigneeId,
    ).toBeUndefined();
    expect(
      vi.mocked(issueService.createIssue).mock.calls[2][1].assigneeId,
    ).toBeUndefined();
    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({ assignee: "fahad" }),
      expect.any(Function),
      expect.any(Object),
    );
  });

  it("--assignee in --dry-run echoes the value without resolving a user", async () => {
    vi.mocked(molService.getProto).mockReturnValueOnce({
      name: "demo",
      description: "Demo {{pkg}}",
      variables: [{ name: "pkg" }],
      issues: [{ key: "audit", title: "Audit {{pkg}}" }],
      source: "/proj/demo.toml",
    });

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "molecules",
      "pour",
      "demo",
      "--var",
      "pkg=src/foo",
      "--assignee",
      "fahad",
      "--dry-run",
    ]);

    expect(resolveUserId).not.toHaveBeenCalled();
    expect(issueService.createIssue).not.toHaveBeenCalled();
    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({ dry_run: true, assignee: "fahad" }),
      expect.any(Function),
      expect.any(Object),
    );
  });
});

describe("toCurrentEntry", () => {
  it("derives proto from `linear:molecule:<name>` label", () => {
    const out = toCurrentEntry({
      id: "u",
      identifier: "TES-100",
      title: "Refactor src/foo",
      createdAt: "2026-05-15T12:00:00Z",
      description: "## Variables\n\n- pkg: src/foo\n",
      state: { name: "Backlog", type: "backlog" },
      labels: {
        nodes: [
          { name: "linear:molecule:refactor-package" },
          { name: "linear:template-instance" },
        ],
      },
      children: {
        nodes: [
          { state: { type: "completed" } },
          { state: { type: "started" } },
          { state: { type: "backlog" } },
          { state: { type: "backlog" } },
        ],
      },
    });
    expect(out).toEqual({
      proto: "refactor-package",
      epic: {
        id: "u",
        identifier: "TES-100",
        title: "Refactor src/foo",
        state: "Backlog",
        state_type: "backlog",
      },
      children_total: 4,
      children_closed: 1,
      percent_complete: 25,
      poured_at: "2026-05-15T12:00:00Z",
      variables: { pkg: "src/foo" },
    });
  });

  it("returns null when no `linear:molecule:*` label is present", () => {
    expect(
      toCurrentEntry({
        id: "u",
        identifier: "X-1",
        title: "",
        createdAt: "2026-05-15T00:00:00Z",
        labels: { nodes: [{ name: "linear:template-instance" }] },
      }),
    ).toBeNull();
  });

  it("returns 0% when the epic has no children (edge case)", () => {
    const out = toCurrentEntry({
      id: "u",
      identifier: "T-1",
      title: "x",
      createdAt: "2026-05-15T00:00:00Z",
      state: { name: "Backlog", type: "backlog" },
      labels: { nodes: [{ name: "linear:molecule:demo" }] },
      children: { nodes: [] },
    });
    expect(out?.percent_complete).toBe(0);
    expect(out?.children_total).toBe(0);
  });

  it("counts both completed and canceled as `closed`", () => {
    const out = toCurrentEntry({
      id: "u",
      identifier: "T-1",
      title: "x",
      createdAt: "2026-05-15T00:00:00Z",
      state: { name: "Started", type: "started" },
      labels: { nodes: [{ name: "linear:molecule:demo" }] },
      children: {
        nodes: [
          { state: { type: "completed" } },
          { state: { type: "canceled" } },
          { state: { type: "started" } },
        ],
      },
    });
    expect(out?.children_closed).toBe(2);
    expect(out?.percent_complete).toBe(67);
  });
});

describe("formatMoleculesCurrent", () => {
  it("renders 🧪 header, grouped sections, percent, poured date, variables tail", () => {
    const out = formatMoleculesCurrent({
      count: 2,
      molecules: [
        {
          proto: "refactor-package",
          epic: {
            id: "u1",
            identifier: "TES-100",
            title: "Refactor src/foo",
            state: "Started",
            state_type: "started",
          },
          children_total: 4,
          children_closed: 2,
          percent_complete: 50,
          poured_at: "2026-05-15T12:00:00Z",
          variables: { pkg: "src/foo", owner: "fk" },
        },
        {
          proto: "feature-with-tests",
          epic: {
            id: "u2",
            identifier: "TES-200",
            title: "Add filter",
            state: "Backlog",
            state_type: "backlog",
          },
          children_total: 3,
          children_closed: 0,
          percent_complete: 0,
          poured_at: "2026-05-17T00:00:00Z",
          variables: {},
        },
      ],
    });
    expect(out).toContain("🧪 Current molecules (2):");
    expect(out).toContain("refactor-package (1)");
    expect(out).toContain("feature-with-tests (1)");
    expect(out).toContain("◐ TES-100");
    expect(out).toContain("○ TES-200");
    expect(out).toContain("50% (2/4 children closed)");
    expect(out).toContain("0% (0/3 children closed)");
    expect(out).toContain(
      "Poured: 2026-05-15  ·  Variables: pkg=src/foo, owner=fk",
    );
    expect(out).toContain("Poured: 2026-05-17");
    expect(out).toContain("Use `linear molecules progress <epic-id>`");
  });

  it("emits the empty-state message when no molecules are poured", () => {
    const out = formatMoleculesCurrent({ count: 0, molecules: [] });
    expect(out).toContain("No molecules currently poured");
  });
});

describe("linear molecules current (command dispatch)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("filters out issues without `linear:molecule:*` and sorts newest first", async () => {
    vi.mocked(issueService.listIssues).mockResolvedValueOnce({
      nodes: [
        {
          id: "ub",
          identifier: "TES-200",
          title: "Newer",
          createdAt: "2026-05-17T00:00:00Z",
          description: null,
          state: { name: "Backlog", type: "backlog" },
          labels: { nodes: [{ name: "linear:molecule:demo" }] },
          children: { nodes: [] },
        },
        // No molecule label → dropped.
        {
          id: "ux",
          identifier: "TES-999",
          title: "Bare instance",
          createdAt: "2026-05-16T00:00:00Z",
          labels: { nodes: [{ name: "linear:template-instance" }] },
        },
        {
          id: "ua",
          identifier: "TES-100",
          title: "Older",
          createdAt: "2026-05-15T00:00:00Z",
          description: "## Variables\n\n- pkg: src/foo\n",
          state: { name: "Started", type: "started" },
          labels: { nodes: [{ name: "linear:molecule:demo" }] },
          children: {
            nodes: [
              { state: { type: "completed" } },
              { state: { type: "started" } },
            ],
          },
        },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    } as never);

    const program = createProgram();
    await program.parseAsync(["node", "test", "molecules", "current"]);

    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({
        count: 2,
        molecules: [
          expect.objectContaining({
            epic: expect.objectContaining({ identifier: "TES-200" }),
          }),
          expect.objectContaining({
            epic: expect.objectContaining({ identifier: "TES-100" }),
          }),
        ],
      }),
      expect.any(Function),
      expect.any(Object),
    );
  });

  it("passes the team filter through to listIssues when --team is supplied", async () => {
    vi.mocked(issueService.listIssues).mockResolvedValueOnce({
      nodes: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    } as never);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "molecules",
      "current",
      "--team",
      "TES",
    ]);

    const filterArg = vi.mocked(issueService.listIssues).mock.calls[0][2];
    expect(filterArg).toEqual(
      expect.objectContaining({
        labels: { name: { eq: "linear:template-instance" } },
        team: { key: { eq: "TES" } },
      }),
    );
  });

  it("emits empty envelope when no molecules exist", async () => {
    vi.mocked(issueService.listIssues).mockResolvedValueOnce({
      nodes: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    } as never);

    const program = createProgram();
    await program.parseAsync(["node", "test", "molecules", "current"]);

    expect(outputResult).toHaveBeenCalledWith(
      { count: 0, molecules: [] },
      expect.any(Function),
      expect.any(Object),
    );
  });

  it("restricts the listing to one assignee when --assignee is supplied (lin-ov30.9)", async () => {
    vi.mocked(issueService.listIssues).mockResolvedValueOnce({
      nodes: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    } as never);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "molecules",
      "current",
      "--assignee",
      "@me",
    ]);

    // Resolved through the same vocabulary as `pour --assignee`.
    expect(resolveUserId).toHaveBeenCalledWith(expect.anything(), "@me");
    // The resolved id is ANDed into the server-side filter.
    const filterArg = vi.mocked(issueService.listIssues).mock.calls[0][2];
    expect(filterArg).toEqual(
      expect.objectContaining({
        labels: { name: { eq: "linear:template-instance" } },
        assignee: { id: { eq: "user-@me" } },
      }),
    );
  });

  it("does not resolve a user or add an assignee filter without --assignee", async () => {
    vi.mocked(issueService.listIssues).mockResolvedValueOnce({
      nodes: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    } as never);

    const program = createProgram();
    await program.parseAsync(["node", "test", "molecules", "current"]);

    expect(resolveUserId).not.toHaveBeenCalled();
    const filterArg = vi.mocked(issueService.listIssues).mock.calls[0][2] as {
      assignee?: unknown;
    };
    expect(filterArg.assignee).toBeUndefined();
  });
});

describe("formatMoleculesProgress", () => {
  it("renders epic header, variables, children with state + blocking annotations, counts footer", () => {
    const out = formatMoleculesProgress({
      epic: {
        id: "u",
        identifier: "TES-100",
        title: "Refactor src/issues",
        state: "Started",
        state_type: "started",
      },
      proto: "refactor-package",
      percent_complete: 50,
      poured_at: "2026-05-15T00:00:00Z",
      variables: { pkg: "src/issues", owner: "fahad" },
      children: [
        {
          id: "u1",
          identifier: "TES-101",
          title: "Audit src/issues",
          state: "Done",
          state_type: "completed",
          blocked_by: [],
          blocking: [],
        },
        {
          id: "u3",
          identifier: "TES-103",
          title: "Execute refactor",
          state: "In Progress",
          state_type: "started",
          blocked_by: [],
          blocking: ["TES-104"],
        },
        {
          id: "u4",
          identifier: "TES-104",
          title: "Verify",
          state: "Backlog",
          state_type: "backlog",
          blocked_by: ["TES-103"],
          blocking: [],
        },
      ],
      counts: { closed: 1, in_progress: 1, open: 1, blocked: 1 },
    });
    expect(out).toContain("🧪 TES-100  Refactor src/issues");
    expect(out).toContain(
      "Proto: refactor-package  ·  50% complete  ·  Poured: 2026-05-15",
    );
    expect(out).toContain("Variables:");
    expect(out).toContain("pkg   = src/issues");
    expect(out).toContain("Children (3):");
    expect(out).toContain("← currently blocking TES-104");
    expect(out).toContain("← blocked by TES-103");
    expect(out).toContain("1 closed · 1 in progress · 1 open · 1 blocked");
  });

  it("emits 'Molecule has no children' when children is empty", () => {
    const out = formatMoleculesProgress({
      epic: {
        id: "u",
        identifier: "T-1",
        title: "Empty",
        state: "Backlog",
        state_type: "backlog",
      },
      proto: "demo",
      percent_complete: 0,
      poured_at: "2026-05-17T00:00:00Z",
      variables: {},
      children: [],
      counts: { closed: 0, in_progress: 0, open: 0, blocked: 0 },
    });
    expect(out).toContain("Molecule has no children");
  });

  it("omits the 'blocked' tail in the counts footer when zero", () => {
    const out = formatMoleculesProgress({
      epic: {
        id: "u",
        identifier: "T-1",
        title: "T",
        state: "Backlog",
        state_type: "backlog",
      },
      proto: "demo",
      percent_complete: 0,
      poured_at: "2026-05-17T00:00:00Z",
      variables: {},
      children: [
        {
          id: "c1",
          identifier: "T-2",
          title: "x",
          state: "Backlog",
          state_type: "backlog",
          blocked_by: [],
          blocking: [],
        },
      ],
      counts: { closed: 0, in_progress: 0, open: 1, blocked: 0 },
    });
    expect(out).toContain("0 closed · 0 in progress · 1 open");
    expect(out).not.toContain("blocked");
  });
});

describe("linear molecules progress (command dispatch)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("happy path: emits envelope with proto, %, variables, per-child blocking", async () => {
    vi.mocked(issueService.getIssue).mockResolvedValueOnce({
      id: "epic-uuid",
      identifier: "TES-100",
      title: "Refactor src/foo",
      createdAt: "2026-05-15T00:00:00Z",
      description: "## Variables\n\n- pkg: src/foo\n",
      state: { name: "Started", type: "started" },
      labels: {
        nodes: [
          { name: "linear:molecule:demo" },
          { name: "linear:template-instance" },
        ],
      },
      children: {
        nodes: [
          {
            id: "c1",
            identifier: "TES-101",
            title: "Audit",
            state: { name: "Done", type: "completed" },
          },
          {
            id: "c2",
            identifier: "TES-102",
            title: "Plan",
            state: { name: "Duplicate", type: "duplicate" },
          },
        ],
      },
    } as never);

    // TES-101 blocks TES-102.
    vi.mocked(relService.listIssueRelations).mockImplementation(
      async (_c, id) => {
        if (id === "c1") {
          return [
            {
              relation_id: "r1",
              type: "blocks",
              direction: "up",
              issue_id: "c2",
              identifier: "TES-102",
              title: "Plan",
              priority: 0,
              status: "duplicate",
              state_name: "Duplicate",
            },
          ];
        }
        if (id === "c2") {
          return [
            {
              relation_id: "r1",
              type: "blocks",
              direction: "down",
              issue_id: "c1",
              identifier: "TES-101",
              title: "Audit",
              priority: 0,
              status: "completed",
              state_name: "Done",
            },
          ];
        }
        return [];
      },
    );

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "molecules",
      "progress",
      "TES-100",
    ]);

    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({
        epic: expect.objectContaining({ identifier: "TES-100" }),
        proto: "demo",
        percent_complete: 100,
        variables: { pkg: "src/foo" },
        children: [
          expect.objectContaining({
            identifier: "TES-101",
            blocking: ["TES-102"],
            blocked_by: [],
          }),
          expect.objectContaining({
            identifier: "TES-102",
            blocking: [],
            blocked_by: ["TES-101"],
          }),
        ],
        counts: expect.objectContaining({
          closed: 2,
          in_progress: 0,
          open: 0,
          blocked: 0,
        }),
      }),
      expect.any(Function),
      expect.any(Object),
    );
  });

  it("errors when the epic is missing the template-instance label", async () => {
    vi.mocked(issueService.getIssue).mockResolvedValueOnce({
      id: "x",
      identifier: "TES-1",
      title: "Random",
      createdAt: "2026-05-17T00:00:00Z",
      labels: { nodes: [{ name: "bug" }] },
      children: { nodes: [] },
      state: { name: "Backlog", type: "backlog" },
    } as never);
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "molecules",
      "progress",
      "TES-1",
    ]);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(outputResult).not.toHaveBeenCalled();
  });

  it("returns percent_complete=0 and no blocking calls when children is empty", async () => {
    vi.mocked(issueService.getIssue).mockResolvedValueOnce({
      id: "epic-uuid",
      identifier: "TES-100",
      title: "Empty molecule",
      createdAt: "2026-05-17T00:00:00Z",
      description: null,
      labels: {
        nodes: [
          { name: "linear:molecule:demo" },
          { name: "linear:template-instance" },
        ],
      },
      children: { nodes: [] },
      state: { name: "Backlog", type: "backlog" },
    } as never);

    const program = createProgram();
    await program.parseAsync([
      "node",
      "test",
      "molecules",
      "progress",
      "TES-100",
    ]);

    expect(relService.listIssueRelations).not.toHaveBeenCalled();
    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({
        percent_complete: 0,
        children: [],
        counts: { closed: 0, in_progress: 0, open: 0, blocked: 0 },
      }),
      expect.any(Function),
      expect.any(Object),
    );
  });
});
