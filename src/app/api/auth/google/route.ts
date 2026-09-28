import { NextResponse, type NextRequest } from "next/server";
import {
  OAUTH_COOKIE,
  buildAuthorizationUrl,
  googleConfig,
  randomToken,
  safeNextPath,
  serializeTransaction,
} from "@/lib/google-oauth";
import { OAUTH_COOKIE_PATH, googleRedirectUri } from "./redirect-uri";

/** Paso 1: arma la transacción OAuth (state, nonce, PKCE) y redirige a Google. */
export async function GET(req: NextRequest) {
  const config = googleConfig();
  if (!config) return NextResponse.redirect(new URL("/login?error=google-no-config", req.url));

  const tx = {
    state: randomToken(),
    nonce: randomToken(),
    verifier: randomToken(48),
    next: safeNextPath(req.nextUrl.searchParams.get("next")),
  };
  const url = await buildAuthorizationUrl({
    clientId: config.clientId,
    redirectUri: googleRedirectUri(req),
    state: tx.state,
    nonce: tx.nonce,
    verifier: tx.verifier,
  });

  const res = NextResponse.redirect(url);
  res.cookies.set(OAUTH_COOKIE, serializeTransaction(tx), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // la vuelta desde Google es una navegación GET de primer nivel
    path: OAUTH_COOKIE_PATH,
    maxAge: 600,
  });
  return res;
}
