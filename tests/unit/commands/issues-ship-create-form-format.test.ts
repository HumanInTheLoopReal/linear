//
// Format tests for `linear issues ship <capability>` and
// `linear issues create-form`. The text shape established here is the
// canonical human-facing echo and is reused elsewhere (e.g. `issues
// create` reuses `formatIssueCreateForm`).
//
//   ship shipped         → `✓ Shipped <cap> via <id> (label: <provides>)`
//   ship already_shipped → `✓ Capability <cap> already shipped via <id>`
//   ship dry_run         → `→ [dry-run] Would ship <cap> via <id> (...)`
//   create created       → multi-line block (id, title, optional Priority,
//                          optional Status)
//   create canceled      → `✗ Create canceled`

import { describe, expect, it } from "vitest";
import {
  formatIssueCreate,
  formatIssueCreateForm,
  formatIssueShip,
} from "../../../src/commands/issues.js";

describe("formatIssueShip", () => {
  it("renders the shipped status with capability, identifier, and provides label", () => {
    const out = formatIssueShip({
      status: "shipped",
      capability: "auth-v2",
      issue_identifier: "TES-100",
      label: "provides:auth-v2",
    });
    expect(out).toBe(
      "✓ Shipped auth-v2 via TES-100 (label: provides:auth-v2)\n",
    );
  });

  it("renders already_shipped as an idempotent no-op echo", () => {
    const out = formatIssueShip({
      status: "already_shipped",
      capability: "auth-v2",
      issue_identifier: "TES-100",
    });
    expect(out).toBe("✓ Capability auth-v2 already shipped via TES-100\n");
  });

  it("renders dry_run with → arrow and [dry-run] tag so preview is visually distinct from write", () => {
    const out = formatIssueShip({
      status: "dry_run",
      capability: "auth-v2",
      issue_identifier: "TES-100",
      would_add: "provides:auth-v2",
    });
    expect(out).toBe(
      "→ [dry-run] Would ship auth-v2 via TES-100 (would add label: provides:auth-v2)\n",
    );
  });

  it("dry-run uses → (not ✓) so the operator can scan for write vs preview", () => {
    const out = formatIssueShip({
      status: "dry_run",
      capability: "x",
      issue_identifier: "TES-1",
      would_add: "provides:x",
    });
    expect(out.startsWith("→")).toBe(true);
    expect(out.startsWith("✓")).toBe(false);
  });

  it("ends each variant with exactly one trailing newline", () => {
    for (const status of ["shipped", "already_shipped", "dry_run"] as const) {
      const out = formatIssueShip({
        status,
        capability: "c",
        issue_identifier: "TES-1",
        label: "provides:c",
        would_add: "provides:c",
      });
      expect(out.endsWith("\n")).toBe(true);
      expect(out.endsWith("\n\n")).toBe(false);
    }
  });
});

describe("formatIssueCreateForm", () => {
  it("renders the create echo: header + indented metadata lines", () => {
    const out = formatIssueCreateForm({
      identifier: "TES-1",
      title: "Fix auth",
      priority: 2,
      state: { name: "Backlog" },
    });
    expect(out).toBe(
      "✓ Created issue: TES-1 — Fix auth\n  Priority: P2\n  Status: Backlog\n",
    );
  });

  it("omits the Priority line when priority is 0 (Linear 'No priority')", () => {
    const out = formatIssueCreateForm({
      identifier: "TES-2",
      title: "x",
      priority: 0,
      state: { name: "Triage" },
    });
    expect(out).toBe("✓ Created issue: TES-2 — x\n  Status: Triage\n");
  });

  it("omits the Priority line when priority is null", () => {
    const out = formatIssueCreateForm({
      identifier: "TES-3",
      title: "y",
      priority: null,
      state: { name: "Backlog" },
    });
    expect(out).not.toContain("Priority");
  });

  it("omits the Status line when state is null (defensive: shouldn't happen)", () => {
    const out = formatIssueCreateForm({
      identifier: "TES-4",
      title: "z",
      priority: 3,
      state: null,
    });
    expect(out).toBe("✓ Created issue: TES-4 — z\n  Priority: P3\n");
  });

  it("renders the canceled case with ✗ icon", () => {
    expect(formatIssueCreateForm({ canceled: true })).toBe(
      "✗ Create canceled\n",
    );
  });

  it("uses linear's state.name verbatim", () => {
    // Linear workspaces define their own state names: Backlog, Todo,
    // In Progress, In Review, Done, Canceled. Use whatever's in the
    // payload — don't translate to other vocabularies.
    const out = formatIssueCreateForm({
      identifier: "TES-5",
      title: "x",
      priority: 1,
      state: { name: "In Progress" },
    });
    expect(out).toContain("Status: In Progress");
  });

  it("ends with exactly one trailing newline", () => {
    const out = formatIssueCreateForm({
      identifier: "TES-6",
      title: "z",
      priority: 4,
      state: { name: "Backlog" },
    });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

describe("formatIssueCreate", () => {
  // Round-1 UX bug: omitting --priority caused Linear to store priority=0
  // ("No priority"), but the success echo printed `Priority: P0` — agents
  // read that as "P0 = urgent" and panicked. The line must be suppressed
  // when priority is 0 or null, matching formatIssueCreateForm.

  it("includes Priority line when priority is 1-4 (set)", () => {
    expect(
      formatIssueCreate({
        identifier: "TES-1",
        title: "Fix auth",
        priority: 2,
        state: { name: "Backlog" },
      }),
    ).toBe(
      "✓ Created issue: TES-1: Fix auth\n  Priority: P2\n  Status: Backlog\n",
    );
  });

  it("omits Priority line when priority is 0 (Linear 'No priority')", () => {
    const out = formatIssueCreate({
      identifier: "TES-2",
      title: "x",
      priority: 0,
      state: { name: "Backlog" },
    });
    expect(out).not.toContain("Priority");
    expect(out).toBe("✓ Created issue: TES-2: x\n  Status: Backlog\n");
  });

  it("omits Priority line when priority is null", () => {
    const out = formatIssueCreate({
      identifier: "TES-3",
      title: "y",
      priority: null,
      state: { name: "Backlog" },
    });
    expect(out).not.toContain("Priority");
  });

  it("omits Priority line when priority is undefined", () => {
    const out = formatIssueCreate({
      identifier: "TES-4",
      title: "z",
      state: { name: "Backlog" },
    });
    expect(out).not.toContain("Priority");
  });

  it("renders header without colon when title is empty", () => {
    const out = formatIssueCreate({
      identifier: "TES-5",
      title: "",
      state: { name: "Backlog" },
    });
    expect(out).toBe("✓ Created issue: TES-5\n  Status: Backlog\n");
  });
});
