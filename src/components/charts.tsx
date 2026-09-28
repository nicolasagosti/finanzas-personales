"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatMoney, type Currency } from "@/lib/money";
import { monthLabel, monthLabelLong } from "@/lib/dates";

/**
 * Gráficos del resumen. Convenciones (ver README → Visualización):
 * barras ≤ 24px con extremo redondeado, líneas de 2px, grilla sólida y tenue,
 * un solo eje Y, tooltip en todos, leyenda cuando hay ≥ 2 series.
 */

const axisTick = { fill: "var(--muted-foreground)", fontSize: 12 };

function moneyTick(currency: Currency) {
  return (v: number) => formatMoney(v, currency, { compact: true });
}

function tooltipFormatter(currency: Currency, config: ChartConfig) {
  // eslint-disable-next-line react/display-name
  return (value: unknown, name: unknown, item: { color?: string }) => (
    <div className="flex w-full items-center justify-between gap-4">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <span className="size-2.5 rounded-[3px]" style={{ background: item.color }} />
        {config[String(name)]?.label ?? String(name)}
      </span>
      <span className="font-medium tabular text-foreground">{formatMoney(Number(value), currency, { decimals: false })}</span>
    </div>
  );
}

const monthTooltipLabel = (_: unknown, payload: readonly { payload?: { month?: string } }[]) => {
  const m = payload?.[0]?.payload?.month;
  return m ? <span className="capitalize">{monthLabelLong(m)}</span> : null;
};

// ---------------------------------------------------------------------------

export type FlowPoint = { month: string; income: number; expense: number };

const flowConfig = {
  income: { label: "Ingresos", color: "var(--chart-1)" },
  expense: { label: "Gastos", color: "var(--chart-2)" },
} satisfies ChartConfig;

export function IncomeExpenseChart({ data, currency }: { data: FlowPoint[]; currency: Currency }) {
  return (
    <ChartContainer config={flowConfig} className="aspect-auto h-full min-h-72 w-full">
      <BarChart data={data} barGap={2} barCategoryGap="22%" margin={{ left: 4, right: 4, top: 8 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="month" tickFormatter={monthLabel} tickLine={false} axisLine={false} tick={axisTick} tickMargin={8} />
        <YAxis tickFormatter={moneyTick(currency)} tickLine={false} axisLine={false} tick={axisTick} width={72} />
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.6 }}
          content={<ChartTooltipContent labelFormatter={monthTooltipLabel} formatter={tooltipFormatter(currency, flowConfig)} />}
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="income" fill="var(--color-income)" radius={[4, 4, 0, 0]} maxBarSize={24} />
        <Bar dataKey="expense" fill="var(--color-expense)" radius={[4, 4, 0, 0]} maxBarSize={24} />
      </BarChart>
    </ChartContainer>
  );
}

// ---------------------------------------------------------------------------

export type TrendPoint = { month: string; nominal: number; real?: number };

const trendConfig = {
  nominal: { label: "Nominal", color: "var(--chart-2)" },
  real: { label: "En pesos de hoy", color: "var(--chart-1)" },
} satisfies ChartConfig;

/** Gasto mensual nominal vs. ajustado por inflación: muestra cuánto del "aumento" es solo IPC. */
export function ExpenseTrendChart({
  data,
  currency,
  showReal,
}: {
  data: TrendPoint[];
  currency: Currency;
  showReal: boolean;
}) {
  const config: ChartConfig = showReal ? trendConfig : { nominal: { label: currency === "USD" ? "Gasto en USD" : "Gasto", color: "var(--chart-1)" } };
  const values = data.map((d) => (showReal ? d.real ?? 0 : d.nominal));
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  return (
    <ChartContainer config={config} className="aspect-auto h-72 w-full">
      <LineChart data={data} margin={{ left: 4, right: 12, top: 8 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="month" tickFormatter={monthLabel} tickLine={false} axisLine={false} tick={axisTick} tickMargin={8} />
        <YAxis tickFormatter={moneyTick(currency)} tickLine={false} axisLine={false} tick={axisTick} width={72} />
        <ChartTooltip
          cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
          content={<ChartTooltipContent labelFormatter={monthTooltipLabel} formatter={tooltipFormatter(currency, config)} />}
        />
        {showReal ? <ChartLegend content={<ChartLegendContent />} /> : null}
        <ReferenceLine
          y={avg}
          stroke="var(--muted-foreground)"
          strokeOpacity={0.5}
          label={{ value: "promedio", position: "insideTopRight", fill: "var(--muted-foreground)", fontSize: 11 }}
        />
        <Line
          dataKey="nominal"
          type="monotone"
          stroke="var(--color-nominal)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--card)" }}
        />
        {showReal ? (
          <Line
            dataKey="real"
            type="monotone"
            stroke="var(--color-real)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--card)" }}
          />
        ) : null}
      </LineChart>
    </ChartContainer>
  );
}

// ---------------------------------------------------------------------------

export type NetWorthChartPoint = { month: string; pesos: number; dolares: number };

const netWorthConfig = {
  dolares: { label: "En dólares (valuado)", color: "var(--chart-1)" },
  pesos: { label: "En pesos", color: "var(--chart-2)" },
} satisfies ChartConfig;

export function NetWorthChart({ data, currency }: { data: NetWorthChartPoint[]; currency: Currency }) {
  return (
    <ChartContainer config={netWorthConfig} className="aspect-auto h-72 w-full">
      <AreaChart data={data} margin={{ left: 4, right: 12, top: 8 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="month" tickFormatter={monthLabel} tickLine={false} axisLine={false} tick={axisTick} tickMargin={8} />
        <YAxis tickFormatter={moneyTick(currency)} tickLine={false} axisLine={false} tick={axisTick} width={72} />
        <ChartTooltip
          cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
          content={<ChartTooltipContent labelFormatter={monthTooltipLabel} formatter={tooltipFormatter(currency, netWorthConfig)} />}
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Area
          dataKey="dolares"
          type="monotone"
          stackId="nw"
          stroke="var(--color-dolares)"
          strokeWidth={2}
          fill="var(--color-dolares)"
          fillOpacity={0.12}
        />
        <Area
          dataKey="pesos"
          type="monotone"
          stackId="nw"
          stroke="var(--color-pesos)"
          strokeWidth={2}
          fill="var(--color-pesos)"
          fillOpacity={0.12}
        />
      </AreaChart>
    </ChartContainer>
  );
}
