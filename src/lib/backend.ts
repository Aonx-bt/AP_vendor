import { createClient } from "@supabase/supabase-js";
import type { Bill, BillLine, ApprovalRule, VendorMessage, Email } from "@shared/types.ts";
import { MemoryStore, SupabaseStore, emptyDB, type DB, type Store } from "@shared/store.ts";
import { SimulatedLLM } from "@shared/llm.ts";
import { buildDemo } from "@shared/seed.ts";
import * as P from "@shared/pipeline.ts";
import { fromBase64, toBase64 } from "@shared/util.ts";
import { supabaseOrigin } from "./supabaseUrl";

export interface LedgerRow {
  vendor_id: string;
  outstanding_balance: number;
  next_due_date: string | null;
  overdue_amount: number;
  open_bills: number;
}

export interface Backend {
  mode: "demo" | "supabase";
  load(): Promise<{ db: DB; ledger: LedgerRow[] }>;
  fileUrl(path: string): Promise<string | null>;
  uploadBill(file: File, department: string | null, actor: string, onCreated?: (billId: string) => void): Promise<Bill>;
  saveBill(billId: string, patch: Partial<Bill>, lines: Partial<BillLine>[] | null, actor: string): Promise<void>;
  revalidate(billId: string, actor: string): Promise<void>;
  resetBill(billId: string, actor: string): Promise<void>;
  override(billId: string, actor: string, comment: string): Promise<void>;
  markPaid(billId: string, actor: string): Promise<void>;
  createVendorFromBill(billId: string, actor: string): Promise<void>;
  approval(approvalId: string, action: P.ApprovalActionKind, actor: string, comment: string): Promise<void>;
  draftVendorEmail(billId: string, actor: string): Promise<VendorMessage>;
  sendVendorEmail(messageId: string, edits: { to_address: string; subject: string; body: string }, actor: string): Promise<{ simulated: boolean }>;
  markVendorReply(billId: string, actor: string): Promise<void>;
  processEmail(emailId: string): Promise<Email>;
  syncGmail(): Promise<{ connected: boolean; recorded?: number; processed?: number; message?: string; errors?: string[] }>;
  saveRule(rule: Partial<ApprovalRule>): Promise<void>;
  deleteRule(id: string): Promise<void>;
  resetDemo(): Promise<void>;
}

/** Same SQL view semantics as vendor_ledger, for demo mode. */
export function computeLedger(db: DB, today = new Date()): LedgerRow[] {
  const t = today.toISOString().slice(0, 10);
  return db.vendors.map((v) => {
    const bills = db.bills.filter((b) => b.vendor_id === v.id);
    const open = bills.filter((b) => !b.paid_at && b.status !== "rejected" && b.status !== "duplicate");
    const dues = open.map((b) => b.due_date).filter(Boolean).sort() as string[];
    return {
      vendor_id: v.id,
      outstanding_balance: bills.filter((b) => b.status === "approved" && !b.paid_at).reduce((s, b) => s + (b.total ?? 0), 0),
      next_due_date: dues[0] ?? null,
      overdue_amount: open.filter((b) => b.due_date && b.due_date < t).reduce((s, b) => s + (b.total ?? 0), 0),
      open_bills: open.length,
    };
  });
}

// ------------------------------------------------------------------ demo mode

const KEY = "apdesk.demo.v1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function persist(store: MemoryStore) {
  try {
    const files: Record<string, { mime: string; b64: string }> = {};
    for (const [k, v] of store.files) files[k] = { mime: v.mime, b64: toBase64(v.bytes) };
    localStorage.setItem(KEY, JSON.stringify({ db: store.db, files }));
  } catch {
    /* storage full or blocked: keep in memory */
  }
}
function restore(): MemoryStore | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    const files = new Map(Object.entries(j.files as Record<string, { mime: string; b64: string }>).map(([k, v]) => [k, { mime: v.mime, bytes: fromBase64(v.b64) }]));
    return new MemoryStore({ ...emptyDB(), ...j.db }, files);
  } catch {
    return null;
  }
}

