"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withUser, type Queryable } from "@/db/client";
import { moneyAccountId } from "@/db/seed";
import { requireUser } from "@/lib/auth";
import { isValidISODate } from "@/lib/dates";
import { insertTransactions, simpleTransaction, updateSimpleTransaction } from "@/lib/ledger";
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

type ParsedForm = { ok: true; data: z.infer<typeof schema>; cents: number } | { ok: false; message: string };

function parseForm(formData: FormData): ParsedForm {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  let cents: number;
  try {
    cents = Math.abs(parseAmountToCents(parsed.data.amount));
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Monto inválido" };
  }
  if (cents === 0) return { ok: false, message: "El monto no puede ser cero" };
  return { ok: true, data: parsed.data, cents };
}

/** Bajo RLS, una categoría de otro usuario simplemente "no existe". */
async function findCategory(q: Queryable, id: string, type: "expense" | "income"): Promise<string> {
  const [cat] = await q.query<{ id: string; kind: string }>(
    "select id, kind::text as kind from accounts where id = $1 and kind in ('income', 'expense')",
    [id],
  );
  if (!cat || cat.kind !== type) throw new Error("Elegí una categoría válida");
  return cat.id;
}

export async function createTransaction(_: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = parseForm(formData);
  if (!parsed.ok) return parsed;
  const { data: f, cents } = parsed;

  try {
    await withUser(user.id, async (q) => {
      const categoryId = await findCategory(q, f.categoryId, f.type);
      const money = await moneyAccountId(q, user.id);
      await insertTransactions(q, user.id, [
        simpleTransaction({
          date: f.date,
          description: f.description,
          amount: f.type === "expense" ? -cents : cents,
          moneyAccountId: money,
          categoryAccountId: categoryId,
        }),
      ]);
    });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "No se pudo guardar" };
  }
  revalidateAll();
  return { ok: true, message: f.type === "income" ? "Ingreso guardado" : "Egreso guardado" };
}

export async function updateTransaction(_: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!uuid.safeParse(id).success) return { ok: false, message: "Id inválido" };
  const parsed = parseForm(formData);
  if (!parsed.ok) return parsed;
  const { data: f, cents } = parsed;

  try {
    await withUser(user.id, async (q) => {
      const categoryId = await findCategory(q, f.categoryId, f.type);
      await updateSimpleTransaction(q, {
        id,
        date: f.date,
        description: f.description,
        amount: f.type === "expense" ? -cents : cents,
        categoryAccountId: categoryId,
      });
    });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "No se pudo guardar" };
  }
  revalidateAll();
  return { ok: true, message: "Movimiento actualizado" };
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
