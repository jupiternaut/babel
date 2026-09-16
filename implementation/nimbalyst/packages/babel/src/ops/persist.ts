import type { DomainService } from "../core/domain.ts";
import { DEMO_ACTOR } from "../contracts.ts";
import type { TodoInput } from "./types.ts";

export async function persistTodoInput(
  domain: DomainService,
  projectId: string,
  todo: TodoInput,
  idempotencyKey: string,
  correlationId: string,
) {
  return domain.command({
    name: "task.create",
    projectId,
    actor: DEMO_ACTOR,
    idempotencyKey,
    correlationId,
    input: {
      title: todo.title,
      description: todo.description,
      primaryType: todo.primaryType,
      id: todo.id,
    },
  });
}
