import { addDays } from "@/lib/dates";
import { parseAmountToCents } from "@/lib/money";

/**
 * Interpreta mensajes del bot de Telegram como "café 2500", "12 lucas nafta",
 * "super 84.320 ayer", "+150000 sueldo" o "3500 regalo #compras".
 * Sin IA: reglas simples y predecibles.
 */

export type ParsedMessage =
  | { kind: "command"; command: string; arg: string }
  | {
      kind: "movement";
      type: "income" | "expense";
      cents: number;
      description: string | null;
      date: string;
      hashtag: string | null;
    }
  | { kind: "invalid" };

export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

const MULTIPLIERS = new Set(["k", "mil", "luca", "lucas"]);
// Marcan un ingreso y no aportan a la descripción
const INCOME_MARKERS = new Set(["ingreso", "ingresos", "cobre", "cobro", "gane", "entrada"]);
// Marcan un ingreso pero sí describen el movimiento
const INCOME_HINTS = new Set(["sueldo", "salario", "aguinaldo", "haberes"]);
const EXPENSE_MARKERS = new Set(["gaste", "gasto", "egreso", "pague", "compre"]);
const LEADING_FILLER = new Set(["en", "de", "del", "por", "un", "una", "el", "la", "los", "las", "me", "$", "pesos", "ars"]);
const DATE_WORDS: Record<string, number> = { hoy: 0, ayer: -1, anteayer: -2 };

const AMOUNT_RE = /^([+-])?\$?(\d[\d.,]*)(k|mil|lucas?)?$/i;

