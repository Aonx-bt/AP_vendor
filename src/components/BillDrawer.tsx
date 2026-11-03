import { useState } from "react";
import { BadgeCheck, CheckCircle2, Loader2, Mail, MailCheck, RefreshCw, RotateCcw, Send, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import * as D from "@radix-ui/react-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle, SheetContent } from "./ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger, CountPill } from "./ui/tabs";
import { Button } from "./ui/button";
import { Input, Label, NativeSelect, Textarea } from "./ui/input";
import { Card, SectionTitle } from "./ui/card";
import { StatusChip } from "./bits";
import { DocViewer } from "./DocViewer";
import { VendorEmailModal } from "./VendorEmailModal";
import { ApprovalCard, AuditTrail, DecisionCard, Insights, LineItems, PaymentSummary, Stepper, Verification, type LineDraft, type Money } from "./billParts";
import { useData } from "@/lib/data";
import { cn, longDate, timeOf } from "@/lib/utils";
import type { Bill } from "@shared/types.ts";
import { DEPARTMENTS } from "@shared/types.ts";
import { missingRequired } from "@shared/checks.ts";

type Form = Pick<Bill, "invoice_no" | "invoice_date" | "due_date" | "payment_terms" | "po_reference" | "department" | "narration" | "vendor_id" | "vendor_gstin" | "bank_last4" | "ifsc"> & Money;
const FORM_KEYS: (keyof Form)[] = ["invoice_no", "invoice_date", "due_date", "payment_terms", "po_reference", "department", "narration", "vendor_id", "vendor_gstin", "bank_last4", "ifsc", "subtotal", "discount", "cgst", "sgst", "igst", "adjustments", "total", "tds_section", "rcm"];
const CONF_KEY: Record<string, string> = { bank_last4: "bank_account_last4" };
const FLAG_MISSING = new Set(["invoice_no", "invoice_date", "due_date", "vendor_gstin", "total", "bank_last4", "ifsc"]);
const EX_KEY: Record<string, string> = { bank_last4: "bank_account_last4", vendor_gstin: "vendor_gstin" };

const toForm = (b: Bill): Form => Object.fromEntries(FORM_KEYS.map((k) => [k, b[k]])) as Form;
const toLines = (ls: { description: string | null; hsn_sac: string | null; qty: number | null; rate: number | null; gst_pct: number | null; amount_excl_gst: number | null; position: number }[]): LineDraft[] =>
  [...ls].sort((a, b) => a.position - b.position).map(({ description, hsn_sac, qty, rate, gst_pct, amount_excl_gst }) => ({ description, hsn_sac, qty, rate, gst_pct, amount_excl_gst }));

