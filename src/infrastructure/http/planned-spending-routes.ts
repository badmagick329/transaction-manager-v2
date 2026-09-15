import { z } from "zod";
import { plannedSpendingInput, type PlannedSpendingInput, type PlannedSpendingRepository } from "../../app/planned-spending";

export function createPlannedSpendingRoutes(repository: PlannedSpendingRepository) {
  const handle = (action: (request: Request) => unknown) => async (request: Request) => {
    try { return Response.json(await action(request)); }
    catch (error) { return Response.json({ error: error instanceof z.ZodError ? "Check the item name, price, quantity, currency and interval." : (error as Error).message }, { status: 400 }); }
  };
  return {
    "/api/planned-spending": {
      GET: handle(() => repository.list()),
      POST: handle(async request => {
        const { id, ...input } = plannedSpendingInput.extend({ id: z.number().int().positive().optional() }).parse(await request.json());
        return repository.save(input as PlannedSpendingInput, id);
      }),
    },
    "/api/planned-spending/remove": { POST: handle(async request => {
      const { id } = z.object({ id: z.number().int().positive() }).strict().parse(await request.json());
      repository.remove(id); return { ok: true };
    }) },
  };
}
