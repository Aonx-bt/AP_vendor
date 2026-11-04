import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Circle, Loader2, MinusCircle, X } from "lucide-react";
import type { ExtractionRun, TraceEvent } from "@shared/types.ts";
import { fmtSecs, stagesFromTraces, type Stage, type StageStatus } from "@shared/stages.ts";
import { useData } from "@/lib/data";
import { cn } from "@/lib/utils";

/** Polls a bill's steps while `active`, so the stage list updates as the server works. */
export function useRunProgress(billId: string | null, active: boolean, intervalMs = 800) {
  const { backend } = useData();
  const [data, setData] = useState<{ traces: TraceEvent[]; runs: ExtractionRun[] }>({ traces: [], runs: [] });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    if (!billId) return;
    const tick = () =>
      backend.runProgress(billId).then((d) => alive.current && setData(d)).catch(() => {});
    tick();
    if (!active) return () => { alive.current = false; };
    const t = setInterval(tick, intervalMs);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, [billId, active, backend, intervalMs]);
  return data;
}

const ICON: Record<StageStatus, JSX.Element> = {
  pending: <Circle className="h-4 w-4 text-slate-300" />,
  running: <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />,
  done: <Check className="h-4 w-4 text-emerald-600" strokeWidth={3} />,
  warn: <AlertTriangle className="h-4 w-4 text-amber-500" />,
  failed: <X className="h-4 w-4 text-red-600" strokeWidth={3} />,
  skipped: <MinusCircle className="h-4 w-4 text-slate-300" />,
};
const RING: Record<StageStatus, string> = {
  pending: "bg-white ring-slate-200",
  running: "bg-emerald-50 ring-emerald-300",
  done: "bg-emerald-50 ring-emerald-200",
  warn: "bg-amber-50 ring-amber-200",
  failed: "bg-red-50 ring-red-200",
  skipped: "bg-white ring-slate-200",
};

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/** The 7 stages of one run as a vertical list. `run` null = the bill's latest run. */
export function RunProgress({ traces, runs, run, fileName, live }: { traces: TraceEvent[]; runs: ExtractionRun[]; run?: ExtractionRun | null; fileName?: string | null; live?: boolean }) {
  const current = run ?? runs[runs.length - 1] ?? null;
  const stages = stagesFromTraces(traces, current, runs);
  const running = live && (!current || current.status === "running");
  const now = useNow(!!running);
  const startedAt = current?.started_at ?? stages[0].startedAt;
  const elapsed = startedAt ? ((current?.finished_at ? new Date(current.finished_at).getTime() : now) - new Date(startedAt).getTime()) / 1000 : null;

  return (
    <div className="rounded-xl border border-border bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium">{fileName ?? current?.file_name ?? "Invoice"}</div>
          <div className="text-[11px] text-muted-foreground">
            {running ? "Processing" : current?.status === "failed" ? "Stopped" : "Finished"}
            {elapsed != null && elapsed >= 0 ? ` · ${fmtSecs(elapsed)}` : ""}
          </div>
        </div>
        {running && <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />}
      </div>
      <ol className="px-4 py-3">
        {stages.map((s, i) => (
          <StageRow key={s.key} s={s} last={i === stages.length - 1} now={now} />
        ))}
      </ol>
    </div>
  );
}

function StageRow({ s, last, now }: { s: Stage; last: boolean; now: number }) {
  const dur =
    s.startedAt && s.endedAt && s.endedAt !== s.startedAt ? (new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 1000
    : s.status === "running" && s.startedAt ? (now - new Date(s.startedAt).getTime()) / 1000
    : null;
  return (
    <li className="relative flex gap-3 pb-3 last:pb-0">
      {!last && <span className={cn("absolute left-[13px] top-7 h-[calc(100%-22px)] w-px", s.status === "pending" || s.status === "skipped" ? "bg-slate-200" : "bg-emerald-200")} />}
      <span className={cn("relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full ring-1", RING[s.status])}>{ICON[s.status]}</span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className={cn("text-[13px] font-medium", s.status === "pending" || s.status === "skipped" ? "text-muted-foreground" : "text-slate-900")}>{s.label}</span>
          {dur != null && dur >= 0.05 && <span className="shrink-0 text-[11px] tabular text-muted-foreground">{fmtSecs(dur)}</span>}
        </div>
        {s.detail && s.status !== "pending" && (
          <div className={cn("mt-0.5 text-xs leading-snug", s.status === "failed" ? "text-red-700" : s.status === "warn" ? "text-amber-800" : "text-muted-foreground")}>{s.detail}</div>
        )}
      </div>
    </li>
  );
}

/** Seven small dots, one per stage, for tables. */
export function StageDots({ traces, run, runs }: { traces: TraceEvent[]; run: ExtractionRun; runs: ExtractionRun[] }) {
  const stages = stagesFromTraces(traces, run, runs);
  const cls: Record<StageStatus, string> = {
    pending: "bg-slate-200", running: "bg-emerald-300 animate-pulse", done: "bg-emerald-500", warn: "bg-amber-400", failed: "bg-red-500", skipped: "bg-slate-200",
  };
  return (
    <span className="inline-flex items-center gap-1" aria-label={stages.map((s) => `${s.label}: ${s.status}`).join(", ")}>
      {stages.map((s) => <span key={s.key} title={`${s.label}: ${s.status}`} className={cn("h-2 w-2 rounded-full", cls[s.status])} />)}
    </span>
  );
}
