import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { asOwner, withUser, type Queryable } from "@/db/client";
import { moneyAccountId } from "@/db/seed";
import { dayLabel, monthLabelLong, monthStart, todayISO, addDays } from "@/lib/dates";
import { insertTransactions, simpleTransaction } from "@/lib/ledger";
import { formatMoney } from "@/lib/money";
import { listCategories, monthlyFlows, totalsByCategory } from "@/lib/reports";
import { matchCategory, parseMessage, type ParsedMessage } from "@/lib/telegram-parse";

/**
 * Bot de Telegram para cargar movimientos escribiendo "café 2500".
 *
 * - El webhook se valida con el header X-Telegram-Bot-Api-Secret-Token, cuyo
 *   valor se deriva de SESSION_SECRET (no hace falta otra variable).
 * - Un usuario vincula su Telegram con un código de un solo uso que genera en
 *   la app (deep link t.me/<bot>?start=CODIGO).
 * - Cada update lleva su update_id como huella: si Telegram reintenta el
 *   envío, el movimiento no se duplica.
 */

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

export function webhookSecret(): string {
  return createHmac("sha256", process.env.SESSION_SECRET ?? "dev-only-secret").update("telegram-webhook").digest("hex");
}

export function isValidWebhookSecret(header: string | null): boolean {
  if (!header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(webhookSecret());
  return a.length === b.length && timingSafeEqual(a, b);
}

async function telegramApi<T>(method: string, body?: object): Promise<T> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Falta TELEGRAM_BOT_TOKEN");
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (!json.ok) throw new Error(`Telegram ${method}: ${json.description ?? res.status}`);
  return json.result as T;
}

let cachedUsername: string | null = null;

export async function botUsername(): Promise<string> {
  cachedUsername ??= (await telegramApi<{ username: string }>("getMe")).username;
  return cachedUsername;
}

/** Registra (o actualiza) el webhook del bot apuntando a esta app. Es idempotente. */
export async function ensureWebhook(baseUrl: string): Promise<void> {
  await telegramApi("setWebhook", {
    url: new URL("/api/telegram/webhook", baseUrl).toString(),
    secret_token: webhookSecret(),
    allowed_updates: ["message"],
  });
  await telegramApi("setMyCommands", {
    commands: [
      { command: "resumen", description: "Ingresos, egresos y balance del mes" },
      { command: "deshacer", description: "Borrar el último movimiento cargado por acá" },
      { command: "ayuda", description: "Cómo escribir los movimientos" },
    ],
  });
}

// ---------------------------------------------------------------------------

export type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    from?: { id: number; is_bot: boolean; first_name?: string; username?: string };
    text?: string;
  };
};

export type TelegramReply = { chat_id: number; text: string };

const HELP = `Mandame tus movimientos así:

• café 2500
• super 84.320 ayer
• 12 lucas nafta
• +150000 sueldo  → ingreso
• 3500 regalo #compras  → elegís la categoría

Comandos:
/resumen · cómo vas este mes
/deshacer · borra el último que cargaste por acá
/desvincular · desconecta este Telegram`;

const NOT_LINKED = `Hola 👋 Todavía no vinculaste este Telegram con tu cuenta.

Entrá a la app → Telegram → "Vincular mi Telegram" y tocá el botón que te abre este chat.`;

export async function handleTelegramUpdate(update: TelegramUpdate): Promise<TelegramReply | null> {
  const msg = update.message;
  if (!msg || msg.chat.type !== "private" || !msg.from || msg.from.is_bot) return null;
  const from = msg.from;
  const reply = (text: string): TelegramReply => ({ chat_id: msg.chat.id, text });
  if (!msg.text) return reply("Por ahora solo entiendo mensajes de texto 🙂");

  const parsed = parseMessage(msg.text, todayISO());

  if (parsed.kind === "command" && parsed.command === "start" && parsed.arg) {
    return reply(await linkAccount(parsed.arg, msg.chat.id, from));
  }

  const [link] = await asOwner((q) =>
    q.query<{ user_id: string }>("select user_id from telegram_links where telegram_user_id = $1", [from.id]),
  );
  if (!link) return reply(NOT_LINKED);
  const userId = link.user_id;

  if (parsed.kind === "command") {
    switch (parsed.command) {
      case "start":
      case "ayuda":
      case "help":
        return reply(HELP);
      case "resumen":
        return reply(await monthSummary(userId));
      case "deshacer":
        return reply(await undoLast(userId));
      case "desvincular":
        await asOwner((q) => q.query("delete from telegram_links where telegram_user_id = $1", [from.id]));
        return reply("Listo, desvinculé este Telegram. Podés volver a vincularlo desde la app.");
      default:
        return reply(`No conozco ese comando.\n\n${HELP}`);
    }
  }
  if (parsed.kind === "invalid") {
    return reply(`No encontré el monto 🤔 Probá, por ejemplo: café 2500\n\n/ayuda para ver más ejemplos`);
  }
  return reply(await createMovement(userId, parsed, update.update_id));
}

