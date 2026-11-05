// "Connect Gmail": sends the browser to Google's consent screen, receives Google's redirect back, keeps the
// lasting permission in app_secrets (server-only), and switches on the every-minute inbox check.
//   GET  ?op=start          -> 302 to Google
//   GET  ?code=…&state=…    -> Google's redirect back; 302 to the website's Mailbox
//   POST {op:"status"}      -> { configured, connected, address, last_sync, error }
//   POST {op:"disconnect"}  -> forget the permission
import { cors, makeCtx } from "../_shared/deno.ts";
import { K } from "../_shared/gmailAuth.ts";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const redirect = (to: string) => new Response(null, { status: 302, headers: { Location: to } });
const page = (title: string, text: string) =>
  new Response(`<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;padding:40px;max-width:520px"><h2>${title}</h2><p>${text}</p></body>`, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const ctx = makeCtx();
  const url = new URL(req.url);
  // Supabase serves functions at <project>/functions/v1/<name>; this exact address is the redirect URI in Google Cloud
  const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/gmail-oauth`;
  const appUrl = (Deno.env.get("APP_URL") ?? "").trim().replace(/\/+$/, "");
  const back = (q: Record<string, string>) => (appUrl ? redirect(`${appUrl}/settings?${new URLSearchParams({ tab: "mailbox", ...q })}`) : null);

  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (body.op === "disconnect") {
        await ctx.gmailAuth.disconnect();
        return json({ ok: true });
      }
      return json(await ctx.gmailAuth.status());
    }

    if (url.searchParams.get("op") === "start") {
      if (!ctx.gmailAuth.configured) return page("Gmail isn't set up yet", "Add GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET as GitHub secrets and run Deploy backend (see SETUP.md), then try again.");
      const state = crypto.randomUUID();
      await ctx.secrets.set(K.state, `${state}|${Date.now()}`);
      return redirect(ctx.gmailAuth.consentUrl(redirectUri, state));
    }

    const err = url.searchParams.get("error");
    if (err) return back({ gmail: "error", reason: err === "access_denied" ? "You cancelled the Google permission." : err }) ?? page("Not connected", err);

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) return page("AP Desk Gmail connection", "Open AP Desk → Settings → Mailbox and click Connect Gmail.");
    const saved = await ctx.secrets.get(K.state);
    const [savedState, at] = (saved ?? "").split("|");
    if (!savedState || savedState !== state || Date.now() - Number(at) > 15 * 60_000) {
      return back({ gmail: "error", reason: "The sign-in link expired. Click Connect Gmail again." }) ?? page("Link expired", "Click Connect Gmail again.");
    }
    await ctx.secrets.del(K.state);
    const { address } = await ctx.gmailAuth.exchangeCode(code, redirectUri);

    // switch on the every-minute inbox check (the scheduled job reads this address from Vault)
    // deno-lint-ignore no-explicit-any
    const sb = (ctx.store as any).sb;
    const { error } = await sb.rpc("ap_set_project_url", { url: Deno.env.get("SUPABASE_URL") });
    if (error) console.error("could not enable the inbox timer:", error.message);

    return back({ gmail: "connected" }) ?? page("Gmail connected", `AP Desk now checks ${address ?? "the inbox"} every minute. You can close this tab.`);
  } catch (e) {
    console.error(e);
    const reason = (e as Error).message;
    return back({ gmail: "error", reason }) ?? page("Could not connect Gmail", reason);
  }
});
