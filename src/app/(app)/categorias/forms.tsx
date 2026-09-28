"use client";

import { useActionState, useEffect, useRef, useTransition } from "react";
import { Check, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/submit-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CATEGORY_COLORS, COLOR_LABELS, colorVar, type CategoryColor } from "@/lib/colors";
import type { ActionState } from "@/app/(app)/movimientos/actions";
import { createCategory, deleteCategory, setCategoryColor } from "./actions";

export function CategoryForm({ kind }: { kind: "expense" | "income" }) {
  const [state, action] = useActionState<ActionState, FormData>(createCategory, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(state.message);
      ref.current?.reset();
    } else toast.error(state.message);
  }, [state]);
  return (
    <form ref={ref} action={action} className="flex gap-2">
      <input type="hidden" name="kind" value={kind} />
      <Input
        name="name"
        placeholder={kind === "expense" ? "Nueva categoría de egreso" : "Nueva categoría de ingreso"}
        maxLength={60}
        required
        className="h-9"
      />
      <SubmitButton variant="secondary" className="h-9" pendingText="…">
        Agregar
      </SubmitButton>
    </form>
  );
}

const ALL_COLORS: CategoryColor[] = [...CATEGORY_COLORS, "gray"];

export function ColorPicker({ id, name, color }: { id: string; name: string; color: string | null }) {
  const [pending, start] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`Cambiar color de ${name}`}
            disabled={pending}
            className="size-5 shrink-0 rounded-full ring-2 ring-transparent ring-offset-2 ring-offset-card transition hover:ring-border focus-visible:ring-ring disabled:opacity-50"
            style={{ background: colorVar(color) }}
          />
        }
      />
      <DropdownMenuContent align="start" className="w-auto">
        <div className="grid grid-cols-3 gap-1 p-1">
          {ALL_COLORS.map((c) => (
            <DropdownMenuItem
              key={c}
              onClick={() =>
                start(async () => {
                  const res = await setCategoryColor(id, c);
                  if (res && !res.ok) toast.error(res.message);
                })
              }
              className="flex items-center gap-2 pr-3"
            >
              <span className="grid size-5 place-items-center rounded-full text-white" style={{ background: colorVar(c) }}>
                {c === color ? <Check className="size-3" /> : null}
              </span>
              {COLOR_LABELS[c]}
            </DropdownMenuItem>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function DeleteCategoryButton({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={`Eliminar ${name}`}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await deleteCategory(id);
          if (res) (res.ok ? toast.success : toast.error)(res.message);
        })
      }
      className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-destructive"
    >
      <Trash2 />
    </Button>
  );
}
