import { AlertTriangle, CheckCircle2, Loader2, MinusCircle, XCircle } from "lucide-react";
import type { Bill, Outcome } from "@shared/types.ts";
import { cn, initials } from "@/lib/utils";

const STATUS: Record<string, { label: string; cls: string }> = {
  received: { label: "Draft", cls: "bg-slate-100 text-slate-700 ring-slate-200" },
  needs_vendor_info: { label: "Needs info", cls: "bg-amber-50 text-amber-800 ring-amber-200" },
  needs_review: { label: "Needs review", cls: "bg-orange-50 text-orange-800 ring-orange-200" },
  in_approval: { label: "In approval", cls: "bg-blue-50 text-blue-700 ring-blue-200" },
  approved: { label: "Approved", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  paid: { label: "Paid", cls: "bg-emerald-600 text-white ring-emerald-600" },
  rejected: { label: "Rejected", cls: "bg-red-50 text-red-700 ring-red-200" },
  duplicate: { label: "Duplicate", cls: "bg-red-50 text-red-700 ring-red-200" },
};

export function StatusChip({ bill, className }: { bill: Pick<Bill, "status" | "paid_at">; className?: string }) {
  const key = bill.paid_at ? "paid" : bill.status;
  const s = STATUS[key];
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", s.cls, className)}>
      {key === "received" && <Loader2 className="h-3 w-3 animate-spin" />}
      {s.label}
    </span>
  );
}

const AV = ["bg-emerald-100 text-emerald-800", "bg-sky-100 text-sky-800", "bg-violet-100 text-violet-800", "bg-amber-100 text-amber-800", "bg-rose-100 text-rose-800", "bg-teal-100 text-teal-800"];
export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const i = [...name].reduce((s, c) => s + c.charCodeAt(0), 0) % AV.length;
  return <span className={cn("grid shrink-0 place-items-center rounded-lg font-semibold", AV[i], size === "sm" ? "h-6 w-6 text-[10px]" : "h-8 w-8 text-xs")}>{initials(name) || "?"}</span>;
}

export function OutcomeIcon({ o, className }: { o: Outcome; className?: string }) {
  const c = cn("h-4 w-4 shrink-0", className);
  if (o === "pass") return <CheckCircle2 className={cn(c, "text-emerald-600")} />;
  if (o === "warn") return <AlertTriangle className={cn(c, "text-amber-500")} />;
  if (o === "fail") return <XCircle className={cn(c, "text-red-600")} />;
  return <MinusCircle className={cn(c, "text-slate-400")} />;
}

export function HealthDot({ h }: { h: "green" | "amber" | "red" }) {
  const map = { green: ["bg-emerald-500", "Healthy"], amber: ["bg-amber-400", "Warnings"], red: ["bg-red-500", "Validation failed"] } as const;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-700">
      <span className={cn("h-2 w-2 rounded-full", map[h][0])} />
      {map[h][1]}
    </span>
  );
}

export function SimBadge() {
  return <span className="rounded bg-violet-50 px-1.5 py-px text-[10px] font-medium text-violet-700 ring-1 ring-inset ring-violet-200">Simulated registry</span>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-6 py-14 text-center text-sm text-muted-foreground">{children}</div>;
}
