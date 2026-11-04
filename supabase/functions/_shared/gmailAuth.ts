// Google sign-in for the AP inbox: consent link, code exchange, access tokens, and what happens when Google
// takes the permission back. Portable (no Deno APIs) so it is unit-tested.
import type { SecretStore } from "./secrets.ts";

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
export const K = { token: "gmail_refresh_token", address: "gmail_address", error: "gmail_error", state: "oauth_state", lastSync: "gmail_last_sync" } as const;
export const REVOKED_MESSAGE = "Google disconnected AP Desk (the password was changed or access was removed). Click Connect Gmail again.";

export interface GmailAuthOptions {
  clientId?: string | null;
  clientSecret?: string | null;
  envRefreshToken?: string | null; // optional: a token set by hand as a secret
  secrets: SecretStore;
  fetchFn?: typeof fetch;
}

export interface GmailStatus {
  configured: boolean; // Google client id + secret are set on the server
  connected: boolean; // we hold a refresh token
  address: string | null;
  last_sync: string | null;
  error: string | null;
}

export class GmailAuth {
  private f: typeof fetch;
  private cached: { token: string; exp: number } | null = null;
  constructor(private o: GmailAuthOptions) {
    this.f = o.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  }

  get configured() {
    return Boolean(this.o.clientId && this.o.clientSecret);
  }

  async refreshToken(): Promise<string | null> {
    return this.o.envRefreshToken || (await this.o.secrets.get(K.token));
  }

  async connected() {
    return this.configured && Boolean(await this.refreshToken());
  }

  async status(): Promise<GmailStatus> {
    const s = this.o.secrets;
    return {
      configured: this.configured,
      connected: await this.connected(),
      address: await s.get(K.address),
      last_sync: await s.get(K.lastSync),
      error: await s.get(K.error),
    };
  }

  consentUrl(redirectUri: string, state: string): string {
    const p = new URLSearchParams({
      client_id: this.o.clientId ?? "",
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GMAIL_SCOPE,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  }

  /** Swap the one-time code from Google's redirect for a lasting refresh token, and remember the inbox address. */
  async exchangeCode(code: string, redirectUri: string): Promise<{ address: string | null }> {
    const res = await this.f("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: this.o.clientId ?? "", client_secret: this.o.clientSecret ?? "", redirect_uri: redirectUri, grant_type: "authorization_code" }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Google refused the sign-in: ${j.error_description ?? j.error ?? res.status}`);
    if (!j.refresh_token) throw new Error("Google did not return a lasting permission. Remove AP Desk at myaccount.google.com/permissions and click Connect Gmail again.");
    await this.o.secrets.set(K.token, j.refresh_token);
    await this.o.secrets.del(K.error);
    this.cached = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
    let address: string | null = null;
    try {
      const p = await this.f("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { Authorization: `Bearer ${j.access_token}` } });
      if (p.ok) address = (await p.json()).emailAddress ?? null;
    } catch { /* address is only for display */ }
    if (address) await this.o.secrets.set(K.address, address);
    return { address };
  }

  /** A short-lived access token. If Google has revoked the permission, forget it and record why. */
  async accessToken(): Promise<string> {
    if (this.cached && this.cached.exp > Date.now() + 60_000) return this.cached.token;
    const refresh = await this.refreshToken();
    if (!this.configured || !refresh) throw new Error("Gmail is not connected.");
    const res = await this.f("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.o.clientId!, client_secret: this.o.clientSecret!, refresh_token: refresh, grant_type: "refresh_token" }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (j.error === "invalid_grant") {
        await this.o.secrets.del(K.token);
        await this.o.secrets.set(K.error, REVOKED_MESSAGE);
        throw new Error(REVOKED_MESSAGE);
      }
      throw new Error(`Gmail sign-in failed: ${j.error_description ?? j.error ?? res.status}`);
    }
    this.cached = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
    return this.cached.token;
  }

  async disconnect() {
    this.cached = null;
    await this.o.secrets.del(K.token, K.address, K.error);
  }
}
