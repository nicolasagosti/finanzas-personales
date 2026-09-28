"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withUser } from "@/db/client";
import { requireUser } from "@/lib/auth";
import { isValidISODate } from "@/lib/dates";
import {
  fxPurchaseTransaction,
  insertTransactions,
  simpleTransaction,
  transferTransaction,
} from "@/lib/ledger";
import { parseAmountToCents } from "@/lib/money";

export type ActionState = { ok: boolean; message: string } | null;

const uuid = z.string().uuid();

const baseSchema = z.object({
  type: z.enum(["expense", "income", "transfer", "fx"]),
  date: z.string().refine(isValidISODate, "Fecha inválida"),
  description: z.string().trim().min(1, "Falta la descripción").max(200),
  amount: z.string().trim().min(1, "Falta el monto"),
  accountId: uuid,
  categoryId: uuid.optional().or(z.literal("")),
  toAccountId: uuid.optional().or(z.literal("")),
  usdAmount: z.string().trim().optional(),
});

function revalidateAll() {
  for (const p of ["/", "/movimientos", "/cuentas", "/presupuesto", "/categorias"]) revalidatePath(p);
}

export async function createTransaction(_: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = baseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const f = parsed.data;

  let cents: number;
  try {
    cents = Math.abs(parseAmountToCents(f.amount));
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Monto inválido" };
  }
  if (cents === 0) return { ok: false, message: "El monto no puede ser cero" };

  try {
    await withUser(user.id, async (q) => {
      // Las cuentas se leen bajo RLS: una cuenta ajena simplemente "no existe".
      const ids = [f.accountId, f.categoryId, f.toAccountId].filter(Boolean) as string[];
      const accounts = await q.query<{ id: string; kind: string; currency: "ARS" | "USD"; is_system: boolean }>(
        "select id, kind::text as kind, currency, is_system from accounts where id = any($1::uuid[])",
        [ids],
      );
      const get = (id?: string) => accounts.find((a) => a.id === id);
      const from = get(f.accountId);
      if (!from || !["asset", "liability"].includes(from.kind)) throw new Error("Cuenta inválida");

      if (f.type === "expense" || f.type === "income") {
        const cat = get(f.categoryId || undefined);
        if (!cat || cat.kind !== f.type) throw new Error("Elegí una categoría válida");
        if (cat.currency !== from.currency) throw new Error("La categoría y la cuenta deben tener la misma moneda");
        await insertTransactions(q, user.id, [
          simpleTransaction({
            date: f.date,
            description: f.description,
            amount: f.type === "expense" ? -cents : cents,
            moneyAccountId: from.id,
            categoryAccountId: cat.id,
            currency: from.currency,
          }),
        ]);
        return;
      }

      const to = get(f.toAccountId || undefined);
      if (!to || !["asset", "liability"].includes(to.kind) || to.id === from.id) {
        throw new Error("Elegí una cuenta de destino distinta");
      }

      if (f.type === "transfer") {
        if (to.currency !== from.currency) throw new Error("Para cambiar de moneda usá “Compra de dólares”");
        await insertTransactions(q, user.id, [
          transferTransaction({
            date: f.date,
            description: f.description,
            amount: cents,
            fromAccountId: from.id,
            toAccountId: to.id,
            currency: from.currency,
          }),
        ]);
        return;
      }

      // Compra de dólares: pesos que salen, dólares que entran
      if (from.currency !== "ARS" || to.currency !== "USD") {
        throw new Error("La compra de dólares va de una cuenta en pesos a una en dólares");
      }
      const usdCents = Math.abs(parseAmountToCents(f.usdAmount ?? ""));
      if (!usdCents) throw new Error("Indicá cuántos dólares compraste");
      const conv = await q.query<{ id: string; currency: string }>(
        "select id, currency from accounts where kind = 'equity' and name = 'Conversión de moneda'",
      );
      const convArs = conv.find((c) => c.currency === "ARS");
      const convUsd = conv.find((c) => c.currency === "USD");
      if (!convArs || !convUsd) throw new Error("Faltan las cuentas de conversión de moneda");
      await insertTransactions(q, user.id, [
        fxPurchaseTransaction({
          date: f.date,
          description: f.description,
          arsAmount: cents,
          usdAmount: usdCents,
          fromArsAccountId: from.id,
          toUsdAccountId: to.id,
          conversionArsId: convArs.id,
          conversionUsdId: convUsd.id,
        }),
      ]);
    });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "No se pudo guardar" };
  }
  revalidateAll();
  return { ok: true, message: "Movimiento guardado" };
}

export async function deleteTransaction(id: string): Promise<ActionState> {
  const user = await requireUser();
  if (!uuid.safeParse(id).success) return { ok: false, message: "Id inválido" };
  const deleted = await withUser(user.id, (q) =>
    q.query("delete from transactions where id = $1 returning id", [id]),
  );
  revalidateAll();
  return deleted.length ? { ok: true, message: "Movimiento eliminado" } : { ok: false, message: "No encontrado" };
}

/** Cambia la categoría de un gasto/ingreso (mismo tipo y moneda). */
export async function recategorize(transactionId: string, categoryId: string): Promise<ActionState> {
  const user = await requireUser();
  if (!uuid.safeParse(transactionId).success || !uuid.safeParse(categoryId).success) {
    return { ok: false, message: "Datos inválidos" };
  }
  const updated = await withUser(user.id, (q) =>
    q.query(
      `update postings p set account_id = n.id
       from accounts old, accounts n
       where p.transaction_id = $1 and old.id = p.account_id
         and old.kind in ('income', 'expense')
         and n.id = $2 and n.kind = old.kind and n.currency = old.currency
       returning p.id`,
      [transactionId, categoryId],
    ),
  );
  revalidateAll();
  return updated.length ? { ok: true, message: "Categoría actualizada" } : { ok: false, message: "No se pudo recategorizar" };
}
