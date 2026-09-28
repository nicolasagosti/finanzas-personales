import type { Metadata } from "next";
import { withUser } from "@/db/client";
import { requireUser } from "@/lib/auth";
import { listMoneyAccounts } from "@/lib/reports";
import { PageHeader } from "@/components/page-header";
import { Importer } from "./importer";

export const metadata: Metadata = { title: "Importar resumen" };

export default async function ImportarPage() {
  const user = await requireUser();
  const accounts = await withUser(user.id, listMoneyAccounts);
  return (
    <>
      <PageHeader
        title="Importar resumen"
        description="Idempotente: cada fila lleva una huella SHA-256, así que reimportar el mismo archivo no duplica movimientos."
      />
      <Importer accounts={accounts.filter((a) => a.currency === "ARS")} />
    </>
  );
}