async function linkAccount(
  rawCode: string,
  chatId: number,
  from: { id: number; username?: string },
): Promise<string> {
  const code = rawCode.trim().toUpperCase();
  if (!/^[A-Z2-9]{8}$/.test(code)) return "Ese código no es válido. Generá uno nuevo desde la app.";
  const name = await asOwner(async (q) => {
    const [row] = await q.query<{ user_id: string }>(
      "delete from telegram_link_codes where code = $1 and expires_at > now() returning user_id",
      [code],
    );
    if (!row) return null;
    // Un Telegram por usuario y un usuario por Telegram
    await q.query("delete from telegram_links where telegram_user_id = $1 or user_id = $2", [from.id, row.user_id]);
    await q.query(
      "insert into telegram_links (user_id, telegram_user_id, chat_id, username) values ($1, $2, $3, $4)",
      [row.user_id, from.id, chatId, from.username?.slice(0, 64) ?? null],
    );
    const [user] = await q.query<{ name: string }>("select name from users where id = $1", [row.user_id]);
    return user?.name ?? "";
  });
  if (name === null) return "Ese código venció o ya se usó. Generá uno nuevo desde la app.";
  return `✅ ¡Listo${name ? `, ${name.split(" ")[0]}` : ""}! Tu Telegram quedó vinculado.\n\n${HELP}`;
}

async function fallbackCategory(q: Queryable, userId: string, type: "income" | "expense"): Promise<{ id: string; name: string }> {
  const name = type === "income" ? "Otros ingresos" : "Otros gastos";
  const [existing] = await q.query<{ id: string }>(
    "select id from accounts where kind = $1::account_kind and name = $2 and currency = 'ARS'",
    [type, name],
  );
  if (existing) return { id: existing.id, name };
  const [created] = await q.query<{ id: string }>(
    "insert into accounts (user_id, name, kind, color) values ($1, $2, $3, 'gray') returning id",
    [userId, name, type],
  );
  return { id: created.id, name };
}

function dateText(date: string): string {
  const today = todayISO();
  if (date === today) return "hoy";
  if (date === addDays(today, -1)) return "ayer";
  return dayLabel(date);
}

async function createMovement(
  userId: string,
  p: Extract<ParsedMessage, { kind: "movement" }>,
  updateId: number,
): Promise<string> {
  return withUser(userId, async (q) => {
    const categories = await listCategories(q);
    // "Aprende": si ya cargó algo con la misma descripción, usa la misma categoría
    const [learned] = p.description
      ? await q.query<{ id: string }>(
          `select c.account_id as id
           from transactions t
           join postings c on c.transaction_id = t.id
           join accounts a on a.id = c.account_id
           where a.kind = $1::account_kind and lower(t.description) = lower($2)
           order by t.occurred_on desc, t.created_at desc
           limit 1`,
          [p.type, p.description],
        )
      : [];
    const match = matchCategory({ description: p.description, hashtag: p.hashtag, type: p.type, categories, learnedId: learned?.id });
    const category = match.id
      ? categories.find((c) => c.id === match.id)!
      : await fallbackCategory(q, userId, p.type);

    const description = p.description ?? category.name;
    const { inserted } = await insertTransactions(q, userId, [
      simpleTransaction({
        date: p.date,
        description,
        amount: p.type === "income" ? p.cents : -p.cents,
        moneyAccountId: await moneyAccountId(q, userId),
        categoryAccountId: category.id,
        source: "telegram",
        importHash: `telegram:${updateId}`,
      }),
    ]);
    if (!inserted) return "Ese movimiento ya estaba cargado 👍";

    const lines = [
      `${p.type === "income" ? "💰 Ingreso" : "✅ Egreso"} cargado`,
      `${formatMoney(p.cents, "ARS", { decimals: p.cents % 100 !== 0 })} · ${category.name}`,
      `${description} · ${dateText(p.date)}`,
    ];
    if (!match.id) lines.push("", "No reconocí la categoría. Podés elegirla con #categoria, por ejemplo: 3500 regalo #compras");
    if (p.hashtag && match.how !== "hashtag") lines.push("", `No encontré la categoría #${p.hashtag}.`);
    lines.push("", "/deshacer si algo salió mal");
    return lines.join("\n");
  });
}

async function monthSummary(userId: string): Promise<string> {
  const month = monthStart(todayISO());
  const { flow, top } = await withUser(userId, async (q) => ({
    flow: (await monthlyFlows(q, month, month))[0],
    top: (await totalsByCategory(q, "expense", month)).slice(0, 3),
  }));
  const balance = flow.income - flow.expense;
  const money = (c: number) => formatMoney(c, "ARS", { decimals: false });
  const lines = [
    `📊 ${monthLabelLong(month).replace(/^./, (c) => c.toUpperCase())}`,
    "",
    `Ingresos: ${money(flow.income)}`,
    `Egresos: ${money(flow.expense)}`,
    `Balance: ${money(balance)}`,
  ];
  if (top.length) {
    lines.push("", "Donde más gastaste:");
    for (const t of top) lines.push(`• ${t.name}: ${money(t.total)}`);
  }
  return lines.join("\n");
}

async function undoLast(userId: string): Promise<string> {
  const [row] = await withUser(userId, (q) =>
    q.query<{ description: string }>(
      `delete from transactions
       where id = (
         select id from transactions
         where source = 'telegram' and created_at > now() - interval '24 hours'
         order by created_at desc limit 1
       )
       returning description`,
    ),
  );
  return row
    ? `🗑️ Borré "${row.description}".`
    : "No hay movimientos cargados por Telegram en las últimas 24 horas para deshacer.";
}
