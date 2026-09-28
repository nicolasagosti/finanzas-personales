"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Send, Unlink } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { createTelegramLink, unlinkTelegram, type LinkResult } from "./actions";

export function TelegramLinker() {
  const router = useRouter();
  const [result, setResult] = useState<LinkResult | null>(null);
  const [pending, start] = useTransition();

  if (result?.ok) {
    return (
      <div className="flex flex-col gap-4">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Tocá <strong className="text-foreground">Abrir Telegram</strong>: se abre el chat con @{result.username}.</li>
          <li>Tocá <strong className="text-foreground">Iniciar</strong> (o <em>Start</em>) en Telegram.</li>
          <li>Volvé acá y tocá <strong className="text-foreground">Ya lo vinculé</strong>.</li>
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button nativeButton={false} render={<a href={result.link} target="_blank" rel="noopener noreferrer" />}>
            <Send /> Abrir Telegram
          </Button>
          <Button variant="outline" onClick={() => router.refresh()}>
            <RefreshCw /> Ya lo vinculé
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          ¿Telegram está en otro dispositivo? Mandale al bot <code className="rounded bg-muted px-1 py-0.5">/start {result.code}</code>.
          El código vence en 15 minutos.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Button className="w-fit" disabled={pending} onClick={() => start(async () => setResult(await createTelegramLink()))}>
        {pending ? <Loader2 className="animate-spin" /> : <Send />} Vincular mi Telegram
      </Button>
      {result && !result.ok ? (
        <Alert variant="destructive">
          <AlertDescription>{result.message}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

export function UnlinkButton() {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      className="w-fit"
      disabled={pending}
      onClick={() => {
        if (confirm("¿Desvincular tu Telegram? El bot va a dejar de cargar movimientos.")) start(() => unlinkTelegram());
      }}
    >
      {pending ? <Loader2 className="animate-spin" /> : <Unlink />} Desvincular
    </Button>
  );
}
