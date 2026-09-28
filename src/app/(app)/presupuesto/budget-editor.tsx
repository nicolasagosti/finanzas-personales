"use client";

import { useState, useTransition } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { formatMoney, formatPercent, parseAmountToCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { saveBudgets } from "./actions";

export type BudgetRow = { id: string; name: string; budget: number; spent: number; suggestion: number };

const toInput = (cents: number) => (cents ? String(Math.round(cents / 100)) : "");

function safeCents(v: string): number {
  try {
    return v.trim() ? Math.abs(parseAmountToCents(v)) : 0;
  } catch {
    return 0;
  }
}

export function BudgetEditor({ rows, isCurrentMonth }: { rows: BudgetRow[]; isCurrentMonth: boolean }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.id, toInput(r.budget)])),
  );
  const [pending, start] = useTransition();
  const dirty = rows.some((r) => safeCents(values[r.id] ?? "") !== r.budget);

  const totalBudget = rows.reduce((a, r) => a + safeCents(values[r.id] ?? ""), 0);
  const totalSpent = rows.reduce((a, r) => a + r.spent, 0);

  const save = () =>
    start(async () => {
      const res = await saveBudgets(rows.map((r) => ({ accountId: r.id, amount: values[r.id] ?? "" })));
      if (res) (res.ok ? toast.success : toast.error)(res.message);
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            Gastado {isCurrentMonth ? "en lo que va del mes" : "en el mes"}
          </p>
          <p className="text-2xl font-semibold tracking-tight tabular">
            {formatMoney(totalSpent, "ARS", { decimals: false })}
            <span className="text-base font-normal text-muted-foreground"> de {formatMoney(totalBudget, "ARS", { decimals: false })}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => setValues(Object.fromEntries(rows.map((r) => [r.id, toInput(r.suggestion)])))}
            title="Promedio de los últimos 3 meses cerrados, ajustado por inflación a pesos de hoy"
          >
            <Sparkles /> Usar sugerencias
          </Button>
          <Button onClick={save} disabled={!dirty || pending}>
            {pending ? <Loader2 className="animate-spin" /> : null} Guardar cambios
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="hidden grid-cols-[1.4fr_9rem_1.6fr_8rem] gap-4 border-b bg-muted/40 px-4 py-2.5 text-xs font-medium text-muted-foreground md:grid">
          <span>Categoría</span>
          <span>Presupuesto</span>
          <span>Consumido</span>
          <span className="text-right">Disponible</span>
        </div>
        <ul className="divide-y">
          {rows.map((r) => {
            const budget = safeCents(values[r.id] ?? "");
            const ratio = budget ? r.spent / budget : r.spent ? Infinity : 0;
            const remaining = budget - r.spent;
            return (
              <li key={r.id} className="grid gap-3 px-4 py-3 md:grid-cols-[1.4fr_9rem_1.6fr_8rem] md:items-center md:gap-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{r.name}</p>
                  <p className="text-xs text-muted-foreground tabular">
                    Sugerido {formatMoney(r.suggestion, "ARS", { decimals: false })}
                  </p>
                </div>
                <div className="relative">
                  <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                  <Input
                    aria-label={`Presupuesto de ${r.name}`}
                    inputMode="numeric"
                    value={values[r.id] ?? ""}
                    placeholder="0"
                    onChange={(e) => setValues((v) => ({ ...v, [r.id]: e.target.value }))}
                    className="h-8 pl-6 text-right tabular"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <Progress
                    value={budget ? Math.min(100, ratio * 100) : 0}
                    className={cn("flex-1", ratio > 1 && "[&_[data-slot=progress-indicator]]:bg-destructive")}
                    aria-label={`${r.name}: consumido`}
                  />
                  <span className="w-12 text-right text-xs text-muted-foreground tabular">
                    {budget ? formatPercent(Math.min(ratio, 9.99), 0) : "—"}
                  </span>
                </div>
                <span className={cn("text-sm font-medium tabular md:text-right", remaining < 0 && "text-destructive")}>
                  {budget ? formatMoney(remaining, "ARS", { decimals: false }) : formatMoney(-r.spent, "ARS", { decimals: false })}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
