import { describe, expect, it } from "vitest";
import { GmailAuth, K, REVOKED_MESSAGE } from "./gmailAuth.ts";
import { MemorySecretStore } from "./secrets.ts";
import { syncGmailOnce, type GmailReader } from "./gmailSync.ts";
import { MemoryStore } from "./store.ts";
import { buildDemo } from "./seed.ts";
import { SimulatedLLM } from "./llm.ts";
import { renderInvoicePdf } from "./pdf.ts";
import type { Ctx, IncomingEmail } from "./pipeline.ts";

const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe("Gmail sign-in", () => {
  it("is not configured without client id/secret, and not connected without a permission", async () => {
    const secrets = new MemorySecretStore();
    expect((await new GmailAuth({ secrets }).status())).toMatchObject({ configured: false, connected: false });
    const a = new GmailAuth({ clientId: "id", clientSecret: "s", secrets });
    expect(await a.connected()).toBe(false);
    await secrets.set(K.token, "rt");
    expect(await a.connected()).toBe(true);
    expect(await new GmailAuth({ clientId: "id", clientSecret: "s", envRefreshToken: "env-rt", secrets: new MemorySecretStore() }).connected()).toBe(true);
  });

  it("builds Google's consent link for offline Gmail access", () => {
    const u = new URL(new GmailAuth({ clientId: "cid", clientSecret: "s", secrets: new MemorySecretStore() }).consentUrl("https://x.supabase.co/functions/v1/gmail-oauth", "st8"));
    expect(u.origin).toBe("https://accounts.google.com");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect(u.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/gmail.modify");
    expect(u.searchParams.get("state")).toBe("st8");
  });

  it("stores the permission and inbox address after Google's redirect", async () => {
    const secrets = new MemorySecretStore();
    await secrets.set(K.error, "old error");
    const fetchFn = (async (url: string) =>
      url.includes("oauth2") ? res(200, { access_token: "at", refresh_token: "rt", expires_in: 3600 }) : res(200, { emailAddress: "ap.test@gmail.com" })) as unknown as typeof fetch;
    const a = new GmailAuth({ clientId: "id", clientSecret: "s", secrets, fetchFn });
    expect(await a.exchangeCode("code", "https://r")).toEqual({ address: "ap.test@gmail.com" });
    expect(await secrets.get(K.token)).toBe("rt");
    expect(await secrets.get(K.error)).toBeNull();
    expect(await a.status()).toMatchObject({ connected: true, address: "ap.test@gmail.com" });
  });

  it("forgets a revoked permission and says what to do", async () => {
    const secrets = new MemorySecretStore();
    await secrets.set(K.token, "rt");
    const fetchFn = (async () => res(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." })) as unknown as typeof fetch;
    const a = new GmailAuth({ clientId: "id", clientSecret: "s", secrets, fetchFn });
    await expect(a.accessToken()).rejects.toThrow(REVOKED_MESSAGE);
    expect(await secrets.get(K.token)).toBeNull();
    expect(await a.status()).toMatchObject({ connected: false, error: REVOKED_MESSAGE });
  });
});

describe("inbox checker", () => {
  it("records every new email, processes at most 3 per run, and picks up the rest next run", async () => {
    const store = new MemoryStore();
    await buildDemo(store, new Date());
    const ctx: Ctx = { store, llm: new SimulatedLLM(), now: () => new Date() };
    const secrets = new MemorySecretStore();
    const pdf = (n: number) => renderInvoicePdf({
      vendor: { name: "Sahyadri Packaging Industries", address: "Pune", gstin: "27ABDFS3147K1ZY", pan: "ABDFS3147K" },
      buyer: { name: "Kaveri Polymers Pvt Ltd", address: "Pune", gstin: "27AAHCK4821M1Z7" },
      invoice_no: `SPI/GM/${n}`, invoice_date: new Date().toISOString().slice(0, 10), payment_terms: "Net 30",
      bank: { name: "HDFC Bank", account: "50100234124821", ifsc: "HDFC0001298" }, cgst: 90 * n, sgst: 90 * n,
      lines: [{ description: `Boxes lot ${n}`, hsn_sac: "48191010", qty: n, rate: 1000, gst_pct: 18 }],
    });
    const mails: IncomingEmail[] = [1, 2, 3, 4, 5].map((n) => ({
      message_id: `<gm-${n}@sahyadripack.in>`, source: "gmail", from_address: "accounts@sahyadripack.in", subject: `Invoice SPI/GM/${n}`,
      body_text: "Please find our invoice attached.", received_at: new Date(Date.now() - (10 - n) * 60000).toISOString(), in_reply_to: null, thread_id: `t${n}`,
      attachments: [{ filename: `SPI-GM-${n}.pdf`, mime: "application/pdf", bytes: pdf(n) }],
    }));
    const reader: GmailReader = { listRecentMessageIds: async () => mails.map((_, i) => `id${i}`), fetchMessage: async (id) => mails[Number(id.slice(2))] };

    const r1 = await syncGmailOnce(ctx, reader, secrets);
    expect(r1).toMatchObject({ recorded: 5, processed: 3, remaining: 2, errors: [] });
    expect(await secrets.get(K.lastSync)).toBeTruthy();
    const r2 = await syncGmailOnce(ctx, reader, secrets);
    expect(r2).toMatchObject({ recorded: 0, processed: 2, remaining: 0 });
    const bills = store.db.bills.filter((b) => b.invoice_no?.startsWith("SPI/GM/"));
    expect(bills).toHaveLength(5);
    expect(store.db.extraction_runs.filter((r) => bills.some((b) => b.id === r.bill_id)).every((r) => r.source === "email")).toBe(true);
    const r3 = await syncGmailOnce(ctx, reader, secrets);
    expect(r3).toMatchObject({ recorded: 0, processed: 0 });
  });
});
