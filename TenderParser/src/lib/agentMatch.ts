// Mapeo de nombre de agente -> codigo SIC.
// Replica la logica de parser.py (normalize_name, aliases, preferencia GENERADOR,
// exacto -> prefijo -> fuzzy) en TypeScript para correr en el cliente.

import { AGENTS, type Agent } from '../agents';
import type { AgentMapping } from './types';

// --- Normalizacion: sin tildes, mayusculas, sin sufijos legales ---

const SUFFIX_PATTERNS: RegExp[] = [
  /\bS\.?\s*A\.?\s*S?\.?\b/g,
  /\bE\.?\s*S\.?\s*P\.?\b/g,
  /\bE\.?\s*I\.?\s*C\.?\s*E\.?\b/g,
  /\bS\.?\s*C\.?\s*A\.?\b/g,
  /\bCIA\.?\b/g,
  /\bY\b/g,
  /\bCOMERCIALIZADOR\w*\b/g,
  /\bGENERADOR\w*\b/g,
  /\bGENERACI[OÓ]N\b/g,
  /\bCOMERCIALIZACI[OÓ]N\b/g,
  /\bBENEFICIO\b/g,
  /\bE\s+INT\w*\b/g,
];

export function normalizeName(input: string): string {
  if (!input) return '';
  // quitar tildes/diacriticos
  let s = input.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  s = s.toUpperCase();
  for (const re of SUFFIX_PATTERNS) s = s.replace(re, ' ');
  s = s.replace(/[^A-Z0-9]+/g, ' ').trim();
  return s.replace(/\s+/g, ' ');
}

// --- Alias de nombres comerciales -> nombre legal del SIC ---

const SIC_NAME_ALIASES: Record<string, string> = {
  ESPROD: 'ESPACIO PRODUCTIVO',
  PUTUMAYO: 'EMPRESA DE ENERGIA DEL PUTUMAYO',
  'IA ENERGIA': 'IA ENERGIA Y GESTION',
  'IA ENERGIA Y GESTION': 'IA ENERGIA Y GESTION',
  TERMOTASAJERO: 'TERMOTASAJERO',
  'TERMOTASAJERO DOS': 'TERMOTASAJERO DOS',
  CELSIA: 'CELSIA COLOMBIA',
  BTG: 'BTG PACTUAL',
  'BTG PACTUAL': 'BTG PACTUAL',
  'BTG PACTUAL COMMODITIES COLOMBIA': 'BTG PACTUAL',
  DEPI: 'DEPI ENERGY',
  'DEPI ENERGY': 'DEPI ENERGY',
  TERMOYOPAL: 'TERMOYOPAL GENERACION',
  'TERMOYOPAL GENERACION 2': 'TERMOYOPAL GENERACION',
  ZONERGY: 'ZONERGY',
  'ZONERGY COLOMBIA': 'ZONERGY',
  GENERARCO: 'GENERARCO',
  'BEAM ENERGY': 'BEAM ENERGY',
  'EMPRESAS PUBLICAS DE MEDELLIN': 'EMPRESAS PUBLICAS DE MEDELLIN',
  EPM: 'EMPRESAS PUBLICAS DE MEDELLIN',
  ENGIE: 'ENGIE COLOMBIA',
  ENEL: 'ENEL COLOMBIA',
  'ENEL COLOMBIA': 'ENEL COLOMBIA',
  PROENERGY: 'PROENERGY',
};

function resolveAlias(name: string): string {
  const n = name.trim().toUpperCase();
  if (SIC_NAME_ALIASES[n]) return SIC_NAME_ALIASES[n];
  // del mas largo al mas corto, para que el alias mas especifico gane
  const keys = Object.keys(SIC_NAME_ALIASES).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (n === k || n.startsWith(k + ' ') || n.startsWith(k + '-') || n.startsWith(k + ',')) {
      return SIC_NAME_ALIASES[k];
    }
  }
  return name;
}

// --- Indice de agentes (normalizado una sola vez) ---

interface SicEntry extends Agent {
  norm: string;
}

