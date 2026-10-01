import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftRight, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { withUser } from "@/db/client";
import { requireUser } from "@/lib/auth";
import { dayLabel, isValidISODate, todayISO } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { listCategories, listTransactions } from "@/lib/reports";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/native-select";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CategoryCell, DeleteButton, EditableRow } from "./row-actions";
import { EditTransactionButton, TransactionDialog, TransactionEditor } from "./transaction-dialog";

export const metadata: Metadata = { title: "Movimientos" };

const PAGE_SIZE = 50;
const UUID_RE = /^[0-9a-f-]{36}$/i;

export default async function MovimientosPage({ searchParams }: PageProps<"/movimientos">) {
  const user = await requireUser();
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");

  const mes = str("mes");
  const month = mes && isValidISODate(`${mes}-01`) ? `${mes}-01` : undefined;
  const categoryId = UUID_RE.test(str("categoria")) ? str("categoria") : undefined;
  const tipo = str("tipo");
  const type = tipo === "ingresos" ? "income" : tipo === "egresos" ? "expense" : undefined;
  const search = str("q").slice(0, 80) || undefined;
  const page = Math.max(1, Number.parseInt(str("pagina") || "1", 10) || 1);

  const { list, categories } = await withUser(user.id, async (q) => ({
    list: await listTransactions(q, { month, categoryId, type, search, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    categories: await listCategories(q),
  }));

  const today = todayISO();
  const pages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));
  const filtered = Boolean(month || categoryId || type || search);
  const hrefPage = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && k !== "pagina") params.set(k, v);
    if (p > 1) params.set("pagina", String(p));
    return `/movimientos?${params.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Movimientos"
        description={`${list.total.toLocaleString("es-AR")} ${list.total === 1 ? "movimiento" : "movimientos"}${filtered ? " con estos filtros" : ""}`}
      >
        <TransactionDialog categories={categories} today={today} />
      </PageHeader>

      <form method="get" className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" defaultValue={search} placeholder="Buscar por descripción…" className="h-9 pl-8" />
        </div>
        <Input type="month" name="mes" defaultValue={mes} aria-label="Mes" className="h-9 lg:w-44" />
        <NativeSelect name="tipo" defaultValue={tipo} aria-label="Tipo" className="lg:w-36">
          <option value="">Todos</option>
          <option value="ingresos">Ingresos</option>
          <option value="egresos">Egresos</option>
        </NativeSelect>
        <NativeSelect name="categoria" defaultValue={categoryId ?? ""} aria-label="Categoría" className="lg:w-52">
          <option value="">Todas las categorías</option>
          <optgroup label="Egresos">
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
        <div className="flex gap-2">
          <Button type="submit" variant="secondary" className="h-9 flex-1">
            Filtrar
          </Button>
          {filtered ? (
            <Button variant="ghost" className="h-9" render={<Link href="/movimientos" />} nativeButton={false}>
              <X /> Limpiar
            </Button>
          ) : null}
        </div>
      </form>

      {list.rows.length === 0 ? (
        <EmptyState icon={ArrowLeftRight} title={filtered ? "Nada coincide con los filtros" : "Todavía no hay movimientos"}>
          {filtered ? "Probá con otro mes o limpiá los filtros." : "Cargá tu primer ingreso o egreso con “Nuevo movimiento”."}
        </EmptyState>
      ) : (
        <TransactionEditor categories={categories} today={today}>
          <Card className="gap-0 overflow-hidden py-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="w-20 pl-4">Fecha</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead className="hidden md:table-cell">Categoría</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead className="w-10 pr-4">
                    <span className="sr-only">Acciones</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.rows.map((t) => (
                  <EditableRow key={t.id} transaction={t}>
                    <TableCell className="pl-4 text-muted-foreground tabular">{dayLabel(t.date)}</TableCell>
                    <TableCell className="max-w-[20rem]">
                      <EditTransactionButton transaction={t} className="block w-full min-w-0 rounded-sm">
                        <span className="block truncate font-medium">{t.description}</span>
                        <span className="block truncate text-xs text-muted-foreground md:hidden">{t.category}</span>
                      </EditTransactionButton>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <CategoryCell transactionId={t.id} categoryId={t.categoryId} color={t.color} kind={t.type} categories={categories} />
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-medium tabular",
                        t.type === "income" ? "text-income-text" : "text-expense-text",
                      )}
                    >
                      {t.type === "income" ? "+" : ""}
                      {formatMoney(t.amount, "ARS")}
                    </TableCell>
                    <TableCell className="pr-4">
                      <DeleteButton id={t.id} description={t.description} />
                    </TableCell>
                  </EditableRow>
                ))}
              </TableBody>
            </Table>
            {pages > 1 ? (
              <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground">
                <span>
                  Página {page} de {pages}
                </span>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" disabled={page <= 1} render={page > 1 ? <Link href={hrefPage(page - 1)} /> : undefined} nativeButton={page <= 1}>
                    <ChevronLeft /> Anterior
                  </Button>
                  <Button variant="outline" size="sm" disabled={page >= pages} render={page < pages ? <Link href={hrefPage(page + 1)} /> : undefined} nativeButton={page >= pages}>
                    Siguiente <ChevronRight />
                  </Button>
                </div>
              </div>
            ) : null}
          </Card>
        </TransactionEditor>
      )}
    </>
  );
}
