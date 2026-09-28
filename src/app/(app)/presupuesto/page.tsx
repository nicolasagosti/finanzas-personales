import type { Metadata } from "next";
import { withUser } from "@/db/client";
import { requireUser } from "@/lib/auth";
import { addMonths, monthLabelLong, monthStart, todayISO } from "@/lib/dates";
import { budgetForMonth, convertArs, loadReference } from "@/lib/reports";
import { parseViewParams } from "@/lib/view-mode";
import { PageHeader } from "@/components/page-header";
import { ViewControls } from "@/components/view-controls";
import { BudgetEditor } from "./budget-editor";

export const metadata: Metadata = { title: "Presupuesto" };

export default async function PresupuestoPage({ searchParams }: PageProps<"/presupuesto">) {
  const user = await requireUser();
  const { month } = parseViewParams(await searchParams);
  const currentMonth = monthStart(todayISO());
  const from = addMonths(currentMonth, -3);

  const { lines, history, ref } = await withUser(user.id, async (q) => ({
    lines: await budgetForMonth(q, month),
    // Gasto por categoría en los 3 meses cerrados anteriores, para sugerir
    history: await q.query<{ id: string; month: string; total: number }>(
      `select p.account_id as id, date_trunc('month', t.occurred_on)::date as month, sum(p.amount)::bigint as total
       from postings p join transactions t on t.id = p.transaction_id
       join accounts a on a.id = p.account_id
       where a.kind = 'expense' and t.occurred_on >= $1::date and t.occurred_on < $2::date
       group by 1, 2`,
      [from, currentMonth],
    ),
    ref: await loadReference(q),
  }));

  const suggestion = (id: string) => {
    const rows = history.filter((h) => h.id === id);
    const inTodayPesos = rows.reduce(
      (a, h) => a + convertArs(ref, h.total, h.month, { currency: "ARS", fx: "mep", real: true }),
      0,
    );
    return Math.ceil(inTodayPesos / 3 / 1_000_000) * 1_000_000; // redondeo a $10.000
  };

  const rows = lines.map((l) => ({ ...l, suggestion: suggestion(l.id) }));

  return (
    <>
      <PageHeader
        title="Presupuesto mensual"
        description={
          <>
            Límite por categoría para <span className="capitalize">{monthLabelLong(month)}</span>. Las sugerencias usan
            el promedio de 3 meses llevado a pesos de hoy con el IPC.
          </>
        }
      >
        <ViewControls month={month} currentMonth={currentMonth} currency="ARS" fx="mep" real={false} showCurrency={false} />
      </PageHeader>
      <BudgetEditor key={month} rows={rows} isCurrentMonth={month === currentMonth} />
    </>
  );
}
