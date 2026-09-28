"use client";

import { useMemo, useState, useTransition } from "react";
import Papa from "papaparse";
import { CheckCircle2, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { NativeSelect } from "@/components/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { importStatement, type ImportResult } from "./actions";

type Mapping = { date: string; description: string; amount: string; debit: string; credit: string };

const GUESS: Record<keyof Mapping, string[]> = {
  date: ["fecha", "date", "fecha operacion", "fecha de operacion", "fecha movimiento", "fecha origen"],
  description: ["descripcion", "concepto", "detalle", "description", "movimiento", "referencia"],
  amount: ["importe", "monto", "amount", "valor", "importe ars", "importe en pesos"],
  debit: ["debito", "debe", "egreso", "egresos", "debitos"],
  credit: ["credito", "haber", "ingreso", "ingresos", "creditos"],
};

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

function guessMapping(headers: string[]): Mapping {
  const find = (k: keyof Mapping) => headers.find((h) => GUESS[k].includes(norm(h))) ?? "";
  const m = { date: find("date"), description: find("description"), amount: find("amount"), debit: find("debit"), credit: find("credit") };
  if (m.amount) {
    m.debit = "";
    m.credit = "";
  }
  return m;
}

export function Importer({ accounts }: { accounts: { id: string; name: string; kind: string }[] }) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [csv, setCsv] = useState("");
  const [mapping, setMapping] = useState<Mapping>({ date: "", description: "", amount: "", debit: "", credit: "" });
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [invert, setInvert] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, start] = useTransition();

  const parsed = useMemo(() => {
    if (!csv) return null;
    const r = Papa.parse<Record<string, string>>(csv.replace(/^﻿/, ""), {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim(),
    });
    return { headers: (r.meta.fields ?? []).filter(Boolean), rows: r.data };
  }, [csv]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 1_400_000) {
      setResult({ ok: false, message: "El archivo supera 1,4 MB" });
      return;
    }
    const text = await file.text();
    setFileName(file.name);
    setCsv(text);
    setResult(null);
    const headers = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), { header: true, preview: 1 }).meta.fields ?? [];
    setMapping(guessMapping(headers.map((h) => h.trim())));
    // Los resúmenes de tarjeta suelen listar los consumos en positivo
    const acc = accounts.find((a) => a.id === accountId);
    setInvert(acc?.kind === "liability");
  };

  const submit = () =>
    start(async () => {
      const res = await importStatement({
        csv,
        accountId,
        invert,
        mapping: {
          date: mapping.date,
          description: mapping.description,
          amount: mapping.amount || undefined,
          debit: mapping.debit || undefined,
          credit: mapping.credit || undefined,
        },
      });
      setResult(res);
    });

  const canSubmit = Boolean(csv && accountId && mapping.date && mapping.description && (mapping.amount || mapping.debit || mapping.credit));

  const column = (key: keyof Mapping, label: string, optional = false) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`map-${key}`}>{label}</Label>
      <NativeSelect id={`map-${key}`} value={mapping[key]} onChange={(e) => setMapping((m) => ({ ...m, [key]: e.target.value }))}>
        <option value="">{optional ? "— ninguna —" : "Elegí una columna"}</option>
        {parsed?.headers.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </NativeSelect>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>1. Elegí el archivo</CardTitle>
          <CardDescription>
            CSV exportado del home banking o de la billetera. Detectamos separador, columnas y formato de montos
            (1.234,56 o 1,234.56).{" "}
            <a href="/ejemplo-resumen.csv" download className="text-primary underline">
              Descargar un CSV de ejemplo
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <label
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors hover:border-primary/50 hover:bg-accent/30",
              fileName && "border-primary/40 bg-accent/30",
            )}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void onFile(e.dataTransfer.files[0]);
            }}
          >
            {fileName ? <FileSpreadsheet className="size-8 text-primary" /> : <Upload className="size-8 text-muted-foreground" />}
            <span className="font-medium">{fileName ?? "Arrastrá el archivo o hacé clic para elegirlo"}</span>
            <span className="text-sm text-muted-foreground">
              {parsed ? `${parsed.rows.length} filas · ${parsed.headers.length} columnas` : "Solo .csv, hasta 1,4 MB"}
            </span>
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>
        </CardContent>
      </Card>

      {parsed ? (
        <Card>
          <CardHeader>
            <CardTitle>2. Revisá las columnas</CardTitle>
            <CardDescription>Usá “Monto” si viene con signo, o “Débito” y “Crédito” si vienen separados.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {column("date", "Fecha")}
              {column("description", "Descripción")}
              {column("amount", "Monto", true)}
              {column("debit", "Débito", true)}
              {column("credit", "Crédito", true)}
            </div>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <div className="grid gap-1.5 sm:w-72">
                <Label htmlFor="account">Cuenta de destino</Label>
                <NativeSelect id="account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex h-9 items-center gap-2">
                <Switch id="invert" checked={invert} onCheckedChange={setInvert} />
                <Label htmlFor="invert">Los montos positivos son gastos (resumen de tarjeta)</Label>
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    {parsed.headers.map((h) => (
                      <TableHead key={h} className={cn(Object.values(mapping).includes(h) && "text-primary")}>
                        {h}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsed.rows.slice(0, 6).map((r, i) => (
                    <TableRow key={i}>
                      {parsed.headers.map((h) => (
                        <TableCell key={h} className="max-w-64 truncate text-sm">
                          {r[h]}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex justify-end">
              <Button onClick={submit} disabled={!canSubmit || pending} size="lg">
                {pending ? <Loader2 className="animate-spin" /> : <Upload />} Importar {parsed.rows.length} filas
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {result ? (
        result.ok ? (
          <Alert className="border-positive/40">
            <CheckCircle2 className="text-positive" />
            <AlertTitle>Importación terminada</AlertTitle>
            <AlertDescription>
              <ul className="mt-1 grid gap-1 sm:grid-cols-2">
                <li><strong className="tabular">{result.inserted}</strong> movimientos nuevos</li>
                <li><strong className="tabular">{result.duplicates}</strong> ya existían y se omitieron</li>
                <li><strong className="tabular">{result.byRule}</strong> categorizados por reglas</li>
                <li><strong className="tabular">{result.uncategorized}</strong> quedaron sin categorizar</li>
              </ul>
              {result.errors.length ? (
                <details className="mt-2">
                  <summary className="cursor-pointer">{result.errors.length} filas con errores</summary>
                  <ul className="mt-1 list-disc pl-5">
                    {result.errors.map((e) => (
                      <li key={e.line}>Línea {e.line}: {e.message}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
              <p className="mt-2">Probá importar el mismo archivo otra vez: no se duplica nada.</p>
            </AlertDescription>
          </Alert>
        ) : (
          <Alert variant="destructive">
            <AlertTitle>No se pudo importar</AlertTitle>
            <AlertDescription>{result.message}</AlertDescription>
          </Alert>
        )
      ) : null}
    </div>
  );
}
