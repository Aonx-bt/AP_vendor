// Agent 1: AP agent. Reads the bill's file, extracts with the LLM, reconciles in code,
// matches the vendor, writes insights + trace, then runs the validation agent.
import { serve } from "../_shared/deno.ts";
import { runExtraction } from "../_shared/pipeline.ts";

serve(async (body, ctx) => {
  if (!body.bill_id) throw new Error("bill_id is required");
  return { bill: await runExtraction(ctx, String(body.bill_id)), engine: ctx.llm.name };
});
