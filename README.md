# Minuto 106

Juego viral de precisión España vs. Argentina. El jugador elige selección, introduce un nick y trata de detener el reloj exactamente en **10,600 segundos**.

## Reglas

- 5 intentos por nick normalizado.
- Se permite volver a competir con otro nick.
- El ranking conserva la mejor marca verificada de cada nick y selección.
- El cronómetro se oculta tras 2 segundos.
- Los intentos sospechosos no puntúan ni aparecen en el ranking.

## Arquitectura

```text
GitHub Pages (HTML/CSS/JS)
          │
          ▼
Supabase Edge Function: game-api
          │ service role, solo en servidor
          ▼
PostgreSQL con RLS y RPC atómicas
```

El navegador no contiene claves secretas ni escribe directamente en PostgreSQL. La Edge Function crea un desafío antes de cada partida, registra su hora en el servidor y valida el tiempo real transcurrido al finalizar.

## Seguridad anti-trampas

La puntuación precisa se mide con `performance.now()` para no sumar la latencia de red, pero el servidor no confía ciegamente en ella:

1. Emite un `challengeId` de un solo uso.
2. Comprueba que realmente hayan transcurrido unos 10,6 segundos.
3. Rechaza desafíos caducados, reutilizados o terminados desde otro dispositivo.
4. Aplica los 5 intentos por nick dentro de una transacción con bloqueo.
5. Limita ráfagas por dispositivo e IP.
6. Excluye patrones repetidos casi perfectos.
7. Admite Cloudflare Turnstile opcional.

No existe una protección perfecta en un juego ejecutado en un navegador: un bot puede esperar 10,6 segundos reales. Esta arquitectura impide falsificar un resultado instantáneo, escribir directamente en la base de datos, reutilizar retos o extraer credenciales.

## Desarrollo local

Requiere Node.js 20 o posterior.

```bash
npm run dev
```

Abre `http://localhost:3000`. Para usar Supabase localmente, cambia temporalmente `public/config.js` y coloca únicamente la URL pública de la Edge Function. Nunca pongas allí `service_role`, secret keys, access tokens ni contraseñas.

## Configuración de GitHub Actions

En **Settings → Secrets and variables → Actions** configura:

### Variables públicas

| Nombre | Valor |
|---|---|
| `SUPABASE_PROJECT_ID` | Project ref de Supabase |
| `SUPABASE_FUNCTIONS_URL` | `https://PROJECT_REF.supabase.co/functions/v1/game-api` |
| `ALLOWED_ORIGINS` | `https://juanjogondev.github.io,http://localhost:3000` |
| `TURNSTILE_SITE_KEY` | Clave pública opcional de Turnstile |

### Secrets

| Nombre | Uso |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | Despliegue mediante Supabase CLI |
| `SUPABASE_DB_PASSWORD` | Aplicar migraciones |
| `HASH_PEPPER` | Anonimizar IP y dispositivo |
| `TURNSTILE_SECRET_KEY` | Clave privada opcional de Turnstile |

Genera el pepper con:

```bash
openssl rand -hex 32
```

## Despliegue

Al hacer push o merge a `main`:

- `pages.yml` genera la configuración pública y despliega `public/` en GitHub Pages.
- `supabase.yml` aplica migraciones y despliega la Edge Function cuando cambia `supabase/**`.
- `ci.yml` valida JavaScript y busca credenciales privadas expuestas accidentalmente en `public/`.

En **Settings → Pages → Build and deployment**, selecciona **GitHub Actions** como fuente. Para GitHub Pages público, el repositorio deberá ser público o usar un plan que permita Pages en repositorios privados.

## Protección de datos

Las tablas `game_challenges` y `game_attempts` tienen RLS activado, no tienen políticas públicas y revocan el acceso a `anon` y `authenticated`. La Edge Function almacena hashes con pepper, no IP ni identificadores de dispositivo en texto claro.

## Validación

```bash
npm run check
```

Para ejecutar Supabase localmente:

```bash
supabase start
supabase functions serve game-api --no-verify-jwt
```
