import type { Bill, BillLine, Email, Outcome, PurchaseOrder, ValidationResult, Vendor } from "./types.ts";
import { COMPANY } from "./types.ts";
import { checkGstinFormat, STATE_NAMES } from "./gstin.ts";
import { daysBetween, domainOf, inr, num, round2 } from "./util.ts";

export type CheckResult = Pick<ValidationResult, "check_key" | "outcome" | "detail" | "evidence" | "source">;

export const CHECK_LABELS: Record<string, string> = {
  gstin_format: "GSTIN format & checksum",
  gstin_status: "GSTIN registration status",
  msme_status: "MSME status",
  bank_details: "Bank details",
  duplicate: "Duplicate check",
  math_check: "Arithmetic",
  tax_split: "GST split (IGST vs CGST+SGST)",
  po_match: "PO match",
  tds_applicable: "TDS",
  rcm_flag: "Reverse charge",
  sender_domain: "Sender domain",
};

/** SAC/HSN prefixes where GST is commonly payable by the recipient under reverse charge. */
export const RCM_SAC: { prefix: string; label: string }[] = [
  { prefix: "9965", label: "goods transport agency (GTA)" },
  { prefix: "996791", label: "goods transport agency (GTA)" },
  { prefix: "9982", label: "legal services by an advocate or firm" },
  { prefix: "998525", label: "security services" },
  { prefix: "998397", label: "sponsorship services" },
];

/** TDS: section -> rate % and thresholds (single bill / FY aggregate). Simplified for the demo. */
export const TDS_RULES: Record<string, { label: string; pct: number; single: number; aggregate: number }> = {
  "194C": { label: "194C Contractors", pct: 2, single: 30000, aggregate: 100000 },
  "194J": { label: "194J Professional / technical fees", pct: 10, single: 50000, aggregate: 50000 },
  "194I": { label: "194I Rent", pct: 10, single: 50000, aggregate: 600000 },
  "194Q": { label: "194Q Purchase of goods", pct: 0.1, single: 5000000, aggregate: 5000000 },
};

export interface CheckInput {
  bill: Bill;
  lines: BillLine[];
  vendor: Vendor | null;
  otherBills: Bill[];
  pos: PurchaseOrder[];
  email: Email | null;
  today: Date;
}

const r = (check_key: string, outcome: Outcome, detail: string, evidence: Record<string, unknown> = {}, source: CheckResult["source"] = "computed"): CheckResult =>
  ({ check_key, outcome, detail, evidence, source });

export function rcmCandidate(lines: BillLine[], vendor: Vendor | null, extractedGstin: string | null) {
  for (const l of lines) {
    const hit = RCM_SAC.find((s) => (l.hsn_sac ?? "").startsWith(s.prefix));
    if (hit) return { reason: `SAC ${l.hsn_sac} is ${hit.label}`, sac: l.hsn_sac };
  }
  if (!extractedGstin && !vendor?.gstin) return { reason: "vendor appears unregistered (no GSTIN)", sac: null };
  return null;
}

