// Try real invoices end to end without any website or database:
//   SARVAM_API_KEY=... npm run try-extract -- invoice1.pdf invoice2.jpg [--add-vendor] [--out report.md]
// Each file goes through Sarvam Vision (reading) and then AP Desk's real pipeline
// (reconciliation, vendor match, insights, all checks, decision, approval routing) in memory.
// --add-vendor: if the invoice's vendor isn't in the demo vendor list, add it from the invoice's own
// GSTIN and bank details so the vendor checks also run (registry status and bank are then "unverified").
import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { MemoryStore } from "../supabase/functions/_shared/store.ts";
import { buildDemo } from "../supabase/functions/_shared/seed.ts";
import { CompositeLLM, SimulatedLLM } from "../supabase/functions/_shared/llm.ts";
import { SarvamExtractor } from "../supabase/functions/_shared/sarvam.ts";
import { createBillFromFile, runExtraction, runValidation, type Ctx } from "../supabase/functions/_shared/pipeline.ts";
import { CHECK_LABELS } from "../supabase/functions/_shared/checks.ts";
import { inr } from "../supabase/functions/_shared/util.ts";
import type { Bill, Vendor } from "../supabase/functions/_shared/types.ts";

const args = process.argv.slice(2);
const addVendor = args.includes("--add-vendor");
const outIdx = args.indexOf("--out");
const out = outIdx >= 0 ? args[outIdx + 1] : "try-extract-report.md";
const files = args.filter((a, i) => !a.startsWith("--") && (outIdx < 0 || i !== outIdx + 1));
const key = process.env.SARVAM_API_KEY;

if (!files.length) {
  console.error("Usage: npm run try-extract -- <invoice.pdf|png|jpg> [...] [--add-vendor] [--out report.md]");
  process.exit(1);
}
if (!key) {
  console.error("SARVAM_API_KEY is not set. Add it as an environment variable (never paste it into code or chat).");
  process.exit(1);
}

const MIME: Record<string, string> = { ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };
const ORDER = ["gstin_format", "gstin_status", "msme_status", "bank_details", "duplicate", "math_check", "tax_split", "po_match", "tds_applicable", "rcm_flag"];
const ICON = { pass: "✓", warn: "⚠", fail: "✗", skipped: "–" } as const;
const STATUS: Record<string, string> = {
  needs_review: "Needs review", needs_vendor_info: "Needs info from vendor", in_approval: "Sent for approval",
  approved: "Approved", rejected: "Rejected", duplicate: "Duplicate", received: "Not read",
};

const store = new MemoryStore();
await buildDemo(store, new Date());
// keep the demo vendors, POs and rules; drop demo bills so duplicates are only checked among your files
for (const t of ["bills", "bill_lines", "validation_results", "approvals", "trace_events", "emails", "vendor_messages"] as const) store.db[t] = [];
const ctx: Ctx = { store, llm: new CompositeLLM(new SarvamExtractor({ apiKey: key, model: process.env.SARVAM_EXTRACT_MODEL || undefined }), new SimulatedLLM()), now: () => new Date() };

const fmt = (k: string, v: unknown) =>
  v == null || v === "" ? "_not found_" : ["subtotal", "cgst", "sgst", "igst", "total"].includes(k) ? inr(v as number) : String(v);

let md = `# AP Desk extraction test\n\n${new Date().toLocaleString("en-IN")} · engine: Sarvam Vision (Document AI Extract)\n`;

