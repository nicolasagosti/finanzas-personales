import { addMonths, isValidISODate, monthStart, todayISO } from "@/lib/dates";

export type SearchParams = Record<string, string | string[] | undefined>;

/** Lee ?mes=YYYY-MM con un valor seguro por defecto (el mes actual, hasta 3 años atrás). */
export function parseMonthParam(sp: SearchParams): string {
  const current = monthStart(todayISO());
  const raw = Array.isArray(sp.mes) ? sp.mes[0] : sp.mes;
  if (!raw || !isValidISODate(`${raw}-01`)) return current;
  const m = `${raw}-01`;
  if (m > current) return current;
  const oldest = addMonths(current, -36);
  return m < oldest ? oldest : m;
}
