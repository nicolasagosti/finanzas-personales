import type { NextRequest } from "next/server";

export const OAUTH_COOKIE_PATH = "/api/auth/google";

/**
 * URL de retorno registrada en Google. APP_URL la fija (útil con dominio propio);
 * si no, se usa el origen de la request (localhost o *.vercel.app).
 */
export function googleRedirectUri(req: NextRequest): string {
  return new URL("/api/auth/google/callback", process.env.APP_URL ?? req.nextUrl.origin).toString();
}
