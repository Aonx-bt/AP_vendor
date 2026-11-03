// The agents. Every function takes a Ctx so the same code runs in the browser (demo mode)
// and in Supabase Edge Functions. Every decision writes a trace_events row with its reasoning.
import type { Approval, ApprovalRule, Bill, BillLine, Condition, Email, EmailAttachment, Insight, Role, TraceEvent, Vendor, VendorMessage } from "./types.ts";
import { COMPANY, PEOPLE, ROLE_LABEL } from "./types.ts";
import type { Store } from "./store.ts";
import type { LLM } from "./llm.ts";
import { emptyExtraction } from "./llm.ts";
import { inspectPdf } from "./pdf.ts";
import { CHECK_LABELS, FIELD_LABEL, missingRequired, rcmCandidate, runChecks, TDS_RULES } from "./checks.ts";
import { addDays, daysBetween, domainOf, inr, isoDate, nameSimilarity, num, round2, sha256Hex } from "./util.ts";

export interface Mailer {
  connected: boolean;
  send(m: { to: string; subject: string; body: string; inReplyTo?: string | null; threadId?: string | null }): Promise<{ rfc_message_id: string; thread_id: string | null }>;
}

export interface Ctx {
  store: Store;
  llm: LLM;
  now: () => Date;
  mailer?: Mailer;
}

export const SUPPORTED_MIME = ["application/pdf", "image/png", "image/jpeg"];

// ------------------------------------------------------------------ helpers

export async function trace(ctx: Ctx, bill_id: string | null, actor: string, action: string, reasoning: string, evidence: Record<string, unknown> = {}, email_id: string | null = null) {
  await ctx.store.insert("trace_events", { bill_id, email_id, actor, action, reasoning, evidence, ts: ctx.now().toISOString() } as Partial<TraceEvent>);
}

async function setStatus(ctx: Ctx, bill: Bill, status: Bill["status"]) {
  return ctx.store.update("bills", bill.id, { status, updated_at: ctx.now().toISOString() });
}

function personRole(name: string): Role | null {
  return PEOPLE.find((p) => p.name === name)?.role ?? null;
}

export function evaluateCondition(c: Condition, bill: Bill, vendor: Vendor | null): boolean {
  switch (c.field) {
    case "department":
      return (bill.department ?? "").toLowerCase() === String(c.value).toLowerCase();
    case "vendor_msme":
      return Boolean(vendor?.msme_status) === (c.value === true || c.value === "true");
    case "amount": {
      const t = num(bill.total), v = Number(c.value);
      return c.op === "gt" ? t > v : c.op === "gte" ? t >= v : c.op === "lt" ? t < v : t === v;
    }
  }
}

export function describeCondition(c: Condition): string {
  const op = { eq: "=", gt: "over", gte: "at least", lt: "under" }[c.op];
  if (c.field === "amount") return `Amount ${op} ${inr(Number(c.value))}`;
  if (c.field === "vendor_msme") return `Vendor is ${c.value === true || c.value === "true" ? "" : "not "}MSME`;
  return `Department = ${c.value}`;
}

export function matchRule(rules: ApprovalRule[], bill: Bill, vendor: Vendor | null): ApprovalRule | null {
  return [...rules].sort((a, b) => a.priority - b.priority).find((r) => r.conditions.every((c) => evaluateCondition(c, bill, vendor))) ?? null;
}

// ------------------------------------------------------------------ intake: file -> bill

export async function createBillFromFile(
  ctx: Ctx,
  f: { bytes: Uint8Array; mime: string; name: string; source_email_id?: string | null; department?: string | null; actor?: string },
): Promise<Bill> {
  const hash = await sha256Hex(f.bytes);
  const bill = await ctx.store.insert("bills", {
    status: "received", file_name: f.name, file_mime: f.mime, file_hash: hash, source_email_id: f.source_email_id ?? null,
    department: f.department ?? null, discount: 0, cgst: 0, sgst: 0, igst: 0, adjustments: 0, tds_pct: 0, rcm: false,
    vendor_id: null, vendor_gstin: null, bank_last4: null, ifsc: null, invoice_no: null, invoice_date: null, due_date: null,
    payment_terms: null, subtotal: null, tax_total: null, total: null, tds_section: null, narration: null, po_id: null, po_reference: null,
    extracted: null, field_confidence: null, insights: null, paid_at: null,
    created_at: ctx.now().toISOString(), updated_at: ctx.now().toISOString(),
  } as Partial<Bill>);
  const path = `bills/${bill.id}/${f.name.replace(/[^A-Za-z0-9._-]/g, "_")}`;
  await ctx.store.putFile(path, f.bytes, f.mime);
  const saved = await ctx.store.update("bills", bill.id, { file_path: path });
  await trace(ctx, bill.id, f.actor ?? "ap_agent", "Bill received", f.source_email_id ? `Attachment ${f.name} saved from email.` : `${f.name} uploaded by ${f.actor ?? "user"}.`, { file: f.name, mime: f.mime, sha256: hash });
  return saved;
}

