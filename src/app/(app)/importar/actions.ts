"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withUser } from "@/db/client";
import { requireUser } from "@/lib/auth";
import { importHashes, matchRule, normalizeLines, parseStatement, type LineError, type Rule } from "@/lib/import";
import { insertTransactions, simpleTransaction } from "@/lib/ledger";

export type ImportResult =
  | {
      ok: true;
      read: number;
      inserted: number;
      duplicates: number;
      byRule: number;
      uncategorized: number;
      errors: LineError[];
    }
  | { ok: false; message: string };

const schema = z.object({
  csv: z.string().min(1).max(1_500_000),
  accountId: z.string().uuid(),
  invert: z.boolean(),
  mapping: z.object({
    date: z.string().min(1),
    description: z.string().min(1),
    amount: z.string().optional(),
    debit: z.string().optional(),
    credit: z.string().optional(),
  }),
});

export async function importStatement(input: z.infer<typeof schema>): Promise<ImportResult> {
  const user = await requireUser();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Datos de importación inválidos" };
  const { csv, accountId, invert, mapping } = parsed.data;
  if (!mapping.amount && !mapping.debit && !mapping.credit) {
    return { ok: false, message: "Elegí la columna de monto (o débito/crédito)" };
  }

  // El archivo se vuelve a parsear en el servidor: nunca se confía en lo que calculó el navegador.
  const statement = parseStatement(csv);
  if (statement.rows.length > 5000) return { ok: false, message: "Máximo 5.000 filas por archivo" };
  const { lines, errors } = normalizeLines(statement, mapping);
  if (!lines.length) return { ok: false, message: errors[0]?.message ?? "No se encontraron movimientos" };

  try {
    const result = await withUser(user.id, async (q) => {
      const [account] = await q.query<{ id: string; currency: "ARS" | "USD" }>(
        "select id, currency from accounts where id = $1 and kind in ('asset','liability')",
        [accountId],
      );
      if (!account) throw new Error("Cuenta inválida");
      if (account.currency !== "ARS") throw new Error("Por ahora la importación es solo para cuentas en pesos");

      const rules = await q.query<Rule>(`select pattern, account_id as "accountId", priority from rules`);
      const cats = await q.query<{ id: string; name: string; kind: string; is_system: boolean }>(
        "select id, name, kind::text as kind, is_system from accounts where kind in ('income','expense')",
      );
      const kindOf = new Map(cats.map((c) => [c.id, c.kind]));
      const uncategorizedExpense = cats.find((c) => c.is_system && c.name === "Sin categorizar" && c.kind === "expense");
      const fallbackIncome = cats.find((c) => c.is_system && c.name === "Sin categorizar" && c.kind === "income");
      if (!uncategorizedExpense || !fallbackIncome) throw new Error("Faltan categorías base");

      const hashes = importHashes(account.id, lines);
      const viaRule = new Set<string>();
      const txs = lines.map((l, i) => {
        const id = crypto.randomUUID();
        const amount = invert ? -l.amount : l.amount;
        const kind = amount < 0 ? "expense" : "income";
        const matched = matchRule(l.description, rules);
        let categoryId: string;
        if (matched && kindOf.get(matched) === kind) {
          categoryId = matched;
          viaRule.add(id);
        } else {
          categoryId = kind === "expense" ? uncategorizedExpense.id : fallbackIncome.id;
        }
        return {
          ...simpleTransaction({
            date: l.date,
            description: l.description,
            amount,
            moneyAccountId: account.id,
            categoryAccountId: categoryId,
            source: "import",
            importHash: hashes[i],
          }),
          id,
        };
      });
      const { inserted, skipped, insertedIds } = await insertTransactions(q, user.id, txs);
      // Las estadísticas de categorización cuentan solo lo que realmente entró
      const byRule = insertedIds.filter((id) => viaRule.has(id)).length;
      const uncategorized = inserted - byRule;
      return { inserted, duplicates: skipped, byRule, uncategorized };
    });

    revalidatePath("/");
    revalidatePath("/movimientos");
    return { ok: true, read: lines.length, errors: errors.slice(0, 50), ...result };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "No se pudo importar" };
  }
}
