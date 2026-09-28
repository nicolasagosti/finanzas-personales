"use client";

import { useActionState, useEffect, useRef, useTransition } from "react";
import { Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/native-select";
import { SubmitButton } from "@/components/submit-button";
import type { ActionState } from "@/app/(app)/movimientos/actions";
import {
  applyRulesToUncategorized,
  createCategory,
  createRule,
  deleteCategory,
  deleteRule,
} from "./actions";

function useToastState(state: ActionState, onOk?: () => void) {
  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(state.message);
      onOk?.();
    } else toast.error(state.message);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
}

export function CategoryForm({ kind }: { kind: "expense" | "income" }) {
  const [state, action] = useActionState<ActionState, FormData>(createCategory, null);
  const ref = useRef<HTMLFormElement>(null);
  useToastState(state, () => ref.current?.reset());
  return (
    <form ref={ref} action={action} className="flex gap-2">
      <input type="hidden" name="kind" value={kind} />
      <Input name="name" placeholder={kind === "expense" ? "Nueva categoría de gasto" : "Nueva fuente de ingreso"} maxLength={60} required className="h-8" />
      <SubmitButton size="sm" variant="secondary" className="h-8" pendingText="…">
        Agregar
      </SubmitButton>
    </form>
  );
}

export function RuleForm({ categories }: { categories: { id: string; name: string; kind: string }[] }) {
  const [state, action] = useActionState<ActionState, FormData>(createRule, null);
  const ref = useRef<HTMLFormElement>(null);
  useToastState(state, () => ref.current?.reset());
  return (
    <form ref={ref} action={action} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
      <Input name="pattern" placeholder="Si la descripción contiene… (ej.: FARMACITY)" maxLength={80} required className="h-9" />
      <NativeSelect name="accountId" required aria-label="Categoría destino">
        <optgroup label="Gastos">
          {categories.filter((c) => c.kind === "expense").map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </optgroup>
        <optgroup label="Ingresos">
          {categories.filter((c) => c.kind === "income").map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </optgroup>
      </NativeSelect>
      <SubmitButton className="h-9">Crear regla</SubmitButton>
    </form>
  );
}

function useAction(fn: () => Promise<ActionState>) {
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const res = await fn();
      if (res) (res.ok ? toast.success : toast.error)(res.message);
    });
  return [pending, run] as const;
}

export function DeleteCategoryButton({ id, name }: { id: string; name: string }) {
  const [pending, run] = useAction(() => deleteCategory(id));
  return (
    <Button variant="ghost" size="icon-xs" aria-label={`Eliminar ${name}`} disabled={pending} onClick={run} className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-destructive">
      <Trash2 />
    </Button>
  );
}

export function DeleteRuleButton({ id, pattern }: { id: string; pattern: string }) {
  const [pending, run] = useAction(() => deleteRule(id));
  return (
    <Button variant="ghost" size="icon-sm" aria-label={`Eliminar regla ${pattern}`} disabled={pending} onClick={run} className="text-muted-foreground hover:text-destructive">
      <Trash2 />
    </Button>
  );
}

export function ApplyRulesButton({ pendingCount }: { pendingCount: number }) {
  const [pending, run] = useAction(applyRulesToUncategorized);
  return (
    <Button variant="outline" onClick={run} disabled={pending || pendingCount === 0}>
      <Wand2 /> Aplicar reglas a {pendingCount} sin categorizar
    </Button>
  );
}
