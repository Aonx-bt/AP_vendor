import { useState } from "react";
import { Bell, Bot, Check, ChevronDown, ChevronRight, CircleDot, Clock, Lightbulb, Plus, ShieldCheck, ShieldAlert, Trash2, User, X } from "lucide-react";
import type { Approval, ApprovalRule, Bill, BillLine, Insight, Outcome, TraceEvent, ValidationResult, Vendor } from "@shared/types.ts";
import { ROLE_LABEL } from "@shared/types.ts";
import { CHECK_LABELS, TDS_RULES } from "@shared/checks.ts";
import { describeCondition, evaluateCondition, matchRule } from "@shared/pipeline.ts";
import { Avatar, OutcomeIcon, SimBadge } from "./bits";
import { Button } from "./ui/button";
import { Input, NativeSelect, Textarea } from "./ui/input";
import { Card, SectionTitle } from "./ui/card";
import { cn, inr, timeOf } from "@/lib/utils";
import { daysBetween, round2 } from "@shared/util.ts";

export const CHECK_ORDER = ["gstin_format", "gstin_status", "msme_status", "bank_details", "duplicate", "math_check", "tax_split", "po_match", "tds_applicable", "rcm_flag", "sender_domain"];
const AGENTS: Record<string, string> = { ap_agent: "AP agent", validation_agent: "Validation agent", workflow_agent: "Workflow agent", intake_agent: "Intake agent" };

// ------------------------------------------------------------------ decision

