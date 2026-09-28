# Finanzas Personales

Una app simple para anotar **ingresos y egresos** y ver en qué se va la plata con **gráficos de colores**: cada categoría tiene su color, y el resumen muestra el mes y los últimos 12 meses.

Por dentro es más seria de lo que parece: **libro contable de doble entrada** en Postgres, montos en centavos enteros, **Row Level Security** por usuario, auditoría inmutable y login con **Google** (OpenID Connect con PKCE).

> La demo crea un espacio privado con 12 meses de movimientos **sintéticos** (los montos siguen el IPC real del INDEC) que se borra a las 24 horas.

## Qué hace

- **Resumen:** ingresos, egresos y balance del mes; barras de ingresos contra egresos de los últimos 12 meses; donas de colores con los egresos y los ingresos por categoría. Tocar una categoría lleva a sus movimientos.
- **Movimientos:** alta en segundos (tipo, monto, fecha, descripción y categoría), búsqueda, filtros por mes, tipo y categoría, cambio de categoría y borrado.
- **Categorías:** cada una con un color propio que se usa en todos los gráficos; se puede cambiar desde una paleta.
- **Seguridad y cuenta:** pruebas en vivo que intentan romper el aislamiento y la contabilidad contra la base, registro de auditoría y **eliminar mi cuenta**.
- **Acceso:** demo aislada, login con Google o espacio sin cuenta atado al navegador.

## Stack

