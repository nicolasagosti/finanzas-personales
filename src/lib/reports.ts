import "server-only";
import type { Queryable } from "@/db/client";
import { addMonths, monthEnd, monthRange } from "@/lib/dates";
import type { Currency } from "@/lib/money";

/**
 * Reportes. Ninguna query filtra por user_id: de eso se encarga Row Level
 * Security, porque todas corren dentro de `withUser`.
 */

export type FxKind = "oficial" | "mep" | "blue";
export type ViewMode = { currency: Currency; fx: FxKind; real: boolean };

export type Reference = {
  cpi: Map<string, number>;
  fx: Map<string, number>;
  latestCpiMonth: string;
};

export async function loadReference(q: Queryable): Promise<Reference> {
  const cpiRows = await q.query<{ month: string; v: number }>(
    "select month, index_value::float8 as v from cpi order by month",
  );
  const fxRows = await q.query<{ month: string; kind: string; v: number }>(
    "select month, kind, ars_per_usd::float8 as v from exchange_rates order by month",
  );
  return {
    cpi: new Map(cpiRows.map((r) => [r.month, r.v])),
    fx: new Map(fxRows.map((r) => [`${r.month}|${r.kind}`, r.v])),
    latestCpiMonth: cpiRows.at(-1)?.month ?? "",
  };
}

/** Último valor disponible a la fecha (el IPC se publica con ~1 mes de rezago). */
function lookup(map: Map<string, number>, month: string, suffix = ""): number {
  let m = month;
  for (let i = 0; i < 36; i++) {
    const v = map.get(m + suffix);
    if (v) return v;
    m = addMonths(m, -1);
  }
  throw new Error(`Sin datos de referencia para ${month}${suffix}`);
}

export function fxRate(ref: Reference, month: string, kind: FxKind): number {
  return lookup(ref.fx, month, `|${kind}`);
}

/** Convierte centavos ARS de un mes según el modo de vista. */
export function convertArs(ref: Reference, cents: number, month: string, mode: ViewMode): number {
  if (mode.currency === "USD") return Math.round(cents / fxRate(ref, month, mode.fx));
  if (mode.real) {
    const factor = lookup(ref.cpi, ref.latestCpiMonth) / lookup(ref.cpi, month);
    return Math.round(cents * factor);
  }
  return cents;
}

export type MonthlyFlow = { month: string; income: number; expense: number };

export async function monthlyFlows(q: Queryable, from: string, to: string): Promise<MonthlyFlow[]> {
  const rows = await q.query<MonthlyFlow>(
    `select date_trunc('month', t.occurred_on)::date as month,
            coalesce(sum(-p.amount) filter (where a.kind = 'income'), 0)::bigint as income,
            coalesce(sum(p.amount) filter (where a.kind = 'expense'), 0)::bigint as expense
     from postings p
     join transactions t on t.id = p.transaction_id
     join accounts a on a.id = p.account_id
     where a.kind in ('income', 'expense') and p.currency = 'ARS'
       and t.occurred_on between $1::date and $2::date
     group by 1 order by 1`,
    [from, monthEnd(to)],
  );
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  return monthRange(from, to).map((m) => byMonth.get(m) ?? { month: m, income: 0, expense: 0 });
}

export type NetWorthPoint = { month: string; ars: number; usd: number };

/** Saldo de activos + pasivos al cierre de cada mes, separado por moneda. */
export async function netWorthByMonth(q: Queryable, months: string[]): Promise<NetWorthPoint[]> {
  const rows = await q.query<{ month: string; currency: string; balance: number }>(
    `select m.month, p.currency, coalesce(sum(p.amount), 0)::bigint as balance
     from unnest($1::date[]) as m(month)
     join transactions t on t.occurred_on < (m.month + interval '1 month')
     join postings p on p.transaction_id = t.id
     join accounts a on a.id = p.account_id and a.kind in ('asset', 'liability')
     group by 1, 2`,
    [months],
  );
  return months.map((month) => ({
    month,
    ars: rows.find((r) => r.month === month && r.currency === "ARS")?.balance ?? 0,
    usd: rows.find((r) => r.month === month && r.currency === "USD")?.balance ?? 0,
  }));
}

