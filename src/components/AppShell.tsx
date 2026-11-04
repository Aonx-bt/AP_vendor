import type { ReactNode } from "react";
import { NavLink, useLocation, useSearchParams } from "react-router-dom";
import { Activity, Building2, ChevronDown, FileText, Home, Loader2, Settings, Sparkles } from "lucide-react";
import { Tip } from "./ui/tooltip";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "./ui/menu";
import { useData } from "@/lib/data";
import { PEOPLE, ROLE_LABEL, type Role } from "@shared/types.ts";
import { cn, initials } from "@/lib/utils";
import { BillDrawer } from "./BillDrawer";

const NAV = [
  { to: "/", label: "Home", icon: Home },
  { to: "/bills", label: "Bills", icon: FileText },
  { to: "/runs", label: "Runs", icon: Activity },
  { to: "/vendors", label: "Vendors", icon: Building2 },
  { to: "/settings", label: "Settings", icon: Settings },
];
const TITLES: Record<string, string> = { "/": "Home", "/bills": "Bills", "/runs": "Runs", "/vendors": "Vendors", "/settings": "Settings" };

export function AppShell({ children }: { children: ReactNode }) {
  const { role, setRole, person, backend, loading, error, db } = useData();
  const loc = useLocation();
  const [params, setParams] = useSearchParams();
  const billId = params.get("bill");

  return (
    <div className="flex h-full">
      <aside className="flex w-[60px] shrink-0 flex-col items-center gap-1 bg-sidebar py-3">
        <div className="mb-3 grid h-9 w-9 place-items-center rounded-lg bg-emerald-500/15 text-emerald-400">
          <Sparkles className="h-[18px] w-[18px]" />
        </div>
        {NAV.map((n) => (
          <Tip key={n.to} label={n.label}>
            <NavLink
              to={n.to}
              end={n.to === "/"}
              aria-label={n.label}
              className={({ isActive }) => cn("grid h-10 w-10 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-white/10 hover:text-white", isActive && "bg-white/10 text-white")}
            >
              <n.icon className="h-[18px] w-[18px]" />
            </NavLink>
          </Tip>
        ))}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
          <div className="flex items-center gap-3">
            <span className="text-[15px] font-semibold tracking-tight">AP Desk</span>
            <span className="text-slate-300">/</span>
            <span className="text-sm text-muted-foreground">{TITLES[loc.pathname] ?? ""}</span>
            {backend.mode === "demo" && (
              <Tip label="Data lives in this browser and agents run in simulated mode. Set VITE_SUPABASE_URL to use Supabase." side="bottom">
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-200">Demo mode</span>
              </Tip>
            )}
          </div>
          <Menu>
            <MenuTrigger className="flex items-center gap-2 rounded-lg border border-border py-1 pl-1 pr-2 text-sm hover:bg-muted">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-emerald-600 text-[11px] font-semibold text-white">{initials(person)}</span>
              <span className="text-left leading-tight">
                <span className="block text-[13px] font-medium">{person}</span>
                <span className="block text-[11px] text-muted-foreground">{ROLE_LABEL[role]}</span>
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </MenuTrigger>
            <MenuContent>
              <MenuLabel>Switch role (no login in this demo)</MenuLabel>
              {PEOPLE.map((p) => (
                <MenuItem key={p.role} onSelect={() => setRole(p.role as Role)} className={cn(p.role === role && "bg-muted")}>
                  <span className="grid h-6 w-6 place-items-center rounded-md bg-slate-100 text-[10px] font-semibold">{initials(p.name)}</span>
                  <span>
                    <span className="block">{p.title}</span>
                    <span className="block text-xs text-muted-foreground">{p.name}</span>
                  </span>
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
        </header>
        <main className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          {error ? (
            <div className="m-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">Could not load data: {error}</div>
          ) : loading || !db ? (
            <div className="grid h-64 place-items-center text-sm text-muted-foreground">
              <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</span>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
      {db && (
        <BillDrawer
          billId={billId}
          onClose={() => {
            params.delete("bill");
            setParams(params, { replace: true });
          }}
        />
      )}
    </div>
  );
}

/** Opens the bill drawer on top of any page. */
export function useOpenBill() {
  const [params, setParams] = useSearchParams();
  return (id: string) => {
    params.set("bill", id);
    setParams(params);
  };
}
