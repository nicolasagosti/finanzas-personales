import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { withUser } from "@/db/client";
import { SESSION_COOKIE, signSession, verifySession } from "@/lib/session";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  isDemo: boolean;
  avatarUrl: string | null;
  viaGoogle: boolean;
};

export const DEMO_TTL_SECONDS = 60 * 60 * 24; // las demos se borran a las 24 h
const USER_TTL_SECONDS = 60 * 60 * 24 * 30;

/** Token + opciones de la cookie de sesión (sirve tanto para cookies() como para NextResponse). */
export async function issueSession(userId: string, demo: boolean) {
  const maxAge = demo ? DEMO_TTL_SECONDS : USER_TTL_SECONDS;
  const token = await signSession({ sub: userId, demo }, maxAge);
  return {
    name: SESSION_COOKIE,
    value: token,
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path: "/",
      maxAge,
    },
  };
}

export async function startSession(userId: string, demo: boolean) {
  const cookie = await issueSession(userId, demo);
  const jar = await cookies();
  jar.set(cookie.name, cookie.value, cookie.options);
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
      `select id, name, email, is_demo as "isDemo", avatar_url as "avatarUrl",
              google_sub is not null as "viaGoogle"
       from users where id = $1`,
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
