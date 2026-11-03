import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Bill, Role, Vendor } from "@shared/types.ts";
import { PEOPLE } from "@shared/types.ts";
import type { DB } from "@shared/store.ts";
import { createBackend, type Backend, type LedgerRow } from "./backend";
import { todayIso } from "./utils";

interface DataState {
  backend: Backend;
  db: DB | null;
  ledger: LedgerRow[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  role: Role;
  setRole: (r: Role) => void;
  person: string;
}

const Ctx = createContext<DataState | null>(null);
const backend = createBackend();

export function DataProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<DB | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [role, setRoleState] = useState<Role>(() => {
    try {
      return (localStorage.getItem("apdesk.role") as Role) || "ap_clerk";
    } catch {
      return "ap_clerk";
    }
  });
  const setRole = (r: Role) => {
    setRoleState(r);
    try {
      localStorage.setItem("apdesk.role", r);
    } catch { /* ignore */ }
  };
  const refresh = useCallback(async () => {
    try {
      const r = await backend.load();
      setDb(r.db);
      setLedger(r.ledger);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    refresh();
    if (backend.mode === "supabase") {
      const t = setInterval(refresh, 20000);
      return () => clearInterval(t);
    }
  }, [refresh]);
  const person = PEOPLE.find((p) => p.role === role)!.name;
  return <Ctx.Provider value={{ backend, db, ledger, loading, error, refresh, role, setRole, person }}>{children}</Ctx.Provider>;
}

export function useData() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useData outside provider");
  return c;
}

// ------------------------------------------------------------------ derived views

export const OPEN = (b: Bill) => !b.paid_at && b.status !== "rejected" && b.status !== "duplicate";
export const isOverdue = (b: Bill) => OPEN(b) && !!b.due_date && b.due_date < todayIso();

export type BillTab = "needs_review" | "my_approvals" | "waiting_vendor" | "all" | "rejected";

export function useDerived() {
  const { db, role, ledger } = useData();
  return useMemo(() => {
    if (!db) return null;
    const vendorById = new Map<string, Vendor>(db.vendors.map((v) => [v.id, v]));
    const myPendingBillIds = new Set(db.approvals.filter((a) => a.status === "pending" && a.approver_role === role).map((a) => a.bill_id));
    const failedBillIds = new Set(db.validation_results.filter((r) => r.outcome === "fail").map((r) => r.bill_id));
    const tabFilter: Record<BillTab, (b: Bill) => boolean> = {
      needs_review: (b) => b.status === "needs_review" || b.status === "received",
      my_approvals: (b) => b.status === "in_approval" && myPendingBillIds.has(b.id),
      waiting_vendor: (b) => b.status === "needs_vendor_info",
      all: () => true,
      rejected: (b) => b.status === "rejected" || b.status === "duplicate",
    };
    const counts = Object.fromEntries(Object.entries(tabFilter).map(([k, f]) => [k, db.bills.filter(f).length])) as Record<BillTab, number>;

    // vendor health: red if any open bill has a failing check or GSTIN cancelled; amber on warnings
    const health = new Map<string, "green" | "amber" | "red">();
    for (const v of db.vendors) {
      const open = db.bills.filter((b) => b.vendor_id === v.id && OPEN(b)).map((b) => b.id);
      const res = db.validation_results.filter((r) => open.includes(r.bill_id));
      health.set(v.id, v.gstin_status === "cancelled" || res.some((r) => r.outcome === "fail") ? "red" : res.some((r) => r.outcome === "warn") || !v.bank_verified ? "amber" : "green");
    }
    const ledgerBy = new Map(ledger.map((l) => [l.vendor_id, l]));
    return { vendorById, tabFilter, counts, failedBillIds, health, ledgerBy, myPendingBillIds };
  }, [db, role, ledger]);
}
