import type { TableName, Tables } from "./types.ts";
import { uid } from "./util.ts";

export interface StoredFile {
  bytes: Uint8Array;
  mime: string;
}

/** The agents talk to data only through this interface, so the same pipeline runs in the browser
 *  (demo mode, MemoryStore) and in Supabase Edge Functions (SupabaseStore). */
export interface Store {
  list<T extends TableName>(table: T, match?: Partial<Tables[T]>): Promise<Tables[T][]>;
  get<T extends TableName>(table: T, id: string): Promise<Tables[T] | null>;
  insert<T extends TableName>(table: T, row: Partial<Tables[T]>): Promise<Tables[T]>;
  insertMany<T extends TableName>(table: T, rows: Partial<Tables[T]>[]): Promise<void>;
  update<T extends TableName>(table: T, id: string, patch: Partial<Tables[T]>): Promise<Tables[T]>;
  remove<T extends TableName>(table: T, match: Partial<Tables[T]>): Promise<void>;
  putFile(path: string, bytes: Uint8Array, mime: string): Promise<void>;
  getFile(path: string): Promise<StoredFile | null>;
}

export type DB = { [K in TableName]: Tables[K][] };
export const emptyDB = (): DB => ({
  vendors: [], purchase_orders: [], bills: [], bill_lines: [], validation_results: [], approval_rules: [],
  approvals: [], trace_events: [], emails: [], vendor_messages: [], extraction_runs: [],
});

const matches = (row: Record<string, unknown>, match?: Record<string, unknown>) =>
  !match || Object.entries(match).every(([k, v]) => row[k] === v);

export class MemoryStore implements Store {
  constructor(public db: DB = emptyDB(), public files = new Map<string, StoredFile>(), private now: () => Date = () => new Date()) {}

  async list<T extends TableName>(table: T, match?: Partial<Tables[T]>) {
    return (this.db[table] as Tables[T][]).filter((r) => matches(r as never, match as never)).map((r) => structuredClone(r));
  }
  async get<T extends TableName>(table: T, id: string) {
    const r = (this.db[table] as { id: string }[]).find((x) => x.id === id);
    return r ? (structuredClone(r) as Tables[T]) : null;
  }
  async insert<T extends TableName>(table: T, row: Partial<Tables[T]>) {
    const ts = this.now().toISOString();
    const full = { id: uid(), created_at: ts, ...(table === "bills" ? { updated_at: ts } : {}), ...row } as unknown as Tables[T];
    (this.db[table] as Tables[T][]).push(full);
    return structuredClone(full);
  }
  async insertMany<T extends TableName>(table: T, rows: Partial<Tables[T]>[]) {
    for (const r of rows) await this.insert(table, r);
  }
  async update<T extends TableName>(table: T, id: string, patch: Partial<Tables[T]>) {
    const arr = this.db[table] as unknown as Record<string, unknown>[];
    const i = arr.findIndex((x) => x.id === id);
    if (i < 0) throw new Error(`${table} ${id} not found`);
    arr[i] = { ...arr[i], ...patch, ...(table === "bills" && !("updated_at" in patch) ? { updated_at: this.now().toISOString() } : {}) };
    return structuredClone(arr[i]) as unknown as Tables[T];
  }
  async remove<T extends TableName>(table: T, match: Partial<Tables[T]>) {
    (this.db as Record<string, unknown[]>)[table] = (this.db[table] as unknown[]).filter((r) => !matches(r as never, match as never));
  }
  async putFile(path: string, bytes: Uint8Array, mime: string) {
    this.files.set(path, { bytes, mime });
  }
  async getFile(path: string) {
    return this.files.get(path) ?? null;
  }
}

// Minimal structural type of a supabase-js client, so this file has no runtime import and runs in both Vite and Deno.
// deno-lint-ignore no-explicit-any
type SB = any;

export class SupabaseStore implements Store {
  constructor(public sb: SB, private bucket = "invoices", private now: () => Date = () => new Date()) {}
  private check<R>(res: { data: R; error: { message: string } | null }): R {
    if (res.error) throw new Error(res.error.message);
    return res.data;
  }
  async list<T extends TableName>(table: T, match?: Partial<Tables[T]>) {
    let q = this.sb.from(table).select("*");
    if (match) q = q.match(match);
    return this.check(await q) as Tables[T][];
  }
  async get<T extends TableName>(table: T, id: string) {
    return this.check(await this.sb.from(table).select("*").eq("id", id).maybeSingle()) as Tables[T] | null;
  }
  async insert<T extends TableName>(table: T, row: Partial<Tables[T]>) {
    return this.check(await this.sb.from(table).insert(row).select().single()) as Tables[T];
  }
  async insertMany<T extends TableName>(table: T, rows: Partial<Tables[T]>[]) {
    if (rows.length) this.check(await this.sb.from(table).insert(rows));
  }
  async update<T extends TableName>(table: T, id: string, patch: Partial<Tables[T]>) {
    const p = table === "bills" && !("updated_at" in patch) ? { ...patch, updated_at: this.now().toISOString() } : patch;
    return this.check(await this.sb.from(table).update(p).eq("id", id).select().single()) as Tables[T];
  }
  async remove<T extends TableName>(table: T, match: Partial<Tables[T]>) {
    this.check(await this.sb.from(table).delete().match(match));
  }
  async putFile(path: string, bytes: Uint8Array, mime: string) {
    this.check(await this.sb.storage.from(this.bucket).upload(path, bytes, { contentType: mime, upsert: true }));
  }
  async getFile(path: string) {
    const { data, error } = await this.sb.storage.from(this.bucket).download(path);
    if (error || !data) return null;
    return { bytes: new Uint8Array(await data.arrayBuffer()), mime: data.type || "application/octet-stream" };
  }
}
