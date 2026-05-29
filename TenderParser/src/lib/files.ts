// Carga de archivos en el cliente: PDF -> base64 (documento nativo),
// Excel -> CSV por hoja (documento text/plain, porque la API no acepta .xlsx).
import * as XLSX from 'xlsx';
import type { ContentBlock, LoadedExcel, LoadedExcelSheet, LoadedPdf } from './types';

// Lee un File como base64 puro (sin el prefijo "data:...;base64,").
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function loadPdf(file: File): Promise<LoadedPdf> {
  return { name: file.name, base64: await fileToBase64(file) };
}

// Convierte cada hoja del .xlsx a CSV. No interpreta ni resume: vuelca los
// valores de celda crudos. UNICA transformacion mecanica: colapsa las columnas
// de curva horaria HO1..HO24 en un total diario (no necesitamos el perfil hora
// a hora; sin esto las hojas de anexo revientan el tope de 200k tokens).
export async function loadExcel(file: File): Promise<LoadedExcel> {
  const buf = await file.arrayBuffer();
  return { name: file.name, sheets: excelBufferToSheets(buf) };
}

type Cell = string | number | boolean | null;

// Encabezados de columna horaria. El archivo mezcla formatos: HO1..HO9 y H10..H24
// (con o sin la 'O'). Cubrimos ambos: H, O opcional, espacio opcional, 1-2 digitos.
const HO_RE = /^H\s?O?\s*0*\d{1,2}$/i;

// Devuelve las hojas como CSV, colapsando columnas horarias si las hay.
export function excelBufferToSheets(buf: ArrayBuffer): LoadedExcelSheet[] {
  const wb = XLSX.read(buf, { type: 'array' });
  return wb.SheetNames.map((sheetName) => {
    const ws = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, blankrows: false, raw: true });
    const collapsed = collapseHourlyColumns(aoa);
    const csv = collapsed
      ? XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet(collapsed), { blankrows: false })
      : XLSX.utils.sheet_to_csv(ws, { blankrows: false });
    return { sheetName, csv };
  });
}

/**
 * Si la hoja tiene columnas HO1..HO24 (curva horaria), las suma en una sola
 * columna "Total dia (kWh)" y elimina las individuales. Devuelve la matriz
 * transformada, o null si no hay columnas horarias (se deja la hoja igual).
 */
function collapseHourlyColumns(aoa: Cell[][]): Cell[][] | null {
  // localizar la fila de encabezados: la que tenga >=3 celdas tipo "HOn"
  let headerIdx = -1;
  let hoCols: number[] = [];
  for (let r = 0; r < aoa.length; r++) {
    const cols: number[] = [];
    aoa[r].forEach((c, i) => {
      if (typeof c === 'string' && HO_RE.test(c.trim())) cols.push(i);
    });
    if (cols.length >= 3) {
      headerIdx = r;
      hoCols = cols;
      break;
    }
  }
  if (headerIdx === -1) return null;

  const hoSet = new Set(hoCols);
  const insertAt = Math.min(...hoCols); // donde va el total
  const keep = (i: number) => !hoSet.has(i);

  return aoa.map((row, r) => {
    const out: Cell[] = [];
    const maxLen = Math.max(row.length, insertAt + 1);
    for (let i = 0; i < maxLen; i++) {
      if (i === insertAt) {
        if (r === headerIdx) {
          out.push('Total dia (kWh)');
        } else if (r > headerIdx) {
          let sum = 0;
          let any = false;
          for (const c of hoCols) {
            const n = Number(row[c]);
            if (Number.isFinite(n) && row[c] !== null && row[c] !== '') {
              sum += n;
              any = true;
            }
          }
          out.push(any ? sum : null);
        } else {
          out.push(row[i] ?? null); // filas de titulo, sin datos horarios
        }
      }
      if (keep(i) && i < row.length) out.push(row[i]);
    }
    return out;
  });
}

// --- Construccion de bloques de contenido para el primer mensaje ---

export function pdfToBlock(pdf: LoadedPdf): ContentBlock {
  return {
    type: 'document',
    source: { type: 'base64', media_type: 'application/pdf', data: pdf.base64 },
    title: pdf.name,
    context: 'PDF de audiencia pública SICEP',
  };
}

// Un bloque documento (text/plain) por cada hoja del Excel insumo.
export function excelToBlocks(excel: LoadedExcel): ContentBlock[] {
  return excel.sheets.map((s) => ({
    type: 'document',
    source: { type: 'text', media_type: 'text/plain', data: s.csv || '(hoja vacía)' },
    title: `${excel.name} — hoja: ${s.sheetName}`,
    context: 'Hoja del Excel insumo convertida a CSV (valores de celda crudos).',
  }));
}
