"use client";

import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
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
import { NativeSelect } from "@/components/native-select";
import { SubmitButton } from "@/components/submit-button";
import { cn } from "@/lib/utils";
import { createTransaction, type ActionState } from "./actions";

type Option = { id: string; name: string; currency?: string; kind?: string };

const TYPES = [
  { value: "expense", label: "Gasto" },
  { value: "income", label: "Ingreso" },
  { value: "transfer", label: "Transferencia" },
  { value: "fx", label: "Compra de USD" },
] as const;

export function TransactionDialog({
  accounts,
  categories,
  today,
}: {
  accounts: Option[];
  categories: Option[];
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<(typeof TYPES)[number]["value"]>("expense");
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

  const arsAccounts = accounts.filter((a) => a.currency === "ARS");
  const usdAccounts = accounts.filter((a) => a.currency === "USD");
  const fromAccounts = type === "fx" ? arsAccounts : accounts;
  const toAccounts = type === "fx" ? usdAccounts : accounts;
  const cats = categories.filter((c) => c.kind === type);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus /> Nuevo movimiento
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo movimiento</DialogTitle>
          <DialogDescription>Se registra como asiento de partida doble balanceado.</DialogDescription>
        </DialogHeader>
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="type" value={type} />
          <div className="grid grid-cols-4 gap-1 rounded-lg bg-muted p-1" role="radiogroup" aria-label="Tipo">
            {TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={type === t.value}
                onClick={() => setType(t.value)}
                className={cn(
                  "rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors sm:text-sm",
                  type === t.value && "bg-background text-foreground shadow-sm",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="date">Fecha</Label>
              <Input id="date" name="date" type="date" defaultValue={today} max={today} required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="amount">{type === "fx" ? "Pesos pagados" : "Monto"}</Label>
              <Input id="amount" name="amount" inputMode="decimal" placeholder="12.500,00" required autoComplete="off" />
            </div>
          </div>

          {type === "fx" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="usdAmount">Dólares recibidos</Label>
              <Input id="usdAmount" name="usdAmount" inputMode="decimal" placeholder="100" required autoComplete="off" />
            </div>
          ) : null}

          <div className="grid gap-1.5">
            <Label htmlFor="description">Descripción</Label>
            <Input
              id="description"
              name="description"
              maxLength={200}
              required
              placeholder={type === "fx" ? "Compra USD MEP" : type === "income" ? "Sueldo septiembre" : "Supermercado"}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="accountId">{type === "transfer" || type === "fx" ? "Desde" : "Cuenta"}</Label>
              <NativeSelect id="accountId" name="accountId" required key={`from-${type}`}>
                {fromAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency})
                  </option>
                ))}
              </NativeSelect>
            </div>
            {type === "transfer" || type === "fx" ? (
              <div className="grid gap-1.5">
                <Label htmlFor="toAccountId">Hacia</Label>
                <NativeSelect id="toAccountId" name="toAccountId" required key={`to-${type}`} defaultValue={toAccounts[1]?.id ?? toAccounts[0]?.id}>
                  {toAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.currency})
                    </option>
                  ))}
                </NativeSelect>
              </div>
            ) : (
              <div className="grid gap-1.5">
                <Label htmlFor="categoryId">Categoría</Label>
                <NativeSelect id="categoryId" name="categoryId" required key={`cat-${type}`}>
                  {cats.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )}
          </div>

          <DialogFooter>
            <SubmitButton>Guardar</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
