import { addMonths, isValidISODate, monthStart, todayISO } from "@/lib/dates";
import type { FxKind, ViewMode } from "@/lib/reports";

export type SearchParams = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Lee ?mes=YYYY-MM&moneda=ARS|USD&tc=oficial|mep|blue&real=1 con valores seguros por defecto. */
export function parseViewParams(sp: SearchParams): { month: string; mode: ViewMode } {
  const current = monthStart(todayISO());
  const mes = one(sp.mes);
  let month = current;
  if (mes && isValidISODate(`${mes}-01`)) {
    const m = `${mes}-01`;
    month = m > current ? current : m < addMonths(current, -36) ? addMonths(current, -36) : m;
  }
  const currency = one(sp.moneda) === "USD" ? "USD" : "ARS";
  const tc = one(sp.tc);
  const fx: FxKind = tc === "oficial" || tc === "blue" ? tc : "mep";
  const real = one(sp.real) === "1" && currency === "ARS";
  return { month, mode: { currency, fx, real } };
}
