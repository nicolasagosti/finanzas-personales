"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withUser } from "@/db/client";
import { requireUser } from "@/lib/auth";
import { todayISO } from "@/lib/dates";
import { insertTransactions, simpleTransaction } from "@/lib/ledger";
import { parseAmountToCents } from "@/lib/money";
import type { ActionState } from "@/app/(app)/movimientos/actions";

const schema = z.object({
  name: z.string().trim().min(1, "Falta el nombre").max(60),
  kind: z.enum(["asset", "liability"]),
  currency: z.enum(["ARS", "USD"]),
  opening: z.string().trim().optional(),
});

export async function createAccount(_: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const f = parsed.data;

  let opening = 0;
  try {
    opening = f.opening ? parseAmountToCents(f.opening) : 0;
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Saldo inválido" };
  }

  try {
    await withUser(user.id, async (q) => {
      const [acc] = await q.query<{ id: string }>(
        "insert into accounts (user_id, name, kind, currency) values ($1, $2, $3, $4) returning id",
        [user.id, f.name, f.kind, f.currency],
      );
      if (opening !== 0) {
        const [equity] = await q.query<{ id: string }>(
          "select id from accounts where kind = 'equity' and name = 'Saldo inicial' and currency = $1",
          [f.currency],
        );
        if (!equity) throw new Error("Falta la cuenta de saldo inicial");
        // Una deuda se ingresa en positivo pero es un saldo acreedor.
        const signed = f.kind === "liability" ? -Math.abs(opening) : opening;
        await insertTransactions(q, user.id, [
          simpleTransaction({
            date: todayISO(),
            description: `Saldo inicial ${f.name}`,
            amount: signed,
            moneyAccountId: acc.id,
            categoryAccountId: equity.id,
            currency: f.currency,
          }),
        ]);
      }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return { ok: false, message: msg.includes("duplicate") ? "Ya existe una cuenta con ese nombre" : msg || "No se pudo crear" };
  }
  revalidatePath("/cuentas");
  revalidatePath("/");
  return { ok: true, message: "Cuenta creada" };
}
