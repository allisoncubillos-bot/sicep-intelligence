"""Pasos 2 y 3: scraping con Playwright del link de Meet, hora y Excel.

La página de detalle (expediente electrónico) carga sin login y muestra
acordeones. Lo que necesitamos está repartido en dos:
  - "Publicación de pliegos definitivos": enlace "Anexos 3 y 4. Cantidades..."
    que dispara la descarga del Excel (sin href, por JavaScript).
  - "Evaluación de resultados en audiencia pública": link de Google Meet y la
    hora ("15:00 horas").
Son acordeones de apertura única, así que se abren de a uno.
"""
import logging
import os
import re
from urllib.parse import quote

from playwright.sync_api import TimeoutError as PWTimeout
from playwright.sync_api import sync_playwright

log = logging.getLogger(__name__)

DETAIL_BASE = "https://sicep.xm.com.co/public-announcements/electronic-file"
LISTING_URL = "https://sicep.xm.com.co/public-announcements"
ACCORDION_AUDIENCIA = "Evaluación de resultados en audiencia pública"
ACCORDION_PLIEGOS = "Publicación de pliegos definitivos"
MEET_LINK_TEXT = "Accede aquí a la reunión virtual"
EXCEL_LINK_TEXT = "Cantidades"  # el enlace dice "Anexos 3 y 4. Cantidades..."
PLIEGO_LINK_TEXT = "PLIEGO DE CONDICIONES"  # "PLIEGO DE CONDICIONES DEF ....pdf"
NAV_TIMEOUT_MS = 60_000


def extract_buyer_code(announcement_id: str) -> str | None:
    """De 'CP-BIAC2026-002' extrae 'BIAC' (texto entre 'CP-' y el año)."""
    match = re.match(r"^CP-([A-Za-z]+)\d{4}", announcement_id or "")
    return match.group(1) if match else None


def build_detail_url(announcement: dict, buyer_code: str) -> str:
    """Construye la URL de detalle con las fechas URL-encoded (/ -> %2F)."""
    aid = announcement["announcementeId"]
    code_sic = announcement["codeSic"]
    init_p = quote(announcement.get("initialPeriodHiring", ""), safe="")
    fin_p = quote(announcement.get("finalPeriodHiring", ""), safe="")
    exclusive = str(announcement.get("exclusiveFNCER", False)).lower()
    reference = announcement.get("referenceMarket", "")
    return (
        f"{DETAIL_BASE}/{aid}/{code_sic}/{buyer_code}/"
        f"{init_p}/{fin_p}/{exclusive}/{reference}"
    )


def _normalize_url(url: str | None) -> str | None:
    """Asegura que el link de Meet tenga esquema https:// (algunos vienen sin él)."""
    if not url:
        return url
    url = url.strip()
    if url.startswith("http://") or url.startswith("https://"):
        return url
    return "https://" + url.lstrip("/")


def _parse_hour(text: str) -> tuple[int, int] | None:
    """Extrae (hora, minuto) de un texto tipo '15:00 horas'."""
    match = re.search(r"(\d{1,2}):(\d{2})", text or "")
    if not match:
        return None
    return int(match.group(1)), int(match.group(2))


def _open_detail_page(
    page, announcement: dict, wait_for_text: str = ACCORDION_AUDIENCIA
) -> bool:
    """Navega a la página de detalle. Devuelve True si cargó el contenido.

    Las pestañas (acordeones) del expediente se habilitan a medida que avanza
    el proceso, así que `wait_for_text` debe ser el acordeón que el llamador
    necesita: pliegos definitivos para el flujo diario, audiencia para el
    semanal. La de audiencia puede no existir aún en convocatorias tempranas.
    """
    aid = announcement["announcementeId"]
    buyer_code = extract_buyer_code(aid)

    if buyer_code:
        url = build_detail_url(announcement, buyer_code)
        log.info("  Navegando a detalle: %s", url)
        try:
            page.goto(url, timeout=NAV_TIMEOUT_MS, wait_until="networkidle")
            page.wait_for_selector(f"text={wait_for_text}", timeout=15_000)
            return True
        except PWTimeout:
            log.warning("  URL directa no cargó el detalle; uso el listado.")

    # Alternativa: buscar en el listado y abrir "Ver".
    try:
        page.goto(LISTING_URL, timeout=NAV_TIMEOUT_MS, wait_until="networkidle")
        row = page.locator(f"tr:has-text('{aid}')").first
        row.get_by_text("Ver", exact=False).first.click()
        page.wait_for_selector(f"text={wait_for_text}", timeout=15_000)
        return True
    except PWTimeout:
        log.error("  No se pudo abrir el detalle de %s por ningún método.", aid)
        return False


def _open_accordion(page, title: str) -> bool:
    """Abre un acordeón por su título. Devuelve True si pudo hacer clic."""
    try:
        page.get_by_text(title, exact=False).first.click()
        page.wait_for_timeout(2_000)
        return True
    except PWTimeout:
        log.warning("  No se pudo abrir el acordeón '%s'.", title)
        return False


