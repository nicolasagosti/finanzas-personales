import { addDays } from "@/lib/dates";
import { parseAmountToCents } from "@/lib/money";

/**
 * Interpreta los mensajes del bot de Telegram. Formato:
 *
 *   [ingreso] <monto> <categoría> [detalle] [ayer] [#categoría]
 *
 *   "5000 comida"                 → egreso en Comida afuera
 *   "5000 comida pizza"           → egreso en Comida afuera, detalle "Pizza"
 *   "12 lucas nafta ayer"         → egreso de ayer en Transporte
 *   "ingreso 500000"              → ingreso en Otros ingresos
 *   "ingreso 500000 sueldo"       → ingreso en Sueldo
 *
 * Si no se aclara nada es egreso. Sin IA: reglas simples y predecibles.
 */

export type ParsedMessage =
  | { kind: "command"; command: string; arg: string }
  | {
      kind: "movement";
      type: "income" | "expense";
      /** true si el mensaje lo dijo ("ingreso", "+", "gasté"…); false si es el valor por defecto o una pista */
      typeExplicit: boolean;
      cents: number;
      /** palabras restantes, en orden: la primera es la categoría y el resto el detalle */
      words: string[];
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

export function capitalize(s: string): string {
  const t = s.trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

const MULTIPLIERS = new Set(["k", "mil", "luca", "lucas"]);
const INCOME_MARKERS = new Set(["ingreso", "ingresos", "cobre", "cobro", "gane", "entrada"]);
// Sugieren ingreso pero también nombran la categoría: no se descartan
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
  let type: "income" | "expense" = "expense";
  let typeExplicit = false;
  if (sign) {
    type = sign === "+" ? "income" : "expense";
    typeExplicit = true;
  }
  const words: string[] = [];

  tokens.forEach((tok, i) => {
    if (used.has(i)) return;
    const n = normalize(tok);
    if (n in DATE_WORDS) {
      date = addDays(today, DATE_WORDS[n]);
      return;
    }
    if (tok.startsWith("#") && tok.length > 1) {
      hashtag = tok.slice(1);
      return;
    }
    if (INCOME_MARKERS.has(n) || EXPENSE_MARKERS.has(n)) {
      if (!typeExplicit) {
        type = INCOME_MARKERS.has(n) ? "income" : "expense";
        typeExplicit = true;
      }
      return;
    }
    if (!typeExplicit && INCOME_HINTS.has(n)) type = "income";
    words.push(tok);
  });

  while (words.length && LEADING_FILLER.has(normalize(words[0]))) words.shift();
  return { kind: "movement", type, typeExplicit, cents, words, date, hashtag };
}

// ---------------------------------------------------------------------------
// Categoría
// ---------------------------------------------------------------------------

export type CategoryLite = { id: string; name: string; kind: string };

/** Sinónimos para las categorías por defecto (solo aplican si el usuario tiene esa categoría). */
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
  "trabajos extra": ["freelance", "proyecto", "changa", "extra", "trabajo"],
  "otros ingresos": ["venta", "vendi", "reintegro", "devolucion"],
};

const IGNORED_CATEGORY_WORDS = new Set(["y", "de", "del", "otros", "otras", "afuera"]);

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** "super" → Supermercado, "comdia" → Comida afuera (tolera errores de tipeo en palabras largas). */
export function wordMatchesName(word: string, name: string): boolean {
  const w = normalize(word);
  const n = normalize(name);
  if (!w) return false;
  if (w === n) return true;
  if (w.length < 3) return false;
  if (n.startsWith(w)) return true;
  const parts = n.split(/\s+/).filter((p) => p.length >= 3 && !IGNORED_CATEGORY_WORDS.has(p));
  if (parts.some((p) => p.startsWith(w) || (w.length >= 4 && w.startsWith(p)))) return true;
  const tolerance = w.length >= 6 ? 2 : w.length >= 4 ? 1 : 0;
  return tolerance > 0 && parts.some((p) => levenshtein(w, p) <= tolerance);
}

export type Resolution = {
  type: "income" | "expense";
  category:
    | { kind: "existing"; id: string; how: "hashtag" | "name" | "learned" | "keyword" }
    | { kind: "create"; name: string }
    | { kind: "default" };
  /** detalle del movimiento; null si solo se dijo la categoría o nada */
  description: string | null;
};

/**
 * Elige la categoría. Orden: #categoría > nombre de una categoría existente
 * (abreviado o con errores de tipeo) > lo que el usuario usó antes para esa
 * palabra > sinónimos > categoría nueva con esa palabra. Sin palabras: la
 * categoría por defecto ("Otros gastos" / "Otros ingresos").
 */
export function resolveCategory(opts: {
  words: string[];
  hashtag: string | null;
  type: "income" | "expense";
  typeExplicit: boolean;
  categories: CategoryLite[];
  learnedId?: string | null;
}): Resolution {
  const { words, hashtag, typeExplicit, categories } = opts;
  // Sin tipo explícito se busca primero en egresos y después en ingresos ("150000 sueldo" es ingreso)
  const kinds: ("income" | "expense")[] = typeExplicit ? [opts.type] : opts.type === "income" ? ["income", "expense"] : ["expense", "income"];
  const ofKind = (k: string) => categories.filter((c) => c.kind === k);
  const text = (ws: string[]) => (ws.length ? capitalize(ws.join(" ")).slice(0, 200) : null);

  if (hashtag) {
    for (const k of kinds) {
      const hit = ofKind(k).find((c) => wordMatchesName(hashtag, c.name));
      if (hit) return { type: k, category: { kind: "existing", id: hit.id, how: "hashtag" }, description: text(words) };
    }
    return { type: opts.type, category: { kind: "create", name: capitalize(hashtag).slice(0, 60) }, description: text(words) };
  }

  if (!words.length) return { type: opts.type, category: { kind: "default" }, description: null };

  // Nombre de varias palabras escrito completo: "5000 comida afuera pizza"
  for (let n = Math.min(4, words.length); n >= 2; n--) {
    const phrase = normalize(words.slice(0, n).join(" "));
    for (const k of kinds) {
      const hit = ofKind(k).find((c) => normalize(c.name) === phrase);
      if (hit) {
        return { type: k, category: { kind: "existing", id: hit.id, how: "name" }, description: text(words.slice(n)) ?? text(words.slice(0, n)) };
      }
    }
  }

  const [first, ...rest] = words;
  const description = text(rest) ?? text([first]);

  for (const k of kinds) {
    const hit = ofKind(k).find((c) => wordMatchesName(first, c.name));
    if (hit) return { type: k, category: { kind: "existing", id: hit.id, how: "name" }, description };
  }

  const learned = opts.learnedId ? categories.find((c) => c.id === opts.learnedId) : undefined;
  if (learned && (!typeExplicit || learned.kind === opts.type)) {
    return { type: learned.kind as "income" | "expense", category: { kind: "existing", id: learned.id, how: "learned" }, description };
  }

  const w = normalize(first);
  for (const k of kinds) {
    const hit = ofKind(k).find((c) =>
      (KEYWORDS[normalize(c.name)] ?? []).some((kw) => w === kw || (kw.length >= 4 && w.startsWith(kw))),
    );
    if (hit) return { type: k, category: { kind: "existing", id: hit.id, how: "keyword" }, description };
  }

  if (w.length >= 3 && /[a-zñ]/.test(w)) {
    return { type: opts.type, category: { kind: "create", name: capitalize(first).slice(0, 60) }, description };
  }
  return { type: opts.type, category: { kind: "default" }, description: text(words) };
}
