# Migración de TenderRadar (SICEP) a Mac

> Este documento está escrito para dos lectores a la vez: **Allison**, siguiéndolo
> a mano, y **Claude Code corriendo en el Mac**, ejecutándolo de punta a punta.
> Si eres Claude Code leyendo esto: no pidas confirmación paso por paso, ejecuta
> la sección 1-6 en orden, y si algo falla, diagnostica con la sección 8 antes
> de preguntar. Todo lo que toca API keys reales queda en `.env`, nunca lo
> imprimas completo en la conversación.

## 0. Qué es esto

`TenderRadar` es un bot Python que corre dos flujos sobre SICEP MEM
(`sicep.xm.com.co`, convocatorias de compra de energía del mercado regulado
colombiano):

- **Diario (L-V)**: detecta pliegos definitivos nuevos, los resume con la API
  de Claude y publica en Slack.
- **Semanal (lunes)**: detecta audiencias públicas de la semana, agenda cada
  una en Google Calendar (evento de 30 min con el link de Meet) y notifica en
  Slack.

Hoy corre en Windows vía **Task Scheduler**. En Mac el equivalente nativo es
**launchd** (no cron — launchd sí puede reintentar/recuperar ejecuciones
perdidas cuando el equipo estuvo dormido, cron no).

**Cambio de comportamiento pedido para el Mac**: además del horario fijo,
ambos flujos deben correr **cada vez que se inicia sesión** (no solo lunes /
no solo a las 9am). Esto es seguro porque el código ya es idempotente:
`estado_pliegos.json` evita reprocesar pliegos ya publicados, y
`calendar_client.py::event_exists()` evita duplicar eventos de calendario. Por
eso la configuración de abajo combina `RunAtLoad` (corre al iniciar sesión) +
`StartCalendarInterval` (corre también al horario fijo, por si un día no
reinicia sesión) — correr de más no rompe nada, solo no reprocesa nada nuevo.

## 1. Clonar el repo

```bash
git clone https://github.com/allisoncubillos-bot/sicep-intelligence.git
cd sicep-intelligence/TenderRadar
```

## 2. Python + navegador de Playwright

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium
```

Si `playwright install` falla pidiendo dependencias del sistema, correr
`playwright install-deps` no aplica en macOS (eso es solo Linux) — en Mac
`playwright install chromium` basta.

## 3. Credenciales (`.env`)

**No están en git** (por diseño, `.gitignore` las excluye). Tienes dos
opciones:

- **Si migraste el PC completo por OneDrive**: el `.env` real ya debería estar
  en `~/Documents/bia-file-compiler/sicep_audiencias/.env` (ubicación vieja) —
  cópialo a esta carpeta nueva: `cp ~/Documents/bia-file-compiler/sicep_audiencias/.env .env`
  y también el estado: `cp ~/Documents/bia-file-compiler/sicep_audiencias/estado_pliegos.json estado_pliegos.json`
  (evita que el flujo diario re-publique en Slack pliegos ya notificados desde
  Windows).
- **Si no tienes el `.env` a mano**: `cp .env.example .env` y llena cada
  variable siguiendo `TenderRadar/README.md` sección 2 (Google Cloud Console
  para Calendar OAuth, Slack Incoming Webhooks, Anthropic API key). El
  `GOOGLE_REFRESH_TOKEN` es de larga duración — con `setup_google_oauth.py`
  se genera una sola vez y sigue funcionando igual en cualquier máquina.

Verificación rápida sin secretos en pantalla:
```bash
python3 -c "from config import load_config; c = load_config(); print('OK' if c.anthropic_api_key and c.google_refresh_token and c.slack_webhook_url else 'FALTAN VARIABLES')"
```

## 4. Dar permisos de ejecución a los lanzadores

```bash
chmod +x run_daily.sh run_weekly.sh
```

## 5. Instalar los launchd agents

Los `.plist` de esta carpeta (`com.allisoncubillos.sicep.daily.plist` y
`com.allisoncubillos.sicep.weekly.plist`) tienen un placeholder
`REEMPLAZA-CON-RUTA-ABSOLUTA` que hay que sustituir por la ruta real absoluta
de `TenderRadar/` en este Mac (ej. `/Users/allisoncubillos/sicep-intelligence/TenderRadar`).

```bash
RUTA_ABSOLUTA="$(pwd)"   # corriendo esto desde dentro de TenderRadar/
sed "s|REEMPLAZA-CON-RUTA-ABSOLUTA|$RUTA_ABSOLUTA|g" com.allisoncubillos.sicep.daily.plist > /tmp/daily.plist
sed "s|REEMPLAZA-CON-RUTA-ABSOLUTA|$RUTA_ABSOLUTA|g" com.allisoncubillos.sicep.weekly.plist > /tmp/weekly.plist
cp /tmp/daily.plist ~/Library/LaunchAgents/com.allisoncubillos.sicep.daily.plist
cp /tmp/weekly.plist ~/Library/LaunchAgents/com.allisoncubillos.sicep.weekly.plist

