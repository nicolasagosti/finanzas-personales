import "server-only";
import type { Queryable } from "@/db/client";
import reference from "@/db/reference-data.json";
import { addMonths, daysInMonth, monthRange, monthStart, todayISO } from "@/lib/dates";
import {
  fxPurchaseTransaction,
  insertTransactions,
  simpleTransaction,
  transferTransaction,
  type AccountKind,
  type TransactionInput,
} from "@/lib/ledger";
import type { Currency } from "@/lib/money";

type AccountSeed = { key: string; name: string; kind: AccountKind; currency?: Currency; system?: boolean };

const DEFAULT_ACCOUNTS: AccountSeed[] = [
  // Dinero
  { key: "banco", name: "Cuenta sueldo", kind: "asset" },
  { key: "billetera", name: "Billetera virtual", kind: "asset" },
  { key: "efectivo", name: "Efectivo", kind: "asset" },
  { key: "usd", name: "Ahorro en dólares", kind: "asset", currency: "USD" },
  { key: "tarjeta", name: "Tarjeta de crédito", kind: "liability" },
  // Ingresos
  { key: "sueldo", name: "Sueldo", kind: "income" },
  { key: "freelance", name: "Trabajos freelance", kind: "income" },
  { key: "rendimientos", name: "Rendimientos", kind: "income" },
  { key: "sincatIn", name: "Sin categorizar", kind: "income", system: true },
  // Gastos
  { key: "alquiler", name: "Alquiler", kind: "expense" },
  { key: "super", name: "Supermercado", kind: "expense" },
  { key: "delivery", name: "Delivery", kind: "expense" },
  { key: "restaurantes", name: "Restaurantes y bares", kind: "expense" },
  { key: "transporte", name: "Transporte", kind: "expense" },
  { key: "servicios", name: "Servicios del hogar", kind: "expense" },
  { key: "suscripciones", name: "Suscripciones", kind: "expense" },
  { key: "salud", name: "Salud", kind: "expense" },
  { key: "ocio", name: "Salidas y ocio", kind: "expense" },
  { key: "ropa", name: "Ropa", kind: "expense" },
  { key: "educacion", name: "Educación", kind: "expense" },
  { key: "regalos", name: "Regalos", kind: "expense" },
  { key: "sincat", name: "Sin categorizar", kind: "expense", system: true },
  // Patrimonio (cuentas técnicas)
  { key: "inicial", name: "Saldo inicial", kind: "equity", system: true },
  { key: "inicialUsd", name: "Saldo inicial", kind: "equity", currency: "USD", system: true },
  { key: "convArs", name: "Conversión de moneda", kind: "equity", system: true },
  { key: "convUsd", name: "Conversión de moneda", kind: "equity", currency: "USD", system: true },
];

const DEFAULT_RULES: [pattern: string, key: string][] = [
  ["SUPERMERCADO", "super"],
  ["AUTOSERVICIO", "super"],
  ["VERDULERIA", "super"],
  ["CARNICERIA", "super"],
  ["MAYORISTA", "super"],
  ["DELIVERY", "delivery"],
  ["SUBE", "transporte"],
  ["VIAJE APP", "transporte"],
  ["COMBUSTIBLE", "transporte"],
  ["PEAJE", "transporte"],
  ["LUZ", "servicios"],
  ["GAS NATURAL", "servicios"],
  ["INTERNET", "servicios"],
  ["TELEFONIA", "servicios"],
  ["STREAMING", "suscripciones"],
  ["PREPAGA", "salud"],
  ["FARMACIA", "salud"],
  ["GIMNASIO", "salud"],
  ["ALQUILER", "alquiler"],
  ["CINE", "ocio"],
  ["TEATRO", "ocio"],
  ["CERVECERIA", "restaurantes"],
  ["RESTO", "restaurantes"],
  ["CAFE", "restaurantes"],
  ["INSTITUTO DE INGLES", "educacion"],
  ["HABERES", "sueldo"],
];

