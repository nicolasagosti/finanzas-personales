"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withUser } from "@/db/client";
import { moneyAccountId } from "@/db/seed";
import { requireUser } from "@/lib/auth";
import { isValidISODate } from "@/lib/dates";
import { insertTransactions, simpleTransaction } from "@/lib/ledger";
import { parseAmountToCents } from "@/lib/money";

export type ActionState = { ok: boolean; message: string } | null;

const uuid = z.string().uuid();

const schema = z.object({
  type: z.enum(["expense", "income"]),
  date: z.string().refine(isValidISODate, "Fecha inválida"),
  description: z.string().trim().min(1, "Falta la descripción").max(200),
  amount: z.string().trim().min(1, "Falta el monto"),
  categoryId: uuid,
});

function revalidateAll() {
  for (const p of ["/", "/movimientos", "/categorias"]) revalidatePath(p);
}

export async function createTransaction(_: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = schema.safeParse(Object.fromEntries(formData));
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
      // Bajo RLS, una categoría de otro usuario simplemente "no existe".
      const [cat] = await q.query<{ id: string; kind: string }>(
        "select id, kind::text as kind from accounts where id = $1 and kind in ('income', 'expense')",
        [f.categoryId],
      );
      if (!cat || cat.kind !== f.type) throw new Error("Elegí una categoría válida");
      const money = await moneyAccountId(q, user.id);
      await insertTransactions(q, user.id, [
        simpleTransaction({
          date: f.date,
          description: f.description,
          amount: f.type === "expense" ? -cents : cents,
          moneyAccountId: money,
          categoryAccountId: cat.id,
        }),
      ]);
    });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "No se pudo guardar" };
  }
  revalidateAll();
  return { ok: true, message: f.type === "income" ? "Ingreso guardado" : "Egreso guardado" };
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

/** Cambia la categoría de un movimiento (debe ser del mismo tipo: ingreso o egreso). */
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
