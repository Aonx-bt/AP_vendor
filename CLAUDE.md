# AP Desk: working notes for Claude

The owner edits this app only by prompting Claude. After every change:

1. `npm install` (fresh session only), then `npm test` and `npm run build` must pass.
2. Rebuild the live preview: `npm run preview:page` (writes `preview.html`, demo mode, single file).
3. Republish it to the SAME artifact URL so the owner's link keeps working:
   https://claude.ai/artifact/14D6z3wvwTVzTwq9WArZ1n
   (Artifact tool: publish `preview.html` with `url` set to that link.)
4. Commit and push to `main` on GitHub (Aonx-bt/AP_vendor) with a short plain-English message.
5. Tell the owner in plain language what changed and to refresh the preview link. The owner is
   not a developer: avoid jargon, keep instructions to clicks.

## Current work
See `docs/next-steps.md`. Part A (Sarvam Vision invoice reading + `npm run try-extract`) is built.
Next: the owner allows `api.sarvam.ai` and `docs.sarvam.ai` in the environment's network settings and
adds `SARVAM_API_KEY` as an environment variable, then in a new session attaches real invoice PDFs.
Run `npm run try-extract -- <files> --out <scratchpad>/report.md` (add `--add-vendor` if the vendor is
unknown), read each PDF yourself and compare it to the report field by field, and tell the owner
plainly what Sarvam got right or wrong. Never print or commit the key. Then Part B (live site + Gmail).

## AI engines
- Invoices: Sarvam Vision if `SARVAM_API_KEY` is set (`_shared/sarvam.ts`), else Claude (`LLM_API_KEY`).
- Email sorting and vendor-email drafts: Claude if `LLM_API_KEY` is set, else simulated.
- Without keys (demo/preview), everything is simulated (`SimulatedLLM` in `_shared/llm.ts`).

## Layout
- `supabase/functions/_shared/` holds all business logic (agents, checks, GSTIN, LLM, seed). It is
  shared by the browser demo and the Supabase Edge Functions, so change logic there, once.
- `src/` is the React UI (pages in `src/pages`, bill drawer in `src/components/BillDrawer.tsx`
  and `billParts.tsx`).
- Demo mode (no Supabase env vars) runs everything in the browser with a simulated LLM; this is
  what the preview link shows. See README.md for the real Supabase/LLM/Gmail setup.
- Seed data comes from `supabase/functions/_shared/seed.ts`; after changing vendors/POs/rules run
  `npm run gen:seed`. If the demo data shape changes, existing viewers may need
  Settings → Mailbox → Reset demo data (browser storage key `apdesk.demo.v1`).
