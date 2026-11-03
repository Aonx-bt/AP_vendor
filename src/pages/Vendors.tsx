import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowUpDown, BadgeCheck, ChevronRight, Search, X } from "lucide-react";
import * as D from "@radix-ui/react-dialog";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, SheetContent } from "@/components/ui/dialog";
import { Avatar, Empty, HealthDot, SimBadge, StatusChip } from "@/components/bits";
import { useOpenBill } from "@/components/AppShell";
import { isOverdue, useData, useDerived } from "@/lib/data";
import { cn, inr, shortDate, timeOf } from "@/lib/utils";
import { TDS_RULES } from "@shared/checks.ts";
import type { Vendor } from "@shared/types.ts";

type SortKey = "name" | "outstanding" | "next_due" | "overdue" | "health" | "open";
const HEALTH_RANK = { red: 0, amber: 1, green: 2 };

export default function Vendors() {
  const { db } = useData();
  const d = useDerived();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ k: SortKey; asc: boolean }>({ k: "outstanding", asc: false });
  const [params, setParams] = useSearchParams();
  const vendorId = params.get("vendor");

  const rows = useMemo(() => {
    if (!db || !d) return [];
    return db.vendors
      .filter((v) => !q || v.name.toLowerCase().includes(q.toLowerCase()) || (v.gstin ?? "").toLowerCase().includes(q.toLowerCase()))
      .map((v) => ({ v, l: d.ledgerBy.get(v.id), h: d.health.get(v.id)! }))
      .sort((a, b) => {
        const val = (x: typeof a): number | string => {
          switch (sort.k) {
            case "name": return x.v.name;
            case "outstanding": return x.l?.outstanding_balance ?? 0;
            case "next_due": return x.l?.next_due_date ?? "9999";
            case "overdue": return x.l?.overdue_amount ?? 0;
            case "health": return HEALTH_RANK[x.h];
            case "open": return x.l?.open_bills ?? 0;
          }
        };
        const A = val(a), B = val(b);
        const c = typeof A === "string" ? A.localeCompare(B as string) : (A as number) - (B as number);
        return sort.asc ? c : -c;
      });
  }, [db, d, q, sort]);

  if (!db || !d) return null;
  const th = (k: SortKey, label: string, right = false) => (
    <th className={cn("px-4 py-2.5 font-medium", right && "text-right")}>
      <button onClick={() => setSort({ k, asc: sort.k === k ? !sort.asc : k === "name" || k === "next_due" })} className={cn("inline-flex items-center gap-1 hover:text-foreground", sort.k === k && "text-foreground")}>
        {label} <ArrowUpDown className="h-3 w-3" />
      </button>
    </th>
  );

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Vendors</h1>
        <div className="relative w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search name or GSTIN" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="border-b border-border bg-muted/60 text-left text-xs text-muted-foreground">
              <tr>
                {th("name", "Vendor")}
                {th("outstanding", "Outstanding Balance", true)}
                {th("next_due", "Next Due Date")}
                {th("overdue", "Overdue Amount", true)}
                {th("health", "Validation Health")}
                {th("open", "Open Bills", true)}
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ v, l, h }) => (
                <tr key={v.id} onClick={() => { params.set("vendor", v.id); setParams(params); }} className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={v.name} />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{v.name}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">{v.gstin ?? "No GSTIN"}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular">{inr(l?.outstanding_balance ?? 0)}</td>
                  <td className="px-4 py-3 tabular">{shortDate(l?.next_due_date)}</td>
                  <td className={cn("px-4 py-3 text-right tabular", (l?.overdue_amount ?? 0) > 0 && "font-medium text-red-600")}>{inr(l?.overdue_amount ?? 0)}</td>
                  <td className="px-4 py-3"><HealthDot h={h} /></td>
                  <td className="px-4 py-3 text-right tabular">{l?.open_bills ?? 0}</td>
                  <td className="pr-3"><ChevronRight className="h-4 w-4 text-slate-400" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && <Empty>No vendors match "{q}".</Empty>}
      </Card>
      <p className="mt-2 text-xs text-muted-foreground">Outstanding balance is the total of approved, unpaid bills (vendor_ledger view).</p>
      <VendorLedger vendor={vendorId ? db.vendors.find((v) => v.id === vendorId) ?? null : null} onClose={() => { params.delete("vendor"); setParams(params, { replace: true }); }} />
    </div>
  );
}

