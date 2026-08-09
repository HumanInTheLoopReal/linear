import type { Command } from "commander";
import { createContext, getRootOpts } from "../../common/context.js";
import { handleCommand, outputResult } from "../../common/output.js";
import {
  resolveInitiativeId,
  resolveInitiativeRelationId,
} from "../../resolvers/initiative-resolver.js";
import {
  createInitiativeRelation,
  deleteInitiativeRelation,
} from "../../services/initiative-relation-service.js";

interface InitiativeRelationShape {
  id: string;
  parentInitiative?: { id: string; name?: string | null } | null;
  childInitiative?: { id: string; name?: string | null } | null;
}

interface DeletedRelationShape {
  id: string;
  success?: boolean;
}

export function formatInitiativeRelated(
  result: InitiativeRelationShape,
): string {
  const parent = result.parentInitiative?.name ?? "(parent)";
  const child = result.childInitiative?.name ?? "(child)";
  return `✓ Related '${parent}' → '${child}' (relation id: ${result.id})\n`;
}

export function formatInitiativeUnrelated(
  result: DeletedRelationShape,
): string {
  return `✓ Unrelated initiatives (relation id: ${result.id})\n`;
}

export function setupInitiativeRelationCommands(initiatives: Command): void {
  initiatives
    .command("relate <parent> <child>")
    .description("create a parent/child initiative relation")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [parent, child, , command] = args as [
          string,
          string,
          unknown,
          Command,
        ];
        const ctx = createContext(getRootOpts(command));

        const parentId = await resolveInitiativeId(ctx.sdk, parent);
        const childId = await resolveInitiativeId(ctx.sdk, child);

        const result = await createInitiativeRelation(ctx.gql, {
          parentId,
          childId,
        });

        outputResult(result, formatInitiativeRelated, getRootOpts(command));
      }),
    );

  initiatives
    .command("unrelate <parent> <child>")
    .description("delete a parent/child initiative relation")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [parent, child, , command] = args as [
          string,
          string,
          unknown,
          Command,
        ];
        const ctx = createContext(getRootOpts(command));

        const parentId = await resolveInitiativeId(ctx.sdk, parent);
        const childId = await resolveInitiativeId(ctx.sdk, child);

        const relationId = await resolveInitiativeRelationId(
          ctx.gql,
          parentId,
          childId,
        );

        const result = await deleteInitiativeRelation(ctx.gql, relationId);
        outputResult(result, formatInitiativeUnrelated, getRootOpts(command));
      }),
    );
}
