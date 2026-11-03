export const uid = (): string =>
  (globalThis.crypto as Crypto).randomUUID();

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const num = (n: number | null | undefined) => (typeof n === "number" && isFinite(n) ? n : 0);

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
export const daysBetween = (a: string | Date, b: string | Date) =>
  Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86400000);

export const inr = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 }).format(n);

export function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(pvt|private|ltd|limited|llp|co|company|inc|the|m\/s)\b\.?/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lev(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

/** 0..1 similarity of two company names, after stripping legal suffixes. */
export function nameSimilarity(a: string, b: string): number {
  const x = normName(a), y = normName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const editSim = 1 - lev(x, y) / Math.max(x.length, y.length);
  const tx = new Set(x.split(" ")), ty = new Set(y.split(" "));
  const inter = [...tx].filter((t) => ty.has(t)).length;
  const jacc = inter / new Set([...tx, ...ty]).size;
  return Math.max(editSim, jacc);
}

export const domainOf = (addr: string) => {
  const m = addr.match(/@([A-Za-z0-9.-]+)/);
  return m ? m[1].toLowerCase() : "";
};

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}
export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
