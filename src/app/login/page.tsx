import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, BookOpenCheck, FileUp, LineChart, ShieldCheck, Wallet } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-toggle";
import { googleConfig } from "@/lib/google-oauth";
import { DemoForm, EmptySpaceForm } from "./forms";

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

const ERRORS: Record<string, string> = {
  "google-no-config": "El login con Google no está configurado (faltan GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET).",
  "google-cancelado": "Cancelaste el inicio de sesión con Google.",
  "google-estado": "El inicio de sesión con Google expiró o no es válido. Probá de nuevo.",
  google: "No se pudo iniciar sesión con Google. Probá de nuevo.",
};

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4">
      <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.9l-3.88-3.02c-1.07.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.72-4.95H1.27v3.11A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.28 14.28A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.38-2.28V6.61H1.27A12 12 0 0 0 0 12c0 1.94.46 3.77 1.27 5.39l4.01-3.11Z" />
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44C17.95 1.19 15.23 0 12 0A12 12 0 0 0 1.27 6.61l4.01 3.11C6.22 6.88 8.87 4.77 12 4.77Z" />
    </svg>
  );
}

function OrSeparator({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <Separator className="flex-1" /> {children} <Separator className="flex-1" />
    </div>
  );
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error, cuenta } = await searchParams;
  const deleted = cuenta === "eliminada";
  const errorMessage = typeof error === "string" ? ERRORS[error] : undefined;
  const googleEnabled = googleConfig() !== null;
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
            {deleted ? (
              <Alert>
                <AlertDescription>Tu cuenta y todos tus datos fueron eliminados.</AlertDescription>
              </Alert>
            ) : null}
            {errorMessage ? (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            ) : null}
            <DemoForm />
            {googleEnabled ? (
              <>
                <OrSeparator>o entrá con tu cuenta</OrSeparator>
                <Button
                  variant="outline"
                  size="lg"
                  className="h-11 w-full text-base"
                  nativeButton={false}
                  render={<a href="/api/auth/google" />}
                >
                  <GoogleIcon /> Continuar con Google
                </Button>
              </>
            ) : null}
            <OrSeparator>{googleEnabled ? "o probá sin cuenta" : "o empezá de cero"}</OrSeparator>
            <EmptySpaceForm />
          </CardContent>
        </Card>
        <p className="text-center text-xs text-muted-foreground lg:col-start-2">
          <Link href="/privacidad" className="hover:text-foreground hover:underline">
            Política de privacidad
          </Link>
          {" · "}
          <a href="https://github.com/nicolasagosti/finanzas-personales" className="hover:text-foreground hover:underline" rel="noopener noreferrer">
            Código en GitHub
          </a>
        </p>
      </div>
    </div>
  );
}
