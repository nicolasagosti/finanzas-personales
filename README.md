# Finanzas Personales

Gestor de finanzas personales pensado para Argentina: **libro contable de doble entrada**, **pesos y dólares**, **ajuste por inflación con el IPC del INDEC** e **importación idempotente de resúmenes bancarios**. La seguridad vive en la base: **Row Level Security de Postgres**, auditoría inmutable y una CSP estricta.

> La demo crea un espacio privado con 12 meses de movimientos **sintéticos**. Las series de inflación y dólar son **reales** (INDEC y argentinadatos.com).

## Qué la hace distinta

| | |
|---|---|
| **Partida doble de verdad** | Cada movimiento es una transacción con ≥ 2 asientos que suman exactamente 0 por moneda. Lo valida un trigger de constraint diferido en Postgres, no solo el código. |
| **Dinero sin floats** | Montos en centavos (`BIGINT`). El parser de montos (`1.234,56`, `1,234.56`, `(1.234,56)`, `150-`…) trabaja con strings y `BigInt`, nunca con `parseFloat`. |
| **Pensada para Argentina** | Toggle *pesos corrientes / pesos de hoy / dólares* con dólar oficial, MEP o blue. El gráfico de evolución muestra cuánto del "aumento" del gasto es solo inflación. |
| **Multi-moneda contable** | Comprar dólares genera 4 asientos balanceados por moneda gracias a cuentas puente de "Conversión de moneda". |
| **Importación idempotente** | Cada fila lleva una huella SHA-256; reimportar el mismo resumen (o uno superpuesto) no duplica nada. Las reglas categorizan solas. |
| **Seguridad como feature** | RLS por usuario, FKs compuestas anti cross-tenant, auditoría con triggers `SECURITY DEFINER`, CSP con nonce, cookies httpOnly. Hay una pantalla que **intenta romper todo eso en vivo** contra la base. |

## Stack

