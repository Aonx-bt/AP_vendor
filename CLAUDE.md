# AP Desk: working notes for Claude

The owner edits this app only by prompting Claude. After every change:

1. `npm install` (fresh session only), then `npm test` and `npm run build` must pass.
2. Rebuild the live preview: `npm run preview:page` (writes `preview.html`, demo mode, single file).
3. Republish it to the SAME artifact URL so the owner's link keeps working:
   https://claude.ai/artifact/14D6z3wvwTVzTwq9WArZ1n
   (Artifact tool: publish `preview.html` with `url` set to that link.)
4. Commit and push to `main` on GitHub (Aonx-bt/AP_vendor) with a short plain-English message.
   Pushes also redeploy the LIVE site once the owner has done SETUP.md: Vercel rebuilds the website,
   and `.github/workflows/deploy-backend.yml` redeploys Supabase when `supabase/**` changes. If the owner
   says the live site didn't update, ask them to check Actions → Deploy backend for a red cross.
5. Tell the owner in plain language what changed and to refresh the preview link. The owner is
   not a developer: avoid jargon, keep instructions to clicks.

## Current work
See `docs/next-steps.md`. Part A (Sarvam Vision invoice reading) is built and verified live: the owner
has allowed `api.sarvam.ai`/`docs.sarvam.ai` and set `SARVAM_API_KEY` in the environment.
To test real invoices the owner attaches: `npm run try-extract -- <files> --out <scratchpad>/report.md`
(add `--add-vendor` if the vendor is unknown; the npm script already sets NODE_USE_ENV_PROXY=1, which
Node needs to use this workspace's network proxy). Read each PDF yourself, compare it to the report
field by field, and tell the owner plainly what Sarvam got right or wrong. Never print or commit the key.
Then Part B (live site + Gmail).

## Gmail
- "Connect Gmail" = `supabase/functions/gmail-oauth` (Google consent → refresh token stored in the server-only
  `app_secrets` table → switches on the every-minute pg_cron job via `ap_set_project_url`).
- `sync-gmail` runs `_shared/gmailSync.ts` (records new mail, processes ≤3 per run). Sign-in/token logic is
  `_shared/gmailAuth.ts`; Gmail HTTP is `_shared/gmail.ts`. Owner setup steps: SETUP.md → "Connect Gmail".
- Live project: https://ulwaqfiyxkfmpqjauxgx.supabase.co, site https://ap-vendor.vercel.app. You can check
  state read-only with the public key from the live JS bundle (REST) and `POST /functions/v1/gmail-oauth`
  `{"op":"status"}`; GitHub Actions run logs are readable via the public GitHub API.

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
