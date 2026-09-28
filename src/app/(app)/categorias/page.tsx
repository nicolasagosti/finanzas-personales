import type { Metadata } from "next";
import { withUser } from "@/db/client";
import { requireUser } from "@/lib/auth";
import { addMonths, monthStart, todayISO } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { ApplyRulesButton, CategoryForm, DeleteCategoryButton, DeleteRuleButton, RuleForm } from "./forms";

export const metadata: Metadata = { title: "Categorías y reglas" };

type CategoryStat = { id: string; name: string; kind: "income" | "expense"; isSystem: boolean; total: number; count: number };

export default async function CategoriasPage() {
  const user = await requireUser();
  const since = addMonths(monthStart(todayISO()), -11);
  const { categories, rules, uncategorized } = await withUser(user.id, async (q) => ({
    categories: await q.query<CategoryStat>(
      `select a.id, a.name, a.kind::text as kind, a.is_system as "isSystem",
              coalesce(abs(sum(p.amount) filter (where t.occurred_on >= $1::date)), 0)::bigint as total,
              count(p.id)::bigint as count
       from accounts a
       left join postings p on p.account_id = a.id
       left join transactions t on t.id = p.transaction_id
       where a.kind in ('income', 'expense') and not a.archived
       group by a.id order by total desc, a.name`,
      [since],
    ),
    rules: await q.query<{ id: string; pattern: string; category: string; priority: number }>(
      `select r.id, r.pattern, a.name as category, r.priority
       from rules r join accounts a on a.id = r.account_id
       order by r.priority, r.pattern`,
    ),
    uncategorized: (
      await q.query<{ n: number }>(
        `select count(*)::bigint as n from postings p join accounts a on a.id = p.account_id
         where a.is_system and a.name = 'Sin categorizar'`,
      )
    )[0].n,
  }));

  return (
    <>
      <PageHeader
        title="Categorías y reglas"
        description="Las categorías son cuentas de ingreso y gasto del libro mayor. Las reglas las asignan solas al importar."
      >
        <ApplyRulesButton pendingCount={uncategorized} />
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-2">
        {(["expense", "income"] as const).map((kind) => {
          const list = categories.filter((c) => c.kind === kind);
          return (
            <Card key={kind}>
              <CardHeader>
                <CardTitle>{kind === "expense" ? "Gastos" : "Ingresos"}</CardTitle>
                <CardDescription>Total de los últimos 12 meses</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <ul className="divide-y">
                  {list.map((c) => (
                    <li key={c.id} className="group flex items-center justify-between gap-3 py-2">
                      <span className="flex min-w-0 items-center gap-2 text-sm">
                        <span className="truncate font-medium">{c.name}</span>
                        {c.isSystem ? <Badge variant="outline" className="text-[10px]">sistema</Badge> : null}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground tabular">{c.count.toLocaleString("es-AR")} mov.</span>
                        <span className="w-28 text-right text-sm font-medium tabular">{formatMoney(c.total, "ARS", { decimals: false })}</span>
                        {!c.isSystem && c.count === 0 ? <DeleteCategoryButton id={c.id} name={c.name} /> : <span className="w-6" />}
                      </span>
                    </li>
                  ))}
                </ul>
                <CategoryForm kind={kind} />
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Reglas de categorización</CardTitle>
          <CardDescription>
            Se evalúan en orden: gana la primera cuyo texto aparece en la descripción (sin distinguir mayúsculas ni acentos).
          </CardDescription>
          <CardAction>
            <Badge variant="secondary">{rules.length} reglas</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <RuleForm categories={categories.filter((c) => !c.isSystem)} />
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="w-12 pl-4">#</TableHead>
                  <TableHead>Si la descripción contiene</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((r, i) => (
                  <TableRow key={r.id}>
                    <TableCell className="pl-4 text-muted-foreground tabular">{i + 1}</TableCell>
                    <TableCell>
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{r.pattern}</code>
                    </TableCell>
                    <TableCell className="text-sm">{r.category}</TableCell>
                    <TableCell className="pr-3">
                      <DeleteRuleButton id={r.id} pattern={r.pattern} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
