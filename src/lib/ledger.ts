import "server-only";
import type { Queryable } from "@/db/client";
import type { Currency } from "@/lib/money";

export type AccountKind = "asset" | "liability" | "income" | "expense" | "equity";

export type PostingInput = { accountId: string; amount: number; currency: Currency };

export type TransactionInput = {
  id?: string;
  date: string;
  description: string;
  source: "manual" | "import" | "seed";
  importHash?: string | null;
  postings: PostingInput[];
};

/**
 * Valida la invariante contable antes de tocar la base (la base la vuelve a
 * validar con un trigger diferido; esto solo da mejores mensajes de error).
 */
export function assertBalanced(tx: TransactionInput): void {
  if (tx.postings.length < 2) throw new Error("Una transacción necesita al menos dos asientos");
  const totals = new Map<string, number>();
  for (const p of tx.postings) {
    if (!Number.isSafeInteger(p.amount) || p.amount === 0) {
      throw new Error("Cada asiento necesita un monto entero distinto de cero (centavos)");
    }
    totals.set(p.currency, (totals.get(p.currency) ?? 0) + p.amount);
  }
  for (const [currency, total] of totals) {
    if (total !== 0) throw new Error(`Asiento desbalanceado en ${currency}: ${total}`);
  }
}

/**
 * Inserta transacciones con sus asientos en dos sentencias (unnest).
 * Las que traen un import_hash ya existente se omiten: ON CONFLICT DO NOTHING
 * hace que reimportar un archivo sea idempotente.
 */
export async function insertTransactions(
  q: Queryable,
  userId: string,
  txs: TransactionInput[],
): Promise<{ inserted: number; skipped: number; insertedIds: string[] }> {
  if (txs.length === 0) return { inserted: 0, skipped: 0, insertedIds: [] };
  const withIds = txs.map((t) => {
    assertBalanced(t);
    return { ...t, id: t.id ?? crypto.randomUUID() };
  });

  const inserted = await q.query<{ id: string }>(
    `insert into transactions (id, user_id, occurred_on, description, source, import_hash)
     select t.id, $1::uuid, t.d, t.descr, t.src, t.h
     from unnest($2::uuid[], $3::date[], $4::text[], $5::text[], $6::text[]) as t(id, d, descr, src, h)
     on conflict (user_id, import_hash) do nothing
     returning id`,
    [
      userId,
      withIds.map((t) => t.id),
      withIds.map((t) => t.date),
      withIds.map((t) => t.description.slice(0, 200)),
      withIds.map((t) => t.source),
      withIds.map((t) => t.importHash ?? null),
    ],
  );
  const ids = new Set(inserted.map((r) => r.id));
  const postings = withIds
    .filter((t) => ids.has(t.id))
    .flatMap((t) => t.postings.map((p) => ({ ...p, txId: t.id })));

  if (postings.length) {
    await q.query(
      `insert into postings (user_id, transaction_id, account_id, amount, currency)
       select $1::uuid, p.tx, p.acc, p.amt, p.cur
       from unnest($2::uuid[], $3::uuid[], $4::bigint[], $5::text[]) as p(tx, acc, amt, cur)`,
      [
        userId,
        postings.map((p) => p.txId),
        postings.map((p) => p.accountId),
        postings.map((p) => p.amount),
        postings.map((p) => p.currency),
      ],
    );
  }
  return { inserted: ids.size, skipped: txs.length - ids.size, insertedIds: [...ids] };
}

/** Gasto/ingreso simple: una cuenta de dinero contra una categoría. */
export function simpleTransaction(opts: {
  date: string;
  description: string;
  amount: number; // centavos, positivo = entra dinero a la cuenta, negativo = sale
  moneyAccountId: string;
  categoryAccountId: string;
  currency?: Currency;
  source?: TransactionInput["source"];
  importHash?: string | null;
}): TransactionInput {
  const currency = opts.currency ?? "ARS";
  return {
    date: opts.date,
    description: opts.description,
    source: opts.source ?? "manual",
    importHash: opts.importHash ?? null,
    postings: [
      { accountId: opts.moneyAccountId, amount: opts.amount, currency },
      { accountId: opts.categoryAccountId, amount: -opts.amount, currency },
    ],
  };
}
