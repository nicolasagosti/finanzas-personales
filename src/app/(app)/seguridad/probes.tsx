"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, FlaskConical, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runSecurityProbes, type ProbeResult } from "./actions";

export function SecurityProbes() {
  const [results, setResults] = useState<ProbeResult[] | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      <Button variant="outline" className="w-fit" disabled={pending} onClick={() => start(async () => setResults(await runSecurityProbes()))}>
        {pending ? <Loader2 className="animate-spin" /> : <FlaskConical />} Ejecutar pruebas contra la base
      </Button>
      {results ? (
        <ul className="flex flex-col gap-2">
          {results.map((r) => (
            <li key={r.name} className="flex items-start gap-2.5 rounded-lg border px-3 py-2.5">
              {r.passed ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-positive" aria-label="Superada" />
              ) : (
                <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-label="Fallida" />
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium">{r.name}</p>
                <p className="break-words font-mono text-xs text-muted-foreground">{r.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
