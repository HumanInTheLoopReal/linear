import {
  type BodyInputOptions,
  resolveBodyInput,
} from "../common/body-input.js";
import { invalidParameterError } from "../common/errors.js";
import { checkCommentFormat } from "../services/comment-lint.js";

const REQUIRED_BODY_MESSAGE =
  "is required (pass --body <text>, --body-file <path>, or --stdin)";

/**
 * Resolve and validate a discussion body before any command performs a write.
 *
 * Keeping this policy at the command boundary gives issue, project,
 * initiative, and compatibility discussion surfaces identical source,
 * empty-body, and formatting-gate behavior.
 */
export function requireCommentBody(options: BodyInputOptions): string {
  const body = resolveBodyInput(options);
  if (body === undefined || body.trim() === "") {
    throw invalidParameterError("--body", REQUIRED_BODY_MESSAGE);
  }

  checkCommentFormat(body);
  return body;
}