/** Patrimonio en la moneda de la vista (USD valuado al tipo de cambio del mes). */
export function netWorthIn(ref: Reference, p: NetWorthPoint, mode: ViewMode): number {
  const rate = fxRate(ref, p.month, mode.fx);
  if (mode.currency === "USD") return Math.round(p.ars / rate) + p.usd;
  const arsTotal = p.ars + Math.round(p.usd * rate);
  return convertArs(ref, arsTotal, p.month, { ...mode, currency: "ARS" });
}

export type CategorySpend = { id: string; name: string; total: number; avgPrev3: number };

export async function expensesByCategory(q: Queryable, month: string): Promise<CategorySpend[]> {
  return q.query<CategorySpend>(
    `select a.id, a.name,
            coalesce(sum(p.amount) filter (where t.occurred_on >= $1::date), 0)::bigint as total,
            round(coalesce(sum(p.amount) filter (where t.occurred_on < $1::date), 0) / 3.0)::bigint as "avgPrev3"
     from postings p
     join transactions t on t.id = p.transaction_id
     join accounts a on a.id = p.account_id
     where a.kind = 'expense' and p.currency = 'ARS'
       and t.occurred_on >= $2::date and t.occurred_on <= $3::date
     group by a.id, a.name
     having sum(p.amount) filter (where t.occurred_on >= $1::date) <> 0
     order by total desc`,
    [month, addMonths(month, -3), monthEnd(month)],
  );
}

export type AccountBalance = {
  id: string;
  name: string;
  kind: "asset" | "liability";
  currency: Currency;
  balance: number;
  movements: number;
  lastMovement: string | null;
};

export async function accountBalances(q: Queryable): Promise<AccountBalance[]> {
  return q.query<AccountBalance>(
    `select a.id, a.name, a.kind::text as kind, a.currency,
            coalesce(sum(p.amount), 0)::bigint as balance,
            count(p.id)::bigint as movements,
            max(t.occurred_on) as "lastMovement"
     from accounts a
     left join postings p on p.account_id = a.id
     left join transactions t on t.id = p.transaction_id
     where a.kind in ('asset', 'liability') and not a.archived
     group by a.id
     order by a.kind, a.currency, a.name`,
  );
}

export type BudgetLine = { id: string; name: string; budget: number; spent: number };

export async function budgetForMonth(q: Queryable, month: string): Promise<BudgetLine[]> {
  return q.query<BudgetLine>(
    `select a.id, a.name, coalesce(b.amount, 0)::bigint as budget,
            coalesce((
              select sum(p.amount) from postings p
              join transactions t on t.id = p.transaction_id
              where p.account_id = a.id and t.occurred_on between $1::date and $2::date
            ), 0)::bigint as spent
     from accounts a
     left join budgets b on b.account_id = a.id
     where a.kind = 'expense' and not a.is_system and not a.archived
     order by coalesce(b.amount, 0) desc, a.name`,
    [month, monthEnd(month)],
  );
}

export type Category = { id: string; name: string; kind: "income" | "expense"; isSystem: boolean };

export async function listCategories(q: Queryable): Promise<Category[]> {
  return q.query<Category>(
    `select id, name, kind::text as kind, is_system as "isSystem"
     from accounts where kind in ('income', 'expense') and not archived
     order by kind desc, is_system, name`,
  );
}

export type MoneyAccount = { id: string; name: string; kind: "asset" | "liability"; currency: Currency };

export async function listMoneyAccounts(q: Queryable): Promise<MoneyAccount[]> {
  return q.query<MoneyAccount>(
    `select id, name, kind::text as kind, currency from accounts
     where kind in ('asset', 'liability') and not archived
     order by kind, currency, name`,
  );
}

// ---------------------------------------------------------------------------
// Movimientos
// ---------------------------------------------------------------------------

type RawPosting = { accountId: string; name: string; kind: string; amount: number; currency: Currency };

