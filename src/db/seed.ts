import "server-only";
import type { Queryable } from "@/db/client";
import reference from "@/db/reference-data.json";
import { addMonths, daysInMonth, monthRange, monthStart, todayISO } from "@/lib/dates";
import { insertTransactions, simpleTransaction, type AccountKind, type TransactionInput } from "@/lib/ledger";
import type { CategoryColor } from "@/lib/colors";

/**
 * Plan de cuentas por defecto. El usuario solo ve categorías de ingreso y
 * egreso; "Mi dinero" es la contrapartida contable de todos los movimientos.
 */
type AccountSeed = { key: string; name: string; kind: AccountKind; color?: CategoryColor; system?: boolean };

export const MONEY_ACCOUNT_NAME = "Mi dinero";

const DEFAULT_ACCOUNTS: AccountSeed[] = [
  { key: "dinero", name: MONEY_ACCOUNT_NAME, kind: "asset", system: true },
  // Ingresos
  { key: "sueldo", name: "Sueldo", kind: "income", color: "aqua" },
  { key: "extra", name: "Trabajos extra", kind: "income", color: "blue" },
  { key: "otrosIngresos", name: "Otros ingresos", kind: "income", color: "violet" },
  // Egresos: uno por color de la paleta
  { key: "vivienda", name: "Vivienda", kind: "expense", color: "blue" },
  { key: "super", name: "Supermercado", kind: "expense", color: "orange" },
  { key: "comida", name: "Comida afuera", kind: "expense", color: "aqua" },
  { key: "transporte", name: "Transporte", kind: "expense", color: "yellow" },
  { key: "ocio", name: "Salidas y suscripciones", kind: "expense", color: "magenta" },
  { key: "salud", name: "Salud", kind: "expense", color: "green" },
  { key: "educacion", name: "Educación", kind: "expense", color: "violet" },
  { key: "compras", name: "Ropa y compras", kind: "expense", color: "red" },
];

/** Crea el usuario con sus categorías por defecto. */
export async function createUserWithDefaults(
  q: Queryable,
  user: { email: string; name: string; isDemo: boolean; googleSub?: string; avatarUrl?: string | null },
): Promise<{ userId: string; accounts: Record<string, string> }> {
  const [{ id: userId }] = await q.query<{ id: string }>(
    `insert into users (email, name, is_demo, google_sub, avatar_url)
     values ($1, $2, $3, $4, $5) returning id`,
    [user.email, user.name, user.isDemo, user.googleSub ?? null, user.avatarUrl ?? null],
  );
  await q.query(
    `insert into accounts (user_id, name, kind, color, is_system)
     select $1::uuid, a.name, a.kind::account_kind, a.color, a.sys
     from unnest($2::text[], $3::text[], $4::text[], $5::boolean[]) as a(name, kind, color, sys)`,
    [
      userId,
      DEFAULT_ACCOUNTS.map((a) => a.name),
      DEFAULT_ACCOUNTS.map((a) => a.kind),
      DEFAULT_ACCOUNTS.map((a) => a.color ?? null),
      DEFAULT_ACCOUNTS.map((a) => a.system ?? false),
    ],
  );
  const all = await q.query<{ id: string; name: string; kind: string }>(
    "select id, name, kind::text as kind from accounts where user_id = $1",
    [userId],
  );
  const accounts: Record<string, string> = {};
  for (const a of DEFAULT_ACCOUNTS) {
    const found = all.find((r) => r.name === a.name && r.kind === a.kind);
    if (!found) throw new Error(`No se creó la cuenta ${a.name}`);
    accounts[a.key] = found.id;
  }
  return { userId, accounts };
}

/** Cuenta contable contra la que se registran los movimientos (se crea si falta). */
export async function moneyAccountId(q: Queryable, userId: string): Promise<string> {
  const [existing] = await q.query<{ id: string }>(
    "select id from accounts where kind = 'asset' and name = $1 and currency = 'ARS'",
    [MONEY_ACCOUNT_NAME],
  );
  if (existing) return existing.id;
  const [created] = await q.query<{ id: string }>(
    "insert into accounts (user_id, name, kind, is_system) values ($1, $2, 'asset', true) returning id",
    [userId, MONEY_ACCOUNT_NAME],
  );
  return created.id;
}

// ---------------------------------------------------------------------------
// Datos sintéticos de demo: 12 meses con precios que siguen el IPC real.
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lookupMonthly(series: { month: string; value: number }[], month: string): number {
  let best = series[0]?.value ?? 1;
  for (const s of series) if (s.month <= month) best = s.value;
  return best;
}

