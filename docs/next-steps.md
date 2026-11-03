# Plan: real invoice extraction with Sarvam Vision, then the live app with Gmail

## Context
The preview link runs a demo whose "AI" only reads sample PDFs that AP Desk generated itself. The owner wants to see extraction on **real invoice PDFs** first, using **Sarvam Document AI (Sarvam Vision 2.1, Extract operation)**, before connecting Gmail.

Decisions:
- **Sarvam reads invoice PDFs only.** Sorting emails and drafting vendor emails stay on Claude, or on the simulated engine until an Anthropic key exists.
- **The first test is a quick run in this cloud session:** the owner attaches 1–3 real PDFs, and I show what AP Desk would do with each.
- Gmail and the live website (Supabase + Vercel) come after, in Part B, already planned.

Blockers found:
- this environment's network policy blocks `api.sarvam.ai` and `docs.sarvam.ai` (proxy 403);
- the Sarvam key was pasted into chat, so it must be replaced.

## Owner's steps (before the test can run)
1. Sarvam dashboard → delete the pasted key → create a new one.
2. Environment settings (cloud environment menu in the session title bar → Edit):
   - Network access: add `api.sarvam.ai` and `docs.sarvam.ai` under Allowed domains, keeping "Allow package managers" ticked;
   - add an environment variable `SARVAM_API_KEY` holding the new key. Never paste it in chat.
3. Start a new session and say "continue working on Aonx-bt/AP_vendor: run the Sarvam extraction test". Attach 1–3 real invoice PDFs. (Settings only reach new sessions; the plan is saved in the repo, see step 1 below.)

## Part A: code changes (DONE: sarvam.ts, CompositeLLM, try-extract script, tests, docs)
1. **Save the plan in the repo.** Write it to `docs/next-steps.md` and add a pointer in `CLAUDE.md`, so a new session continues from it. (Plan files outside the repo don't survive the session.)
2. **Learn Sarvam's exact API** from the `sarvamai` npm package's TypeScript types for `doc_ai`: submit extract, the schema format, `get_status`, `get_results` and the result shape. npm is reachable now. Confirm against the docs once `docs.sarvam.ai` is allowed (Jobs & Errors; Languages, Formats & Limits).
3. **New `supabase/functions/_shared/sarvam.ts`:** `SarvamExtractor`, implementing `extractInvoice(doc)` from the `LLM` interface in `_shared/llm.ts`.
   - Plain `fetch` with `api-subscription-key`, or the header the SDK uses, so it runs in Deno and Node alike.
   - Submit an extract job whose schema comes from the existing `EXTRACTION_FIELDS` / `EXTRACTION_SCHEMA`: vendor, GSTIN, PAN, invoice no/date, due date, terms, PO, bank last 4, IFSC, line items, subtotal, CGST/SGST/IGST, total.
   - Poll with backoff, giving up after about 120 s with a clear error.
   - Map results to `Extraction` and convert formats in code: dd/mm/yyyy dates to ISO, "1,18,000.00" to numbers, and the last 4 digits from a full account number. Reuse the parsing helpers in `llm.ts` (`parseAmt`, `parseDmy`), exporting them.
   - Confidence: use Sarvam's per-field confidence if it returns one; otherwise 0.9 for a found value and 1 for a clear null. The audit trail says which.
   - `suspicious_instructions`: Extract returns fields only, so this stays null. Instructions inside a document still can't trigger anything, because every decision is made in code.
4. **Mix engines.** In `llm.ts`, add `CompositeLLM(extractor, rest)`: extraction from one engine; email sorting and drafting from another. In `_shared/deno.ts` `makeCtx()`:
   - `SARVAM_API_KEY` set → Sarvam reads invoices;
   - `LLM_API_KEY` set → Claude sorts and drafts;
   - otherwise those fall back to `SimulatedLLM`.

   The engine name already shows in each bill's Audit Trail ("Extracted invoice fields" evidence → `engine`).
5. **Test script `scripts/try-extract.ts`** (`npm run try-extract -- file1.pdf …`).
   - It builds the demo vendors, POs and rules in memory (`buildDemo` from `_shared/seed.ts`, `MemoryStore` from `_shared/store.ts`), then runs the real pipeline on each file: `createBillFromFile` → `runExtraction` (reconciliation, vendor match, insights, 10 checks, decision, routing) from `_shared/pipeline.ts`, with `CompositeLLM(Sarvam, Simulated)`.
   - It writes a plain-English report per invoice: each field with its value and confidence (low-confidence and missing fields marked), the vendor match, every check with ✓/⚠/✗ and its reason, the final decision, and how long Sarvam took. It saves `try-extract-report.md` to the scratchpad and summarises it in chat.
   - Real vendors won't be in the demo vendor list, so registry and bank checks will show "vendor not matched". The report says so. If the owner wants the full picture, `--add-vendor` creates a vendor record from the invoice's own GSTIN and bank details, so the remaining checks run.
6. **Unit test** (`_shared/sarvam.test.ts`): map a fixture Sarvam result shaped like the SDK types to `Extraction` (date, amount and last-4 conversions; null handling). No network.
7. **Docs:** a SETUP section for Sarvam, plus CLAUDE.md notes on the engine env vars. The demo preview link is unchanged, so it needs no republish. Commit and push to `main`.

## Part A: verification (new session, once the owner has done the steps)
- `npm test` and `npm run build` pass; `deno check` passes on all functions.
- `curl` to `api.sarvam.ai` no longer returns 403, and `SARVAM_API_KEY` is set (checked without printing it).
- Run `npm run try-extract` on the owner's PDFs and compare the report against each PDF by eye (I can read PDFs): invoice number, GSTIN, dates, line totals, tax split, total. Report any field Sarvam got wrong or missed, and anything Claude also needs to compare. Never show made-up results if a call fails; report the actual error.

## Part B: live app with Gmail (after Part A; planned earlier, unchanged except Sarvam)
- **Hosting:** Vercel serves the website and Supabase runs the back office (database, files, AI calls, Gmail checks). Both redeploy automatically on push. A GitHub Action, `.github/workflows/deploy-backend.yml`, runs migrations, deploys functions, sets secrets and sets the Vault values for the every-minute job. `vercel.json` adds an SPA rewrite.
- **Gmail:**
  - a **Connect Gmail** button (new `gmail-oauth` Edge Function), with the refresh token kept in an `app_secrets` table that only the server can read (RLS on, no policies);
  - a clear "disconnected, click Connect again" state when Google revokes access;
  - the search query is configurable, and each run processes at most 3 emails to stay within time limits.
- **Google restrictions** go into SETUP.md:
  - Workspace inbox: "Internal", with admin approval if blocked;
  - @gmail.com: "External" plus **Publish app**, to avoid the 7-day disconnect, and click through the unverified-app warning once;
  - 25 MB attachment limit; emails arrive within 1–2 minutes.
- **Safety:** typing `DELETE` is required for Reset demo data in real mode; uploads are capped at 10 MB.
- **No login for now** (owner's choice). I'll warn the owner that anyone with the site address can see invoices.
- **GitHub secrets:** add `SARVAM_API_KEY` to the list, alongside `SUPABASE_*`, `LLM_API_KEY`, `GMAIL_CLIENT_ID/SECRET` and `APP_URL`.
