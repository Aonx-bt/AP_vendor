// Edge Function plumbing: context, CORS, JSON responses.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { SupabaseStore } from "./store.ts";
import { SimulatedLLM, type LLM } from "./llm.ts";
import { AnthropicLLM } from "./anthropic.ts";
import { gmailMailer } from "./gmail.ts";
import type { Ctx } from "./pipeline.ts";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function makeCtx(): Ctx & { llmConfigured: boolean } {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const key = Deno.env.get("LLM_API_KEY");
  const llm: LLM = key ? new AnthropicLLM(key) : new SimulatedLLM();
  return { store: new SupabaseStore(sb), llm, now: () => new Date(), mailer: gmailMailer, llmConfigured: Boolean(key) };
}

export function serve(handler: (body: Record<string, unknown>, ctx: ReturnType<typeof makeCtx>) => Promise<unknown>) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    try {
      const body = req.headers.get("content-type")?.includes("json") ? await req.json() : {};
      const out = await handler(body, makeCtx());
      return new Response(JSON.stringify(out ?? { ok: true }), { headers: { ...cors, "Content-Type": "application/json" } });
    } catch (e) {
      console.error(e);
      return new Response(JSON.stringify({ error: (e as Error).message }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    }
  });
}
