// Minimal, dependency-free PDF writer for demo invoices, plus a reader for PDFs written by it.
// The reader backs the *simulated* AP agent in demo mode; real documents go to the LLM.

export interface InvoiceDoc {
  title?: string; // TAX INVOICE | CREDIT NOTE | PROFORMA INVOICE | STATEMENT OF ACCOUNT
  vendor: { name: string; address: string; gstin?: string | null; pan?: string | null; email?: string };
  buyer: { name: string; address: string; gstin: string };
  invoice_no?: string | null;
  invoice_date?: string | null; // yyyy-mm-dd
  due_date?: string | null;
  due_handwritten?: boolean;
  payment_terms?: string | null;
  po_reference?: string | null;
  bank?: { name: string; account: string; ifsc: string } | null;
  lines: { description: string; hsn_sac: string; qty: number; rate: number; gst_pct: number }[];
  cgst?: number;
  sgst?: number;
  igst?: number;
  total_override?: number; // to simulate an arithmetic error on the invoice
  notes?: string[];
  encrypted?: boolean;
}

interface TextItem { x: number; y: number; size: number; bold?: boolean; text: string; gray?: boolean }

const fmt = (n: number) =>
  new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const dmy = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};
const ascii = (s: string) => s.replace(/₹/g, "Rs. ").replace(/[^\x20-\x7E]/g, "-");
const esc = (s: string) => ascii(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

export function invoiceTotals(doc: InvoiceDoc) {
  const subtotal = doc.lines.reduce((s, l) => s + l.qty * l.rate, 0);
  const cgst = doc.cgst ?? 0, sgst = doc.sgst ?? 0, igst = doc.igst ?? 0;
  const total = doc.total_override ?? subtotal + cgst + sgst + igst;
  return { subtotal, cgst, sgst, igst, total };
}

export function renderInvoicePdf(doc: InvoiceDoc): Uint8Array {
  const T: TextItem[] = [];
  const shapes: string[] = [];
  const W = 595;
  let y = 800;
  const t = (x: number, yy: number, text: string, size = 9, bold = false, gray = false) =>
    T.push({ x, y: yy, size, bold, text, gray });

  // header band
  shapes.push("0.93 0.97 0.95 rg 0 770 595 72 re f");
  t(40, y, doc.title ?? "TAX INVOICE", 11, true);
  y -= 22;
  t(40, y, doc.vendor.name, 16, true);
  y -= 16;
  t(40, y, doc.vendor.address, 9, false, true);
  y -= 13;
  if (doc.vendor.gstin) t(40, y, `GSTIN: ${doc.vendor.gstin}`);
  if (doc.vendor.pan) t(250, y, `PAN: ${doc.vendor.pan}`);
  y -= 13;
  if (doc.vendor.email) t(40, y, `Email: ${doc.vendor.email}`, 9, false, true);

  // invoice meta (right column)
  let my = 742;
  const meta: [string, string | null | undefined][] = [
    ["Invoice No", doc.invoice_no],
    ["Invoice Date", doc.invoice_date ? dmy(doc.invoice_date) : null],
    ["Due Date", doc.due_date ? dmy(doc.due_date) + (doc.due_handwritten ? " (handwritten)" : "") : null],
    ["Payment Terms", doc.payment_terms],
    ["PO Ref", doc.po_reference],
  ];
  for (const [k, v] of meta) {
    if (!v) continue;
    t(360, my, `${k}: ${v}`, 9, k === "Invoice No");
    my -= 13;
  }

  y = Math.min(y, my) - 22;
  t(40, y, "Bill To:", 9, true);
  y -= 13;
  t(40, y, doc.buyer.name);
  y -= 12;
  t(40, y, doc.buyer.address, 9, false, true);
  y -= 12;
  t(40, y, `Buyer GSTIN: ${doc.buyer.gstin}`, 9, false, true);

  // table
  y -= 26;
  const cols = [40, 62, 270, 335, 380, 455, 500];
  shapes.push(`0.2 0.25 0.3 rg 36 ${y - 5} 523 18 re f`);
  ["#", "Description", "HSN/SAC", "Qty", "Rate", "GST %", "Amount"].forEach((h, i) =>
    T.push({ x: cols[i], y, size: 8.5, bold: true, text: h, gray: false }),
  );
  // white header text is drawn via a flag below
  const headerY = y;
  y -= 20;
  doc.lines.forEach((l, i) => {
    const amt = l.qty * l.rate;
    [String(i + 1), l.description, l.hsn_sac, String(l.qty), fmt(l.rate), `${l.gst_pct}%`, fmt(amt)].forEach((c, j) =>
      t(cols[j], y, c, 8.5),
    );
    shapes.push(`0.85 0.87 0.9 RG 0.5 w 36 ${y - 6} m 559 ${y - 6} l S`);
    y -= 18;
  });

  const { subtotal, cgst, sgst, igst, total } = invoiceTotals(doc);
  y -= 6;
  const rows: [string, number][] = [["Subtotal", subtotal]];
  if (doc.cgst) rows.push([`CGST`, cgst]);
  if (doc.sgst) rows.push([`SGST`, sgst]);
  if (doc.igst) rows.push([`IGST`, igst]);
  for (const [k, v] of rows) {
    t(380, y, k);
    t(500, y, fmt(v));
    y -= 14;
  }
  shapes.push(`0.2 0.25 0.3 RG 1 w 376 ${y + 8} m 559 ${y + 8} l S`);
  y -= 4;
  t(380, y, "Total (INR)", 10, true);
  t(500, y, fmt(total), 10, true);

  y -= 34;
  if (doc.bank) {
    t(40, y, "Bank Details", 9, true);
    y -= 13;
    t(40, y, `Bank: ${doc.bank.name}`);
    t(200, y, `A/c No: ${doc.bank.account}`);
    t(370, y, `IFSC: ${doc.bank.ifsc}`);
    y -= 20;
  }
  for (const n of doc.notes ?? []) {
    t(40, y, n, 8.5, false, true);
    y -= 12;
  }
  t(40, 60, "This is a computer generated invoice.", 8, false, true);
  t(W - 200, 60, `For ${doc.vendor.name}`, 8, true);

  const content =
    shapes.join("\n") +
    "\n" +
    T.map((it) => {
      const white = it.y === headerY && it.bold && it.size === 8.5;
      const color = white ? "1 1 1 rg" : it.gray ? "0.38 0.42 0.48 rg" : "0.07 0.09 0.12 rg";
      return `BT ${color} /${it.bold ? "F2" : "F1"} ${it.size} Tf 1 0 0 1 ${it.x} ${it.y} Tm (${esc(it.text)}) Tj ET`;
    }).join("\n");

  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  if (doc.encrypted) objs.push("<< /Filter /Standard /V 1 /R 2 /O (0000000000000000) /U (0000000000000000) /P -44 >>");
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R${doc.encrypted ? ` /Encrypt ${objs.length} 0 R /ID [<a1b2> <a1b2>]` : ""} >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

// ---------- reading ----------

export type PdfProblem = "not_pdf" | "encrypted" | "corrupted" | null;

export function inspectPdf(bytes: Uint8Array): PdfProblem {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  if (!head.startsWith("%PDF-")) return "not_pdf";
  const all = new TextDecoder("latin1").decode(bytes);
  if (/\/Encrypt\s/.test(all)) return "encrypted";
  if (!all.includes("%%EOF")) return "corrupted";
  return null;
}

/** Returns text rows (top to bottom), each row a list of cells (left to right). Only uncompressed streams. */
export function readPdfRows(bytes: Uint8Array): string[][] {
  const s = new TextDecoder("latin1").decode(bytes);
  const items: { x: number; y: number; text: string }[] = [];
  const re = /1 0 0 1 ([\d.]+) ([\d.]+) Tm \(((?:\\.|[^\\)])*)\) Tj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    items.push({ x: +m[1], y: +m[2], text: m[3].replace(/\\([()\\])/g, "$1") });
  }
  const byY = new Map<number, { x: number; text: string }[]>();
  for (const it of items) {
    const k = Math.round(it.y);
    if (!byY.has(k)) byY.set(k, []);
    byY.get(k)!.push(it);
  }
  return [...byY.entries()].sort((a, b) => b[0] - a[0]).map(([, cells]) => cells.sort((a, b) => a.x - b.x).map((c) => c.text));
}
