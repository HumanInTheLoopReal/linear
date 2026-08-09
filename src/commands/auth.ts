import { exec } from "node:child_process";
import { createInterface } from "node:readline";
import type { Command } from "commander";
import {
  type CommandOptions,
  resolveApiToken,
  type TokenSource,
} from "../common/auth.js";
import { createGraphQLClient, getRootOpts } from "../common/context.js";
import { handleCommand, outputResult } from "../common/output.js";
import { clearToken, saveToken } from "../common/token-storage.js";
import type { Viewer } from "../common/types.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import { validateToken } from "../services/auth-service.js";

const LINEAR_API_KEY_URL =
  "https://linear.app/settings/account/security/api-keys/new";

const SOURCE_LABELS: Record<TokenSource, string> = {
  flag: "--api-token flag",
  env: "LINEAR_API_TOKEN env var",
  stored: "~/linear/token",
  legacy: "~/.linear_api_token (deprecated)",
};

export const AUTH_META: DomainMeta = {
  name: "auth",
  summary: "authenticate with Linear API (interactive, for humans)",
  context: [
    "linear requires a Linear API token for all operations.",
    "the auth command guides you through creating and storing a token.",
    "tokens are encrypted and stored in ~/linear/token.",
    "token resolution order: --api-token flag, LINEAR_API_TOKEN env,",
    "~/linear/token (encrypted), ~/.linear_api_token (deprecated).",
  ].join("\n"),
  arguments: {},
  seeAlso: [],
};

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? `open "${url}"`
      : process.platform === "win32"
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;

  exec(cmd, () => {
    // Browser open failed — URL is already printed, user can open manually
  });
}

function promptToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
    });

    process.stderr.write("Paste your Linear API token: ");

    if (process.stdin.isTTY) {
      // Raw mode: read character by character, mask with *
      process.stdin.setRawMode?.(true);
      process.stdin.resume();
      process.stdin.setEncoding("utf8");

      let token = "";
      const onData = (char: string): void => {
        if (char === "\n" || char === "\r") {
          process.stdin.setRawMode?.(false);
          process.stdin.pause();
          process.stdin.removeListener("data", onData);
          process.stderr.write("\n");
          rl.close();
          resolve(token.trim());
        } else if (char === "\u0003") {
          // Ctrl+C
          process.stdin.setRawMode?.(false);
          process.stdin.pause();
          process.stdin.removeListener("data", onData);
          process.stderr.write("\n");
          rl.close();
          reject(new Error("Cancelled"));
        } else if (char === "\u007F" || char === "\b") {
          // Backspace
          if (token.length > 0) {
            token = token.slice(0, -1);
            process.stderr.write("\b \b");
          }
        } else {
          token += char;
          process.stderr.write("*");
        }
      };
      process.stdin.on("data", onData);
    } else {
      // Non-TTY: read line normally (piped input)
      rl.question("", (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

function validateApiToken(token: string): Promise<Viewer> {
  return validateToken(createGraphQLClient(token));
}

/**
 * Result shapes from `linear auth status` and `linear auth logout`. The
 * JSON envelope is preserved unchanged; the text formatters below
 * project each shape onto a single ✓/✗/⚠-prefixed human line.
 */
export interface AuthStatusResult {
  authenticated: boolean;
  source?: string;
  user?: { id: string; name: string; email: string };
  message?: string;
}

export interface AuthLogoutResult {
  message: string;
  warning?: string;
}

/**
 * `linear auth status` echo:
 *
 *   authenticated  → `✓ Authenticated as <name> (<email>) via <source>`
 *   unauthenticated → `✗ <message>` (the JSON message is already user-facing)
 *
 * Both shapes are single-line. The token's source is already a
 * human-readable label (e.g. `~/linear/token`) per SOURCE_LABELS.
 */
export function formatAuthStatus(result: AuthStatusResult): string {
  if (result.authenticated && result.user) {
    const src = result.source ? ` via ${result.source}` : "";
    return `✓ Authenticated as ${result.user.name} (${result.user.email})${src}\n`;
  }
  return `✗ ${result.message ?? "Not authenticated."}\n`;
}

/**
 * `linear auth logout` echo: one ✓ line confirming removal, plus a
 * second ⚠ line when another token source is still active. Mirrors
 * the JSON shape (`{message, warning?}`) one-for-one.
 */
export function formatAuthLogout(result: AuthLogoutResult): string {
  const lines = [`✓ ${result.message}`];
  if (result.warning) {
    lines.push(`⚠ ${result.warning}`);
  }
  return `${lines.join("\n")}\n`;
}

export function setupAuthCommands(program: Command): void {
  const auth = program
    .command("auth")
    .description("Authenticate with Linear API");

  auth.action(() => auth.help());

  // Login bypasses handleCommand() — interactive UX with raw stdin and process.exit
  auth
    .command("login")
    .description("set up or refresh authentication")
    .option("--force", "reauthenticate even if already authenticated")
    .action(async (options: { force?: boolean }, command: Command) => {
      try {
        if (!options.force) {
          try {
            const rootOpts = getRootOpts(command) as CommandOptions;
            const { token, source } = resolveApiToken(rootOpts);
            try {
              const viewer = await validateApiToken(token);
              console.error(
                `Already authenticated as ${viewer.name} (${viewer.email}) via ${SOURCE_LABELS[source]}.`,
              );
              console.error("Run with --force to reauthenticate.");
              return;
            } catch {
              // Token is invalid, proceed with new auth
              console.error(
                "Existing token is invalid. Starting new authentication...",
              );
            }
          } catch {
            // No token found anywhere, proceed with login
          }
        }

        console.error("");
        console.error("To authenticate, create a new Linear API key:");
        console.error("");
        console.error(
          "  1. Open the link below (or it will open automatically)",
        );
        console.error("  2. Set key name to: linear-cli");
        console.error("  3. Keep 'Full access' selected (default)");
        console.error("  4. Keep 'All teams' selected (default)");
        console.error("  5. Click 'Create'");
        console.error("  6. Copy the generated token");
        console.error("");
        console.error(`  ${LINEAR_API_KEY_URL}`);
        console.error("");

        openBrowser(LINEAR_API_KEY_URL);

        const token = await promptToken();

        if (!token) {
          console.error("No token provided. Authentication cancelled.");
          process.exit(1);
          return;
        }

        console.error("Validating token...");
        let viewer: Viewer;
        try {
          viewer = await validateApiToken(token);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          console.error(`Token validation failed: ${detail}`);
          process.exit(1);
          return;
        }

        saveToken(token);

        console.error("");
        console.error(
          `Authentication successful. Logged in as ${viewer.name} (${viewer.email}).`,
        );
        console.error("Token encrypted and stored in ~/linear/token");
      } catch (error) {
        console.error(
          `Authentication failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exit(1);
        return;
      }
    });

  auth
    .command("status")
    .description("check current authentication status")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [, command] = args as [CommandOptions, Command];
        const rootOpts = getRootOpts(command) as CommandOptions;

        let token: string;
        let source: TokenSource;
        try {
          const resolved = resolveApiToken(rootOpts);
          token = resolved.token;
          source = resolved.source;
        } catch {
          // resolveApiToken throws when no token found — report unauthenticated
          outputResult(
            {
              authenticated: false,
              message:
                "No API token found. Run 'linear auth login' to authenticate.",
            } satisfies AuthStatusResult,
            formatAuthStatus,
            rootOpts,
          );
          return;
        }

        try {
          const viewer = await validateApiToken(token);
          outputResult(
            {
              authenticated: true,
              source: SOURCE_LABELS[source],
              user: { id: viewer.id, name: viewer.name, email: viewer.email },
            } satisfies AuthStatusResult,
            formatAuthStatus,
            rootOpts,
          );
        } catch {
          // Token is invalid or expired — report unauthenticated with source
          outputResult(
            {
              authenticated: false,
              source: SOURCE_LABELS[source],
              message:
                "Token is invalid or expired. Run 'linear auth login' to reauthenticate.",
            } satisfies AuthStatusResult,
            formatAuthStatus,
            rootOpts,
          );
        }
      }),
    );

  auth
    .command("logout")
    .description("remove stored authentication token")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [, command] = args as [CommandOptions, Command];
        const rootOpts = getRootOpts(command) as CommandOptions;

        clearToken();

        // Warn if a token is still active from another source
        try {
          const { source } = resolveApiToken(rootOpts);
          outputResult(
            {
              message: "Authentication token removed.",
              warning: `A token is still active via ${SOURCE_LABELS[source]}.`,
            } satisfies AuthLogoutResult,
            formatAuthLogout,
            rootOpts,
          );
        } catch {
          // No token remaining after logout — nothing to warn about
          outputResult(
            {
              message: "Authentication token removed.",
            } satisfies AuthLogoutResult,
            formatAuthLogout,
            rootOpts,
          );
        }
      }),
    );

  auth
    .command("usage")
    .description("show detailed usage for auth")
    .action(() => {
      console.log(formatDomainUsage(auth, AUTH_META));
    });
}
