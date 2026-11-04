// Wipes all AP Desk data and rebuilds the demo dataset (vendors, POs, rules, 12 bills, sample inbox).
import { serve } from "../_shared/deno.ts";
import { buildDemo } from "../_shared/seed.ts";

serve(async (_body, ctx) => {
  // deno-lint-ignore no-explicit-any
  const sb = (ctx.store as any).sb;
  for (const t of ["extraction_runs", "trace_events", "vendor_messages", "approvals", "validation_results", "bill_lines", "bills", "emails", "approval_rules", "purchase_orders", "vendors"]) {
    const { error } = await sb.from(t).delete().not("id", "is", null);
    if (error) throw new Error(`${t}: ${error.message}`);
  }
  for (const prefix of ["bills", "emails"]) {
    const { data: dirs } = await sb.storage.from("invoices").list(prefix, { limit: 1000 });
    for (const d of dirs ?? []) {
      const { data: files } = await sb.storage.from("invoices").list(`${prefix}/${d.name}`);
      if (files?.length) await sb.storage.from("invoices").remove(files.map((f: { name: string }) => `${prefix}/${d.name}/${f.name}`));
    }
  }
  // Seeding uses the simulated engine: deterministic and free. New bills use the real LLM.
  await buildDemo(ctx.store, new Date());
  return { ok: true };
});
