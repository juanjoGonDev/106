# Minuto 106

Juego de precisión España vs. Argentina. El jugador elige selección, introduce un nick y trata de detener el reloj exactamente en **10,600 segundos**.

## Reglas

- Cada nick dispone de 5 intentos base en la competición global.
- Cada miniliga concede otros 5 intentos independientes por participante.
- Un tiempo pertenece a un único contexto: global o una miniliga concreta.
- Los intentos de miniliga no consumen intentos globales, no suman puntos a España o Argentina y no entran en el ranking, premios, perfiles o duelos globales.
- El ranking global conserva la mejor marca global verificada de cada nick y selección.
- Cada miniliga conserva exclusivamente las marcas generadas desde su enlace de competición.
- Los referidos válidos conceden intentos globales adicionales.
- Los intentos sospechosos se conservan para auditoría, pero no puntúan.
- El cronómetro numérico desaparece completamente después de 2 segundos.

## Puntuación global

La puntuación por selecciones usa una escala contenida para mantener los marcadores legibles durante periodos prolongados:

- Máximo de 100 puntos por jugador y selección.
- La puntuación disminuye aproximadamente 1 punto por cada 10 ms de diferencia.
- Siempre se concede un mínimo de 1 punto a una mejor marca global verificada.
- Solo cuenta la mejor marca global de cada nick para cada selección.

Los contadores grandes se muestran de forma compacta en la interfaz: `1.2k`, `1M`, `1.2M`, etc. El valor completo permanece disponible como texto auxiliar.

## Arquitectura

```text
GitHub Pages
      │
      ▼
Supabase Edge Function: game-api
      │ service role, solo en servidor
      ▼
PostgreSQL + RLS + RPC atómicas
```

El navegador no contiene secretos ni escribe directamente en PostgreSQL. Los tiempos, jugadores, perfiles, bonus, referencias y membresías se almacenan en tablas persistentes de Supabase.

El servidor crea cada desafío con su contexto de competición. Al terminar, `finish` utiliza el `league_id` ya asociado al desafío; el navegador no puede convertir posteriormente un tiempo de liga en global ni moverlo entre ligas.

Los perfiles públicos del ranking se muestran mediante un overlay HTML controlado por la aplicación, no mediante un diálogo modal nativo. Los campos de búsqueda y comparación se marcan como datos no credenciales para no interferir con los menús inline de gestores de contraseñas.

## Miniligas

La gestión de miniligas se concentra en `ligas.html`:

- Crear una miniliga.
- Unirse mediante código.
- Consultar todas las ligas del nick autenticado.
- Ver posición, mejor marca, intentos utilizados y tiempo restante.
- Abrir el juego dentro de una liga concreta.
- Compartir la invitación.

El enlace de competición usa `?league=ABC123`. Antes de crear un desafío, el backend comprueba que:

1. La liga existe.
2. No ha finalizado.
3. El nick pertenece a esa liga.
4. Quedan intentos dentro del presupuesto independiente de 5.

## Toolchain fijado

El proyecto usa exclusivamente:

- Node.js `22.13.0`.
- pnpm `11.15.1`.
- `pnpm-lock.yaml` como único lockfile.
- Volta para seleccionar automáticamente las versiones locales declaradas en `package.json`.

El soporte de pnpm en Volta requiere habilitar su feature flag. En macOS o Linux:

```bash
export VOLTA_FEATURE_PNPM=1
volta install node@22.13.0 pnpm@11.15.1
```

En PowerShell:

```powershell
$env:VOLTA_FEATURE_PNPM = "1"
volta install node@22.13.0 pnpm@11.15.1
```

Para mantener la variable en futuras sesiones de Windows, ejecútalo y abre una terminal nueva:

```powershell
[Environment]::SetEnvironmentVariable("VOLTA_FEATURE_PNPM", "1", "User")
```

Al entrar en el repositorio, Volta utiliza las versiones fijadas en el bloque `volta` de `package.json`. `packageManager` y `engines` contienen las mismas versiones para que pnpm y CI también las validen.

## Desarrollo local

Requiere Volta, Docker y Supabase CLI. Desde la raíz del repositorio:

```bash
pnpm install --frozen-lockfile
pnpm supabase:setup
supabase functions serve game-api --no-verify-jwt --env-file supabase/functions/.env.local
node --env-file=.env.local scripts/generate-config.mjs
pnpm dev
```

Abre `http://localhost:3000`.

Genera `HASH_PEPPER` en Windows, macOS o Linux sin depender de OpenSSL:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Gestión local de Supabase

