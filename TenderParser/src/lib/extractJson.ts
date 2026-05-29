// Detecta y normaliza el bloque JSON final de Claude.
// Se considera "resultado final" si trae convocatoria + productos[].
// Normaliza variantes de nombres de clave (camelCase / snake_case / español).
import type {
  Adj,
  CantidadAnual,
  CantidadMensual,
  CantidadPatron,
  CantidadSpec,
  OfertaCompact,
  ParseResult,
  Precio,
  ProductoCompact,
  Unidad,
} from './types';

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// Primer valor definido entre varias claves posibles.
function pick(o: Obj, ...keys: string[]): unknown {
  for (const k of keys) {
    if (o[k] !== undefined && o[k] !== null) return o[k];
  }
  return undefined;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function str(v: unknown): string {
  return v == null ? '' : String(v);
}

function normUnidad(v: unknown): Unidad {
  const s = str(v).toUpperCase().replace(/\s/g, '');
  if (s === 'KWH') return 'kWh';
  if (s === 'MWH') return 'MWh';
  if (s === 'GWH') return 'GWh';
  return 'kWh';
}

function normCantidad(raw: unknown): CantidadSpec {
  if (!isObj(raw)) return { unidad: 'kWh' };
  const unidad = normUnidad(pick(raw, 'unidad', 'unit', 'unidadMedida'));

  const spec: CantidadSpec = { unidad };

  const mensual = pick(raw, 'mensual', 'monthly', 'porMes', 'por_mes');
  if (Array.isArray(mensual)) {
    spec.mensual = mensual
      .filter(isObj)
      .map<CantidadMensual>((m) => ({
        anio: num(pick(m, 'anio', 'año', 'ano', 'year')),
        mes: num(pick(m, 'mes', 'month')),
        cantidad: num(pick(m, 'cantidad', 'valor', 'value', 'total')),
      }));
  }

  const patron = pick(raw, 'mensualPatron', 'mensual_patron', 'patron', 'patronMensual', 'patron_mensual');
  if (Array.isArray(patron)) {
    spec.mensualPatron = patron
      .filter(isObj)
      .map<CantidadPatron>((m) => ({
        mes: num(pick(m, 'mes', 'month')),
        cantidad: num(pick(m, 'cantidad', 'valor', 'value', 'total')),
      }));
  }

  const anual = pick(raw, 'anual', 'annual', 'porAnio', 'por_anio', 'totalesAnuales', 'totales_anuales');
  if (Array.isArray(anual)) {
    spec.anual = anual
      .filter(isObj)
      .map<CantidadAnual>((a) => ({
        anio: num(pick(a, 'anio', 'año', 'ano', 'year')),
        cantidad: num(pick(a, 'cantidad', 'valor', 'value', 'total')),
      }));
  }

  const cte = pick(raw, 'constanteAnual', 'constante_anual', 'anualConstante', 'totalAnual', 'total_anual');
  if (cte !== undefined) spec.constanteAnual = num(cte);

  return spec;
}

// Precio: number, array por año [{anio, precio}], o por (año,mes)
// [{anio, mes, precio}]. Detectamos por-mes si las entradas traen 'mes'.
function normPrecio(raw: unknown): Precio {
  if (raw == null) return 0;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') return Number(raw) || 0;
  if (Array.isArray(raw)) {
    const entries = raw.filter(isObj);
    const hasMes = entries.some((x) => pick(x, 'mes', 'month') !== undefined);
    if (hasMes) {
      return entries.map((x) => ({
        anio: num(pick(x, 'anio', 'año', 'ano', 'year')),
        mes: num(pick(x, 'mes', 'month')),
        precio: num(pick(x, 'precio', 'valor', 'value', 'price', 'cantidad')),
      }));
    }
    return entries.map((x) => ({
      anio: num(pick(x, 'anio', 'año', 'ano', 'year')),
      precio: num(pick(x, 'precio', 'valor', 'value', 'price', 'cantidad')),
    }));
  }
  return 0;
}

// Porcentaje adj: number o array por (año,mes) [{anio, mes, adj}].
function normAdj(raw: unknown): Adj {
  if (raw == null) return 0;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') return Number(raw) || 0;
  if (Array.isArray(raw)) {
    return raw.filter(isObj).map((x) => ({
      anio: num(pick(x, 'anio', 'año', 'ano', 'year')),
      mes: num(pick(x, 'mes', 'month')),
      adj: num(pick(x, 'adj', 'porcentajeAdj', 'porcentaje_adj', 'valor', 'value')),
    }));
  }
  return 0;
}

function normOferta(raw: unknown): OfertaCompact | null {
  if (!isObj(raw)) return null;
  return {
    agente: str(pick(raw, 'agente', 'Agente', 'agenteNombre', 'agente_nombre', 'nombre')),
    oferta: num(pick(raw, 'oferta', 'numeroOferta', 'numero_oferta', 'numOferta', 'alternativa')) || 1,
    curvaPlano: str(pick(raw, 'curvaPlano', 'curva_plano', 'Curva - Plano', 'curvaOPlano', 'tipo')),
    precio: normPrecio(pick(raw, 'precio', 'Precio', 'precioOferta', 'precio_oferta', 'precioPorAnio', 'precios')),
    porcentajeAdj: normAdj(pick(raw, 'porcentajeAdj', 'porcentaje_adj', 'Porcentaje adj', 'adj', 'porcentajeAdjudicado', 'adjPorMes', 'adjMensual')),
    cantidad: normCantidad(pick(raw, 'cantidad', 'cantidadOferta', 'cantidad_oferta')),
  };
}

function normProducto(raw: unknown): ProductoCompact | null {
  if (!isObj(raw)) return null;
  const ofertasRaw = pick(raw, 'ofertas', 'oferta', 'offers');
  const ofertas = Array.isArray(ofertasRaw)
    ? ofertasRaw.map(normOferta).filter((x): x is OfertaCompact => x !== null)
    : [];
  return {
    producto: (pick(raw, 'producto', 'id', 'numero', 'Producto', 'Producto Solicitado') as string | number) ?? '',
    fechaInicio: str(pick(raw, 'fechaInicio', 'fecha_inicio', 'Fecha inicio producto', 'inicio')),
    fechaFin: str(pick(raw, 'fechaFin', 'fecha_fin', 'Fecha fin producto', 'fin')),
    curvaPlano: str(pick(raw, 'curvaPlano', 'curva_plano', 'Curva - Plano', 'curvaOPlano')),
    precioReserva: normPrecio(pick(raw, 'precioReserva', 'precio_reserva', 'Precio Oferta Reserva', 'precioReservaPorAnio', 'preciosReserva')),
    reserva: normCantidad(pick(raw, 'reserva', 'cantidadReserva', 'cantidad_reserva')),
    ofertas,
  };
}

// Convierte un objeto crudo en ParseResult, o null si no luce como resultado.
function normalizeResult(raw: unknown): ParseResult | null {
  if (!isObj(raw)) return null;
  const conv = pick(raw, 'convocatoria', 'conv', 'serial', 'Conv');
  const productosRaw = pick(raw, 'productos', 'products');
  if (conv === undefined || !Array.isArray(productosRaw)) return null;

  const productos = productosRaw
    .map(normProducto)
    .filter((p): p is ProductoCompact => p !== null);

  const adv = pick(raw, 'advertencias', 'warnings', 'avisos');
  return {
    convocatoria: str(conv),
    ipp: str(pick(raw, 'ipp', 'IPP')) || undefined,
    advertencias: Array.isArray(adv) ? adv.map(str) : [],
    productos,
  };
}

// Candidatos a JSON: fences ```json ... ``` y objetos balanceados.
function candidateJsonStrings(text: string): string[] {
  const out: string[] = [];
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(text)) !== null) out.push(m[1].trim());

  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          out.push(text.slice(i, j + 1));
          i = j;
          break;
        }
      }
    }
  }
  return out;
}

// Devuelve el ParseResult normalizado si la respuesta trae el JSON final, o null.
export function extractFinalResult(text: string): ParseResult | null {
  for (const cand of candidateJsonStrings(text)) {
    try {
      const parsed = JSON.parse(cand);
      const norm = normalizeResult(parsed);
      if (norm && norm.productos.length > 0) return norm;
    } catch {
      // candidato invalido, seguir
    }
  }
  return null;
}

// Quita el bloque JSON del texto para mostrar solo el resumen en el chat.
export function stripJsonBlock(text: string): string {
  return text.replace(/```(?:json)?\s*[\s\S]*?```/gi, '').trim();
}
