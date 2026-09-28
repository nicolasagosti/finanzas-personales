import { NextResponse, type NextRequest } from "next/server";
import { handleTelegramUpdate, isValidWebhookSecret, telegramConfigured, type TelegramUpdate } from "@/lib/telegram";

/**
 * Webhook del bot. Telegram manda el secreto que registramos con setWebhook en
 * X-Telegram-Bot-Api-Secret-Token: sin ese header, la request se rechaza.
 * La respuesta al usuario viaja en el cuerpo de la respuesta (método
 * sendMessage), así no hace falta otra llamada a la API de Telegram.
 */
export async function POST(req: NextRequest) {
  if (!telegramConfigured()) return new NextResponse(null, { status: 404 });
  if (!isValidWebhookSecret(req.headers.get("x-telegram-bot-api-secret-token"))) {
    return new NextResponse(null, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({});
  }
  if (typeof update?.update_id !== "number") return NextResponse.json({});

  try {
    const reply = await handleTelegramUpdate(update);
    return NextResponse.json(reply ? { method: "sendMessage", ...reply } : {});
  } catch (e) {
    // 200 igual: si devolviéramos error, Telegram reintentaría el mismo mensaje en loop
    console.error("[telegram]", e instanceof Error ? e.message : e);
    const chatId = update.message?.chat.id;
    return NextResponse.json(
      chatId ? { method: "sendMessage", chat_id: chatId, text: "Uy, algo falló guardando eso. Probá de nuevo en un rato." } : {},
    );
  }
}