/** Crea el usuario con su plan de cuentas y reglas por defecto. */
export async function createUserWithDefaults(
  q: Queryable,
  user: { email: string; name: string; isDemo: boolean },
): Promise<{ userId: string; accounts: Record<string, string> }> {
  const [{ id: userId }] = await q.query<{ id: string }>(
    "insert into users (email, name, is_demo) values ($1, $2, $3) returning id",
    [user.email, user.name, user.isDemo],
  );
  await q.query(
    `insert into accounts (user_id, name, kind, currency, is_system)
     select $1::uuid, a.name, a.kind::account_kind, a.cur, a.sys
     from unnest($2::text[], $3::text[], $4::text[], $5::boolean[]) as a(name, kind, cur, sys)`,
    [
      userId,
      DEFAULT_ACCOUNTS.map((a) => a.name),
      DEFAULT_ACCOUNTS.map((a) => a.kind),
      DEFAULT_ACCOUNTS.map((a) => a.currency ?? "ARS"),
      DEFAULT_ACCOUNTS.map((a) => a.system ?? false),
    ],
  );
  const all = await q.query<{ id: string; name: string; kind: string; currency: string }>(
    "select id, name, kind::text, currency from accounts where user_id = $1",
    [userId],
  );
  const accounts: Record<string, string> = {};
  for (const a of DEFAULT_ACCOUNTS) {
    const found = all.find(
      (r) => r.name === a.name && r.kind === a.kind && r.currency === (a.currency ?? "ARS"),
    );
    if (!found) throw new Error(`No se creó la cuenta ${a.name}`);
    accounts[a.key] = found.id;
  }
  await q.query(
    `insert into rules (user_id, pattern, account_id, priority)
     select $1::uuid, r.pattern, r.acc, r.prio
     from unnest($2::text[], $3::uuid[], $4::int[]) as r(pattern, acc, prio)`,
    [
      userId,
      DEFAULT_RULES.map(([p]) => p),
      DEFAULT_RULES.map(([, k]) => accounts[k]),
      DEFAULT_RULES.map((_, i) => 100 + i),
    ],
  );
  return { userId, accounts };
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
  const mep = reference.fx
    .filter((f) => f.kind === "mep")
    .map((f) => ({ month: f.month, value: f.arsPerUsd }));
  const cpiToday = lookupMonthly(cpi, current);
  // precio "de hoy" llevado al mes m según el IPC real
  const priceAt = (month: string, pesosToday: number, jitter = 0.12) => {
    const factor = lookupMonthly(cpi, month) / cpiToday;
    const value = pesosToday * factor * between(1 - jitter, 1 + jitter);
    return Math.round(value / 10) * 10 * 100; // pesos redondos -> centavos
  };

  const txs: TransactionInput[] = [];
  const add = (t: TransactionInput) => {
    if (t.date <= today) txs.push({ ...t, source: "seed" });
  };
  const day = (month: string, d: number) =>
    `${month.slice(0, 8)}${String(Math.min(Math.max(1, Math.round(d)), daysInMonth(month))).padStart(2, "0")}`;

  const expense = (month: string, d: number, desc: string, cat: string, money: string, pesosToday: number, jitter?: number) => {
    const amount = priceAt(month, pesosToday, jitter);
    add(simpleTransaction({ date: day(month, d), description: desc, amount: -amount, moneyAccountId: acc[money], categoryAccountId: acc[cat] }));
    return amount;
  };

  // Saldos iniciales
  const first = months[0];
  add(simpleTransaction({ date: first, description: "Saldo inicial", amount: priceAt(first, 900_000, 0), moneyAccountId: acc.banco, categoryAccountId: acc.inicial }));
  add(simpleTransaction({ date: first, description: "Saldo inicial", amount: priceAt(first, 120_000, 0), moneyAccountId: acc.billetera, categoryAccountId: acc.inicial }));
  add(simpleTransaction({ date: first, description: "Saldo inicial", amount: priceAt(first, 40_000, 0), moneyAccountId: acc.efectivo, categoryAccountId: acc.inicial }));
  add(simpleTransaction({ date: first, description: "Saldo inicial", amount: 2_800_00, currency: "USD", moneyAccountId: acc.usd, categoryAccountId: acc.inicialUsd }));

  let bankBalance = priceAt(first, 900_000, 0);
  let previousCardTotal = 0;

  months.forEach((month, i) => {
    const flows = { bankIn: 0, bankOut: 0, card: 0, wallet: 0, cash: 0, walletIn: 0 };

    // Sueldo: se actualiza por paritaria cada 3 meses (va un poco atrás del IPC)
    const salaryMonth = months[Math.floor(i / 3) * 3];
    const salary = priceAt(salaryMonth, 2_650_000, 0);
    add(simpleTransaction({ date: day(month, 1 + rand() * 2), description: "HABERES MENSUALES", amount: salary, moneyAccountId: acc.banco, categoryAccountId: acc.sueldo }));
    flows.bankIn += salary;
    const m = Number(month.slice(5, 7));
    if (m === 6 || m === 12) {
      const sac = Math.round(salary / 2 / 100) * 100;
      add(simpleTransaction({ date: day(month, 18), description: "HABERES SAC AGUINALDO", amount: sac, moneyAccountId: acc.banco, categoryAccountId: acc.sueldo }));
      flows.bankIn += sac;
    }
    if (i % 3 === 1) {
      const fee = priceAt(month, between(300_000, 700_000), 0);
      add(simpleTransaction({ date: day(month, between(8, 25)), description: "TRANSFERENCIA RECIBIDA PROYECTO WEB", amount: fee, moneyAccountId: acc.billetera, categoryAccountId: acc.freelance }));
      flows.walletIn += fee;
    }
    const yieldAmt = priceAt(month, between(9_000, 18_000), 0);
    add(simpleTransaction({ date: day(month, 28), description: "RENDIMIENTO CUENTA REMUNERADA", amount: yieldAmt, moneyAccountId: acc.billetera, categoryAccountId: acc.rendimientos }));

    // Fijos desde la cuenta sueldo (el alquiler ajusta cada 3 meses)
    const rentMonth = months[Math.floor((i + 1) / 3) * 3] ?? month;
    flows.bankOut += expense(month, 6, "TRANSFERENCIA ALQUILER DEPTO", "alquiler", "banco", 720_000 * (lookupMonthly(cpi, rentMonth) / lookupMonthly(cpi, month)), 0);
    flows.bankOut += expense(month, 3, "DEBITO AUTOMATICO PREPAGA", "salud", "banco", 195_000, 0.02);
    flows.bankOut += expense(month, 11, "DEBITO LUZ EMPRESA ELECTRICA", "servicios", "banco", 48_000, 0.25);
    flows.bankOut += expense(month, 13, "DEBITO GAS NATURAL", "servicios", "banco", m >= 5 && m <= 8 ? 62_000 : 24_000, 0.2);
    flows.bankOut += expense(month, 9, "INTERNET FIBRA HOGAR", "servicios", "banco", 31_000, 0.02);
    flows.bankOut += expense(month, 9, "TELEFONIA MOVIL", "servicios", "banco", 23_000, 0.02);
    flows.bankOut += expense(month, 4, "INSTITUTO DE INGLES CUOTA", "educacion", "banco", 78_000, 0.01);

    // Tarjeta de crédito
    flows.card += expense(month, 2, "STREAMING VIDEO PREMIUM", "suscripciones", "tarjeta", 14_500, 0.01);
    flows.card += expense(month, 2, "STREAMING MUSICA FAMILIAR", "suscripciones", "tarjeta", 6_800, 0.01);
    flows.card += expense(month, 5, "GIMNASIO CUOTA MENSUAL", "salud", "tarjeta", 42_000, 0.01);
    for (let k = 0; k < 3 + Math.floor(rand() * 2); k++) {
      flows.card += expense(month, between(1, 28), pick(["SUPERMERCADO COTO SUC 45", "SUPERMERCADO BARRIO", "MAYORISTA ZONA OESTE"]), "super", "tarjeta", between(70_000, 150_000));
    }
    for (let k = 0; k < 2 + Math.floor(rand() * 3); k++) {
      flows.card += expense(month, between(1, 28), pick(["RESTO PARRILLA", "CERVECERIA ARTESANAL", "CAFE DE ESPECIALIDAD", "RESTO PASTAS"]), "restaurantes", "tarjeta", between(22_000, 85_000));
    }
    if (rand() < 0.6 || m === 12 || m === 5) {
      flows.card += expense(month, between(3, 27), pick(["TIENDA DE ROPA ONLINE", "ZAPATERIA CENTRO", "INDUMENTARIA DEPORTIVA"]), "ropa", "tarjeta", between(45_000, 160_000));
    }
    if (m === 12 || rand() < 0.2) {
      flows.card += expense(month, m === 12 ? between(15, 23) : between(1, 28), "JUGUETERIA Y REGALOS", "regalos", "tarjeta", m === 12 ? 190_000 : 45_000);
    }
    if (rand() < 0.3) {
      flows.card += expense(month, between(1, 28), "ENTRADAS RECITAL", "ocio", "tarjeta", between(60_000, 110_000));
    }

    // Billetera virtual
    for (let k = 0; k < 5 + Math.floor(rand() * 6); k++) {
      flows.wallet += expense(month, between(1, 28), pick(["DELIVERY PIZZERIA", "DELIVERY SUSHI", "DELIVERY HAMBURGUESAS", "DELIVERY EMPANADAS"]), "delivery", "billetera", between(14_000, 34_000));
    }
    for (let k = 0; k < 3 + Math.floor(rand() * 3); k++) {
      flows.wallet += expense(month, between(1, 28), "CARGA SUBE", "transporte", "billetera", between(8_000, 15_000), 0.05);
    }
    for (let k = 0; k < 2 + Math.floor(rand() * 4); k++) {
      flows.wallet += expense(month, between(1, 28), "VIAJE APP MOVILIDAD", "transporte", "billetera", between(7_000, 19_000));
    }
    flows.wallet += expense(month, between(1, 28), "FARMACIA DEL PUEBLO", "salud", "billetera", between(12_000, 38_000));
    if (rand() < 0.5) flows.wallet += expense(month, between(1, 28), "CINE COMPLEJO", "ocio", "billetera", 28_000, 0.1);

    // Efectivo
    for (let k = 0; k < 2 + Math.floor(rand() * 3); k++) {
      flows.cash += expense(month, between(1, 28), pick(["VERDULERIA", "CARNICERIA", "KIOSCO"]), pick(["super", "super", "super"]), "efectivo", between(12_000, 42_000));
    }

    // Transferencias internas: fondear billetera y efectivo, pagar la tarjeta
    const walletFunding = Math.max(0, Math.ceil((flows.wallet - flows.walletIn) / 5_000_000) * 5_000_000);
    if (walletFunding > 0) {
      add(transferTransaction({ date: day(month, 2), description: "TRANSFERENCIA A BILLETERA VIRTUAL", amount: walletFunding, fromAccountId: acc.banco, toAccountId: acc.billetera }));
      flows.bankOut += walletFunding;
    }
    const cashOut = Math.ceil(flows.cash / 1_000_000) * 1_000_000;
    add(transferTransaction({ date: day(month, 3), description: "EXTRACCION CAJERO", amount: cashOut, fromAccountId: acc.banco, toAccountId: acc.efectivo }));
    flows.bankOut += cashOut;
    if (previousCardTotal > 0) {
      add(transferTransaction({ date: day(month, 10), description: "PAGO RESUMEN TARJETA", amount: previousCardTotal, fromAccountId: acc.banco, toAccountId: acc.tarjeta }));
      flows.bankOut += previousCardTotal;
    }
    previousCardTotal = flows.card;

    // Lo que sobra se dolariza al MEP del mes (dejando un colchón)
    bankBalance += flows.bankIn - flows.bankOut;
    const buffer = priceAt(month, 450_000, 0);
    const rate = lookupMonthly(mep, month);
    const usd = Math.floor(((bankBalance - buffer) * 0.7) / 100 / rate / 10) * 10;
    if (usd >= 50 && day(month, 20) <= today) {
      const ars = Math.round(usd * rate) * 100;
      add(fxPurchaseTransaction({ date: day(month, 20), description: `COMPRA USD MEP ${usd} @ ${rate.toFixed(2)}`, arsAmount: ars, usdAmount: usd * 100, fromArsAccountId: acc.banco, toUsdAccountId: acc.usd, conversionArsId: acc.convArs, conversionUsdId: acc.convUsd }));
      bankBalance -= ars;
    }
  });

  txs.sort((a, b) => a.date.localeCompare(b.date));
  await insertTransactions(q, userId, txs);

  // Presupuesto mensual: promedio de los 3 meses anteriores + 10 %, redondeado a $10.000
  await q.query(
    `insert into budgets (user_id, account_id, amount)
     select $1::uuid, p.account_id, (ceil(sum(p.amount) * 1.1 / 3.0 / 1000000) * 1000000)::bigint
     from postings p
     join transactions t on t.id = p.transaction_id
     join accounts a on a.id = p.account_id
     where p.user_id = $1 and a.kind = 'expense' and not a.is_system
       and t.occurred_on >= $2::date and t.occurred_on < $3::date
     group by p.account_id`,
    [userId, addMonths(current, -3), current],
  );
}