for (const path of files) {
  const name = basename(path);
  const mime = MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
  process.stdout.write(`Reading ${name} … `);
  const bytes = new Uint8Array(readFileSync(path));
  const created = await createBillFromFile(ctx, { bytes, mime, name, actor: "test" });
  let bill: Bill = await runExtraction(ctx, created.id);

  let added: Vendor | null = null;
  if (addVendor && !bill.vendor_id && bill.extracted?.vendor_gstin) {
    added = await store.insert("vendors", {
      name: bill.extracted.vendor_name ?? "Vendor from invoice", gstin: bill.extracted.vendor_gstin, gstin_status: "active",
      msme_status: null, udyam_no: null, bank_name: null, bank_last4: bill.bank_last4, ifsc: bill.ifsc, bank_verified: false,
      email_domain: null, tds_section: null, fy_taxable_total: 0, contact_email: null,
    } as Partial<Vendor>);
    await store.update("bills", bill.id, { vendor_id: added.id });
    bill = await runValidation(ctx, bill.id);
  }

  const traces = store.db.trace_events.filter((t) => t.bill_id === bill.id);
  const ext = traces.find((t) => t.action === "Extracted invoice fields");
  const det = (ext?.evidence.engine_details ?? {}) as Record<string, unknown>;
  const failure = traces.find((t) => ["Extraction failed", "Cannot read invoice", "Unsupported file", "Password-protected PDF", "Corrupted file"].includes(t.action));
  console.log(failure ? `could not read: ${failure.reasoning}` : `${STATUS[bill.status]} (${det.seconds ?? "?"} s)`);

  md += `\n---\n\n## ${name}\n\n`;
  if (failure) {
    md += `**Could not read this file.** ${failure.reasoning}\n`;
    continue;
  }
  const ex = bill.extracted!;
  const conf = bill.field_confidence ?? {};
  const vendor = bill.vendor_id ? store.db.vendors.find((v) => v.id === bill.vendor_id) : null;
  md += `**Decision: ${STATUS[bill.status]}.** ${[...traces].reverse().find((t) => t.action.startsWith("Decision") || t.action.startsWith("Routed"))?.reasoning ?? ""}\n\n`;
  md += `Read by Sarvam in ${det.seconds ?? "?"} s (job \`${det.job_id ?? "?"}\`; confidence ${det.confidence_source === "sarvam" ? "from Sarvam" : "not returned by Sarvam, defaults used"}).\n\n`;
  md += `### Fields\n\n| Field | Value | Confidence |\n|---|---|---|\n`;
  const rows: [string, string, unknown][] = [
    ["Vendor", "vendor_name", ex.vendor_name], ["Vendor GSTIN", "vendor_gstin", ex.vendor_gstin], ["Vendor PAN", "vendor_pan", ex.vendor_pan],
    ["Invoice no", "invoice_no", ex.invoice_no], ["Invoice date", "invoice_date", ex.invoice_date], ["Due date", "due_date", ex.due_date],
    ["Payment terms", "payment_terms", ex.payment_terms], ["PO ref", "po_reference", ex.po_reference],
    ["Bank a/c (last 4)", "bank_account_last4", ex.bank_account_last4], ["IFSC", "ifsc", ex.ifsc],
    ["Subtotal", "subtotal", ex.subtotal], ["CGST", "cgst", ex.cgst], ["SGST", "sgst", ex.sgst], ["IGST", "igst", ex.igst], ["Total", "total", ex.total],
  ];
  for (const [label, k, v] of rows) {
    const c = conf[k];
    md += `| ${label} | ${fmt(k, v)} | ${c == null ? "" : `${Math.round(c * 100)}%${c < 0.8 ? " ⚠ check" : ""}`} |\n`;
  }
  md += `\n### Line items (${ex.line_items.length})\n\n| # | Description | HSN/SAC | Qty | Rate | GST % | Amount excl GST |\n|---|---|---|---|---|---|---|\n`;
  ex.line_items.forEach((l, i) => {
    md += `| ${i + 1} | ${l.description ?? ""} | ${l.hsn_sac ?? ""} | ${l.qty ?? ""} | ${l.rate != null ? inr(l.rate) : ""} | ${l.gst_pct ?? ""} | ${l.amount_excl_gst != null ? inr(l.amount_excl_gst) : ""} |\n`;
  });
  md += `\n### Vendor\n\n${vendor ? `Matched to **${vendor.name}**${added ? " (added from this invoice with --add-vendor; registry status and bank are unverified)" : ""}.` : "Not in the vendor list, so registry, MSME, bank, duplicate, TDS and PO checks can't fully run. Re-run with `--add-vendor` to see them."}\n`;
  if (ex.suspicious_instructions) md += `\n**Instruction found inside the document (ignored):** "${ex.suspicious_instructions}"\n`;
  if (bill.insights?.length) md += `\n### Insights\n\n${bill.insights.map((i) => `- ${i.text}`).join("\n")}\n`;
  md += `\n### Checks\n\n`;
  const results = store.db.validation_results.filter((r) => r.bill_id === bill.id).sort((a, b) => ORDER.indexOf(a.check_key) - ORDER.indexOf(b.check_key));
  for (const r of results) md += `- ${ICON[r.outcome]} **${CHECK_LABELS[r.check_key] ?? r.check_key}**: ${r.detail}\n`;
  if (det.raw_result) md += `\n<details><summary>Raw Sarvam output</summary>\n\n\`\`\`json\n${JSON.stringify(det.raw_result, null, 2)}\n\`\`\`\n</details>\n`;
}

writeFileSync(out, md);
console.log(`\nReport written to ${out}`);