// ------------------------------------------------------------------ Agent 1: AP agent

export async function runExtraction(ctx: Ctx, billId: string): Promise<Bill> {
  let bill = (await ctx.store.get("bills", billId))!;
  const fail = async (action: string, reasoning: string, evidence: Record<string, unknown> = {}) => {
    await trace(ctx, billId, "ap_agent", action, reasoning, evidence);
    bill = await ctx.store.update("bills", billId, { status: "needs_review", insights: [{ kind: "info", text: reasoning }] });
    return bill;
  };

  if (!bill.file_path) return fail("Cannot read invoice", "No file is attached to this bill.");
  const file = await ctx.store.getFile(bill.file_path);
  if (!file) return fail("Cannot read invoice", "The file could not be loaded from storage.");
  const mime = bill.file_mime ?? file.mime;
  if (!SUPPORTED_MIME.includes(mime)) return fail("Unsupported file", `File type ${mime} is not supported. Upload a PDF, PNG or JPG.`, { mime });
  if (mime === "application/pdf") {
    const p = inspectPdf(file.bytes);
    if (p === "encrypted") return fail("Password-protected PDF", "The PDF is password-protected, so it cannot be read. Ask the vendor for an unlocked copy or the password.", { problem: p });
    if (p === "not_pdf" || p === "corrupted") return fail("Corrupted file", "The file is not a valid PDF (header or end-of-file marker missing). It may be corrupted or truncated.", { problem: p });
  }

  // 1. LLM reads the document
  let result;
  try {
    result = await ctx.llm.extractInvoice({ bytes: file.bytes, mime, name: bill.file_name ?? "invoice" });
  } catch (e) {
    return fail("Extraction failed", `The AP agent could not read the document: ${(e as Error).message}`, { engine: ctx.llm.name });
  }
  const ex = { ...emptyExtraction(), ...result.fields };
  const conf = { ...result.confidence };
  const found = Object.entries(ex).filter(([k, v]) => k !== "line_items" && k !== "suspicious_instructions" && v != null).length;
  const low = Object.entries(conf).filter(([, c]) => c < 0.8).map(([k]) => k);
  await trace(ctx, billId, "ap_agent", "Extracted invoice fields", `Read ${found} header fields and ${ex.line_items.length} line item${ex.line_items.length === 1 ? "" : "s"}${low.length ? `; low confidence on ${low.join(", ")}` : ""}.`, { engine: result.engine, fields: ex, confidence: conf, ...(result.details ? { engine_details: result.details } : {}) });

  if (ex.suspicious_instructions) {
    await trace(ctx, billId, "ap_agent", "Ignored instructions in document", "The document contains text addressed to an automated system. It was treated as data and not followed.", { text: ex.suspicious_instructions });
  }

  // 2. Vendor: GSTIN first, then fuzzy name
  const vendors = await ctx.store.list("vendors");
  let vendor: Vendor | null = null;
  if (ex.vendor_gstin) vendor = vendors.find((v) => v.gstin && v.gstin.toUpperCase() === ex.vendor_gstin!.toUpperCase()) ?? null;
  if (vendor) await trace(ctx, billId, "ap_agent", "Matched vendor", `GSTIN ${ex.vendor_gstin} matches ${vendor.name} in the vendor master.`, { method: "gstin", vendor_id: vendor.id });
  else if (ex.vendor_name) {
    const scored = vendors.map((v) => ({ v, s: nameSimilarity(ex.vendor_name!, v.name) })).sort((a, b) => b.s - a.s);
    if (scored[0] && scored[0].s >= 0.8) {
      vendor = scored[0].v;
      await trace(ctx, billId, "ap_agent", "Matched vendor", `No GSTIN match; name "${ex.vendor_name}" is ${Math.round(scored[0].s * 100)}% similar to ${vendor.name}.`, { method: "fuzzy_name", score: round2(scored[0].s), vendor_id: vendor.id });
    } else {
      await trace(ctx, billId, "ap_agent", "Vendor not matched", `No vendor with GSTIN ${ex.vendor_gstin ?? "(none)"} and no name close to "${ex.vendor_name}" (best ${scored[0] ? Math.round(scored[0].s * 100) : 0}%). Left unassigned for a person to pick.`, { candidates: scored.slice(0, 3).map((x) => ({ name: x.v.name, score: round2(x.s) })) });
    }
  }

  // 3. Lines and sums are computed in code, never by the LLM
  const lines = ex.line_items.map((l, i) => ({
    bill_id: billId, position: i + 1, description: l.description, hsn_sac: l.hsn_sac, qty: l.qty, rate: l.rate, gst_pct: l.gst_pct,
    amount_excl_gst: l.amount_excl_gst ?? (l.qty != null && l.rate != null ? round2(l.qty * l.rate) : null),
  }));
  await ctx.store.remove("bill_lines", { bill_id: billId });
  await ctx.store.insertMany("bill_lines", lines as Partial<BillLine>[]);
  const lineSum = round2(lines.reduce((s, l) => s + num(l.amount_excl_gst), 0));
  const subtotal = ex.subtotal ?? (lines.length ? lineSum : null);
  const tax = round2(num(ex.cgst) + num(ex.sgst) + num(ex.igst));
  await trace(ctx, billId, "ap_agent", "Reconciled amounts", `Lines sum to ${inr(lineSum)}; subtotal ${inr(subtotal)} + GST ${inr(tax)} = ${inr(round2(num(subtotal) + tax))} vs printed total ${inr(ex.total)}.`, { line_sum: lineSum, subtotal, tax, printed_total: ex.total });

  // 4. Due date: printed, or derived from terms (flagged for checking)
  let due = ex.due_date;
  const termDays = ex.payment_terms?.match(/(\d{1,3})/)?.[1];
  if (!due && ex.invoice_date && termDays) {
    due = isoDate(addDays(new Date(ex.invoice_date), Number(termDays)));
    conf.due_date = 0.7;
    await trace(ctx, billId, "ap_agent", "Derived due date", `No due date printed; ${ex.payment_terms} from ${ex.invoice_date} gives ${due}. Marked for checking.`, { payment_terms: ex.payment_terms });
  }

  // 5. PO and department
  const pos = await ctx.store.list("purchase_orders");
  const po = ex.po_reference ? pos.find((p) => p.po_number.toUpperCase() === ex.po_reference!.toUpperCase() && (!vendor || p.vendor_id === vendor.id)) : null;
  let department = bill.department;
  if (!department && vendor) {
    const prev = (await ctx.store.list("bills", { vendor_id: vendor.id })).filter((b) => b.department && b.id !== billId);
    if (prev.length) {
      department = prev[prev.length - 1].department;
      await trace(ctx, billId, "ap_agent", "Set department", `Department set to ${department}, as on this vendor's previous bills.`, {});
    }
  }

  // 6. Insights
  const otherBills = vendor ? (await ctx.store.list("bills", { vendor_id: vendor.id })).filter((b) => b.id !== billId && b.total) : [];
  const email = bill.source_email_id ? await ctx.store.get("emails", bill.source_email_id) : null;
  const insights = buildInsights(ctx, { ex, due, vendor, lines: lines as BillLine[], otherBills, email });
  await trace(ctx, billId, "ap_agent", "Generated insights", insights.length ? insights.map((i) => i.text).join(" ") : "Nothing unusual.", { insights });

  const rcm = rcmCandidate(lines as BillLine[], vendor, ex.vendor_gstin) != null;
  bill = await ctx.store.update("bills", billId, {
    vendor_id: vendor?.id ?? null, vendor_gstin: ex.vendor_gstin, bank_last4: ex.bank_account_last4, ifsc: ex.ifsc,
    invoice_no: ex.invoice_no, invoice_date: ex.invoice_date, due_date: due, payment_terms: ex.payment_terms,
    subtotal, cgst: num(ex.cgst), sgst: num(ex.sgst), igst: num(ex.igst), tax_total: tax, total: ex.total,
    po_id: po?.id ?? null, po_reference: ex.po_reference, department, rcm, tds_section: vendor?.tds_section ?? null,
    narration: bill.narration ?? (lines[0]?.description ?? null),
    extracted: ex, field_confidence: conf, insights,
  });
  return runValidation(ctx, billId);
}

