import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { withUser } from "@/db/client";
import { SESSION_COOKIE, signSession, verifySession } from "@/lib/session";

export type CurrentUser = { id: string; name: string; email: string; isDemo: boolean };

export const DEMO_TTL_SECONDS = 60 * 60 * 24; // las demos se borran a las 24 h
const USER_TTL_SECONDS = 60 * 60 * 24 * 30;

export async function startSession(userId: string, demo: boolean) {
  const maxAge = demo ? DEMO_TTL_SECONDS : USER_TTL_SECONDS;
  const token = await signSession({ sub: userId, demo }, maxAge);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  });
}

export async function endSession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

/** Usuario de la request (memoizado por request). Verifica firma y existencia. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const jar = await cookies();
  const session = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const rows = await withUser(session.sub, (q) =>
    q.query<CurrentUser>(
      `select id, name, email, is_demo as "isDemo" from users where id = $1`,
      [session.sub],
    ),
  );
  return rows[0] ?? null;
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
