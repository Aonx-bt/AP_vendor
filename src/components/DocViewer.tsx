import { useEffect, useRef, useState } from "react";
import { FileWarning, Loader2, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import * as pdfjs from "pdfjs-dist";
import workerSource from "pdfjs-dist/build/pdf.worker.min.mjs?raw";
import { Button } from "./ui/button";
import { useData } from "@/lib/data";

// Worker from a blob URL so the app also works as a single self-contained file.
pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));

export function DocViewer({ path, mime, name }: { path: string | null; mime: string | null; name: string | null }) {
  const { backend } = useData();
  const [url, setUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const holder = useRef<HTMLDivElement>(null);
  const isPdf = mime === "application/pdf";

  useEffect(() => {
    setErr(null);
    setLoading(true);
    if (!path) {
      setUrl(null);
      setLoading(false);
      return;
    }
    backend.fileUrl(path).then(setUrl);
  }, [path, backend]);

  useEffect(() => {
    if (!url || !isPdf || !holder.current) return;
    let cancelled = false;
    const el = holder.current;
    (async () => {
      try {
        const doc = await pdfjs.getDocument({ url, isEvalSupported: false }).promise;
        el.innerHTML = "";
        for (let i = 1; i <= Math.min(doc.numPages, 10); i++) {
          const page = await doc.getPage(i);
          const fit = Math.max(200, (el.parentElement?.clientWidth ?? 600) - 26) / page.getViewport({ scale: 1 }).width;
          const vp = page.getViewport({ scale: fit * zoom * (window.devicePixelRatio || 1) });
          const canvas = document.createElement("canvas");
          canvas.width = vp.width;
          canvas.height = vp.height;
          canvas.style.width = `${vp.width / (window.devicePixelRatio || 1)}px`;
          canvas.className = "mx-auto mb-3 rounded-md bg-white shadow-sm ring-1 ring-slate-200";
          if (cancelled) return;
          el.appendChild(canvas);
          await page.render({ canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
        }
        setLoading(false);
      } catch (e) {
        const n = (e as { name?: string }).name;
        setErr(n === "PasswordException" ? "This PDF is password-protected, so it cannot be previewed." : `Could not render this file (${(e as Error).message}).`);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, isPdf, zoom]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-slate-50">
      <div className="flex items-center justify-between border-b border-border bg-white px-3 py-1.5">
        <span className="truncate text-xs text-muted-foreground">{name ?? "Original document"}</span>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.2).toFixed(1)))} aria-label="Zoom out"><ZoomOut /></Button>
          <span className="w-10 text-center text-xs tabular text-muted-foreground">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="icon" onClick={() => setZoom((z) => Math.min(3, +(z + 0.2).toFixed(1)))} aria-label="Zoom in"><ZoomIn /></Button>
          <Button variant="ghost" size="icon" onClick={() => setZoom(1)} aria-label="Reset zoom"><RotateCcw /></Button>
        </div>
      </div>
      <div className="scroll-thin relative min-h-0 flex-1 overflow-auto p-3">
        {!path && <Placeholder text="No document attached." />}
        {err && <Placeholder text={err} />}
        {path && !err && isPdf && <div ref={holder} />}
        {path && !err && !isPdf && url && (mime?.startsWith("image/") ? (
          <img src={url} alt="Invoice" onLoad={() => setLoading(false)} style={{ width: `${zoom * 100}%` }} className="mx-auto max-w-none rounded-md bg-white shadow-sm" />
        ) : (
          <Placeholder text={`${mime ?? "This file type"} cannot be previewed.`} />
        ))}
        {loading && path && !err && (
          <div className="absolute inset-0 grid place-items-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
        )}
      </div>
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <div className="grid h-full min-h-60 place-items-center text-center text-sm text-muted-foreground">
      <div className="flex flex-col items-center gap-2"><FileWarning className="h-6 w-6 text-slate-400" />{text}</div>
    </div>
  );
}
