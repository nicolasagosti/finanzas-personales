import { describe, expect, it } from "vitest";
import { detectMapping, importHashes, matchRule, normalizeLines, parseDate, parseStatement } from "./import";

const CSV = `Fecha;Descripción;Importe
01/09/2026;SUPERMERCADO BARRIO;-84.320,50
02/09/2026;CAFÉ DE ESPECIALIDAD;-6.800,00
02/09/2026;CAFÉ DE ESPECIALIDAD;-6.800,00
31/02/2026;FECHA IMPOSIBLE;-1,00
10/09/2026;REINTEGRO;45.000,00`;

describe("importación de resúmenes", () => {
  const parsed = parseStatement(CSV);
  const mapping = detectMapping(parsed.headers);

  it("detecta separador y columnas", () => {
    expect(parsed.headers).toEqual(["Fecha", "Descripción", "Importe"]);
    expect(mapping).toEqual({ date: "Fecha", description: "Descripción", amount: "Importe" });
  });

  it("normaliza filas y reporta errores por línea", () => {
    const { lines, errors } = normalizeLines(parsed, mapping as never);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatchObject({ date: "2026-09-01", amount: -8432050 });
    expect(errors).toEqual([{ line: 5, message: expect.stringContaining("Fecha inválida") }]);
  });

  it("las huellas son deterministas y distinguen filas idénticas", () => {
    const { lines } = normalizeLines(parsed, mapping as never);
    const a = importHashes("acc-1", lines);
    const b = importHashes("acc-1", lines);
    expect(a).toEqual(b); // reimportar => mismas huellas => ON CONFLICT DO NOTHING
    expect(new Set(a).size).toBe(a.length); // los dos cafés iguales no colisionan
    expect(importHashes("acc-2", lines)[0]).not.toBe(a[0]); // la cuenta forma parte de la huella
  });

  it("un archivo superpuesto reutiliza las huellas de las filas compartidas", () => {
    const { lines } = normalizeLines(parsed, mapping as never);
    const firstHalf = importHashes("acc", lines.slice(0, 2));
    const all = importHashes("acc", lines);
    expect(all.slice(0, 2)).toEqual(firstHalf);
  });

  it("soporta columnas de débito y crédito", () => {
    const p = parseStatement("Fecha,Concepto,Débito,Crédito\n2026-09-01,Pago,1500.50,\n2026-09-02,Cobro,,2000");
    const m = detectMapping(p.headers);
    expect(m).toEqual({ date: "Fecha", description: "Concepto", debit: "Débito", credit: "Crédito" });
    const { lines } = normalizeLines(p, m as never);
    expect(lines.map((l) => l.amount)).toEqual([-150050, 200000]);
  });
});

describe("parseDate", () => {
  it.each([
    ["01/09/2026", "2026-09-01"],
    ["1-9-26", "2026-09-01"],
    ["2026-09-01", "2026-09-01"],
    ["29/02/2025", null],
    ["hola", null],
  ])("%s -> %s", (input, expected) => {
    expect(parseDate(input)).toBe(expected);
  });
});

describe("matchRule", () => {
  const rules = [
    { pattern: "SUPERMERCADO", accountId: "super", priority: 100 },
    { pattern: "cafe", accountId: "cafe", priority: 50 },
    { pattern: "SUPERMERCADO CAFE", accountId: "especial", priority: 10 },
  ];
  it("ignora mayúsculas y acentos y respeta la prioridad", () => {
    expect(matchRule("Café de especialidad", rules)).toBe("cafe");
    expect(matchRule("SUPERMERCADO CAFÉ", rules)).toBe("especial");
    expect(matchRule("supermercado barrio", rules)).toBe("super");
    expect(matchRule("VETERINARIA", rules)).toBeNull();
  });
});
