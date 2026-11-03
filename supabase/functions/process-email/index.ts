// Simulated inbox "Process" button: same pipeline as Gmail (classify -> extract -> validate -> route).
import { serve } from "../_shared/deno.ts";
import { processEmail } from "../_shared/pipeline.ts";

serve(async (body, ctx) => ({ email: await processEmail(ctx, String(body.email_id)) }));
