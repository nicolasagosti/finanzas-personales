/** Fechas de calendario como strings 'YYYY-MM-DD' (sin zonas horarias). */

const TZ = "America/Argentina/Buenos_Aires";

export function todayISO(): string {
  // en-CA formatea como YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function monthStart(iso: string): string {
  return iso.slice(0, 7) + "-01";
}

export function addMonths(monthIso: string, n: number): string {
  const [y, m] = monthIso.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-01`;
}

export function daysInMonth(monthIso: string): number {
  const [y, m] = monthIso.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthEnd(monthIso: string): string {
  return monthIso.slice(0, 8) + String(daysInMonth(monthIso)).padStart(2, "0");
}

/** Lista de meses (primer día) desde `from` hasta `to` inclusive. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = monthStart(from); m <= monthStart(to); m = addMonths(m, 1)) out.push(m);
  return out;
}

const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MONTHS_LONG = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** '2026-09-01' -> 'sep 26' */
export function monthLabel(monthIso: string): string {
  const [y, m] = monthIso.split("-");
  return `${MONTHS_SHORT[Number(m) - 1]} ${y.slice(2)}`;
}

/** '2026-09-01' -> 'septiembre 2026' */
export function monthLabelLong(monthIso: string): string {
  const [y, m] = monthIso.split("-");
  return `${MONTHS_LONG[Number(m) - 1]} ${y}`;
}

/** '2026-09-05' -> '5 sep' */
export function dayLabel(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(d)} ${MONTHS_SHORT[Number(m) - 1]}`;
}

export function isValidISODate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
