"use client";

import { useActionState } from "react";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/submit-button";
import { startDemo, startEmpty, type LoginState } from "./actions";

function ErrorAlert({ state }: { state: LoginState }) {
  if (!state?.error) return null;
  return (
    <Alert variant="destructive">
      <AlertTriangle />
      <AlertDescription>{state.error}</AlertDescription>
    </Alert>
  );
}

export function DemoForm() {
  const [state, action] = useActionState<LoginState, FormData>(() => startDemo(), null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <SubmitButton size="lg" className="h-11 w-full text-base" pendingText="Generando 12 meses de datos…">
        Entrar a la demo <ArrowRight />
      </SubmitButton>
      <ErrorAlert state={state} />
    </form>
  );
}

export function EmptySpaceForm() {
  const [state, action] = useActionState<LoginState, FormData>(startEmpty, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="name">Tu nombre</Label>
        <Input id="name" name="name" placeholder="Ej.: Nico" maxLength={60} autoComplete="given-name" />
      </div>
      <SubmitButton variant="outline" className="h-10" pendingText="Creando tu espacio…">
        Crear mi espacio vacío
      </SubmitButton>
      <ErrorAlert state={state} />
      <p className="text-xs text-muted-foreground">
        Sin cuenta, el espacio queda asociado a este navegador por 30 días.
      </p>
    </form>
  );
}
