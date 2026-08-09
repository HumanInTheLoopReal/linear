import { describe, expect, it } from "vitest";
import {
  ALL_STATE_TYPES,
  CLOSED_STATE_TYPES,
  isClosedStateType,
  isNonClosedStateType,
  lifecycleStatusFromStateType,
  NON_CLOSED_STATE_TYPES,
  OPEN_STATE_TYPES,
  stateTypesForLogicalStatus,
} from "../../../src/common/issue-lifecycle.js";

describe("issue lifecycle", () => {
  it("defines mutually exclusive public lifecycle buckets", () => {
    expect(OPEN_STATE_TYPES).toEqual(["triage", "backlog", "unstarted"]);
    expect(stateTypesForLogicalStatus("in_progress")).toEqual(["started"]);
    expect(CLOSED_STATE_TYPES).toEqual(["completed", "canceled", "duplicate"]);
  });

  it("provides complete non-closed and all-state sets for broad scans", () => {
    expect(NON_CLOSED_STATE_TYPES).toEqual([
      "triage",
      "backlog",
      "unstarted",
      "started",
    ]);
    expect(ALL_STATE_TYPES).toEqual([
      "triage",
      "backlog",
      "unstarted",
      "started",
      "completed",
      "canceled",
      "duplicate",
    ]);
  });

  it("classifies terminal and non-terminal state types consistently", () => {
    expect(lifecycleStatusFromStateType("started")).toBe("in_progress");
    expect(lifecycleStatusFromStateType("duplicate")).toBe("closed");
    expect(lifecycleStatusFromStateType("backlog")).toBe("open");
    expect(isClosedStateType("duplicate")).toBe(true);
    expect(isNonClosedStateType("started")).toBe(true);
    expect(isNonClosedStateType("completed")).toBe(false);
  });
});