export function createDemoBackend(): Backend {
  let store: MemoryStore | null = null;
  const urls = new Map<string, string>();
  const ready = async () => {
    if (store) return store;
    store = restore();
    if (!store) {
      store = new MemoryStore();
      await buildDemo(store, new Date());
      persist(store);
    }
    return store;
  };
  const ctx = async (): Promise<P.Ctx> => ({ store: await ready(), llm: new SimulatedLLM(), now: () => new Date() });
  const run = async <T,>(f: (c: P.Ctx) => Promise<T>) => {
    const c = await ctx();
    const out = await f(c);
    persist(c.store as MemoryStore);
    return out;
  };

  return {
    mode: "demo",
    async load() {
      const s = await ready();
      return { db: structuredClone(s.db), ledger: computeLedger(s.db) };
    },
    async fileUrl(path) {
      const s = await ready();
      if (urls.has(path)) return urls.get(path)!;
      const f = s.files.get(path);
      if (!f) return null;
      const u = URL.createObjectURL(new Blob([f.bytes as BlobPart], { type: f.mime }));
      urls.set(path, u);
      return u;
    },
    async uploadBill(file, department, actor, onCreated) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const bill = await run((c) => P.createBillFromFile(c, { bytes, mime: file.type || "application/octet-stream", name: file.name, department, actor }));
      onCreated?.(bill.id);
      await sleep(1400); // simulated reading time so the "Reading invoice…" state is visible
      return run((c) => P.runExtraction(c, bill.id));
    },
    saveBill: (id, patch, lines, actor) => run((c) => P.saveBillEdits(c, id, patch, lines, actor)).then(() => {}),
    revalidate: (id, actor) => run((c) => P.runValidation(c, id, actor)).then(() => {}),
    resetBill: (id, actor) => run((c) => P.resetBill(c, id, actor)).then(() => {}),
    override: (id, actor, comment) => run((c) => P.sendToApprovalOverride(c, id, actor, comment)).then(() => {}),
    markPaid: (id, actor) => run((c) => P.markPaid(c, id, actor)).then(() => {}),
    createVendorFromBill: (id, actor) => run((c) => P.createVendorFromBill(c, id, actor)).then(() => {}),
    approval: (approvalId, action, actor, comment) => run((c) => P.approvalAction(c, { approvalId, action, actor, comment })).then(() => {}),
    draftVendorEmail: (id, actor) => run(async (c) => { await sleep(700); return P.draftVendorEmail(c, id, actor); }),
    sendVendorEmail: (mid, edits, actor) => run((c) => P.sendVendorMessage(c, mid, edits, actor)).then((r) => ({ simulated: r.simulated })),
    markVendorReply: (id, actor) => run((c) => P.markVendorReply(c, id, actor)).then(() => {}),
    processEmail: (id) => run(async (c) => { await sleep(900); return P.processEmail(c, id); }),
    async syncGmail() {
      return { connected: false, message: "Demo mode: Gmail is not connected. Use the Simulated inbox." };
    },
    saveRule: (rule) =>
      run(async (c) => {
        if (rule.id) await c.store.update("approval_rules", rule.id, rule);
        else await c.store.insert("approval_rules", rule);
      }),
    deleteRule: (id) => run((c) => c.store.remove("approval_rules", { id })),
    async resetDemo() {
      for (const u of urls.values()) URL.revokeObjectURL(u);
      urls.clear();
      store = new MemoryStore();
      await buildDemo(store, new Date());
      persist(store);
    },
  };
}

// ------------------------------------------------------------------ Supabase mode

export function createSupabaseBackend(url: string, anon: string): Backend {
  const sb = createClient(url, anon);
  const store: Store = new SupabaseStore(sb);
  const fn = async <T,>(name: string, body: Record<string, unknown>): Promise<T> => {
    const { data, error } = await sb.functions.invoke(name, { body });
    if (error) {
      let msg = error.message;
      try {
        const j = await (error as { context?: Response }).context?.json();
        if (j?.error) msg = j.error;
      } catch { /* keep message */ }
      throw new Error(msg);
    }
    if (data?.error) throw new Error(data.error);
    return data as T;
  };
  const tables = ["vendors", "purchase_orders", "bills", "bill_lines", "validation_results", "approval_rules", "approvals", "trace_events", "emails", "vendor_messages"] as const;

  return {
    mode: "supabase",
    async load() {
      const db = emptyDB();
      const results = await Promise.all(tables.map((t) => store.list(t)));
      tables.forEach((t, i) => ((db as Record<string, unknown[]>)[t] = results[i]));
      const { data: ledger, error } = await sb.from("vendor_ledger").select("*");
      if (error) throw new Error(error.message);
      return { db, ledger: (ledger ?? []).map((r) => ({ ...r, outstanding_balance: Number(r.outstanding_balance), overdue_amount: Number(r.overdue_amount), open_bills: Number(r.open_bills) })) };
    },
    async fileUrl(path) {
      return sb.storage.from("invoices").getPublicUrl(path).data.publicUrl;
    },
    async uploadBill(file, department, actor) {
      const data = toBase64(new Uint8Array(await file.arrayBuffer()));
      const r = await fn<{ bill: Bill }>("bill-actions", { op: "upload", data, mime: file.type, name: file.name, department, actor });
      return r.bill;
    },
    saveBill: (bill_id, patch, lines, actor) => fn("bill-actions", { op: "save", bill_id, patch, lines, actor }).then(() => {}),
    revalidate: (bill_id, actor) => fn("validate-bill", { bill_id, actor }).then(() => {}),
    resetBill: (bill_id, actor) => fn("bill-actions", { op: "reset", bill_id, actor }).then(() => {}),
    override: (bill_id, actor, comment) => fn("bill-actions", { op: "override", bill_id, actor, comment }).then(() => {}),
    markPaid: (bill_id, actor) => fn("bill-actions", { op: "paid", bill_id, actor }).then(() => {}),
    createVendorFromBill: (bill_id, actor) => fn("bill-actions", { op: "new_vendor", bill_id, actor }).then(() => {}),
    approval: (approval_id, action, actor, comment) => fn("approval-action", { approval_id, action, actor, comment }).then(() => {}),
    draftVendorEmail: (bill_id, actor) => fn<{ message: VendorMessage }>("vendor-followup", { op: "draft", bill_id, actor }).then((r) => r.message),
    sendVendorEmail: (message_id, edits, actor) => fn<{ simulated: boolean }>("vendor-followup", { op: "send", message_id, edits, actor }),
    markVendorReply: (bill_id, actor) => fn("vendor-followup", { op: "reply", bill_id, actor }).then(() => {}),
    processEmail: (email_id) => fn<{ email: Email }>("process-email", { email_id }).then((r) => r.email),
    syncGmail: () => fn("sync-gmail", {}),
    async saveRule(rule) {
      if (rule.id) await store.update("approval_rules", rule.id, rule);
      else await store.insert("approval_rules", rule);
    },
    deleteRule: (id) => store.remove("approval_rules", { id }),
    resetDemo: () => fn("reset-demo", {}).then(() => {}),
  };
}

export function createBackend(): Backend {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  return url && anon ? createSupabaseBackend(supabaseOrigin(url), anon.trim()) : createDemoBackend();
}
