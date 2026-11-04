import { useRef, useState } from "react";
import { ArrowRight, FileUp, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Label, NativeSelect } from "./ui/input";
import { useData } from "@/lib/data";
import { useOpenBill } from "./AppShell";
import { RunProgress, useRunProgress } from "./RunProgress";
import { StatusChip } from "./bits";
import type { Bill } from "@shared/types.ts";
import { DEPARTMENTS } from "@shared/types.ts";
import { cn } from "@/lib/utils";

const ACCEPT = ["application/pdf", "image/png", "image/jpeg"];

export function UploadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { backend, person, refresh } = useData();
  const openBill = useOpenBill();
  const [file, setFile] = useState<File | null>(null);
  const [dept, setDept] = useState("");
  const [phase, setPhase] = useState<"pick" | "creating" | "running" | "done">("pick");
  const [billId, setBillId] = useState<string | null>(null);
  const [result, setResult] = useState<Bill | null>(null);
  const progress = useRunProgress(billId, phase === "running");
  const busy = phase === "creating";
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!ACCEPT.includes(f.type)) {
      toast.error(`${f.name} is ${f.type || "an unknown type"}. Upload a PDF, PNG or JPG.`);
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      toast.error(`${f.name} is ${(f.size / 1024 / 1024).toFixed(1)} MB. Upload a file under 10 MB.`);
      return;
    }
    setFile(f);
  };

  const submit = async () => {
    if (!file) return;
    setPhase("creating");
    let id: string | null = null;
    try {
      const created = await backend.createBill(file, dept || null, person);
      id = created.id;
      setBillId(id);
      setPhase("running");
      refresh();
      const bill = await backend.extract(id);
      setResult(bill);
      toast.success(bill.invoice_no ? `Read invoice ${bill.invoice_no}` : "Bill created; it needs a review");
    } catch (e) {
      toast.error((e as Error).message);
      if (!id) {
        setPhase("pick");
        return;
      }
    }
    setPhase("done");
    await refresh();
  };

  const again = () => {
    setPhase("pick");
    setBillId(null);
    setResult(null);
    setFile(null);
  };
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o && phase === "done") again();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && close(o)}>
      <DialogContent>
        <DialogTitle>Add bill</DialogTitle>
        <DialogDescription>Upload a vendor invoice. The AP agent reads it, then the validation agent checks it.</DialogDescription>
        {phase === "running" || phase === "done" ? (
          <div className="mt-4 space-y-3">
            <RunProgress traces={progress.traces} runs={progress.runs} fileName={file?.name} live={phase === "running"} />
            {phase === "running" && <p className="text-xs text-muted-foreground">You can close this window; processing carries on and the bill appears in the list.</p>}
            {phase === "done" && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm">
                  {result ? <><span className="font-mono">{result.invoice_no ?? "Bill"}</span><StatusChip bill={result} /></> : <span className="text-muted-foreground">Processing stopped.</span>}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={again}><RotateCcw /> Upload another</Button>
                  {billId && <Button onClick={() => { const id = billId; close(false); openBill(id); }}>Open bill <ArrowRight /></Button>}
                </div>
              </div>
            )}
          </div>
        ) : busy ? (
          <div className="mt-5 flex flex-col items-center gap-3 rounded-xl bg-emerald-50/60 py-10 text-sm">
            <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
            <div className="font-medium">Uploading…</div>
          </div>        ) : (
          <div className="mt-4 space-y-4">
            <button
              type="button"
              onClick={() => input.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}
              className={cn("flex w-full flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-sm transition-colors", drag ? "border-emerald-500 bg-emerald-50" : "border-input hover:bg-muted")}
            >
              <FileUp className="h-6 w-6 text-slate-400" />
              {file ? <span className="font-medium">{file.name}</span> : <span>Drop a file or <span className="font-medium text-emerald-700">browse</span></span>}
              <span className="text-xs text-muted-foreground">PDF, PNG or JPG</span>
            </button>
            <input ref={input} type="file" accept=".pdf,.png,.jpg,.jpeg" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
            <div className="space-y-1">
              <Label>Department (optional; used by approval rules)</Label>
              <NativeSelect value={dept} onChange={(e) => setDept(e.target.value)}>
                <option value="">Infer from vendor history</option>
                {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
              </NativeSelect>
            </div>
            {backend.mode === "demo" && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Demo mode reads only text PDFs made by AP Desk (the sample inbox has some). Other files go to Needs Review. The live version reads real invoices with Sarvam Vision.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => close(false)}>Cancel</Button>
              <Button onClick={submit} disabled={!file}>Upload and read</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
