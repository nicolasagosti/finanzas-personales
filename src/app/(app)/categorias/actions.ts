"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withUser } from "@/db/client";
import { requireUser } from "@/lib/auth";
import { CATEGORY_COLORS, nextColor } from "@/lib/colors";
import type { ActionState } from "@/app/(app)/movimientos/actions";

const uuid = z.string().uuid();

function revalidate() {
  for (const p of ["/categorias", "/movimientos", "/"]) revalidatePath(p);
}

const categorySchema = z.object({
  name: z.string().trim().min(1, "Falta el nombre").max(60),
  kind: z.enum(["expense", "income"]),
});

type CreatedCategory = { ok: true; message: string; id: string } | { ok: false; message: string };

async function insertCategory(input: unknown): Promise<CreatedCategory> {
  const user = await requireUser();
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  let id: string;
  try {
    id = await withUser(user.id, async (q) => {
      const used = await q.query<{ color: string | null }>(
        "select color from accounts where kind = $1::account_kind and not is_system",
        [parsed.data.kind],
      );
      const [row] = await q.query<{ id: string }>(
        "insert into accounts (user_id, name, kind, color) values ($1, $2, $3, $4) returning id",
        [user.id, parsed.data.name, parsed.data.kind, nextColor(used.map((u) => u.color))],
      );
      return row.id;
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return { ok: false, message: msg.includes("duplicate") ? "Ya existe una categoría con ese nombre" : "No se pudo crear" };
  }
  revalidate();
  return { ok: true, message: "Categoría creada", id };
}

export async function createCategory(_: ActionState, formData: FormData): Promise<ActionState> {
  return insertCategory(Object.fromEntries(formData));
}

/** Alta desde el diálogo de un movimiento: devuelve el id para dejarla seleccionada. */
export async function addCategory(name: string, kind: "expense" | "income"): Promise<CreatedCategory> {
  return insertCategory({ name, kind });
}

export async function setCategoryColor(id: string, color: string): Promise<ActionState> {
  const user = await requireUser();
  const valid = [...CATEGORY_COLORS, "gray"] as string[];
  if (!uuid.safeParse(id).success || !valid.includes(color)) return { ok: false, message: "Datos inválidos" };
  const rows = await withUser(user.id, (q) =>
    q.query("update accounts set color = $2 where id = $1 and kind in ('income', 'expense') returning id", [id, color]),
  );
  revalidate();
  return rows.length ? { ok: true, message: "Color actualizado" } : { ok: false, message: "No encontrada" };
}

export async function deleteCategory(id: string): Promise<ActionState> {
  const user = await requireUser();
  if (!uuid.safeParse(id).success) return { ok: false, message: "Id inválido" };
  try {
    const rows = await withUser(user.id, (q) =>
      q.query("delete from accounts where id = $1 and kind in ('income', 'expense') and not is_system returning id", [id]),
    );
    if (!rows.length) return { ok: false, message: "No se puede borrar esta categoría" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return { ok: false, message: msg.includes("foreign key") ? "Tiene movimientos: no se puede borrar" : "No se pudo borrar" };
  }
  revalidate();
  return { ok: true, message: "Categoría eliminada" };
}