function buildInsights(ctx: Ctx, a: { ex: ReturnType<typeof emptyExtraction>; due: string | null; vendor: Vendor | null; lines: BillLine[]; otherBills: Bill[]; email: Email | null }): Insight[] {
  const out: Insight[] = [];
  const today = isoDate(ctx.now());
  if (a.ex.suspicious_instructions) out.push({ kind: "injection", text: `Document contains an instruction aimed at automation ("${a.ex.suspicious_instructions.slice(0, 80)}"). Ignored; review with care.` });
  if (a.ex.invoice_date) {
    const age = daysBetween(a.ex.invoice_date, today);
    if (a.due) {
      const left = daysBetween(today, a.due);
      const d = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
      out.push({ kind: "terms", text: left < 0 ? `Invoice is ${d(age)} old${a.ex.payment_terms ? ` on ${a.ex.payment_terms} terms` : ""}: ${d(-left)} overdue.` : `Invoice is ${d(age)} old; due in ${d(left)}${a.ex.payment_terms ? ` (${a.ex.payment_terms})` : ""}.` });
    }
  }
  if (a.email && a.vendor?.email_domain && domainOf(a.email.from_address) !== a.vendor.email_domain)
    out.push({ kind: "sender", text: `Arrived from ${domainOf(a.email.from_address)}, not the vendor's ${a.vendor.email_domain}; probably forwarded.` });
  const rc = rcmCandidate(a.lines, a.vendor, a.ex.vendor_gstin);
  if (rc) out.push({ kind: "rcm", text: `Probable reverse charge (${rc.reason}). GST is self-assessed, not paid to the vendor.` });
  if (a.ex.total && a.otherBills.length >= 1) {
    const avg = a.otherBills.reduce((s, b) => s + num(b.total), 0) / a.otherBills.length;
    if (a.ex.total > avg * 2) out.push({ kind: "amount", text: `Amount is ${(a.ex.total / avg).toFixed(1)}× this vendor's average bill (${inr(round2(avg))}).` });
  }
  if (a.vendor?.msme_status && a.ex.invoice_date) out.push({ kind: "msme", text: `MSME vendor: pay by ${isoDate(addDays(new Date(a.ex.invoice_date), 45))} (45 days) to avoid interest under the MSMED Act.` });
  return out.slice(0, 3);
}

