/**
 * Colores de categoría. Orden fijo de la paleta validada para daltonismo
 * (ver README → Visualización); "gray" queda para "Otros".
 */
export const CATEGORY_COLORS = ["blue", "orange", "aqua", "yellow", "magenta", "green", "violet", "red"] as const;
export type CategoryColor = (typeof CATEGORY_COLORS)[number] | "gray";

export const COLOR_LABELS: Record<CategoryColor, string> = {
  blue: "Azul",
  orange: "Naranja",
  aqua: "Verde agua",
  yellow: "Amarillo",
  magenta: "Rosa",
  green: "Verde",
  violet: "Violeta",
  red: "Rojo",
  gray: "Gris",
};

export function colorVar(color: string | null | undefined): string {
  return `var(--cat-${color ?? "gray"})`;
}

/** Primer color de la paleta que todavía no usa ninguna categoría del mismo tipo. */
export function nextColor(used: (string | null)[]): CategoryColor {
  const count = new Map<string, number>();
  for (const c of used) if (c) count.set(c, (count.get(c) ?? 0) + 1);
  // el menos usado, respetando el orden de la paleta
  return [...CATEGORY_COLORS].sort((a, b) => (count.get(a) ?? 0) - (count.get(b) ?? 0))[0];
}
