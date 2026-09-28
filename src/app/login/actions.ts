"use server";

import { redirect } from "next/navigation";
import { asOwner } from "@/db/client";
import { createUserWithDefaults, seedDemoData } from "@/db/seed";
import { endSession, startSession } from "@/lib/auth";
import { describeSetupError } from "@/lib/setup-errors";

export type LoginState = { error: string } | null;

const MAX_DEMOS_PER_HOUR = Number(process.env.MAX_DEMOS_PER_HOUR ?? 300);

/** Crea un usuario demo nuevo (aislado por RLS) con 12 meses de datos sintéticos. */
export async function startDemo(): Promise<LoginState> {
  try {
    const userId = await asOwner(async (q) => {
      // Limpieza de demos vencidas y freno básico contra abuso.
      const expired = await q.query<{ id: string }>(
        "delete from users where is_demo and created_at < now() - interval '24 hours' returning id",
      );
      if (expired.length) {
        await q.query("delete from audit_log where user_id = any($1::uuid[])", [expired.map((r) => r.id)]);
      }
      const [{ n }] = await q.query<{ n: number }>(
        "select count(*)::bigint as n from users where is_demo and created_at > now() - interval '1 hour'",
      );
      if (n >= MAX_DEMOS_PER_HOUR) throw new Error("Demasiadas demos creadas en la última hora. Probá más tarde.");

      const { userId, accounts } = await createUserWithDefaults(q, {
        email: `demo-${crypto.randomUUID()}@demo.invalid`,
        name: "Usuario demo",
        isDemo: true,
      });
      await seedDemoData(q, userId, accounts);
      return userId;
    });
    await startSession(userId, true);
  } catch (e) {
    return { error: describeSetupError(e) };
  }
  redirect("/");
}

/** Espacio propio vacío, con el plan de cuentas y reglas por defecto. */
export async function startEmpty(_: LoginState, formData: FormData): Promise<LoginState> {
  const name = String(formData.get("name") ?? "").trim().slice(0, 60) || "Mi espacio";
  try {
    const userId = await asOwner(async (q) => {
      const { userId } = await createUserWithDefaults(q, {
        email: `local-${crypto.randomUUID()}@local.invalid`,
        name,
        isDemo: false,
      });
      return userId;
    });
    await startSession(userId, false);
  } catch (e) {
    return { error: describeSetupError(e) };
  }
  redirect("/");
}

export async function logout() {
  await endSession();
  redirect("/login");
}
