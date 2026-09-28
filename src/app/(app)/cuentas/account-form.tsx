"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/native-select";
import { SubmitButton } from "@/components/submit-button";
import type { ActionState } from "@/app/(app)/movimientos/actions";
import { createAccount } from "./actions";

export function AccountForm() {
  const [state, action] = useActionState<ActionState, FormData>(createAccount, null);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(state.message);
      formRef.current?.reset();
    } else toast.error(state.message);
  }, [state]);

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="acc-name">Nombre</Label>
        <Input id="acc-name" name="name" placeholder="Ej.: Caja de ahorro" required maxLength={60} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="acc-kind">Tipo</Label>
          <NativeSelect id="acc-kind" name="kind" defaultValue="asset">
            <option value="asset">Dinero / activo</option>
            <option value="liability">Deuda / tarjeta</option>
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="acc-currency">Moneda</Label>
          <NativeSelect id="acc-currency" name="currency" defaultValue="ARS">
            <option value="ARS">Pesos (ARS)</option>
            <option value="USD">Dólares (USD)</option>
          </NativeSelect>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="acc-opening">Saldo actual (opcional)</Label>
        <Input id="acc-opening" name="opening" inputMode="decimal" placeholder="0,00" autoComplete="off" />
        <p className="text-xs text-muted-foreground">Se registra como asiento contra “Saldo inicial”.</p>
      </div>
      <SubmitButton className="mt-1">Crear cuenta</SubmitButton>
    </form>
  );
}
