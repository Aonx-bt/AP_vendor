// Gmail ingestion. Scheduled every minute (pg_cron) and called by "Sync now".
// Emails are recorded first (deduped on Message-ID and attachment hash), then processed;
// an email is marked processed only after its bills are saved, so a crash is retried next run.
import { serve } from "../_shared/deno.ts";
import { fetchMessage, gmailConfigured, listRecentMessageIds } from "../_shared/gmail.ts";
import { processEmail, recordEmail } from "../_shared/pipeline.ts";

serve(async (_body, ctx) => {
  if (!gmailConfigured()) return { connected: false, message: "Gmail secrets not set; use the Simulated inbox." };
  const known = new Set((await ctx.store.list("emails", { source: "gmail" })).map((e) => e.thread_id + "|" + e.message_id));
  let recorded = 0, processed = 0;
  const errors: string[] = [];
  for (const gid of await listRecentMessageIds()) {
    try {
      const m = await fetchMessage(gid);
      if (known.has(m.thread_id + "|" + m.message_id)) continue;
      if (await recordEmail(ctx, m)) recorded++;
    } catch (e) {
      errors.push(`${gid}: ${(e as Error).message}`);
    }
  }
  for (const e of await ctx.store.list("emails", { source: "gmail", processed: false })) {
    try {
      await processEmail(ctx, e.id);
      processed++;
    } catch (err) {
      errors.push(`${e.subject}: ${(err as Error).message}`);
    }
  }
  return { connected: true, recorded, processed, errors };
});