export async function seedDemoData(q: Queryable, userId: string, acc: Record<string, string>) {
  const rand = mulberry32(20260928);
  const between = (min: number, max: number) => min + rand() * (max - min);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];

  const today = todayISO();
  const current = monthStart(today);
  const months = monthRange(addMonths(current, -11), current);
  const cpi = reference.cpi.map((c) => ({ month: c.month, value: c.value }));
  const cpiToday = lookupMonthly(cpi, current);

  // precio "de hoy" llevado al mes según el IPC real, redondeado a pesos (en centavos)
  const priceAt = (month: string, pesosToday: number, jitter = 0.12) => {
    const value = pesosToday * (lookupMonthly(cpi, month) / cpiToday) * between(1 - jitter, 1 + jitter);
    return Math.round(value / 10) * 10 * 100;
  };
  const day = (month: string, d: number) =>
    `${month.slice(0, 8)}${String(Math.min(Math.max(1, Math.round(d)), daysInMonth(month))).padStart(2, "0")}`;

  const txs: TransactionInput[] = [];
  const add = (date: string, description: string, category: string, cents: number) => {
    if (date > today) return;
    txs.push(
      simpleTransaction({
        date,
        description,
        amount: cents,
        moneyAccountId: acc.dinero,
        categoryAccountId: acc[category],
        source: "seed",
      }),
    );
  };
  const income = (month: string, d: number, desc: string, cat: string, pesos: number, jitter = 0) =>
    add(day(month, d), desc, cat, priceAt(month, pesos, jitter));
  const expense = (month: string, d: number, desc: string, cat: string, pesos: number, jitter?: number) =>
    add(day(month, d), desc, cat, -priceAt(month, pesos, jitter));

  months.forEach((month, i) => {
    const m = Number(month.slice(5, 7));

    // Ingresos: el sueldo se actualiza cada 3 meses (va un poco atrás del IPC)
    const salary = priceAt(months[Math.floor(i / 3) * 3], 2_650_000, 0);
    add(day(month, 1 + rand() * 2), "Sueldo", "sueldo", salary);
    if (m === 6 || m === 12) add(day(month, 18), "Aguinaldo", "sueldo", Math.round(salary / 2 / 100) * 100);
    if (i % 3 === 1) {
      income(month, between(8, 25), pick(["Proyecto web", "Clases particulares", "Diseño de logo"]), "extra", between(300_000, 650_000));
    }
    if (rand() < 0.35) {
      income(month, between(5, 27), pick(["Venta de usados", "Reintegro", "Regalo de cumpleaños"]), "otrosIngresos", between(40_000, 150_000));
    }

    // Egresos fijos
    expense(month, 6, "Alquiler", "vivienda", 720_000, 0.01);
    expense(month, 11, "Luz", "vivienda", 48_000, 0.25);
    expense(month, 13, "Gas", "vivienda", m >= 5 && m <= 8 ? 62_000 : 24_000, 0.2);
    expense(month, 9, "Internet y celular", "vivienda", 54_000, 0.02);
    expense(month, 3, "Prepaga", "salud", 195_000, 0.02);
    expense(month, 5, "Gimnasio", "salud", 42_000, 0.01);
    expense(month, 4, "Curso de inglés", "educacion", 78_000, 0.01);
    expense(month, 2, "Streaming", "ocio", 21_000, 0.02);

    // Egresos variables
    for (let k = 0; k < 4 + Math.floor(rand() * 3); k++) {
      expense(month, between(1, 28), pick(["Supermercado", "Verdulería", "Carnicería", "Mayorista"]), "super", between(35_000, 140_000));
    }
    for (let k = 0; k < 5 + Math.floor(rand() * 5); k++) {
      expense(month, between(1, 28), pick(["Delivery", "Restaurante", "Café", "Cervecería"]), "comida", between(14_000, 70_000));
    }
    for (let k = 0; k < 4 + Math.floor(rand() * 4); k++) {
      expense(month, between(1, 28), pick(["Carga SUBE", "Viaje en app", "Nafta"]), "transporte", between(8_000, 45_000));
    }
    if (rand() < 0.6) expense(month, between(1, 28), pick(["Cine", "Recital", "Salida con amigos"]), "ocio", between(25_000, 90_000));
    if (rand() < 0.5) expense(month, between(1, 28), "Farmacia", "salud", between(12_000, 38_000));
    if (rand() < 0.55 || m === 12) {
      expense(month, between(3, 27), pick(["Ropa", "Zapatillas", "Regalos", "Artículos para el hogar"]), "compras", m === 12 ? 190_000 : between(40_000, 150_000));
    }
  });

  txs.sort((a, b) => a.date.localeCompare(b.date));
  await insertTransactions(q, userId, txs);
}
