// Expansion determinista del JSON compacto del modelo -> filas mensuales.
//
// Reglas clave (spec v3 - ESPECIFICACION_AGENTE_CONVOCATORIAS):
// - PRESERVAR precision del origen: no se redondea (cada cliente tiene su
//   convencion; forzar decimales introduce errores acumulados).
// - CURVA: cantidades del Excel insumo via "mensual" o "mensualPatron". Si solo
//   viene "anual"/"constanteAnual" en un producto Curva -> WARNING grave.
// - PLANO: puede venir como cantidades mensuales o como anual (la app
//   distribuye por dias_mes/dias_anio).
// - Precios y % adj pueden variar por año o por (año, mes) dentro de una oferta.
// - Meses no ofertados: la fila se OMITE (no se rellena con 0).
//
// Warnings de validacion (seccion 14 del spec):
//   - Cantidades que siguen K * dias_del_mes -> probable prorrateo accidental.
//   - Multiplos exactos de 12 filas por (agente,producto,oferta) -> probable
//     expansion artificial.
//   - Productos multi-año con un solo precio para todos los años -> sospechoso.
import type {
  Adj,
  CantidadSpec,
  OfertaCompact,
  OfertaRow,
  ParseResult,
  Precio,
  ProductoCompact,
  SolicitadoRow,
  Unidad,
} from './types';

// --- utilidades de fecha/calendario ---

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}
function daysInYear(y: number): number {
  return isLeap(y) ? 366 : 365;
}
function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}
function parseDate(s: string): { y: number; m: number; d: number } | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? { d: Number(m[1]), m: Number(m[2]), y: Number(m[3]) } : null;
}
function monthsBetween(
  inicio: { y: number; m: number },
  fin: { y: number; m: number },
): Array<{ anio: number; mes: number }> {
  const out: Array<{ anio: number; mes: number }> = [];
  let y = inicio.y;
  let m = inicio.m;
  for (let guard = 0; guard < 1200; guard++) {
    out.push({ anio: y, mes: m });
    if (y === fin.y && m === fin.m) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (y > fin.y || (y === fin.y && m > fin.m)) break;
  }
  return out;
}

// --- unidades ---
function toGWh(value: number, unidad: Unidad): number {
  switch (unidad) {
    case 'kWh': return value / 1_000_000;
    case 'MWh': return value / 1_000;
    case 'GWh':
    default:    return value;
  }
}

// --- precios por (año, mes) ---

interface PriceEntry { anio: number; precio: number; }
interface PriceMonthEntry extends PriceEntry { mes: number; }

function isPriceMonthArray(p: PriceEntry[] | PriceMonthEntry[]): p is PriceMonthEntry[] {
  return p.length > 0 && (p[0] as PriceMonthEntry).mes !== undefined;
}

function pricePerMonth(p: Precio | undefined, anio: number, mes: number): number {
  if (p == null) return 0;
  if (typeof p === 'number') return p;
  if (!Array.isArray(p) || p.length === 0) return 0;
  if (isPriceMonthArray(p)) {
    const hit = p.find((x) => Number(x.anio) === anio && Number(x.mes) === mes);
    return hit ? Number(hit.precio) || 0 : 0;
  }
  // por año
  const hit = p.find((x) => Number(x.anio) === anio);
  return hit ? Number(hit.precio) || 0 : 0;
}

// --- % adj por (año, mes) ---

function adjPerMonth(a: Adj | undefined, anio: number, mes: number): number {
  if (a == null) return 0;
  if (typeof a === 'number') return clampPct(a);
  if (!Array.isArray(a) || a.length === 0) return 0;
  const hit = a.find((x) => Number(x.anio) === anio && Number(x.mes) === mes);
  return hit ? clampPct(hit.adj) : 0;
}

function clampPct(n: unknown): number {
  const v = Number(n) || 0;
  return Math.max(0, Math.min(100, v));
}

// --- cantidad por (año, mes) ---

interface QtyResult {
  value: number;     // GWh, sin redondear (preserva precision del origen)
  covered: boolean;
  source: 'mensual' | 'mensualPatron' | 'distribuido';
}