// ------------------------------------------------------------------ Agent 2: validation agent

export async function runValidation(ctx: Ctx, billId: string, actor = "validation_agent"): Promise<Bill> {
  let bill = (await ctx.store.get("bills", billId))!;
  const [lines, allBills, pos] = await Promise.all([ctx.store.list("bill_lines", { bill_id: billId }), ctx.store.list("bills"), ctx.store.list("purchase_orders")]);
  const vendor = bill.vendor_id ? await ctx.store.get("vendors", bill.vendor_id) : null;
  const email = bill.source_email_id ? await ctx.store.get("emails", bill.source_email_id) : null;
  lines.sort((a, b) => a.position - b.position);

  const results = runChecks({ bill, lines, vendor, otherBills: allBills, pos, email, today: ctx.now() });
  await ctx.store.remove("validation_results", { bill_id: billId });
  await ctx.store.insertMany("validation_results", results.map((r) => ({ ...r, bill_id: billId, created_at: ctx.now().toISOString() })));
  for (const r of results)
    await trace(ctx, billId, "validation_agent", `${CHECK_LABELS[r.check_key] ?? r.check_key}: ${r.outcome}`, r.detail, { check_key: r.check_key, source: r.source, ...r.evidence });

  // TDS on the bill follows the check
  const tds = results.find((r) => r.check_key === "tds_applicable");
  const sec = (tds?.evidence.section as string) ?? null;
  bill = await ctx.store.update("bills", billId, {
    tds_section: sec,
    tds_pct: tds && (tds.evidence.tds_amount as number) > 0 && sec ? TDS_RULES[sec].pct : 0,
  });

  const fails = results.filter((r) => r.outcome === "fail");
  const missing = missingRequired(bill);
  const dup = fails.find((r) => r.check_key === "duplicate");
  if (dup) {
    await trace(ctx, billId, "validation_agent", "Decision: duplicate", `${dup.detail} Marked duplicate; it will not be paid.`, { failed: fails.map((f) => f.check_key) });
    return setStatus(ctx, bill, "duplicate");
  }
  if (fails.length) {
    await trace(ctx, billId, "validation_agent", "Decision: needs review", `${fails.length} check${fails.length > 1 ? "s" : ""} failed: ${fails.map((f) => CHECK_LABELS[f.check_key]).join(", ")}.`, { failed: fails.map((f) => ({ check: f.check_key, detail: f.detail })), missing });
    return setStatus(ctx, bill, "needs_review");
  }
  if (missing.length) {
    await trace(ctx, billId, "validation_agent", "Decision: needs vendor info", `Required field${missing.length > 1 ? "s" : ""} missing from the invoice: ${missing.map((m) => FIELD_LABEL[m]).join(", ")}.`, { missing });
    return setStatus(ctx, bill, "needs_vendor_info");
  }
  const warns = results.filter((r) => r.outcome === "warn");
  await trace(ctx, billId, "validation_agent", "Decision: ready for approval", `No checks failed${warns.length ? `; ${warns.length} warning${warns.length > 1 ? "s" : ""} for the approver (${warns.map((w) => CHECK_LABELS[w.check_key]).join(", ")})` : ""}.`, { warnings: warns.map((w) => w.check_key) });
  return startApproval(ctx, billId);
}

// ------------------------------------------------------------------ Agent 3: approval workflow agent

