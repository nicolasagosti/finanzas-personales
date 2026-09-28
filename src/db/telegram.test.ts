/**
 * Flujo del bot de Telegram contra Postgres real (PGlite en memoria).
 */
import { beforeAll, describe, expect, it } from "vitest";

process.env.PGLITE_DIR = "memory://";

const { asOwner, withUser } = await import("./client");
const { createUserWithDefaults } = await import("./seed");
const { handleTelegramUpdate } = await import("@/lib/telegram");

const TG_USER = 555_000_111;
let updateId = 1000;
let user: { userId: string; accounts: Record<string, string> };

function send(text: string, opts: { from?: number; chatType?: string; id?: number } = {}) {
  const from = opts.from ?? TG_USER;
  return handleTelegramUpdate({
    update_id: opts.id ?? ++updateId,
    message: {
      message_id: updateId,
      chat: { id: from, type: opts.chatType ?? "private" },
      from: { id: from, is_bot: false, first_name: "Nico", username: "nico" },
      text,
    },
  });
}

async function newCode(userId: string, code: string, minutes = 15) {
  await withUser(userId, (q) =>
    q.query(`insert into telegram_link_codes (code, user_id, expires_at) values ($1, $2, now() + ($3 || ' minutes')::interval)`, [
      code,
      userId,
      String(minutes),
    ]),
  );
}

const lastMovement = () =>
  withUser(user.userId, (q) =>
    q.query<{ description: string; amount: number; category: string; source: string; occurred_on: string }>(
      `select t.description, -c.amount as amount, a.name as category, t.source, t.occurred_on
       from transactions t join postings c on c.transaction_id = t.id
       join accounts a on a.id = c.account_id and a.kind in ('income', 'expense')
       order by t.created_at desc limit 1`,
    ),
  ).then((r) => r[0]);

beforeAll(async () => {
  user = await asOwner((q) => createUserWithDefaults(q, { email: "tg@test.invalid", name: "Nico Test", isDemo: false }));
}, 60_000);

describe("vinculación", () => {
  it("un Telegram sin vincular no puede cargar nada", async () => {
    const r = await send("café 2500");
    expect(r?.text).toMatch(/Todavía no vinculaste/);
    const [{ n }] = await withUser(user.userId, (q) => q.query<{ n: number }>("select count(*)::bigint as n from transactions"));
    expect(n).toBe(0);
  });

  it("rechaza códigos inválidos o vencidos", async () => {
    expect((await send("/start x1"))?.text).toMatch(/no es válido/);
    await newCode(user.userId, "VENCID22", -1);
    expect((await send("/start VENCID22"))?.text).toMatch(/venció o ya se usó/);
  });

  it("vincula con un código de un solo uso", async () => {
    await newCode(user.userId, "ABCD2345");
    expect((await send("/start ABCD2345"))?.text).toMatch(/Listo, Nico/);
    expect((await send("/start ABCD2345", { from: 999 }))?.text).toMatch(/venció o ya se usó/);
  });

  it("ignora grupos y bots", async () => {
    expect(await send("café 2500", { chatType: "group" })).toBeNull();
  });
});

describe("carga de movimientos", () => {
  it("egreso con categoría por palabra clave", async () => {
    const r = await send("café 2500");
    expect(r?.text).toMatch(/Egreso cargado/);
    expect(r?.text).toMatch(/Comida afuera/);
    expect(await lastMovement()).toMatchObject({ description: "Café", amount: -250000, category: "Comida afuera", source: "telegram" });
  });

  it("si Telegram reenvía el mismo update, no se duplica", async () => {
    await send("super 1000", { id: 777 });
    const r = await send("super 1000", { id: 777 });
    expect(r?.text).toMatch(/ya estaba cargado/);
    const [{ n }] = await withUser(user.userId, (q) =>
      q.query<{ n: number }>("select count(*)::bigint as n from transactions where import_hash = 'telegram:777'"),
    );
    expect(n).toBe(1);
  });

  it("ingreso con +, fecha 'ayer' y lucas", async () => {
    await send("+150 lucas sueldo ayer");
    const m = await lastMovement();
    expect(m).toMatchObject({ amount: 15000000, category: "Sueldo" });
    expect(m.occurred_on < new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date())).toBe(true);
  });

  it("sin categoría reconocible va a 'Otros gastos' y lo avisa", async () => {
    const r = await send("veterinaria 8000");
    expect(r?.text).toMatch(/No reconocí la categoría/);
    expect(await lastMovement()).toMatchObject({ category: "Otros gastos" });
  });

  it("aprende: si recategorizás en la app, la próxima vez usa esa categoría", async () => {
    await withUser(user.userId, (q) =>
      q.query(
        `update postings p set account_id = $1
         from transactions t, accounts a
         where p.transaction_id = t.id and a.id = p.account_id and a.kind = 'expense' and t.description = 'Veterinaria'`,
        [user.accounts.salud],
      ),
    );
    await send("veterinaria 12000");
    expect(await lastMovement()).toMatchObject({ category: "Salud", amount: -1200000 });
  });

  it("#categoría elige explícitamente", async () => {
    await send("3500 regalo #compras");
    expect(await lastMovement()).toMatchObject({ description: "Regalo", category: "Ropa y compras" });
  });

  it("sin monto explica cómo escribirlo", async () => {
    expect((await send("hola"))?.text).toMatch(/No encontré el monto/);
  });
});

describe("comandos", () => {
  it("/resumen muestra el mes", async () => {
    const r = await send("/resumen");
    expect(r?.text).toMatch(/Ingresos: /);
    expect(r?.text).toMatch(/Egresos: /);
    expect(r?.text).toMatch(/Donde más gastaste/);
  });

  it("/deshacer borra el último cargado por Telegram", async () => {
    const r = await send("/deshacer");
    expect(r?.text).toMatch(/Borré "Regalo"/);
    expect((await lastMovement()).description).not.toBe("Regalo");
  });

  it("/desvincular corta el acceso", async () => {
    expect((await send("/desvincular"))?.text).toMatch(/desvinculé/);
    expect((await send("café 100"))?.text).toMatch(/Todavía no vinculaste/);
  });
});
