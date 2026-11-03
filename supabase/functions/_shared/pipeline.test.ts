import { describe, expect, it } from "vitest";
import { checkGstinFormat, gstinCheckChar } from "./gstin.ts";
import { MemoryStore } from "./store.ts";
import { buildDemo } from "./seed.ts";
import { SimulatedLLM } from "./llm.ts";
import { approvalAction, runValidation, saveBillEdits, type Ctx } from "./pipeline.ts";

describe("GSTIN", () => {
  it("computes the check character with the base-36 mod algorithm", () => {
    expect(gstinCheckChar("27AAPFU0939F1Z")).toBe("V");
    expect(gstinCheckChar("29AAGCB7383J1Z")).toBe("4");
  });
  it("rejects bad state code, PAN pattern and checksum", () => {
    expect(checkGstinFormat("27AAPFU0939F1ZV").ok).toBe(true);
    expect(checkGstinFormat("27AAPFU0939F1ZW").problems[0]).toMatch(/expected V/);
    expect(checkGstinFormat("45AAPFU0939F1ZV").problems.some((p) => p.includes("State code"))).toBe(true);
    expect(checkGstinFormat("27AAPF10939F1ZV").problems.some((p) => p.includes("PAN"))).toBe(true);
    expect(checkGstinFormat("27AAPFU0939").ok).toBe(false);
  });
});

async function demo() {
  const store = new MemoryStore();
  await buildDemo(store, new Date());
  const ctx: Ctx = { store, llm: new SimulatedLLM(), now: () => new Date() };
  const bill = (inv: string, status?: string) => store.db.bills.find((b) => b.invoice_no === inv && (!status || b.status === status))!;
  const result = (inv: string, key: string) => store.db.validation_results.find((r) => r.bill_id === bill(inv).id && r.check_key === key)!;
  return { store, ctx, bill, result };
}

describe("validation agent", () => {
  it("fails bank details that differ from the vendor master", async () => {
    const { bill, result } = await demo();
    expect(result("DLA/26/078", "bank_details").outcome).toBe("fail");
    expect(result("DLA/26/078", "bank_details").detail).toBe("Bank details differ from vendor master. Re-verify before paying.");
    expect(bill("DLA/26/078").status).toBe("needs_review");
  });
  it("never auto-passes an unverified master account", async () => {
    const { result } = await demo();
    expect(result("DLA/26/051", "bank_details").outcome).toBe("warn");
  });
  it("marks a re-sent invoice as duplicate", async () => {
    const { bill } = await demo();
    expect(bill("VME/1146", "duplicate")).toBeTruthy();
  });
  it("fails PO over remaining balance beyond tolerance", async () => {
    const { result } = await demo();
    const r = result("ICW/2026/1187", "po_match");
    expect(r.outcome).toBe("fail");
    expect(r.evidence.remaining).toBe(250000);
  });
  it("catches arithmetic off by more than ₹1, and re-validation routes once fixed", async () => {
    const { ctx, bill, result } = await demo();
    expect(result("ICW/2026/1203", "math_check").outcome).toBe("fail");
    await saveBillEdits(ctx, bill("ICW/2026/1203").id, { total: 42480 }, null, "Priya Nair");
    const b = await runValidation(ctx, bill("ICW/2026/1203").id);
    expect(b.status).toBe("in_approval");
  });
  it("sends a bill with missing GSTIN and date to needs_vendor_info", async () => {
    const { bill } = await demo();
    expect(bill("SPI/26-27/0419").status).toBe("needs_vendor_info");
  });
  it("fails a cancelled GSTIN from the simulated registry", async () => {
    const { result } = await demo();
    const r = result("KOS/2311", "gstin_status");
    expect(r.outcome).toBe("fail");
    expect(r.source).toBe("simulated_registry");
  });
});

describe("approval workflow", () => {
  it("enforces level order, role and comment rules", async () => {
    const { store, ctx, bill } = await demo();
    const id = bill("VME/1146", "in_approval").id;
    const l2 = store.db.approvals.find((a) => a.bill_id === id && a.level === 2)!;
    await expect(approvalAction(ctx, { approvalId: l2.id, action: "approve", actor: "Rahul Mehta" })).rejects.toThrow(/Only Anita Desai/);
    await expect(approvalAction(ctx, { approvalId: l2.id, action: "reject", actor: "Anita Desai" })).rejects.toThrow(/comment is required/);
    const done = await approvalAction(ctx, { approvalId: l2.id, action: "approve", actor: "Anita Desai" });
    expect(done.status).toBe("approved");
  });
  it("does not let level 2 act before level 1", async () => {
    const { store, ctx } = await demo();
    const inbox = store.db.emails.find((e) => e.subject.includes("VME/1159"))!;
    const { processEmail } = await import("./pipeline.ts");
    // free up PO balance so this bill routes to the two-level marketing rule
    const po = store.db.purchase_orders.find((p) => p.po_number === "PO-2026-0163")!;
    po.billed_amount = 0;
    const e = await processEmail(ctx, inbox.id);
    const l2 = store.db.approvals.find((a) => a.bill_id === e.bill_ids[0] && a.level === 2)!;
    expect(l2.status).toBe("waiting");
    await expect(approvalAction(ctx, { approvalId: l2.id, action: "approve", actor: "Anita Desai" })).rejects.toThrow(/not awaiting action/);
  });
});

describe("intake", () => {
  it("ignores instructions inside the document and records them", async () => {
    const { store, ctx } = await demo();
    const { processEmail } = await import("./pipeline.ts");
    const inbox = store.db.emails.find((e) => e.subject.includes("VME/1159"))!;
    const e = await processEmail(ctx, inbox.id);
    const b = store.db.bills.find((x) => x.id === e.bill_ids[0])!;
    expect(b.status).not.toBe("approved");
    expect(store.db.trace_events.some((t) => t.bill_id === b.id && t.action === "Ignored instructions in document")).toBe(true);
  });
  it("routes only invoices to extraction and flags missing or unsupported attachments", async () => {
    const { store, ctx } = await demo();
    const { processEmail } = await import("./pipeline.ts");
    const out: Record<string, string> = {};
    for (const e of store.db.emails.filter((x) => !x.processed)) {
      const r = await processEmail(ctx, e.id);
      out[r.subject] = `${r.classification}|${r.flag ? "flag" : ""}|${r.bill_ids.length}`;
    }
    expect(out["Credit Note CN/26/014 against SPI/26-27/0398"]).toBe("credit_note||0");
    expect(out["Your invoice for October services"]).toBe("invoice|flag|0");
    expect(out["Invoice bundle for October events"]).toBe("invoice|flag|0");
    expect(out["Invoices SPI/26-27/0425 and SPI/26-27/0426"]).toBe("invoice||2");
    const locked = store.db.bills.find((b) => b.file_name === "KOS-2318.pdf")!;
    expect(locked.status).toBe("needs_review");
  });
  it("does not create a second bill when the same email is processed again", async () => {
    const { store, ctx } = await demo();
    const { processEmail } = await import("./pipeline.ts");
    const e = store.db.emails.find((x) => x.subject.startsWith("Invoice NFC/1102"))!;
    await processEmail(ctx, e.id);
    const n = store.db.bills.length;
    store.db.emails.find((x) => x.id === e.id)!.processed = false; // simulate crash before marking processed
    await processEmail(ctx, e.id);
    expect(store.db.bills.length).toBe(n);
  });
});
