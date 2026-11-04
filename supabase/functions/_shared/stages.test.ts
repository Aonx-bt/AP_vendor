import { describe, expect, it } from "vitest";
import { MemoryStore } from "./store.ts";
import { buildDemo } from "./seed.ts";
import { SimulatedLLM } from "./llm.ts";
import { createBillFromFile, resetBill, runExtraction, type Ctx } from "./pipeline.ts";
import { renderInvoicePdf } from "./pdf.ts";
import { runTimings, stagesFromTraces } from "./stages.ts";

async function setup() {
  const store = new MemoryStore();
  await buildDemo(store, new Date());
  const ctx: Ctx = { store, llm: new SimulatedLLM(), now: () => new Date() };
  const view = (billId: string) => {
    const runs = store.db.extraction_runs.filter((r) => r.bill_id === billId).sort((a, b) => a.started_at.localeCompare(b.started_at));
    const traces = store.db.trace_events.filter((t) => t.bill_id === billId);
    return { runs, stages: (i = runs.length - 1) => stagesFromTraces(traces, runs[i], runs) };
  };
  return { store, ctx, view };
}
const status = (st: { key: string; status: string }[]) => Object.fromEntries(st.map((s) => [s.key, s.status]));
const doc = (over: Record<string, unknown> = {}) =>
  renderInvoicePdf({
    vendor: { name: "Sahyadri Packaging Industries", address: "Pune", gstin: "27ABDFS3147K1ZY", pan: "ABDFS3147K" },
    buyer: { name: "Kaveri Polymers Pvt Ltd", address: "Pune", gstin: "27AAHCK4821M1Z7" },
    invoice_no: "SPI/TEST/1", invoice_date: new Date().toISOString().slice(0, 10), payment_terms: "Net 30",
    bank: { name: "HDFC Bank", account: "50100234124821", ifsc: "HDFC0001298" }, cgst: 900, sgst: 900,
    lines: [{ description: "Boxes", hsn_sac: "48191010", qty: 80, rate: 125, gst_pct: 18 }], ...over,
  } as never);

describe("extraction runs and stages", () => {
  it("records a successful run with all stages done", async () => {
    const { ctx, view } = await setup();
    const b = await createBillFromFile(ctx, { bytes: doc(), mime: "application/pdf", name: "spi.pdf", department: "Operations" });
    const out = await runExtraction(ctx, b.id);
    const { runs, stages } = view(b.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ source: "upload", status: "succeeded", outcome: out.status, engine: "simulated" });
    expect(runs[0].read_started_at).toBeTruthy();
    expect(runs[0].fields_found).toBeGreaterThan(5);
    expect(runTimings(runs[0]).total).not.toBeNull();
    expect(status(stages())).toEqual({ received: "done", reading: "done", vendor: "done", amounts: "done", checks: "done", decision: "done", routing: "done" });
  });

  it("marks a password-protected PDF as a failed read and skips the rest", async () => {
    const { ctx, view } = await setup();
    const b = await createBillFromFile(ctx, { bytes: doc({ encrypted: true }), mime: "application/pdf", name: "locked.pdf" });
    await runExtraction(ctx, b.id);
    const { runs, stages } = view(b.id);
    expect(runs[0]).toMatchObject({ status: "failed", outcome: "needs_review" });
    expect(runs[0].error).toMatch(/password-protected/);
    const s = status(stages());
    expect(s.reading).toBe("failed");
    expect(s.checks).toBe("skipped");
    expect(s.routing).toBe("skipped");
  });

  it("stops before routing when checks fail", async () => {
    const { ctx, view } = await setup();
    const b = await createBillFromFile(ctx, { bytes: doc({ total_override: 99999 }), mime: "application/pdf", name: "bad.pdf" });
    await runExtraction(ctx, b.id);
    const s = status(view(b.id).stages());
    expect(s.checks).toBe("failed");
    expect(s.decision).toBe("warn");
    expect(s.routing).toBe("skipped");
  });

  it("shows the next stage as running while a run is in progress", async () => {
    const { ctx, store, view } = await setup();
    const b = await createBillFromFile(ctx, { bytes: doc(), mime: "application/pdf", name: "spi.pdf" });
    await runExtraction(ctx, b.id);
    const run = { ...store.db.extraction_runs.find((r) => r.bill_id === b.id)!, status: "running" as const, finished_at: null };
    const partial = store.db.trace_events.filter((t) => t.bill_id === b.id && (t.action === "Bill received" || t.action === "Reading document"));
    const s = status(stagesFromTraces(partial, run));
    expect(s.received).toBe("done");
    expect(s.reading).toBe("running");
    expect(s.vendor).toBe("pending");
  });

  it("records a re-read as a second run and keeps each run's stages separate", async () => {
    const { ctx, view } = await setup();
    const b = await createBillFromFile(ctx, { bytes: doc(), mime: "application/pdf", name: "spi.pdf", department: "Operations" });
    await runExtraction(ctx, b.id);
    await new Promise((r) => setTimeout(r, 5));
    await resetBill(ctx, b.id, "Priya Nair");
    const { runs, stages } = view(b.id);
    expect(runs.map((r) => r.source)).toEqual(["upload", "reset"]);
    expect(stages(1)[0].detail).toMatch(/Re-reading/);
    expect(status(stages(0)).routing).toBe("done");
  });

  it("labels the demo seed's runs as sample runs", async () => {
    const { store } = await setup();
    expect(store.db.extraction_runs.length).toBeGreaterThan(10);
    expect(new Set(store.db.extraction_runs.map((r) => r.source))).toEqual(new Set(["seed"]));
  });
});
