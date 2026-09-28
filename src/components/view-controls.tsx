"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/native-select";
import { cn } from "@/lib/utils";
import { addMonths, monthLabelLong } from "@/lib/dates";

export function ViewControls({
  month,
  currentMonth,
  currency,
  fx,
  real,
  showCurrency = true,
}: {
  month: string;
  currentMonth: string;
  currency: "ARS" | "USD";
  fx: string;
  real: boolean;
  showCurrency?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  const goMonth = (m: string) => update({ mes: m === currentMonth ? null : m.slice(0, 7) });

  return (
    <div className={cn("flex flex-wrap items-center gap-2 transition-opacity", pending && "opacity-60")}>
      <div className="flex items-center rounded-lg border bg-card">
        <Button variant="ghost" size="icon-sm" aria-label="Mes anterior" onClick={() => goMonth(addMonths(month, -1))}>
          <ChevronLeft />
        </Button>
        <span className="min-w-36 text-center text-sm font-medium capitalize">{monthLabelLong(month)}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Mes siguiente"
          disabled={month >= currentMonth}
          onClick={() => goMonth(addMonths(month, 1))}
        >
          <ChevronRight />
        </Button>
      </div>

      {showCurrency ? (
        <>
          <div className="flex rounded-lg border bg-card p-0.5" role="group" aria-label="Moneda">
            {(["ARS", "USD"] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => update({ moneda: c === "ARS" ? null : c, real: c === "USD" ? null : params.get("real") })}
                aria-pressed={currency === c}
                className={cn(
                  "rounded-md px-3 py-1 text-sm font-medium text-muted-foreground transition-colors",
                  currency === c && "bg-primary text-primary-foreground shadow-sm",
                )}
              >
                {c === "ARS" ? "Pesos" : "Dólares"}
              </button>
            ))}
          </div>

          <NativeSelect
            aria-label="Tipo de cambio"
            value={fx}
            onChange={(e) => update({ tc: e.target.value === "mep" ? null : e.target.value })}
            className="w-32"
          >
            <option value="mep">Dólar MEP</option>
            <option value="oficial">Dólar oficial</option>
            <option value="blue">Dólar blue</option>
          </NativeSelect>

          <div className="flex h-9 items-center gap-2 rounded-lg border bg-card px-3">
            <Switch
              id="real"
              checked={real}
              disabled={currency === "USD"}
              onCheckedChange={(v) => update({ real: v ? "1" : null })}
            />
            <Label htmlFor="real" className={cn("text-sm", currency === "USD" && "opacity-50")}>
              En pesos de hoy
            </Label>
          </div>
        </>
      ) : null}
    </div>
  );
}
