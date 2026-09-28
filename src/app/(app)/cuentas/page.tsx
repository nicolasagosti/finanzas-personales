import type { Metadata } from "next";
import Link from "next/link";
import { CreditCard, Landmark, PartyPopper } from "lucide-react";
import { withUser } from "@/db/client";
import { requireUser } from "@/lib/auth";
import { dayLabel, monthStart, todayISO } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { accountBalances, fxRate, loadReference } from "@/lib/reports";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { AccountForm } from "./account-form";

export const metadata: Metadata = { title: "Cuentas" };

export default async function CuentasPage({ searchParams }: PageProps<"/cuentas">) {
  const user = await requireUser();
  const welcome = (await searchParams).bienvenida === "1";
  const { balances, ref } = await withUser(user.id, async (q) => ({
    balances: await accountBalances(q),
    ref: await loadReference(q),
  }));
  const month = monthStart(todayISO());
  const mep = fxRate(ref, month, "mep");

  const toArs = (b: { balance: number; currency: string }) => (b.currency === "USD" ? Math.round(b.balance * mep) : b.balance);
  const assets = balances.filter((b) => b.kind === "asset");
  const liabilities = balances.filter((b) => b.kind === "liability");
  const totalAssets = assets.reduce((a, b) => a + toArs(b), 0);
  const totalDebt = liabilities.reduce((a, b) => a + toArs(b), 0);

  return (
    <>
      <PageHeader title="Cuentas" description="Saldos calculados sumando los asientos de cada cuenta" />

      {welcome ? (
        <Alert className="mb-6 border-primary/30 bg-accent/50">
          <PartyPopper />
          <AlertTitle>¡Tu espacio está listo!</AlertTitle>
          <AlertDescription>
            Creamos cuentas, categorías y reglas de ejemplo. Cargá el saldo de tus cuentas o{" "}
            <Link href="/importar" className="text-primary underline">importá un resumen</Link>.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Summary label="Activos" value={formatMoney(totalAssets, "ARS", { decimals: false })} />
            <Summary label="Deudas" value={formatMoney(totalDebt, "ARS", { decimals: false })} />
            <Summary label="Patrimonio neto" value={formatMoney(totalAssets + totalDebt, "ARS", { decimals: false })} strong />
          </div>
          <p className="-mt-1 text-xs text-muted-foreground">
            Dólares valuados al MEP promedio del mes ({formatMoney(Math.round(mep * 100), "ARS")}).
          </p>

          <AccountGroup title="Dinero y ahorros" icon={Landmark} items={assets} />
          <AccountGroup title="Tarjetas y deudas" icon={CreditCard} items={liabilities} />
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Nueva cuenta</CardTitle>
            <CardDescription>Banco, billetera virtual, efectivo, tarjeta o ahorro en dólares.</CardDescription>
          </CardHeader>
          <CardContent>
            <AccountForm />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Summary({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <Card className={cn("gap-1 py-4", strong && "border-primary/30 bg-accent/40")}>
      <CardContent className="px-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold tracking-tight tabular">{value}</p>
      </CardContent>
    </Card>
  );
}

function AccountGroup({
  title,
  icon: Icon,
  items,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  items: Awaited<ReturnType<typeof accountBalances>>;
}) {
  if (!items.length) return null;
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Icon className="size-4" /> {title}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((a) => (
          <Link key={a.id} href={`/movimientos?cuenta=${a.id}`} className="group">
            <Card className="gap-1 py-4 transition-colors group-hover:border-primary/40">
              <CardContent className="flex items-start justify-between gap-3 px-4">
                <div className="min-w-0">
                  <p className="truncate font-medium">{a.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.movements.toLocaleString("es-AR")} movimientos
                    {a.lastMovement ? ` · último ${dayLabel(a.lastMovement)}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className={cn("font-semibold tabular", a.balance < 0 && "text-destructive")}>
                    {formatMoney(a.balance, a.currency)}
                  </p>
                  <p className="text-xs text-muted-foreground">{a.currency}</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}
