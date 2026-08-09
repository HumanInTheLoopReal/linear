import type { Command } from "commander";
import { GraphQLClient } from "../client/graphql-client.js";
import { LinearSdkClient } from "../client/linear-client.js";
import { resolveAgentMode } from "./agent-mode.js";
import { type CommandOptions, getApiToken } from "./auth.js";
import { getLinearEndpoint } from "./config-store.js";
import { ensureRepoScope } from "./scope-bootstrap.js";

export type { CommandOptions };

export interface CommandContext {
  gql: GraphQLClient;
  sdk: LinearSdkClient;
}

export function createContext(options: CommandOptions): CommandContext {
  const token = getApiToken(options);
  // Per-process side effect: write `<repo>/.linear/config.json` on first
  // run in a fresh repo so subsequent reads/writes see the derived scope
  // label. Returns silently when not in a repo, when already configured,
  // or when `LINEAR_NO_AUTO_INIT` is set.
  ensureRepoScope();
  const endpoint = getLinearEndpoint();
  return {
    gql: new GraphQLClient(token, endpoint),
    sdk: new LinearSdkClient(token, endpoint),
  };
}

export function createGraphQLClient(token: string): GraphQLClient {
  return new GraphQLClient(token, getLinearEndpoint());
}

export function getRootOpts(command: Command): CommandOptions {
  let current: Command = command;

  while (current.parent) {
    current = current.parent;
  }

  const opts = current.opts() as CommandOptions;
  // Resolve agent mode once here so every command (and outputResult /
  // resolveJsonMode, which receive these opts) inherits it without
  // threading env through each call site (lin-g1hy).
  if (opts.agentMode === undefined) {
    opts.agentMode = resolveAgentMode();
  }
  return opts;
}
