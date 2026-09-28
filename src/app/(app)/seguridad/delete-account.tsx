"use client";

import { useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteMyAccount } from "./actions";

export function DeleteAccountButton({ isDemo }: { isDemo: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="destructive"
      disabled={pending}
      onClick={() => {
        const msg = isDemo
          ? "¿Borrar este espacio de demo ahora? Se eliminan todos sus datos."
          : "¿Eliminar tu cuenta y TODOS tus datos? No se puede deshacer.";
        if (confirm(msg)) start(() => deleteMyAccount());
      }}
    >
      {pending ? <Loader2 className="animate-spin" /> : <Trash2 />} Eliminar mi cuenta y mis datos
    </Button>
  );
}
