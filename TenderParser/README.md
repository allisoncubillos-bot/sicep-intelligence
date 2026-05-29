# Sicep TenderParser

App de chat con Claude para procesar **convocatorias públicas de energía SICEP**
(Colombia) y generar un Excel con las hojas **Solicitado** y **Oferta** en el
formato exacto que usa el equipo de tarifas.

Cargas el **PDF de la audiencia** y el **Excel insumo**, pulsas *Procesar*, y
Claude (Opus) extrae productos, ofertas, precios y adjudicaciones. La app
renderiza la tabla para que la revises contra el PDF; si algo está mal, lo
corriges conversando en el chat y Claude vuelve a generar.

## Stack

- React 18 + Vite + TypeScript
- Tailwind CSS (estructura funcional, sin diseño elaborado — para iterar luego en Lovable)
- SheetJS (`xlsx`) para leer el Excel insumo y generar el Excel de salida
- Lucide React (iconos)
- Backend: Express mínimo que **proxea** las llamadas a la API de Anthropic
  (la API key nunca llega al cliente)

## Cómo funciona

1. **Carga (cliente):** el PDF se convierte a base64; el Excel se convierte a
   CSV por hoja con SheetJS.
2. **Primer turno:** se envía un mensaje con el PDF como documento nativo
   (`type: "document"`, `application/pdf`) y cada hoja del Excel como documento
   `text/plain`. *(La API de Anthropic no acepta `.xlsx` como documento, por eso
   se manda como texto sin interpretar — valores de celda crudos.)*
3. **Chat multi-turn:** el historial completo se reenvía en cada llamada. El
   system prompt vive en [`src/system-prompt.ts`](src/system-prompt.ts).
4. **Resultado final:** cuando una respuesta de Claude contiene un bloque JSON
   con las claves `convocatoria`, `solicitado` y `oferta`, la app lo parsea,
   **mapea cada nombre de agente a su código SIC** (match normalizado, ver
   [`src/lib/agentMatch.ts`](src/lib/agentMatch.ts)), genera el Excel y muestra
   el botón de descarga.

El backend marca *prompt caching* sobre el system prompt y los documentos del
primer mensaje, así el chat multi-turno no reenvía el PDF a precio completo en
cada vuelta.

## Configuración

```bash
cp .env.example .env
# edita .env y pon tu clave:
#   SICEP_TENDERPARSER=sk-ant-...
```

| Variable | Propósito | Default |
|----------|-----------|---------|
| `SICEP_TENDERPARSER` | API key de Anthropic (solo backend) | — (requerida) |
| `PORT` | Puerto del backend proxy | `3001` |
| `SICEP_MODEL` | Modelo | `claude-opus-4-20250514` |
| `SICEP_MAX_TOKENS` | Límite de salida (la API lo exige) | `32000` |

## Uso

```bash
npm install
npm run dev      # levanta backend (3001) + frontend (5173) juntos
```

Abre http://localhost:5173. (También puedes correrlos por separado con
`npm run dev:server` y `npm run dev:web`.)

```bash
npm run build    # typecheck + build de producción
```

## Tabla de agentes (códigos SIC)

`src/agents.ts` está **autogenerado** (541 agentes) a partir del
`Listado_Agentes.xlsx` de XM. No lo edites a mano. Para actualizarlo cuando XM
publique un listado nuevo:

```bash
# coloca el xlsx nuevo y corre:
python scripts/generate-agents.py [ruta_al_xlsx]
# por defecto usa ../knowledge/CodSIC_Agentes.xlsx
```

## Estructura

```
src/
├── App.tsx              # orquestación + layout (panel izq: archivos/descarga/warnings; der: tabla + chat)
├── system-prompt.ts     # system prompt (sin la tabla de agentes)
├── agents.ts            # 541 agentes SIC (autogenerado)
├── components/
│   ├── DropZone.tsx     # zona drag & drop
│   ├── Chat.tsx         # burbujas + input + "pensando…"
│   └── TablePreview.tsx # render de Solicitado / Oferta para revisión
└── lib/
    ├── types.ts         # tipos compartidos
    ├── files.ts         # base64 (PDF) + Excel→CSV
    ├── api.ts           # cliente → /api/chat
    ├── agentMatch.ts    # normalización + mapeo nombre→código SIC
    ├── extractJson.ts   # detección del JSON final en la respuesta
    └── excelOut.ts      # SheetJS: genera Solicitado + Oferta
server/
└── index.js             # proxy Express → Anthropic
scripts/
└── generate-agents.py   # regenera agents.ts desde el xlsx de XM
```
