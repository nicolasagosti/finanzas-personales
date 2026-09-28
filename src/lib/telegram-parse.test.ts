import { describe, expect, it } from "vitest";
import { parseMessage, resolveCategory, wordMatchesName } from "./telegram-parse";

const TODAY = "2026-09-28";

describe("parseMessage", () => {
  it.each([
    ["5000 comida", { type: "expense", typeExplicit: false, cents: 500000, words: ["comida"], date: TODAY }],
    ["5000 comida pizza con amigos", { cents: 500000, words: ["comida", "pizza", "con", "amigos"] }],
    ["comida 5000", { cents: 500000, words: ["comida"] }],
    ["super 84.320,50", { cents: 8432050, words: ["super"] }],
    ["12 lucas nafta ayer", { cents: 1200000, words: ["nafta"], date: "2026-09-27" }],
    ["nafta 12k", { cents: 1200000, words: ["nafta"] }],
    ["1,5k helado", { cents: 150000, words: ["helado"] }],
    ["gasté 3000 en el kiosco", { type: "expense", typeExplicit: true, words: ["kiosco"] }],
    ["anteayer 800 sube", { words: ["sube"], date: "2026-09-26" }],
    ["ingreso 500000", { type: "income", typeExplicit: true, cents: 50000000, words: [] }],
    ["ingreso 500000 sueldo", { type: "income", typeExplicit: true, words: ["sueldo"] }],
    ["500000 ingreso", { type: "income", typeExplicit: true, words: [] }],
    ["+150000 sueldo", { type: "income", typeExplicit: true, words: ["sueldo"] }],
    ["150000 sueldo", { type: "income", typeExplicit: false, words: ["sueldo"] }],
    ["cobré 50 lucas proyecto", { type: "income", cents: 5000000, words: ["proyecto"] }],
    ["3500 regalo #compras", { words: ["regalo"], hashtag: "compras" }],
    ["-1200 café", { type: "expense", typeExplicit: true, words: ["café"] }],
    ["2500", { type: "expense", words: [] }],
  ])("%s", (text, expected) => {
    expect(parseMessage(text, TODAY)).toMatchObject({ kind: "movement", ...expected });
  });

  it("reconoce comandos, incluso con el @ del bot", () => {
    expect(parseMessage("/start ABCD2345", TODAY)).toEqual({ kind: "command", command: "start", arg: "ABCD2345" });
    expect(parseMessage("/resumen@FinanzasBot", TODAY)).toEqual({ kind: "command", command: "resumen", arg: "" });
  });

  it.each(["hola", "café", "", "cero 0"])("sin monto válido: %j", (text) => {
    expect(parseMessage(text, TODAY)).toEqual({ kind: "invalid" });
  });
});

describe("wordMatchesName", () => {
  it.each([
    ["comida", "Comida afuera", true],
    ["super", "Supermercado", true],
    ["comdia", "Comida afuera", true], // error de tipeo
    ["trasnporte", "Transporte", true],
    ["salidas", "Salidas y suscripciones", true],
    ["salud", "Salidas y suscripciones", false],
    ["gas", "Vivienda", false],
    ["otros", "Otros gastos", true], // nombre completo empieza igual
  ])("%s ~ %s → %s", (word, name, expected) => {
    expect(wordMatchesName(word, name)).toBe(expected);
  });
});

describe("resolveCategory", () => {
  const categories = [
    { id: "viv", name: "Vivienda", kind: "expense" },
    { id: "sup", name: "Supermercado", kind: "expense" },
    { id: "com", name: "Comida afuera", kind: "expense" },
    { id: "tra", name: "Transporte", kind: "expense" },
    { id: "sal", name: "Salidas y suscripciones", kind: "expense" },
    { id: "rop", name: "Ropa y compras", kind: "expense" },
    { id: "sue", name: "Sueldo", kind: "income" },
    { id: "otr", name: "Otros ingresos", kind: "income" },
  ];
  const r = (text: string, learnedId?: string) => {
    const p = parseMessage(text, TODAY);
    if (p.kind !== "movement") throw new Error("no es movimiento");
    return resolveCategory({ ...p, categories, learnedId });
  };

  it("la palabra después del monto es la categoría", () => {
    expect(r("5000 comida")).toEqual({ type: "expense", category: { kind: "existing", id: "com", how: "name" }, description: "Comida" });
    expect(r("5000 comida pizza con amigos")).toMatchObject({ category: { id: "com" }, description: "Pizza con amigos" });
    expect(r("5000 comdia")).toMatchObject({ category: { id: "com" } });
    expect(r("5000 super")).toMatchObject({ category: { id: "sup", how: "name" } });
  });

  it("acepta el nombre completo de varias palabras", () => {
    expect(r("5000 comida afuera pizza")).toMatchObject({ category: { id: "com" }, description: "Pizza" });
  });

  it("sinónimos: nafta es Transporte, café es Comida afuera", () => {
    expect(r("12 lucas nafta")).toMatchObject({ category: { id: "tra", how: "keyword" }, description: "Nafta" });
    expect(r("2500 café")).toMatchObject({ category: { id: "com", how: "keyword" } });
  });

  it("si la categoría no existe, la crea", () => {
    expect(r("3500 veterinaria")).toEqual({ type: "expense", category: { kind: "create", name: "Veterinaria" }, description: "Veterinaria" });
    expect(r("3500 regalo #mascotas")).toMatchObject({ category: { kind: "create", name: "Mascotas" }, description: "Regalo" });
  });

  it("ingreso sin categoría va a la categoría por defecto, sin preguntar", () => {
    expect(r("ingreso 500000")).toEqual({ type: "income", category: { kind: "default" }, description: null });
    expect(r("ingreso 500000 sueldo")).toMatchObject({ type: "income", category: { id: "sue" } });
  });

  it("sin aclarar el tipo, una categoría de ingreso lo vuelve ingreso", () => {
    expect(r("150000 sueldo")).toMatchObject({ type: "income", category: { id: "sue" } });
  });

  it("lo aprendido le gana a los sinónimos, pero no al nombre de una categoría", () => {
    expect(r("12 lucas nafta", "viv")).toMatchObject({ category: { id: "viv", how: "learned" } });
    expect(r("5000 comida", "viv")).toMatchObject({ category: { id: "com", how: "name" } });
  });

  it("egreso sin categoría va a la categoría por defecto", () => {
    expect(r("2500")).toEqual({ type: "expense", category: { kind: "default" }, description: null });
  });
});