def _download_excel(page, aid: str, download_folder: str) -> str | None:
    """Abre 'Pliegos definitivos' y descarga el Excel de cantidades."""
    if not _open_accordion(page, ACCORDION_PLIEGOS):
        return None
    try:
        link = page.locator(f"a:has-text('{EXCEL_LINK_TEXT}')").first
        os.makedirs(download_folder, exist_ok=True)
        target = os.path.join(download_folder, f"CANTIDADES SOLICITADAS {aid}.xlsx")
        with page.expect_download(timeout=30_000) as dl_info:
            link.click()
        dl_info.value.save_as(target)
        return target
    except PWTimeout:
        log.warning("  No se pudo descargar el Excel de cantidades.")
        return None


def _extract_meet_and_hour(page) -> tuple[str | None, tuple[int, int] | None]:
    """Abre 'Audiencia pública' y extrae (link de Meet, (hora, minuto))."""
    meet_link, hour = None, None
    if not _open_accordion(page, ACCORDION_AUDIENCIA):
        return meet_link, hour
    try:
        meet_link = _normalize_url(
            page.locator(f"a:has-text('{MEET_LINK_TEXT}')").first.get_attribute(
                "href", timeout=10_000
            )
        )
    except PWTimeout:
        log.warning("  No se encontró el enlace de la reunión virtual.")
    try:
        hour_text = page.locator(
            "text=/\\d{1,2}:\\d{2}\\s*horas?/"
        ).first.inner_text(timeout=10_000)
        hour = _parse_hour(hour_text)
    except PWTimeout:
        log.warning("  No se encontró la hora de la audiencia.")
    return meet_link, hour


def _download_by_extension(
    page, ext: str, folder: str, filename: str
) -> str | None:
    """Descarga el enlace VISIBLE cuyo texto termina en `ext` (ej: '.pdf',
    '.xlsx') dentro del acordeón ya abierto. Robusto ante los nombres variables
    que cada agente le pone a sus archivos. Devuelve la ruta o None.

    Recorre los <a>: los de acordeones cerrados no son visibles y su inner_text
    viene vacío, así que solo casa el archivo de la pestaña abierta.
    """
    ext = ext.lower()
    links = page.locator("a")
    target_link = None
    for i in range(links.count()):
        text = (links.nth(i).inner_text() or "").strip().lower()
        if text.endswith(ext):
            target_link = links.nth(i)
            break
    if target_link is None:
        log.warning("  No se encontró un archivo '%s' en la pestaña.", ext)
        return None
    try:
        os.makedirs(folder, exist_ok=True)
        target = os.path.join(folder, filename)
        with page.expect_download(timeout=30_000) as dl_info:
            target_link.click()
        dl_info.value.save_as(target)
        return target
    except PWTimeout:
        log.warning("  No se pudo descargar el archivo '%s'.", ext)
        return None


def download_pliego_docs(
    announcement: dict, pliegos_folder: str, excel_folder: str
) -> dict:
    """Flujo diario: descarga el pliego definitivo (PDF) y el Excel de cantidades.

    Devuelve {pliego_path, excel_path}. Lanza si no carga el detalle.
    """
    aid = announcement["announcementeId"]
    result = {"pliego_path": None, "excel_path": None}

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context(accept_downloads=True)
        page = context.new_page()
        try:
            # Esperamos el acordeón de pliegos (garantizado en vigentes con
            # pliegos definitivos); el de audiencia puede no existir aún.
            if not _open_detail_page(page, announcement, ACCORDION_PLIEGOS):
                raise RuntimeError(f"No se pudo cargar el detalle de {aid}")
            if not _open_accordion(page, ACCORDION_PLIEGOS):
                raise RuntimeError(f"No se pudo abrir pliegos definitivos de {aid}")
            # El pliego es el .pdf y el de cantidades el .xlsx (nombres variables).
            result["pliego_path"] = _download_by_extension(
                page, ".pdf", pliegos_folder, f"PLIEGOS DEFINITIVOS {aid}.pdf"
            )
            result["excel_path"] = _download_by_extension(
                page, ".xlsx", excel_folder, f"CANTIDADES SOLICITADAS {aid}.xlsx"
            )
        finally:
            context.close()
            browser.close()

    return result


def scrape_announcement(announcement: dict, download_folder: str) -> dict:
    """Devuelve {meet_link, hour, hour_str, excel_path}. Lanza si no carga."""
    aid = announcement["announcementeId"]
    result = {"meet_link": None, "hour": None, "hour_str": None, "excel_path": None}

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context(accept_downloads=True)
        page = context.new_page()
        try:
            if not _open_detail_page(page, announcement):
                raise RuntimeError(f"No se pudo cargar el detalle de {aid}")

            # 1) Excel (acordeón de pliegos definitivos).
            result["excel_path"] = _download_excel(page, aid, download_folder)

            # 2) Meet + hora (acordeón de audiencia pública).
            meet_link, hour = _extract_meet_and_hour(page)
            result["meet_link"] = meet_link
            if hour:
                result["hour"] = hour
                result["hour_str"] = f"{hour[0]:02d}:{hour[1]:02d}"
        finally:
            context.close()
            browser.close()

    return result