export function parseMessage(text: string, today: string): ParsedMessage {
  const trimmed = text.trim();
  if (trimmed.startsWith("/")) {
    const [cmd, ...rest] = trimmed.slice(1).split(/\s+/);
    return { kind: "command", command: normalize(cmd.split("@")[0]), arg: rest.join(" ").trim() };
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const used = new Set<number>();

  // Monto: el primer token que parezca un número (con "k", "mil" o "lucas" opcional)
  let cents = 0;
  let sign: string | undefined;
  for (let i = 0; i < tokens.length; i++) {
    const m = tokens[i].match(AMOUNT_RE);
    if (!m) continue;
    let value: number;
    try {
      value = Math.abs(parseAmountToCents(m[2]));
    } catch {
      continue;
    }
    let multiplied = Boolean(m[3]);
    if (!multiplied && tokens[i + 1] && MULTIPLIERS.has(normalize(tokens[i + 1]))) {
      multiplied = true;
      used.add(i + 1);
    }
    cents = multiplied ? value * 1000 : value;
    sign = m[1];
    used.add(i);
    break;
  }
  if (cents <= 0 || !Number.isSafeInteger(cents)) return { kind: "invalid" };

  let date = today;
  let hashtag: string | null = null;
  let type: "income" | "expense" = sign === "+" ? "income" : "expense";
  const words: string[] = [];

  tokens.forEach((tok, i) => {
    if (used.has(i)) return;
    const n = normalize(tok);
    if (n in DATE_WORDS) {
      date = addDays(today, DATE_WORDS[n]);
      return;
    }
    if (tok.startsWith("#") && tok.length > 1) {
      hashtag = normalize(tok.slice(1));
      return;
    }
    if (!sign && (INCOME_MARKERS.has(n) || INCOME_HINTS.has(n))) type = "income";
    if (INCOME_MARKERS.has(n) || EXPENSE_MARKERS.has(n)) return;
    words.push(tok);
  });

  while (words.length && LEADING_FILLER.has(normalize(words[0]))) words.shift();
  const joined = words.join(" ").trim();
  const description = joined ? (joined[0].toUpperCase() + joined.slice(1)).slice(0, 200) : null;

  return { kind: "movement", type, cents, description, date, hashtag };
}

// ---------------------------------------------------------------------------
// Elección de categoría
// ---------------------------------------------------------------------------

export type CategoryLite = { id: string; name: string; kind: string };

/** Palabras clave para las categorías por defecto (solo aplican si el usuario tiene esa categoría). */
const KEYWORDS: Record<string, string[]> = {
  "comida afuera": ["cafe", "delivery", "resto", "restaurante", "restaurant", "pizza", "empanadas", "hamburguesa", "sushi", "almuerzo", "cena", "desayuno", "merienda", "helado", "cerveza", "birra", "bar", "parrilla", "comida"],
  supermercado: ["super", "supermercado", "chino", "verduleria", "carniceria", "almacen", "mayorista", "dietetica", "panaderia", "fiambreria", "kiosco", "mercado"],
  transporte: ["sube", "colectivo", "bondi", "subte", "tren", "taxi", "uber", "cabify", "didi", "remis", "nafta", "combustible", "peaje", "estacionamiento", "cochera"],
  vivienda: ["alquiler", "expensas", "luz", "gas", "agua", "internet", "celular", "telefono", "abl", "wifi"],
  salud: ["farmacia", "medico", "prepaga", "obra", "dentista", "gimnasio", "gym", "remedios", "analisis", "psicologo", "kinesiologo"],
  "salidas y suscripciones": ["netflix", "spotify", "youtube", "disney", "hbo", "streaming", "cine", "teatro", "recital", "salida", "boliche", "suscripcion"],
  educacion: ["curso", "facultad", "universidad", "colegio", "libro", "libros", "clase", "clases", "apuntes", "ingles"],
  "ropa y compras": ["ropa", "zapatillas", "remera", "pantalon", "campera", "regalo", "regalos", "compras"],
  sueldo: ["sueldo", "salario", "aguinaldo", "haberes"],
  "trabajos extra": ["freelance", "proyecto", "changa", "extra", "clases", "trabajo"],
  "otros ingresos": ["venta", "vendi", "reintegro", "devolucion", "regalo"],
};

const IGNORED_CATEGORY_WORDS = new Set(["y", "de", "del", "otros", "otras", "afuera"]);

export type CategoryMatch = { id: string | null; how: "hashtag" | "learned" | "name" | "keyword" | null };

/**
 * Orden: #categoría explícita > lo que el usuario usó antes para esa misma
 * descripción > nombre de la categoría en el texto > palabras clave.
 */
export function matchCategory(opts: {
  description: string | null;
  hashtag: string | null;
  type: "income" | "expense";
  categories: CategoryLite[];
  learnedId?: string | null;
}): CategoryMatch {
  const candidates = opts.categories.filter((c) => c.kind === opts.type);
  const byId = new Set(candidates.map((c) => c.id));

  if (opts.hashtag) {
    const h = opts.hashtag;
    const hit =
      candidates.find((c) => normalize(c.name) === h) ??
      candidates.find((c) => normalize(c.name).startsWith(h)) ??
      candidates.find((c) => normalize(c.name).split(/\s+/).some((w) => w.startsWith(h)));
    if (hit) return { id: hit.id, how: "hashtag" };
  }

  if (opts.learnedId && byId.has(opts.learnedId)) return { id: opts.learnedId, how: "learned" };

  const tokens = normalize(opts.description ?? "")
    .split(/[^a-z0-9ñ]+/)
    .filter((t) => t.length >= 3);
  if (!tokens.length) return { id: null, how: null };

  for (const c of candidates) {
    const words = normalize(c.name)
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !IGNORED_CATEGORY_WORDS.has(w));
    const hit = tokens.some((t) => words.some((w) => w.startsWith(t) || (t.length >= 4 && t.startsWith(w))));
    if (hit) return { id: c.id, how: "name" };
  }

  for (const c of candidates) {
    const keywords = KEYWORDS[normalize(c.name)];
    if (keywords && tokens.some((t) => keywords.some((k) => t === k || (k.length >= 4 && t.startsWith(k))))) {
      return { id: c.id, how: "keyword" };
    }
  }
  return { id: null, how: null };
}
