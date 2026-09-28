import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Wallet } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

export const metadata: Metadata = {
  title: "Política de privacidad",
  description: "Qué datos usa Finanzas Personales, para qué y cómo eliminarlos.",
};

const UPDATED = "28 de septiembre de 2026";
const REPO = "https://github.com/nicolasagosti/finanzas-personales";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="space-y-2 text-muted-foreground [&_strong]:font-medium [&_strong]:text-foreground">{children}</div>
    </section>
  );
}

export default function PrivacidadPage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex items-center justify-between">
        <Link href="/login" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Wallet className="size-4" />
          </span>
          Finanzas Personales
        </Link>
        <ThemeToggle />
      </header>

      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Política de privacidad</h1>
        <p className="text-sm text-muted-foreground">Última actualización: {UPDATED}</p>
      </div>

      <p>
        Finanzas Personales es un proyecto personal de código abierto (
        <a href={REPO} className="text-primary underline" rel="noopener noreferrer">
          ver el código
        </a>
        ). Esta política explica qué datos usa la aplicación, para qué y cómo podés eliminarlos.
      </p>

      <Section title="Qué datos usamos">
        <p>
          <strong>Si entrás con Google:</strong> tu nombre, tu dirección de email, tu foto de perfil y el identificador
          de tu cuenta de Google. Solo pedimos los permisos básicos <code>openid</code>, <code>email</code> y{" "}
          <code>profile</code>; no accedemos a Gmail, Drive ni a ningún otro dato de tu cuenta.
        </p>
        <p>
          <strong>Los datos que cargás:</strong> tus ingresos, egresos y categorías.
        </p>
        <p>
          <strong>La demo</strong> usa datos inventados y no pide ningún dato personal.
        </p>
      </Section>

      <Section title="Para qué los usamos">
        <p>
          Únicamente para identificarte al iniciar sesión y mostrarte tus propias finanzas. No usamos tus datos para
          publicidad, no los vendemos, no los compartimos con terceros y no los usamos para entrenar modelos de
          inteligencia artificial.
        </p>
        <p>
          El uso de la información recibida de las APIs de Google cumple la{" "}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            className="text-primary underline"
            rel="noopener noreferrer"
          >
            Política de datos del usuario de los servicios de las APIs de Google
          </a>
          , incluidos los requisitos de Uso limitado.
        </p>
      </Section>

      <Section title="Dónde se guardan y cómo se protegen">
        <p>
          La aplicación corre en Vercel y los datos se guardan en una base de datos Postgres administrada por Neon. Todo
          el tráfico viaja cifrado (HTTPS). Cada usuario está aislado a nivel de base de datos (Row Level Security), por
          lo que nadie más puede ver tus movimientos.
        </p>
      </Section>

      <Section title="Cookies">
        <p>
          Usamos solo cookies técnicas: una de sesión, para mantenerte conectado (30 días; 24 horas en la demo), y una
          temporal de 10 minutos durante el inicio de sesión con Google. No usamos cookies de seguimiento ni herramientas
          de analítica.
        </p>
      </Section>

      <Section title="Cuánto tiempo los conservamos">
        <p>
          Los espacios de demo se borran automáticamente a las 24 horas. Los datos de una cuenta se conservan hasta que
          la elimines.
        </p>
      </Section>

      <Section title="Tus derechos y cómo eliminar tus datos">
        <p>
          Podés <strong>borrar tu cuenta y todos tus datos</strong> en cualquier momento desde{" "}
          <strong>Seguridad y cuenta → Eliminar mi cuenta</strong>. El borrado es inmediato y definitivo. También
          podés revocar el acceso de la aplicación desde{" "}
          <a href="https://myaccount.google.com/permissions" className="text-primary underline" rel="noopener noreferrer">
            la configuración de tu cuenta de Google
          </a>
          .
        </p>
        <p>
          De acuerdo con la Ley 25.326 de Protección de Datos Personales de la República Argentina, tenés derecho a
          acceder, rectificar y suprimir tus datos. Para cualquier consulta podés comunicarte a través del{" "}
          <a href={REPO} className="text-primary underline" rel="noopener noreferrer">
            repositorio del proyecto
          </a>
          .
        </p>
      </Section>

      <footer className="border-t pt-6">
        <Link href="/login" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
          <ArrowLeft className="size-4" /> Volver
        </Link>
      </footer>
    </div>
  );
}
