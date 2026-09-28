import { beforeAll, describe, expect, it } from "vitest";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey } from "jose";
import {
  buildAuthorizationUrl,
  exchangeCode,
  parseTransaction,
  pkceChallenge,
  safeNextPath,
  serializeTransaction,
  verifyIdToken,
} from "./google-oauth";

const CLIENT_ID = "test-client.apps.googleusercontent.com";

let privateKey: CryptoKey;
let jwks: JWTVerifyGetKey;
let otherKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" };
  jwks = createLocalJWKSet({ keys: [jwk] });
  otherKey = (await generateKeyPair("RS256")).privateKey;
});

function idToken(claims: Record<string, unknown> = {}, key: CryptoKey = privateKey) {
  return new SignJWT({ email: "Nico@Example.com", email_verified: true, name: "Nico", nonce: "n-123", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer((claims.iss as string) ?? "https://accounts.google.com")
    .setAudience((claims.aud as string) ?? CLIENT_ID)
    .setSubject("google-sub-1")
    .setIssuedAt()
    .setExpirationTime((claims.exp as number) ?? "5m")
    .sign(key);
}

describe("id_token de Google", () => {
  it("acepta un token válido y normaliza la identidad", async () => {
    const identity = await verifyIdToken(await idToken(), { clientId: CLIENT_ID, nonce: "n-123", jwks });
    expect(identity).toEqual({ sub: "google-sub-1", email: "nico@example.com", name: "Nico", picture: null });
  });

  it.each([
    ["firmado con otra clave", {}, "otra"],
    ["para otra aplicación (audience)", { aud: "otra-app" }, null],
    ["de otro emisor", { iss: "https://evil.example" }, null],
    ["con otro nonce (replay)", { nonce: "otro" }, null],
    ["con el email sin verificar", { email_verified: false }, null],
    ["vencido", { exp: Math.floor(Date.now() / 1000) - 3600 }, null],
  ])("rechaza un token %s", async (_, claims, key) => {
    const token = await idToken(claims, key ? otherKey : privateKey);
    await expect(verifyIdToken(token, { clientId: CLIENT_ID, nonce: "n-123", jwks })).rejects.toThrow();
  });

  it("solo acepta avatares https", async () => {
    const identity = await verifyIdToken(await idToken({ picture: "http://inseguro/x.png" }), { clientId: CLIENT_ID, nonce: "n-123", jwks });
    expect(identity.picture).toBeNull();
  });
});

describe("transacción OAuth", () => {
  it("PKCE S256 coincide con el ejemplo del RFC 7636", async () => {
    expect(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("la URL de autorización lleva state, nonce y el challenge, nunca el verifier", async () => {
    const url = new URL(
      await buildAuthorizationUrl({ clientId: CLIENT_ID, redirectUri: "http://localhost:3000/api/auth/google/callback", state: "s", nonce: "n", verifier: "v".repeat(50) }),
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: CLIENT_ID,
      response_type: "code",
      scope: "openid email profile",
      state: "s",
      nonce: "n",
      code_challenge_method: "S256",
    });
    expect(url.toString()).not.toContain("v".repeat(50));
  });

  it("la cookie de transacción se serializa y rechaza contenido manipulado", () => {
    const tx = { state: "a", nonce: "b", verifier: "c", next: "/" };
    expect(parseTransaction(serializeTransaction(tx))).toEqual(tx);
    expect(parseTransaction("no-es-base64-json")).toBeNull();
    expect(parseTransaction(Buffer.from(JSON.stringify({ state: 1 })).toString("base64url"))).toBeNull();
    expect(parseTransaction(undefined)).toBeNull();
  });

  it.each([
    ["/movimientos", "/movimientos"],
    ["//evil.com", "/"],
    ["/\\evil.com", "/"],
    ["https://evil.com", "/"],
    [null, "/"],
  ])("safeNextPath(%j) -> %s (sin open redirect)", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it("canjea el code mandando el verifier y el secreto por POST", async () => {
    let sent: URLSearchParams | null = null;
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      sent = new URLSearchParams(init.body as string);
      return new Response(JSON.stringify({ id_token: "token" }), { status: 200 });
    }) as unknown as typeof fetch;
    const token = await exchangeCode({
      config: { clientId: CLIENT_ID, clientSecret: "secreto" },
      code: "c",
      verifier: "ver",
      redirectUri: "http://localhost:3000/api/auth/google/callback",
      fetchImpl: fakeFetch,
    });
    expect(token).toBe("token");
    expect(Object.fromEntries(sent!)).toMatchObject({ grant_type: "authorization_code", code: "c", code_verifier: "ver", client_secret: "secreto" });
  });

  it("falla si Google rechaza el canje", async () => {
    const fakeFetch = (async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })) as unknown as typeof fetch;
    await expect(
      exchangeCode({ config: { clientId: CLIENT_ID, clientSecret: "x" }, code: "c", verifier: "v", redirectUri: "r", fetchImpl: fakeFetch }),
    ).rejects.toThrow(/invalid_grant/);
  });
});
