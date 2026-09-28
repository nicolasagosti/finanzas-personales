"use client";

import { useActionState, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/submit-button";
import { colorVar } from "@/lib/colors";
import { cn } from "@/lib/utils";
import { createTransaction, type ActionState } from "./actions";

type CategoryOption = { id: string; name: string; kind: string; color: string | null };

export function TransactionDialog({ categories, today }: { categories: CategoryOption[]; today: string }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"expense" | "income">("expense");
  const cats = categories.filter((c) => c.kind === type);
  const [categoryId, setCategoryId] = useState<string>("");
  const selected = cats.find((c) => c.id === categoryId) ?? cats[0];

  const [, action] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const res = await createTransaction(prev, formData);
    if (res?.ok) {
      toast.success(res.message);
      setOpen(false);
    } else if (res) {
      toast.error(res.message);
    }
    return res;
  }, null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus /> Nuevo movimiento
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo movimiento</DialogTitle>
          <DialogDescription>Registrá un ingreso o un egreso.</DialogDescription>
        </DialogHeader>
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="type" value={type} />
          <input type="hidden" name="categoryId" value={selected?.id ?? ""} />

          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo de movimiento">
            {(
              [
                { value: "expense", label: "Egreso", icon: ArrowUpRight, active: "border-expense bg-expense/12 text-expense-text" },
                { value: "income", label: "Ingreso", icon: ArrowDownLeft, active: "border-income bg-income/12 text-income-text" },
              ] as const
            ).map((t) => (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={type === t.value}
                onClick={() => {
                  setType(t.value);
                  setCategoryId("");
                }}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-lg border-2 px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted",
                  type === t.value && t.active,
                )}
              >
                <t.icon className="size-4" /> {t.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="amount">Monto</Label>
              <Input id="amount" name="amount" inputMode="decimal" placeholder="12.500" required autoComplete="off" autoFocus />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="date">Fecha</Label>
              <Input id="date" name="date" type="date" defaultValue={today} max={today} required />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="description">Descripción</Label>
            <Input
              id="description"
              name="description"
              maxLength={200}
              required
              placeholder={type === "income" ? "Sueldo de septiembre" : "Supermercado"}
            />
          </div>

          <fieldset className="grid gap-1.5">
            <legend className="mb-1.5 text-sm font-medium">Categoría</legend>
            <div className="flex flex-wrap gap-2">
              {cats.map((c) => {
                const active = selected?.id === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCategoryId(c.id)}
                    aria-pressed={active}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors hover:bg-muted",
                      active && "border-foreground/40 bg-muted font-medium",
                    )}
                  >
                    <span className="size-2.5 rounded-full" style={{ background: colorVar(c.color) }} />
                    {c.name}
                  </button>
                );
              })}
              {cats.length === 0 ? (
                <p className="text-sm text-muted-foreground">Creá una categoría de {type === "income" ? "ingreso" : "egreso"} primero.</p>
              ) : null}
            </div>
          </fieldset>

          <DialogFooter>
            <SubmitButton disabled={!selected}>Guardar</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
