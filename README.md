# Minuto 106

MVP viral de precisión: España vs. Argentina. El jugador elige selección, introduce un nick y trata de detener el reloj exactamente en **10,600 segundos**.

## Reglas

- 5 intentos por nick normalizado, sin registro obligatorio.
- Se permite volver a competir utilizando otro nick.
- El ranking conserva la mejor marca de cada nick y selección.
- La batalla global suma puntos según la cercanía al objetivo.
- El cronómetro se oculta tras 2 segundos.

## Ejecutar

Requiere Node.js 20 o posterior.

```bash
npm install
npm run dev
```

Abre `http://localhost:3000`.

## Validación

```bash
npm run check
```

## Persistencia

Los intentos se guardan en `data/attempts.json`. Este archivo está ignorado por Git y es apropiado para el MVP. Para producción con varias instancias, sustituir por Redis, PostgreSQL o una base de datos administrada.

## API

- `GET /api/stats`
- `GET /api/nicks/:nick`
- `POST /api/attempts`

Ejemplo de intento:

```json
{
  "nick": "Juanjo96",
  "team": "spain",
  "elapsedMs": 10643
}
```
