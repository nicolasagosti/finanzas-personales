/**
 * Tests de integración contra Postgres real (PGlite en memoria):
 * aislamiento por RLS, invariante contable y auditoría.
 */
import { beforeAll, describe, expect, it } from "vitest";

process.env.PGLITE_DIR = "memory://";

const { asOwner, withUser } = await import("./client");
const { createUserWithDefaults, seedDemoData } = await import("./seed");
const { insertTransactions, simpleTransaction, updateSimpleTransaction } = await import("@/lib/ledger");

let alice: { userId: string; accounts: Record<string, string> };
let bob: { userId: string; accounts: Record<string, string> };

beforeAll(async () => {
  alice = await asOwner(async (q) => {
    const u = await createUserWithDefaults(q, { email: "alice@test.invalid", name: "Alice", isDemo: true });
    await seedDemoData(q, u.userId, u.accounts);
    return u;
  });
  bob = await asOwner((q) => createUserWithDefaults(q, { email: "bob@test.invalid", name: "Bob", isDemo: false }));
}, 60_000);

describe("Row Level Security", () => {
  it("cada usuario ve solo sus filas, aunque la query no filtre", async () => {
    const seenByBob = await withUser(bob.userId, (q) => q.query<{ n: number }>("select count(*)::bigint as n from transactions"));
    const seenByAlice = await withUser(alice.userId, (q) => q.query<{ n: number }>("select count(*)::bigint as n from transactions"));
    expect(seenByBob[0].n).toBe(0);
    expect(seenByAlice[0].n).toBeGreaterThan(300);
  });

  it("no se puede escribir a nombre de otro usuario", async () => {
    await expect(
      withUser(bob.userId, (q) =>
        q.query("insert into accounts (user_id, name, kind) values ($1, 'intrusa', 'asset')", [alice.userId]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("no se puede usar una cuenta ajena en un asiento propio", async () => {
    await expect(
      withUser(bob.userId, (q) =>
        insertTransactions(q, bob.userId, [
          simpleTransaction({ date: "2026-09-01", description: "robo", amount: 100, moneyAccountId: bob.accounts.dinero, categoryAccountId: alice.accounts.sueldo }),
        ]),
      ),
    ).rejects.toThrow();
  });

  it("sin contexto de usuario no se ve nada", async () => {
    const rows = await withUser("00000000-0000-0000-0000-000000000000", (q) => q.query("select * from accounts"));
    expect(rows).toHaveLength(0);
  });
});

describe("partida doble en la base", () => {
  it("el trigger diferido rechaza un asiento desbalanceado al COMMIT", async () => {
    await expect(
      withUser(bob.userId, async (q) => {
        const [tx] = await q.query<{ id: string }>(
          "insert into transactions (user_id, occurred_on, description) values ($1, current_date, 'mal') returning id",
          [bob.userId],
        );
        await q.query(
          "insert into postings (user_id, transaction_id, account_id, amount, currency) values ($1, $2, $3, 100, 'ARS'), ($1, $2, $4, -99, 'ARS')",
          [bob.userId, tx.id, bob.accounts.super, bob.accounts.dinero],
        );
      }),
    ).rejects.toThrow(/desbalanceado/);
  });

  it("la FK compuesta impide mezclar la moneda del asiento con la de la cuenta", async () => {
    await expect(
      withUser(bob.userId, (q) =>
        insertTransactions(q, bob.userId, [
          simpleTransaction({ date: "2026-09-01", description: "x", amount: 100, currency: "USD", moneyAccountId: bob.accounts.dinero, categoryAccountId: bob.accounts.sueldo }),
        ]),
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it("en la demo, todas las transacciones suman cero por moneda", async () => {
    const bad = await withUser(alice.userId, (q) =>
      q.query("select transaction_id from postings group by transaction_id, currency having sum(amount) <> 0"),
    );
    expect(bad).toHaveLength(0);
  });

  it("reimportar con la misma huella no duplica", async () => {
    const tx = () =>
      simpleTransaction({ date: "2026-09-02", description: "CAFE", amount: -680000, moneyAccountId: bob.accounts.dinero, categoryAccountId: bob.accounts.comida, source: "import", importHash: "hash-1" });
    const first = await withUser(bob.userId, (q) => insertTransactions(q, bob.userId, [tx()]));
    const second = await withUser(bob.userId, (q) => insertTransactions(q, bob.userId, [tx()]));
    expect(first).toMatchObject({ inserted: 1, skipped: 0 });
    expect(second).toMatchObject({ inserted: 0, skipped: 1 });
  });
});

describe("editar un movimiento", () => {
  const postingsOf = (id: string) =>
    withUser(bob.userId, (q) =>
      q.query<{ account_id: string; amount: number }>(
        "select account_id, amount from postings where transaction_id = $1 order by amount",
        [id],
      ),
    );

  it("cambia fecha, descripción, monto y categoría, incluso de egreso a ingreso", async () => {
    const { insertedIds: [id] } = await withUser(bob.userId, (q) =>
      insertTransactions(q, bob.userId, [
        simpleTransaction({ date: "2026-09-03", description: "Super", amount: -500000, moneyAccountId: bob.accounts.dinero, categoryAccountId: bob.accounts.super }),
      ]),
    );

    await withUser(bob.userId, (q) =>
      updateSimpleTransaction(q, { id, date: "2026-09-04", description: "Verdulería", amount: -650000, categoryAccountId: bob.accounts.comida }),
    );
    expect(await postingsOf(id)).toEqual([
      { account_id: bob.accounts.dinero, amount: -650000 },
      { account_id: bob.accounts.comida, amount: 650000 },
    ]);
    const [tx] = await withUser(bob.userId, (q) =>
      q.query("select occurred_on, description from transactions where id = $1", [id]),
    );
    expect(tx).toEqual({ occurred_on: "2026-09-04", description: "Verdulería" });

    await withUser(bob.userId, (q) =>
      updateSimpleTransaction(q, { id, date: "2026-09-04", description: "Reintegro", amount: 650000, categoryAccountId: bob.accounts.otrosIngresos }),
    );
    expect(await postingsOf(id)).toEqual([
      { account_id: bob.accounts.otrosIngresos, amount: -650000 },
      { account_id: bob.accounts.dinero, amount: 650000 },
    ]);
  });

  it("no puede tocar movimientos de otro usuario", async () => {
    const [{ id }] = await withUser(alice.userId, (q) => q.query<{ id: string }>("select id from transactions limit 1"));
    await expect(
      withUser(bob.userId, (q) =>
        updateSimpleTransaction(q, { id, date: "2026-09-04", description: "x", amount: -100, categoryAccountId: bob.accounts.super }),
      ),
    ).rejects.toThrow(/No encontrado/);
  });
});

describe("auditoría", () => {
  it("registra los cambios hechos desde la app y es de solo lectura", async () => {
    await withUser(bob.userId, (q) =>
      q.query("insert into accounts (user_id, name, kind, color) values ($1, 'Mascotas', 'expense', 'aqua')", [bob.userId]),
    );
    const log = await withUser(bob.userId, (q) => q.query<{ table_name: string; operation: string }>("select table_name, operation from audit_log"));
    expect(log).toContainEqual({ table_name: "accounts", operation: "INSERT" });
    await expect(withUser(bob.userId, (q) => q.query("delete from audit_log"))).rejects.toThrow(/permission denied/);
  });
});

describe("login con Google", () => {
  it("identifica al usuario por google_sub y no permite duplicarlo", async () => {
    const created = await asOwner((q) =>
      createUserWithDefaults(q, { email: "g@test.invalid", name: "G", isDemo: false, googleSub: "sub-1", avatarUrl: "https://lh3.googleusercontent.com/a/x" }),
    );
    const [again] = await asOwner((q) =>
      q.query<{ id: string }>("update users set name = $2 where google_sub = $1 returning id", ["sub-1", "G2"]),
    );
    expect(again.id).toBe(created.userId);
    await expect(
      asOwner((q) => createUserWithDefaults(q, { email: "otro@test.invalid", name: "X", isDemo: false, googleSub: "sub-1" })),
    ).rejects.toThrow();
  });

  it("rechaza avatares que no sean https", async () => {
    await expect(
      asOwner((q) => createUserWithDefaults(q, { email: "h@test.invalid", name: "H", isDemo: false, googleSub: "sub-2", avatarUrl: "javascript:alert(1)" })),
    ).rejects.toThrow(/check constraint/);
  });
});

describe("eliminar cuenta", () => {
  it("borra al usuario y en cascada todos sus datos (lo mismo que la limpieza de demos)", async () => {
    const victim = await asOwner(async (q) => {
      const u = await createUserWithDefaults(q, { email: "borrar@test.invalid", name: "Borrar", isDemo: true });
      await seedDemoData(q, u.userId, u.accounts);
      return u.userId;
    });
    await withUser(victim, (q) => q.query("insert into accounts (user_id, name, kind) values ($1, 'Auditame', 'expense')", [victim]));

    await asOwner(async (q) => {
      await q.query("delete from users where id = $1", [victim]);
      await q.query("delete from audit_log where user_id = $1", [victim]);
    });

    const left = await asOwner((q) =>
      q.query<{ t: string; n: number }>(
        `select 'transactions' as t, count(*)::bigint as n from transactions where user_id = $1
         union all select 'postings', count(*)::bigint from postings where user_id = $1
         union all select 'accounts', count(*)::bigint from accounts where user_id = $1
         union all select 'audit_log', count(*)::bigint from audit_log where user_id = $1`,
        [victim],
      ),
    );
    expect(left.every((r) => r.n === 0)).toBe(true);
  });
});

describe("integridad al borrar cuentas", () => {
  it("con la FK diferida, sigue sin poder borrarse una cuenta que tiene movimientos", async () => {
    await expect(
      withUser(alice.userId, (q) => q.query("delete from accounts where id = $1", [alice.accounts.super])),
    ).rejects.toThrow(/foreign key/);
  });
});
