import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/ui/card";
import { OPEN, isOverdue, useData, useDerived } from "@/lib/data";
import { inr, inrShort, todayIso } from "@/lib/utils";
import { ROLE_LABEL } from "@shared/types.ts";
import { daysBetween } from "@shared/util.ts";

function Stat({ label, value, to, tone = "default" }: { label: string; value: number; to: string; tone?: "default" | "red" }) {
  return (
    <Link to={to} className="group flex-1 rounded-lg px-3 py-2 transition-colors hover:bg-muted">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-center gap-1">
        <span className={`text-2xl font-semibold tabular ${tone === "red" && value ? "text-red-600" : ""}`}>{value}</span>
        <ArrowUpRight className="h-4 w-4 text-slate-300 transition-colors group-hover:text-slate-600" />
      </div>
    </Link>
  );
}

export default function Home() {
  const { db, role, person } = useData();
  const d = useDerived();
  if (!db || !d) return null;

  const open = db.bills.filter(OPEN);
  const today = todayIso();
  const overdue = open.filter(isOverdue);
  const dueSoon = open.filter((b) => b.due_date && b.due_date >= today && daysBetween(today, b.due_date) <= 7);
  const sum = (xs: typeof open) => xs.reduce((s, b) => s + (b.total ?? 0), 0);
  const vendorsFailed = [...d.health.values()].filter((h) => h === "red").length;

  const buckets = [
    { name: "0-30", lo: 0, hi: 30 },
    { name: "31-60", lo: 31, hi: 60 },
    { name: "61-90", lo: 61, hi: 90 },
    { name: "90+", lo: 91, hi: 1e9 },
  ].map((b) => {
    const xs = open.filter((x) => {
      const age = x.invoice_date ? daysBetween(x.invoice_date, today) : 0;
      return age >= b.lo && age <= b.hi;
    });
    return { name: b.name, amount: sum(xs), count: xs.length };
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Good {new Date().getHours() < 12 ? "morning" : "afternoon"}, {person.split(" ")[0]}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Signed in as {ROLE_LABEL[role]}. Here is what needs attention.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4 md:col-span-1">
          <div className="mb-2 px-3 text-sm font-semibold">Bills</div>
          <div className="flex">
            <Stat label="My Approvals" value={d.counts.my_approvals} to="/bills?tab=my_approvals" />
            <Stat label="Needs Review" value={d.counts.needs_review} to="/bills?tab=needs_review" />
            <Stat label="Waiting on Vendor" value={d.counts.waiting_vendor} to="/bills?tab=waiting_vendor" />
          </div>
        </Card>
        <Card className="p-4">
          <div className="mb-2 px-3 text-sm font-semibold">Vendors</div>
          <div className="flex">
            <Stat label="Validation failed" value={vendorsFailed} to="/bills?tab=all&filter=failed" tone="red" />
          </div>
        </Card>
        <Card className="p-4">
          <div className="mb-2 px-3 text-sm font-semibold">Overdue</div>
          <div className="flex">
            <Stat label="Overdue bills" value={overdue.length} to="/bills?tab=all&filter=overdue" tone="red" />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {[
          { label: "Total Payable", value: sum(open), sub: `${open.length} open bills` },
          { label: "Overdue amount", value: sum(overdue), sub: `${overdue.length} bills past due`, red: true },
          { label: "Due in next 7 days", value: sum(dueSoon), sub: `${dueSoon.length} bills` },
        ].map((t) => (
          <Card key={t.label} className="p-5">
            <div className="text-xs text-muted-foreground">{t.label}</div>
            <div className={`mt-1.5 text-2xl font-semibold tabular tracking-tight ${t.red && t.value ? "text-red-600" : ""}`}>{inr(t.value)}</div>
            <div className="mt-1 text-xs text-muted-foreground">{t.sub}</div>
          </Card>
        ))}
      </div>

      <Card className="p-5">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-sm font-semibold">Payables aging</div>
            <div className="text-xs text-muted-foreground">Open bills by days since invoice date</div>
          </div>
        </div>
        <div className="mt-4 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={buckets} margin={{ left: 8, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} stroke="hsl(220 16% 93%)" />
              <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#64748b" }} tickFormatter={(v) => `${v} days`} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#64748b" }} tickFormatter={(v) => (v ? inrShort(v) : "0")} width={72} />
              <Tooltip
                cursor={{ fill: "hsl(152 76% 96%)" }}
                formatter={(v: number, _n, p) => [`${inr(v)} · ${(p.payload as { count: number }).count} bills`, "Open"]}
                labelFormatter={(l) => `${l} days`}
                contentStyle={{ borderRadius: 10, border: "1px solid hsl(220 16% 91%)", fontSize: 12 }}
              />
              <Bar dataKey="amount" fill="#059669" radius={[6, 6, 0, 0]} maxBarSize={64} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
