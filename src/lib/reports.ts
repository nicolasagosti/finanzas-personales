import "server-only";
import type { Queryable } from "@/db/client";
import { monthEnd, monthRange } from "@/lib/dates";

/**
 * Reportes. Ninguna query filtra por user_id: de eso se encarga Row Level
 * Security, porque todas corren dentro de `withUser`.
 */

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

export type CategoryTotal = { id: string; name: string; color: string | null; total: number };

/** Total del mes por categoría de ingreso o egreso, en positivo y de mayor a menor. */
export async function totalsByCategory(
  q: Queryable,
  kind: "income" | "expense",
  month: string,
): Promise<CategoryTotal[]> {
  return q.query<CategoryTotal>(
    `select a.id, a.name, a.color,
            abs(sum(p.amount))::bigint as total
     from postings p
     join transactions t on t.id = p.transaction_id
     join accounts a on a.id = p.account_id
     where a.kind = $1::account_kind and p.currency = 'ARS'
       and t.occurred_on between $2::date and $3::date
     group by a.id, a.name, a.color
     having sum(p.amount) <> 0
     order by total desc`,
    [kind, month, monthEnd(month)],
  );
}

export type Category = { id: string; name: string; kind: "income" | "expense"; color: string | null };

export async function listCategories(q: Queryable): Promise<Category[]> {
  return q.query<Category>(
    `select id, name, kind::text as kind, color
     from accounts
     where kind in ('income', 'expense') and not archived and not is_system
     order by kind desc, name`,
  );
}

// ---------------------------------------------------------------------------
// Movimientos: solo ingresos y egresos
// ---------------------------------------------------------------------------

export type TransactionRow = {
  id: string;
  date: string;
  description: string;
  type: "income" | "expense";
  amount: number; // centavos con signo: + ingreso, − egreso
  categoryId: string;
  category: string;
  color: string | null;
};

export type TransactionFilters = {
  month?: string;
  categoryId?: string;
  type?: "income" | "expense";
  search?: string;
  limit?: number;
  offset?: number;
};

export async function listTransactions(
  q: Queryable,
  f: TransactionFilters,
): Promise<{ rows: TransactionRow[]; total: number }> {
  const where: string[] = ["a.kind in ('income', 'expense')"];
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (f.month) where.push(`t.occurred_on between ${p(f.month)}::date and ${p(monthEnd(f.month))}::date`);
  if (f.categoryId) where.push(`a.id = ${p(f.categoryId)}::uuid`);
  if (f.type) where.push(`a.kind = ${p(f.type)}::account_kind`);
  if (f.search) {
    const escaped = f.search.replace(/[\\%_]/g, (c) => "\\" + c);
    where.push(`t.description ilike ${p(`%${escaped}%`)}`);
  }
  // Cada movimiento tiene exactamente un asiento contra una categoría
  const from = `from transactions t
     join postings c on c.transaction_id = t.id
     join accounts a on a.id = c.account_id
     where ${where.join(" and ")}`;

  const [{ total }] = await q.query<{ total: number }>(`select count(*)::bigint as total ${from}`, params);
  const limit = p(f.limit ?? 50);
  const offset = p(f.offset ?? 0);
  const rows = await q.query<TransactionRow>(
    `select t.id, t.occurred_on as date, t.description,
            a.kind::text as type, -c.amount as amount,
            a.id as "categoryId", a.name as category, a.color
     ${from}
     order by t.occurred_on desc, t.created_at desc, t.id
     limit ${limit} offset ${offset}`,
    params,
  );
  return { rows, total };
}