- **Next.js 16** (App Router, Server Components, Server Actions, `proxy.ts`) + **TypeScript**
- **Tailwind CSS v4** + **shadcn/ui** (Base UI) + **Recharts**
- **Postgres**: [PGlite](https://pglite.dev) (Postgres real en WASM) para desarrollo sin configuración; **postgres.js** en producción (Neon)
- SQL escrito a mano (sin ORM): el esquema, las políticas RLS y los triggers quedan a la vista
- **jose** (sesión y verificación del `id_token`), **zod** (validación), **Vitest** (tests)

## Correr localmente

```bash
npm install
npm run dev          # http://localhost:3000
```

No hace falta instalar Postgres: sin `DATABASE_URL` la app levanta PGlite en `.data/pglite` y corre las migraciones. En `/login`, **Entrar a la demo** genera un usuario aislado con 12 meses de datos.

```bash
npm test             # unitarios + integración contra Postgres (PGlite en memoria)
npm run lint
npm run typecheck
npm run db:reset     # borra la base local (con el servidor apagado)
```

Los tests de integración también corren contra un Postgres real:

```bash
DATABASE_URL=postgres://usuario:clave@localhost:5432/finanzas npx vitest run src/db
```

## Deploy en Vercel + Neon

1. Creá una base en [Neon](https://neon.tech) (plan gratuito), por ejemplo desde **Vercel → Storage**, con el prefijo de variables `DATABASE` para que quede `DATABASE_URL`.
2. Definí `SESSION_SECRET` en Vercel (`openssl rand -hex 32`).
3. Deploy y verificá la configuración en **`/api/health`**: informa si están `DATABASE_URL` y `SESSION_SECRET`, si la base conecta y migra y si funciona el rol de RLS, sin exponer secretos.

La primera request corre las migraciones (con `pg_advisory_xact_lock`, seguro ante instancias concurrentes). La migración crea el rol `app_user` y se lo otorga al rol de conexión, que es lo que Neon necesita para hacer `SET ROLE`. Probado contra Postgres 16 con un dueño **no superusuario** con `CREATEROLE`, el mismo modelo de permisos de Neon.

### Login con Google (opcional)

1. En [Google Cloud Console](https://console.cloud.google.com/auth/overview): configurá la pantalla de consentimiento (tipo *Externo*).
2. **Clients → Create client → Web application**, con estas URIs de redireccionamiento:
   - `https://TU-DOMINIO/api/auth/google/callback`
   - `http://localhost:3000/api/auth/google/callback` (desarrollo)
3. Para publicar la app, en **Branding** cargá la página de inicio, la política de privacidad (`https://TU-DOMINIO/privacidad`) y el dominio autorizado. Sin logo no hace falta verificación.
4. Cargá `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` en Vercel y volvé a desplegar. Sin esas variables el botón no se muestra.

El flujo es OpenID Connect con Authorization Code + **PKCE** (S256), `state` y `nonce` en una cookie `httpOnly` de 10 minutos. El `id_token` se valida contra las claves públicas de Google (firma RS256, issuer, audience, vencimiento, nonce y `email_verified`). El usuario se identifica por el `sub` de Google, no por el email, y la redirección posterior solo acepta rutas internas. Los navegadores integrados en editores (por ejemplo, el de VS Code) pueden cortar el flujo: usá un navegador normal.

## Arquitectura

```
src/
├── proxy.ts                  # CSP con nonce + redirección si no hay sesión
├── db/
│   ├── migrations/           # esquema, RLS, triggers, permisos, colores de categoría
│   ├── client.ts             # driver PGlite/postgres.js, migraciones, withUser()
│   └── seed.ts               # categorías por defecto + demo sintética
├── lib/
│   ├── ledger.ts             # construcción y validación de asientos
│   ├── money.ts              # parseo y formato de montos (centavos)
│   ├── colors.ts             # paleta de categorías
│   ├── google-oauth.ts       # OIDC: PKCE, state, nonce, verificación del id_token
│   └── reports.ts            # reportes (ninguna query filtra por user_id: lo hace RLS)
└── app/
    ├── login/ · privacidad/  # públicas
    ├── api/                  # login con Google y /api/health
    └── (app)/                # resumen, movimientos, categorías, seguridad y cuenta
```

### Modelo de datos

```mermaid
erDiagram
  users ||--o{ accounts : tiene
  users ||--o{ transactions : tiene
  transactions ||--|{ postings : "2 asientos, suman 0"
  accounts ||--o{ postings : recibe
  accounts {
    uuid id
    account_kind kind "income | expense | asset"
    text color "color de la categoría"
  }
  postings {
    bigint amount "centavos; + débito / − crédito"
  }
  transactions {
    date occurred_on
    text description
  }
```

- **Las categorías son cuentas** de ingreso o egreso, como en contabilidad. Gastar $1.000 en el súper es: `Supermercado +1000`, `Mi dinero −1000`. La cuenta "Mi dinero" es invisible para el usuario.
- **Un trigger de constraint diferido** valida al `COMMIT` que cada transacción sume 0: la base rechaza un asiento desbalanceado aunque el código falle.
- **FKs compuestas** `(account_id, user_id, currency) → accounts` impiden usar una categoría de otro usuario.

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

### Visualización

Ingresos en verde agua y egresos en naranja: un par validado para que se distinga también con daltonismo, en modo claro y oscuro. Las categorías usan una paleta categórica validada de 8 colores más un gris para "Otros". El color sigue a la categoría (se guarda en la base), no a su posición en el gráfico. Las donas muestran las 6 categorías más grandes y agrupan el resto, siempre con leyenda, montos y porcentajes para que el color nunca sea la única pista.

## Seguridad

| Capa | Medida |
|---|---|
| Base | RLS en todas las tablas de usuario; rol `app_user` sin permisos de dueño; `audit_log` de solo lectura para la app |
| Integridad | Trigger diferido de balance; FKs compuestas; `CHECK` en montos, colores y longitudes |
| Sesión | JWT HS256 en cookie `httpOnly`, `SameSite=Lax`, `Secure` en producción; verificación en el proxy y de nuevo contra la base |
| Login | Google OIDC con PKCE, `state` y `nonce`; `id_token` validado contra el JWKS de Google; sin open redirects |
| HTTP | CSP con nonce por request + `strict-dynamic`; HSTS; `X-Frame-Options: DENY`; `Permissions-Policy`; sin `X-Powered-By` |
| Entrada | zod en cada server action; SQL siempre parametrizado; `LIKE` con comodines escapados |
| Privacidad | Política en `/privacidad`; "Eliminar mi cuenta" borra en cascada todos los datos del usuario |
| Abuso | Tope de demos por hora; las demos se borran a las 24 h |

`style-src` permite `'unsafe-inline'` porque Recharts y los componentes usan atributos `style`; los scripts siguen restringidos por nonce.

## Próximos pasos

- [ ] "Preguntale a tus finanzas": chat con IA que consulta con transacciones de solo lectura (`withUser(..., { readOnly: true })`, ya soportado) limitadas por RLS al usuario
- [ ] Exportar movimientos a CSV
- [ ] Passkeys (WebAuthn) como alternativa a Google

---

Los movimientos de la demo son sintéticos; sus montos se escalan con el IPC del INDEC ([apis.datos.gob.ar](https://apis.datos.gob.ar)).
