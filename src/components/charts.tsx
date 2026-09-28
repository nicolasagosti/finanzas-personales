"use client";

import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, Tooltip, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { colorVar } from "@/lib/colors";
import { monthLabel, monthLabelLong } from "@/lib/dates";
import { formatMoney, formatPercent } from "@/lib/money";

/**
 * Convenciones (ver README → Visualización): un solo eje Y, barras ≤ 24px con
 * extremo redondeado, 2px de separación entre porciones, tooltip siempre y
 * leyenda con nombre y valor para que el color nunca sea la única pista.
 */

const axisTick = { fill: "var(--muted-foreground)", fontSize: 12 };
const moneyTick = (v: number) => formatMoney(v, "ARS", { compact: true });

// ---------------------------------------------------------------------------

export type FlowPoint = { month: string; income: number; expense: number };

const flowConfig = {
  income: { label: "Ingresos", color: "var(--income)" },
  expense: { label: "Egresos", color: "var(--expense)" },
} satisfies ChartConfig;

export function IncomeExpenseChart({ data }: { data: FlowPoint[] }) {
  return (
    <ChartContainer config={flowConfig} className="aspect-auto h-full min-h-72 w-full">
      <BarChart data={data} barGap={2} barCategoryGap="22%" margin={{ left: 4, right: 4, top: 8 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="month" tickFormatter={monthLabel} tickLine={false} axisLine={false} tick={axisTick} tickMargin={8} />
        <YAxis tickFormatter={moneyTick} tickLine={false} axisLine={false} tick={axisTick} width={72} />
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.6 }}
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => {
                const m = (payload?.[0]?.payload as FlowPoint | undefined)?.month;
                return m ? <span className="capitalize">{monthLabelLong(m)}</span> : null;
              }}
              formatter={(value, name, item) => (
                <div className="flex w-full items-center justify-between gap-4">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="size-2.5 rounded-[3px]" style={{ background: item.color }} />
                    {flowConfig[name as keyof typeof flowConfig]?.label ?? String(name)}
                  </span>
                  <span className="font-medium tabular text-foreground">{formatMoney(Number(value), "ARS", { decimals: false })}</span>
                </div>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="income" fill="var(--color-income)" radius={[4, 4, 0, 0]} maxBarSize={24} />
        <Bar dataKey="expense" fill="var(--color-expense)" radius={[4, 4, 0, 0]} maxBarSize={24} />
      </BarChart>
    </ChartContainer>
  );
}

// ---------------------------------------------------------------------------

export type DonutSlice = { id: string; name: string; color: string | null; total: number };

const MAX_SLICES = 6;

/** Las 6 categorías más grandes con su color propio; el resto se agrupa en "Otros" (gris). */
function toSlices(data: DonutSlice[]): DonutSlice[] {
  if (data.length <= MAX_SLICES + 1) return data;
  const top = data.slice(0, MAX_SLICES);
  const rest = data.slice(MAX_SLICES).reduce((a, b) => a + b.total, 0);
  return [...top, { id: "otros", name: "Otros", color: "gray", total: rest }];
}

function DonutTooltip({ active, payload, total }: { active?: boolean; payload?: { payload: DonutSlice }[]; total: number }) {
  const slice = payload?.[0]?.payload;
  if (!active || !slice) return null;
  return (
    <div className="grid min-w-40 gap-1 rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <span className="flex items-center gap-1.5 font-medium">
        <span className="size-2.5 rounded-[3px]" style={{ background: colorVar(slice.color) }} />
        {slice.name}
      </span>
      <span className="flex justify-between gap-4 text-muted-foreground">
        <span className="tabular text-foreground">{formatMoney(slice.total, "ARS", { decimals: false })}</span>
        {formatPercent(total ? slice.total / total : 0, 1)}
      </span>
    </div>
  );
}

export function CategoryDonut({
  data,
  centerLabel,
  month,
  type,
}: {
  data: DonutSlice[];
  centerLabel: string;
  month: string;
  type: "income" | "expense";
}) {
  const slices = toSlices(data);
  const total = slices.reduce((a, b) => a + b.total, 0);
  const mes = month.slice(0, 7);

  return (
    // La leyenda va al costado solo si entra (container query); si no, abajo de la dona.
    <div className="@container">
      <div className="flex flex-col items-center gap-5 @lg:flex-row @lg:gap-6">
      <div className="relative size-52 shrink-0">
        <PieChart width={208} height={208}>
          <Tooltip content={<DonutTooltip total={total} />} />
          <Pie
            data={slices}
            dataKey="total"
            nameKey="name"
            innerRadius={66}
            outerRadius={100}
            startAngle={90}
            endAngle={-270}
            stroke="var(--card)"
            strokeWidth={2}
            isAnimationActive={false}
          >
            {slices.map((s) => (
              <Cell key={s.id} fill={colorVar(s.color)} />
            ))}
          </Pie>
        </PieChart>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-xs text-muted-foreground">{centerLabel}</span>
          <span className="text-lg font-semibold tracking-tight tabular">{formatMoney(total, "ARS", { compact: true })}</span>
        </div>
      </div>

      <ul className="flex w-full min-w-0 flex-col gap-1">
        {slices.map((s) => {
          const content = (
            <>
              <span className="size-3 shrink-0 rounded-full" style={{ background: colorVar(s.color) }} />
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              <span className="text-xs text-muted-foreground tabular">{formatPercent(total ? s.total / total : 0, 0)}</span>
              <span className="w-24 text-right font-medium tabular">{formatMoney(s.total, "ARS", { decimals: false })}</span>
            </>
          );
          return (
            <li key={s.id}>
              {s.id === "otros" ? (
                <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm">{content}</div>
              ) : (
                <Link
                  href={`/movimientos?categoria=${s.id}&mes=${mes}&tipo=${type === "income" ? "ingresos" : "egresos"}`}
                  className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                  title={`Ver movimientos de ${s.name}`}
                >
                  {content}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      </div>
    </div>
  );
}
