"use client";

import { createContext, useActionState, useCallback, useContext, useState, useTransition } from "react";
import { ArrowDownLeft, ArrowUpRight, Plus, Trash2 } from "lucide-react";
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
import { formatAmountInput } from "@/lib/money";
import { cn } from "@/lib/utils";
import { createTransaction, deleteTransaction, updateTransaction, type ActionState } from "./actions";

type CategoryOption = { id: string; name: string; kind: string; color: string | null };
type Kind = "expense" | "income";
type Draft = { type: Kind; categoryId: string };

/** Lo que hace falta de un movimiento para editarlo (amount: centavos con signo). */
export type EditableTransaction = {
  id: string;
  date: string;
  description: string;
  type: Kind;
  amount: number;
  categoryId: string;
};

export function TransactionDialog({ categories, today }: { categories: CategoryOption[]; today: string }) {
  const [open, setOpen] = useState(false);
  // tipo y categoría se recuerdan entre un alta y la siguiente
  const [draft, setDraft] = useState<Draft>({ type: "expense", categoryId: "" });

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
        <TransactionForm
          categories={categories}
          today={today}
          draft={draft}
          setDraft={setDraft}
          onSaved={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

const EditContext = createContext<((t: EditableTransaction) => void) | null>(null);

/** Un único diálogo de edición para una lista de movimientos. */
export function TransactionEditor({
  categories,
  today,
  children,
}: {
  categories: CategoryOption[];
  today: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<EditableTransaction | null>(null);
  const [draft, setDraft] = useState<Draft>({ type: "expense", categoryId: "" });

  const edit = useCallback((t: EditableTransaction) => {
    setEditing(t);
    setDraft({ type: t.type, categoryId: t.categoryId });
    setOpen(true);
  }, []);

  return (
    <EditContext value={edit}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar movimiento</DialogTitle>
            <DialogDescription>Cambiá lo que necesites y guardá.</DialogDescription>
          </DialogHeader>
          {editing ? (
            <TransactionForm
              key={editing.id}
              categories={categories}
              today={today}
              transaction={editing}
              draft={draft}
              setDraft={setDraft}
              onSaved={() => setOpen(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </EditContext>
  );
}

/** Abre el diálogo de edición del <TransactionEditor> más cercano. */
export function useEditTransaction() {
  const edit = useContext(EditContext);
  if (!edit) throw new Error("useEditTransaction necesita un <TransactionEditor>");
  return edit;
}

export function EditTransactionButton({
  transaction,
  className,
  children,
}: {
  transaction: EditableTransaction;
  className?: string;
  children: React.ReactNode;
}) {
  const edit = useEditTransaction();
  return (
    <button
      type="button"
      onClick={() => edit(transaction)}
      className={cn("cursor-pointer text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50", className)}
    >
      {children}
    </button>
  );
}

function TransactionForm({
  categories,
  today,
  transaction,
  draft,
  setDraft,
  onSaved,
}: {
  categories: CategoryOption[];
  today: string;
  transaction?: EditableTransaction;
  draft: Draft;
  setDraft: (d: Draft) => void;
  onSaved: () => void;
}) {
  const { type } = draft;
  const cats = categories.filter((c) => c.kind === type);
  const selected = cats.find((c) => c.id === draft.categoryId) ?? cats[0];

  const [, action] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const res = await (transaction ? updateTransaction : createTransaction)(prev, formData);
    if (res?.ok) {
      toast.success(res.message);
      onSaved();
    } else if (res) {
      toast.error(res.message);
    }
    return res;
  }, null);

  return (
    <form action={action} className="flex flex-col gap-4">
      {transaction ? <input type="hidden" name="id" value={transaction.id} /> : null}
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
            onClick={() => setDraft({ type: t.value, categoryId: "" })}
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
          <Input
            id="amount"
            name="amount"
            inputMode="decimal"
            placeholder="12.500"
            required
            autoComplete="off"
            autoFocus={!transaction}
            defaultValue={transaction ? formatAmountInput(transaction.amount) : undefined}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="date">Fecha</Label>
          <Input id="date" name="date" type="date" defaultValue={transaction?.date ?? today} max={today} required />
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="description">Descripción</Label>
        <Input
          id="description"
          name="description"
          maxLength={200}
          required
          defaultValue={transaction?.description}
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
                onClick={() => setDraft({ type, categoryId: c.id })}
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
        {transaction ? <DeleteTransactionButton transaction={transaction} onDeleted={onSaved} /> : null}
        <SubmitButton disabled={!selected}>Guardar</SubmitButton>
      </DialogFooter>
    </form>
  );
}

function DeleteTransactionButton({ transaction, onDeleted }: { transaction: EditableTransaction; onDeleted: () => void }) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="destructive"
      disabled={pending}
      className="sm:mr-auto"
      onClick={() => {
        if (!confirm(`¿Eliminar "${transaction.description}"?`)) return;
        start(async () => {
          const res = await deleteTransaction(transaction.id);
          if (res) (res.ok ? toast.success : toast.error)(res.message);
          if (res?.ok) onDeleted();
        });
      }}
    >
      <Trash2 /> Eliminar
    </Button>
  );
}
