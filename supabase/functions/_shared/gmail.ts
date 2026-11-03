// Gmail adapter (Deno). Secrets: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN.
import type { IncomingEmail, Mailer } from "./pipeline.ts";
import { COMPANY } from "./types.ts";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export function gmailConfigured(): boolean {
  return Boolean(Deno.env.get("GMAIL_CLIENT_ID") && Deno.env.get("GMAIL_CLIENT_SECRET") && Deno.env.get("GMAIL_REFRESH_TOKEN"));
}

let cached: { token: string; exp: number } | null = null;
async function accessToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GMAIL_CLIENT_ID")!,
      client_secret: Deno.env.get("GMAIL_CLIENT_SECRET")!,
      refresh_token: Deno.env.get("GMAIL_REFRESH_TOKEN")!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Gmail token refresh failed: ${res.status} ${await res.text()}`);
  const j = await res.json();
  cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return cached.token;
}

async function gget(path: string) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${await accessToken()}` } });
  if (!res.ok) throw new Error(`Gmail ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

const b64urlDecode = (s: string) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
const b64urlEncode = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export async function listRecentMessageIds(query = "in:inbox newer_than:3d", max = 25): Promise<string[]> {
  const j = await gget(`/messages?q=${encodeURIComponent(query)}&maxResults=${max}`);
  return (j.messages ?? []).map((m: { id: string }) => m.id);
}

// deno-lint-ignore no-explicit-any
type Part = any;

export async function fetchMessage(id: string): Promise<IncomingEmail> {
  const m = await gget(`/messages/${id}?format=full`);
  const headers: Record<string, string> = {};
  for (const h of m.payload.headers ?? []) headers[h.name.toLowerCase()] = h.value;
  let body = "";
  const attachments: IncomingEmail["attachments"] = [];
  const walk = async (p: Part) => {
    if (p.filename && (p.body?.attachmentId || p.body?.data)) {
      const data = p.body.data ?? (await gget(`/messages/${id}/attachments/${p.body.attachmentId}`)).data;
      attachments.push({ filename: p.filename, mime: (p.mimeType || "application/octet-stream").toLowerCase(), bytes: b64urlDecode(data) });
    } else if (p.mimeType === "text/plain" && p.body?.data && !body) {
      body = new TextDecoder().decode(b64urlDecode(p.body.data));
    }
    for (const c of p.parts ?? []) await walk(c);
  };
  await walk(m.payload);
  return {
    message_id: headers["message-id"] ?? `<gmail-${id}>`,
    source: "gmail",
    from_address: (headers["from"] ?? "").match(/<([^>]+)>/)?.[1] ?? headers["from"] ?? "",
    subject: headers["subject"] ?? "",
    body_text: body || m.snippet || "",
    received_at: new Date(Number(m.internalDate)).toISOString(),
    in_reply_to: headers["in-reply-to"] ?? null,
    thread_id: m.threadId ?? null,
    attachments,
  };
}

export const gmailMailer: Mailer = {
  get connected() {
    return gmailConfigured();
  },
  async send({ to, subject, body, inReplyTo, threadId }) {
    const lines = [
      `To: ${to}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`] : []),
      "",
      body,
    ];
    const raw = b64urlEncode(new TextEncoder().encode(lines.join("\r\n")));
    const res = await fetch(`${API}/messages/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw, ...(threadId ? { threadId } : {}) }),
    });
    if (!res.ok) throw new Error(`Gmail send failed: ${res.status} ${await res.text()}`);
    const sent = await res.json();
    // read back the RFC Message-ID Gmail assigned, so vendor replies (In-Reply-To) map to this bill
    const meta = await gget(`/messages/${sent.id}?format=metadata&metadataHeaders=Message-ID`);
    const mid = meta.payload?.headers?.find((h: { name: string }) => h.name.toLowerCase() === "message-id")?.value ?? `<${sent.id}@${COMPANY.domain}>`;
    return { rfc_message_id: mid, thread_id: sent.threadId ?? null };
  },
};
