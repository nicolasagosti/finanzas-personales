"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withUser } from "@/db/client";
import { requireUser } from "@/lib/auth";
import { parseAmountToCents } from "@/lib/money";
import type { ActionState } from "@/app/(app)/movimientos/actions";

const uuid = z.string().uuid();

export async function saveBudgets(entries: { accountId: string; amount: string }[]): Promise<ActionState> {
  const user = await requireUser();
  const parsed: { accountId: string; cents: number }[] = [];
  for (const e of entries.slice(0, 200)) {
    if (!uuid.safeParse(e.accountId).success) return { ok: false, message: "Categoría inválida" };
    try {
      const cents = e.amount.trim() ? Math.abs(parseAmountToCents(e.amount)) : 0;
      parsed.push({ accountId: e.accountId, cents });
    } catch {
      return { ok: false, message: `Monto inválido: ${e.amount}` };
    }
  }
  try {
    await withUser(user.id, async (q) => {
      const toDelete = parsed.filter((p) => p.cents === 0).map((p) => p.accountId);
      const toUpsert = parsed.filter((p) => p.cents > 0);
      if (toDelete.length) await q.query("delete from budgets where account_id = any($1::uuid[])", [toDelete]);
      if (toUpsert.length) {
        await q.query(
          `insert into budgets (user_id, account_id, amount)
           select $1::uuid, b.acc, b.amt from unnest($2::uuid[], $3::bigint[]) as b(acc, amt)
           join accounts a on a.id = b.acc and a.kind = 'expense'
           on conflict (user_id, account_id) do update set amount = excluded.amount`,
          [user.id, toUpsert.map((p) => p.accountId), toUpsert.map((p) => p.cents)],
        );
      }
    });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "No se pudo guardar" };
  }
  revalidatePath("/presupuesto");
  revalidatePath("/");
  return { ok: true, message: "Presupuesto guardado" };
}
