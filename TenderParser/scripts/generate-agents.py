#!/usr/bin/env python
"""Genera src/agents.ts a partir de un Listado_Agentes.xlsx (codigos SIC de XM).

Uso:
    python scripts/generate-agents.py [ruta_al_xlsx]

Si no se pasa ruta, usa ../knowledge/CodSIC_Agentes.xlsx relativo a este repo.
El xlsx debe tener una hoja con columnas: Codigo SIC | Nombre Agente | Actividad.

Cuando XM publique un listado nuevo, descargalo y vuelve a correr este script.
"""
import json
import sys
from pathlib import Path

try:
    import openpyxl
except ImportError:
    sys.exit("Falta openpyxl: pip install openpyxl")

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_XLSX = ROOT.parent / "knowledge" / "CodSIC_Agentes.xlsx"
OUT = ROOT / "src" / "agents.ts"


def main() -> None:
    xlsx = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_XLSX
    if not xlsx.exists():
        sys.exit(f"No existe el archivo: {xlsx}")

    wb = openpyxl.load_workbook(xlsx, data_only=True)
    ws = wb.worksheets[0]
    rows = []
    seen = set()
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i == 0:
            continue  # encabezado
        code, name = row[0], row[1]
        if not code or not name:
            continue
        code, name = str(code).strip(), str(name).strip()
        key = (code, name)
        if key in seen:
            continue
        seen.add(key)
        rows.append({"codigo": code, "nombre": name})

    body = ",\n".join(
        "  { codigo: %s, nombre: %s }" % (json.dumps(r["codigo"], ensure_ascii=False),
                                          json.dumps(r["nombre"], ensure_ascii=False))
        for r in rows
    )
    ts = (
        "// AUTO-GENERADO por scripts/generate-agents.py. No editar a mano.\n"
        f"// Fuente: {xlsx.name}  |  {len(rows)} agentes.\n\n"
        "export interface Agent {\n  codigo: string;\n  nombre: string;\n}\n\n"
        f"export const AGENTS: Agent[] = [\n{body}\n];\n"
    )
    OUT.write_text(ts, encoding="utf-8")
    print(f"Escrito {OUT} con {len(rows)} agentes.")


if __name__ == "__main__":
    main()
