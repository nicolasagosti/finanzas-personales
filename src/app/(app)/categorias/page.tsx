import type { Metadata } from "next";
import { withUser } from "@/db/client";
import { requireUser } from "@/lib/auth";
import { addMonths, monthStart, todayISO } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { CategoryForm, ColorPicker, DeleteCategoryButton } from "./forms";

export const metadata: Metadata = { title: "Categorías" };

type CategoryStat = { id: string; name: string; kind: "income" | "expense"; color: string | null; total: number; count: number };

export default async function CategoriasPage() {
  const user = await requireUser();
  const since = addMonths(monthStart(todayISO()), -11);
  const categories = await withUser(user.id, (q) =>
    q.query<CategoryStat>(
      `select a.id, a.name, a.kind::text as kind, a.color,
              coalesce(abs(sum(p.amount) filter (where t.occurred_on >= $1::date)), 0)::bigint as total,
              count(p.id)::bigint as count
       from accounts a
       left join postings p on p.account_id = a.id
       left join transactions t on t.id = p.transaction_id
       where a.kind in ('income', 'expense') and not a.archived and not a.is_system
       group by a.id order by total desc, a.name`,
      [since],
    ),
  );

  return (
    <>
      <PageHeader title="Categorías" description="Cada categoría tiene su color en los gráficos. Tocá el círculo para cambiarlo." />
      <div className="grid gap-4 lg:grid-cols-2">
        {(["expense", "income"] as const).map((kind) => {
          const list = categories.filter((c) => c.kind === kind);
          const max = Math.max(1, ...list.map((c) => c.total));
          return (
            <Card key={kind}>
              <CardHeader>
                <CardTitle className={cn(kind === "expense" ? "text-expense-text" : "text-income-text")}>
                  {kind === "expense" ? "Egresos" : "Ingresos"}
                </CardTitle>
                <CardDescription>Total de los últimos 12 meses</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <ul className="flex flex-col gap-3">
                  {list.map((c) => (
                    <li key={c.id} className="group flex items-center gap-3">
                      <ColorPicker id={c.id} name={c.name} color={c.color} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2 text-sm">
                          <span className="truncate font-medium">{c.name}</span>
                          <span className="shrink-0 font-medium tabular">{formatMoney(c.total, "ARS", { decimals: false })}</span>
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${(c.total / max) * 100}%`, background: `var(--cat-${c.color ?? "gray"})` }}
                            />
                          </div>
                          <span className="w-16 text-right text-xs text-muted-foreground tabular">
                            {c.count.toLocaleString("es-AR")} mov.
                          </span>
                        </div>
                      </div>
                      {c.count === 0 ? <DeleteCategoryButton id={c.id} name={c.name} /> : <span className="w-6" />}
                    </li>
                  ))}
                  {list.length === 0 ? <li className="text-sm text-muted-foreground">Sin categorías todavía.</li> : null}
                </ul>
                <CategoryForm kind={kind} />
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
