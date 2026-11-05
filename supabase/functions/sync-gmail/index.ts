// Gmail ingestion. Runs every minute (pg_cron, once Gmail is connected) and on "Sync now".
// Records new emails (deduped on Message-ID and attachment hash), then processes up to 3 per run;
// an email is marked processed only after its bills are saved, so a crash is retried next run.
import { serve } from "../_shared/deno.ts";
import { syncGmailOnce } from "../_shared/gmailSync.ts";

serve(async (_body, ctx) => {
  const st = await ctx.gmailAuth.status();
  if (!st.configured) return { connected: false, reason: "not_configured", message: "Gmail is not set up yet (Google client ID and secret missing)." };
  if (!st.connected) return { connected: false, reason: st.error ? "revoked" : "not_connected", message: st.error ?? "Click Connect Gmail in Settings → Mailbox." };
  try {
    if (!st.address) await ctx.gmailAuth.ensureAddress();
    return await syncGmailOnce(ctx, ctx.gmail, ctx.secrets, { query: Deno.env.get("GMAIL_QUERY") || undefined, maxProcess: 3 });
  } catch (e) {
    const msg = (e as Error).message;
    // a revoked permission is a state, not a crash: report it so the Mailbox screen can show "Connect again"
    if (msg.includes("Google disconnected")) return { connected: false, reason: "revoked", message: msg };
    throw e;
  }
});
