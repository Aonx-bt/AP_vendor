import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, Database, Loader2, Mail, Paperclip, Pencil, Play, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger, CountPill } from "@/components/ui/tabs";
import { Card, SectionTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, NativeSelect } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Avatar, Empty, StatusChip } from "@/components/bits";
import { useOpenBill } from "@/components/AppShell";
import { useData } from "@/lib/data";
import { cn, timeOf } from "@/lib/utils";
import { describeCondition } from "@shared/pipeline.ts";
import { DEPARTMENTS, PEOPLE, ROLE_LABEL, type ApprovalRule, type Condition, type Email, type Level } from "@shared/types.ts";

export default function Settings() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "rules";
  const { db } = useData();
  const unprocessed = db?.emails.filter((e) => !e.processed).length ?? 0;
  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="mb-4 text-xl font-semibold tracking-tight">Settings</h1>
      <Tabs value={tab} onValueChange={(v) => { params.set("tab", v); setParams(params, { replace: true }); }}>
        <TabsList>
          <TabsTrigger value="rules">Approval Rules <CountPill n={db?.approval_rules.length ?? 0} /></TabsTrigger>
          <TabsTrigger value="mailbox">Mailbox <CountPill n={unprocessed} /></TabsTrigger>
        </TabsList>
        <TabsContent value="rules" className="pt-5"><Rules /></TabsContent>
        <TabsContent value="mailbox" className="pt-5"><Mailbox /></TabsContent>
      </Tabs>
    </div>
  );
}

// ------------------------------------------------------------------ rules

