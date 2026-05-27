"""Flujo DIARIO de pliegos definitivos.

Cada día:
  1. Descarga todas las convocatorias de SICEP.
  2. Filtra las VIGENTES (plazo de ofertas no vencido), Abiertas y con pliegos
     definitivos cargados.
  3. Se queda solo con las NUEVAS (no procesadas antes; ver estado_pliegos.json).
  4. Por cada nueva: descarga el pliego (PDF) y el Excel, pide a Claude el
     resumen (período, productos, modalidad, garantías) y publica en el canal
     de Slack de pliegos, incluyendo la fecha límite de presentación de ofertas.
  5. Marca como procesadas (solo las que se publicaron bien).

Si no hay convocatorias nuevas, no hace nada.

Uso:
    python run_daily.py
"""
import logging
import sys
from datetime import datetime

from config import load_config
from sicep_api import fetch_all_announcements, filter_open_with_pliegos
from scraper import build_detail_url, download_pliego_docs, extract_buyer_code
from pliego_analyzer import summarize_pliego
from slack_client import build_pliego_message, send_message
from state import load_processed, save_processed

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("sicep-daily")


def process_announcement(cfg, ann: dict) -> bool:
    """Procesa una convocatoria: descarga, resume y publica. True si tuvo éxito."""
    aid = ann.get("announcementeId", "?")
    log.info("Procesando pliego %s (%s)...", aid, ann.get("shortAgentName"))

    docs = download_pliego_docs(ann, cfg.pliegos_folder, cfg.download_folder)
    if not docs.get("pliego_path"):
        log.error("  No se descargó el pliego PDF de %s; se reintentará otro día.", aid)
        return False
    log.info("  Pliego: %s", docs["pliego_path"])
    log.info("  Excel : %s", docs.get("excel_path") or "no descargado")

    summary = summarize_pliego(
        cfg.anthropic_api_key,
        docs["pliego_path"],
        docs.get("excel_path"),
        exclusive_fncer=ann.get("exclusiveFNCER"),
    )
    log.info("  Resumen Claude: %s", summary)

    buyer = extract_buyer_code(aid)
    detail_url = build_detail_url(ann, buyer) if buyer else None
    text = build_pliego_message(ann, summary, detail_url)
    send_message(cfg.slack_webhook_url_pliegos, cfg.slack_channel_pliegos, text)
    log.info("  Publicado en Slack.")
    return True


def main() -> int:
    cfg = load_config()
    missing = cfg.validate_daily()
    if missing:
        log.error("Faltan variables de entorno: %s", ", ".join(missing))
        return 1

    log.info("=== Flujo diario de pliegos SICEP iniciado ===")

    try:
        todas = fetch_all_announcements()
    except Exception as exc:  # noqa: BLE001
        log.error("Error al obtener convocatorias de SICEP: %s", exc)
        return 1

    vigentes = filter_open_with_pliegos(todas)
    log.info("Convocatorias vigentes con pliegos definitivos: %s", len(vigentes))

    processed = load_processed(cfg.state_file)
    nuevas = [a for a in vigentes if a.get("announcementeId") not in processed]
    log.info("Convocatorias NUEVAS por procesar: %s", len(nuevas))

    if not nuevas:
        log.info("No hay convocatorias nuevas. Nada que hacer hoy.")
        return 0

    exitosas = 0
    for ann in nuevas:
        aid = ann.get("announcementeId", "?")
        try:
            if process_announcement(cfg, ann):
                processed.add(aid)
                exitosas += 1
        except Exception as exc:  # noqa: BLE001 - robustez: seguir con las demás
            log.error("  Falló el procesamiento de %s: %s", aid, exc)

    save_processed(cfg.state_file, processed)
    log.info(
        "=== Flujo diario finalizado: %s/%s publicadas (%s) ===",
        exitosas,
        len(nuevas),
        datetime.now(),
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
