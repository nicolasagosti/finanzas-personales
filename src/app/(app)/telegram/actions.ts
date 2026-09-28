"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { withUser } from "@/db/client";
import { requireUser } from "@/lib/auth";
import { botUsername, ensureWebhook, telegramConfigured } from "@/lib/telegram";

export type LinkResult = { ok: true; code: string; link: string; username: string } | { ok: false; message: string };

// Sin I, O, 0 ni 1 para que se pueda tipear sin confusiones
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join(""); // 256 % 32 = 0: sin sesgo
}

async function baseUrl(): Promise<string> {
  if (process.env.APP_URL) return process.env.APP_URL;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function createTelegramLink(): Promise<LinkResult> {
  const user = await requireUser();
  if (!telegramConfigured()) return { ok: false, message: "El bot de Telegram no está configurado." };

  let username: string;
  try {
    // Deja el webhook apuntando a esta app (idempotente)
    await ensureWebhook(await baseUrl());
    username = await botUsername();
  } catch (e) {
    console.error("[telegram] setup", e instanceof Error ? e.message : e);
    return { ok: false, message: "No pude conectar con el bot. Revisá TELEGRAM_BOT_TOKEN en la configuración." };
  }

  const code = newCode();
  await withUser(user.id, async (q) => {
    await q.query("delete from telegram_link_codes");
    await q.query(
      "insert into telegram_link_codes (code, user_id, expires_at) values ($1, $2, now() + interval '15 minutes')",
      [code, user.id],
    );
  });
  return { ok: true, code, username, link: `https://t.me/${username}?start=${code}` };
}

export async function unlinkTelegram(): Promise<void> {
  const user = await requireUser();
  await withUser(user.id, (q) => q.query("delete from telegram_links"));
  revalidatePath("/telegram");
}
