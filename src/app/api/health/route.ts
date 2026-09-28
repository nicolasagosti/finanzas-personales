import { getDb, withUser } from "@/db/client";
import { safeErrorInfo } from "@/lib/setup-errors";

/**
 * Diagnóstico de despliegue: dice qué está configurado y qué falla, sin
 * exponer secretos (solo booleanos y códigos de error de Postgres).
 */
export async function GET() {
  const checks: Record<string, unknown> = {
    databaseUrl: Boolean(process.env.DATABASE_URL),
    sessionSecret: (process.env.SESSION_SECRET?.length ?? 0) >= 32,
    database: "pendiente",
    rls: "pendiente",
  };
  let ok = checks.databaseUrl !== false || !process.env.VERCEL;

  try {
    await getDb(); // conecta y corre migraciones
    checks.database = "ok";
    try {
      // Mismo camino que cualquier request: SET ROLE app_user + app.user_id
      await withUser("00000000-0000-0000-0000-000000000000", (q) => q.query("select count(*) from accounts"));
      checks.rls = "ok";
    } catch (e) {
      checks.rls = safeErrorInfo(e);
      ok = false;
    }
  } catch (e) {
    checks.database = safeErrorInfo(e);
    ok = false;
  }
  if (!checks.sessionSecret && process.env.NODE_ENV === "production") ok = false;

  return Response.json({ ok, ...checks }, { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
