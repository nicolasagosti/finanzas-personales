import type { Metadata } from "next";
import { ArrowRight, BookOpenCheck, FileUp, LineChart, ShieldCheck, Wallet } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { SubmitButton } from "@/components/submit-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { startDemo, startEmpty } from "./actions";

export const metadata: Metadata = { title: "Ingresar" };

const FEATURES = [
  {
    icon: BookOpenCheck,
    title: "Partida doble de verdad",
    text: "Cada movimiento es un asiento balanceado, en centavos enteros. La base rechaza lo que no cuadra.",
  },
  {
    icon: LineChart,
    title: "Pesos, dólares e inflación",
    text: "Mirá tus números en pesos de hoy (IPC del INDEC) o en dólares oficial, MEP o blue.",
  },
  {
    icon: FileUp,
    title: "Importá tu resumen",
    text: "Subí el CSV del banco. Reimportarlo no duplica nada y las reglas categorizan solas.",
  },
  {
    icon: ShieldCheck,
    title: "Seguridad en la base",
    text: "Row Level Security de Postgres aísla cada usuario. Auditoría de cambios incluida.",
  },
];

export default function LoginPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-10">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="grid w-full max-w-5xl items-center gap-10 lg:grid-cols-[1.1fr_1fr]">
        <section className="flex flex-col gap-8">
          <div className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">
              <Wallet className="size-5" />
            </span>
            Finanzas Personales
          </div>
          <div className="space-y-3">
            <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Tus finanzas, pensadas para la economía argentina.
            </h1>
            <p className="max-w-xl text-muted-foreground text-pretty">
              Un gestor de gastos serio: libro contable de doble entrada, multi-moneda y con ajuste
              por inflación para comparar meses de verdad.
            </p>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3">
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-primary">
                  <Icon className="size-4" />
                </span>
                <div>
                  <p className="text-sm font-medium">{title}</p>
                  <p className="text-sm text-muted-foreground">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl">Empezá</CardTitle>
            <CardDescription>
              La demo crea un espacio privado con 12 meses de datos sintéticos. Nadie más lo ve y se
              borra a las 24 horas.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <form action={startDemo}>
              <SubmitButton size="lg" className="h-11 w-full text-base" pendingText="Generando 12 meses de datos…">
                Entrar a la demo <ArrowRight />
              </SubmitButton>
            </form>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <Separator className="flex-1" /> o empezá de cero <Separator className="flex-1" />
            </div>
            <form action={startEmpty} className="flex flex-col gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="name">Tu nombre</Label>
                <Input id="name" name="name" placeholder="Ej.: Nico" maxLength={60} autoComplete="given-name" />
              </div>
              <SubmitButton variant="outline" className="h-10" pendingText="Creando tu espacio…">
                Crear mi espacio vacío
              </SubmitButton>
              <p className="text-xs text-muted-foreground">
                El espacio queda asociado a este navegador por 30 días. Ver README para conectar
                OAuth o passkeys en producción.
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
