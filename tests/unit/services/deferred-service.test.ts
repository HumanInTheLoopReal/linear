import { describe, expect, it, vi } from "vitest";
import type { GraphQLClient } from "../../../src/client/graphql-client.js";
import {
  snoozeIssue,
  wakeIssue,
} from "../../../src/services/deferred-service.js";

describe("snoozeIssue", () => {
  it("adds the 'deferred' label while preserving existing labels (no --until)", async () => {
    const request = vi
      .fn()
      // ensureWorkspaceLabel: lookup existing
      .mockResolvedValueOnce({
        issueLabels: { nodes: [{ id: "l-def", name: "deferred" }] },
      })
      // getIssue
      .mockResolvedValueOnce({
        issue: {
          id: "i-1",
          identifier: "ENG-1",
          labels: { nodes: [{ id: "l-bug", name: "bug" }] },
        },
      })
      // updateIssue
      .mockResolvedValueOnce({
        issueUpdate: {
          success: true,
          issue: { id: "i-1", identifier: "ENG-1" },
        },
      });
    const client = { request } as unknown as GraphQLClient;

    await snoozeIssue(client, "i-1");

    const updateCall = request.mock.calls[2][1] as {
      id: string;
      input: { labelIds: string[] };
    };
    expect(updateCall.id).toBe("i-1");
    expect(updateCall.input.labelIds.sort()).toEqual(["l-bug", "l-def"]);
  });

  it("adds both 'deferred' and 'deferred-until:<date>' when --until is set", async () => {
    const request = vi
      .fn()
      // ensureWorkspaceLabel: deferred lookup
      .mockResolvedValueOnce({
        issueLabels: { nodes: [{ id: "l-def", name: "deferred" }] },
      })
      // ensureWorkspaceLabel: deferred-until:2099-01-01 lookup (not found → create)
      .mockResolvedValueOnce({ issueLabels: { nodes: [] } })
      .mockResolvedValueOnce({
        issueLabelCreate: {
          success: true,
          issueLabel: { id: "l-until", name: "deferred-until:2099-01-01" },
        },
      })
      // getIssue
      .mockResolvedValueOnce({
        issue: {
          id: "i-1",
          identifier: "ENG-1",
          labels: { nodes: [] },
        },
      })
      // updateIssue
      .mockResolvedValueOnce({
        issueUpdate: {
          success: true,
          issue: { id: "i-1", identifier: "ENG-1" },
        },
      });
    const client = { request } as unknown as GraphQLClient;

    await snoozeIssue(client, "i-1", "2099-01-01");

    const updateCall = request.mock.calls[4][1] as {
      id: string;
      input: { labelIds: string[] };
    };
    expect(updateCall.input.labelIds.sort()).toEqual(["l-def", "l-until"]);
  });

  it("strips any stale 'deferred-until:*' labels on re-snooze", async () => {
    const request = vi
      .fn()
      // ensureWorkspaceLabel: deferred
      .mockResolvedValueOnce({
        issueLabels: { nodes: [{ id: "l-def", name: "deferred" }] },
      })
      // ensureWorkspaceLabel: new deferred-until
      .mockResolvedValueOnce({
        issueLabels: {
          nodes: [{ id: "l-new-until", name: "deferred-until:2027-01-01" }],
        },
      })
      // getIssue: returns issue carrying old deferred-until + deferred + a real label
      .mockResolvedValueOnce({
        issue: {
          id: "i-1",
          identifier: "ENG-1",
          labels: {
            nodes: [
              { id: "l-def", name: "deferred" },
              { id: "l-old-until", name: "deferred-until:2024-01-01" },
              { id: "l-bug", name: "bug" },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        issueUpdate: {
          success: true,
          issue: { id: "i-1", identifier: "ENG-1" },
        },
      });
    const client = { request } as unknown as GraphQLClient;

    await snoozeIssue(client, "i-1", "2027-01-01");

    const updateCall = request.mock.calls[3][1] as {
      id: string;
      input: { labelIds: string[] };
    };
    // Old deferred-until:2024-01-01 must be dropped; new one + deferred + bug preserved.
    expect(updateCall.input.labelIds.sort()).toEqual([
      "l-bug",
      "l-def",
      "l-new-until",
    ]);
    expect(updateCall.input.labelIds).not.toContain("l-old-until");
  });
});

describe("wakeIssue", () => {
  it("strips 'deferred' and 'deferred-until:*' labels while preserving the rest", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        issue: {
          id: "i-1",
          identifier: "ENG-1",
          labels: {
            nodes: [
              { id: "l-def", name: "deferred" },
              { id: "l-until", name: "deferred-until:2099-01-01" },
              { id: "l-bug", name: "bug" },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        issueUpdate: {
          success: true,
          issue: { id: "i-1", identifier: "ENG-1" },
        },
      });
    const client = { request } as unknown as GraphQLClient;

    const outcome = await wakeIssue(client, "i-1");

    expect(outcome.status).toBe("woke");
    const updateCall = request.mock.calls[1][1] as {
      id: string;
      input: { labelIds: string[] };
    };
    expect(updateCall.input.labelIds).toEqual(["l-bug"]);
  });

  it("returns 'skipped' outcome when issue carries no deferral labels", async () => {
    const request = vi.fn().mockResolvedValueOnce({
      issue: {
        id: "i-1",
        identifier: "ENG-1",
        labels: { nodes: [{ id: "l-bug", name: "bug" }] },
      },
    });
    const client = { request } as unknown as GraphQLClient;

    const outcome = await wakeIssue(client, "i-1");

    expect(outcome).toEqual({
      status: "skipped",
      issue_id: "i-1",
      issue_identifier: "ENG-1",
    });
    // issueUpdate mutation must NOT have fired.
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("returns 'skipped' when the only labels are deferral-related and none apply (no labels at all)", async () => {
    const request = vi.fn().mockResolvedValueOnce({
      issue: { id: "i-1", identifier: "ENG-1", labels: { nodes: [] } },
    });
    const client = { request } as unknown as GraphQLClient;

    const outcome = await wakeIssue(client, "i-1");

    expect(outcome).toEqual({
      status: "skipped",
      issue_id: "i-1",
      issue_identifier: "ENG-1",
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  // lin-5d8g: wake should GC the orphan deferred-until:<date> workspace
  // label if no other issue is still using it, so dated labels don't
  // accumulate one per historical snooze. Probe + delete are best-effort
  // so failures must not bubble up.
  it("deletes the deferred-until:<date> workspace label when no other issue carries it", async () => {
    const request = vi
      .fn()
      // getIssue
      .mockResolvedValueOnce({
        issue: {
          id: "i-1",
          identifier: "ENG-1",
          labels: {
            nodes: [
              { id: "l-def", name: "deferred" },
              { id: "l-until", name: "deferred-until:2099-01-01" },
            ],
          },
        },
      })
      // updateIssue
      .mockResolvedValueOnce({
        issueUpdate: {
          success: true,
          issue: { id: "i-1", identifier: "ENG-1" },
        },
      })
      // getLabelIssueUsage probe: only this issue (filtered out)
      .mockResolvedValueOnce({
        issueLabel: { id: "l-until", issues: { nodes: [{ id: "i-1" }] } },
      })
      // deleteWorkspaceLabel
      .mockResolvedValueOnce({ issueLabelDelete: { success: true } });
    const client = { request } as unknown as GraphQLClient;

    const outcome = await wakeIssue(client, "i-1");

    expect(outcome.status).toBe("woke");
    expect(request).toHaveBeenCalledTimes(4);
    // Last call must be DeleteIssueLabel with the orphan label id.
    const deleteCall = request.mock.calls[3][1];
    expect(deleteCall).toEqual({ id: "l-until" });
  });

  it("keeps the deferred-until:<date> workspace label when another issue still carries it", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        issue: {
          id: "i-1",
          identifier: "ENG-1",
          labels: {
            nodes: [{ id: "l-until", name: "deferred-until:2099-01-01" }],
          },
        },
      })
      .mockResolvedValueOnce({
        issueUpdate: {
          success: true,
          issue: { id: "i-1", identifier: "ENG-1" },
        },
      })
      // Probe shows another issue (i-2) is still using the label.
      .mockResolvedValueOnce({
        issueLabel: {
          id: "l-until",
          issues: { nodes: [{ id: "i-1" }, { id: "i-2" }] },
        },
      });
    const client = { request } as unknown as GraphQLClient;

    await wakeIssue(client, "i-1");

    // Exactly 3 calls — no DeleteIssueLabel.
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("does not GC the 'deferred' label itself (only dated variants)", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        issue: {
          id: "i-1",
          identifier: "ENG-1",
          labels: { nodes: [{ id: "l-def", name: "deferred" }] },
        },
      })
      .mockResolvedValueOnce({
        issueUpdate: {
          success: true,
          issue: { id: "i-1", identifier: "ENG-1" },
        },
      });
    const client = { request } as unknown as GraphQLClient;

    await wakeIssue(client, "i-1");

    // Only getIssue + updateIssue: no probe, no delete.
    expect(request).toHaveBeenCalledTimes(2);
  });
});