export type TransactionRow = {
  id: string;
  date: string;
  description: string;
  source: string;
  type: "expense" | "income" | "transfer" | "fx" | "opening";
  amount: number; // centavos con signo desde el punto de vista del dinero
  currency: Currency;
  account: string;
  accountId: string | null;
  category: string | null;
  categoryId: string | null;
  counterpart: string | null;
  postings: RawPosting[];
};

function describe(t: { id: string; date: string; description: string; source: string; postings: RawPosting[] }): TransactionRow {
  const cat = t.postings.find((p) => p.kind === "income" || p.kind === "expense");
  const money = t.postings.filter((p) => p.kind === "asset" || p.kind === "liability");
  const equity = t.postings.find((p) => p.kind === "equity");
  const base = { id: t.id, date: t.date, description: t.description, source: t.source, postings: t.postings };

  if (cat && money[0]) {
    return {
      ...base,
      type: cat.kind === "income" ? "income" : "expense",
      amount: money[0].amount,
      currency: money[0].currency,
      account: money[0].name,
      accountId: money[0].accountId,
      category: cat.name,
      categoryId: cat.accountId,
      counterpart: null,
    };
  }
  if (equity && money.length === 2) {
    const to = money.find((p) => p.amount > 0)!;
    const from = money.find((p) => p.amount < 0)!;
    return {
      ...base,
      type: "fx",
      amount: to.amount,
      currency: to.currency,
      account: to.name,
      accountId: to.accountId,
      category: null,
      categoryId: null,
      counterpart: `${from.name} (${from.currency})`,
    };
  }
  if (equity && money.length === 1) {
    return {
      ...base,
      type: "opening",
      amount: money[0].amount,
      currency: money[0].currency,
      account: money[0].name,
      accountId: money[0].accountId,
      category: null,
      categoryId: null,
      counterpart: null,
    };
  }
  const to = money.find((p) => p.amount > 0) ?? money[0];
  const from = money.find((p) => p.amount < 0) ?? money[1];
  return {
    ...base,
    type: "transfer",
    amount: to?.amount ?? 0,
    currency: to?.currency ?? "ARS",
    account: to?.name ?? "",
    accountId: to?.accountId ?? null,
    category: null,
    categoryId: null,
    counterpart: from?.name ?? null,
  };
}

export type TransactionFilters = {
  month?: string;
  accountId?: string;
  categoryId?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

export async function listTransactions(
  q: Queryable,
  f: TransactionFilters,
): Promise<{ rows: TransactionRow[]; total: number }> {
  const where: string[] = [];
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (f.month) where.push(`t.occurred_on between ${p(f.month)}::date and ${p(monthEnd(f.month))}::date`);
  if (f.accountId) where.push(`exists (select 1 from postings x where x.transaction_id = t.id and x.account_id = ${p(f.accountId)}::uuid)`);
  if (f.categoryId) where.push(`exists (select 1 from postings x where x.transaction_id = t.id and x.account_id = ${p(f.categoryId)}::uuid)`);
  if (f.search) {
    const escaped = f.search.replace(/[\\%_]/g, (c) => "\\" + c);
    where.push(`t.description ilike ${p(`%${escaped}%`)}`);
  }
  const whereSql = where.length ? `where ${where.join(" and ")}` : "";

  const [{ total }] = await q.query<{ total: number }>(
    `select count(*)::bigint as total from transactions t ${whereSql}`,
    params,
  );
  const limit = p(f.limit ?? 50);
  const offset = p(f.offset ?? 0);
  const rows = await q.query<{ id: string; date: string; description: string; source: string; postings: RawPosting[] }>(
    `select t.id, t.occurred_on as date, t.description, t.source,
            (select json_agg(json_build_object(
                'accountId', a.id, 'name', a.name, 'kind', a.kind,
                'amount', px.amount, 'currency', px.currency) order by px.amount)
             from postings px join accounts a on a.id = px.account_id
             where px.transaction_id = t.id) as postings
     from transactions t
     ${whereSql}
     order by t.occurred_on desc, t.created_at desc, t.id
     limit ${limit} offset ${offset}`,
    params,
  );
  return { rows: rows.map(describe), total };
}
