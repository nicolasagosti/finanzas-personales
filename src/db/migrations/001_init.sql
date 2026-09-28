-- =====================================================================
-- Finanzas Personales — esquema inicial
--
-- * Libro de doble entrada: cada transacción tiene ≥ 2 asientos (postings)
--   cuya suma por moneda es exactamente 0. Montos en centavos (BIGINT).
-- * Multi-tenant con Row Level Security: la app ejecuta cada request con
--   SET LOCAL ROLE app_user + app.user_id, y Postgres filtra las filas.
-- * Auditoría con triggers SECURITY DEFINER: la app no puede escribir ni
--   borrar el log, solo leer sus propias entradas.
-- =====================================================================

-- ---------- Rol de aplicación (sin login, se usa vía SET ROLE) ----------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    create role app_user nologin;
  end if;
end $$;

-- Permite que el usuario dueño de la conexión haga SET ROLE app_user
-- (en Neon/Supabase el rol de conexión no es superusuario).
do $$
begin
  execute format('grant app_user to %I', current_user);
exception when others then
  null; -- superusuario (PGlite local): no hace falta
end $$;

-- Usuario actual de la request. NULL si no hay contexto => RLS no devuelve nada.
create or replace function app_current_user_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

-- ------------------------------ Tablas ---------------------------------
create table users (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  name        text not null,
  is_demo     boolean not null default false,
  created_at  timestamptz not null default now()
);

create type account_kind as enum ('asset', 'liability', 'income', 'expense', 'equity');

-- Cuentas del libro mayor. Las "categorías" son cuentas de ingreso/gasto,
-- igual que en contabilidad: gastar en Supermercado es debitar esa cuenta.
create table accounts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users (id) on delete cascade,
  name        text not null check (length(name) between 1 and 60),
  kind        account_kind not null,
  currency    char(3) not null default 'ARS' check (currency in ('ARS', 'USD')),

  is_system   boolean not null default false,
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (user_id, kind, name, currency),
  unique (id, user_id),
  -- destino de FKs compuestas: garantizan que un asiento use una cuenta
  -- del mismo usuario y en la misma moneda
  unique (id, user_id, currency)
);

create table transactions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users (id) on delete cascade,
  occurred_on  date not null,
  description  text not null check (length(description) between 1 and 200),
  source       text not null default 'manual' check (source in ('manual', 'import', 'seed')),
  -- huella de importación: hace idempotente reimportar el mismo resumen
  import_hash  text,
  created_at   timestamptz not null default now(),
  unique (user_id, import_hash),
  unique (id, user_id)
);

create table postings (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,
  transaction_id  uuid not null,
  account_id      uuid not null,
  -- centavos; convención de ledger: positivo = débito, negativo = crédito
  amount          bigint not null check (amount <> 0),
  currency        char(3) not null,
  foreign key (transaction_id, user_id) references transactions (id, user_id) on delete cascade,
  foreign key (account_id, user_id, currency) references accounts (id, user_id, currency)
);

create table budgets (
  user_id     uuid not null references users (id) on delete cascade,
  account_id  uuid not null,
  amount      bigint not null check (amount >= 0), -- centavos ARS por mes
  primary key (user_id, account_id),
  foreign key (account_id, user_id) references accounts (id, user_id) on delete cascade
);

-- Reglas de categorización: si la descripción contiene `pattern`, va a `account_id`.
create table rules (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users (id) on delete cascade,
  pattern     text not null check (length(pattern) between 2 and 80),
  account_id  uuid not null,
  priority    int not null default 100,
  created_at  timestamptz not null default now(),
  unique (user_id, pattern),
  foreign key (account_id, user_id) references accounts (id, user_id) on delete cascade
);

-- Series de referencia (globales, solo lectura para la app)
create table cpi (
  month        date primary key,
  index_value  numeric(14, 4) not null check (index_value > 0)
);

create table exchange_rates (
  month       date not null,
  kind        text not null check (kind in ('oficial', 'mep', 'blue')),
  ars_per_usd numeric(14, 4) not null check (ars_per_usd > 0),
  primary key (month, kind)
);

