import "server-only";

/**
 * Traduce errores de configuración a mensajes accionables sin exponer
 * detalles internos (hosts, credenciales). El error completo va al log.
 */
export function describeSetupError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  const code = typeof e === "object" && e && "code" in e ? String((e as { code: unknown }).code) : undefined;

  if (message.includes("SESSION_SECRET")) {
    return "Falta configurar SESSION_SECRET (mínimo 32 caracteres) en las variables de entorno.";
  }
  if (message.includes("DATABASE_URL")) return message;
  if (message.startsWith("Demasiadas demos")) return message;

  console.error("[setup]", e);
  if (code === "42501") {
    return "La base rechazó un permiso (código 42501). Revisá que el rol de DATABASE_URL sea el dueño de la base.";
  }
  return `No se pudo crear el espacio${code ? ` (código ${code})` : ""}. El detalle quedó en los logs del servidor.`;
}

/** Código y mensaje seguros para mostrar: solo errores de Postgres (SQLSTATE) llevan texto. */
export function safeErrorInfo(e: unknown): { code?: string; message: string } {
  const code = typeof e === "object" && e && "code" in e ? String((e as { code: unknown }).code) : undefined;
  const message = e instanceof Error ? e.message : String(e);
  if (message.includes("DATABASE_URL") || message.includes("SESSION_SECRET")) return { code, message };
  if (code && /^[0-9A-Z]{5}$/.test(code)) return { code, message: message.slice(0, 200) };
  return { code, message: e instanceof Error ? e.name : "Error" };
}
