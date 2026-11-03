/** Supabase's settings page shows the REST endpoint (https://<ref>.supabase.co/rest/v1/), but the client
 *  needs only the origin and adds the path itself. Accept either form. */
export function supabaseOrigin(url: string): string {
  const raw = url.trim();
  try {
    return new URL(raw).origin;
  } catch {
    return raw.replace(/\/+$/, "");
  }
}
