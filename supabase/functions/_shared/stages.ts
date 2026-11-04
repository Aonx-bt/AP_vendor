// Turns a bill's trace rows (plus its extraction run) into the 7 stages shown in the live progress
// view and the Runs dashboard. Pure: used by the browser in demo and live mode.
import type { ExtractionRun, TraceEvent } from "./types.ts";

export type StageStatus = "pending" | "running" | "done" | "warn" | "failed" | "skipped";
export type StageKey = "received" | "reading" | "vendor" | "amounts" | "checks" | "decision" | "routing";

export interface Stage {
  key: StageKey;
  label: string;
  status: StageStatus;
  detail: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

export const STAGE_LABELS: Record<StageKey, string> = {
  received: "Received",
  reading: "Reading document",
  vendor: "Matching vendor",
  amounts: "Checking amounts",
  checks: "Running checks",
  decision: "Deciding",
  routing: "Routing for approval",
};
const ORDER: StageKey[] = ["received", "reading", "vendor", "amounts", "checks", "decision", "routing"];
const READ_FAILURES = new Set(["Extraction failed", "Password-protected PDF", "Corrupted file", "Unsupported file", "Cannot read invoice"]);

const secs = (a: string | null, b: string | null) => (a && b ? Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 1000) : null);
/** Display name of the reading engine, e.g. "Sarvam Vision". */
export function readerName(engine: string | null | undefined): string | null {
  if (!engine) return null;
  if (engine.startsWith("sarvam")) return "Sarvam Vision";
  if (engine.startsWith("claude")) return "Claude";
  if (engine === "simulated") return "Demo reader";
  return engine;
}

export const fmtSecs = (s: number | null) => (s == null ? "" : s < 10 ? `${s.toFixed(1)} s` : `${Math.round(s)} s`);

/** Where a run's rows begin: a re-read starts at its "Reset bill" row; the first run starts at the bill's first row. */
function runStart(sorted: TraceEvent[], run: ExtractionRun): string {
  if (run.source !== "reset") return "";
  const reset = sorted.filter((t) => t.action === "Reset bill" && t.ts <= run.started_at).pop();
  return reset?.ts ?? run.started_at;
}

/** Only the trace rows of one run: from its start up to the next run of the same bill. */
export function runTraces(traces: TraceEvent[], run: ExtractionRun | null, otherRuns: ExtractionRun[] = []): TraceEvent[] {
  const sorted = [...traces].sort((a, b) => a.ts.localeCompare(b.ts));
  if (!run) return sorted;
  const from = runStart(sorted, run);
  const next = otherRuns.filter((r) => r.id !== run.id && r.started_at > run.started_at).sort((a, b) => a.started_at.localeCompare(b.started_at))[0];
  const to = next ? runStart(sorted, next) || next.started_at : null;
  return sorted.filter((t) => t.ts >= from && (!to || t.ts < to));
}