export function runChecks(i: CheckInput): CheckResult[] {
  const { bill, lines, vendor } = i;
  const gstin = bill.vendor_gstin ?? null;
  const out: CheckResult[] = [];

  // 1. GSTIN format
  if (!gstin) out.push(r("gstin_format", "skipped", "GSTIN not found on the invoice.", { gstin: null }));
  else {
    const g = checkGstinFormat(gstin);
    out.push(
      g.ok
        ? r("gstin_format", "pass", `${gstin} is well-formed and its check character is valid.`, { gstin, state: STATE_NAMES[g.state_code!], pan: g.pan })
        : r("gstin_format", "fail", `${gstin}: ${g.problems[0]}.`, { gstin, problems: g.problems, expected_check: g.expected_check }),
    );
  }

  // 2. GSTIN status (vendors table stands in for the GST portal)
  if (!gstin) out.push(r("gstin_status", "skipped", "No GSTIN to look up.", {}, "simulated_registry"));
  else {
    const reg = vendor && vendor.gstin === gstin ? vendor : null;
    if (!reg) out.push(r("gstin_status", "warn", `${gstin} not found in the vendor registry.`, { gstin }, "simulated_registry"));
    else if (reg.gstin_status === "cancelled")
      out.push(r("gstin_status", "fail", `GSTIN ${gstin} is cancelled. GST charged on this invoice cannot be claimed as input credit.`, { gstin, status: "cancelled" }, "simulated_registry"));
    else if (reg.gstin_status === "not_found")
      out.push(r("gstin_status", "warn", `GSTIN ${gstin} was not found on the registry.`, { gstin, status: "not_found" }, "simulated_registry"));
    else out.push(r("gstin_status", "pass", `GSTIN ${gstin} is active.`, { gstin, status: "active" }, "simulated_registry"));
  }

  // 3. MSME
  if (!vendor) out.push(r("msme_status", "skipped", "Vendor not matched to the master.", {}, "simulated_registry"));
  else if (!vendor.msme_status) out.push(r("msme_status", "pass", "Not MSME-registered. Standard payment terms apply.", { msme: null }, "simulated_registry"));
  else {
    const days = bill.invoice_date && bill.due_date ? daysBetween(bill.invoice_date, bill.due_date) : null;
    const ev = { msme: vendor.msme_status, udyam_no: vendor.udyam_no, credit_days: days };
    out.push(
      days != null && days > 45
        ? r("msme_status", "warn", `MSME (${vendor.msme_status}) vendor, ${vendor.udyam_no}: due date is ${days} days after invoice; MSMED Act caps this at 45 days.`, ev, "simulated_registry")
        : r("msme_status", "pass", `MSME (${vendor.msme_status}) vendor, ${vendor.udyam_no}. Pay within 45 days of invoice.`, ev, "simulated_registry"),
    );
  }

  // 4. Bank details. Never auto-pass.
  {
    const invLast4 = bill.bank_last4 ?? null, invIfsc = bill.ifsc ?? null;
    const ev = { invoice: { last4: invLast4, ifsc: invIfsc }, master: vendor ? { last4: vendor.bank_last4, ifsc: vendor.ifsc, verified: vendor.bank_verified } : null };
    if (!vendor) out.push(r("bank_details", "warn", "Vendor not matched, so bank details cannot be compared to a master record.", ev));
    else if ((invLast4 && invLast4 !== vendor.bank_last4) || (invIfsc && invIfsc.toUpperCase() !== (vendor.ifsc ?? "").toUpperCase()))
      out.push(r("bank_details", "fail", "Bank details differ from vendor master. Re-verify before paying.", ev));
    else if (!vendor.bank_verified) out.push(r("bank_details", "warn", "Bank account on the vendor master has not been verified (penny-drop pending).", ev));
    else if (!invLast4 && !invIfsc) out.push(r("bank_details", "warn", `No bank details on the invoice; payment would go to master account ••${vendor.bank_last4} (verified).`, ev));
    else out.push(r("bank_details", "pass", `Invoice account ••${invLast4} / ${invIfsc} matches the verified master account.`, ev));
  }

  // 5. Duplicate
  {
    const live = i.otherBills.filter((b) => b.id !== bill.id && b.status !== "rejected" && b.status !== "duplicate" && b.vendor_id && b.vendor_id === bill.vendor_id);
    const sameNo = bill.invoice_no ? live.find((b) => (b.invoice_no ?? "").trim().toUpperCase() === bill.invoice_no!.trim().toUpperCase()) : undefined;
    const sameAmt = live.find(
      (b) => bill.total != null && b.total != null && Math.abs(b.total - bill.total) < 0.01 && b.invoice_date && bill.invoice_date && Math.abs(daysBetween(b.invoice_date, bill.invoice_date)) <= 30,
    );
    if (!bill.vendor_id) out.push(r("duplicate", "skipped", "Vendor not matched; duplicate check needs a vendor."));
    else if (sameNo) out.push(r("duplicate", "fail", `Same vendor and invoice number as bill ${sameNo.invoice_no} received ${sameNo.created_at.slice(0, 10)}.`, { duplicate_of: sameNo.id, rule: "vendor+invoice_no" }));
    else if (sameAmt) out.push(r("duplicate", "fail", `Same vendor and total (${inr(bill.total)}) as invoice ${sameAmt.invoice_no} within 30 days.`, { duplicate_of: sameAmt.id, rule: "vendor+total+date" }));
    else out.push(r("duplicate", "pass", "No other bill from this vendor with the same number, or same total within 30 days."));
  }

  // 6. Arithmetic, within ₹1
  {
    const problems: string[] = [];
    lines.forEach((l, idx) => {
      if (l.qty != null && l.rate != null && l.amount_excl_gst != null && Math.abs(l.qty * l.rate - l.amount_excl_gst) > 1)
        problems.push(`Line ${idx + 1}: ${l.qty} × ${inr(l.rate)} = ${inr(l.qty * l.rate)}, invoice shows ${inr(l.amount_excl_gst)}`);
    });
    const lineSum = round2(lines.reduce((s, l) => s + num(l.amount_excl_gst), 0));
    const gstFromLines = round2(lines.reduce((s, l) => s + (num(l.amount_excl_gst) * num(l.gst_pct)) / 100, 0));
    const tax = round2(num(bill.cgst) + num(bill.sgst) + num(bill.igst));
    const expectedTotal = round2(num(bill.subtotal) - num(bill.discount) + tax + num(bill.adjustments));
    if (bill.subtotal != null && Math.abs(lineSum - bill.subtotal) > 1) problems.push(`Lines add up to ${inr(lineSum)}, subtotal shows ${inr(bill.subtotal)}`);
    if (!bill.rcm && Math.abs(gstFromLines - tax) > 1) problems.push(`GST at line rates is ${inr(gstFromLines)}, invoice charges ${inr(tax)}`);
    if (bill.total != null && Math.abs(expectedTotal - bill.total) > 1) problems.push(`Subtotal + GST = ${inr(expectedTotal)}, total shows ${inr(bill.total)}`);
    const ev = { line_sum: lineSum, gst_from_lines: gstFromLines, tax_charged: tax, expected_total: expectedTotal, invoice_total: bill.total };
    if (bill.total == null || bill.subtotal == null) out.push(r("math_check", "skipped", "Subtotal or total missing; cannot reconcile.", ev));
    else out.push(problems.length ? r("math_check", "fail", problems[0] + ".", { ...ev, problems }) : r("math_check", "pass", `Lines, GST and total reconcile within ₹1 (${inr(bill.total)}).`, ev));
  }

  // 7. Tax split
  {
    const vs = gstin?.slice(0, 2) ?? null;
    const inter = vs ? vs !== COMPANY.state_code : null;
    const hasIgst = num(bill.igst) > 0, hasCs = num(bill.cgst) + num(bill.sgst) > 0;
    const ev = { vendor_state: vs ? STATE_NAMES[vs] : null, buyer_state: COMPANY.state, inter_state: inter, cgst: bill.cgst, sgst: bill.sgst, igst: bill.igst };
    if (inter == null) out.push(r("tax_split", "skipped", "No vendor GSTIN, so place of supply cannot be determined.", ev));
    else if (!hasIgst && !hasCs) out.push(r("tax_split", bill.rcm ? "pass" : "warn", bill.rcm ? "No GST charged (consistent with reverse charge)." : "No GST charged on the invoice.", ev));
    else if (inter && hasCs) out.push(r("tax_split", "warn", `Inter-state supply (${ev.vendor_state} → ${COMPANY.state}) should carry IGST, but CGST+SGST is charged.`, ev));
    else if (!inter && hasIgst) out.push(r("tax_split", "warn", `Intra-state supply within ${COMPANY.state} should carry CGST+SGST, but IGST is charged.`, ev));
    else if (!inter && Math.abs(num(bill.cgst) - num(bill.sgst)) > 1) out.push(r("tax_split", "warn", "CGST and SGST should be equal halves.", ev));
    else out.push(r("tax_split", "pass", inter ? `Inter-state (${ev.vendor_state} → ${COMPANY.state}): IGST charged correctly.` : `Intra-state (${COMPANY.state}): CGST and SGST charged correctly.`, ev));
  }

  // 8. PO match
  {
    const po = bill.po_id ? i.pos.find((p) => p.id === bill.po_id) : null;
    if (!bill.po_reference && !po) out.push(r("po_match", "skipped", "No PO reference on the invoice."));
    else if (!po) out.push(r("po_match", "warn", `PO ${bill.po_reference} not found for this vendor.`, { po_reference: bill.po_reference }));
    else {
      const remaining = round2(po.amount - po.billed_amount);
      const base = num(bill.subtotal); // compare taxable value against PO value
      const tol = (po.amount * po.tolerance_pct) / 100;
      const ev = { po_number: po.po_number, po_amount: po.amount, billed: po.billed_amount, remaining, bill_taxable: base, tolerance_pct: po.tolerance_pct };
      if (base > remaining + tol) out.push(r("po_match", "fail", `Taxable ${inr(base)} exceeds remaining PO balance ${inr(remaining)} on ${po.po_number} (tolerance ${po.tolerance_pct}%).`, ev));
      else if (base > remaining) out.push(r("po_match", "warn", `Taxable ${inr(base)} is over remaining balance ${inr(remaining)} but within ${po.tolerance_pct}% tolerance.`, ev));
      else out.push(r("po_match", "pass", `Within ${po.po_number}: ${inr(remaining)} remaining before this bill.`, ev));
    }
  }

  // 9. TDS
  {
    const sec = bill.tds_section ?? vendor?.tds_section ?? null;
    const rule = sec ? TDS_RULES[sec] : null;
    if (!vendor) out.push(r("tds_applicable", "skipped", "Vendor not matched to the master."));
    else if (!rule) out.push(r("tds_applicable", "pass", "No TDS section on the vendor master.", { section: null }));
    else {
      const base = num(bill.subtotal);
      const agg = vendor.fy_taxable_total + base;
      const applies = base > rule.single || agg > rule.aggregate;
      const amt = round2((base * rule.pct) / 100);
      const ev = { section: sec, rate_pct: rule.pct, bill_taxable: base, fy_total_incl_bill: agg, single_threshold: rule.single, aggregate_threshold: rule.aggregate, tds_amount: applies ? amt : 0 };
      out.push(
        applies
          ? r("tds_applicable", "pass", `TDS u/s ${sec} @ ${rule.pct}% applies: deduct ${inr(amt)} (FY total ${inr(agg)} crosses ${inr(rule.aggregate)}).`, ev)
          : r("tds_applicable", "pass", `Below ${sec} thresholds (bill ${inr(base)}, FY ${inr(agg)}); no TDS.`, ev),
      );
    }
  }

  // 10. Reverse charge
  {
    const c = rcmCandidate(lines, vendor, gstin);
    out.push(c ? r("rcm_flag", "warn", `Probable reverse charge: ${c.reason}. Self-assess GST; do not pay GST to the vendor.`, c) : r("rcm_flag", "pass", "Forward charge: GST is payable to the vendor."));
  }

  // 11. Sender domain (email-sourced bills only)
  if (i.email && vendor?.email_domain) {
    const d = domainOf(i.email.from_address);
    out.push(
      d === vendor.email_domain
        ? r("sender_domain", "pass", `Sent from ${d}, the vendor's domain.`, { sender: i.email.from_address })
        : r("sender_domain", "warn", `Sent from ${d}, not ${vendor.email_domain}. It may be forwarded; confirm it came from the vendor.`, { sender: i.email.from_address, expected: vendor.email_domain }),
    );
  }
  return out;
}

export function missingRequired(bill: Bill): string[] {
  const m: string[] = [];
  if (!bill.invoice_no) m.push("invoice_no");
  if (!bill.invoice_date) m.push("invoice_date");
  if (bill.total == null) m.push("total");
  if (!bill.vendor_gstin) m.push("vendor_gstin");
  return m;
}

export const FIELD_LABEL: Record<string, string> = {
  invoice_no: "Invoice number",
  invoice_date: "Invoice date",
  total: "Invoice total",
  vendor_gstin: "Your GSTIN",
};
