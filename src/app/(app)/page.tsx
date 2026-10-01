import Link from "next/link";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Receipt, Scale } from "lucide-react";
import { withUser } from "@/db/client";
import { requireUser } from "@/lib/auth";
import { colorVar } from "@/lib/colors";
import { addMonths, dayLabel, monthLabelLong, monthRange, monthStart, todayISO } from "@/lib/dates";
import { formatMoney, formatPercent } from "@/lib/money";
import { listCategories, listTransactions, monthlyFlows, totalsByCategory } from "@/lib/reports";
import { parseMonthParam } from "@/lib/view-mode";
import { cn } from "@/lib/utils";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CategoryBarChart, CategoryDonut, IncomeExpenseChart } from "@/components/charts";
import { EmptyState, PageHeader } from "@/components/page-header";
import { MonthNav } from "@/components/month-nav";
import { EditTransactionButton, TransactionDialog, TransactionEditor } from "@/app/(app)/movimientos/transaction-dialog";

export default async function DashboardPage({ searchParams }: PageProps<"/">) {
  const user = await requireUser();
  const month = parseMonthParam(await searchParams);
  const today = todayISO();
  const currentMonth = monthStart(today);
  const months = monthRange(addMonths(month, -11), month);

  const { flows, expenses, incomes, recent, categories } = await withUser(user.id, async (q) => {
    const [flows, expenses, incomes, recent, categories] = await Promise.all([
      monthlyFlows(q, months[0], month),
      totalsByCategory(q, "expense", month),
      totalsByCategory(q, "income", month),
      listTransactions(q, { limit: 6 }),
      listCategories(q),
    ]);
    return { flows, expenses, incomes, recent, categories };
  });

  const current = flows.at(-1)!;
  const previous = flows.at(-2);
  const balance = current.income - current.expense;
  const savings = current.income > 0 ? balance / current.income : null;
  const monthName = monthLabelLong(month);
  const isCurrent = month === currentMonth;

  return (
    <>
      <PageHeader title="Resumen" description={<span className="capitalize">{monthName}</span>}>
        <MonthNav month={month} currentMonth={currentMonth} />
        <TransactionDialog categories={categories} today={today} />
      </PageHeader>

      {recent.total === 0 ? (
        <EmptyState icon={Receipt} title="Todavía no cargaste movimientos">
          Tocá <strong>Nuevo movimiento</strong> para registrar tu primer ingreso o egreso y ver tus gráficos.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          <section className="grid gap-4 sm:grid-cols-3" aria-label="Indicadores del mes">
            <StatTile
              label={isCurrent ? "Ingresos del mes" : "Ingresos"}
              value={formatMoney(current.income, "ARS", { decimals: false })}
              icon={ArrowDownLeft}
              tone="income"
              delta={previous?.income ? current.income / previous.income - 1 : null}
              goodWhenUp
            />
            <StatTile
              label={isCurrent ? "Egresos del mes" : "Egresos"}
              value={formatMoney(current.expense, "ARS", { decimals: false })}
              icon={ArrowUpRight}
              tone="expense"
              delta={previous?.expense ? current.expense / previous.expense - 1 : null}
              goodWhenUp={false}
            />
            <StatTile
              label="Balance"
              value={formatMoney(balance, "ARS", { decimals: false })}
              icon={Scale}
              tone={balance >= 0 ? "income" : "expense"}
              note={savings !== null ? `Ahorraste el ${formatPercent(Math.max(savings, 0), 0)} de lo que ingresó` : undefined}
            />
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Ingresos vs. egresos</CardTitle>
                <CardDescription>Últimos 12 meses</CardDescription>
              </CardHeader>
              <CardContent className="min-h-0 flex-1">
                <IncomeExpenseChart data={flows} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Egresos por categoría</CardTitle>
                <CardDescription className="capitalize">{monthName}</CardDescription>
              </CardHeader>
              <CardContent>
                {expenses.length ? (
                  <CategoryDonut data={expenses} centerLabel="Egresos" month={month} type="expense" />
                ) : (
                  <p className="text-sm text-muted-foreground">Sin egresos este mes.</p>
                )}
              </CardContent>
            </Card>
          </section>

          <Card>
            <CardHeader>
              <CardTitle>Egresos e ingresos por categoría</CardTitle>
              <CardDescription>
                <span className="capitalize">{monthName}</span> · tocá una barra para ver sus movimientos
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-8 lg:grid-cols-2">
              {(
                [
                  { type: "expense", label: "Egresos", data: expenses, total: current.expense, tone: "text-expense-text" },
                  { type: "income", label: "Ingresos", data: incomes, total: current.income, tone: "text-income-text" },
                ] as const
              ).map((g) => (
                <div key={g.type} className="flex min-w-0 flex-col gap-3">
                  <div className="flex items-baseline justify-between gap-3 border-b pb-2">
                    <h3 className={cn("text-sm font-semibold", g.tone)}>{g.label}</h3>
                    <span className="text-sm font-medium tabular">{formatMoney(g.total, "ARS", { decimals: false })}</span>
                  </div>
                  {g.data.length ? (
                    <CategoryBarChart data={[...g.data]} month={month} type={g.type} />
                  ) : (
                    <p className="text-sm text-muted-foreground">Sin {g.label.toLowerCase()} este mes.</p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <section className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Ingresos por categoría</CardTitle>
                <CardDescription className="capitalize">{monthName}</CardDescription>
              </CardHeader>
              <CardContent>
                {incomes.length ? (
                  <CategoryDonut data={incomes} centerLabel="Ingresos" month={month} type="income" />
                ) : (
                  <p className="text-sm text-muted-foreground">Sin ingresos este mes.</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Últimos movimientos</CardTitle>
                <CardDescription>{recent.total.toLocaleString("es-AR")} movimientos registrados</CardDescription>
                <CardAction>
                  <Link href="/movimientos" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                    Ver todos <ArrowRight className="size-3.5" />
                  </Link>
                </CardAction>
              </CardHeader>
              <CardContent>
                <TransactionEditor categories={categories} today={today}>
                  <ul className="divide-y">
                    {recent.rows.map((t) => (
                      <li key={t.id} className="py-1 first:pt-0 last:pb-0">
                        <EditTransactionButton
                          transaction={t}
                          className="-mx-2 flex w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/50"
                        >
                          <span className="flex min-w-0 items-center gap-3">
                            <span className="size-2.5 shrink-0 rounded-full" style={{ background: colorVar(t.color) }} />
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium">{t.description}</span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {dayLabel(t.date)} · {t.category}
                              </span>
                            </span>
                          </span>
                          <span
                            className={cn(
                              "shrink-0 text-sm font-medium tabular",
                              t.type === "income" ? "text-income-text" : "text-expense-text",
                            )}
                          >
                            {t.type === "income" ? "+" : ""}
                            {formatMoney(t.amount, "ARS")}
                          </span>
                        </EditTransactionButton>
                      </li>
                    ))}
                  </ul>
                </TransactionEditor>
              </CardContent>
            </Card>
          </section>
        </div>
      )}
    </>
  );
}

function StatTile({
  label,
  value,
  icon: Icon,
  tone,
  delta,
  goodWhenUp,
  note,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "income" | "expense";
  delta?: number | null;
  goodWhenUp?: boolean;
  note?: string;
}) {
  const good = delta == null || delta === 0 ? null : delta > 0 === goodWhenUp;
  return (
    <Card className="gap-2 py-5">
      <CardContent className="flex items-start justify-between gap-3 px-5">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
          <span className="text-2xl font-semibold tracking-tight tabular">{value}</span>
          {delta != null ? (
            <span className="text-xs text-muted-foreground">
              <span className={cn("font-medium tabular", good === true && "text-income-text", good === false && "text-expense-text")}>
                {delta > 0 ? "▲" : "▼"} {formatPercent(Math.abs(delta), 1)}
              </span>{" "}
              vs. mes anterior
            </span>
          ) : note ? (
            <span className="text-xs text-muted-foreground">{note}</span>
          ) : (
            <span className="text-xs text-muted-foreground">Sin mes anterior para comparar</span>
          )}
        </div>
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-xl",
            tone === "income" ? "bg-income/15 text-income-text" : "bg-expense/15 text-expense-text",
          )}
        >
          <Icon className="size-5" />
        </span>
      </CardContent>
    </Card>
  );
}
