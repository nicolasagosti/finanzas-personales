import type { Metadata } from "next";
import { CheckCircle2, MessageCircle } from "lucide-react";
import { withUser } from "@/db/client";
import { requireUser } from "@/lib/auth";
import { telegramConfigured } from "@/lib/telegram";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/page-header";
import { TelegramLinker, UnlinkButton } from "./linker";

export const metadata: Metadata = { title: "Telegram" };

const EXAMPLES: [string, string][] = [
  ["5000 comida", "Egreso de $ 5.000 en Comida afuera"],
  ["5000 comida pizza", "Con detalle: “Pizza”"],
  ["12 lucas nafta ayer", "Egreso de ayer en Transporte"],
  ["ingreso 500000", "Ingreso, sin pedir categoría"],
  ["ingreso 500000 sueldo", "Ingreso en Sueldo"],
  ["3500 veterinaria", "Si la categoría no existe, la crea"],
];

export default async function TelegramPage() {
  const user = await requireUser();
  const configured = telegramConfigured();
  const [link] = configured
    ? await withUser(user.id, (q) =>
        q.query<{ username: string | null; linked_at: Date }>("select username, linked_at from telegram_links"),
      )
    : [];

  return (
    <>
      <PageHeader title="Telegram" description="Cargá tus ingresos y egresos escribiéndole a un bot, en el momento en que pasan." />
      {!configured ? (
        <EmptyState icon={MessageCircle} title="El bot de Telegram no está configurado">
          Falta la variable TELEGRAM_BOT_TOKEN (ver README).
        </EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{link ? "Tu Telegram está vinculado" : "Vinculá tu Telegram"}</CardTitle>
              <CardDescription>
                {link
                  ? "Todo lo que le escribas al bot se carga en tu cuenta."
                  : "Se hace una sola vez. Después, cada mensaje que le mandes al bot se guarda como movimiento."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {link ? (
                <>
                  <p className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="size-4 text-income-text" />
                    {link.username ? <>Vinculado con <strong>@{link.username}</strong></> : "Vinculado"} desde el{" "}
                    {new Date(link.linked_at).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}
                  </p>
                  <UnlinkButton />
                </>
              ) : (
                <TelegramLinker />
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Cómo escribirle</CardTitle>
              <CardDescription>
                Monto y después la categoría. Si no aclarás nada es un egreso; si no decís la fecha, es hoy.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2.5">
                {EXAMPLES.map(([msg, meaning]) => (
                  <li key={msg} className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                    <code className="w-fit rounded-md bg-muted px-2 py-1 font-mono text-sm">{msg}</code>
                    <span className="text-sm text-muted-foreground">{meaning}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-sm text-muted-foreground">
                Comandos: <code>/resumen</code> para ver cómo vas en el mes y <code>/deshacer</code> para borrar lo último
                que cargaste. La categoría se reconoce aunque la abrevies o tenga un error de tipeo, y si recategorizás un
                movimiento en la app, el bot lo aprende para la próxima.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