export async function startApproval(ctx: Ctx, billId: string, actor = "workflow_agent"): Promise<Bill> {
  const bill = (await ctx.store.get("bills", billId))!;
  const vendor = bill.vendor_id ? await ctx.store.get("vendors", bill.vendor_id) : null;
  const rules = await ctx.store.list("approval_rules");
  const rule = matchRule(rules, bill, vendor);
  for (const a of await ctx.store.list("approvals", { bill_id: billId })) if (a.status === "pending" || a.status === "waiting") await ctx.store.update("approvals", a.id, { status: "cancelled" });
  if (!rule) {
    await trace(ctx, billId, "workflow_agent", "No approval rule matched", "No rule matches this bill, so it cannot be routed. Add a catch-all rule in Settings.", { rules: rules.map((r) => r.name) });
    return setStatus(ctx, bill, "needs_review");
  }
  const now = ctx.now().toISOString();
  await ctx.store.insertMany("approvals", rule.levels.map((l) => ({
    bill_id: billId, rule_id: rule.id, level: l.level, approver_name: l.approver_name, approver_role: l.approver_role,
    status: l.level === 1 ? "pending" : "waiting", comment: null, pending_since: l.level === 1 ? now : null, acted_at: null, created_at: now,
  } as Partial<Approval>)));
  const why = rule.conditions.length ? rule.conditions.map(describeCondition).join(" and ") : "it is the catch-all rule";
  await trace(ctx, billId, actor, `Routed to "${rule.name}"`, `Matched because ${why}. ${rule.levels.map((l) => `Level ${l.level}: ${l.approver_name} (${ROLE_LABEL[l.approver_role]})`).join("; ")}.`, {
    rule_id: rule.id, conditions: rule.conditions.map((c) => ({ condition: describeCondition(c), match: evaluateCondition(c, bill, vendor) })),
  });
  return setStatus(ctx, bill, "in_approval");
}

export async function sendToApprovalOverride(ctx: Ctx, billId: string, actor: string, comment: string) {
  if (!comment.trim()) throw new Error("A comment is required to send a bill for approval with open issues.");
  await trace(ctx, billId, actor, "Sent for approval with open issues", comment, {});
  return startApproval(ctx, billId, actor);
}

export type ApprovalActionKind = "approve" | "reject" | "request_changes";

export async function approvalAction(ctx: Ctx, p: { approvalId: string; action: ApprovalActionKind; actor: string; comment?: string }) {
  const ap = await ctx.store.get("approvals", p.approvalId);
  if (!ap) throw new Error("Approval not found");
  if (ap.status !== "pending") throw new Error(`Level ${ap.level} is ${ap.status}, not awaiting action.`);
  const role = personRole(p.actor);
  if (role !== ap.approver_role) throw new Error(`Only ${ap.approver_name} (${ROLE_LABEL[ap.approver_role]}) can act on level ${ap.level}.`);
  const all = (await ctx.store.list("approvals", { bill_id: ap.bill_id })).filter((a) => a.status !== "cancelled").sort((a, b) => a.level - b.level);
  if (all.some((a) => a.level < ap.level && a.status !== "approved")) throw new Error(`Level ${ap.level} becomes actionable after level ${ap.level - 1} approves.`);
  const comment = (p.comment ?? "").trim();
  if (p.action !== "approve" && !comment) throw new Error("A comment is required to reject or request changes.");
  const now = ctx.now().toISOString();
  const bill = (await ctx.store.get("bills", ap.bill_id))!;

  if (p.action === "approve") {
    await ctx.store.update("approvals", ap.id, { status: "approved", comment: comment || null, acted_at: now });
    const next = all.find((a) => a.level === ap.level + 1);
    await trace(ctx, ap.bill_id, p.actor, `Approved level ${ap.level}`, comment || "Approved without comment.", { level: ap.level });
    if (next) {
      await ctx.store.update("approvals", next.id, { status: "pending", pending_since: now });
      await trace(ctx, ap.bill_id, "workflow_agent", `Level ${next.level} now pending`, `Level ${ap.level} approved, so ${next.approver_name} can act.`, { level: next.level });
      return ctx.store.update("bills", bill.id, { updated_at: now });
    }
    await trace(ctx, ap.bill_id, "workflow_agent", "Bill approved", `All ${all.length} level${all.length > 1 ? "s" : ""} approved. Ready for payment.`, {});
    if (bill.po_id) {
      const po = await ctx.store.get("purchase_orders", bill.po_id);
      if (po) {
        const billed = round2(po.billed_amount + num(bill.subtotal));
        await ctx.store.update("purchase_orders", po.id, { billed_amount: billed });
        await trace(ctx, ap.bill_id, "workflow_agent", "Updated PO balance", `${po.po_number} billed amount ${inr(po.billed_amount)} → ${inr(billed)}; ${inr(round2(po.amount - billed))} remaining.`, { po_id: po.id });
      }
    }
    return setStatus(ctx, bill, "approved");
  }
  for (const a of all) if (a.status === "waiting") await ctx.store.update("approvals", a.id, { status: "cancelled" });
  if (p.action === "reject") {
    await ctx.store.update("approvals", ap.id, { status: "rejected", comment, acted_at: now });
    await trace(ctx, ap.bill_id, p.actor, `Rejected at level ${ap.level}`, comment, { level: ap.level });
    return setStatus(ctx, bill, "rejected");
  }
  await ctx.store.update("approvals", ap.id, { status: "changes_requested", comment, acted_at: now });
  await trace(ctx, ap.bill_id, p.actor, `Requested changes at level ${ap.level}`, comment, { level: ap.level });
  return setStatus(ctx, bill, "needs_review");
}

