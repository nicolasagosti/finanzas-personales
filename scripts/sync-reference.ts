/**
 * Descarga las series de referencia (IPC del INDEC y cotizaciones del dólar)
 * y las guarda como snapshot versionado en src/db/reference-data.json.
 *
 * La app carga ese snapshot al migrar la base, así funciona sin red.
 * Uso: npm run sync:indices
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";

const FROM = "2023-01-01";

// IPC Nacional, nivel general, base dic-2016 (INDEC vía datos.gob.ar)
const CPI_URL =
  "https://apis.datos.gob.ar/series/api/series/?ids=148.3_INIVELNAL_DICI_M_26&format=json&limit=1000&start_date=" +
  FROM;

// Cotizaciones diarias (argentinadatos.com). "bolsa" es el dólar MEP.
const FX_SOURCES = {
  oficial: "https://api.argentinadatos.com/v1/cotizaciones/dolares/oficial",
  mep: "https://api.argentinadatos.com/v1/cotizaciones/dolares/bolsa",
  blue: "https://api.argentinadatos.com/v1/cotizaciones/dolares/blue",
} as const;

type FxRow = { casa: string; compra: number | null; venta: number | null; fecha: string };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${url} respondió ${res.status}`);
  return (await res.json()) as T;
}

async function main() {
  const cpiJson = await getJson<{ data: [string, number][] }>(CPI_URL);
  const cpi = cpiJson.data
    .filter(([, v]) => v != null)
    .map(([month, value]) => ({ month, value: Math.round(value * 10000) / 10000 }));

  const fx: { month: string; kind: string; arsPerUsd: number }[] = [];
  for (const [kind, url] of Object.entries(FX_SOURCES)) {
    const rows = await getJson<FxRow[]>(url);
    const byMonth = new Map<string, number[]>();
    for (const r of rows) {
      if (r.fecha < FROM || r.venta == null) continue;
      const month = r.fecha.slice(0, 7) + "-01";
      const list = byMonth.get(month) ?? [];
      list.push(r.venta);
      byMonth.set(month, list);
    }
    for (const [month, values] of [...byMonth].sort()) {
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      fx.push({ month, kind, arsPerUsd: Math.round(avg * 100) / 100 });
    }
  }

  const out = {
    generatedAt: new Date().toISOString(),
    sources: {
      cpi: "INDEC — IPC Nacional nivel general, base dic-2016 (apis.datos.gob.ar, serie 148.3_INIVELNAL_DICI_M_26)",
      fx: "argentinadatos.com — promedio mensual del valor de venta (oficial, MEP/bolsa, blue)",
    },
    cpi,
    fx,
  };

  const target = path.join(process.cwd(), "src/db/reference-data.json");
  await writeFile(target, JSON.stringify(out, null, 1) + "\n");
  console.log(`IPC: ${cpi.length} meses (último ${cpi.at(-1)?.month}). Dólar: ${fx.length} filas.`);
  console.log(`Snapshot escrito en ${target}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
