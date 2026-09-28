import Link from "next/link";
import { formatMoney, formatPercent, type Currency } from "@/lib/money";

export type CategoryBar = { id: string; name: string; total: number; avgPrev3: number };

/**
 * Gasto por categoría como barras horizontales (una serie, un solo tono):
 * se leen mejor que una torta y los rótulos largos nunca se recortan.
 */
export function CategoryBars({
  data,
  currency,
  month,
}: {
  data: CategoryBar[];
  currency: Currency;
  month: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.total));
  const total = data.reduce((a, b) => a + b.total, 0);
  return (
    <ul className="flex flex-col gap-3.5">
      {data.map((d) => {
        const delta = d.avgPrev3 > 0 ? d.total / d.avgPrev3 - 1 : null;
        return (
          <li key={d.id}>
            <Link
              href={`/movimientos?categoria=${d.id}&mes=${month.slice(0, 7)}`}
              className="group block rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              title={`Ver movimientos de ${d.name}`}
            >
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate font-medium group-hover:underline">{d.name}</span>
                <span className="flex shrink-0 items-baseline gap-2">
                  {delta !== null && Math.abs(delta) >= 0.05 ? (
                    <span
                      className="text-xs text-muted-foreground tabular"
                      title="Variación vs. promedio de los 3 meses anteriores"
                    >
                      {delta > 0 ? "▲" : "▼"} {formatPercent(Math.abs(delta), 0)}
                    </span>
                  ) : null}
                  <span className="font-medium tabular">{formatMoney(d.total, currency, { decimals: false })}</span>
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <div className="h-2.5 flex-1">
                  <div
                    className="h-full rounded-r-[4px] bg-primary transition-[width] duration-500 group-hover:opacity-85"
                    style={{ width: `${Math.max(1.5, (d.total / max) * 100)}%` }}
                  />
                </div>
                <span className="w-9 text-right text-xs text-muted-foreground tabular">
                  {formatPercent(total ? d.total / total : 0, 0)}
                </span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