function VendorLedger({ vendor, onClose }: { vendor: Vendor | null; onClose: () => void }) {
  const { db } = useData();
  const d = useDerived();
  const openBill = useOpenBill();
  if (!db || !d) return null;
  const bills = vendor ? db.bills.filter((b) => b.vendor_id === vendor.id).sort((a, b) => (b.invoice_date ?? "").localeCompare(a.invoice_date ?? "")) : [];
  const ids = new Set(bills.map((b) => b.id));
  const timeline = db.trace_events.filter((t) => t.bill_id && ids.has(t.bill_id) && (t.actor.includes(" ") || t.action.startsWith("Decision") || t.action === "Bill approved")).sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 8);
  const l = vendor ? d.ledgerBy.get(vendor.id) : undefined;
  const fy = vendor?.tds_section ? TDS_RULES[vendor.tds_section] : null;

  return (
    <Dialog open={!!vendor} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="max-w-xl" aria-describedby={undefined}>
        {vendor && (
          <>
            <div className="flex items-start justify-between bg-gradient-to-r from-emerald-50 via-sky-50 to-violet-50 px-5 py-4">
              <div className="flex items-center gap-3">
                <Avatar name={vendor.name} />
                <div>
                  <D.Title className="text-base font-semibold">{vendor.name}</D.Title>
                  <div className="text-xs text-muted-foreground">{vendor.contact_email}</div>
                </div>
              </div>
              <D.Close className="rounded-lg p-1.5 text-slate-500 hover:bg-white/70" aria-label="Close"><X className="h-5 w-5" /></D.Close>
            </div>
            <div className="scroll-thin flex-1 space-y-5 overflow-y-auto p-5">
              <div className="grid grid-cols-3 gap-3">
                {[["Outstanding", l?.outstanding_balance ?? 0], ["Overdue", l?.overdue_amount ?? 0], ["Open bills", l?.open_bills ?? 0]].map(([k, v]) => (
                  <div key={k as string} className="rounded-xl border border-border p-3">
                    <div className="text-[11px] text-muted-foreground">{k}</div>
                    <div className="mt-0.5 font-semibold tabular">{k === "Open bills" ? v : inr(v as number)}</div>
                  </div>
                ))}
              </div>
              <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2.5 text-[13px]">
                <dt className="text-muted-foreground">GSTIN</dt>
                <dd className="flex flex-wrap items-center gap-2"><span className="font-mono">{vendor.gstin ?? "—"}</span><span className={cn("rounded px-1.5 text-[11px] font-medium", vendor.gstin_status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")}>{vendor.gstin_status}</span><SimBadge /></dd>
                <dt className="text-muted-foreground">MSME</dt>
                <dd>{vendor.msme_status ? <>{vendor.msme_status} · <span className="font-mono text-xs">{vendor.udyam_no}</span></> : "Not registered"}</dd>
                <dt className="text-muted-foreground">Bank</dt>
                <dd className="flex items-center gap-1.5">{vendor.bank_name} ••{vendor.bank_last4} · {vendor.ifsc} {vendor.bank_verified ? <BadgeCheck className="h-4 w-4 text-emerald-600" /> : <span className="text-xs font-medium text-amber-700">unverified</span>}</dd>
                <dt className="text-muted-foreground">TDS section</dt>
                <dd>{fy ? `${fy.label} · ${fy.pct}%` : "None"}</dd>
                <dt className="text-muted-foreground">FY taxable total</dt>
                <dd className="tabular">{inr(vendor.fy_taxable_total)}</dd>
                <dt className="text-muted-foreground">Email domain</dt>
                <dd>{vendor.email_domain}</dd>
              </dl>
              <div>
                <div className="mb-2 text-sm font-semibold">Bills</div>
                <div className="divide-y divide-border rounded-xl border border-border">
                  {bills.map((b) => (
                    <button key={b.id} onClick={() => openBill(b.id)} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-[13px] hover:bg-muted/50">
                      <div className="min-w-0">
                        <div className="font-mono">{b.invoice_no ?? "—"}</div>
                        <div className={cn("text-xs text-muted-foreground", isOverdue(b) && "font-medium text-red-600")}>Due {shortDate(b.due_date)}{isOverdue(b) ? " · overdue" : ""}</div>
                      </div>
                      <div className="flex items-center gap-3"><span className="font-medium tabular">{inr(b.total)}</span><StatusChip bill={b} /></div>
                    </button>
                  ))}
                  {!bills.length && <Empty>No bills yet.</Empty>}
                </div>
              </div>
              <div>
                <div className="mb-2 text-sm font-semibold">Recent activity</div>
                <ol className="space-y-2.5 border-l border-border pl-4">
                  {timeline.map((t) => (
                    <li key={t.id} className="relative text-[13px]">
                      <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-emerald-500 ring-4 ring-white" />
                      <div className="text-xs text-muted-foreground">{timeOf(t.ts)} · {t.actor.includes("_") ? t.actor.replace("_", " ") : t.actor} · {bills.find((b) => b.id === t.bill_id)?.invoice_no}</div>
                      <div>{t.action}</div>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Dialog>
  );
}
