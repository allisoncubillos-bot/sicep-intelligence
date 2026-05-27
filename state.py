"""Registro de convocatorias ya procesadas en el canal diario de pliegos.

Guarda los announcementeId procesados en un JSON local para que cada día solo
se procesen las NUEVAS.
"""
import json
import logging
import os

log = logging.getLogger(__name__)


def load_processed(path: str) -> set[str]:
    """Devuelve el conjunto de IDs ya procesados (vacío si no existe el archivo)."""
    if not os.path.exists(path):
        return set()
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        return set(data.get("processed", []))
    except (json.JSONDecodeError, OSError) as exc:
        log.warning("No se pudo leer el estado (%s): %s. Empiezo vacío.", path, exc)
        return set()


def save_processed(path: str, processed: set[str]) -> None:
    """Guarda el conjunto de IDs procesados."""
    with open(path, "w", encoding="utf-8") as fh:
        json.dump({"processed": sorted(processed)}, fh, ensure_ascii=False, indent=2)
