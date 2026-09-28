"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { addMonths, monthLabelLong } from "@/lib/dates";
import { cn } from "@/lib/utils";

export function MonthNav({ month, currentMonth }: { month: string; currentMonth: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const go = (m: string) => {
    const next = new URLSearchParams(params.toString());
    if (m === currentMonth) next.delete("mes");
    else next.set("mes", m.slice(0, 7));
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  return (
    <div className={cn("flex items-center rounded-lg border bg-card transition-opacity", pending && "opacity-60")}>
      <Button variant="ghost" size="icon-sm" aria-label="Mes anterior" onClick={() => go(addMonths(month, -1))}>
        <ChevronLeft />
      </Button>
      <span className="min-w-36 text-center text-sm font-medium capitalize">{monthLabelLong(month)}</span>
      <Button variant="ghost" size="icon-sm" aria-label="Mes siguiente" disabled={month >= currentMonth} onClick={() => go(addMonths(month, 1))}>
        <ChevronRight />
      </Button>
    </div>
  );
}
