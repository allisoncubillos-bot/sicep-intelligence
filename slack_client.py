"""Paso 5: envío del resumen semanal a Slack vía Incoming Webhook."""
import logging
from datetime import datetime

import requests

log = logging.getLogger(__name__)

MESES_ES = [
    "",
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Septiembre",
    "Octubre",
    "Noviembre",
    "Diciembre",
]


def _fmt_periodo_general(init_str: str | None, fin_str: str | None) -> str | None:
    """Formatea el rango 'DD/MM/YYYY'–'DD/MM/YYYY' como mes/año.

    Usa solo el año cuando el mes es enero (inicio) o diciembre (fin):
    01/08/2026–31/12/2028 -> 'Agosto/2026 - 2028'.
    """

    def _parse(s):
        try:
            return datetime.strptime((s or "").strip().split(" ")[0], "%d/%m/%Y")
        except ValueError:
            return None

    di, df = _parse(init_str), _parse(fin_str)
    if not di or not df:
        return None
    start = str(di.year) if di.month == 1 else f"{MESES_ES[di.month]}/{di.year}"
    end = str(df.year) if df.month == 12 else f"{MESES_ES[df.month]}/{df.year}"
    return start if start == end else f"{start} - {end}"


def build_summary_text(audiencias: list[dict]) -> str:
    """Arma el texto del mensaje de Slack a partir de las convocatorias."""
    if not audiencias:
        return (
            "📋 *Audiencias SICEP esta semana*\n\n"
            "No hay audiencias públicas programadas para esta semana."
        )

    lines = ["📋 *Audiencias SICEP esta semana*\n"]
    for ann in audiencias:
        aid = ann.get("announcementeId", "—")
        agent = ann.get("shortAgentName", "—")
        date = ann.get("datePublicHearing", "—")
        hour = ann.get("hour_str") or "—"
        meet = ann.get("meet_link") or "(link no disponible)"
        lines.append(f"• *{aid}* — {agent} — {date} {hour}\n  🔗 {meet}\n")
    return "\n".join(lines)


def send_summary(webhook_url: str, channel: str, audiencias: list[dict]) -> None:
    """Envía el resumen al webhook. Lanza si la respuesta no es 200."""
    send_message(webhook_url, channel, build_summary_text(audiencias))


def send_message(webhook_url: str, channel: str, text: str) -> None:
    """Envía un mensaje de texto a un webhook de Slack."""
    payload: dict = {"text": text}
    if channel:
        payload["channel"] = channel
    resp = requests.post(webhook_url, json=payload, timeout=30)
    resp.raise_for_status()


_MODALIDAD_ABBR = {
    "pague lo contratado": "PLC",
    "pague lo contratado condicionado": "PLG",
    "pague lo generado": "PLG",
    "pague lo demandado": "PLD",
}


def _modalidad_sigla(value: str) -> str:
    """Devuelve PLC/PLG/PLD. Claude ya manda la sigla; esto es por si acaso."""
    v = (value or "").strip()
    if v.upper() in ("PLC", "PLG", "PLD"):
        return v.upper()
    return _MODALIDAD_ABBR.get(v.lower(), v or "No especificado")


def build_pliego_message(
    announcement: dict, summary: dict, detail_url: str | None = None
) -> str:
    """Arma el mensaje del canal diario de pliegos con el resumen de Claude."""
    aid = announcement.get("announcementeId", "—")
    agent = announcement.get("shortAgentName", "—")
    deadline = announcement.get("dateLimitOffer") or "—"
    hearing = announcement.get("datePublicHearing") or "—"
    periodo_general = (
        _fmt_periodo_general(
            announcement.get("initialPeriodHiring"),
            announcement.get("finalPeriodHiring"),
        )
        or "No especificado"
    )
    productos = summary.get("productos") or []
    garantias = summary.get("garantias") or {}

    # Si todos los productos comparten modalidad, se muestra una sola vez arriba.
    siglas = [_modalidad_sigla(p.get("modalidad")) for p in productos]
    modalidad_unica = siglas[0] if siglas and len(set(siglas)) == 1 else None

    lines = [
        f"📣 *NUEVO PLIEGO DEFINITIVO — {aid}*  ({agent})",
        f"🗓️ *Límite presentación de ofertas:* {deadline}",
        f"🎤 *Audiencia pública:* {hearing}",
    ]
    if summary.get("fncer_requerido"):
        detalle = summary.get("fncer_detalle") or "toda la convocatoria"
        lines.append(f"🌱 *Requisito FNCER (100% renovable no convencional):* {detalle}")

    lines.append("")
    lines.append(f"📅 *Período general:* {periodo_general}")
    if modalidad_unica:
        lines.append(f"💱 *Modalidad:* {modalidad_unica}")

    if productos:
        lines.append(f"📦 *Productos solicitados ({len(productos)}):*")
        for i, prod in enumerate(productos, start=1):
            parts = []
            if not modalidad_unica:
                parts.append(f"*Modalidad:* {_modalidad_sigla(prod.get('modalidad'))}")
            parts.append(f"*Cantidad:* {prod.get('cantidad') or 'No especificado'}")
            parts.append(f"*Período:* {prod.get('periodo') or 'No especificado'}")
            if prod.get("curva"):
                parts.append(f"*Curva:* {prod['curva']}")
            lines.append(f"   {i}. " + " · ".join(parts))
    else:
        lines.append("📦 *Productos solicitados:* No especificado")
    lines.append("")

    lines.append(
        f"💰 *Precio base (mes base de indexación):* "
        f"{summary.get('precio_base') or 'No especificado'}"
    )

    lines.append("🛡️ *Garantías:*")
    if garantias.get("seriedad"):
        lines.append(f"      • Seriedad de la oferta: {garantias['seriedad']}")
    if garantias.get("cumplimiento_vendedor"):
        lines.append(f"      • Cumplimiento vendedor: {garantias['cumplimiento_vendedor']}")
    if garantias.get("cumplimiento_comprador"):
        lines.append(f"      • Cumplimiento comprador: {garantias['cumplimiento_comprador']}")

    if detail_url:
        lines.append("")
        lines.append(f"🔗 *Ver convocatoria en SICEP:* {detail_url}")
    return "\n".join(lines)
