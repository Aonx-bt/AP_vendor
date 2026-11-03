# AP Desk

Accounts payable for a mid-size Indian company. Vendor invoices arrive by email or upload. Three agents read, check and route them, and every decision writes a reasoning trace you can audit.

- **AP agent** (`extract-invoice`) reads the PDF or image with an LLM using a strict JSON schema. It returns null for anything not printed and gives a confidence per field. It ignores instructions written inside the document. Sums, reconciliation and vendor matching (GSTIN first, then fuzzy name) happen in code.
- **Validation agent** (`validate-bill`) runs 10 checks: GSTIN format with the real base-36 checksum, GSTIN status, MSME, bank details, duplicate, arithmetic, IGST vs CGST+SGST, PO match with tolerance, TDS and reverse charge. It adds a sender-domain check for emailed bills. Then it decides: any fail → needs review, missing required field → needs vendor info, otherwise → approval.
- **Workflow agent** (`approval-action`) matches the first approval rule and creates levels. Level n can act only after level n-1 approves. Reject and request-changes need a comment.
- **Vendor follow-up** (`vendor-followup`) drafts an email listing exactly the missing or failing items. A person edits it and clicks Send. Without Gmail the send is simulated, and the app says so.
- **Email intake** (`process-email`, `sync-gmail`) classifies every email first. Only invoices go to extraction. Emails are deduped on Message-ID and attachment hash, and an email is marked processed only after its bills are saved.

## Run it (demo mode, no setup)

```bash
npm install
npm run dev
```

With no Supabase env vars the app runs fully in the browser. It uses the same agent code with a simulated LLM (it reads the sample PDFs AP Desk generates) and stores data in `localStorage`. You get 6 vendors, 3 POs, 2 approval rules, 12 bills across every status, and 11 sample emails in **Settings → Mailbox → Simulated inbox**. Use the role switcher (top right) to act as AP Clerk, Approver or Finance Controller.

## Read real invoices with Sarvam Vision

Invoice reading can use [Sarvam Document AI](https://docs.sarvam.ai/api/api-guides-tutorials/document-intelligence/overview) (Sarvam Vision, Extract operation; 22 Indian languages + English). Email sorting and vendor-email drafting stay on Claude.

Try it on real PDFs without any website or database:

```bash
SARVAM_API_KEY=... npm run try-extract -- invoice1.pdf invoice2.jpg [--add-vendor]
```

This runs each file through Sarvam and then AP Desk's full pipeline in memory: reconciliation, vendor match, insights, all checks, decision and routing. It writes `try-extract-report.md`. Use `--add-vendor` when the invoice's vendor isn't in the demo vendor list, so the vendor checks also run.

In the live app, set the `SARVAM_API_KEY` secret and the Edge Functions use Sarvam for invoices (`_shared/sarvam.ts`). `SARVAM_EXTRACT_MODEL` optionally picks a specific model.

## Connect Supabase

```bash
npx supabase link --project-ref <ref>
npx supabase db push                       # schema, vendor_ledger view, open RLS, storage bucket, Gmail cron
psql "$DATABASE_URL" -f supabase/seed.sql  # optional: reference data only
npx supabase secrets set SARVAM_API_KEY=<sarvam key> LLM_API_KEY=<anthropic api key>
npx supabase functions deploy
```

Then create `.env.local`:

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

Open **Settings → Mailbox → Reset demo data** to load the bills, invoice PDFs and sample inbox. This calls the `reset-demo` function, which runs the real pipeline. Seeding uses the simulated engine, so it costs nothing and gives the same result every time. Uploads and processed emails go to the real LLM (`claude-opus-5-5`, server side only).

Without `SARVAM_API_KEY`, invoices are read by Claude (`LLM_API_KEY`). Without either key, the functions fall back to the simulated engine.

### Gmail (optional, last)

```bash
npx supabase secrets set GMAIL_CLIENT_ID=... GMAIL_CLIENT_SECRET=... GMAIL_REFRESH_TOKEN=...
```

The refresh token needs the `gmail.modify` scope (read and send). The migration schedules `sync-gmail` every minute with `pg_cron`. Give it the project URL and anon key once:

```sql
select vault.create_secret('https://<ref>.supabase.co', 'project_url');
select vault.create_secret('<anon key>', 'anon_key');
```

**Sync now** in Settings → Mailbox runs it on demand. Follow-ups are sent with `In-Reply-To`, so vendor replies go back to the same bill. Without these secrets the Simulated inbox and manual upload keep working.

## Code map

| Path | What |
|---|---|
| `supabase/functions/_shared/pipeline.ts` | All agents (shared by the browser demo and the Edge Functions) |
| `supabase/functions/_shared/checks.ts` | The validation checks, as pure functions |
| `supabase/functions/_shared/gstin.ts` | GSTIN structure and checksum |
| `supabase/functions/_shared/llm.ts` | LLM interface, extraction schema and prompts, simulated engine |
| `supabase/functions/_shared/sarvam.ts` | Sarvam Vision invoice extraction |
| `supabase/functions/_shared/anthropic.ts` | Claude implementation (Edge Functions only) |
| `supabase/functions/_shared/gmail.ts` | Gmail read/send adapter |
| `supabase/functions/_shared/seed.ts` | Demo vendors, POs, rules, bills and sample inbox |
| `supabase/migrations/` | Schema, `vendor_ledger` view, RLS, storage, cron |
| `src/` | React app (Home, Bills, Vendors, Settings, bill drawer) |

```bash
npm test          # GSTIN, checks, approval rules, intake (vitest)
npm run build     # type-check + production build
```

## Simulated parts

- GSTIN status and MSME come from the `vendors` table, which stands in for the GST portal and Udyam registry. These checks carry a "Simulated registry" badge.
- Payments are out of scope. **Mark as paid** only records that a payment happened outside the app.
- There is no login. The role switcher picks the person acting, and RLS is open for the demo.
