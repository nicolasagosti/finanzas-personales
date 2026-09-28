import { describe, expect, it } from "vitest";
import { matchCategory, parseMessage } from "./telegram-parse";

const TODAY = "2026-09-28";

describe("parseMessage", () => {
  it.each([
    ["café 2500", { type: "expense", cents: 250000, description: "Café", date: TODAY }],
    ["2500 café", { type: "expense", cents: 250000, description: "Café" }],
    ["super 84.320,50", { type: "expense", cents: 8432050, description: "Super" }],
    ["12 lucas nafta", { type: "expense", cents: 1200000, description: "Nafta" }],
    ["nafta 12k", { type: "expense", cents: 1200000, description: "Nafta" }],
    ["1,5k helado", { type: "expense", cents: 150000, description: "Helado" }],
    ["gasté 3000 en el kiosco", { type: "expense", cents: 300000, description: "Kiosco" }],
    ["pagué $ 45.000 de luz", { type: "expense", cents: 4500000, description: "Luz" }],
    ["verdulería 5400 ayer", { type: "expense", description: "Verdulería", date: "2026-09-27" }],
    ["anteayer 800 sube", { type: "expense", description: "Sube", date: "2026-09-26" }],
    ["+150000 sueldo", { type: "income", cents: 15000000, description: "Sueldo" }],
    ["sueldo 2.650.000", { type: "income", cents: 265000000, description: "Sueldo" }],
    ["ingreso 20000 venta de la bici", { type: "income", cents: 2000000, description: "Venta de la bici" }],
    ["cobré 50 lucas proyecto", { type: "income", cents: 5000000, description: "Proyecto" }],
    ["3500 regalo #compras", { type: "expense", cents: 350000, description: "Regalo", hashtag: "compras" }],
    ["-1200 café", { type: "expense", cents: 120000, description: "Café" }],
    ["2500", { type: "expense", cents: 250000, description: null }],
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

describe("matchCategory", () => {
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
  const m = (description: string | null, type: "income" | "expense" = "expense", extra: object = {}) =>
    matchCategory({ description, hashtag: null, type, categories, ...extra });

  it("por nombre de la categoría (aunque esté abreviado)", () => {
    expect(m("Super")).toEqual({ id: "sup", how: "name" });
    expect(m("Salida con amigos")).toEqual({ id: "sal", how: "name" });
  });

  it("por palabras clave", () => {
    expect(m("Café")).toEqual({ id: "com", how: "keyword" });
    expect(m("Nafta")).toEqual({ id: "tra", how: "keyword" });
    expect(m("Luz")).toEqual({ id: "viv", how: "keyword" });
    expect(m("Venta de la bici", "income")).toEqual({ id: "otr", how: "keyword" });
  });

  it("el #hashtag gana y lo aprendido le gana al nombre y a las palabras clave", () => {
    expect(m("Café", "expense", { hashtag: "ropa" })).toEqual({ id: "rop", how: "hashtag" });
    expect(m("Café", "expense", { learnedId: "sal" })).toEqual({ id: "sal", how: "learned" });
  });

  it("no mezcla ingresos con egresos ni inventa categorías", () => {
    expect(m("Sueldo", "expense")).toEqual({ id: null, how: null });
    expect(m("Veterinaria")).toEqual({ id: null, how: null });
    expect(m(null)).toEqual({ id: null, how: null });
    expect(m("Café", "expense", { learnedId: "sue" })).toEqual({ id: "com", how: "keyword" });
  });
});
