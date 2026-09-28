/**
 * Dinero siempre en centavos enteros. Nunca se parsea un monto con parseFloat:
 * el texto se descompone en parte entera y decimal como strings.
 */

export type Currency = "ARS" | "USD";

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: Currency, compact: boolean, decimals: boolean) {
  const key = `${currency}|${compact}|${decimals}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency,
      notation: compact ? "compact" : "standard",
      minimumFractionDigits: compact || !decimals ? 0 : 2,
      maximumFractionDigits: compact ? 1 : decimals ? 2 : 0,
    });
    formatters.set(key, f);
  }
  return f;
}

/** 123456 -> "$ 1.234,56" */
export function formatMoney(
  cents: number,
  currency: Currency = "ARS",
  opts: { compact?: boolean; decimals?: boolean } = {},
): string {
  return formatter(currency, opts.compact ?? false, opts.decimals ?? true).format(cents / 100);
}

/** Igual que formatMoney pero con signo explícito para variaciones. */
export function formatSignedMoney(cents: number, currency: Currency = "ARS"): string {
  const s = formatMoney(Math.abs(cents), currency);
  return cents > 0 ? `+${s}` : cents < 0 ? `−${s}` : s;
}

export function formatPercent(ratio: number, digits = 1): string {
  return new Intl.NumberFormat("es-AR", {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(ratio);
}

/**
 * Convierte texto de un resumen bancario o de un formulario a centavos.
 * Acepta "1.234,56", "1,234.56", "-1234.5", "$ 1.234", "(1.234,56)", "1234".
 * Si hay ambos separadores, el último es el decimal. Si hay uno solo y le
 * siguen exactamente 3 dígitos, se toma como separador de miles (uso es-AR).
 */
export function parseAmountToCents(input: string): number {
  let s = input.trim();
  if (!s) throw new Error("Monto vacío");

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$\s]|ARS|USD|U\$S|US\$/gi, "");
  if (s.startsWith("-") || s.startsWith("−")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  if (!/^[\d.,]+$/.test(s)) throw new Error(`Monto inválido: "${input}"`);

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let decimalSep: "." | "," | null = null;
  if (lastDot >= 0 && lastComma >= 0) {
    decimalSep = lastDot > lastComma ? "." : ",";
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ",";
    const occurrences = s.split(sep).length - 1;
    const after = s.length - s.lastIndexOf(sep) - 1;
    decimalSep = occurrences === 1 && after !== 3 ? sep : null;
  }

  let intPart = s;
  let fracPart = "";
  if (decimalSep) {
    const idx = s.lastIndexOf(decimalSep);
    intPart = s.slice(0, idx);
    fracPart = s.slice(idx + 1);
  }
  intPart = intPart.replace(/[.,]/g, "") || "0";
  if (!/^\d+$/.test(intPart) || !/^\d*$/.test(fracPart)) {
    throw new Error(`Monto inválido: "${input}"`);
  }

  // Redondeo half-up a 2 decimales usando solo enteros.
  const frac2 = (fracPart + "00").slice(0, 2);
  const roundUp = fracPart.length > 2 && Number(fracPart[2]) >= 5;
  const cents = BigInt(intPart) * 100n + BigInt(frac2) + (roundUp ? 1n : 0n);
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Monto demasiado grande");
  const n = Number(cents);
  return negative ? -n : n;
}

/** Monto ajustado por un factor (inflación, tipo de cambio) redondeado a centavos. */
export function scaleCents(cents: number, factor: number): number {
  return Math.round(cents * factor);
}
