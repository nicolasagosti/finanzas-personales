-- Carga de movimientos desde un bot de Telegram.
alter table transactions drop constraint transactions_source_check;
alter table transactions add constraint transactions_source_check
  check (source in ('manual', 'import', 'seed', 'telegram'));

-- Una cuenta de Telegram vinculada por usuario (y viceversa).
create table telegram_links (
  user_id           uuid primary key references users (id) on delete cascade,
  telegram_user_id  bigint not null unique,
  chat_id           bigint not null,
  username          text check (username is null or length(username) <= 64),
  linked_at         timestamptz not null default now()
);

-- Códigos de un solo uso para vincular (vencen a los 15 minutos).
create table telegram_link_codes (
  code        text primary key check (code ~ '^[A-Z2-9]{8}$'),
  user_id     uuid not null references users (id) on delete cascade,
  expires_at  timestamptz not null
);

alter table telegram_links enable row level security;
alter table telegram_link_codes enable row level security;
create policy tenant_isolation on telegram_links
  using (user_id = app_current_user_id()) with check (user_id = app_current_user_id());
create policy tenant_isolation on telegram_link_codes
  using (user_id = app_current_user_id()) with check (user_id = app_current_user_id());

-- La app solo ve y borra su vínculo y crea sus códigos; vincular lo hace el
-- webhook con el rol dueño, después de validar el código.
grant select, delete on telegram_links to app_user;
grant select, insert, delete on telegram_link_codes to app_user;
