import { createHash } from "node:crypto";
import Papa from "papaparse";
import { parseAmountToCents } from "@/lib/money";
import { isValidISODate } from "@/lib/dates";

/**
 * Importación de resúmenes bancarios en CSV.
 *
 * Idempotencia: cada fila recibe una huella
 *   sha256(cuenta | fecha | monto | descripción normalizada | n° de ocurrencia)
 * donde "n° de ocurrencia" distingue filas idénticas dentro del mismo archivo
 * (dos cafés iguales el mismo día). Reimportar el archivo, o uno que se
 * superpone, genera las mismas huellas y la base las descarta.
 */

export type ColumnMapping = {
  date: string;
  description: string;
  amount?: string;
  debit?: string;
  credit?: string;
};

export type ParsedStatement = { headers: string[]; rows: Record<string, string>[] };

export type StatementLine = { line: number; date: string; description: string; amount: number };

export type LineError = { line: number; message: string };

export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function parseStatement(text: string): ParsedStatement {
  const clean = text.replace(/^﻿/, "");
  const result = Papa.parse<Record<string, string>>(clean, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  const headers = (result.meta.fields ?? []).filter(Boolean);
  return { headers, rows: result.data };
}

const CANDIDATES: Record<keyof ColumnMapping, string[]> = {
  date: ["FECHA", "DATE", "FECHA OPERACION", "FECHA DE OPERACION", "FECHA MOVIMIENTO", "FECHA ORIGEN"],
  description: ["DESCRIPCION", "CONCEPTO", "DETALLE", "DESCRIPTION", "MOVIMIENTO", "REFERENCIA"],
  amount: ["IMPORTE", "MONTO", "AMOUNT", "VALOR", "IMPORTE ARS", "IMPORTE EN PESOS"],
  debit: ["DEBITO", "DEBE", "EGRESO", "EGRESOS", "DEBITOS"],
  credit: ["CREDITO", "HABER", "INGRESO", "INGRESOS", "CREDITOS"],
};

export function detectMapping(headers: string[]): Partial<ColumnMapping> {
  const found: Partial<ColumnMapping> = {};
  for (const [key, names] of Object.entries(CANDIDATES) as [keyof ColumnMapping, string[]][]) {
    const match = headers.find((h) => names.includes(normalizeText(h)));
    if (match) found[key] = match;
  }
  if (found.amount) {
    delete found.debit;
    delete found.credit;
  }
  return found;
}

/** dd/mm/yyyy, dd-mm-yyyy, dd/mm/yy o yyyy-mm-dd -> yyyy-mm-dd */
export function parseDate(input: string): string | null {
  const s = input.trim().slice(0, 10);
  let iso: string | null = null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) iso = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    iso = `${year}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return iso && isValidISODate(iso) ? iso : null;
}

export function normalizeLines(
  parsed: ParsedStatement,
  mapping: ColumnMapping,
): { lines: StatementLine[]; errors: LineError[] } {
  const lines: StatementLine[] = [];
  const errors: LineError[] = [];
  parsed.rows.forEach((row, i) => {
    const line = i + 2; // +1 por el encabezado, +1 porque las líneas empiezan en 1
    const date = parseDate(row[mapping.date] ?? "");
    if (!date) {
      errors.push({ line, message: `Fecha inválida: "${row[mapping.date] ?? ""}"` });
      return;
    }
    const description = (row[mapping.description] ?? "").trim().replace(/\s+/g, " ");
    if (!description) {
      errors.push({ line, message: "Descripción vacía" });
      return;
    }
    try {
      let amount: number;
      if (mapping.amount) {
        amount = parseAmountToCents(row[mapping.amount] ?? "");
      } else {
        const debit = (row[mapping.debit ?? ""] ?? "").trim();
        const credit = (row[mapping.credit ?? ""] ?? "").trim();
        amount = (credit ? Math.abs(parseAmountToCents(credit)) : 0) - (debit ? Math.abs(parseAmountToCents(debit)) : 0);
      }
      if (amount === 0) {
        errors.push({ line, message: "Monto cero" });
        return;
      }
      lines.push({ line, date, description: description.slice(0, 200), amount });
    } catch (e) {
      errors.push({ line, message: e instanceof Error ? e.message : "Monto inválido" });
    }
  });
  return { lines, errors };
}

export function importHashes(accountId: string, lines: StatementLine[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((l) => {
    const key = `${accountId}|${l.date}|${l.amount}|${normalizeText(l.description)}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    return createHash("sha256").update(`${key}|${n}`).digest("hex");
  });
}

export type Rule = { pattern: string; accountId: string; priority: number };

/** Primera regla (por prioridad) cuyo patrón aparece en la descripción. */
export function matchRule(description: string, rules: Rule[]): string | null {
  const text = normalizeText(description);
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  return sorted.find((r) => text.includes(normalizeText(r.pattern)))?.accountId ?? null;
}
