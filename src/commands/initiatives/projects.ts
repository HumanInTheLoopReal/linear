import type { Command } from "commander";
import { createContext, getRootOpts } from "../../common/context.js";
import { handleCommand, outputResult } from "../../common/output.js";
import {
  resolveInitiativeId,
  resolveInitiativeProjectLinkId,
} from "../../resolvers/initiative-resolver.js";
import { resolveProjectId } from "../../resolvers/project-resolver.js";
import {
  createInitiativeProjectLink,
  deleteInitiativeProjectLink,
} from "../../services/initiative-project-service.js";

interface InitiativeProjectLinkShape {
  id: string;
  initiative?: { id: string; name?: string | null } | null;
  project?: { id: string; name?: string | null } | null;
}

interface DeletedLinkShape {
  id: string;
  success?: boolean;
}

export function formatInitiativeProjectLinked(
  result: InitiativeProjectLinkShape,
): string {
  const initiative = result.initiative?.name ?? "(initiative)";
  const project = result.project?.name ?? "(project)";
  return `✓ Linked project '${project}' to initiative '${initiative}' (link id: ${result.id})\n`;
}

export function formatInitiativeProjectUnlinked(
  result: DeletedLinkShape,
): string {
  return `✓ Unlinked project from initiative (link id: ${result.id})\n`;
}

export function setupInitiativeProjectCommands(initiatives: Command): void {
  initiatives
    .command("add-project <initiative> <project>")
    .description("link a project to an initiative")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [initiative, project, , command] = args as [
          string,
          string,
          unknown,
          Command,
        ];
        const ctx = createContext(getRootOpts(command));

        const initiativeId = await resolveInitiativeId(ctx.sdk, initiative);
        const projectId = await resolveProjectId(ctx.sdk, project);

        const result = await createInitiativeProjectLink(ctx.gql, {
          initiativeId,
          projectId,
        });

        outputResult(
          result,
          formatInitiativeProjectLinked,
          getRootOpts(command),
        );
      }),
    );

  initiatives
    .command("remove-project <initiative> <project>")
    .description("unlink a project from an initiative")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [initiative, project, , command] = args as [
          string,
          string,
          unknown,
          Command,
        ];
        const ctx = createContext(getRootOpts(command));

        const initiativeId = await resolveInitiativeId(ctx.sdk, initiative);
        const projectId = await resolveProjectId(ctx.sdk, project);

        const linkId = await resolveInitiativeProjectLinkId(
          ctx.gql,
          initiativeId,
          projectId,
        );

        const result = await deleteInitiativeProjectLink(ctx.gql, linkId);
        outputResult(
          result,
          formatInitiativeProjectUnlinked,
          getRootOpts(command),
        );
      }),
    );
}
