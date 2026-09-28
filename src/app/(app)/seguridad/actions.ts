"use server";

import { redirect } from "next/navigation";
import { asOwner, withUser } from "@/db/client";
import { endSession, requireUser } from "@/lib/auth";

export type ProbeResult = { name: string; passed: boolean; detail: string };

/**
 * Pruebas en vivo contra la base con el rol de la app. Cada una intenta algo
 * que Postgres debería impedir y reporta el resultado real.
 */
export async function runSecurityProbes(): Promise<ProbeResult[]> {
  const user = await requireUser();
  const results: ProbeResult[] = [];

  // 1) Asiento desbalanceado: el trigger diferido debe rechazarlo al COMMIT.
  try {
    await withUser(user.id, async (q) => {
      const [bank] = await q.query<{ id: string }>("select id from accounts where kind = 'asset' and currency = 'ARS' limit 1");
      const [cat] = await q.query<{ id: string }>("select id from accounts where kind = 'expense' limit 1");
      const [tx] = await q.query<{ id: string }>(
        "insert into transactions (user_id, occurred_on, description) values ($1, current_date, 'prueba desbalanceada') returning id",
        [user.id],
      );
      await q.query(
        "insert into postings (user_id, transaction_id, account_id, amount, currency) values ($1, $2, $3, 10000, 'ARS'), ($1, $2, $4, -9999, 'ARS')",
        [user.id, tx.id, cat.id, bank.id],
      );
    });
    results.push({ name: "Partida doble", passed: false, detail: "La base aceptó un asiento desbalanceado" });
  } catch (e) {
    results.push({ name: "Partida doble", passed: true, detail: `Rechazado por la base: ${e instanceof Error ? e.message : e}` });
  }

  // 2) Escribir datos a nombre de otro usuario: la política WITH CHECK lo impide.
  try {
    await withUser(user.id, (q) =>
      q.query("insert into accounts (user_id, name, kind) values (gen_random_uuid(), 'intrusa', 'asset')"),
    );
    results.push({ name: "Aislamiento (escritura)", passed: false, detail: "Se pudo escribir con otro user_id" });
  } catch (e) {
    results.push({ name: "Aislamiento (escritura)", passed: true, detail: `Rechazado: ${e instanceof Error ? e.message : e}` });
  }

  // 3) Leer filas ajenas sin WHERE: RLS filtra aunque la query lo "olvide".
  const others = await withUser(user.id, (q) =>
    q.query<{ n: number }>("select count(*)::bigint as n from transactions where user_id <> $1", [user.id]),
  );
  results.push({
    name: "Aislamiento (lectura)",
    passed: others[0].n === 0,
    detail: `Transacciones de otros usuarios visibles para tu sesión: ${others[0].n}`,
  });

  // 4) Borrar el log de auditoría: la app solo tiene permiso de lectura.
  try {
    await withUser(user.id, (q) => q.query("delete from audit_log"));
    results.push({ name: "Auditoría inmutable", passed: false, detail: "La app pudo borrar el log" });
  } catch (e) {
    results.push({ name: "Auditoría inmutable", passed: true, detail: `Rechazado: ${e instanceof Error ? e.message : e}` });
  }

  return results;
}

/**
 * Borra al usuario y, en cascada, todas sus cuentas, movimientos, asientos,
 * reglas y presupuestos; también su registro de auditoría.
 */
export async function deleteMyAccount(): Promise<void> {
  const user = await requireUser();
  await asOwner(async (q) => {
    await q.query("delete from users where id = $1", [user.id]);
    await q.query("delete from audit_log where user_id = $1", [user.id]);
  });
  await endSession();
  redirect("/login?cuenta=eliminada");
}