export function stagesFromTraces(allTraces: TraceEvent[], run: ExtractionRun | null, otherRuns: ExtractionRun[] = []): Stage[] {
  const t = runTraces(allTraces, run, otherRuns);
  const find = (pred: (e: TraceEvent) => boolean) => t.find(pred) ?? null;
  const stages = Object.fromEntries(ORDER.map((k) => [k, { key: k, label: STAGE_LABELS[k], status: "pending", detail: null, startedAt: null, endedAt: null } as Stage])) as Record<StageKey, Stage>;

  // 1. received
  const recv = find((e) => e.action === "Bill received" || e.action === "Reset bill");
  if (recv) Object.assign(stages.received, { status: "done", detail: recv.action === "Reset bill" ? "Re-reading the original document" : recv.reasoning, startedAt: recv.ts, endedAt: recv.ts });

  // 2. reading
  const readStart = find((e) => e.action === "Reading document");
  const readDone = find((e) => e.action === "Extracted invoice fields");
  const readFail = find((e) => READ_FAILURES.has(e.action));
  const engine = (readDone?.evidence?.engine as string) ?? (readStart?.evidence?.engine as string) ?? run?.engine ?? null;
  const engineName = readerName(engine);
  if (readFail) Object.assign(stages.reading, { status: "failed", detail: readFail.reasoning, startedAt: readStart?.ts ?? readFail.ts, endedAt: readFail.ts });
  else if (readDone) {
    // prefer the run's own read times (they bracket just the reader's call)
    const s = run?.read_started_at && run?.read_finished_at ? secs(run.read_started_at, run.read_finished_at) : secs(readStart?.ts ?? null, readDone.ts);
    const fields = run?.fields_found;
    const low = run?.low_confidence?.length ?? 0;
    const bits = [engineName, s != null ? fmtSecs(s) : null, fields != null ? `${fields} fields` : null, low ? `${low} to check` : null].filter(Boolean);
    Object.assign(stages.reading, {
      status: low ? "warn" : "done", detail: bits.join(" · ") || readDone.reasoning,
      startedAt: run?.read_started_at ?? readStart?.ts ?? readDone.ts, endedAt: run?.read_finished_at ?? readDone.ts,
    });
  } else if (readStart) Object.assign(stages.reading, { status: "running", detail: `${engineName ?? "AP agent"} is reading the document…`, startedAt: readStart.ts });

  // 3. vendor
  const vMatch = find((e) => e.action === "Matched vendor");
  const vMiss = find((e) => e.action === "Vendor not matched");
  if (vMatch) Object.assign(stages.vendor, { status: "done", detail: vMatch.reasoning, startedAt: vMatch.ts, endedAt: vMatch.ts });
  else if (vMiss) Object.assign(stages.vendor, { status: "warn", detail: "Not in the vendor list. Pick one or add it as a new vendor.", startedAt: vMiss.ts, endedAt: vMiss.ts });

  // 4. amounts
  const amt = find((e) => e.action === "Reconciled amounts");
  if (amt) Object.assign(stages.amounts, { status: "done", detail: amt.reasoning, startedAt: amt.ts, endedAt: amt.ts });
  if (amt && stages.vendor.status === "pending") Object.assign(stages.vendor, { status: "warn", detail: "No vendor name or GSTIN on the document.", startedAt: amt.ts, endedAt: amt.ts });

  // 5. checks
  const firstDecision = find((e) => e.action.startsWith("Decision"));
  const checks = t.filter((e) => e.actor === "validation_agent" && !e.action.startsWith("Decision") && (!firstDecision || e.ts <= firstDecision.ts));
  if (checks.length) {
    const outcome = (e: TraceEvent) => e.action.split(": ").pop();
    const n = (o: string) => checks.filter((e) => outcome(e) === o).length;
    const fails = n("fail"), warns = n("warn"), passes = n("pass"), skipped = n("skipped");
    const decided = !!find((e) => e.action.startsWith("Decision"));
    Object.assign(stages.checks, {
      status: !decided ? "running" : fails ? "failed" : warns ? "warn" : "done",
      detail: [passes && `${passes} passed`, warns && `${warns} warning${warns > 1 ? "s" : ""}`, fails && `${fails} failed`, skipped && `${skipped} not applicable`].filter(Boolean).join(" · "),
      startedAt: checks[0].ts, endedAt: decided ? checks[checks.length - 1].ts : null,
    });
  }

  // 6. decision
  const dec = firstDecision;
  if (dec) {
    const what = dec.action.replace("Decision: ", "");
    const st: StageStatus = what === "ready for approval" ? "done" : what === "duplicate" ? "failed" : "warn";
    Object.assign(stages.decision, { status: st, detail: `${what[0].toUpperCase()}${what.slice(1)}. ${dec.reasoning}`, startedAt: dec.ts, endedAt: dec.ts });
  }

  // 7. routing
  const routed = find((e) => e.actor !== "validation_agent" && (e.action.startsWith("Routed to") || e.action === "No approval rule matched"));
  if (routed) Object.assign(stages.routing, { status: routed.action === "No approval rule matched" ? "warn" : "done", detail: routed.reasoning, startedAt: routed.ts, endedAt: routed.ts });
  else if (dec && dec.action !== "Decision: ready for approval") Object.assign(stages.routing, { status: "skipped", detail: "Not sent for approval until the issues above are resolved." });

  // A read failure ends the run: later stages are skipped
  if (stages.reading.status === "failed") for (const k of ORDER.slice(2)) if (stages[k].status === "pending") stages[k].status = "skipped";
  // the first pending stage after a finished one is "running" while the run is still going
  const running = run ? run.status === "running" : !dec && !readFail;
  if (running && !ORDER.some((k) => stages[k].status === "running")) {
    const next = ORDER.find((k) => stages[k].status === "pending");
    if (next) stages[next].status = "running";
  }
  if (!running) for (const k of ORDER) if (stages[k].status === "running") stages[k].status = "skipped";
  return ORDER.map((k) => stages[k]);
}

/** Overall timing for a run: total seconds and reading seconds. */
export function runTimings(run: ExtractionRun) {
  return { total: secs(run.started_at, run.finished_at), reading: secs(run.read_started_at, run.read_finished_at) };
}
