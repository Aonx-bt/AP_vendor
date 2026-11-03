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