create table audit_log (
  id          bigint generated always as identity primary key,
  user_id     uuid not null,
  table_name  text not null,
  operation   text not null,
  row_id      uuid,
  old_data    jsonb,
  new_data    jsonb,
  at          timestamptz not null default now()
);

create index on accounts (user_id, kind);
create index on transactions (user_id, occurred_on desc);
create index on postings (user_id, account_id);
create index on postings (transaction_id);
create index on audit_log (user_id, at desc);

-- ------------------ Invariante de la partida doble ---------------------
-- Trigger de constraint diferido: se evalúa al COMMIT, cuando ya se
-- insertaron todos los asientos de la transacción.
create or replace function check_transaction_balanced() returns trigger
language plpgsql as $$
declare
  tx uuid := coalesce(new.transaction_id, old.transaction_id);
  unbalanced record;
  n int;
begin
  if not exists (select 1 from transactions where id = tx) then
    return null; -- la transacción se borró entera (cascade)
  end if;

  select count(*) into n from postings where transaction_id = tx;
  if n < 2 then
    raise exception 'La transacción % necesita al menos 2 asientos', tx
      using errcode = 'check_violation';
  end if;

  select currency, sum(amount) as total into unbalanced
  from postings where transaction_id = tx
  group by currency having sum(amount) <> 0
  limit 1;
  if found then
    raise exception 'Asiento desbalanceado en % (% %)', tx, unbalanced.currency, unbalanced.total
      using errcode = 'check_violation';
  end if;
  return null;
end $$;

create constraint trigger postings_must_balance
  after insert or update or delete on postings
  deferrable initially deferred
  for each row execute function check_transaction_balanced();

-- ------------------------------ Auditoría ------------------------------
-- Solo se auditan cambios hechos desde la app (con app.user_id seteado).
create or replace function audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := app_current_user_id();
begin
  if uid is null then
    return null;
  end if;
  insert into audit_log (user_id, table_name, operation, row_id, old_data, new_data)
  values (
    uid,
    tg_table_name,
    tg_op,
    coalesce(
      (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end ->> 'id')::uuid,
      (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end ->> 'account_id')::uuid
    ),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return null;
end $$;

create trigger audit_accounts after insert or update or delete on accounts
  for each row execute function audit_row();
create trigger audit_transactions after insert or update or delete on transactions
  for each row execute function audit_row();
create trigger audit_budgets after insert or update or delete on budgets
  for each row execute function audit_row();
create trigger audit_rules after insert or update or delete on rules
  for each row execute function audit_row();
-- en asientos solo interesa la recategorización (el alta ya queda en transactions)
create trigger audit_postings after update on postings
  for each row execute function audit_row();

-- --------------------------- Row Level Security ------------------------
alter table users enable row level security;
alter table accounts enable row level security;
alter table transactions enable row level security;
alter table postings enable row level security;
alter table budgets enable row level security;
alter table rules enable row level security;
alter table audit_log enable row level security;

create policy users_self on users
  using (id = app_current_user_id());

create policy tenant_isolation on accounts
  using (user_id = app_current_user_id()) with check (user_id = app_current_user_id());
create policy tenant_isolation on transactions
  using (user_id = app_current_user_id()) with check (user_id = app_current_user_id());
create policy tenant_isolation on postings
  using (user_id = app_current_user_id()) with check (user_id = app_current_user_id());
create policy tenant_isolation on budgets
  using (user_id = app_current_user_id()) with check (user_id = app_current_user_id());
create policy tenant_isolation on rules
  using (user_id = app_current_user_id()) with check (user_id = app_current_user_id());
create policy audit_read_own on audit_log
  for select using (user_id = app_current_user_id());

-- ------------------------------ Permisos -------------------------------
grant usage on schema public to app_user;
grant select on users, cpi, exchange_rates, audit_log to app_user;
grant select, insert, update, delete on accounts, transactions, postings, budgets, rules to app_user;