```bash
pnpm supabase:start
pnpm supabase:status
pnpm supabase:migrate
pnpm supabase:setup
pnpm supabase:stop
```

#### `pnpm supabase:setup`

- Arranca Supabase local cuando sea necesario.
- Ejecuta `supabase db reset --local`.
- Recrea exclusivamente la base local.
- Vuelve a aplicar todas las migraciones desde cero.
- **Elimina los datos locales existentes.**

Úsalo para una instalación inicial, para verificar que todo el esquema puede reconstruirse o cuando los datos locales no deban conservarse.

#### `pnpm supabase:migrate`

- Arranca Supabase local cuando sea necesario.
- Ejecuta primero un `dry-run` local.
- Aplica únicamente las migraciones pendientes mediante `supabase db push --local`.
- Conserva tablas, intentos y demás datos locales existentes.

Es el comando normal después de descargar nuevas migraciones durante el desarrollo diario.

`supabase:setup` y `supabase:migrate` están encapsulados con `--local`. No sustituyas esos comandos por una conexión enlazada ni ejecutes `db reset` contra producción.

### Comandos habituales

```bash
pnpm dev
pnpm check
pnpm test
pnpm test:security
pnpm test:supabase
pnpm lint
pnpm knip
pnpm audit --audit-level=high
pnpm supabase:migrate
```

### Actualizar dependencias

Las dependencias directas deben usar versiones exactas, sin `^`, `~`, tags, URLs ni alias. Para añadirlas:

```bash
pnpm add --save-exact nombre-paquete@1.2.3
pnpm add --save-exact --save-dev nombre-paquete@1.2.3
```

Después se debe revisar y confirmar el cambio de `pnpm-lock.yaml`:

```bash
pnpm install --lockfile-only
pnpm check:package-policy
pnpm install --frozen-lockfile
pnpm check
```

No se autorizan scripts de instalación de dependencias. `allowBuilds` está vacío y `strictDepBuilds` hace fallar la instalación si un paquete intenta ejecutar un build no aprobado. Cualquier excepción requiere auditar el paquete y su versión, documentar el motivo y añadir una autorización mínima en `pnpm-workspace.yaml`.

La política también aplica:

- Lockfile obligatorio y congelado en CI.
- Dependencias con menos de 7 días bloqueadas por defecto.
- Protección contra degradaciones de integridad del paquete.
- Subdependencias procedentes de fuentes exóticas bloqueadas.
- Peer dependencies estrictas y sin instalación automática.
- Caché exclusiva del store de pnpm; no se restaura `node_modules`.
- `package-lock.json`, `yarn.lock`, Bun y scripts lifecycle del proyecto rechazados automáticamente.

## Variables y secretos de GitHub Actions

En **Settings → Secrets and variables → Actions** configura:

### Variables públicas

| Nombre | Valor |
|---|---|
| `SUPABASE_PROJECT_ID` | Project ref de Supabase |
| `SUPABASE_FUNCTIONS_URL` | `https://PROJECT_REF.supabase.co/functions/v1/game-api` |
| `ALLOWED_ORIGINS` | `https://juanjogondev.github.io,http://localhost:3000` |
| `TURNSTILE_SITE_KEY` | Clave pública opcional de Turnstile |
| `PUBLIC_SITE_URL` | URL pública canónica del juego |
| `GOOGLE_ANALYTICS_ID` | Identificador de Google Analytics; se mantiene vacío mientras el servicio no esté activo |
| `ADSENSE_CLIENT` | Identificador de Google AdSense; se mantiene vacío mientras la publicidad no esté activa |

### Secrets

| Nombre | Uso |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | Autenticación de Supabase CLI |
| `SUPABASE_DB_PASSWORD` | Aplicación de migraciones mediante Supabase CLI |
| `SUPABASE_DB_URL` | Conexión PostgreSQL completa para snapshots y verificaciones |
| `HASH_PEPPER` | Hash irreversible de IP y dispositivo |
| `TURNSTILE_SECRET_KEY` | Clave privada de Turnstile cuando la verificación está activa |

Obtén `SUPABASE_DB_URL` en Supabase Dashboard → **Connect** usando la URI **Session pooler** en el puerto `5432`. Debe ser una cadena PostgreSQL apta para `psql`. Guárdala únicamente como secret.

## Persistencia entre despliegues

Los despliegues **no recrean la base de datos**. El workflow de producción usa `supabase db push`, que aplica únicamente migraciones pendientes registradas en `supabase_migrations.schema_migrations`.

Nunca se ejecutan en producción:

```bash
supabase db reset
supabase stop --no-backup
```

