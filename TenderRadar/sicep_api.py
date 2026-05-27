"""Paso 1: obtención y filtrado de convocatorias desde SICEP.

La API (`announcement-publish/announcements-publish`) exige un token y un
cuerpo CIFRADO que genera el propio sitio web, así que no se puede llamar
directamente. En cambio, abrimos la página pública con Playwright (el sitio
pone su token y cifrado) y leemos la RESPUESTA, que llega en JSON limpio.
Recorremos todas las páginas con el botón "siguiente".
"""
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from playwright.sync_api import sync_playwright

log = logging.getLogger(__name__)

BOGOTA_TZ = ZoneInfo("America/Bogota")
LISTING_URL = "https://sicep.xm.com.co/public-announcements"
API_MARKER = "announcements-publish"  # subcadena que identifica la respuesta
NEXT_BUTTON = ".p-paginator-next"
HEARING_DATE_FMT = "%d/%m/%Y"
NAV_TIMEOUT_MS = 60_000
RESP_TIMEOUT_MS = 20_000
MAX_PAGES = 200  # tope de seguridad para no quedar en bucle infinito


def get_week_bounds(reference: datetime | None = None) -> tuple[datetime, datetime]:
    """Devuelve (lunes 00:00, domingo 23:59:59) de la semana de `reference`."""
    now = reference or datetime.now(BOGOTA_TZ)
    monday = (now - timedelta(days=now.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    sunday = monday + timedelta(days=7) - timedelta(microseconds=1)
    return monday, sunday


def fetch_all_announcements(headless: bool = True) -> list[dict]:
    """Abre el listado de SICEP y recoge todas las convocatorias paginando."""
    collected: dict[str, dict] = {}  # por announcementeId, evita duplicados
    total_records: int | None = None

    def absorb_response(response) -> None:
        nonlocal total_records
        if API_MARKER not in response.url.lower():
            return
        try:
            value = response.json().get("value", {})
        except Exception:  # noqa: BLE001 - respuestas no-JSON (assets, etc.)
            return
        if total_records is None:
            total_records = value.get("totalRecords")
            log.info("Total de convocatorias reportadas por SICEP: %s", total_records)
        for ann in value.get("announcements", []):
            aid = ann.get("announcementeId")
            if aid:
                collected[aid] = ann

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=headless)
        page = browser.new_context().new_page()
        page.on("response", absorb_response)

        page.goto(LISTING_URL, wait_until="networkidle", timeout=NAV_TIMEOUT_MS)
        page.wait_for_timeout(3_000)  # deja llegar la primera respuesta

        next_btn = page.locator(NEXT_BUTTON).first
        for page_num in range(2, MAX_PAGES + 1):
            # Cortamos cuando ya tenemos todos los registros.
            if total_records is not None and len(collected) >= total_records:
                break
            # PrimeNG marca el botón como deshabilitado en la última página.
            classes = (next_btn.get_attribute("class") or "")
            if "p-disabled" in classes:
                break
            try:
                with page.expect_response(
                    lambda r: API_MARKER in r.url.lower(), timeout=RESP_TIMEOUT_MS
                ):
                    next_btn.click()
                page.wait_for_timeout(300)
            except Exception as exc:  # noqa: BLE001 - seguimos con lo capturado
                log.warning("Paginación detenida en página %s: %s", page_num, exc)
                break
            if page_num % 10 == 0:
                log.info("  ...página %s, %s convocatorias", page_num, len(collected))

        browser.close()

    log.info("Convocatorias descargadas: %s", len(collected))
    return list(collected.values())


def parse_hearing_date(date_str: str | None) -> datetime | None:
    """Convierte 'DD/MM/YYYY' (o 'DD/MM/YYYY HH:MM') a datetime tz Bogotá."""
    if not date_str:
        return None
    token = date_str.strip().split(" ")[0]  # descarta la hora si viene
    try:
        return datetime.strptime(token, HEARING_DATE_FMT).replace(tzinfo=BOGOTA_TZ)
    except ValueError:
        return None


def filter_open_with_pliegos(
    announcements: list[dict], reference: datetime | None = None
) -> list[dict]:
    """Convocatorias VIGENTES (plazo de ofertas no vencido), Abiertas y con
    pliegos definitivos cargados. Es el universo del flujo diario."""
    today = (reference or datetime.now(BOGOTA_TZ)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    result = []
    for ann in announcements:
        if (ann.get("state") or "").strip().lower() != "abierta":
            continue
        if not (ann.get("dateSheetsDefinitive") or "").strip():
            continue  # aún no tiene pliegos definitivos
        deadline = parse_hearing_date(ann.get("dateLimitOffer"))
        if deadline is None:
            continue
        if deadline >= today:  # vigente: el plazo de ofertas no ha vencido
            result.append(ann)
    return result


def filter_this_week(
    announcements: list[dict], reference: datetime | None = None
) -> list[dict]:
    """Filtra convocatorias 'Abierta' con audiencia dentro de la semana actual."""
    monday, sunday = get_week_bounds(reference)
    log.info(
        "Semana objetivo: %s a %s",
        monday.strftime("%d/%m/%Y"),
        sunday.strftime("%d/%m/%Y"),
    )
    result = []
    for ann in announcements:
        if (ann.get("state") or "").strip().lower() != "abierta":
            continue
        hearing = parse_hearing_date(ann.get("datePublicHearing"))
        if hearing is None:
            continue
        if monday <= hearing <= sunday:
            result.append(ann)
    return result