launchctl load -w ~/Library/LaunchAgents/com.allisoncubillos.sicep.daily.plist
launchctl load -w ~/Library/LaunchAgents/com.allisoncubillos.sicep.weekly.plist
```

`RunAtLoad` en el plist hace que el `load` de arriba **dispare una corrida de
inmediato** — es normal y es la prueba de humo del paso 6.

## 6. Verificar que corrió

```bash
tail -n 30 sicep_pliegos.log
tail -n 30 sicep_audiencias.log
```

Si ves `Faltan variables de entorno` → revisar paso 3. Si ves un error de
Playwright → revisar paso 2. Si todo está en orden y no hay convocatorias
nuevas, los logs pueden estar casi vacíos — no es un error, no hace nada
cuando no hay novedades (ver `TenderRadar/README.md` secciones 3 y 4).

Para forzar una corrida sin esperar al próximo login/horario:
```bash
launchctl start com.allisoncubillos.sicep.daily
launchctl start com.allisoncubillos.sicep.weekly
```

## 7. Que el Mac esté despierto a la hora fija

`RunAtLoad` cubre "cada inicio de sesión", pero si un lunes no reinicias
sesión y el Mac está dormido a las 8:30am, se lo pierde igual que cron. Para
que despierte solo a esa hora (equivalente al `-WakeToRun` de Windows):

```bash
sudo pmset repeat wakeorpoweron MTWRF 08:55:00
```

Esto lo despierta 5 min antes de la corrida diaria de 9am (Lu-Vi), que
también cubre el lunes semanal de 8:30 si el `pmset` se ajusta a esa hora en
vez de 8:55 — o se programan dos wake times si `pmset` lo permite en esta
versión de macOS (`pmset -g sched` para ver los programados).

## 8. Solución de problemas específicos de Mac

| Síntoma | Causa / solución |
|---|---|
| El agent no corre nunca, ni con `launchctl start` | Revisar `launchctl list \| grep sicep` — si no aparece, el `load` falló (típicamente XML mal formado en el `.plist` tras el `sed`, o ruta con espacios sin escapar). |
| `Operation not permitted` al ejecutar Playwright | Primera vez que Chromium headless corre puede pedir permiso en Ajustes del Sistema → Privacidad y Seguridad → Automatización/Accesibilidad. Dar permiso a Terminal o a la app que lanza el proceso. |
| Los logs no se actualizan pero `launchctl list` muestra el job | Revisar que `StandardOutPath`/`StandardErrorPath` en el `.plist` apunten a la ruta absoluta correcta (no al placeholder sin reemplazar). |
| `invalid_grant` en Google Calendar | El refresh token expiró o se revocó — correr `python3 setup_google_oauth.py` de nuevo (needs `GOOGLE_CLIENT_ID`/`SECRET` en `.env`). No es un problema de Mac vs Windows, pasa en cualquier máquina. |
| Quiero desinstalar/pausar | `launchctl unload ~/Library/LaunchAgents/com.allisoncubillos.sicep.daily.plist` (y el weekly). Sin borrar el `.plist` de `~/Library/LaunchAgents/`, sigue registrado para la próxima sesión. |

## 9. Pendiente al terminar la migración

- Confirmar 1 corrida diaria y 1 semanal exitosas en el Mac antes de dar de
  baja las tareas de Windows Task Scheduler ("SICEP Pliegos Dias Habiles" /
  "SICEP Audiencias Semanal").
- Una vez confirmado, la carpeta vieja `~/Documents/bia-file-compiler/sicep_audiencias`
  (en el PC de Windows) queda solo como respaldo — se puede borrar cuando ya
  no se necesite ese PC.