El workflow `.github/workflows/supabase.yml` solo se inicia cuando cambian migraciones, Edge Functions, la configuración de Supabase o los scripts que intervienen en ese despliegue. Realiza estas fases en orden:

1. Bloquea despliegues simultáneos mediante `concurrency`.
2. Analiza las migraciones nuevas y rechaza operaciones destructivas.
3. Ejecuta `supabase db push --dry-run`.
4. Captura contadores de histórico antes del despliegue cuando la conexión de snapshots está disponible.
5. Registra una referencia previa en `game_deployment_snapshots` cuando la tabla ya existe.
6. Aplica únicamente migraciones incrementales.
7. Despliega la Edge Function.
8. Captura los contadores posteriores cuando la conexión de snapshots está disponible.
9. Falla si disminuyen intentos, jugadores, referencias, bonus, retos, ligas o membresías.
10. Registra el commit, workflow run, versión de migración y estadísticas posteriores.
11. Publica un artefacto no sensible con los contadores durante 90 días.

### Datos protegidos por la verificación

Los siguientes contadores se consideran monotónicos y no pueden disminuir durante un despliegue normal:

- Intentos totales y verificados, con independencia de su contexto.
- Jugadores.
- Referencias creadas y completadas.
- Intentos bonus concedidos.
- Retos y retos completados.
- Miniligas y sus miembros.

La tabla `game_deployment_snapshots` permite relacionar el histórico con:

- Commit desplegado.
- ID de ejecución de GitHub Actions.
- Fase previa o posterior.
- Versión de migración.
- Contadores agregados.
- Fecha del despliegue.

Consulta de auditoría:

```sql
select *
from public.game_deployment_snapshots
order by created_at desc;
```

## Política de migraciones

Todas las evoluciones del esquema deben ser aditivas y compatibles con datos existentes:

- Añadir tablas con `create table if not exists`.
- Añadir columnas como nullable o con un default seguro.
- Rellenar datos antiguos antes de imponer `not null`.
- Crear nuevos índices sin borrar los anteriores hasta verificar producción.
- Mantener funciones y contratos antiguos durante una transición.
- Separar cambios complejos en expand → backfill → switch → contract.

El guard rechaza automáticamente:

- `DROP TABLE`.
- `DROP SCHEMA`.
- `TRUNCATE`.
- `DELETE FROM`.
- Eliminación de columnas o constraints.
- `DROP FUNCTION`.
- `DROP TYPE`.

Una operación destructiva deliberada requiere revisión manual y esta marca dentro de la migración:

```sql
-- production-data-loss-approved: MOTIVO_O_TICKET
```

La marca no hace segura la operación; solo evita que el guard la bloquee después de una revisión explícita.

## Backups y recuperación

La protección del workflow detecta regresiones, pero no sustituye una copia de seguridad real. Activa en Supabase:

- Backups diarios administrados.
- Point-in-Time Recovery cuando el plan lo permita.
- Retención adecuada antes de lanzar tráfico público.

No se exporta la base completa a artefactos de GitHub porque contendría información operacional y aumentaría la superficie de exposición.

Ante una regresión:

1. Detén nuevos despliegues.
2. Conserva el workflow run y sus snapshots.
3. Revisa el commit y la migración aplicada.
4. Consulta `game_deployment_snapshots`.
5. Restaura desde Supabase Backup/PITR si hubo pérdida real.
6. Crea una migración correctiva; no edites una migración ya aplicada.

## Despliegue

Al hacer push o merge a `main`:

- `pages.yml` genera la configuración pública y despliega GitHub Pages.
- `supabase.yml` protege el histórico, aplica migraciones y despliega `game-api` cuando cambia el backend.
- `ci.yml` instala desde `pnpm-lock.yaml`, valida la política de paquetes, ejecuta análisis estático, tests y una instancia local completa de Supabase.

En **Settings → Pages → Build and deployment**, selecciona **GitHub Actions** como fuente.

## Seguridad anti-trampas

Antes de iniciar cada intento, el navegador presenta un reto visual de balones dibujado en canvas y exige completarlo mediante puntero en el orden mostrado. La parada final también se realiza únicamente mediante puntero sobre un control efímero dibujado en canvas. El servidor valida un desafío de un solo uso, tiempo real transcurrido, dispositivo, IP, interacción, contexto de competición, límites y patrones sospechosos. Cuando Turnstile está configurado, su token se valida además en la Edge Function.

El canvas evita selectores DOM estables, pero no convierte el navegador en un entorno secreto. Un atacante con control total del cliente puede observar red y JavaScript; por ello la seguridad efectiva depende de la validación de servidor, el consumo único, los límites, la telemetría y Turnstile.