/** Add the invoice's vendor to the vendor master (bank unverified), attach the bill and re-validate. */
export async function createVendorFromBill(ctx: Ctx, billId: string, actor: string) {
  const bill = (await ctx.store.get("bills", billId))!;
  if (bill.vendor_id) throw new Error("This bill already has a vendor.");
  const name = bill.extracted?.vendor_name?.trim();
  if (!name) throw new Error("The invoice has no vendor name to create a vendor from.");
  const email = bill.source_email_id ? await ctx.store.get("emails", bill.source_email_id) : null;
  const vendor = await ctx.store.insert("vendors", {
    name, gstin: bill.vendor_gstin, gstin_status: bill.vendor_gstin ? "active" : "not_found", msme_status: null, udyam_no: null,
    bank_name: null, bank_last4: bill.bank_last4, ifsc: bill.ifsc, bank_verified: false,
    email_domain: email ? domainOf(email.from_address) : null, tds_section: null, fy_taxable_total: 0,
    contact_email: email?.from_address ?? null, created_at: ctx.now().toISOString(),
  } as Partial<Vendor>);
  await ctx.store.update("bills", billId, { vendor_id: vendor.id });
  await trace(ctx, billId, actor, "Added new vendor", `Created ${name} in the vendor master from this invoice. GSTIN status is taken as active and bank details are unverified until someone confirms them.`, { vendor_id: vendor.id, gstin: bill.vendor_gstin });
  return runValidation(ctx, billId, actor);
}

export async function markPaid(ctx: Ctx, billId: string, actor: string) {
  const bill = (await ctx.store.get("bills", billId))!;
  if (bill.status !== "approved") throw new Error("Only approved bills can be marked paid.");
  await trace(ctx, billId, actor, "Marked paid", "Payment recorded outside AP Desk.", {});
  return ctx.store.update("bills", billId, { paid_at: ctx.now().toISOString() });
}

// ------------------------------------------------------------------ edits

export async function saveBillEdits(ctx: Ctx, billId: string, patch: Partial<Bill>, lines: Partial<BillLine>[] | null, actor: string) {
  const before = (await ctx.store.get("bills", billId))!;
  const changed = Object.keys(patch).filter((k) => JSON.stringify((before as never)[k]) !== JSON.stringify((patch as never)[k]));
  // a field a person typed in is no longer "low confidence"
  const fc = { ...(before.field_confidence ?? {}) };
  for (const k of changed) fc[k === "bank_last4" ? "bank_account_last4" : k] = 1;
  if (changed.includes("tds_section")) {
    const s = patch.tds_section;
    patch.tds_pct = s && TDS_RULES[s] ? TDS_RULES[s].pct : 0;
  }
  let bill = await ctx.store.update("bills", billId, { ...patch, field_confidence: fc });
  if (lines) {
    await ctx.store.remove("bill_lines", { bill_id: billId });
    await ctx.store.insertMany("bill_lines", lines.map((l, i) => ({ ...l, id: undefined, bill_id: billId, position: i + 1 })) as Partial<BillLine>[]);
    changed.push("line_items");
  }
  if (changed.length) await trace(ctx, billId, actor, "Edited fields", `Changed ${changed.join(", ")}.`, { before: Object.fromEntries(changed.map((k) => [k, (before as never)[k]])), after: patch });
  bill = (await ctx.store.get("bills", billId))!;
  return bill;
}

export async function resetBill(ctx: Ctx, billId: string, actor: string) {
  const bill = (await ctx.store.get("bills", billId))!;
  await trace(ctx, billId, actor, "Reset bill", "Discarded manual edits and approvals; re-running extraction and validation from the original document.", {});
  for (const a of await ctx.store.list("approvals", { bill_id: billId })) if (a.status === "pending" || a.status === "waiting") await ctx.store.update("approvals", a.id, { status: "cancelled" });
  await ctx.store.update("bills", billId, { status: "received", department: bill.department, paid_at: null });
  return runExtraction(ctx, billId);
}

// ------------------------------------------------------------------ vendor follow-up

export async function followUpIssues(ctx: Ctx, bill: Bill): Promise<string[]> {
  const results = await ctx.store.list("validation_results", { bill_id: bill.id });
  const issues: string[] = [];
  for (const m of missingRequired(bill)) {
    issues.push(
      m === "vendor_gstin" ? "Your GSTIN is not printed on the invoice. Please send an invoice showing your GSTIN."
      : m === "invoice_date" ? "The invoice date is missing. Please send an invoice with the invoice date printed."
      : m === "invoice_no" ? "The invoice number is missing. Please send an invoice with its number printed."
      : "The invoice total is missing or unreadable. Please send a clear copy with the total amount.",
    );
  }
  for (const r of results.filter((x) => x.outcome === "fail")) {
    const e = r.evidence as Record<string, never>;
    switch (r.check_key) {
      case "bank_details":
        issues.push(`The bank account on the invoice (ending ${(e.invoice as { last4?: string })?.last4 ?? "?"}, IFSC ${(e.invoice as { ifsc?: string })?.ifsc ?? "?"}) differs from the account we have on file. Please confirm your bank details on letterhead with a cancelled cheque.`);
        break;
      case "gstin_status":
        issues.push(`Our records show GSTIN ${bill.vendor_gstin} as cancelled. Please confirm your current GST registration or share a revised invoice.`);
        break;
      case "gstin_format":
        issues.push(`The GSTIN on the invoice (${bill.vendor_gstin}) is not valid. Please confirm your GSTIN.`);
        break;
      case "math_check":
        issues.push(`The amounts on the invoice do not add up (${r.detail.replace(/\.$/, "")}). Please send a corrected invoice.`);
        break;
      case "po_match":
        issues.push(`The invoice value is more than the open balance on PO ${e.po_number ?? bill.po_reference}. Please confirm the PO reference or send a revised invoice.`);
        break;
      case "duplicate":
        break; // internal, not the vendor's problem
      default:
        issues.push(r.detail);
    }
  }
  return issues;
}

