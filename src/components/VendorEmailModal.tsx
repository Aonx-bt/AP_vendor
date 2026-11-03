import { useEffect, useState } from "react";
import { Info, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input, Label, Textarea } from "./ui/input";
import { useData } from "@/lib/data";
import type { VendorMessage } from "@shared/types.ts";

export function VendorEmailModal({ billId, open, onOpenChange }: { billId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { backend, person, refresh } = useData();
  const [msg, setMsg] = useState<VendorMessage | null>(null);
  const [form, setForm] = useState({ to_address: "", subject: "", body: "" });
  const [state, setState] = useState<"drafting" | "ready" | "sending">("drafting");

  useEffect(() => {
    if (!open) return;
    setState("drafting");
    setMsg(null);
    backend
      .draftVendorEmail(billId, person)
      .then((m) => {
        setMsg(m);
        setForm({ to_address: m.to_address, subject: m.subject, body: m.body });
        setState("ready");
        refresh();
      })
      .catch((e) => {
        toast.error((e as Error).message);
        onOpenChange(false);
      });
  }, [open, billId]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    if (!msg) return;
    setState("sending");
    try {
      const r = await backend.sendVendorEmail(msg.id, form, person);
      await refresh();
      onOpenChange(false);
      if (r.simulated) toast.info("Simulated send: Gmail is not connected, so nothing left this app. The bill is now Waiting on Vendor.", { duration: 7000 });
      else toast.success(`Sent to ${form.to_address}. The bill is now Waiting on Vendor.`);
    } catch (e) {
      toast.error((e as Error).message);
      setState("ready");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => state !== "sending" && onOpenChange(o)}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>Request info from vendor</DialogTitle>
        <DialogDescription>Drafted by the AP agent from the missing and failing items. Edit anything, then send. Nothing is sent until you click Send.</DialogDescription>
        {state === "drafting" ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Drafting email…</div>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="space-y-1"><Label>To</Label><Input value={form.to_address} onChange={(e) => setForm({ ...form, to_address: e.target.value })} /></div>
            <div className="space-y-1"><Label>Subject</Label><Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></div>
            <div className="space-y-1"><Label>Body</Label><Textarea rows={13} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} className="font-[450] leading-relaxed" /></div>
            {backend.mode === "demo" && (
              <p className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-muted-foreground"><Info className="h-3.5 w-3.5" /> Gmail is not connected: sending is simulated and recorded in the audit trail.</p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Keep as draft</Button>
              <Button onClick={send} disabled={state === "sending"}>{state === "sending" ? <Loader2 className="animate-spin" /> : <Send />} Send</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
