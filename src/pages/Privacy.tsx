import { Link } from "react-router-dom";

/** Public privacy notice (needed for Google's OAuth consent screen). Standalone page, no app chrome. */
export default function Privacy() {
  return (
    <div className="min-h-full bg-white">
      <div className="mx-auto max-w-2xl px-6 py-12 text-[15px] leading-relaxed text-slate-700">
        <Link to="/" className="text-sm font-semibold text-emerald-700">AP Desk</Link>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight text-slate-900">Privacy policy</h1>
        <p className="mt-1 text-sm text-muted-foreground">Last updated 5 November 2026</p>

        <h2 className="mt-8 text-base font-semibold text-slate-900">What AP Desk is</h2>
        <p className="mt-2">AP Desk is an internal accounts payable tool. It reads vendor invoices that arrive in the company's accounts payable inbox, checks them and routes them for approval. It is used only by the team that runs it.</p>

        <h2 className="mt-8 text-base font-semibold text-slate-900">Gmail data we access and why</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5">
          <li>When the accounts payable inbox is connected, AP Desk reads new emails in that inbox to find vendor invoices.</li>
          <li>For each email it stores the sender, subject, date, a short body text and the attachments needed to create a bill (PDF, PNG or JPG invoices).</li>
          <li>Invoice files are sent to an invoice-reading service (Sarvam AI) to extract fields such as invoice number, GSTIN, amounts and bank details.</li>
          <li>AP Desk sends emails from the inbox only when a person clicks Send on a "Request info from vendor" message.</li>
          <li>AP Desk does not read any other Google data, does not sell data, and does not use Gmail data for advertising or to train AI models.</li>
        </ul>

        <h2 className="mt-8 text-base font-semibold text-slate-900">Where data is stored</h2>
        <p className="mt-2">Bills, invoice files and email records are stored in the company's own database and file storage (Supabase, Mumbai region). The permission to read the inbox is stored only on the server, never in the website.</p>

        <h2 className="mt-8 text-base font-semibold text-slate-900">Removing access and data</h2>
        <p className="mt-2">Click Disconnect in Settings → Mailbox, or remove AP Desk at myaccount.google.com/permissions, to stop all inbox access. To delete stored data, contact the accounts payable team that runs this instance.</p>

        <p className="mt-10 text-xs text-muted-foreground">AP Desk's use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.</p>
      </div>
    </div>
  );
}
