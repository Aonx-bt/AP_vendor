import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowDownUp, ChevronRight, Filter, Inbox, Plus, X } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, CountPill } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label, NativeSelect } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/menu";
import { Avatar, Empty, StatusChip } from "@/components/bits";
import { useOpenBill } from "@/components/AppShell";
import { UploadDialog } from "@/components/UploadDialog";
import { isOverdue, useData, useDerived, type BillTab } from "@/lib/data";
import { cn, inr, shortDate } from "@/lib/utils";
import { DEPARTMENTS } from "@shared/types.ts";

const TABS: { key: BillTab; label: string }[] = [
  { key: "needs_review", label: "Needs Review" },
  { key: "my_approvals", label: "My Approvals" },
  { key: "waiting_vendor", label: "Waiting on Vendor" },
  { key: "all", label: "All Bills" },
  { key: "rejected", label: "Rejected" },
];

export default function Bills() {
  const { db } = useData();
  const d = useDerived();
  const [params, setParams] = useSearchParams();
  const openBill = useOpenBill();
  const tab = (params.get("tab") as BillTab) || "needs_review";
  const filter = params.get("filter"); // overdue | failed
  const vendorF = params.get("vendor") ?? "";
  const deptF = params.get("dept") ?? "";
  const [asc, setAsc] = useState(false);
  const [upload, setUpload] = useState(false);

  const set = (k: string, v: string | null) => {
    if (v) params.set(k, v);
    else params.delete(k);
    setParams(params, { replace: true });
  };

  const rows = useMemo(() => {
    if (!db || !d) return [];
    return db.bills
      .filter(d.tabFilter[tab])
      .filter((b) => (filter === "overdue" ? isOverdue(b) : filter === "failed" ? d.failedBillIds.has(b.id) && b.status !== "rejected" && b.status !== "duplicate" : true))
      .filter((b) => (vendorF ? b.vendor_id === vendorF : true))
      .filter((b) => (deptF ? b.department === deptF : true))
      .sort((a, b) => (asc ? a.updated_at.localeCompare(b.updated_at) : b.updated_at.localeCompare(a.updated_at)));
  }, [db, d, tab, filter, vendorF, deptF, asc]);

  if (!db || !d) return null;
  const total = rows.reduce((s, b) => s + (b.total ?? 0), 0);
  const moreActive = (vendorF ? 1 : 0) + (deptF ? 1 : 0) + (filter === "failed" ? 1 : 0);

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Bills</h1>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link to="/settings?tab=mailbox"><Inbox /> Inbox</Link>
          </Button>
          <Button onClick={() => setUpload(true)}><Plus /> Add Bill</Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => set("tab", v)}>
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.label} <CountPill n={d.counts[t.key]} />
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-6 text-sm">
          <div><span className="text-muted-foreground">Total Bills</span> <span className="ml-1 font-semibold tabular">{rows.length}</span></div>
          <div><span className="text-muted-foreground">Total Amount</span> <span className="ml-1 font-semibold tabular">{inr(total)}</span></div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant={filter === "overdue" ? "dark" : "outline"} size="sm" onClick={() => set("filter", filter === "overdue" ? null : "overdue")}>
            Overdue
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant={moreActive ? "dark" : "outline"} size="sm"><Filter /> More filters{moreActive ? ` (${moreActive})` : ""}</Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="space-y-3">
              <div className="space-y-1">
                <Label>Vendor</Label>
                <NativeSelect value={vendorF} onChange={(e) => set("vendor", e.target.value || null)}>
                  <option value="">All vendors</option>
                  {db.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </NativeSelect>
              </div>
              <div className="space-y-1">
                <Label>Department</Label>
                <NativeSelect value={deptF} onChange={(e) => set("dept", e.target.value || null)}>
                  <option value="">All departments</option>
                  {DEPARTMENTS.map((x) => <option key={x}>{x}</option>)}
                </NativeSelect>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={filter === "failed"} onChange={(e) => set("filter", e.target.checked ? "failed" : null)} className="accent-emerald-600" />
                Validation failed only
              </label>
            </PopoverContent>
          </Popover>
          <Button variant="ghost" size="sm" onClick={() => setAsc(!asc)} title="Sort by last updated">
            <ArrowDownUp /> Last updated {asc ? "↑" : "↓"}
          </Button>
        </div>
      </div>

      {(filter || vendorF || deptF) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {filter && <FilterChip label={filter === "overdue" ? "Overdue" : "Validation failed"} onClear={() => set("filter", null)} />}
          {vendorF && <FilterChip label={d.vendorById.get(vendorF)?.name ?? "Vendor"} onClear={() => set("vendor", null)} />}
          {deptF && <FilterChip label={deptF} onClear={() => set("dept", null)} />}
        </div>
      )}

      <Card className="mt-4 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-border bg-muted/60 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Vendor</th>
                <th className="px-4 py-2.5 font-medium">Bill ID</th>
                <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                <th className="px-4 py-2.5 font-medium">Due Date</th>
                <th className="px-4 py-2.5 font-medium">Narration</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => {
                const v = b.vendor_id ? d.vendorById.get(b.vendor_id) : null;
                const vname = v?.name ?? b.extracted?.vendor_name ?? "Unassigned vendor";
                const od = isOverdue(b);
                return (
                  <tr key={b.id} onClick={() => openBill(b.id)} className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={vname} />
                        <span className={cn("max-w-[220px] truncate font-medium", !v && "text-muted-foreground italic")}>{vname}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-[13px] text-slate-700">{b.invoice_no ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-4 py-3 text-right font-medium tabular">{inr(b.total)}</td>
                    <td className={cn("px-4 py-3 tabular", od && "font-medium text-red-600")}>{shortDate(b.due_date)}{od && <span className="ml-1 text-xs">overdue</span>}</td>
                    <td className="max-w-[220px] truncate px-4 py-3 text-muted-foreground">{b.status === "received" ? "Reading invoice…" : b.narration ?? "—"}</td>
                    <td className="px-4 py-3"><StatusChip bill={b} /></td>
                    <td className="pr-3"><ChevronRight className="h-4 w-4 text-slate-400" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!rows.length && <Empty>No bills here.</Empty>}
      </Card>
      <UploadDialog open={upload} onOpenChange={setUpload} />
    </div>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-2.5 pr-1 text-xs font-medium">
      {label}
      <button onClick={onClear} className="rounded-full p-0.5 hover:bg-slate-200" aria-label={`Clear ${label}`}><X className="h-3 w-3" /></button>
    </span>
  );
}
