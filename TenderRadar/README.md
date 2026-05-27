# TenderRadar

> Módulo de **SICEP Intelligence** · por **Allison Cubillos** ([@allisoncubillos-bot](https://github.com/allisoncubillos-bot)).
>
> **Monitoreo y alertas automatizadas de convocatorias del Mercado Regulado (SICEP MEM):**
> detecta audiencias públicas y pliegos definitivos nuevos, agenda las audiencias en
> Google Calendar y analiza los pliegos con IA (API de Claude), notificando todo en Slack.

Dos automatizaciones independientes sobre la plataforma SICEP MEM
(`sicep.xm.com.co`) para el mercado regulado colombiano:

1. **Flujo SEMANAL — Audiencias** (`run_weekly.py`): revisa las audiencias
   públicas de la semana, agenda en Google Calendar, descarga el Excel de
   cantidades y notifica a Slack.
2. **Flujo DIARIO — Pliegos definitivos** (`run_daily.py`): detecta
   convocatorias **vigentes** con **pliegos definitivos** recién publicados,
   descarga el pliego (PDF) y el Excel, los **resume con Claude** (período,
   productos con cantidades en GWh/mes, modalidad, garantías, FNCER) y publica
   en un canal de Slack. Solo procesa las **nuevas** cada día.

Comparten el `.env`, el entorno virtual y varios módulos.

---

## Arquitectura

| Archivo | Rol |
|---|---|
| `run_weekly.py` | Orquestador del flujo semanal de audiencias |
| `run_daily.py` | Orquestador del flujo diario de pliegos |
| `config.py` | Carga y valida el `.env` (con `override=True`: el `.env` manda sobre variables del sistema) |
| `sicep_api.py` | Descarga las convocatorias (vía navegador) y filtros (semana / vigentes con pliegos) |
| `scraper.py` | Playwright: detalle, Meet/hora, descarga de Excel y pliego PDF |
| `pliego_analyzer.py` | Resume el pliego con la API de Claude (Anthropic) |
| `excel_reader.py` | Convierte el Excel de cantidades a texto para Claude |
| `calendar_client.py` | Crea eventos en Google Calendar (OAuth2) |
| `slack_client.py` | Mensajes a Slack (audiencias y pliegos) |
| `state.py` | Registro de convocatorias ya procesadas (flujo diario) |
| `setup_google_oauth.py` | Helper de una vez para el refresh token de Google |
| `run_weekly.bat` / `run_daily.bat` | Lanzadores para Windows Task Scheduler |

> **Nota técnica (SICEP):** la API de convocatorias exige token y un cuerpo
> cifrado, así que no se llama directamente. En su lugar abrimos el sitio con
> Playwright (el sitio pone su token y cifrado) y **leemos la respuesta JSON**,
> recorriendo todas las páginas. Las pestañas del expediente se habilitan a
> medida que avanza el proceso (la de audiencia puede no existir aún).

---

## 1. Instalación

Desde esta carpeta (`sicep_audiencias/`), en PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
playwright install chromium
```

> Si `Activate.ps1` da error de permisos: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

---

## 2. Configurar credenciales (`.env`)

```powershell
Copy-Item .env.example .env
notepad .env
```

| Variable | Para | Cómo obtenerla |
|---|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Calendar (semanal) | Google Cloud Console → OAuth, app de escritorio |
| `GOOGLE_REFRESH_TOKEN` | Calendar (semanal) | `python setup_google_oauth.py` (una vez) |
| `GOOGLE_CALENDAR_ID` | Calendar (semanal) | `primary` o el ID del calendario |
| `SLACK_WEBHOOK_URL` / `SLACK_CHANNEL` | Slack audiencias | Incoming Webhook del canal semanal |
| `SLACK_WEBHOOK_URL_PLIEGOS` / `SLACK_CHANNEL_PLIEGOS` | Slack pliegos | Incoming Webhook del canal diario |
| `ANTHROPIC_API_KEY` | Claude (pliegos) | <https://console.anthropic.com/settings/keys> (`sk-ant-...`) |
| `DOWNLOAD_FOLDER` | Excel de cantidades | carpeta local (def. `./descargas_sicep`) |
| `PLIEGOS_FOLDER` | Pliegos PDF | carpeta local (def. `./descargas_pliegos`) |
| `STATE_FILE` | Estado del flujo diario | JSON local (def. `./estado_pliegos.json`) |

### Google Calendar (OAuth2)
1. [Google Cloud Console](https://console.cloud.google.com/) → proyecto.
2. Habilita **Google Calendar API**.
3. Pantalla de consentimiento OAuth (agrega tu correo como usuario de prueba).
4. **Credenciales → ID de cliente OAuth → App de escritorio** → copia Client ID y Secret.
5. `python setup_google_oauth.py` → autoriza → copia `GOOGLE_REFRESH_TOKEN`.

### Slack (un webhook por canal)
1. <https://api.slack.com/apps> → **Create New App → From scratch**.
2. **Incoming Webhooks** → activar → *Add New Webhook to Workspace* → elige el canal.
3. Copia la URL `https://hooks.slack.com/services/...`.
4. Repite para el **segundo canal** (pliegos) → `SLACK_WEBHOOK_URL_PLIEGOS`.

### Anthropic (Claude)
1. <https://console.anthropic.com/settings/keys> → **Create Key**.
2. Cópiala completa en `ANTHROPIC_API_KEY` (es aparte de tu suscripción de claude.ai; requiere billing).

> ⚠️ Si tienes una variable de entorno del sistema `ANTHROPIC_API_KEY` antigua,
> el `.env` igual manda (config usa `load_dotenv(override=True)`).

---

## 3. Flujo SEMANAL — Audiencias

```powershell
python run_weekly.py
```

Pasos: descarga convocatorias → filtra audiencias de la semana (lun–dom, tz
Bogotá) → por cada una saca el link de Google Meet y la hora, descarga el Excel
→ crea el evento de 30 min en Calendar (sin duplicar) → envía el resumen a Slack.

---

## 4. Flujo DIARIO — Pliegos definitivos

```powershell
python run_daily.py
```

1. Descarga todas las convocatorias.
2. Filtra las **VIGENTES** (plazo de ofertas **no vencido**), Abiertas y con
   **pliegos definitivos** cargados.
3. Se queda con las **NUEVAS** (no procesadas antes; ver `estado_pliegos.json`).
4. Por cada nueva: descarga el pliego (PDF) y el Excel, y pide a Claude un
   resumen estructurado:
   - **Productos**: uno por línea, con **cantidad en GWh/mes** (Claude detecta la
     unidad real del Excel y convierte), **período** (formato mes/año) y **curva**.
   - **Modalidad**: PLC (Pague lo Contratado), PLG (Pague lo Contratado
     Condicionado / Pague lo Generado), PLD (Pague lo Demandado). Si es única para
     todos los productos, se muestra una sola vez.
   - **Precio base** (mes base de indexación).
   - **Garantías**: seriedad de la oferta, cumplimiento vendedor, cumplimiento
     comprador.
   - **FNCER**: si exige ofertas 100% renovable no convencional (general o por
     producto), lo marca con 🌱.
   - Incluye **fecha límite de ofertas**, **audiencia** y el **link a SICEP**.
5. Publica un mensaje por convocatoria en `SLACK_CHANNEL_PLIEGOS` y la marca como
   procesada. Si no hay nuevas, no hace nada.

> El registro `estado_pliegos.json` evita reprocesar/republicar. Para reprocesar
> todo desde cero, bórralo.

---

## 5. Programar en Windows Task Scheduler

Cada flujo tiene su `.bat`. En **PowerShell como Administrador**:

### Semanal (lunes 8:30 am)
```powershell
$cred = Get-Credential -UserName "$env:USERNAME" -Message "Contrasena de Windows"
$accion = New-ScheduledTaskAction -Execute "c:\Users\User\Documents\bia-file-compiler\sicep_audiencias\run_weekly.bat"
$disparador = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At "8:30am"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "SICEP Audiencias Semanal" -Action $accion -Trigger $disparador -Settings $settings -User $cred.UserName -Password $cred.GetNetworkCredential().Password -RunLevel Highest
```

### Diario (7:30 am)
```powershell
$cred = Get-Credential -UserName "$env:USERNAME" -Message "Contrasena de Windows"
$accion = New-ScheduledTaskAction -Execute "c:\Users\User\Documents\bia-file-compiler\sicep_audiencias\run_daily.bat"
$disparador = New-ScheduledTaskTrigger -Daily -At "7:30am"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "SICEP Pliegos Diario" -Action $accion -Trigger $disparador -Settings $settings -User $cred.UserName -Password $cred.GetNetworkCredential().Password -RunLevel Highest
```

- `-StartWhenAvailable`: si el PC estaba apagado a la hora, corre al encenderlo.
- `-WakeToRun`: lo despierta si está suspendido.
- Logs: `sicep_audiencias.log` y `sicep_pliegos.log`.

Probar sin esperar:
```powershell
Start-ScheduledTask -TaskName "SICEP Pliegos Diario"
Get-Content .\sicep_pliegos.log -Tail 20
```

---

## 6. Solución de problemas

| Síntoma | Causa / solución |
|--------|------------------|
| `Faltan variables de entorno` | Completa el `.env` (sección 2). |
| `playwright ... Executable doesn't exist` | Falta `playwright install chromium`. |
| `401 invalid x-api-key` | API key de Anthropic inválida/revocada, o variable de sistema vieja (config usa `override=True`, pero verifica la key del `.env`). |
| No encuentra el pliego/Excel | Los agentes nombran sus archivos distinto; el scraper toma el `.pdf` y el `.xlsx` visibles en la pestaña de pliegos. |
| `invalid_grant` en Google | El refresh token expiró; corre `setup_google_oauth.py`. |
| Cantidades en unidad equivocada | Claude detecta la unidad del Excel; si un pliego trae una estructura rara, revisa el Excel descargado. |

---

## Dependencias

`requests`, `playwright`, `google-api-python-client`, `google-auth`,
`google-auth-oauthlib`, `python-dotenv`, `tzdata`, `anthropic`, `openpyxl`
(ver `requirements.txt`). Modelo Claude: `claude-opus-4-7`.
