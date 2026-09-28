import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { asOwner } from "@/db/client";
import { createUserWithDefaults } from "@/db/seed";
import { issueSession } from "@/lib/auth";
import {
  OAUTH_COOKIE,
  exchangeCode,
  googleConfig,
  parseTransaction,
  verifyIdToken,
} from "@/lib/google-oauth";
import { OAUTH_COOKIE_PATH, googleRedirectUri } from "../redirect-uri";

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Paso 2: Google vuelve con ?code&state. Se valida todo antes de crear la sesión. */
export async function GET(req: NextRequest) {
  const redirectTo = (path: string) => {
    const res = NextResponse.redirect(new URL(path, req.url));
    res.cookies.set(OAUTH_COOKIE, "", { path: OAUTH_COOKIE_PATH, maxAge: 0 });
    return res;
  };

  const config = googleConfig();
  if (!config) return redirectTo("/login?error=google-no-config");

  const params = req.nextUrl.searchParams;
  if (params.get("error")) return redirectTo("/login?error=google-cancelado");

  const tx = parseTransaction(req.cookies.get(OAUTH_COOKIE)?.value);
  const code = params.get("code");
  const state = params.get("state");
  if (!tx || !code || !state || !sameToken(state, tx.state)) return redirectTo("/login?error=google-estado");

  try {
    const idToken = await exchangeCode({ config, code, verifier: tx.verifier, redirectUri: googleRedirectUri(req) });
    const identity = await verifyIdToken(idToken, { clientId: config.clientId, nonce: tx.nonce });

    const { userId, isNew } = await asOwner(async (q) => {
      const [existing] = await q.query<{ id: string }>(
        "update users set name = $2, avatar_url = $3 where google_sub = $1 returning id",
        [identity.sub, identity.name, identity.picture],
      );
      if (existing) return { userId: existing.id, isNew: false };
      const created = await createUserWithDefaults(q, {
        email: identity.email,
        name: identity.name,
        isDemo: false,
        googleSub: identity.sub,
        avatarUrl: identity.picture,
      });
      return { userId: created.userId, isNew: true };
    });

    const session = await issueSession(userId, false);
    const res = redirectTo(isNew ? "/" : tx.next);
    res.cookies.set(session.name, session.value, session.options);
    return res;
  } catch (e) {
    console.error("[google-oauth]", e);
    return redirectTo("/login?error=google");
  }
}
