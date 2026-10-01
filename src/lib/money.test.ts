import { describe, expect, it } from "vitest";
import { formatAmountInput, formatMoney, parseAmountToCents } from "./money";

describe("parseAmountToCents", () => {
  it.each([
    ["1.234,56", 123456],
    ["1,234.56", 123456],
    ["-1.234,56", -123456],
    ["$ 1.234", 123400],
    ["1.234.567", 123456700],
    ["(1.234,56)", -123456],
    ["1234.5", 123450],
    ["0,1", 10],
    ["12,345", 1234500], // un solo separador seguido de 3 dígitos: miles (es-AR)
    ["1.234,565", 123457], // redondeo half-up sin floats
    ["150-", -15000], // signo al final, como en algunos resúmenes
    ["US$ 100", 10000],
  ])("%s -> %d", (input, cents) => {
    expect(parseAmountToCents(input)).toBe(cents);
  });

  it("no pierde precisión donde parseFloat sí lo haría", () => {
    // 0.1 + 0.2 !== 0.3 en float; en centavos enteros sí da exacto
    expect(parseAmountToCents("0,10") + parseAmountToCents("0,20")).toBe(parseAmountToCents("0,30"));
  });

  it.each(["", "abc", "1,2,3a", "--5"])("rechaza %j", (input) => {
    expect(() => parseAmountToCents(input)).toThrow();
  });
});

describe("formatMoney", () => {
  it("formatea en es-AR", () => {
    expect(formatMoney(123456).replace(/\s/g, " ")).toBe("$ 1.234,56");
    expect(formatMoney(-50000, "ARS", { decimals: false }).replace(/\s/g, " ")).toBe("-$ 500");
  });
});

describe("formatAmountInput", () => {
  it.each([1250050, 1250000, 50, 123456700, 99, -680000])("%d vuelve igual al releerlo", (cents) => {
    expect(parseAmountToCents(formatAmountInput(cents))).toBe(Math.abs(cents));
  });

  it("muestra decimales solo si hay centavos", () => {
    expect(formatAmountInput(1250000)).toBe("12.500");
    expect(formatAmountInput(1250050)).toBe("12.500,50");
  });
});
