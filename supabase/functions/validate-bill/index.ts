// Agent 2: validation agent. Re-runs every check and the routing decision.
import { serve } from "../_shared/deno.ts";
import { runValidation } from "../_shared/pipeline.ts";

serve(async (body, ctx) => {
  if (!body.bill_id) throw new Error("bill_id is required");
  return { bill: await runValidation(ctx, String(body.bill_id), String(body.actor ?? "validation_agent")) };
});
