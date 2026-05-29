// Procesa el ParseResult de Claude: mapea agentes a codigo SIC y genera el
// Excel con las hojas "Solicitado" y "Oferta" en el orden de columnas exacto.
import * as XLSX from 'xlsx';
import { buildAgentMappings } from './agentMatch';
import { expandResult } from './expand';
import type { AgentMapping, OfertaRow, ParseResult, SolicitadoRow } from './types';

export const SOLICITADO_COLUMNS = [
  'Conv',
  'Producto Solicitado',
  'Fecha inicio producto',
  'Fecha fin producto',
  'mes',
  'Año',
  'Curva - Plano',
  'B 0,1,2,3',
  'IPP',
  'Cantidad reserva',
  'Precio Oferta Reserva',
] as const;

export const OFERTA_COLUMNS = [
  'Conv',
  'Agente',
  'Producto',
  'Oferta',
  'Fecha inicio producto',
  'Fecha fin producto',
  'mes',
  'Año',
  'Curva - Plano',
  'B 0,1,2,3',
  'IPP',
  'Cantidad Oferta',
  'Precio Oferta',
  'Porcentaje adj',
] as const;

export interface ProcessedResult {
  filename: string; // <serial>.xlsx
  convocatoria: string;
  ipp?: string;
  advertencias: string[]; // warnings que reporto el modelo
  solicitado: SolicitadoRow[];
  oferta: OfertaRow[]; // con Agente ya reemplazado por codigo SIC
  mappings: AgentMapping[]; // nombre -> codigo SIC (para mostrar y advertir)
  unmapped: string[]; // nombres que no se pudieron mapear
}

// Expande el JSON compacto a filas mensuales, mapea agentes y prepara el Excel.
export function processResult(result: ParseResult): ProcessedResult {
  // 1) expansion determinista: una fila por mes (ver lib/expand.ts)
  const { solicitado, oferta: ofertaIn, warnings: expandWarnings } = expandResult(result);

  // 2) mapeo de nombres de agente -> codigo SIC
  const names = Array.from(new Set(ofertaIn.map((o) => (o.Agente ?? '').toString())));
  const mapMap = buildAgentMappings(names);

  const oferta: OfertaRow[] = ofertaIn.map((o) => {
    const m = mapMap.get((o.Agente ?? '').toString());
    return { ...o, Agente: m?.codigo ?? o.Agente };
  });

  const mappings = Array.from(mapMap.values());
  const unmapped = mappings.filter((m) => !m.codigo).map((m) => m.nombre);

  const serial = (result.convocatoria || 'convocatoria').trim();
  const filename = `${serial}.xlsx`;

  return {
    filename,
    convocatoria: serial,
    ipp: result.ipp,
    advertencias: [...(result.advertencias ?? []), ...expandWarnings],
    solicitado,
    oferta,
    mappings,
    unmapped,
  };
}

// Construye el workbook con las dos hojas en el orden de columnas exacto.
export function buildWorkbook(processed: ProcessedResult): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const wsSol = XLSX.utils.json_to_sheet(processed.solicitado, {
    header: SOLICITADO_COLUMNS as unknown as string[],
  });
  const wsOf = XLSX.utils.json_to_sheet(processed.oferta, {
    header: OFERTA_COLUMNS as unknown as string[],
  });

  XLSX.utils.book_append_sheet(wb, wsSol, 'Solicitado');
  XLSX.utils.book_append_sheet(wb, wsOf, 'Oferta');
  return wb;
}

// Dispara la descarga del .xlsx en el navegador.
export function downloadWorkbook(processed: ProcessedResult): void {
  const wb = buildWorkbook(processed);
  XLSX.writeFile(wb, processed.filename);
}