- **Next.js 16** (App Router, Server Components, Server Actions, `proxy.ts`) + **TypeScript**
- **Tailwind CSS v4** + **shadcn/ui** (Base UI) + **Recharts** para los gráficos
- **Postgres**: [PGlite](https://pglite.dev) (Postgres real en WASM) para desarrollo sin configuración, **postgres.js** en producción (Neon, Supabase, Vercel Postgres)
- SQL escrito a mano (sin ORM): el esquema, las políticas RLS y los triggers son el núcleo del proyecto y quedan a la vista
- **jose** (JWT de sesión), **zod** (validación), **Papa Parse** (CSV), **Vitest** (tests)

## Correr localmente

```bash
npm install
npm run dev          # http://localhost:3000
```

No hace falta instalar Postgres: sin `DATABASE_URL` la app levanta PGlite en `.data/pglite`, corre las migraciones y carga las series de referencia. En `/login`, **Entrar a la demo** genera un usuario aislado con 12 meses de datos.

```bash
npm test             # 62 tests: unitarios + integración contra Postgres (PGlite en memoria)
npm run lint
npm run typecheck
npm run sync:indices # actualiza el snapshot de IPC y dólar desde las APIs públicas
npm run db:reset     # borra la base local (con el servidor apagado)
```

Los tests de integración también corren contra un Postgres real:

```bash
DATABASE_URL=postgres://usuario:clave@localhost:5432/finanzas npx vitest run src/db
```

## Deploy en Vercel + Neon

1. Creá una base en [Neon](https://neon.tech) (plan gratuito) y copiá la connection string del rol dueño (`neondb_owner`).
2. Importá el repo en Vercel y definí las variables:
   - `DATABASE_URL` — la connection string de Neon (`?sslmode=require`)
   - `SESSION_SECRET` — `openssl rand -hex 32`
3. Deploy y verificá la configuración en **`/api/health`**: informa si están `DATABASE_URL` y `SESSION_SECRET`, si la base conecta y migra y si funciona el rol de RLS, sin exponer secretos.

La primera request corre las migraciones (con `pg_advisory_xact_lock`, seguro ante instancias concurrentes). La migración crea el rol `app_user` y se lo otorga al rol de conexión, que es lo que Neon necesita para hacer `SET ROLE`.

### Login con Google (opcional)

1. En [Google Cloud Console](https://console.cloud.google.com/apis/credentials): **Pantalla de consentimiento de OAuth** → tipo *Externo*, nombre de la app y email de soporte.
2. **Credenciales → Crear credenciales → ID de cliente de OAuth** → *Aplicación web*.
3. **URIs de redireccionamiento autorizados**:
   - `https://TU-PROYECTO.vercel.app/api/auth/google/callback`
   - `http://localhost:3000/api/auth/google/callback` (desarrollo)
4. Cargá `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` en Vercel y volvé a desplegar. Sin esas variables el botón no se muestra.

El flujo es OpenID Connect con Authorization Code + **PKCE** (S256), `state` y `nonce` guardados en una cookie `httpOnly` de 10 minutos. El `id_token` se valida contra las claves públicas de Google (firma RS256, issuer, audience, vencimiento, nonce y `email_verified`). El usuario se identifica por el `sub` de Google, no por el email, y la redirección posterior solo acepta rutas internas (sin open redirects).

Probado contra Postgres 16 con un dueño **no superusuario** con `CREATEROLE`, el mismo modelo de permisos de Neon.

## Arquitectura

```
src/
├── proxy.ts                 # CSP con nonce + redirección si no hay sesión
├── db/
│   ├── migrations/001_init.sql  # esquema, RLS, triggers, permisos
│   ├── client.ts            # driver PGlite/postgres.js, migraciones, withUser()
│   ├── seed.ts              # plan de cuentas por defecto + demo sintética
│   └── reference-data.json  # snapshot de IPC (INDEC) y dólar (oficial/MEP/blue)
├── lib/
│   ├── ledger.ts            # construcción y validación de asientos
│   ├── money.ts             # parseo y formato de montos (centavos)
│   ├── import.ts            # CSV → líneas → huellas → reglas
│   └── reports.ts           # reportes (ninguna query filtra por user_id: lo hace RLS)
└── app/
    ├── login/               # demo aislada o espacio vacío
    └── (app)/               # resumen, movimientos, cuentas, categorías, presupuesto, importar, seguridad
```

### Modelo de datos

```mermaid
erDiagram
  users ||--o{ accounts : tiene
  users ||--o{ transactions : tiene
  transactions ||--|{ postings : "≥ 2 asientos, Σ = 0 por moneda"
  accounts ||--o{ postings : recibe
  accounts ||--o| budgets : "presupuesto mensual"
  accounts ||--o{ rules : "destino de regla"
  accounts {
    uuid id
    account_kind kind "asset | liability | income | expense | equity"
    char currency "ARS | USD"
  }
  postings {
    bigint amount "centavos; + débito / − crédito"
    char currency
  }
  transactions {
    date occurred_on
    text import_hash "único por usuario"
  }
```

- **Las categorías son cuentas** de tipo `income`/`expense`, como en contabilidad. Gastar $1.000 en el súper con la tarjeta es: `Supermercado +1000`, `Tarjeta −1000`.
- **Saldos** = suma de asientos. El patrimonio neto es la suma de activos y pasivos; los USD se valúan al tipo de cambio del mes elegido.
- **FKs compuestas** `(account_id, user_id, currency) → accounts(id, user_id, currency)`: la base impide usar una cuenta de otro usuario o asentar dólares en una cuenta en pesos.

### Row Level Security

Cada request de la app pasa por `withUser(userId, fn)`:

```sql
BEGIN;
SET LOCAL ROLE app_user;                          -- sin privilegios de dueño
SELECT set_config('app.user_id', $1, true);       -- local a la transacción
-- … queries de la app, sin WHERE user_id …
COMMIT;
```

Y las políticas hacen el resto:

```sql
CREATE POLICY tenant_isolation ON transactions
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());
```

Como la configuración es `LOCAL`, funciona con poolers en modo transacción (pgbouncer). Solo la autenticación y la carga de la demo usan el rol dueño (`asOwner`).

### Importación idempotente

```
huella = sha256(cuenta | fecha | monto | descripción normalizada | n° de ocurrencia)
```

El *n° de ocurrencia* distingue filas idénticas dentro del mismo archivo (dos cafés iguales el mismo día) sin romper la idempotencia: el mismo archivo siempre produce las mismas huellas. La inserción usa `ON CONFLICT (user_id, import_hash) DO NOTHING`. El CSV se parsea de nuevo en el servidor; nunca se confía en lo que calculó el navegador.

### Inflación y dólar

- **Pesos de hoy**: `monto × IPC(último) / IPC(mes)`. El IPC se publica con ~1 mes de rezago; los meses sin dato usan el último disponible (se aclara en la UI).
- **Dólares**: `monto / cotización promedio del mes` (oficial, MEP o blue).
- El presupuesto sugiere límites con el promedio de 3 meses **llevado a pesos de hoy**: con 2-3 % mensual, un promedio nominal subestima.

### Visualización

Paleta de un solo acento, validada para daltonismo y contraste en modo claro y oscuro. Gasto por categoría en barras horizontales (nunca tortas de 15 porciones), un solo eje Y por gráfico, tooltips en todos, leyenda cuando hay dos series o más.

## Seguridad

| Capa | Medida |
|---|---|
| Base | RLS en todas las tablas de usuario; rol `app_user` sin permisos de dueño; `audit_log` de solo lectura para la app |
| Integridad | Trigger diferido de balance; FKs compuestas; `CHECK` en montos, monedas y longitudes |
| Sesión | JWT HS256 en cookie `httpOnly`, `SameSite=Lax`, `Secure` en producción; verificación en el proxy y de nuevo contra la base |
| Login | Google OIDC con PKCE, `state` y `nonce`; `id_token` validado contra el JWKS de Google; sin open redirects |
| HTTP | CSP con nonce por request + `strict-dynamic`; HSTS; `X-Frame-Options: DENY`; `Permissions-Policy`; sin `X-Powered-By` |
| Entrada | zod en cada server action; SQL siempre parametrizado; `LIKE` con comodines escapados; límites de tamaño en importación |
| Abuso | Tope de demos por hora; las demos se borran a las 24 h |

`style-src` permite `'unsafe-inline'` porque Recharts y los componentes usan atributos `style`; los scripts siguen restringidos por nonce.

## Decisiones y límites conocidos

- **Autenticación**: login con **Google** (OIDC) para uso real. La demo y el "espacio sin cuenta" se atan al navegador con una cookie firmada.
- **Importación**: solo CSV y en cuentas en pesos. Excel y resúmenes en dólares quedan para la versión 2.
- **Categorías en pesos**: los gastos e ingresos se registran en ARS; los dólares se modelan como ahorro (compra/venta).

## Próximos pasos

- [ ] "Preguntale a tus finanzas": chat con IA que consulta con **transacciones de solo lectura** (`withUser(..., { readOnly: true, statementTimeoutMs })`, ya soportado) limitadas por RLS al usuario, como defensa real contra prompt injection
- [ ] Categorización con IA para lo que las reglas no cubren
- [ ] Passkeys (WebAuthn) como alternativa a Google
- [ ] Importación de Excel y de resúmenes de tarjeta en dólares

---

Datos de referencia: IPC — INDEC vía [apis.datos.gob.ar](https://apis.datos.gob.ar) (serie `148.3_INIVELNAL_DICI_M_26`). Dólar — [argentinadatos.com](https://argentinadatos.com). Los movimientos de la demo son sintéticos.
