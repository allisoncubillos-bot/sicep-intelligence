"""Resumen de pliegos definitivos con la API de Claude (Anthropic).

Lee el PDF del pliego + el texto del Excel de cantidades y extrae, estructurado:
  - productos (uno por objeto): modalidad (PLC/PLG/PLD), cantidad, período, curva
  - precio base (mes base de indexación)
  - garantías (seriedad, cumplimiento vendedor, cumplimiento comprador)
  - requisito FNCER (100% renovable no convencional), si aplica
"""
import base64
import json
import logging

import anthropic

from excel_reader import excel_to_text

log = logging.getLogger(__name__)

MODEL = "claude-opus-4-7"
MAX_TOKENS = 8_000

SYSTEM_PROMPT = (
    "Eres un analista experto en convocatorias públicas de compra de energía del "
    "mercado regulado colombiano (SICEP, Resolución CREG 130 de 2019). Te entregan "
    "el PDF del PLIEGO DE CONDICIONES DEFINITIVO y el contenido (texto) del Excel "
    "de cantidades. Extraes la información de forma precisa, CONCISA y fiel al "
    "documento. Si un dato no aparece, usa 'No especificado'. No inventes cifras.\n\n"
    "MODALIDAD (por producto, devuelve SOLO la sigla): 'Pague lo Contratado' = "
    "PLC; 'Pague lo Contratado Condicionado' (alias 'Pague lo Generado') = PLG; "
    "'Pague lo Demandado' = PLD.\n\n"
    "UNIDADES (CRÍTICO): las cantidades del Excel pueden venir en kWh, MWh o GWh, "
    "y por hora, día, mes o año. DETECTA la unidad real revisando los encabezados "
    "y columnas, y CONVIÉRTELA a energía mensual en GWh/mes. Factores: "
    "1 GWh = 1.000 MWh = 1.000.000 kWh. No asumas la unidad: 0,73 GWh/mes y 73 "
    "GWh/mes son MUY distintos. Si los datos son anuales, divide entre 12 para el "
    "promedio mensual; si son diarios, multiplica por los días del mes; si son por "
    "hora con curva plana, multiplica por 24 y por los días del mes. Verifica "
    "siempre que el orden de magnitud sea razonable.\n\n"
    "PRODUCTOS: la convocatoria solicita uno o más productos. Devuelve un objeto "
    "por CADA producto, con todos los campos CORTOS:\n"
    "  - modalidad: PLC, PLG o PLD.\n"
    "  - cantidad: cantidad mensual aproximada YA CONVERTIDA a GWh/mes (usa coma "
    "decimal). Si es estable, '~X GWh/mes promedio'; si varía mes a mes, "
    "'variable, entre X y Y GWh/mes'. NO incluyas kWh/día, bloques horarios ni "
    "totales por año.\n"
    "  - periodo: rango CONCISO en formato mes/año. Usa solo el año cuando el mes "
    "sea enero (en el inicio) o diciembre (en el fin). Ej.: 'Agosto/2026 - 2028', "
    "'2027 - 2031'.\n"
    "  - curva: muy breve, ej. 'plana 24h' o 'variable'; '' si no se especifica.\n\n"
    "PRECIO BASE: el mes base de indexación de precios que fija el pliego (ej. "
    "'Diciembre 2025'). Si no aparece, 'No especificado'.\n\n"
    "GARANTÍAS: tres campos breves con tipo (pagaré / garantía bancaria / póliza) "
    "y monto o forma de cálculo: 'seriedad' (seriedad de la oferta), "
    "'cumplimiento_vendedor' y 'cumplimiento_comprador'. '' si alguno no aplica.\n\n"
    "FNCER: por defecto se acepta cualquier tecnología. Pon 'fncer_requerido'=true "
    "SOLO si el pliego exige ofertas 100% de Fuentes de Energía Renovable No "
    "Convencional (FNCER), a nivel general o de productos; 'fncer_detalle'= dónde "
    "aplica. Si no se exige, false y ''."
)

OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "productos": {
            "type": "array",
            "description": "Un objeto por producto solicitado.",
            "items": {
                "type": "object",
                "properties": {
                    "modalidad": {"type": "string", "enum": ["PLC", "PLG", "PLD"]},
                    "cantidad": {"type": "string"},
                    "periodo": {"type": "string"},
                    "curva": {"type": "string"},
                },
                "required": ["modalidad", "cantidad", "periodo", "curva"],
                "additionalProperties": False,
            },
        },
        "precio_base": {
            "type": "string",
            "description": "Mes base de indexación de precios.",
        },
        "garantias": {
            "type": "object",
            "properties": {
                "seriedad": {"type": "string"},
                "cumplimiento_vendedor": {"type": "string"},
                "cumplimiento_comprador": {"type": "string"},
            },
            "required": ["seriedad", "cumplimiento_vendedor", "cumplimiento_comprador"],
            "additionalProperties": False,
        },
        "fncer_requerido": {"type": "boolean"},
        "fncer_detalle": {"type": "string"},
    },
    "required": [
        "productos",
        "precio_base",
        "garantias",
        "fncer_requerido",
        "fncer_detalle",
    ],
    "additionalProperties": False,
}


def summarize_pliego(
    api_key: str,
    pdf_path: str,
    excel_path: str | None = None,
    exclusive_fncer: bool | None = None,
) -> dict:
    """Envía el pliego (PDF) y el Excel de cantidades a Claude y devuelve el
    resumen estructurado (productos, precio base, garantías, FNCER)."""
    client = anthropic.Anthropic(api_key=api_key)
    with open(pdf_path, "rb") as fh:
        pdf_b64 = base64.standard_b64encode(fh.read()).decode("utf-8")

    excel_text = excel_to_text(excel_path)
    excel_block = (
        "Contenido del Excel de cantidades requeridas (texto tabular):\n\n"
        f"{excel_text}"
        if excel_text
        else "No se pudo leer el Excel de cantidades; usa el pliego para los productos."
    )

    fncer_hint = ""
    if exclusive_fncer is not None:
        fncer_hint = (
            f"\n\nPista de SICEP (indicador a nivel de convocatoria): "
            f"exclusiveFNCER={str(exclusive_fncer).lower()}. Úsalo como pista, "
            f"pero verifica en el pliego: el requisito FNCER también puede ser por "
            f"producto."
        )

    response = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        thinking={"type": "adaptive"},
        system=[
            {
                "type": "text",
                "text": SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "document",
                        "source": {
                            "type": "base64",
                            "media_type": "application/pdf",
                            "data": pdf_b64,
                        },
                    },
                    {"type": "text", "text": excel_block},
                    {
                        "type": "text",
                        "text": (
                            "Extrae del pliego y el Excel: productos (uno por "
                            "objeto: modalidad PLC/PLG/PLD, cantidad, período, "
                            "curva), precio base (mes base de indexación), "
                            "garantías y requisito FNCER." + fncer_hint
                        ),
                    },
                ],
            }
        ],
        output_config={"format": {"type": "json_schema", "schema": OUTPUT_SCHEMA}},
    )

    text = next((b.text for b in response.content if b.type == "text"), "")
    log.info(
        "  Claude usage: in=%s out=%s cache_read=%s",
        response.usage.input_tokens,
        response.usage.output_tokens,
        getattr(response.usage, "cache_read_input_tokens", 0),
    )
    return json.loads(text)
