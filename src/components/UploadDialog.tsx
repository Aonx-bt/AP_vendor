import { useRef, useState } from "react";
import { FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Label, NativeSelect } from "./ui/input";
import { useData } from "@/lib/data";
import { useOpenBill } from "./AppShell";
import { DEPARTMENTS } from "@shared/types.ts";
import { cn } from "@/lib/utils";

const ACCEPT = ["application/pdf", "image/png", "image/jpeg"];

export function UploadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { backend, person, refresh } = useData();
  const openBill = useOpenBill();
  const [file, setFile] = useState<File | null>(null);
  const [dept, setDept] = useState("");
  const [busy, setBusy] = useState(false);
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
    setBusy(true);
    try {
      let opened = false;
      const bill = await backend.uploadBill(file, dept || null, person, async (id) => {
        opened = true;
        await refresh();
        onOpenChange(false);
        openBill(id);
      });
      await refresh();
      if (!opened) {
        onOpenChange(false);
        openBill(bill.id);
      }
      toast.success(bill.invoice_no ? `Read invoice ${bill.invoice_no}` : "Bill created; needs review");
      setFile(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent>
        <DialogTitle>Add bill</DialogTitle>
        <DialogDescription>Upload a vendor invoice. The AP agent reads it, then the validation agent checks it.</DialogDescription>
        {busy ? (
          <div className="mt-5 flex flex-col items-center gap-3 rounded-xl bg-emerald-50/60 py-10 text-sm">
            <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
            <div className="font-medium">Reading invoice…</div>
            <div className="text-xs text-muted-foreground">Extracting fields, matching vendor, running checks</div>
          </div>
        ) : (
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
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={submit} disabled={!file}>Upload and read</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
