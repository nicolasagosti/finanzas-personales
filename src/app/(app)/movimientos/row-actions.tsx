"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { TableRow } from "@/components/ui/table";
import { colorVar } from "@/lib/colors";
import { deleteTransaction, recategorize } from "./actions";
import { useEditTransaction, type EditableTransaction } from "./transaction-dialog";

type Option = { id: string; name: string; kind: string; color: string | null };

/** Tocar la fila abre la edición, salvo que se toque uno de sus controles. */
export function EditableRow({ transaction, children }: { transaction: EditableTransaction; children: React.ReactNode }) {
  const edit = useEditTransaction();
  return (
    <TableRow
      className="cursor-pointer"
      onClick={(e) => {
        if (!(e.target as Element).closest("button, select, a")) edit(transaction);
      }}
    >
      {children}
    </TableRow>
  );
}

export function CategoryCell({
  transactionId,
  categoryId,
  color,
  kind,
  categories,
}: {
  transactionId: string;
  categoryId: string;
  color: string | null;
  kind: "income" | "expense";
  categories: Option[];
}) {
  const [pending, start] = useTransition();
  return (
    <span className="relative inline-flex max-w-48 items-center">
      <span className="pointer-events-none absolute left-2 size-2.5 rounded-full" style={{ background: colorVar(color) }} />
      <select
        aria-label="Categoría"
        value={categoryId}
        disabled={pending}
        onChange={(e) => {
          const value = e.target.value;
          start(async () => {
            const res = await recategorize(transactionId, value);
            if (res && !res.ok) toast.error(res.message);
          });
        }}
        className="max-w-48 cursor-pointer truncate rounded-full border border-transparent bg-muted/60 py-0.5 pl-6 pr-2 text-sm outline-none transition-colors hover:border-input focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 [&>option]:bg-popover [&>option]:text-popover-foreground"
      >
        {categories
          .filter((c) => c.kind === kind)
          .map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
      </select>
    </span>
  );
}

export function DeleteButton({ id, description }: { id: string; description: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`Eliminar ${description}`}
      disabled={pending}
      className="text-muted-foreground hover:text-destructive"
      onClick={() => {
        if (!confirm(`¿Eliminar "${description}"?`)) return;
        start(async () => {
          const res = await deleteTransaction(id);
          if (res) (res.ok ? toast.success : toast.error)(res.message);
        });
      }}
    >
      <Trash2 />
    </Button>
  );
}
