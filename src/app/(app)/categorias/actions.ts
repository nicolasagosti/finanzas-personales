"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withUser } from "@/db/client";
import { requireUser } from "@/lib/auth";
import { matchRule, type Rule } from "@/lib/import";
import type { ActionState } from "@/app/(app)/movimientos/actions";

const uuid = z.string().uuid();

function revalidate() {
  for (const p of ["/categorias", "/movimientos", "/", "/presupuesto"]) revalidatePath(p);
}

function friendly(e: unknown, fallback: string): string {
  const msg = e instanceof Error ? e.message : "";
  if (msg.includes("duplicate")) return "Ya existe";
  if (msg.includes("foreign key")) return "Tiene movimientos asociados: no se puede borrar";
  return msg || fallback;
}

export async function createCategory(_: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = z
    .object({ name: z.string().trim().min(1, "Falta el nombre").max(60), kind: z.enum(["expense", "income"]) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  try {
    await withUser(user.id, (q) =>
      q.query("insert into accounts (user_id, name, kind) values ($1, $2, $3)", [user.id, parsed.data.name, parsed.data.kind]),
    );
  } catch (e) {
    return { ok: false, message: friendly(e, "No se pudo crear") };
  }
  revalidate();
  return { ok: true, message: "Categoría creada" };
}

export async function deleteCategory(id: string): Promise<ActionState> {
  const user = await requireUser();
  if (!uuid.safeParse(id).success) return { ok: false, message: "Id inválido" };
  try {
    const rows = await withUser(user.id, (q) =>
      q.query("delete from accounts where id = $1 and kind in ('income','expense') and not is_system returning id", [id]),
    );
    if (!rows.length) return { ok: false, message: "No se puede borrar esta categoría" };
  } catch (e) {
    return { ok: false, message: friendly(e, "No se pudo borrar") };
  }
  revalidate();
  return { ok: true, message: "Categoría eliminada" };
}

export async function createRule(_: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = z
    .object({ pattern: z.string().trim().min(2, "El patrón necesita al menos 2 caracteres").max(80), accountId: uuid })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  try {
    await withUser(user.id, async (q) => {
      const [cat] = await q.query("select 1 from accounts where id = $1 and kind in ('income','expense')", [parsed.data.accountId]);
      if (!cat) throw new Error("Categoría inválida");
      // Las reglas nuevas tienen prioridad sobre las existentes
      await q.query(
        `insert into rules (user_id, pattern, account_id, priority)
         values ($1, upper($2), $3, coalesce((select min(priority) from rules), 100) - 1)`,
        [user.id, parsed.data.pattern, parsed.data.accountId],
      );
    });
  } catch (e) {
    return { ok: false, message: friendly(e, "No se pudo crear la regla") };
  }
  revalidate();
  return { ok: true, message: "Regla creada" };
}

export async function deleteRule(id: string): Promise<ActionState> {
  const user = await requireUser();
  if (!uuid.safeParse(id).success) return { ok: false, message: "Id inválido" };
  await withUser(user.id, (q) => q.query("delete from rules where id = $1", [id]));
  revalidate();
  return { ok: true, message: "Regla eliminada" };
}

/** Recorre los gastos "Sin categorizar" y les aplica las reglas vigentes. */
export async function applyRulesToUncategorized(): Promise<ActionState> {
  const user = await requireUser();
  const changed = await withUser(user.id, async (q) => {
    const rules = await q.query<Rule>(`select pattern, account_id as "accountId", priority from rules`);
    const pending = await q.query<{ postingId: string; description: string; kind: string }>(
      `select p.id as "postingId", t.description, a.kind::text as kind
       from postings p
       join accounts a on a.id = p.account_id
       join transactions t on t.id = p.transaction_id
       where a.is_system and a.name = 'Sin categorizar'`,
    );
    const kinds = new Map(
      (await q.query<{ id: string; kind: string }>("select id, kind::text as kind from accounts where kind in ('income','expense')")).map((r) => [r.id, r.kind]),
    );
    let n = 0;
    for (const p of pending) {
      const target = matchRule(p.description, rules);
      if (target && kinds.get(target) === p.kind) {
        await q.query("update postings set account_id = $1 where id = $2", [target, p.postingId]);
        n++;
      }
    }
    return { n, total: pending.length };
  });
  revalidate();
  return { ok: true, message: `${changed.n} de ${changed.total} movimientos sin categorizar se recategorizaron` };
}
