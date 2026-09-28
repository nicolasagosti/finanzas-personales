"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { deleteTransaction, recategorize } from "./actions";

type Option = { id: string; name: string; kind: string };

export function CategoryCell({
  transactionId,
  categoryId,
  categoryName,
  kind,
  categories,
}: {
  transactionId: string;
  categoryId: string;
  categoryName: string;
  kind: "income" | "expense";
  categories: Option[];
}) {
  const [pending, start] = useTransition();
  const uncategorized = categoryName === "Sin categorizar";
  return (
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
      className={cn(
        "max-w-44 cursor-pointer truncate rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-sm outline-none transition-colors hover:border-input focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 [&>option]:bg-popover [&>option]:text-popover-foreground",
        uncategorized && "border-dashed border-amber-500/60 text-amber-700 dark:text-amber-400",
      )}
    >
      {categories
        .filter((c) => c.kind === kind)
        .map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
    </select>
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
        if (!confirm(`¿Eliminar "${description}"? Se borran todos sus asientos.`)) return;
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
