/**
 * `.junie/mcp/mcp.json` body for the junie multifile recipe.
 *
 * Junie auto-loads `.junie/mcp/mcp.json` on startup and exposes the
 * declared MCP servers as tool surfaces to the model. The block
 * below wires the linear CLI as an MCP server invoked via
 * `linear mcp` — that subcommand is the forward-looking entry
 * point for the linear MCP server (not yet shipped at the time
 * this recipe was authored; see PROCESS.md and the linear-mcp epic).
 *
 * Why ship the file before the server exists? The file is harmless
 * when the server isn't running — junie logs a "server unreachable"
 * warning at startup and skips the tool surface. The user can still
 * use `/run linear …` via the guidelines.md (auto-loaded via the
 * same recipe).
 *
 * When `linear mcp` ships, this file is already in place on every
 * existing junie install — no second `linear setup junie` round
 * trip needed.
 *
 * Fields:
 *   - command:  the executable junie invokes
 *   - args:     positional args appended after the command
 */
export const JUNIE_MCP_JSON = `{
  "mcpServers": {
    "linear": {
      "command": "linear",
      "args": ["mcp"]
    }
  }
}
`;
