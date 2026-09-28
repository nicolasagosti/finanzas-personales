"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed px-6 py-16 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="size-5" />
      </span>
      <div className="space-y-1">
        <p className="font-medium">Algo salió mal cargando esta pantalla</p>
        <p className="text-sm text-muted-foreground">
          {error.digest ? `Código de error: ${error.digest}` : "Probá de nuevo en un momento."}
        </p>
      </div>
      <Button variant="outline" onClick={reset}>
        <RotateCcw /> Reintentar
      </Button>
    </div>
  );
}
