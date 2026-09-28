import "server-only";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import reference from "./reference-data.json";

/**
 * Acceso a Postgres con dos drivers intercambiables:
 *  - DATABASE_URL definida  -> postgres.js (Neon, Supabase, Vercel Postgres…)
 *  - sin DATABASE_URL       -> PGlite: Postgres real compilado a WASM, embebido,
 *                              persistido en .data/pglite. Cero configuración.
 *
 * Todas las consultas de la app pasan por `withUser`, que abre una transacción,
 * baja privilegios a `app_user` y fija `app.user_id`: Row Level Security hace
 * el resto. Aunque una query se olvide un WHERE user_id = …, Postgres filtra.
 */

export type Row = Record<string, unknown>;

export interface Queryable {
  query<T = Row>(text: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
}

interface Driver extends Queryable {
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
}

const MIGRATIONS = ["001_init.sql", "002_google_auth.sql", "003_deferred_posting_fk.sql"];

function toSafeNumber(v: string): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error(`Entero fuera de rango seguro: ${v}`);
  return n;
}

async function createPGlite(): Promise<Driver> {
  const { PGlite } = await import("@electric-sql/pglite");
  const dataDir = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
  if (!dataDir.startsWith("memory://")) mkdirSync(dataDir, { recursive: true });
  const pg = await PGlite.create(dataDir, {
    parsers: {
      20: toSafeNumber, // int8 -> number (centavos, validado)
      1082: (v: string) => v, // date -> 'YYYY-MM-DD'
    },
  });
  const wrap = (tx: {
    query: (t: string, p?: unknown[]) => Promise<{ rows: unknown[] }>;
    exec: (s: string) => Promise<unknown>;
  }): Queryable => ({
    query: async <T,>(t: string, p?: unknown[]) => (await tx.query(t, p)).rows as T[],
    exec: async (s: string) => {
      await tx.exec(s);
    },
  });
  return {
    ...wrap(pg),
    transaction: (fn) => pg.transaction((tx) => fn(wrap(tx))),
  };
}

/**
 * postgres.js en modo `unsafe` infiere el tipo de un array por su primer
 * elemento. Lo mandamos como literal de array; las queries siempre castean
 * explícitamente ($1::uuid[], $2::bigint[]…).
 */
function toPgArrayLiteral(values: unknown[]): string {
  const items = values.map((v) =>
    v === null || v === undefined ? "NULL" : `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`,
  );
  return `{${items.join(",")}}`;
}

/**
 * postgres.js reenvía los parámetros de la URL que no conoce como parámetros de
 * conexión. `channel_binding` (que Neon incluye) es solo de libpq y el servidor
 * lo rechazaría.
 */
function normalizeDatabaseUrl(url: string): string {
  const u = new URL(url);
  u.searchParams.delete("channel_binding");
  return u.toString();
}

async function createPostgres(url: string): Promise<Driver> {
  const { default: postgres } = await import("postgres");
  const sql = postgres(normalizeDatabaseUrl(url), {
    max: Number(process.env.DB_POOL_MAX ?? 5),
    prepare: false, // compatible con poolers en modo transacción (pgbouncer)
    types: {
      bigint: { to: 20, from: [20], serialize: (x: number) => String(x), parse: toSafeNumber },
      date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
    },
    onnotice: () => {},
  });
  type Tx = typeof sql;
  const wrap = (tx: Tx): Queryable => ({
    query: async <T,>(t: string, p?: unknown[]) =>
      (await tx.unsafe(
        t,
        (p ?? []).map((v) => (Array.isArray(v) ? toPgArrayLiteral(v) : v)) as never[],
      )) as unknown as T[],
    exec: async (s: string) => {
      await tx.unsafe(s).simple();
    },
  });
  return {
    ...wrap(sql),
    transaction: (fn) => sql.begin((tx) => fn(wrap(tx as unknown as Tx))) as Promise<never>,
  };
}

async function migrate(db: Driver) {
  await db.exec(`create table if not exists schema_migrations (
    name text primary key, applied_at timestamptz not null default now())`);
  const applied = new Set(
    (await db.query<{ name: string }>("select name from schema_migrations")).map((r) => r.name),
  );

  for (const name of MIGRATIONS) {
    if (applied.has(name)) continue;
    const file = path.join(process.cwd(), "src", "db", "migrations", name);
    const sqlText = readFileSync(file, "utf8");
    await db.transaction(async (q) => {
      await q.query("select pg_advisory_xact_lock(727274)");
      const again = await q.query("select 1 from schema_migrations where name = $1", [name]);
      if (again.length) return;
      await q.exec(sqlText);
      await q.query("insert into schema_migrations (name) values ($1)", [name]);
    });
  }

  // Series de referencia (IPC + dólar): se recargan cuando cambia el snapshot.
  const refKey = `reference:${reference.generatedAt}`;
  if (!applied.has(refKey)) {
    await db.transaction(async (q) => {
      await q.query(
        `insert into cpi (month, index_value)
         select * from unnest($1::date[], $2::numeric[])
         on conflict (month) do update set index_value = excluded.index_value`,
        [reference.cpi.map((r) => r.month), reference.cpi.map((r) => r.value)],
      );
      await q.query(
        `insert into exchange_rates (month, kind, ars_per_usd)
         select * from unnest($1::date[], $2::text[], $3::numeric[])
         on conflict (month, kind) do update set ars_per_usd = excluded.ars_per_usd`,
        [
          reference.fx.map((r) => r.month),
          reference.fx.map((r) => r.kind),
          reference.fx.map((r) => r.arsPerUsd),
        ],
      );
      await q.query(
        "insert into schema_migrations (name) values ($1) on conflict do nothing",
        [refKey],
      );
    });
  }
}

const globalForDb = globalThis as unknown as { __finanzasDb?: Promise<Driver> };

export function getDb(): Promise<Driver> {
  if (!globalForDb.__finanzasDb) {
    const url = process.env.DATABASE_URL;
    if (!url && process.env.VERCEL) {
      return Promise.reject(
        new Error("Falta configurar DATABASE_URL: en Vercel no se puede usar la base local (disco de solo lectura)."),
      );
    }
    globalForDb.__finanzasDb = (async () => {
      const db = url ? await createPostgres(url) : await createPGlite();
      await migrate(db);
      return db;
    })().catch((err) => {
      globalForDb.__finanzasDb = undefined;
      throw err;
    });
  }
  return globalForDb.__finanzasDb;
}

/** Ejecuta `fn` como `app_user` con RLS activo para `userId`. */
export async function withUser<T>(
  userId: string,
  fn: (q: Queryable) => Promise<T>,
  opts: { readOnly?: boolean; statementTimeoutMs?: number } = {},
): Promise<T> {
  const db = await getDb();
  return db.transaction(async (q) => {
    if (opts.readOnly) await q.query("set transaction read only");
    if (opts.statementTimeoutMs) {
      await q.query("select set_config('statement_timeout', $1, true)", [
        String(opts.statementTimeoutMs),
      ]);
    }
    await q.query("set local role app_user");
    await q.query("select set_config('app.user_id', $1, true)", [userId]);
    return fn(q);
  });
}

/**
 * Acceso con el rol dueño del esquema (sin RLS). Solo para autenticación,
 * alta de usuarios y carga de la demo — nunca para datos de una request.
 */
export async function asOwner<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
  const db = await getDb();
  return db.transaction(fn);
}
