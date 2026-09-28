import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Info, Receipt } from "lucide-react";
import { withUser } from "@/db/client";
import { requireUser } from "@/lib/auth";
import { addMonths, dayLabel, monthLabelLong, monthRange, monthStart, todayISO } from "@/lib/dates";
import { formatMoney, formatPercent, type Currency } from "@/lib/money";
import {
  budgetForMonth,
  convertArs,
  expensesByCategory,
  fxRate,
  listTransactions,
  loadReference,
  monthlyFlows,
  netWorthByMonth,
  netWorthIn,
} from "@/lib/reports";
import { parseViewParams } from "@/lib/view-mode";
import { cn } from "@/lib/utils";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ExpenseTrendChart, IncomeExpenseChart, NetWorthChart } from "@/components/charts";
import { CategoryBars } from "@/components/category-bars";
import { EmptyState, PageHeader } from "@/components/page-header";
import { ViewControls } from "@/components/view-controls";

export default async function DashboardPage({ searchParams }: PageProps<"/">) {
  const user = await requireUser();
  const { month, mode } = parseViewParams(await searchParams);
  const currentMonth = monthStart(todayISO());
  const months = monthRange(addMonths(month, -11), month);

  const data = await withUser(user.id, async (q) => {
    const [ref, flows, netWorth, categories, budget, recent] = await Promise.all([
      loadReference(q),
      monthlyFlows(q, months[0], month),
      netWorthByMonth(q, months),
      expensesByCategory(q, month),
      budgetForMonth(q, month),
      listTransactions(q, { limit: 6 }),
    ]);
    return { ref, flows, netWorth, categories, budget, recent };
  });
  const { ref, flows, netWorth, categories, budget, recent } = data;
  const cur: Currency = mode.currency;
  const conv = (cents: number, m: string) => convertArs(ref, cents, m, mode);

  const hasData = recent.total > 0;

  const flowSeries = flows.map((f) => ({
    month: f.month,
    income: conv(f.income, f.month),
    expense: conv(f.expense, f.month),
  }));
  const trendSeries = flows.map((f) => ({
    month: f.month,
    nominal: mode.currency === "USD" ? conv(f.expense, f.month) : f.expense,
    real: convertArs(ref, f.expense, f.month, { ...mode, currency: "ARS", real: true }),
  }));
  const netWorthSeries = netWorth.map((p) => {
    const rate = fxRate(ref, p.month, mode.fx);
    const usdAsArs = Math.round(p.usd * rate);
    return mode.currency === "USD"
      ? { month: p.month, pesos: Math.round(p.ars / rate), dolares: p.usd }
      : { month: p.month, pesos: conv(p.ars, p.month), dolares: conv(usdAsArs, p.month) };
  });

  const thisFlow = flowSeries.at(-1)!;
  const prevFlow = flowSeries.at(-2);
  const nwNow = netWorthIn(ref, netWorth.at(-1)!, mode);
  const nwPrev = netWorth.length > 1 ? netWorthIn(ref, netWorth.at(-2)!, mode) : 0;
  const savingsRate = thisFlow.income > 0 ? (thisFlow.income - thisFlow.expense) / thisFlow.income : null;
  const prevSavingsRate = prevFlow && prevFlow.income > 0 ? (prevFlow.income - prevFlow.expense) / prevFlow.income : null;

  const categoryBars = categories.map((c) => ({
    ...c,
    total: conv(c.total, month),
    avgPrev3: conv(c.avgPrev3, month),
  }));

  const budgetLines = budget.filter((b) => b.budget > 0).sort((a, b) => b.spent / b.budget - a.spent / a.budget).slice(0, 5);
  const isCurrent = month === currentMonth;
  const modeLabel =
    mode.currency === "USD"
      ? `En dólares ${mode.fx === "mep" ? "MEP" : mode.fx} al promedio de cada mes`
      : mode.real
        ? `En pesos de ${monthLabelLong(ref.latestCpiMonth)} (IPC INDEC)`
        : "En pesos corrientes";

  return (
    <>
      <PageHeader title="Resumen" description={modeLabel}>
        <ViewControls month={month} currentMonth={currentMonth} currency={mode.currency} fx={mode.fx} real={mode.real} />
      </PageHeader>

      {!hasData ? (
        <EmptyState icon={Receipt} title="Todavía no hay movimientos">
          Cargá tu primer movimiento o <Link className="text-primary underline" href="/importar">importá un resumen</Link>{" "}
          del banco para ver tus gráficos.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Indicadores del mes">
            <StatTile
              label="Patrimonio neto"
              value={formatMoney(nwNow, cur, { decimals: false })}
              delta={nwPrev ? nwNow / nwPrev - 1 : null}
              deltaLabel="vs. mes anterior"
              goodWhenUp
              hero
            />
            <StatTile
              label={isCurrent ? "Ingresos del mes" : "Ingresos"}
              value={formatMoney(thisFlow.income, cur, { decimals: false })}
              delta={prevFlow?.income ? thisFlow.income / prevFlow.income - 1 : null}
              deltaLabel="vs. mes anterior"
              goodWhenUp
            />
            <StatTile
              label={isCurrent ? "Gastos del mes" : "Gastos"}
              value={formatMoney(thisFlow.expense, cur, { decimals: false })}
              delta={prevFlow?.expense ? thisFlow.expense / prevFlow.expense - 1 : null}
              deltaLabel="vs. mes anterior"
              goodWhenUp={false}
            />
            <StatTile
              label="Tasa de ahorro"
              value={savingsRate === null ? "—" : formatPercent(savingsRate, 0)}
              deltaPoints={savingsRate !== null && prevSavingsRate !== null ? savingsRate - prevSavingsRate : null}
              deltaLabel="vs. mes anterior"
              goodWhenUp
            />
          </section>

          <section className="grid gap-4 xl:grid-cols-5">
            <Card className="xl:col-span-3">
              <CardHeader>
                <CardTitle>Ingresos vs. gastos</CardTitle>
                <CardDescription>Últimos 12 meses</CardDescription>
              </CardHeader>
              <CardContent className="min-h-0 flex-1">
                <IncomeExpenseChart data={flowSeries} currency={cur} />
              </CardContent>
            </Card>
            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle>Gasto por categoría</CardTitle>
                <CardDescription className="capitalize">{monthLabelLong(month)}</CardDescription>
              </CardHeader>
              <CardContent>
                {categoryBars.length ? (
                  <CategoryBars data={categoryBars.slice(0, 7)} currency={cur} month={month} />
                ) : (
                  <p className="text-sm text-muted-foreground">Sin gastos este mes.</p>
                )}
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Evolución del gasto</CardTitle>
                <CardDescription>
                  {mode.currency === "USD"
                    ? "Gasto mensual medido en dólares"
                    : "Nominal vs. ajustado por inflación: cuánto del aumento es solo IPC"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ExpenseTrendChart data={trendSeries} currency={cur} showReal={mode.currency === "ARS"} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Patrimonio neto</CardTitle>
                <CardDescription>
                  Activos menos deudas al cierre de cada mes · dólares al {mode.fx === "mep" ? "MEP" : mode.fx}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <NetWorthChart data={netWorthSeries} currency={cur} />
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Presupuesto</CardTitle>
                <CardDescription>Las categorías más exigidas del mes (en pesos corrientes)</CardDescription>
                <CardAction>
                  <Link href="/presupuesto" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                    Ver todo <ArrowRight className="size-3.5" />
                  </Link>
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {budgetLines.length ? (
                  budgetLines.map((b) => {
                    const ratio = b.spent / b.budget;
                    return (
                      <div key={b.id} className="space-y-1.5">
                        <div className="flex items-baseline justify-between gap-2 text-sm">
                          <span className="font-medium">{b.name}</span>
                          <span className="text-muted-foreground tabular">
                            {formatMoney(b.spent, "ARS", { decimals: false })} de {formatMoney(b.budget, "ARS", { decimals: false })}
                          </span>
                        </div>
                        <Progress value={Math.min(100, ratio * 100)} className={cn(ratio > 1 && "[&_[data-slot=progress-indicator]]:bg-destructive")} aria-label={`${b.name}: ${formatPercent(ratio, 0)} del presupuesto`} />
                        {ratio > 1 ? (
                          <p className="text-xs text-destructive">Excedido en {formatMoney(b.spent - b.budget, "ARS", { decimals: false })}</p>
                        ) : null}
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No definiste presupuestos. <Link href="/presupuesto" className="text-primary underline">Crear uno</Link>
                  </p>
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
                <ul className="divide-y">
                  {recent.rows.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{t.description}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {dayLabel(t.date)} · {t.category ?? (t.type === "fx" ? "Compra de dólares" : "Transferencia")} · {t.account}
                        </p>
                      </div>
                      <span className={cn("shrink-0 text-sm font-medium tabular", t.type === "income" && "text-positive")}>
                        {t.type === "income" ? "+" : ""}
                        {formatMoney(t.amount, t.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </section>

          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            IPC: INDEC (último dato {monthLabelLong(ref.latestCpiMonth)}; los meses posteriores usan ese valor). Dólar:
            promedio mensual de venta según argentinadatos.com. Los movimientos de la demo son sintéticos.
          </p>
        </div>
      )}
    </>
  );
}

function StatTile({
  label,
  value,
  delta,
  deltaPoints,
  deltaLabel,
  goodWhenUp,
  hero,
}: {
  label: string;
  value: string;
  delta?: number | null;
  deltaPoints?: number | null;
  deltaLabel: string;
  goodWhenUp: boolean;
  hero?: boolean;
}) {
  const d = delta ?? deltaPoints ?? null;
  const up = d !== null && d > 0;
  const good = d === null || d === 0 ? null : up === goodWhenUp;
  const text =
    d === null
      ? null
      : deltaPoints != null
        ? `${d > 0 ? "+" : "−"}${Math.abs(d * 100).toFixed(1).replace(".", ",")} pp`
        : `${d > 0 ? "+" : "−"}${formatPercent(Math.abs(d), 1)}`;
  return (
    <Card className={cn("gap-2 py-5", hero && "border-primary/30 bg-gradient-to-br from-accent/70 to-card")}>
      <CardHeader className="px-5">
        <CardDescription className="text-sm font-medium">{label}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5 px-5">
        <span className={cn("font-semibold tracking-tight tabular", hero ? "text-3xl" : "text-2xl")}>{value}</span>
        {text ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Badge
              variant="secondary"
              className={cn(
                "gap-0.5 px-1.5 font-medium tabular",
                good === true && "bg-positive/12 text-positive",
                good === false && "bg-destructive/10 text-destructive",
              )}
            >
              {up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
              {text}
            </Badge>
            {deltaLabel}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Sin mes anterior para comparar</span>
        )}
      </CardContent>
    </Card>
  );
}
