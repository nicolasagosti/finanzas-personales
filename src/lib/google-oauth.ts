import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

/**
 * Login con Google vía OpenID Connect (Authorization Code + PKCE).
 *
 *  1. /api/auth/google          genera state, nonce y code_verifier, los guarda
 *                               en una cookie httpOnly de 10 min y redirige a Google
 *  2. /api/auth/google/callback verifica state, canjea el code (con el verifier)
 *                               y valida el id_token contra las claves públicas de
 *                               Google: firma, issuer, audience, expiración y nonce
 */

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export const OAUTH_COOKIE = "fp_oauth";

export type GoogleConfig = { clientId: string; clientSecret: string };

export function googleConfig(): GoogleConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export type OAuthTransaction = { state: string; nonce: string; verifier: string; next: string };

export function serializeTransaction(t: OAuthTransaction): string {
  return Buffer.from(JSON.stringify(t)).toString("base64url");
}

export function parseTransaction(raw: string | undefined): OAuthTransaction | null {
  if (!raw) return null;
  try {
    const t = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if ([t.state, t.nonce, t.verifier, t.next].every((v) => typeof v === "string")) return t;
  } catch {
    // cookie corrupta o manipulada
  }
  return null;
}

/** Solo rutas internas: evita open redirects a otros dominios. */
export function safeNextPath(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

export async function buildAuthorizationUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  verifier: string;
}): Promise<string> {
  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: opts.state,
    nonce: opts.nonce,
    code_challenge: await pkceChallenge(opts.verifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return url.toString();
}

export async function exchangeCode(opts: {
  config: GoogleConfig;
  code: string;
  verifier: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const res = await (opts.fetchImpl ?? fetch)(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: opts.code,
      code_verifier: opts.verifier,
      redirect_uri: opts.redirectUri,
      client_id: opts.config.clientId,
      client_secret: opts.config.clientSecret,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string };
  if (!res.ok || !body.id_token) throw new Error(`Google rechazó el canje del código (${body.error ?? res.status})`);
  return body.id_token;
}

export type GoogleIdentity = { sub: string; email: string; name: string; picture: string | null };

let remoteJwks: JWTVerifyGetKey | null = null;

export async function verifyIdToken(
  idToken: string,
  opts: { clientId: string; nonce: string; jwks?: JWTVerifyGetKey },
): Promise<GoogleIdentity> {
  const keys = opts.jwks ?? (remoteJwks ??= createRemoteJWKSet(new URL(GOOGLE_JWKS_URL)));
  const { payload } = await jwtVerify(idToken, keys, {
    issuer: GOOGLE_ISSUERS,
    audience: opts.clientId,
    algorithms: ["RS256"],
    clockTolerance: 30,
  });
  if (payload.nonce !== opts.nonce) throw new Error("nonce inválido");
  if (typeof payload.sub !== "string" || typeof payload.email !== "string") throw new Error("id_token incompleto");
  if (payload.email_verified !== true) throw new Error("El email de la cuenta de Google no está verificado");
  const picture = typeof payload.picture === "string" && payload.picture.startsWith("https://") ? payload.picture : null;
  const name = typeof payload.name === "string" && payload.name.trim() ? payload.name.trim().slice(0, 60) : payload.email.split("@")[0];
  return { sub: payload.sub, email: payload.email.toLowerCase(), name, picture };
}