export async function draftVendorEmail(ctx: Ctx, billId: string, actor: string): Promise<VendorMessage> {
  const bill = (await ctx.store.get("bills", billId))!;
  const vendor = bill.vendor_id ? await ctx.store.get("vendors", bill.vendor_id) : null;
  const email = bill.source_email_id ? await ctx.store.get("emails", bill.source_email_id) : null;
  const issues = await followUpIssues(ctx, bill);
  if (!issues.length) throw new Error("Nothing is missing or failing on this bill.");
  const draft = await ctx.llm.draftVendorEmail({
    vendor_name: vendor?.name ?? bill.extracted?.vendor_name ?? "Vendor", invoice_no: bill.invoice_no, invoice_date: bill.invoice_date,
    total: bill.total != null ? inr(bill.total) : null, issues, company: COMPANY.name,
  });
  const subject = bill.invoice_no && !draft.subject.includes(bill.invoice_no) ? `${draft.subject} (Invoice ${bill.invoice_no})` : draft.subject;
  for (const m of await ctx.store.list("vendor_messages", { bill_id: billId })) if (m.status === "draft") await ctx.store.remove("vendor_messages", { id: m.id });
  const msg = await ctx.store.insert("vendor_messages", {
    bill_id: billId, to_address: vendor?.contact_email ?? email?.from_address ?? "", subject, body: draft.body, status: "draft", simulated: false,
    rfc_message_id: null, thread_id: email?.thread_id ?? null, sent_at: null, created_at: ctx.now().toISOString(),
  });
  await trace(ctx, billId, "ap_agent", "Drafted vendor email", `Drafted a request listing ${issues.length} item${issues.length > 1 ? "s" : ""}. Waiting for ${actor} to review and send.`, { issues, engine: ctx.llm.name });
  return msg;
}

export async function sendVendorMessage(ctx: Ctx, messageId: string, edits: { to_address: string; subject: string; body: string }, actor: string) {
  const msg = (await ctx.store.get("vendor_messages", messageId))!;
  if (msg.status === "sent") throw new Error("Already sent.");
  if (!edits.to_address.includes("@")) throw new Error("Enter a valid To address.");
  const bill = (await ctx.store.get("bills", msg.bill_id))!;
  const email = bill.source_email_id ? await ctx.store.get("emails", bill.source_email_id) : null;
  let simulated = true, rfc: string | null = `<apdesk-${msg.id}@${COMPANY.domain}>`, thread: string | null = msg.thread_id;
  if (ctx.mailer?.connected) {
    const r = await ctx.mailer.send({ to: edits.to_address, subject: edits.subject, body: edits.body, inReplyTo: email?.message_id ?? null, threadId: email?.thread_id ?? null });
    simulated = false;
    rfc = r.rfc_message_id;
    thread = r.thread_id;
  }
  const now = ctx.now().toISOString();
  const sent = await ctx.store.update("vendor_messages", messageId, { ...edits, status: "sent", simulated, sent_at: now, rfc_message_id: rfc, thread_id: thread });
  await trace(ctx, bill.id, actor, simulated ? "Sent vendor email (simulated)" : "Sent vendor email", `${simulated ? "Simulated send (Gmail not connected) " : "Sent "}to ${edits.to_address}: "${edits.subject}". Bill is waiting on the vendor.`, { message_id: messageId, in_reply_to: email?.message_id ?? null });
  await setStatus(ctx, bill, "needs_vendor_info");
  return { message: sent, simulated };
}

export async function markVendorReply(ctx: Ctx, billId: string, actor: string, note = "Vendor reply received.") {
  const bill = (await ctx.store.get("bills", billId))!;
  await trace(ctx, billId, actor, "Vendor replied", `${note} Bill returned to review for re-validation.`, {});
  return setStatus(ctx, bill, "needs_review");
}

// ------------------------------------------------------------------ email intake (both sources)

export interface IncomingEmail {
  message_id: string;
  source: Email["source"];
  from_address: string;
  subject: string;
  body_text: string;
  received_at: string;
  in_reply_to?: string | null;
  thread_id?: string | null;
  attachments: { filename: string; mime: string; bytes: Uint8Array }[];
}