function Rules() {
  const { db, backend, refresh } = useData();
  const [editing, setEditing] = useState<Partial<ApprovalRule> | null>(null);
  const rules = [...(db?.approval_rules ?? [])].sort((a, b) => a.priority - b.priority);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Rules are checked in priority order; the first match routes the bill. Keep a catch-all rule last.</p>
        <Button onClick={() => setEditing({ name: "", priority: 10, conditions: [{ field: "department", op: "eq", value: "Operations" }], levels: [{ level: 1, approver_name: "Rahul Mehta", approver_role: "approver" }] })}><Plus /> New rule</Button>
      </div>
      {rules.map((r) => (
        <Card key={r.id} className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2"><span className="rounded bg-slate-100 px-1.5 text-[11px] font-medium text-slate-600">#{r.priority}</span><span className="font-medium">{r.name}</span></div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[13px]">
                {r.conditions.length === 0 ? <span className="text-muted-foreground">Any bill</span> : r.conditions.map((c, i) => (
                  <span key={i} className="inline-flex items-center gap-1"><span className="text-xs font-semibold text-slate-500">{i === 0 ? "IF" : "AND"}</span><span className="rounded-md bg-muted px-1.5 py-0.5">{describeCondition(c)}</span></span>
                ))}
                <span className="text-xs font-semibold text-slate-500">THEN</span>
                {r.levels.map((l) => (
                  <span key={l.level} className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-emerald-900">Level {l.level} = {l.approver_name} ({ROLE_LABEL[l.approver_role]})</span>
                ))}
              </div>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button variant="ghost" size="icon" onClick={() => setEditing(structuredClone(r))} aria-label="Edit rule"><Pencil /></Button>
              <Button variant="ghost" size="icon" aria-label="Delete rule" onClick={async () => { await backend.deleteRule(r.id); await refresh(); toast.success("Rule deleted"); }}><Trash2 /></Button>
            </div>
          </div>
        </Card>
      ))}
      {!rules.length && <Card><Empty>No rules. Bills will stay in Needs Review until a rule exists.</Empty></Card>}
      {editing && <RuleEditor rule={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function RuleEditor({ rule, onClose }: { rule: Partial<ApprovalRule>; onClose: () => void }) {
  const { backend, refresh } = useData();
  const [r, setR] = useState(rule);
  const conds = r.conditions ?? [];
  const levels = r.levels ?? [];
  const setCond = (i: number, p: Partial<Condition>) => setR({ ...r, conditions: conds.map((c, j) => (j === i ? { ...c, ...p } : c)) });
  const setLevel = (i: number, name: string) => {
    const person = PEOPLE.find((p) => p.name === name)!;
    setR({ ...r, levels: levels.map((l, j) => (j === i ? { ...l, approver_name: person.name, approver_role: person.role } : l)) });
  };
  const save = async () => {
    if (!r.name?.trim()) return toast.error("Give the rule a name.");
    if (!levels.length) return toast.error("Add at least one approver level.");
    await backend.saveRule({ ...r, levels: levels.map((l, i) => ({ ...l, level: i + 1 })), priority: Number(r.priority) || 10 });
    await refresh();
    toast.success("Rule saved. It applies to bills routed from now on.");
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>{r.id ? "Edit rule" : "New approval rule"}</DialogTitle>
        <DialogDescription>IF all conditions match THEN route through the levels in order.</DialogDescription>
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <div className="space-y-1"><Label>Name</Label><Input value={r.name ?? ""} onChange={(e) => setR({ ...r, name: e.target.value })} placeholder="e.g. IT spend over ₹5,00,000" /></div>
            <div className="space-y-1"><Label>Priority</Label><Input type="number" value={r.priority ?? 10} onChange={(e) => setR({ ...r, priority: Number(e.target.value) })} /></div>
          </div>
          <div>
            <SectionTitle className="mb-2">Conditions</SectionTitle>
            <div className="space-y-2">
              {conds.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-9 text-xs font-semibold text-slate-500">{i === 0 ? "IF" : "AND"}</span>
                  <NativeSelect className="w-36" value={c.field} onChange={(e) => { const f = e.target.value as Condition["field"]; setCond(i, { field: f, op: f === "amount" ? "gt" : "eq", value: f === "amount" ? 100000 : f === "vendor_msme" ? true : "Operations" }); }}>
                    <option value="department">Department</option>
                    <option value="amount">Amount</option>
                    <option value="vendor_msme">Vendor MSME</option>
                  </NativeSelect>
                  {c.field === "amount" ? (
                    <>
                      <NativeSelect className="w-28" value={c.op} onChange={(e) => setCond(i, { op: e.target.value as Condition["op"] })}>
                        <option value="gt">over</option><option value="gte">at least</option><option value="lt">under</option>
                      </NativeSelect>
                      <div className="relative flex-1"><span className="absolute left-2.5 top-2 text-sm text-muted-foreground">₹</span><Input className="pl-6 tabular" type="number" value={String(c.value)} onChange={(e) => setCond(i, { value: Number(e.target.value) })} /></div>
                    </>
                  ) : c.field === "department" ? (
                    <><span className="w-28 text-center text-sm text-muted-foreground">=</span><NativeSelect className="flex-1" value={String(c.value)} onChange={(e) => setCond(i, { value: e.target.value })}>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}</NativeSelect></>
                  ) : (
                    <><span className="w-28 text-center text-sm text-muted-foreground">is</span><NativeSelect className="flex-1" value={String(c.value)} onChange={(e) => setCond(i, { value: e.target.value === "true" })}><option value="true">MSME</option><option value="false">Not MSME</option></NativeSelect></>
                  )}
                  <Button variant="ghost" size="icon" onClick={() => setR({ ...r, conditions: conds.filter((_, j) => j !== i) })} aria-label="Remove condition"><X /></Button>
                </div>
              ))}
              <Button variant="link" size="sm" onClick={() => setR({ ...r, conditions: [...conds, { field: "amount", op: "gt", value: 100000 }] })}><Plus /> Add condition</Button>
              {!conds.length && <p className="text-xs text-muted-foreground">No conditions: this rule matches every bill (catch-all).</p>}
            </div>
          </div>
          <div>
            <SectionTitle className="mb-2">Approvers</SectionTitle>
            <div className="space-y-2">
              {levels.map((l: Level, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-16 text-xs font-semibold text-slate-500">Level {i + 1}</span>
                  <NativeSelect className="flex-1" value={l.approver_name} onChange={(e) => setLevel(i, e.target.value)}>
                    {PEOPLE.filter((p) => p.role !== "ap_clerk").map((p) => <option key={p.name} value={p.name}>{p.name} · {p.title}</option>)}
                  </NativeSelect>
                  <Button variant="ghost" size="icon" onClick={() => setR({ ...r, levels: levels.filter((_, j) => j !== i) })} aria-label="Remove level"><X /></Button>
                </div>
              ))}
              <Button variant="link" size="sm" onClick={() => setR({ ...r, levels: [...levels, { level: levels.length + 1, approver_name: "Anita Desai", approver_role: "finance_controller" }] })}><Plus /> Add level</Button>
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={save}>Save rule</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ mailbox

function Mailbox() {
  const { db, backend, refresh } = useData();
  const openBill = useOpenBill();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [typed, setTyped] = useState("");
  const live = backend.mode === "supabase";
  const doReset = async () => {
    setConfirmReset(false);
    setTyped("");
    setBusy("reset");
    try {
      await backend.resetDemo();
      await refresh();
      toast.success("Demo data rebuilt");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const [sync, setSync] = useState<{ connected: boolean; message?: string; recorded?: number; processed?: number; at: string } | null>(null);
  if (!db) return null;
  const emails = [...db.emails].sort((a, b) => b.received_at.localeCompare(a.received_at));
  const inbox = emails.filter((e) => !e.processed);
  const invoices = emails.filter((e) => e.processed && (e.classification === "invoice" || e.classification === "vendor_reply" || (!e.classification && e.flag)));
  const other = emails.filter((e) => e.processed && e.classification && e.classification !== "invoice" && e.classification !== "vendor_reply");

  const process = async (e: Email) => {
    setBusy(e.id);
    try {
      const r = await backend.processEmail(e.id);
      await refresh();
      if (r.classification !== "invoice") toast.info(`Classified as ${r.classification?.replace(/_/g, " ")}: not sent to extraction.`);
      else if (r.bill_ids.length) toast.success(`Created ${r.bill_ids.length} bill${r.bill_ids.length > 1 ? "s" : ""}`);
      else toast.warning(r.flag ?? "Flagged for a person");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const processAll = async () => {
    for (const e of inbox) await process(e);
  };
  const doSync = async () => {
    setBusy("sync");
    try {
      const r = await backend.syncGmail();
      setSync({ ...r, at: new Date().toISOString() });
      await refresh();
      if (r.connected) toast.success(`Gmail synced: ${r.recorded ?? 0} new, ${r.processed ?? 0} processed`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-slate-100"><Mail className="h-4 w-4" /></div>
            <div>
              <div className="font-medium">Gmail</div>
              <div className="text-xs text-muted-foreground">
                {sync ? (sync.connected ? `Connected · last sync ${timeOf(sync.at)}` : sync.message) : backend.mode === "demo" ? "Not connected in demo mode." : "Syncs every minute when GMAIL_* secrets are set. Press Sync now to check."}
              </div>
            </div>
          </div>
          <Button variant="outline" onClick={doSync} disabled={busy === "sync"}>{busy === "sync" ? <Loader2 className="animate-spin" /> : <RefreshCw />} Sync now</Button>
        </div>
        {(backend.mode === "demo" || (sync && !sync.connected)) && (
          <p className="mt-3 rounded-lg bg-muted/70 px-3 py-2 text-xs text-muted-foreground">
            Without Gmail credentials, use the Simulated inbox below or upload bills manually. Both feed the same pipeline: classify → extract → validate → route.
          </p>
        )}
      </Card>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <SectionTitle>Simulated inbox <span className="ml-1 font-normal text-muted-foreground">({inbox.length} unprocessed)</span></SectionTitle>
          {inbox.length > 1 && <Button size="sm" variant="outline" disabled={!!busy} onClick={processAll}><Play /> Process all</Button>}
        </div>
        <Card className="divide-y divide-border">
          {inbox.map((e) => (
            <EmailRow key={e.id} e={e} right={<Button size="sm" disabled={!!busy} onClick={() => process(e)}>{busy === e.id ? <Loader2 className="animate-spin" /> : <Play />} Process</Button>} />
          ))}
          {!inbox.length && <Empty>Inbox is empty. Reset demo data to bring the sample emails back.</Empty>}
        </Card>
      </section>

      <section>
        <SectionTitle className="mb-2">Invoice mail</SectionTitle>
        <Card className="divide-y divide-border">
          {invoices.map((e) => (
            <EmailRow key={e.id} e={e} right={
              <div className="flex flex-wrap justify-end gap-1.5">
                {e.bill_ids.map((id) => { const b = db.bills.find((x) => x.id === id); return b ? <button key={id} onClick={() => openBill(id)} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs hover:bg-muted"><span className="font-mono">{b.invoice_no ?? "bill"}</span><StatusChip bill={b} /></button> : null; })}
              </div>
            } />
          ))}
          {!invoices.length && <Empty>No invoice mail processed yet.</Empty>}
        </Card>
      </section>

      <section>
        <SectionTitle className="mb-2">Non-invoice mail</SectionTitle>
        <Card className="divide-y divide-border">
          {other.map((e) => (
            <EmailRow key={e.id} e={e} right={<span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">{e.classification?.replace(/_/g, " ")}</span>} reason />
          ))}
          {!other.length && <Empty>Credit notes, statements, quotes, auto-replies and newsletters appear here with the reason.</Empty>}
        </Card>
      </section>

      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-slate-100"><Database className="h-4 w-4" /></div>
          <div><div className="font-medium">Demo data</div><div className="text-xs text-muted-foreground">Load the sample vendors, POs, approval rules, 12 bills and sample inbox. Deletes everything else.</div></div>
        </div>
        <Button variant="outline" disabled={busy === "reset"} onClick={() => setConfirmReset(true)}>
          {busy === "reset" ? <Loader2 className="animate-spin" /> : <RefreshCw />} Reset demo data
        </Button>
      </Card>
      <Dialog open={confirmReset} onOpenChange={(o) => { setConfirmReset(o); setTyped(""); }}>
        <DialogContent>
          <DialogTitle>Reset all data?</DialogTitle>
          <DialogDescription>
            {live
              ? "This permanently deletes every bill, uploaded invoice, email, vendor and approval rule on this live site, including real invoices, and loads the sample data instead. It cannot be undone."
              : "This replaces everything in this browser with the original sample data."}
          </DialogDescription>
          {live && (
            <div className="mt-3 space-y-1">
              <Label htmlFor="confirm-reset">Type DELETE to confirm</Label>
              <Input id="confirm-reset" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            </div>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmReset(false)}>Cancel</Button>
            <Button variant={live ? "destructive" : "default"} disabled={live && typed !== "DELETE"} onClick={doReset}>
              {live ? "Delete everything and reset" : "Reset"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmailRow({ e, right, reason }: { e: Email; right: React.ReactNode; reason?: boolean }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 flex-1 gap-3">
        <Avatar name={e.from_address.split("@")[1] ?? e.from_address} size="sm" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="truncate text-[13px] font-medium">{e.subject}</span>
            <span className="text-xs text-muted-foreground">{e.from_address} · {timeOf(e.received_at)}</span>
            {e.source === "gmail" && <span className="rounded bg-red-50 px-1 text-[10px] font-medium text-red-700">Gmail</span>}
          </div>
          <div className="line-clamp-1 text-xs text-muted-foreground">{e.body_text}</div>
          {e.attachments.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {e.attachments.map((a) => (
                <span key={a.hash + a.filename} className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px]", a.path ? "bg-slate-100 text-slate-700" : "bg-amber-50 text-amber-800")}><Paperclip className="h-3 w-3" />{a.filename}</span>
              ))}
            </div>
          )}
          {reason && e.classification_reason && <div className="mt-1 text-xs text-slate-600">{e.classification_reason}</div>}
          {e.flag && <div className="mt-1 flex items-start gap-1 text-xs font-medium text-amber-800"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{e.flag}</div>}
        </div>
      </div>
      <div className="shrink-0">{right}</div>
    </div>
  );
}
