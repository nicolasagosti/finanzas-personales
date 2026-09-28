import { describe, expect, it } from "vitest";
import { assertBalanced, fxPurchaseTransaction, simpleTransaction, transferTransaction } from "./ledger";

describe("invariante de partida doble", () => {
  it("un gasto simple balancea", () => {
    const tx = simpleTransaction({ date: "2026-09-01", description: "x", amount: -1000, moneyAccountId: "a", categoryAccountId: "b" });
    expect(() => assertBalanced(tx)).not.toThrow();
    expect(tx.postings.map((p) => p.amount)).toEqual([-1000, 1000]);
  });

  it("una transferencia balancea", () => {
    const tx = transferTransaction({ date: "2026-09-01", description: "x", amount: 500, fromAccountId: "a", toAccountId: "b" });
    expect(() => assertBalanced(tx)).not.toThrow();
  });

  it("la compra de dólares balancea por moneda con cuentas puente", () => {
    const tx = fxPurchaseTransaction({
      date: "2026-09-01",
      description: "MEP",
      arsAmount: 15_382_000,
      usdAmount: 10_000,
      fromArsAccountId: "banco",
      toUsdAccountId: "usd",
      conversionArsId: "convArs",
      conversionUsdId: "convUsd",
    });
    expect(() => assertBalanced(tx)).not.toThrow();
  });

  it("rechaza asientos desbalanceados, montos no enteros o cero", () => {
    const base = { date: "2026-09-01", description: "x", source: "manual" as const };
    expect(() => assertBalanced({ ...base, postings: [{ accountId: "a", amount: 100, currency: "ARS" }, { accountId: "b", amount: -99, currency: "ARS" }] })).toThrow(/desbalanceado/);
    expect(() => assertBalanced({ ...base, postings: [{ accountId: "a", amount: 10.5, currency: "ARS" }, { accountId: "b", amount: -10.5, currency: "ARS" }] })).toThrow(/entero/);
    expect(() => assertBalanced({ ...base, postings: [{ accountId: "a", amount: 100, currency: "ARS" }] })).toThrow(/dos asientos/);
    // balancear entre monedas distintas no vale
    expect(() => assertBalanced({ ...base, postings: [{ accountId: "a", amount: 100, currency: "USD" }, { accountId: "b", amount: -100, currency: "ARS" }] })).toThrow(/desbalanceado/);
  });
});
