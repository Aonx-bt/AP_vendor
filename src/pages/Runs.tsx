import { useMemo, useState } from "react";
import { ArrowRight, ChevronRight, X } from "lucide-react";
import * as D from "@radix-ui/react-dialog";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, SheetContent } from "@/components/ui/dialog";
import { Empty, StatusChip } from "@/components/bits";
import { RunProgress, StageDots } from "@/components/RunProgress";
import { useOpenBill } from "@/components/AppShell";
import { useData } from "@/lib/data";
import { cn, timeOf } from "@/lib/utils";
import { fmtSecs, readerName, runTimings } from "@shared/stages.ts";
import type { ExtractionRun } from "@shared/types.ts";

const SOURCE: Record<ExtractionRun["source"], string> = { upload: "Upload", email: "Email", reset: "Re-read", seed: "Sample" };
type Filter = "all" | "failed" | "review";
const NEEDS_ATTENTION = new Set(["needs_review", "needs_vendor_info", "duplicate"]);

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export default function Runs() {
  const { db } = useData();
  const openBill = useOpenBill();
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<ExtractionRun | null>(null);

  const all = useMemo(() => [...(db?.extraction_runs ?? [])].sort((a, b) => b.started_at.localeCompare(a.started_at)), [db]);
  if (!db) return null;

  const billById = new Map(db.bills.map((b) => [b.id, b]));
  const runsOf = (billId: string) => all.filter((r) => r.bill_id === billId);
  const tracesOf = (billId: string) => db.trace_events.filter((t) => t.bill_id === billId);

  // tiles: last 7 days, real runs only (sample runs have no real timings)
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const real = all.filter((r) => r.source !== "seed");
  const week = real.filter((r) => r.started_at >= weekAgo);
  const finished = week.filter((r) => r.status !== "running");
  const ok = finished.filter((r) => r.status === "succeeded").length;
  const reads = week.map((r) => runTimings(r).reading).filter((x): x is number => x != null);
  const attention = finished.filter((r) => r.status === "failed" || NEEDS_ATTENTION.has(r.outcome ?? "")).length;
  const tiles = [
    { label: "Runs, last 7 days", value: String(week.length), sub: `${all.length - real.length} sample runs not counted` },
    { label: "Read successfully", value: finished.length ? `${Math.round((ok / finished.length) * 100)}%` : "—", sub: `${ok} of ${finished.length} finished` },
    { label: "Median reading time", value: reads.length ? fmtSecs(median(reads)) : "—", sub: reads.length ? `across ${reads.length} runs` : "no real runs yet" },
    { label: "Needed a person", value: finished.length ? `${Math.round((attention / finished.length) * 100)}%` : "—", sub: "review, vendor info or duplicate" },
  ];

  const chart = real
    .filter((r) => runTimings(r).reading != null)
    .slice(0, 20)
    .reverse()
    .map((r) => ({ id: r.id, label: timeOf(r.started_at), file: r.file_name ?? "", reading: Math.round((runTimings(r).reading ?? 0) * 10) / 10, total: Math.round((runTimings(r).total ?? 0) * 10) / 10 }));

  // whole-second ticks: 0..ceil(max) in up to 5 steps
  const maxSec = Math.max(1, Math.ceil(Math.max(0, ...chart.map((c) => c.reading))));
  const step = Math.max(1, Math.ceil(maxSec / 4));
  const ticks = Array.from({ length: Math.floor(maxSec / step) + 1 }, (_, i) => i * step);
  if (ticks[ticks.length - 1] < maxSec) ticks.push(ticks[ticks.length - 1] + step);

  const rows = all.filter((r) =>
    filter === "failed" ? r.status === "failed" : filter === "review" ? r.status === "failed" || NEEDS_ATTENTION.has(r.outcome ?? "") : true,
  );

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Runs</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Every time an invoice is read: from upload or email, through reading, checks and routing.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label} className="p-4">
            <div className="text-xs text-muted-foreground">{t.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular tracking-tight">{t.value}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{t.sub}</div>
          </Card>
        ))}
      </div>

      <Card className="p-5">
        <div className="text-sm font-semibold">Reading time per run</div>
        <div className="text-xs text-muted-foreground">Seconds the reader took on each document, last {chart.length || 20} real runs (oldest on the left)</div>
        {chart.length ? (
          <div className="mt-4 h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ left: 0, right: 8, top: 8 }} barCategoryGap={2}>
                <CartesianGrid vertical={false} stroke="hsl(220 16% 93%)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#64748b" }} interval="preserveStartEnd" minTickGap={24} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#64748b" }} tickFormatter={(v) => `${v} s`} width={44} domain={[0, ticks[ticks.length - 1]]} ticks={ticks} />
                <Tooltip
                  cursor={{ fill: "hsl(152 76% 96%)" }}
                  formatter={((v: number, _n: unknown, p: { payload: { total: number; file: string } }) => [`${v} s reading · ${p.payload.total} s in total`, p.payload.file]) as never}
                  labelFormatter={(l) => l}
                  contentStyle={{ borderRadius: 10, border: "1px solid hsl(220 16% 91%)", fontSize: 12 }}
                />
                <Bar dataKey="reading" fill="#059669" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="mt-4 rounded-lg bg-muted/60 px-3 py-6 text-center text-xs text-muted-foreground">No real runs yet. Upload an invoice from Bills → Add Bill and it will appear here.</p>
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        {(["all", "failed", "review"] as Filter[]).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "dark" : "outline"} onClick={() => setFilter(f)}>
            {f === "all" ? "All runs" : f === "failed" ? "Could not read" : "Needed a person"}
          </Button>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b border-border bg-muted/60 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Started</th>
                <th className="px-4 py-2.5 font-medium">File</th>
                <th className="px-4 py-2.5 font-medium">Source</th>
                <th className="px-4 py-2.5 font-medium">Reader</th>
                <th className="px-4 py-2.5 text-right font-medium">Reading</th>
                <th className="px-4 py-2.5 text-right font-medium">Total</th>
                <th className="px-4 py-2.5 font-medium">Stages</th>
                <th className="px-4 py-2.5 font-medium">Result</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const t = runTimings(r);
                const bill = billById.get(r.bill_id);
                const sample = r.source === "seed";
                return (
                  <tr key={r.id} onClick={() => setSelected(r)} className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/50">
                    <td className="whitespace-nowrap px-4 py-3 tabular text-slate-700">{timeOf(r.started_at)}</td>
                    <td className="max-w-[220px] truncate px-4 py-3 font-medium">{r.file_name ?? "—"}</td>
                    <td className="px-4 py-3"><span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", sample ? "bg-slate-100 text-slate-500" : "bg-emerald-50 text-emerald-800")}>{SOURCE[r.source]}</span></td>
                    <td className="px-4 py-3 text-muted-foreground">{readerName(r.engine) ?? "—"}</td>
                    <td className="px-4 py-3 text-right tabular">{sample ? "—" : fmtSecs(t.reading) || "—"}</td>
                    <td className="px-4 py-3 text-right tabular">{sample ? "—" : r.status === "running" ? "running…" : fmtSecs(t.total) || "—"}</td>
                    <td className="px-4 py-3"><StageDots traces={tracesOf(r.bill_id)} run={r} runs={runsOf(r.bill_id)} /></td>
                    <td className="px-4 py-3">
                      {r.status === "running" ? <span className="text-xs text-emerald-700">Processing…</span>
                        : r.status === "failed" ? <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-200">Could not read</span>
                        : bill ? <StatusChip bill={{ status: r.outcome ?? bill.status, paid_at: null }} /> : "—"}
                    </td>
                    <td className="pr-3"><ChevronRight className="h-4 w-4 text-slate-400" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!rows.length && <Empty>{all.length ? "No runs match this filter." : "No runs yet. Upload an invoice from Bills → Add Bill."}</Empty>}
      </Card>
      <p className="text-xs text-muted-foreground">Sample runs come from the demo data and have no real timings. Dots, left to right: received, reading, vendor, amounts, checks, decision, routing.</p>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="max-w-lg" aria-describedby={undefined}>
          {selected && (
            <>
              <div className="flex items-start justify-between bg-gradient-to-r from-emerald-50 via-sky-50 to-violet-50 px-5 py-4">
                <div>
                  <D.Title className="text-base font-semibold">Run details</D.Title>
                  <div className="text-xs text-muted-foreground">{SOURCE[selected.source]} · {timeOf(selected.started_at)} · {readerName(selected.engine) ?? "—"}</div>
                </div>
                <D.Close className="rounded-lg p-1.5 text-slate-500 hover:bg-white/70" aria-label="Close"><X className="h-5 w-5" /></D.Close>
              </div>
              <div className="scroll-thin flex-1 space-y-4 overflow-y-auto p-5">
                <RunProgress traces={tracesOf(selected.bill_id)} runs={runsOf(selected.bill_id)} run={selected} />
                {selected.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{selected.error}</p>}
                {selected.low_confidence.length > 0 && <p className="text-xs text-muted-foreground">Fields to check: {selected.low_confidence.join(", ").replace(/_/g, " ")}</p>}
                <Button onClick={() => { const id = selected.bill_id; setSelected(null); openBill(id); }}>Open bill <ArrowRight /></Button>
              </div>
            </>
          )}
        </SheetContent>
      </Dialog>
    </div>
  );
}
