// One pass of the inbox checker: record new Gmail messages, then process a few unprocessed ones.
// Capped per run so each call stays well inside the server's time limit; the every-minute timer
// picks up the rest. Emails are marked processed only after their bills are saved.
import type { Ctx, IncomingEmail } from "./pipeline.ts";
import { processEmail, recordEmail } from "./pipeline.ts";
import type { SecretStore } from "./secrets.ts";
import { K } from "./gmailAuth.ts";

export interface GmailReader {
  listRecentMessageIds(query: string, max?: number): Promise<string[]>;
  fetchMessage(id: string): Promise<IncomingEmail>;
}

export interface SyncResult {
  connected: true;
  recorded: number;
  processed: number;
  remaining: number;
  errors: string[];
}

export async function syncGmailOnce(ctx: Ctx, reader: GmailReader, secrets: SecretStore, opts: { query?: string; maxProcess?: number } = {}): Promise<SyncResult> {
  const known = new Set((await ctx.store.list("emails", { source: "gmail" })).map((e) => e.message_id));
  let recorded = 0, processed = 0;
  const errors: string[] = [];
  for (const gid of await reader.listRecentMessageIds(opts.query ?? "in:inbox newer_than:2d", 25)) {
    try {
      const m = await reader.fetchMessage(gid);
      if (known.has(m.message_id)) continue;
      if (await recordEmail(ctx, m)) recorded++;
      known.add(m.message_id);
    } catch (e) {
      errors.push(`message ${gid}: ${(e as Error).message}`);
    }
  }
  const pending = (await ctx.store.list("emails", { source: "gmail", processed: false })).sort((a, b) => a.received_at.localeCompare(b.received_at));
  const max = opts.maxProcess ?? 3;
  for (const e of pending.slice(0, max)) {
    try {
      await processEmail(ctx, e.id);
      processed++;
    } catch (err) {
      errors.push(`"${e.subject}": ${(err as Error).message}`);
    }
  }
  await secrets.set(K.lastSync, ctx.now().toISOString());
  return { connected: true, recorded, processed, remaining: Math.max(0, pending.length - max), errors };
}
