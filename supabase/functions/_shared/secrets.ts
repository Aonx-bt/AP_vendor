// Small private key/value store for server-only values (the Gmail permission, OAuth state, last sync).
// Live: the `app_secrets` table, which has RLS on and no policies, so only Edge Functions (service role)
// can read it. Tests: in memory.
export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(...keys: string[]): Promise<void>;
}

export class MemorySecretStore implements SecretStore {
  constructor(public data = new Map<string, string>()) {}
  async get(k: string) {
    return this.data.get(k) ?? null;
  }
  async set(k: string, v: string) {
    this.data.set(k, v);
  }
  async del(...keys: string[]) {
    for (const k of keys) this.data.delete(k);
  }
}

// deno-lint-ignore no-explicit-any
export function supabaseSecretStore(sb: any): SecretStore {
  return {
    async get(key) {
      const { data, error } = await sb.from("app_secrets").select("value").eq("key", key).maybeSingle();
      if (error) throw new Error(error.message);
      return data?.value ?? null;
    },
    async set(key, value) {
      const { error } = await sb.from("app_secrets").upsert({ key, value, updated_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
    },
    async del(...keys) {
      const { error } = await sb.from("app_secrets").delete().in("key", keys);
      if (error) throw new Error(error.message);
    },
  };
}