export function DecisionCard({ bill, results, approvals, rule, traces }: { bill: Bill; results: ValidationResult[]; approvals: Approval[]; rule: ApprovalRule | null; traces: TraceEvent[] }) {
  const fails = results.filter((r) => r.outcome === "fail");
  const warns = results.filter((r) => r.outcome === "warn");
  const pending = approvals.find((a) => a.status === "pending");
  const closer = [...approvals].reverse().find((a) => a.status === "rejected" || a.status === "changes_requested");
  const lastDecision = [...traces].reverse().find((t) => t.action.startsWith("Decision") || t.actor === "ap_agent");
  let tone: "red" | "amber" | "blue" | "green" | "slate" = "slate";
  let sentence = "";
  if (bill.status === "received") sentence = "Reading invoice…";
  else if (bill.status === "duplicate") { tone = "red"; sentence = `Duplicate: ${fails.find((f) => f.check_key === "duplicate")?.detail ?? "matches an existing bill."} It will not be paid.`; }
  else if (bill.status === "rejected") { tone = "red"; sentence = `Rejected by ${closer?.approver_name ?? "approver"}: "${closer?.comment ?? ""}"`; }
  else if (bill.status === "needs_review") {
    tone = "amber";
    if (closer?.status === "changes_requested" && !fails.length) sentence = `${closer.approver_name} requested changes: "${closer.comment}"`;
    else if (fails.length) sentence = `Needs review: ${fails.length} check${fails.length > 1 ? "s" : ""} failed. ${fails[0].detail}`;
    else sentence = lastDecision?.reasoning ?? "Needs a person to review.";
  } else if (bill.status === "needs_vendor_info") { tone = "amber"; sentence = `Waiting on vendor. ${[...traces].reverse().find((t) => t.action.startsWith("Decision"))?.reasoning ?? "Information requested."}`; }
  else if (bill.status === "in_approval") { tone = "blue"; sentence = `Routed to "${rule?.name ?? "approval"}". Waiting for ${pending?.approver_name ?? "approver"} (level ${pending?.level ?? "?"} of ${approvals.length}).`; }
  else if (bill.status === "approved") { tone = "green"; sentence = bill.paid_at ? "Approved and paid." : `Approved at all ${approvals.length} level${approvals.length > 1 ? "s" : ""}. Ready for payment.`; }

  const toneCls = { red: "border-red-200 bg-red-50/60", amber: "border-amber-200 bg-amber-50/60", blue: "border-blue-200 bg-blue-50/50", green: "border-emerald-200 bg-emerald-50/60", slate: "border-border bg-muted/50" }[tone];
  const fired = [...fails.map((f) => ({ o: "fail" as Outcome, k: f.check_key })), ...warns.map((w) => ({ o: "warn" as Outcome, k: w.check_key }))];
  return (
    <div className={cn("rounded-xl border p-4", toneCls)}>
      <div className="flex items-start gap-2.5">
        {tone === "green" ? <ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-600" /> : tone === "red" || tone === "amber" ? <ShieldAlert className={cn("mt-0.5 h-5 w-5", tone === "red" ? "text-red-600" : "text-amber-600")} /> : <CircleDot className="mt-0.5 h-5 w-5 text-blue-600" />}
        <div className="min-w-0">
          <div className="text-sm font-medium leading-snug text-slate-900">{sentence}</div>
          {(fired.length > 0 || rule) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {fired.map((f) => (
                <span key={f.k} className={cn("inline-flex items-center gap-1 rounded-md bg-white px-1.5 py-0.5 text-[11px] font-medium ring-1", f.o === "fail" ? "text-red-700 ring-red-200" : "text-amber-800 ring-amber-200")}>
                  <OutcomeIcon o={f.o} className="h-3 w-3" /> {CHECK_LABELS[f.k]}
                </span>
              ))}
              {rule && <span className="inline-flex items-center gap-1 rounded-md bg-white px-1.5 py-0.5 text-[11px] font-medium text-blue-700 ring-1 ring-blue-200">Rule: {rule.name}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Age/due insights depend on today's date, so they are recomputed when shown. */
function liveInsight(i: Insight, bill: Bill): Insight {
  if (i.kind !== "terms" || !bill.invoice_date || !bill.due_date) return i;
  const today = new Date().toISOString().slice(0, 10);
  const age = daysBetween(bill.invoice_date, today);
  const left = daysBetween(today, bill.due_date);
  const terms = bill.payment_terms ? ` (${bill.payment_terms})` : "";
  const d = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
  if (bill.paid_at) return { ...i, text: `Paid. It was due on ${bill.due_date}${terms}.` };
  return { ...i, text: left < 0 ? `Invoice is ${d(age)} old${terms}: ${d(-left)} overdue.` : left === 0 ? `Invoice is ${d(age)} old; due today${terms}.` : `Invoice is ${d(age)} old; due in ${d(left)}${terms}.` };
}

export function Insights({ bill }: { bill: Bill }) {
  if (!bill.insights?.length) return null;
  return (
    <div className="rounded-xl border border-violet-100 bg-gradient-to-br from-violet-50/70 to-white p-4">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-violet-800"><Lightbulb className="h-3.5 w-3.5" /> Insights</div>
      <ul className="space-y-1.5">
        {bill.insights.map((x) => liveInsight(x, bill)).map((i, n) => (
          <li key={n} className={cn("flex gap-2 text-[13px] leading-snug", i.kind === "injection" ? "text-red-700" : "text-slate-700")}>
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-violet-400" />{i.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Stepper({ bill, approvals }: { bill: Bill; approvals: Approval[] }) {
  const done = approvals.filter((a) => a.status === "approved").length;
  const steps = [
    { label: "Uploaded", ok: true },
    { label: `Approved (${done}/${approvals.length || "–"})`, ok: approvals.length > 0 && done === approvals.length, partial: done > 0 },
    { label: "Reviewed", ok: bill.status === "approved" },
    { label: "Paid", ok: !!bill.paid_at },
  ];
  return (
    <div className="flex items-center">
      {steps.map((s, i) => (
        <div key={s.label} className="flex flex-1 items-center last:flex-none">
          <div className="flex items-center gap-2">
            <span className={cn("grid h-6 w-6 place-items-center rounded-full text-[11px] font-semibold", s.ok ? "bg-emerald-600 text-white" : s.partial ? "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300" : "bg-slate-100 text-slate-500")}>
              {s.ok ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span className={cn("whitespace-nowrap text-xs font-medium", s.ok ? "text-slate-900" : "text-muted-foreground")}>{s.label}</span>
          </div>
          {i < steps.length - 1 && <div className={cn("mx-3 h-px flex-1", s.ok ? "bg-emerald-400" : "bg-slate-200")} />}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ verification

export function Evidence({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  if (!entries.length) return <div className="text-xs text-muted-foreground">No additional evidence.</div>;
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 rounded-lg bg-slate-50 p-2.5 text-xs">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k.replace(/_/g, " ")}</dt>
          <dd className="break-all font-mono text-[11px] text-slate-800">{typeof v === "object" && v !== null ? JSON.stringify(v, null, 0) : String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Verification({ results }: { results: ValidationResult[] }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const sorted = [...results].sort((a, b) => CHECK_ORDER.indexOf(a.check_key) - CHECK_ORDER.indexOf(b.check_key));
  const counts = { pass: 0, warn: 0, fail: 0, skipped: 0 } as Record<Outcome, number>;
  sorted.forEach((r) => counts[r.outcome]++);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <SectionTitle>Verification</SectionTitle>
        <span className="text-xs text-muted-foreground">{counts.pass} passed · {counts.warn} warnings · {counts.fail} failed</span>
      </div>
      {!sorted.length && <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">Not validated yet.</div>}
      <div className="divide-y divide-border rounded-xl border border-border">
        {sorted.map((r) => (
          <div key={r.id}>
            <button onClick={() => setOpenKey(openKey === r.id ? null : r.id)} className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-muted/40">
              <OutcomeIcon o={r.outcome} className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium">{CHECK_LABELS[r.check_key] ?? r.check_key} {r.source === "simulated_registry" && <SimBadge />}</div>
                <div className="text-xs leading-snug text-muted-foreground">{r.detail}</div>
              </div>
              {openKey === r.id ? <ChevronDown className="mt-0.5 h-4 w-4 text-slate-400" /> : <ChevronRight className="mt-0.5 h-4 w-4 text-slate-400" />}
            </button>
            {openKey === r.id && <div className="px-3 pb-3 pl-9"><Evidence data={r.evidence} /></div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ line items + payment

export type LineDraft = Pick<BillLine, "description" | "hsn_sac" | "qty" | "rate" | "gst_pct" | "amount_excl_gst">;
const GST = [0, 5, 12, 18, 28];
const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s.replace(/,/g, "")));

export function LineItems({ lines, onChange, readOnly }: { lines: LineDraft[]; onChange: (l: LineDraft[]) => void; readOnly: boolean }) {
  const set = (i: number, patch: Partial<LineDraft>) => {
    const next = lines.map((l, j) => {
      if (j !== i) return l;
      const m = { ...l, ...patch };
      if (("qty" in patch || "rate" in patch) && m.qty != null && m.rate != null) m.amount_excl_gst = round2(m.qty * m.rate);
      return m;
    });
    onChange(next);
  };
  const sub = round2(lines.reduce((s, l) => s + (l.amount_excl_gst ?? 0), 0));
  const gst = round2(lines.reduce((s, l) => s + ((l.amount_excl_gst ?? 0) * (l.gst_pct ?? 0)) / 100, 0));
  const cell = "h-8 rounded-md px-2 text-[13px]";
  return (
    <div>
      <SectionTitle className="mb-2">Line items</SectionTitle>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[620px] text-[13px]">
          <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
            <tr>
              <th className="w-8 px-2 py-2 font-medium">#</th>
              <th className="px-2 py-2 font-medium">Details</th>
              <th className="w-20 px-2 py-2 text-right font-medium">Qty</th>
              <th className="w-28 px-2 py-2 text-right font-medium">Rate</th>
              <th className="w-20 px-2 py-2 font-medium">GST %</th>
              <th className="w-32 px-2 py-2 text-right font-medium">Amount excl GST</th>
              {!readOnly && <th className="w-8" />}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-t border-border align-top">
                <td className="px-2 py-1.5 pt-3 text-muted-foreground">{i + 1}</td>
                <td className="px-1 py-1.5">
                  <Input disabled={readOnly} className={cell} value={l.description ?? ""} onChange={(e) => set(i, { description: e.target.value })} />
                  <Input disabled={readOnly} className={cn(cell, "mt-1 h-7 w-32 font-mono text-[11px] text-muted-foreground")} placeholder="HSN/SAC" value={l.hsn_sac ?? ""} onChange={(e) => set(i, { hsn_sac: e.target.value })} />
                </td>
                <td className="px-1 py-1.5"><Input disabled={readOnly} className={cn(cell, "text-right tabular")} value={l.qty ?? ""} onChange={(e) => set(i, { qty: numOrNull(e.target.value) })} /></td>
                <td className="px-1 py-1.5"><Input disabled={readOnly} className={cn(cell, "text-right tabular")} value={l.rate ?? ""} onChange={(e) => set(i, { rate: numOrNull(e.target.value) })} /></td>
                <td className="px-1 py-1.5">
                  <NativeSelect disabled={readOnly} className="h-8 px-1.5 text-[13px]" value={l.gst_pct ?? ""} onChange={(e) => set(i, { gst_pct: numOrNull(e.target.value) })}>
                    {l.gst_pct != null && !GST.includes(l.gst_pct) && <option value={l.gst_pct}>{l.gst_pct}%</option>}
                    <option value="">—</option>
                    {GST.map((g) => <option key={g} value={g}>{g}%</option>)}
                  </NativeSelect>
                </td>
                <td className="px-1 py-1.5"><Input disabled={readOnly} className={cn(cell, "text-right tabular")} value={l.amount_excl_gst ?? ""} onChange={(e) => set(i, { amount_excl_gst: numOrNull(e.target.value) })} /></td>
                {!readOnly && (
                  <td className="pt-2.5"><button onClick={() => onChange(lines.filter((_, j) => j !== i))} className="rounded p-1 text-slate-400 hover:bg-muted hover:text-red-600" aria-label="Remove line"><Trash2 className="h-3.5 w-3.5" /></button></td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-border bg-muted/40 text-[13px]">
            <tr>
              <td colSpan={2} className="px-2 py-2">
                {!readOnly && <Button variant="link" size="sm" onClick={() => onChange([...lines, { description: "", hsn_sac: "", qty: 1, rate: 0, gst_pct: 18, amount_excl_gst: 0 }])}><Plus /> Add line</Button>}
              </td>
              <td colSpan={3} className="px-2 py-2 text-right text-muted-foreground">Subtotal<br />GST total</td>
              <td className="px-3 py-2 text-right font-medium tabular">{inr(sub)}<br />{inr(gst)}</td>
              {!readOnly && <td />}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

export type Money = Pick<Bill, "subtotal" | "discount" | "cgst" | "sgst" | "igst" | "adjustments" | "total" | "tds_section" | "rcm">;

export function PaymentSummary({ f, onChange, readOnly, conf }: { f: Money; onChange: (p: Partial<Money>) => void; readOnly: boolean; conf: (k: string) => string | undefined }) {
  const tds = f.tds_section ? TDS_RULES[f.tds_section] : null;
  const tdsAmt = tds ? round2(((f.subtotal ?? 0) - (f.discount ?? 0)) * tds.pct / 100) : 0;
  const net = round2((f.total ?? 0) - tdsAmt);
  const row = (label: string, k: keyof Money, sign = "") => (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[13px] text-muted-foreground">{sign}{label}</span>
      <Input disabled={readOnly} className={cn("h-8 w-40 text-right text-[13px] tabular", conf(k as string))} value={(f[k] as number | null) ?? ""} onChange={(e) => onChange({ [k]: numOrNull(e.target.value) ?? (k === "subtotal" || k === "total" ? null : 0) } as Partial<Money>)} />
    </div>
  );
  return (
    <Card className="p-4">
      <SectionTitle className="mb-3">Payment summary</SectionTitle>
      <div className="space-y-2">
        {row("Subtotal", "subtotal")}
        {row("Discount", "discount", "− ")}
        {row("CGST", "cgst", "+ ")}
        {row("SGST", "sgst", "+ ")}
        {row("IGST", "igst", "+ ")}
        {row("Adjustments", "adjustments", "± ")}
        <div className="border-t border-border pt-2">{row("Total (as invoiced)", "total")}</div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-muted-foreground">− TDS</span>
          <div className="flex items-center gap-2">
            <NativeSelect disabled={readOnly} className="h-8 w-44 text-[13px]" value={f.tds_section ?? ""} onChange={(e) => onChange({ tds_section: e.target.value || null })}>
              <option value="">No TDS</option>
              {Object.entries(TDS_RULES).map(([k, r]) => <option key={k} value={k}>{k} · {r.pct}%</option>)}
            </NativeSelect>
            <span className="w-24 text-right text-[13px] tabular">{inr(tdsAmt)}</span>
          </div>
        </div>
        <label className="flex items-center gap-2 pt-1 text-[13px] text-muted-foreground">
          <input type="checkbox" disabled={readOnly} checked={f.rcm} onChange={(e) => onChange({ rcm: e.target.checked })} className="accent-emerald-600" />
          Reverse charge (GST self-assessed, not paid to vendor)
        </label>
        <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2.5">
          <span className="text-sm font-semibold text-emerald-900">Net pay</span>
          <span className="text-base font-semibold tabular text-emerald-900">{inr(net)}</span>
        </div>
        {tds && tdsAmt > 0 && <p className="text-[11px] text-muted-foreground">TDS u/s {f.tds_section} at {tds.pct}% on taxable value; deposit by the 7th of next month.</p>}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ approvals

export function ApprovalCard(p: {
  bill: Bill; vendor: Vendor | null; rules: ApprovalRule[]; approvals: Approval[]; role: string; busy: boolean;
  onAct: (a: Approval, action: "approve" | "reject" | "request_changes", comment: string) => void;
}) {
  const [comment, setComment] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const active = p.approvals.filter((a) => a.status !== "cancelled").sort((a, b) => a.level - b.level);
  const rule = active[0]?.rule_id ? p.rules.find((r) => r.id === active[0].rule_id) ?? null : matchRule(p.rules, p.bill, p.vendor);
  const preview = !active.length;
  const mine = active.find((a) => a.status === "pending" && a.approver_role === p.role);
  const act = (action: "approve" | "reject" | "request_changes") => {
    if (action !== "approve" && !comment.trim()) return setErr("Add a comment to reject or request changes.");
    setErr(null);
    p.onAct(mine!, action, comment);
    setComment("");
  };
  const levels = preview ? rule?.levels.map((l) => ({ ...l, status: "waiting" as const, id: String(l.level), comment: null, acted_at: null, pending_since: null })) ?? [] : active;

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <SectionTitle>Approval rule</SectionTitle>
        {preview && rule && <span className="text-[11px] text-muted-foreground">Preview: will apply once checks pass</span>}
      </div>
      {!rule ? (
        <p className="text-xs text-muted-foreground">No rule matches this bill. Add a catch-all rule in Settings.</p>
      ) : (
        <>
          <div className="rounded-lg bg-muted/60 p-3">
            <div className="text-[13px] font-medium">{rule.name}</div>
            <div className="mt-2 space-y-1">
              {rule.conditions.length === 0 && <div className="text-xs text-muted-foreground">No conditions (catch-all)</div>}
              {rule.conditions.map((c, i) => {
                const ok = evaluateCondition(c, p.bill, p.vendor);
                return (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span><span className="mr-1 font-semibold text-slate-500">{i === 0 ? "IF" : "AND"}</span>{describeCondition(c)}</span>
                    <span className={cn("inline-flex items-center gap-1 font-medium", ok ? "text-emerald-700" : "text-slate-400")}>{ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}{ok ? "Match" : "No match"}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {levels.map((a) => {
              const stale = a.status === "pending" && a.pending_since && Date.now() - new Date(a.pending_since).getTime() > 24 * 3600_000;
              return (
                <div key={a.id} className="flex items-start gap-2.5 rounded-lg border border-border p-2.5">
                  <Avatar name={a.approver_name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[13px]"><span className="font-medium">Level {a.level}</span> · {a.approver_name} <span className="text-muted-foreground">({ROLE_LABEL[a.approver_role]})</span></div>
                      <LevelStatus s={a.status} />
                    </div>
                    {a.comment && <div className="mt-1 text-xs text-slate-600">"{a.comment}"</div>}
                    {a.acted_at && <div className="mt-0.5 text-[11px] text-muted-foreground">{timeOf(a.acted_at)}</div>}
                    {stale && <div className="mt-1 flex items-center gap-1 text-[11px] font-medium text-amber-700"><Bell className="h-3 w-3" /> No response in 24h. Reminder sent.</div>}
                  </div>
                </div>
              );
            })}
          </div>
          {mine && p.bill.status === "in_approval" && (
            <div className="mt-3 space-y-2 rounded-lg border border-blue-200 bg-blue-50/40 p-3">
              <div className="text-xs font-medium text-blue-900">Your action (level {mine.level})</div>
              <Textarea rows={2} placeholder="Comment (required to reject or request changes)" value={comment} onChange={(e) => setComment(e.target.value)} />
              {err && <div className="text-xs text-red-600">{err}</div>}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={p.busy} onClick={() => act("approve")}><Check /> Approve</Button>
                <Button size="sm" variant="outline" disabled={p.busy} onClick={() => act("request_changes")}>Request changes</Button>
                <Button size="sm" variant="outline" disabled={p.busy} className="text-red-700 hover:bg-red-50" onClick={() => act("reject")}><X /> Reject</Button>
              </div>
            </div>
          )}
          {!mine && p.bill.status === "in_approval" && (() => {
            const pend = active.find((a) => a.status === "pending");
            return pend ? <p className="mt-3 text-xs text-muted-foreground">Switch to {ROLE_LABEL[pend.approver_role]} (top right) to act on level {pend.level}.</p> : null;
          })()}
        </>
      )}
    </Card>
  );
}

function LevelStatus({ s }: { s: Approval["status"] }) {
  const m: Record<string, [string, string]> = {
    pending: ["Pending", "bg-blue-50 text-blue-700"], waiting: ["Waiting", "bg-slate-100 text-slate-600"], approved: ["Approved", "bg-emerald-50 text-emerald-700"],
    rejected: ["Rejected", "bg-red-50 text-red-700"], changes_requested: ["Changes requested", "bg-amber-50 text-amber-800"], cancelled: ["Cancelled", "bg-slate-100 text-slate-500"],
  };
  return <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", m[s][1])}>{m[s][0]}</span>;
}

// ------------------------------------------------------------------ audit trail

export function AuditTrail({ events }: { events: TraceEvent[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const sorted = [...events].sort((a, b) => a.ts.localeCompare(b.ts));
  return (
    <ol className="relative ml-3 border-l border-border">
      {sorted.map((e) => {
        const agent = AGENTS[e.actor];
        const isOpen = open.has(e.id);
        const ev = Object.keys(e.evidence ?? {}).length > 0;
        return (
          <li key={e.id} className="mb-4 ml-5">
            <span className={cn("absolute -left-3 grid h-6 w-6 place-items-center rounded-full ring-4 ring-white", agent ? "bg-violet-100 text-violet-700" : "bg-emerald-100 text-emerald-700")}>
              {agent ? <Bot className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
            </span>
            <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1 tabular"><Clock className="h-3 w-3" />{timeOf(e.ts)}</span>
              <span className={cn("font-medium", agent ? "text-violet-700" : "text-emerald-700")}>{agent ?? e.actor}</span>
            </div>
            <div className="mt-0.5 text-[13px] font-medium text-slate-900">{e.action}</div>
            <div className="text-[13px] leading-snug text-slate-600">{e.reasoning}</div>
            {ev && (
              <button className="mt-1 inline-flex items-center gap-0.5 text-[11px] font-medium text-slate-500 hover:text-slate-800" onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(e.id)) n.delete(e.id); else n.add(e.id); return n; })}>
                {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />} Evidence
              </button>
            )}
            {isOpen && <div className="mt-1.5"><Evidence data={e.evidence} /></div>}
          </li>
        );
      })}
    </ol>
  );
}
