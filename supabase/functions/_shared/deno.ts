// Edge Function plumbing: context, CORS, JSON responses.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { SupabaseStore } from "./store.ts";
import { CompositeLLM, SimulatedLLM, type LLM } from "./llm.ts";
import { SarvamExtractor } from "./sarvam.ts";
import { AnthropicLLM } from "./anthropic.ts";
import { createGmail } from "./gmail.ts";
import { GmailAuth } from "./gmailAuth.ts";
import { supabaseSecretStore, type SecretStore } from "./secrets.ts";
import type { GmailReader } from "./gmailSync.ts";
import type { Ctx } from "./pipeline.ts";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export type ServerCtx = Ctx & { llmConfigured: boolean; secrets: SecretStore; gmailAuth: GmailAuth; gmail: GmailReader };

export function makeCtx(): ServerCtx {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const secrets = supabaseSecretStore(sb);
  const gmailAuth = new GmailAuth({
    clientId: Deno.env.get("GMAIL_CLIENT_ID"), clientSecret: Deno.env.get("GMAIL_CLIENT_SECRET"),
    envRefreshToken: Deno.env.get("GMAIL_REFRESH_TOKEN"), secrets,
  });
  const gmail = createGmail(gmailAuth);
  // Invoices: Sarvam Vision if SARVAM_API_KEY is set, else Claude. Email triage and drafting: Claude if
  // LLM_API_KEY is set. Anything without a key falls back to the simulated engine.
  const key = Deno.env.get("LLM_API_KEY");
  const sarvamKey = Deno.env.get("SARVAM_API_KEY");
  const general: LLM = key ? new AnthropicLLM(key) : new SimulatedLLM();
  const llm: LLM = sarvamKey ? new CompositeLLM(new SarvamExtractor({ apiKey: sarvamKey, model: Deno.env.get("SARVAM_EXTRACT_MODEL") || undefined }), general) : general;
  return { store: new SupabaseStore(sb), llm, now: () => new Date(), mailer: gmail.mailer, llmConfigured: Boolean(key || sarvamKey), secrets, gmailAuth, gmail: gmail.reader };
}

export function serve(handler: (body: Record<string, unknown>, ctx: ServerCtx) => Promise<unknown>) {
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
