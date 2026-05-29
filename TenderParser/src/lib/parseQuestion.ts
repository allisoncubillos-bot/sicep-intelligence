// Detecta bloques ```question { ... } ``` en las respuestas del modelo y los
// convierte en una pregunta estructurada que la UI renderiza como selectores.
// Convencion: el contenido del fence es JSON con { question, options }.

export interface ModelQuestion {
  question: string;
  options: string[];
}

const FENCE_RE = /```question\s*([\s\S]*?)```/i;

// Extrae la primera pregunta detectada, o null. Tolera variantes minimas en las
// claves para no quebrarse si el modelo escribe en español o ingles.
export function extractQuestion(text: string): ModelQuestion | null {
  const m = FENCE_RE.exec(text);
  if (!m) return null;
  try {
    const raw = JSON.parse(m[1].trim()) as Record<string, unknown>;
    const question = String(raw.question ?? raw.pregunta ?? '').trim();
    const optsRaw = raw.options ?? raw.opciones ?? [];
    if (!question || !Array.isArray(optsRaw)) return null;
    const options = optsRaw.map((o) => String(o)).filter(Boolean);
    if (options.length === 0) return null;
    return { question, options };
  } catch {
    return null;
  }
}

// Quita el bloque ```question del texto para mostrar solo la prosa en la burbuja.
export function stripQuestionBlock(text: string): string {
  return text.replace(/```question\s*[\s\S]*?```/gi, '').trim();
}
