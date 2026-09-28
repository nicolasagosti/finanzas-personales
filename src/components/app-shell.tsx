"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ArrowLeftRight, LayoutDashboard, LogOut, Menu, Send, ShieldCheck, Tags, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/theme-toggle";

const NAV = [
  { href: "/", label: "Resumen", icon: LayoutDashboard },
  { href: "/movimientos", label: "Movimientos", icon: ArrowLeftRight },
  { href: "/categorias", label: "Categorías", icon: Tags },
  { href: "/telegram", label: "Telegram", icon: Send, needsTelegram: true },
  { href: "/seguridad", label: "Seguridad y cuenta", icon: ShieldCheck },
];

function NavLinks({ onNavigate, telegram }: { onNavigate?: () => void; telegram: boolean }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV.filter((item) => telegram || !item.needsTelegram).map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              active && "bg-sidebar-accent text-sidebar-accent-foreground",
            )}
          >
            <Icon className={cn("size-4", active ? "text-primary" : "text-muted-foreground")} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 px-3 font-semibold tracking-tight">
      <span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground">
        <Wallet className="size-4" />
      </span>
      Finanzas
    </Link>
  );
}

type ShellUser = { name: string; isDemo: boolean; avatarUrl: string | null; viaGoogle: boolean };

function UserBox({ user, logout }: { user: ShellUser; logout: () => Promise<void> }) {
  const initials = user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border bg-background/60 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2.5">
        {user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- avatar externo chico, sin optimización
          <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" className="size-8 shrink-0 rounded-full" />
        ) : (
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-primary">
            {initials || "?"}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {user.isDemo ? "Demo · se borra en 24 h" : user.viaGoogle ? "Cuenta de Google" : "Sin cuenta · este navegador"}
          </p>
        </div>
      </div>
      <form action={logout}>
        <Button type="submit" variant="ghost" size="icon-sm" aria-label="Cerrar sesión">
          <LogOut />
        </Button>
      </form>
    </div>
  );
}

export function AppShell({
  user,
  logout,
  telegram,
  children,
}: {
  user: ShellUser;
  logout: () => Promise<void>;
  telegram: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col gap-6 border-r bg-sidebar px-3 py-5 lg:flex">
        <Brand />
        <NavLinks telegram={telegram} />
        <div className="mt-auto flex flex-col gap-3">
          <div className="flex items-center justify-between px-3">
            <span className="text-xs text-muted-foreground">Tema</span>
            <ThemeToggle />
          </div>
          <UserBox user={user} logout={logout} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/85 px-4 backdrop-blur lg:hidden">
          <Brand />
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger render={<Button variant="ghost" size="icon" aria-label="Abrir menú" />}>
                <Menu />
              </SheetTrigger>
              <SheetContent side="left" className="w-72 gap-6 bg-sidebar p-4">
                <SheetTitle className="sr-only">Navegación</SheetTitle>
                <Brand />
                <NavLinks telegram={telegram} onNavigate={() => setOpen(false)} />
                <div className="mt-auto">
                  <UserBox user={user} logout={logout} />
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
