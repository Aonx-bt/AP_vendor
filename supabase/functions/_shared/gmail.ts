// Gmail adapter (Deno and Node; plain fetch). Reads the AP inbox and sends follow-ups, using the
// permission from GmailAuth (Connect Gmail button) or a GMAIL_REFRESH_TOKEN secret.
import type { IncomingEmail, Mailer } from "./pipeline.ts";
import { COMPANY } from "./types.ts";
import type { GmailAuth } from "./gmailAuth.ts";
import type { GmailReader } from "./gmailSync.ts";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

const b64urlDecode = (s: string) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
const b64urlEncode = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
/** Subject lines with ₹ or other non-ASCII text must be encoded for email headers. */
const encodeHeader = (v: string) => (/^[\x20-\x7E]*$/.test(v) ? v : `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(v)))}?=`);

// deno-lint-ignore no-explicit-any
type Part = any;

export function createGmail(auth: GmailAuth, fetchFn: typeof fetch = (...a) => fetch(...a)): { reader: GmailReader; mailer: Mailer } {
  const gget = async (path: string) => {
    const res = await fetchFn(`${API}${path}`, { headers: { Authorization: `Bearer ${await auth.accessToken()}` } });
    if (!res.ok) throw new Error(`Gmail ${path.split("?")[0]}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res.json();
  };

  const reader: GmailReader = {
    async listRecentMessageIds(query, max = 25) {
      const j = await gget(`/messages?q=${encodeURIComponent(query)}&maxResults=${max}`);
      return (j.messages ?? []).map((m: { id: string }) => m.id);
    },
    async fetchMessage(id): Promise<IncomingEmail> {
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
    },
  };

  const mailer: Mailer = {
    isConnected: () => auth.connected(),
    async send({ to, subject, body, inReplyTo, threadId }) {
      const lines = [
        `To: ${to}`,
        `Subject: ${encodeHeader(subject)}`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: 8bit",
        ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`] : []),
        "",
        body,
      ];
      const raw = b64urlEncode(new TextEncoder().encode(lines.join("\r\n")));
      const res = await fetchFn(`${API}/messages/send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${await auth.accessToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ raw, ...(threadId ? { threadId } : {}) }),
      });
      if (!res.ok) throw new Error(`Gmail send failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
      const sent = await res.json();
      // read back the Message-ID Gmail assigned, so vendor replies (In-Reply-To) map to this bill
      const meta = await gget(`/messages/${sent.id}?format=metadata&metadataHeaders=Message-ID`);
      const mid = meta.payload?.headers?.find((h: { name: string }) => h.name.toLowerCase() === "message-id")?.value ?? `<${sent.id}@${COMPANY.domain}>`;
      return { rfc_message_id: mid, thread_id: sent.threadId ?? null };
    },
  };
  return { reader, mailer };
}