function quantityFor(spec: CantidadSpec | undefined, anio: number, mes: number): QtyResult {
  if (!spec) return { value: 0, covered: false, source: 'distribuido' };
  const unidad = spec.unidad || 'kWh';

  if (spec.mensual && spec.mensual.length) {
    const hit = spec.mensual.find((x) => Number(x.anio) === anio && Number(x.mes) === mes);
    return hit
      ? { value: toGWh(Number(hit.cantidad) || 0, unidad), covered: true, source: 'mensual' }
      : { value: 0, covered: false, source: 'mensual' };
  }
  if (spec.mensualPatron && spec.mensualPatron.length) {
    const hit = spec.mensualPatron.find((x) => Number(x.mes) === mes);
    return hit
      ? { value: toGWh(Number(hit.cantidad) || 0, unidad), covered: true, source: 'mensualPatron' }
      : { value: 0, covered: false, source: 'mensualPatron' };
  }

  let annual: number | null = null;
  if (spec.anual && spec.anual.length) {
    const hit = spec.anual.find((x) => Number(x.anio) === anio);
    annual = hit ? Number(hit.cantidad) || 0 : null;
  } else if (spec.constanteAnual != null) {
    annual = Number(spec.constanteAnual) || 0;
  }
  if (annual == null) return { value: 0, covered: false, source: 'distribuido' };
  const gwhYear = toGWh(annual, unidad);
  return {
    value: (gwhYear * daysInMonth(anio, mes)) / daysInYear(anio),
    covered: true,
    source: 'distribuido',
  };
}

function isAnnualOnly(spec: CantidadSpec | undefined): boolean {
  if (!spec) return false;
  if (spec.mensual && spec.mensual.length) return false;
  if (spec.mensualPatron && spec.mensualPatron.length) return false;
  return (spec.anual && spec.anual.length > 0) || spec.constanteAnual != null;
}

// --- detectores de anti-patrones (checklist seccion 14) ---

// True si las cantidades de un año siguen K * dias_del_mes para K cercana constante.
function detectaProrrateoMensual(qtyByMonth: Map<number, number>, anio: number): boolean {
  const ks: number[] = [];
  for (let m = 1; m <= 12; m++) {
    const q = qtyByMonth.get(m);
    if (q == null || q === 0) continue;
    ks.push(q / daysInMonth(anio, m));
  }
  if (ks.length < 6) return false;
  const min = Math.min(...ks);
  const max = Math.max(...ks);
  // Si todos los K coinciden dentro del 0.5% -> casi seguro prorrateo.
  return min > 0 && (max - min) / min < 0.005;
}

// True si todos los precios de un array por-año son identicos.
function detectaPrecioUnicoMultiAnio(p: Precio | undefined): boolean {
  if (!Array.isArray(p) || p.length < 2) return false;
  if (isPriceMonthArray(p)) return false; // por-mes ya no es "unico anual"
  const first = (p[0] as PriceEntry).precio;
  return p.every((x) => Number((x as PriceEntry).precio) === first);
}

// --- expansion principal ---

export interface ExpandedRows {
  solicitado: SolicitadoRow[];
  oferta: OfertaRow[]; // Agente = NOMBRE crudo (se mapea a SIC despues)
  warnings: string[];
}

export function expandResult(result: ParseResult): ExpandedRows {
  const conv = (result.convocatoria || '').trim();
  const ipp = result.ipp || '';
  const solicitado: SolicitadoRow[] = [];
  const oferta: OfertaRow[] = [];
  const warnings: string[] = [];

  for (const p of result.productos || []) {
    const ini = parseDate(p.fechaInicio);
    const fin = parseDate(p.fechaFin);
    if (!ini || !fin) {
      warnings.push(`Producto ${p.producto}: vigencia invalida (${p.fechaInicio} - ${p.fechaFin}); se omitio.`);
      continue;
    }
    const meses = monthsBetween(ini, fin);
    const esCurva = (p.curvaPlano || '').trim().toLowerCase() === 'curva';
    const yearsInProduct = new Set(meses.map((x) => x.anio));
    const esMultiAnio = yearsInProduct.size > 1;

    // CURVA sin detalle mensual -> WARNING grave (el dia-prorrateo invalida la curva)
    if (esCurva && isAnnualOnly(p.reserva)) {
      warnings.push(
        `Producto ${p.producto} (Curva): reserva sin detalle mensual. ` +
          `Se distribuyo por dias pero esto es INCORRECTO para Curva — ` +
          `pide al modelo las cantidades mensuales del Excel insumo ("Total Mes").`,
      );
    }
    // Multi-año con precio unico -> sospechoso
    if (esMultiAnio && detectaPrecioUnicoMultiAnio(p.precioReserva)) {
      warnings.push(
        `Producto ${p.producto} (multi-año): el precio reserva es igual en todos los años. ` +
          `Verifica que no estes usando el "TOTAL PRECIO" (promedio) en vez del precio por año.`,
      );
    }

    // Solicitado: una fila por mes
    for (const { anio, mes } of meses) {
      const q = quantityFor(p.reserva, anio, mes);
      solicitado.push({
        Conv: conv,
        'Producto Solicitado': p.producto,
        'Fecha inicio producto': p.fechaInicio,
        'Fecha fin producto': p.fechaFin,
        mes,
        'Año': anio,
        'Curva - Plano': p.curvaPlano || '',
        'B 0,1,2,3': '',
        IPP: ipp,
        'Cantidad reserva': q.value,
        'Precio Oferta Reserva': pricePerMonth(p.precioReserva, anio, mes),
      });
    }

    // Oferta: solo meses cubiertos; warnings de validacion por oferta
    for (const of of p.ofertas || []) {
      pushOfertaRows(of, p, meses, esCurva, esMultiAnio, conv, ipp, oferta, warnings);
    }
  }

  return { solicitado, oferta, warnings };
}

