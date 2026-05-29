// Tipos compartidos entre UI, llamadas a la API y generacion de Excel.

// --- Bloques de contenido que viaja a la API de Anthropic (formato Messages API) ---

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface DocumentBlock {
  type: 'document';
  source:
    | { type: 'base64'; media_type: 'application/pdf'; data: string }
    | { type: 'text'; media_type: 'text/plain'; data: string };
  title?: string;
  // contexto opcional para ayudar al modelo a ubicar el documento
  context?: string;
}

export type ContentBlock = TextBlock | DocumentBlock;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: ContentBlock[];
}

// --- Vista de UI del chat (lo que se renderiza en burbujas) ---

export interface UIMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string; // texto plano para mostrar
  attachments?: string[]; // nombres de archivos adjuntos (solo display)
  // Si el assistant emitio un bloque ```question, la UI lo renderiza como
  // selectores. Se vacia cuando el usuario ya respondio.
  question?: { question: string; options: string[] };
  answered?: boolean;
}

// --- Archivos cargados en el cliente ---

export interface LoadedPdf {
  name: string;
  base64: string; // sin el prefijo data:
}

export interface LoadedExcelSheet {
  sheetName: string;
  csv: string;
}

export interface LoadedExcel {
  name: string;
  sheets: LoadedExcelSheet[];
}

// --- Contrato COMPACTO que Claude devuelve como JSON ---
// El modelo NO escribe una fila por mes (eso explota el tope de salida en
// productos de varios años). Devuelve metadata por producto/oferta + la cantidad
// como total anual (o mensual si varía). La app expande a filas mensuales
// de forma determinista (ver lib/expand.ts).

export type Unidad = 'kWh' | 'MWh' | 'GWh';

export interface CantidadMensual {
  anio: number;
  mes: number; // 1-12
  cantidad: number;
}
export interface CantidadAnual {
  anio: number;
  cantidad: number;
}
export interface CantidadPatron {
  mes: number; // 1-12
  cantidad: number;
}

// Cantidad de energía, expresada de la forma más compacta disponible.
// Prioridad al expandir: mensual > mensualPatron > anual > constanteAnual.
//
// IMPORTANTE: para productos CURVA el modelo DEBE entregar "mensual" o
// "mensualPatron" (los valores reales del Excel insumo). Distribuir por días
// desde un total anual SOLO es correcto para productos PLANO.
export interface CantidadSpec {
  unidad: Unidad;
  // detalle explicito por (anio, mes)
  mensual?: CantidadMensual[];
  // patron de 12 meses que se repite cada año de la vigencia (Curva plana
  // multi-año). La app aplica el mismo valor al mismo "mes" en cada año.
  mensualPatron?: CantidadPatron[];
  // total por cada año de la vigencia; la app distribuye por días del mes
  // (solo correcto para PLANO)
  anual?: CantidadAnual[];
  // mismo total anual para todos los años; la app lo replica y distribuye por
  // días (solo correcto para PLANO)
  constanteAnual?: number;
}

// Precio: numero, por año, o por (año, mes). El PDF puede mostrar precios que
// varían año a año (multi-año) o incluso mes a mes dentro de la misma oferta.
export type PrecioPorAnio = Array<{ anio: number; precio: number }>;
export type PrecioPorMes = Array<{ anio: number; mes: number; precio: number }>;
export type Precio = number | PrecioPorAnio | PrecioPorMes;

// Porcentaje adj: numero o por (año, mes). Una misma oferta puede tener 100%
// en un mes y 0% en otro.
export type AdjPorMes = Array<{ anio: number; mes: number; adj: number }>;
export type Adj = number | AdjPorMes;

export interface OfertaCompact {
  agente: string; // nombre crudo (la app lo mapea a código SIC)
  oferta: number; // 1, 2, 3... por agente+producto
  curvaPlano: string; // "Curva" | "Plano"
  precio: Precio; // $/kWh: numero, array por año o por (año,mes)
  porcentajeAdj: Adj; // 0-100, numero o por (año,mes)
  cantidad: CantidadSpec;
}

export interface ProductoCompact {
  producto: string | number;
  fechaInicio: string; // DD/MM/YYYY
  fechaFin: string; // DD/MM/YYYY
  curvaPlano: string; // tipo de la oferta reserva ("Curva"|"Plano")
  precioReserva: Precio; // $/kWh (numero o array por año)
  reserva: CantidadSpec; // cantidad solicitada / reserva
  ofertas: OfertaCompact[];
}

export interface ParseResult {
  convocatoria: string;
  ipp?: string;
  advertencias?: string[];
  productos: ProductoCompact[];
}

// --- Filas EXPANDIDAS (lo que va al Excel) ---

export interface SolicitadoRow {
  Conv: string;
  'Producto Solicitado': string | number;
  'Fecha inicio producto': string;
  'Fecha fin producto': string;
  mes: number;
  'Año': number;
  'Curva - Plano': string;
  'B 0,1,2,3': string;
  IPP: string;
  'Cantidad reserva': number;
  'Precio Oferta Reserva': number;
}

export interface OfertaRow {
  Conv: string;
  Agente: string; // nombre crudo de Claude; la app lo reemplaza por codigo SIC
  Producto: string | number;
  Oferta: number;
  'Fecha inicio producto': string;
  'Fecha fin producto': string;
  mes: number;
  'Año': number;
  'Curva - Plano': string;
  'B 0,1,2,3': string;
  IPP: string;
  'Cantidad Oferta': number;
  'Precio Oferta': number;
  'Porcentaje adj': number;
}

// Resultado de mapear un nombre de agente a su codigo SIC.
export interface AgentMapping {
  nombre: string; // nombre original del PDF
  codigo: string | null; // codigo SIC asignado, o null si no hubo match
  matchedNombre?: string; // nombre del SIC con el que hizo match
  score: number; // 0-100
}
