import { jwtVerify, SignJWT } from "jose";

/** Firma y verificación de la cookie de sesión. Sin imports de servidor: la usa el proxy. */

export const SESSION_COOKIE = "fp_session";

const DEV_SECRET = "dev-only-secret-change-me-dev-only-secret-change-me";

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET (≥ 32 caracteres) es obligatorio en producción");
    }
    return new TextEncoder().encode(DEV_SECRET);
  }
  return new TextEncoder().encode(secret);
}

export type SessionPayload = { sub: string; demo: boolean };

export async function signSession(payload: SessionPayload, maxAgeSeconds: number): Promise<string> {
  return new SignJWT({ demo: payload.demo })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + maxAgeSeconds)
    .sign(secretKey());
}

export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string") return null;
    return { sub: payload.sub, demo: payload.demo === true };
  } catch {
    return null;
  }
}