export function BillDrawer({ billId, onClose }: { billId: string | null; onClose: () => void }) {
  const { db } = useData();
  const bill = billId ? db?.bills.find((b) => b.id === billId) : undefined;
  return (
    <Dialog open={!!billId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="max-w-[1240px] md:w-[94vw]" aria-describedby={undefined}>
        {bill ? <DrawerBody key={bill.id + bill.updated_at} bill={bill} onClose={onClose} /> : <div className="p-6 text-sm text-muted-foreground"><D.Title>Bill not found</D.Title></div>}
      </SheetContent>
    </Dialog>
  );
}

function DrawerBody({ bill, onClose }: { bill: Bill; onClose: () => void }) {
  const { db, backend, person, role, refresh } = useData();
  const [form, setForm] = useState<Form>(() => toForm(bill));
  const lineRows = db!.bill_lines.filter((l) => l.bill_id === bill.id);
  const [lines, setLines] = useState<LineDraft[]>(() => toLines(lineRows));
  const [busy, setBusy] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  const vendor = form.vendor_id ? db!.vendors.find((v) => v.id === form.vendor_id) ?? null : null;
  const results = db!.validation_results.filter((r) => r.bill_id === bill.id);
  const approvals = db!.approvals.filter((a) => a.bill_id === bill.id && a.status !== "cancelled");
  const rule = approvals[0]?.rule_id ? db!.approval_rules.find((r) => r.id === approvals[0].rule_id) ?? null : null;
  const traces = db!.trace_events.filter((t) => t.bill_id === bill.id || (bill.source_email_id && t.email_id === bill.source_email_id));
  const messages = db!.vendor_messages.filter((m) => m.bill_id === bill.id && m.status === "sent");
  const email = bill.source_email_id ? db!.emails.find((e) => e.id === bill.source_email_id) : null;

  const linesDirty = JSON.stringify(lines) !== JSON.stringify(toLines(lineRows));
  const dirtyKeys = FORM_KEYS.filter((k) => JSON.stringify(form[k]) !== JSON.stringify(bill[k]));
  const dirty = dirtyKeys.length > 0 || linesDirty;
  const editable = (bill.status === "needs_review" || bill.status === "needs_vendor_info") && role !== "approver";
  const reading = bill.status === "received";
  const fails = results.filter((r) => r.outcome === "fail" && r.check_key !== "duplicate");
  const canAskVendor = editable && (missingRequired(bill).length > 0 || fails.length > 0);

  // amber = low confidence, red = not found in invoice. A value a person typed clears both.
  const flag = (k: string): { cls?: string; hint?: string } => {
    if (dirtyKeys.includes(k as keyof Form)) return {};
    const v = (form as Record<string, unknown>)[k];
    const ex = bill.extracted as Record<string, unknown> | null;
    if (ex && FLAG_MISSING.has(k) && (v == null || v === "") && ex[EX_KEY[k] ?? k] == null) return { cls: "border-red-400 ring-1 ring-red-200", hint: "Not found in invoice" };
    const c = bill.field_confidence?.[CONF_KEY[k] ?? k];
    if (c != null && c < 0.8 && v != null && v !== "") return { cls: "border-amber-400 ring-1 ring-amber-200", hint: "Check this" };
    return {};
  };

  const run = async (label: string, f: () => Promise<unknown>, ok?: string) => {
    setBusy(label);
    try {
      await f();
      await refresh();
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const save = (revalidate: boolean) =>
    run("save", async () => {
      const patch = Object.fromEntries(dirtyKeys.map((k) => [k, form[k]])) as Partial<Bill>;
      await backend.saveBill(bill.id, patch, linesDirty ? lines : null, person);
      if (revalidate) await backend.revalidate(bill.id, person);
    }, revalidate ? "Saved and re-validated" : "Saved");

  const field = (k: keyof Form, label: string, type = "text", wide = false) => {
    const fl = flag(k);
    return (
      <div className={cn("space-y-1", wide && "col-span-2")}>
        <Label>{label}</Label>
        <Input disabled={!editable} type={type} className={fl.cls} value={(form[k] as string | number | null) ?? ""} onChange={(e) => setForm({ ...form, [k]: e.target.value === "" ? null : e.target.value })} />
        {fl.hint && <div className={cn("text-[11px] font-medium", fl.hint === "Check this" ? "text-amber-700" : "text-red-600")}>{fl.hint}</div>}
      </div>
    );
  };

  const bankMatches = vendor && (!form.bank_last4 || form.bank_last4 === vendor.bank_last4) && (!form.ifsc || form.ifsc.toUpperCase() === (vendor.ifsc ?? "").toUpperCase());
  const moneyConf = (k: string) => flag(k).cls;

  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <div className="shrink-0 bg-gradient-to-r from-emerald-50 via-sky-50 to-violet-50 px-6 pt-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <D.Title className="font-mono text-lg font-semibold tracking-tight">{bill.invoice_no ?? "Invoice number missing"}</D.Title>
              <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-medium text-violet-700 ring-1 ring-violet-200"><Sparkles className="h-3 w-3" /> AI Enhanced</span>
              <StatusChip bill={bill} />
            </div>
            <div className="mt-0.5 truncate text-sm text-slate-600">
              {vendor?.name ?? bill.extracted?.vendor_name ?? "Vendor not identified"}
              {email && <span className="text-muted-foreground"> · via email from {email.from_address}</span>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button variant="outline" size="sm" className="bg-white/70" disabled={!!busy || reading || role === "approver"} onClick={() => setResetOpen(true)}><RotateCcw /> Reset</Button>
            <D.Close className="rounded-lg p-1.5 text-slate-500 hover:bg-white/70" aria-label="Close"><X className="h-5 w-5" /></D.Close>
          </div>
        </div>
        <Tabs defaultValue="details" className="mt-3" id="bill-tabs">
          <TabsList className="border-0">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="audit">Audit Trail <CountPill n={traces.length} /></TabsTrigger>
          </TabsList>
          {/* content is rendered below the gradient via portal-free layout */}
          {tabBodies()}
        </Tabs>
      </div>
    </div>
  );

  function tabBodies() {
    return (
      <>
        <TabsContent value="details" className="-mx-6 h-[calc(100vh-112px)] overflow-y-auto bg-white scroll-thin">
          <div className="space-y-4 px-6 py-5">
            {reading ? (
              <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-sm"><Loader2 className="h-5 w-5 animate-spin text-emerald-600" /><div><div className="font-medium">Reading invoice…</div><div className="text-xs text-muted-foreground">The AP agent is extracting fields. Checks run automatically next.</div></div></div>
            ) : (
              <DecisionCard bill={bill} results={results} approvals={approvals} rule={rule} traces={traces} />
            )}
            <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
              <Insights bill={bill} />
            </div>
            <Card className="px-4 py-3"><Stepper bill={bill} approvals={approvals} /></Card>

            {/* actions */}
            <div className="flex flex-wrap items-center gap-2">
              {dirty && (
                <>
                  <Button size="sm" disabled={!!busy} onClick={() => save(true)}>{busy === "save" ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Save & re-validate</Button>
                  <Button size="sm" variant="outline" disabled={!!busy} onClick={() => save(false)}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setForm(toForm(bill)); setLines(toLines(lineRows)); }}>Discard</Button>
                  <span className="mx-1 h-5 w-px bg-border" />
                </>
              )}
              {editable && !dirty && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run("reval", () => backend.revalidate(bill.id, person), "Re-validated")}>{busy === "reval" ? <Loader2 className="animate-spin" /> : <RefreshCw />} Re-validate</Button>}
              {canAskVendor && <Button size="sm" variant="dark" disabled={!!busy || dirty} onClick={() => setEmailOpen(true)}><Mail /> Request info from vendor</Button>}
              {bill.status === "needs_vendor_info" && role !== "approver" && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run("reply", () => backend.markVendorReply(bill.id, person), "Back in Needs Review for re-validation")}><MailCheck /> Mark vendor reply received</Button>}
              {bill.status === "needs_review" && role !== "approver" && !dirty && <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setOverrideOpen(true)}><Send /> Send for approval anyway</Button>}
              {bill.status === "approved" && !bill.paid_at && role === "finance_controller" && <Button size="sm" disabled={!!busy} onClick={() => run("paid", () => backend.markPaid(bill.id, person), "Marked paid")}><BadgeCheck /> Mark as paid</Button>}
              {!editable && !reading && bill.status !== "approved" && bill.status !== "in_approval" && <span className="text-xs text-muted-foreground">{role === "approver" ? "Approvers can view; AP Clerk edits fields." : ""}</span>}
            </div>

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
              <div className="min-w-0 space-y-5">
                <Card className="p-4">
                  <SectionTitle className="mb-3">Invoice details</SectionTitle>
                  <div className="grid grid-cols-2 gap-3">
                    {field("invoice_no", "Invoice number")}
                    {field("invoice_date", "Invoice date", "date")}
                    {field("due_date", "Due date", "date")}
                    {field("payment_terms", "Payment terms")}
                    {field("po_reference", "PO reference")}
                    <div className="space-y-1">
                      <Label>Department</Label>
                      <NativeSelect disabled={!editable} value={form.department ?? ""} onChange={(e) => setForm({ ...form, department: e.target.value || null })}>
                        <option value="">—</option>
                        {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
                      </NativeSelect>
                    </div>
                    {field("narration", "Narration", "text", true)}
                  </div>
                </Card>

                <Card className="p-4">
                  <SectionTitle className="mb-3">Vendor details</SectionTitle>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2 space-y-1">
                      <Label>Vendor</Label>
                      <NativeSelect disabled={!editable} value={form.vendor_id ?? ""} className={!form.vendor_id ? "border-red-400 ring-1 ring-red-200" : ""} onChange={(e) => setForm({ ...form, vendor_id: e.target.value || null })}>
                        <option value="">Not matched: pick a vendor</option>
                        {db!.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </NativeSelect>
                      {!form.vendor_id && bill.extracted?.vendor_name && (
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                          Invoice says "{bill.extracted.vendor_name}"
                          {editable && !bill.vendor_id && (
                            <Button size="sm" variant="soft" className="h-6 px-2 text-[11px]" disabled={!!busy} onClick={() => run("vendor", () => backend.createVendorFromBill(bill.id, person), `Added ${bill.extracted!.vendor_name} as a vendor`)}>
                              Add as new vendor
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                    {field("vendor_gstin", "GSTIN on invoice", "text", true)}
                    {field("bank_last4", "Bank a/c (last 4) on invoice")}
                    {field("ifsc", "IFSC on invoice")}
                  </div>
                  {vendor && (
                    <div className={cn("mt-3 flex items-center justify-between rounded-lg px-3 py-2 text-[13px]", bankMatches ? "bg-muted/60" : "bg-red-50")}>
                      <span>
                        <span className="text-muted-foreground">Vendor master: </span>
                        {vendor.bank_name} ••{vendor.bank_last4} · {vendor.ifsc}
                      </span>
                      {vendor.bank_verified ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><BadgeCheck className="h-4 w-4" /> Verified</span>
                      ) : (
                        <span className="text-xs font-medium text-amber-700">Not verified</span>
                      )}
                    </div>
                  )}
                  {vendor && !bankMatches && <div className="mt-1.5 text-xs font-medium text-red-700">Bank details differ from vendor master. Re-verify before paying.</div>}
                  <div className="mt-4"><Verification results={results} /></div>
                </Card>

                <LineItems lines={lines} onChange={setLines} readOnly={!editable} />
                <PaymentSummary f={form} onChange={(p) => setForm({ ...form, ...p })} readOnly={!editable} conf={moneyConf} />
                <ApprovalCard bill={{ ...bill, ...form }} vendor={vendor} rules={db!.approval_rules} approvals={db!.approvals.filter((a) => a.bill_id === bill.id)} role={role} busy={!!busy}
                  onAct={(a, action, comment) => run("approve", () => backend.approval(a.id, action, person, comment), action === "approve" ? `Approved level ${a.level}` : action === "reject" ? "Rejected" : "Changes requested")} />

                {messages.length > 0 && (
                  <Card className="p-4">
                    <SectionTitle className="mb-2">Vendor communication</SectionTitle>
                    {messages.map((m) => (
                      <details key={m.id} className="rounded-lg border border-border p-3 text-[13px]">
                        <summary className="cursor-pointer">
                          <span className="font-medium">{m.subject}</span>
                          <span className="ml-2 text-xs text-muted-foreground">to {m.to_address} · {m.sent_at ? timeOf(m.sent_at) : ""}</span>
                          {m.simulated && <span className="ml-2 rounded bg-slate-100 px-1.5 py-px text-[10px] font-medium text-slate-600">Simulated send</span>}
                        </summary>
                        <pre className="mt-2 whitespace-pre-wrap font-sans text-[13px] text-slate-600">{m.body}</pre>
                      </details>
                    ))}
                  </Card>
                )}
              </div>
              <div className="min-w-0 lg:sticky lg:top-0 lg:h-[calc(100vh-150px)]">
                <div className="h-[70vh] lg:h-full"><DocViewer path={bill.file_path} mime={bill.file_mime} name={bill.file_name} /></div>
              </div>
            </div>
            <div className="pb-6 text-[11px] text-muted-foreground">Received {longDate(bill.created_at)} · Last updated {timeOf(bill.updated_at)}</div>
          </div>
          <VendorEmailModal billId={bill.id} open={emailOpen} onOpenChange={setEmailOpen} />
          <OverrideDialog open={overrideOpen} onOpenChange={setOverrideOpen} onConfirm={(c) => run("override", () => backend.override(bill.id, person, c), "Sent for approval")} />
          <ConfirmReset open={resetOpen} onOpenChange={setResetOpen} onConfirm={() => run("reset", () => backend.resetBill(bill.id, person), "Reset and re-read from the original document")} />
        </TabsContent>
        <TabsContent value="audit" className="-mx-6 h-[calc(100vh-112px)] overflow-y-auto bg-white px-6 py-5 scroll-thin">
          <p className="mb-4 text-xs text-muted-foreground">Every agent step and human action, with its reasoning. Expand a step to see the evidence it used.</p>
          <AuditTrail events={traces} />
        </TabsContent>
      </>
    );
  }
}

function OverrideDialog({ open, onOpenChange, onConfirm }: { open: boolean; onOpenChange: (o: boolean) => void; onConfirm: (c: string) => void }) {
  const [c, setC] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Send for approval with open issues</DialogTitle>
        <DialogDescription>The approver will see the failed checks. Explain why this should go ahead.</DialogDescription>
        <Textarea className="mt-3" rows={3} value={c} onChange={(e) => setC(e.target.value)} placeholder="e.g. Vendor confirmed new bank account by phone; cancelled cheque on file." />
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!c.trim()} onClick={() => { onConfirm(c); onOpenChange(false); setC(""); }}>Send for approval</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmReset({ open, onOpenChange, onConfirm }: { open: boolean; onOpenChange: (o: boolean) => void; onConfirm: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Reset this bill?</DialogTitle>
        <DialogDescription>Manual edits and open approvals are discarded. The AP agent re-reads the original document and all checks run again. The audit trail is kept.</DialogDescription>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => { onConfirm(); onOpenChange(false); }}>Reset</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
