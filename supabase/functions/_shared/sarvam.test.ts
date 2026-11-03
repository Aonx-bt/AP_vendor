import { describe, expect, it } from "vitest";
import { mapSarvamResult, SarvamExtractor, toIsoDate, toNumber } from "./sarvam.ts";

describe("Sarvam value normalisation", () => {
  it("reads Indian date formats day-first", () => {
    expect(toIsoDate("15/03/2026")).toBe("2026-03-15");
    expect(toIsoDate("5-3-26")).toBe("2026-03-05");
    expect(toIsoDate("15 Mar 2026")).toBe("2026-03-15");
    expect(toIsoDate("1st Sept, 2026")).toBe("2026-09-01");
    expect(toIsoDate("2026-03-15")).toBe("2026-03-15");
    expect(toIsoDate("")).toBeNull();
    expect(toIsoDate("next week")).toBeNull();
  });
  it("reads rupee amounts with Indian grouping", () => {
    expect(toNumber("₹26,73,532.00")).toBe(2673532);
    expect(toNumber("Rs. 1,18,000")).toBe(118000);
    expect(toNumber(450.5)).toBe(450.5);
    expect(toNumber("18%")).toBe(18);
    expect(toNumber("")).toBeNull();
    expect(toNumber("N/A")).toBeNull();
  });
});

describe("mapSarvamResult", () => {
  const result = {
    vendor_name: "Sahyadri Packaging Industries",
    vendor_gstin: "27abdfs3147k1zy ",
    invoice_no: "SPI/26-27/0412",
    invoice_date: "21/10/2026",
    due_date: "",
    bank_account_number: "50100234124821",
    ifsc: "hdfc0001298",
    line_items: [
      { description: "Corrugated boxes", hsn_sac: "48191010", qty: 600, rate: "125", gst_pct: 18, amount_excl_gst: "75,000.00" },
      { description: "", hsn_sac: "", qty: null, rate: null, gst_pct: null, amount_excl_gst: null },
    ],
    subtotal: "75,000.00",
    cgst: 6750,
    sgst: 6750,
    igst: "",
    total: "88,500.00",
    instructions_to_reader: "",
  };
  it("maps fields, converts formats and treats empty as not found", () => {
    const m = mapSarvamResult(result, {});
    expect(m.fields.vendor_gstin).toBe("27ABDFS3147K1ZY");
    expect(m.fields.invoice_date).toBe("2026-10-21");
    expect(m.fields.due_date).toBeNull();
    expect(m.fields.bank_account_last4).toBe("4821");
    expect(m.fields.ifsc).toBe("HDFC0001298");
    expect(m.fields.igst).toBeNull();
    expect(m.fields.total).toBe(88500);
    expect(m.fields.line_items).toHaveLength(1);
    expect(m.fields.line_items[0].amount_excl_gst).toBe(75000);
    expect(m.fields.suspicious_instructions).toBeNull();
    expect(m.confidenceSource).toBe("default");
    expect(m.confidence.invoice_no).toBe(0.9);
    expect(m.confidence.due_date).toBe(1);
  });
  it("uses Sarvam's per-field confidence when annotations carry it", () => {
    const m = mapSarvamResult(result, {
      invoice_no: { confidence: 0.98, sources: [] },
      bank_account_number: { confidence: 0.62, sources: [] },
      line_items: [{ description: { confidence: 0.95 }, amount_excl_gst: { confidence: 0.7 } }],
    });
    expect(m.confidenceSource).toBe("sarvam");
    expect(m.confidence.invoice_no).toBe(0.98);
    expect(m.confidence.bank_account_last4).toBe(0.62);
    expect(m.confidence.line_items).toBe(0.7);
  });
});

describe("SarvamExtractor job flow", () => {
  it("submits, polls until completed and fetches results", async () => {
    const calls: string[] = [];
    let polls = 0;
    const fetchFn = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url.replace("https://api.sarvam.ai/doc-ai/v1/job", "")}`);
      expect((init?.headers as Record<string, string>)["api-subscription-key"]).toBe("test-key");
      if (url.endsWith("/extract")) {
        const body = init!.body as FormData;
        expect(JSON.parse(String(body.get("schema"))).properties.vendor_gstin.type).toBe("string");
        return new Response(JSON.stringify({ job_id: "job_1", status: "queued", run_id: "r1" }));
      }
      if (url.endsWith("/status")) return new Response(JSON.stringify({ job_id: "job_1", status: ++polls < 2 ? "processing" : "completed" }));
      return new Response(JSON.stringify({ type: "extract", status: "completed", result: { invoice_no: "INV-9", total: "1,000" }, annotations: {} }));
    }) as unknown as typeof fetch;
    const ex = new SarvamExtractor({ apiKey: "test-key", fetchFn, sleep: async () => {} });
    const r = await ex.extractInvoice({ bytes: new Uint8Array([37, 80, 68, 70]), mime: "application/pdf", name: "a.pdf" });
    expect(calls).toEqual(["POST /extract", "GET /job_1/status", "GET /job_1/status", "GET /job_1/results?format=json"]);
    expect(r.fields.invoice_no).toBe("INV-9");
    expect(r.fields.total).toBe(1000);
    expect(r.engine).toBe("sarvam-vision");
    expect(r.details?.job_id).toBe("job_1");
  });
  it("turns API errors into readable messages", async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Invalid API key" } }), { status: 403 })) as unknown as typeof fetch;
    const ex = new SarvamExtractor({ apiKey: "bad", fetchFn, sleep: async () => {} });
    await expect(ex.extractInvoice({ bytes: new Uint8Array(), mime: "application/pdf", name: "a.pdf" })).rejects.toThrow(/Sarvam 403: UNAUTHORIZED: Invalid API key\. Check SARVAM_API_KEY/);
  });
  it("reports a failed job", async () => {
    const fetchFn = (async (url: string) =>
      url.endsWith("/extract") ? new Response(JSON.stringify({ job_id: "j2" })) : new Response(JSON.stringify({ status: "failed" }))) as unknown as typeof fetch;
    const ex = new SarvamExtractor({ apiKey: "k", fetchFn, sleep: async () => {} });
    await expect(ex.extractInvoice({ bytes: new Uint8Array(), mime: "application/pdf", name: "a.pdf" })).rejects.toThrow(/could not read this document \(job j2 failed\)/);
  });
});
