"""Orquestador semanal SICEP: convocatorias -> Meet/Excel -> Calendar -> Slack.

Uso:
    python run_weekly.py

Cada paso captura sus errores: si una convocatoria falla, se registra y se
continúa con las demás.
"""
import logging
import sys
from datetime import datetime

from config import load_config
from sicep_api import (
    BOGOTA_TZ,
    fetch_all_announcements,
    filter_this_week,
    parse_hearing_date,
)
from scraper import scrape_announcement
from calendar_client import build_service, create_event
from slack_client import send_summary

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("sicep")


def enrich_with_scraping(audiencias: list[dict], download_folder: str) -> list[dict]:
    """Paso 2 y 3: por cada convocatoria, extrae Meet/hora/Excel."""
    for ann in audiencias:
        aid = ann.get("announcementeId", "?")
        log.info("Procesando %s (scraping)...", aid)
        try:
            details = scrape_announcement(ann, download_folder)
            ann.update(details)
            log.info("  Meet: %s", details.get("meet_link") or "no encontrado")
            log.info("  Hora: %s", details.get("hour_str") or "no encontrada")
            log.info(
                "  Excel: %s", details.get("excel_path") or "no descargado"
            )
        except Exception as exc:  # noqa: BLE001 - robustez: seguir con las demás
            log.error("  Falló el scraping de %s: %s", aid, exc)
    return audiencias


def push_calendar_events(cfg, audiencias: list[dict]) -> None:
    """Paso 4: crea eventos en Google Calendar (sin duplicar)."""
    try:
        service = build_service(
            cfg.google_client_id,
            cfg.google_client_secret,
            cfg.google_refresh_token,
        )
    except Exception as exc:  # noqa: BLE001
        log.error("No se pudo inicializar Google Calendar: %s", exc)
        return

    for ann in audiencias:
        aid = ann.get("announcementeId", "?")
        hour = ann.get("hour")
        day = parse_hearing_date(ann.get("datePublicHearing", ""))
        if not hour or not day:
            log.warning("  Sin hora/fecha para %s; no se crea evento.", aid)
            continue
        when = day.replace(hour=hour[0], minute=hour[1], tzinfo=BOGOTA_TZ)
        try:
            event = create_event(
                service, cfg.google_calendar_id, aid, when, ann.get("meet_link")
            )
            if event:
                log.info("  Evento creado: %s (%s)", aid, when.strftime("%d/%m %H:%M"))
            else:
                log.info("  Evento ya existía, no se duplica: %s", aid)
        except Exception as exc:  # noqa: BLE001
            log.error("  Falló crear evento de %s: %s", aid, exc)


def main() -> int:
    cfg = load_config()
    missing = cfg.validate()
    if missing:
        log.error("Faltan variables de entorno: %s", ", ".join(missing))
        log.error("Completa el archivo .env (ver .env.example y README.md).")
        return 1

    log.info("=== Proceso semanal SICEP iniciado ===")

    # Paso 1
    log.info("Paso 1: descargando convocatorias desde SICEP...")
    try:
        todas = fetch_all_announcements()
    except Exception as exc:  # noqa: BLE001
        log.error("Error al obtener convocatorias de SICEP: %s", exc)
        return 1

    audiencias = filter_this_week(todas)
    log.info("Convocatorias con audiencia esta semana: %s", len(audiencias))

    # Paso 2 y 3
    if audiencias:
        enrich_with_scraping(audiencias, cfg.download_folder)
        # Paso 4
        log.info("Paso 4: creando eventos en Google Calendar...")
        push_calendar_events(cfg, audiencias)
    else:
        log.info("No hay audiencias esta semana; se omiten scraping y calendario.")

    # Paso 5
    log.info("Paso 5: enviando resumen a Slack...")
    try:
        send_summary(cfg.slack_webhook_url, cfg.slack_channel, audiencias)
        log.info("Resumen enviado a Slack.")
    except Exception as exc:  # noqa: BLE001
        log.error("Falló el envío a Slack: %s", exc)

    log.info("=== Proceso semanal SICEP finalizado (%s) ===", datetime.now())
    return 0


if __name__ == "__main__":
    sys.exit(main())
