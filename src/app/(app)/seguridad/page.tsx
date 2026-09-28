import type { Metadata } from "next";
import { BookOpenCheck, DatabaseZap, History, Lock, ShieldCheck } from "lucide-react";
import { withUser } from "@/db/client";
import { requireUser } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/page-header";
import { SecurityProbes } from "./probes";

export const metadata: Metadata = { title: "Seguridad y auditoría" };

const TABLE_LABEL: Record<string, string> = {
  transactions: "Movimiento",
  accounts: "Cuenta / categoría",
  budgets: "Presupuesto",
  rules: "Regla",
  postings: "Asiento",
};
const OP_LABEL: Record<string, string> = { INSERT: "alta", UPDATE: "cambio", DELETE: "baja" };

type AuditRow = {
  id: number;
  table_name: string;
  operation: string;
  at: Date;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
};

function summarize(r: AuditRow): string {
  const d = r.new_data ?? r.old_data ?? {};
  if (r.table_name === "transactions") return String(d.description ?? "");
  if (r.table_name === "accounts" || r.table_name === "rules") return String(d.name ?? d.pattern ?? "");
  if (r.table_name === "budgets") return `$ ${(Number(d.amount ?? 0) / 100).toLocaleString("es-AR")}`;
  if (r.table_name === "postings") return "Recategorización de asiento";
  return "";
}

const FEATURES = [
  {
    icon: DatabaseZap,
    title: "Row Level Security",
    text: "Cada request corre como el rol app_user con app.user_id fijado por transacción. Las políticas de Postgres filtran filas aunque una query se olvide el WHERE.",
  },
  {
    icon: BookOpenCheck,
    title: "Integridad contable",
    text: "Un trigger de constraint diferido valida al COMMIT que cada transacción sume 0 por moneda. Las FKs compuestas impiden usar cuentas de otro usuario o de otra moneda.",
  },
  {
    icon: History,
    title: "Auditoría",
    text: "Triggers SECURITY DEFINER registran altas, cambios y bajas con el estado anterior y el nuevo. La app puede leer su log, no modificarlo.",
  },
  {
    icon: Lock,
    title: "Sesión y headers",
    text: "Cookie httpOnly con JWT HS256, CSP con nonce por request y strict-dynamic, HSTS, frame-ancestors none y Permissions-Policy restrictiva.",
  },
];

export default async function SeguridadPage() {
  const user = await requireUser();
  const audit = await withUser(user.id, (q) =>
    q.query<AuditRow>(
      "select id, table_name, operation, at, old_data, new_data from audit_log order by at desc, id desc limit 40",
    ),
  );

  return (
    <>
      <PageHeader title="Seguridad y auditoría" description="Datos financieros: la seguridad vive en la base, no solo en el código." />

      <div className="grid gap-4 md:grid-cols-2">
        {FEATURES.map(({ icon: Icon, title, text }) => (
          <Card key={title} className="gap-2 py-5">
            <CardContent className="flex gap-3 px-5">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-primary">
                <Icon className="size-4" />
              </span>
              <div>
                <p className="font-medium">{title}</p>
                <p className="text-sm text-muted-foreground">{text}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Probalo en vivo</CardTitle>
          <CardDescription>
            Estas pruebas corren con los mismos permisos que la app e intentan romper las reglas. Deberían fallar todas… del lado de la base.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SecurityProbes />
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Registro de auditoría</CardTitle>
          <CardDescription>Últimos 40 cambios hechos desde la app. Los datos de la demo se cargaron sin auditar.</CardDescription>
        </CardHeader>
        <CardContent>
          {audit.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="Sin cambios registrados todavía">
              Creá, editá o borrá un movimiento, una regla o un presupuesto y aparece acá.
            </EmptyState>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="pl-4">Cuándo</TableHead>
                    <TableHead>Qué</TableHead>
                    <TableHead>Operación</TableHead>
                    <TableHead>Detalle</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {audit.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="pl-4 text-muted-foreground tabular">
                        {new Date(r.at).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "short", timeStyle: "short" })}
                      </TableCell>
                      <TableCell>{TABLE_LABEL[r.table_name] ?? r.table_name}</TableCell>
                      <TableCell>
                        <Badge variant={r.operation === "DELETE" ? "destructive" : "secondary"}>{OP_LABEL[r.operation] ?? r.operation}</Badge>
                      </TableCell>
                      <TableCell className="max-w-80 truncate text-sm">{summarize(r)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