const SIC_ENTRIES: SicEntry[] = AGENTS.map((a) => ({ ...a, norm: normalizeName(a.nombre) }));

// Spec v3: Generador primero, Comercializador fallback. Los vendedores en
// convocatorias de compra registran contratos ante XM/ASIC mayoritariamente
// como Generadores cuando esa actividad esta disponible para ellos.
function isGenerator(e: SicEntry): boolean {
  const c = e.codigo.toUpperCase();
  const n = e.nombre.toUpperCase();
  return c.endsWith('G') || /GENERADOR|GENERACI/.test(n);
}

// --- Similitud difusa: token-set (Dice sobre tokens) + ratio de caracteres ---

function tokenSetScore(a: string, b: string): number {
  const A = new Set(a.split(' ').filter(Boolean));
  const B = new Set(b.split(' ').filter(Boolean));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return (2 * inter) / (A.size + B.size);
}

// Levenshtein normalizado (0..1) para nombres de pocos tokens.
function charRatio(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const m = a.length;
  const n = b.length;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return 1 - dp[n] / Math.max(m, n);
}

function fuzzyScore(a: string, b: string): number {
  return Math.max(tokenSetScore(a, b), charRatio(a, b));
}

function preferGenerator(cands: Array<{ e: SicEntry; s: number }>): { e: SicEntry; s: number } {
  const gen = cands.filter((c) => isGenerator(c.e));
  const pool = gen.length ? gen : cands;
  return pool.reduce((best, c) => (c.s > best.s ? c : best));
}

const THRESHOLD = 0.78;

/**
 * Mapea un nombre de agente a su codigo SIC.
 * En convocatorias de compra el vendedor es el GENERADOR; se prefiere el codigo
 * terminado en 'G' cuando un mismo agente tiene entradas G y C.
 */
export function mapAgentToSic(agentName: string): AgentMapping {
  if (!agentName) return { nombre: agentName, codigo: null, score: 0 };

  const trimmed = agentName.trim().toUpperCase();
  // si ya es un codigo SIC literal (3-5 letras)
  if (/^[A-Z]{3,5}$/.test(trimmed)) {
    const hit = SIC_ENTRIES.find((e) => e.codigo.toUpperCase() === trimmed);
    if (hit) return { nombre: agentName, codigo: hit.codigo, matchedNombre: hit.nombre, score: 100 };
  }

  const norm = normalizeName(resolveAlias(agentName));
  if (!norm) return { nombre: agentName, codigo: null, score: 0 };

  // 1) exacto por nombre normalizado
  let cands = SIC_ENTRIES.filter((e) => e.norm === norm).map((e) => ({ e, s: 1 }));
  // 2) por prefijo
  if (cands.length === 0) {
    cands = SIC_ENTRIES.filter((e) => e.norm.startsWith(norm) || norm.startsWith(e.norm)).map(
      (e) => ({ e, s: 0.95 }),
    );
  }
  if (cands.length > 0) {
    const { e, s } = preferGenerator(cands);
    return { nombre: agentName, codigo: e.codigo, matchedNombre: e.nombre, score: Math.round(s * 100) };
  }

  // 3) fuzzy
  const scored = SIC_ENTRIES.map((e) => ({ e, s: fuzzyScore(norm, e.norm) }));
  const above = scored.filter((c) => c.s >= THRESHOLD);
  if (above.length > 0) {
    const { e, s } = preferGenerator(above);
    return { nombre: agentName, codigo: e.codigo, matchedNombre: e.nombre, score: Math.round(s * 100) };
  }

  const best = scored.reduce((b, c) => (c.s > b.s ? c : b), { e: SIC_ENTRIES[0], s: 0 });
  return { nombre: agentName, codigo: null, score: Math.round(best.s * 100) };
}

// Mapea todos los nombres unicos de un set de filas de oferta.
export function buildAgentMappings(names: string[]): Map<string, AgentMapping> {
  const out = new Map<string, AgentMapping>();
  for (const name of names) {
    if (!out.has(name)) out.set(name, mapAgentToSic(name));
  }
  return out;
}
