import { invalidParameterError } from "./errors.js";

function parseStrictNonNegativeInteger(raw: string): number | null {
  if (!/^\d+$/.test(raw)) {
    return null;
  }

  return Number.parseInt(raw, 10);
}

export function parsePriorityOption(raw: string): number {
  // Accept `P1`–`P4` shorthand alongside the numeric form. `P0` is
  // intentionally rejected — Linear treats 0 as "No priority" (set by
  // omitting --priority entirely), and `1` is Urgent in both notations.
  const stripped = /^[Pp]([1-4])$/.exec(raw)?.[1] ?? raw;
  const value = parseStrictNonNegativeInteger(stripped);
  if (value === null || value < 1 || value > 4) {
    throw invalidParameterError(
      "--priority",
      "must be 1-4 (or P1-P4); Linear's 0 means 'No priority' and is set by omitting --priority",
    );
  }

  return value;
}

export function parseEstimateOption(raw: string): number {
  const value = parseStrictNonNegativeInteger(raw);
  if (value === null) {
    throw invalidParameterError("--estimate", "must be a non-negative integer");
  }

  return value;
}