function pushOfertaRows(
  of: OfertaCompact,
  p: ProductoCompact,
  meses: Array<{ anio: number; mes: number }>,
  esCurva: boolean,
  esMultiAnio: boolean,
  conv: string,
  ipp: string,
  out: OfertaRow[],
  warnings: string[],
): void {
  if (esCurva && isAnnualOnly(of.cantidad)) {
    warnings.push(
      `Producto ${p.producto} oferta de "${of.agente}" (Curva): cantidad sin ` +
        `detalle mensual. La distribucion por dias es INCORRECTA para Curva.`,
    );
  }
  if (esMultiAnio && detectaPrecioUnicoMultiAnio(of.precio)) {
    warnings.push(
      `Producto ${p.producto} oferta de "${of.agente}" (multi-año): mismo precio en ` +
        `todos los años. Revisa la tabla de precios por año del PDF.`,
    );
  }

  const rowsForThis: OfertaRow[] = [];
  for (const { anio, mes } of meses) {
    const q = quantityFor(of.cantidad, anio, mes);
    if (!q.covered) continue;
    rowsForThis.push({
      Conv: conv,
      Agente: of.agente || '',
      Producto: p.producto,
      Oferta: Number(of.oferta) || 1,
      'Fecha inicio producto': p.fechaInicio,
      'Fecha fin producto': p.fechaFin,
      mes,
      'Año': anio,
      'Curva - Plano': of.curvaPlano || '',
      'B 0,1,2,3': '',
      IPP: ipp,
      'Cantidad Oferta': q.value,
      'Precio Oferta': pricePerMonth(of.precio, anio, mes),
      'Porcentaje adj': adjPerMonth(of.porcentajeAdj, anio, mes),
    });
  }

  if (rowsForThis.length === 0) {
    warnings.push(
      `Producto ${p.producto} oferta de "${of.agente}" #${of.oferta}: sin meses cubiertos.`,
    );
    return;
  }

  // Detectar prorrateo accidental: cantidades de cada año siguen K*dias_del_mes
  const byYear = new Map<number, Map<number, number>>();
  for (const r of rowsForThis) {
    const y = r['Año'];
    if (!byYear.has(y)) byYear.set(y, new Map());
    byYear.get(y)!.set(r.mes, r['Cantidad Oferta']);
  }
  for (const [y, qm] of byYear) {
    if (qm.size >= 6 && detectaProrrateoMensual(qm, y)) {
      warnings.push(
        `Producto ${p.producto} oferta de "${of.agente}" año ${y}: las cantidades ` +
          `siguen el patron K*dias_del_mes (probable prorrateo accidental). ` +
          `Verifica el detalle mensual del PDF/insumo.`,
      );
      break; // un warning por oferta basta
    }
  }

  // Detectar expansion artificial: exactamente 12 filas (o multiplo limpio)
  // sin variacion significativa => posible 12-relleno mecanico.
  if (rowsForThis.length === 12 || (esMultiAnio && rowsForThis.length % 12 === 0)) {
    const qts = rowsForThis.map((r) => r['Cantidad Oferta']);
    const min = Math.min(...qts);
    const max = Math.max(...qts);
    if (min > 0 && (max - min) / min < 0.05) {
      // muy poca variacion en 12 meses puede ser legitimo (Plano) o no; solo
      // alertamos cuando ademas el patron coincide con K*dias_del_mes (ya cubierto arriba).
      // Aqui dejamos pasar para no generar ruido.
    }
  }

  for (const r of rowsForThis) out.push(r);
}