/** Record an email (deduped on message_id and on attachment hash). Returns null if already recorded. */
export async function recordEmail(ctx: Ctx, m: IncomingEmail): Promise<Email | null> {
  const existing = await ctx.store.list("emails", { message_id: m.message_id });
  if (existing.length) return null;
  const atts: EmailAttachment[] = [];
  for (const a of m.attachments) {
    const hash = await sha256Hex(a.bytes);
    const path = SUPPORTED_MIME.includes(a.mime) ? `emails/${hash.slice(0, 16)}/${a.filename.replace(/[^A-Za-z0-9._-]/g, "_")}` : null;
    if (path) await ctx.store.putFile(path, a.bytes, a.mime);
    atts.push({ filename: a.filename, mime: a.mime, size: a.bytes.length, hash, path });
  }
  const attachment_hash = atts.length ? atts.map((a) => a.hash).sort().join(",").slice(0, 200) : null;
  let flag: string | null = null;
  if (attachment_hash) {
    const same = (await ctx.store.list("emails", { attachment_hash }))[0];
    if (same) flag = `Same attachment as an earlier email ("${same.subject}"); not processed again.`;
  }
  const e = await ctx.store.insert("emails", {
    message_id: m.message_id, source: m.source, from_address: m.from_address, subject: m.subject, body_text: m.body_text,
    received_at: m.received_at, in_reply_to: m.in_reply_to ?? null, thread_id: m.thread_id ?? null, attachments: atts,
    attachment_hash, classification: null, classification_reason: null, flag, processed: Boolean(flag), bill_ids: [], created_at: ctx.now().toISOString(),
  });
  await trace(ctx, null, "intake_agent", "Email recorded", flag ?? `From ${m.from_address}: "${m.subject}" with ${atts.length} attachment${atts.length === 1 ? "" : "s"}.`, { message_id: m.message_id }, e.id);
  return e;
}

/** Classify, then send only invoices to the AP agent. Marks the email processed only after bills are saved. */
export async function processEmail(ctx: Ctx, emailId: string): Promise<Email> {
  const email = (await ctx.store.get("emails", emailId))!;
  if (email.processed) return email;

  // replies to our follow-ups attach to the same bill
  if (email.in_reply_to) {
    const sent = (await ctx.store.list("vendor_messages")).find((v) => v.rfc_message_id === email.in_reply_to);
    if (sent) {
      await markVendorReply(ctx, sent.bill_id, "intake_agent", `Vendor replied by email: "${email.subject}".`);
      await trace(ctx, null, "intake_agent", "Classified: vendor_reply", "In-Reply-To matches our follow-up; attached to the existing bill.", { bill_id: sent.bill_id }, emailId);
      return ctx.store.update("emails", emailId, { classification: "vendor_reply", classification_reason: "Reply to our follow-up email.", processed: true, bill_ids: [sent.bill_id] });
    }
  }

  const { classification, reason } = await ctx.llm.classifyEmail({ from_address: email.from_address, subject: email.subject, body_text: email.body_text.slice(0, 4000), attachment_names: email.attachments.map((a) => a.filename) });
  await trace(ctx, null, "intake_agent", `Classified: ${classification}`, reason, { engine: ctx.llm.name }, emailId);
  if (classification !== "invoice") {
    return ctx.store.update("emails", emailId, { classification, classification_reason: reason, processed: true });
  }

  const supported = email.attachments.filter((a) => a.path && SUPPORTED_MIME.includes(a.mime));
  const unsupported = email.attachments.filter((a) => !SUPPORTED_MIME.includes(a.mime));
  const flags: string[] = [];
  if (!email.attachments.length) flags.push("No attachment: the invoice may be in the body or behind a link. Open the email and upload it manually.");
  if (unsupported.length) flags.push(`Unsupported attachment${unsupported.length > 1 ? "s" : ""} (${unsupported.map((a) => a.filename).join(", ")}): open manually.`);

  const billIds: string[] = [];
  const existing = await ctx.store.list("bills");
  for (const a of supported) {
    const dupe = existing.find((b) => b.file_hash === a.hash);
    if (dupe) {
      flags.push(`${a.filename} was already processed as bill ${dupe.invoice_no ?? dupe.id.slice(0, 8)}.`);
      continue;
    }
    const file = await ctx.store.getFile(a.path!);
    if (!file) {
      flags.push(`${a.filename} could not be loaded.`);
      continue;
    }
    const bill = await createBillFromFile(ctx, { bytes: file.bytes, mime: a.mime, name: a.filename, source_email_id: emailId, actor: "intake_agent" });
    billIds.push(bill.id);
    await runExtraction(ctx, bill.id);
  }
  if (flags.length) await trace(ctx, null, "intake_agent", "Flagged for a person", flags.join(" "), {}, emailId);
  return ctx.store.update("emails", emailId, { classification, classification_reason: reason, flag: flags.join(" ") || null, processed: true, bill_ids: billIds });
}
