// Backend proxy minimo: unica responsabilidad = hablar con Anthropic guardando
// la API key fuera del cliente. El frontend hace POST /api/chat con el historial.
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';

// Preferimos SICEP_TENDERPARSER; si no, caemos a ANTHROPIC_API_KEY (la que ya
// usabas en el proyecto Python) para poder probar sin crear .env.
const API_KEY = process.env.SICEP_TENDERPARSER || process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.SICEP_MODEL || 'claude-opus-4-20250514';
// La API exige max_tokens; usamos el maximo de salida del modelo Opus 4.
const MAX_TOKENS = Number(process.env.SICEP_MAX_TOKENS || 32000);
const PORT = Number(process.env.PORT || 3001);

if (!API_KEY) {
  console.error('\n[FATAL] Falta la API key de Anthropic (SICEP_TENDERPARSER o ANTHROPIC_API_KEY).');
  console.error('Copia .env.example a .env y pon tu clave.\n');
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey: API_KEY });

const app = express();
app.use(cors());
// Los PDF en base64 pueden pesar varios MB; subimos el limite del body.
app.use(express.json({ limit: '50mb' }));

// Marca un breakpoint de prompt caching en el ultimo bloque de contenido dado.
// Cachear el system prompt y los documentos (que se reenvian en cada turno)
// reduce muchisimo costo y latencia en un chat multi-turno.
function withCacheControl(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return blocks;
  const last = blocks[blocks.length - 1];
  return [...blocks.slice(0, -1), { ...last, cache_control: { type: 'ephemeral' } }];
}

app.post('/api/chat', async (req, res) => {
  try {
    const { messages, system } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Body invalido: se espera { messages: [...] }' });
    }

    // Cachear el system prompt.
    const systemBlocks = system
      ? [{ type: 'text', text: String(system), cache_control: { type: 'ephemeral' } }]
      : undefined;

    // Cachear los documentos del primer mensaje del usuario (PDF + hojas Excel).
    let firstUserSeen = false;
    const apiMessages = messages.map((m) => {
      if (!firstUserSeen && m.role === 'user') {
        firstUserSeen = true;
        return { role: m.role, content: withCacheControl(m.content) };
      }
      return { role: m.role, content: m.content };
    });

    // Opus tiene 200k de contexto TOTAL (input + output). max_tokens fijo puede
    // pasarse cuando el input es grande, asi que contamos el input y ajustamos
    // max_tokens al espacio restante (con un margen de seguridad).
    const CONTEXT_LIMIT = 200000;
    const MARGIN = 2000;
    let maxTokens = MAX_TOKENS;
    try {
      const count = await anthropic.messages.countTokens({
        model: MODEL,
        ...(systemBlocks ? { system: systemBlocks } : {}),
        messages: apiMessages,
      });
      const room = CONTEXT_LIMIT - count.input_tokens - MARGIN;
      if (room < 1024) {
        return res.status(400).json({
          error:
            `La convocatoria es demasiado grande: el input ocupa ${count.input_tokens} tokens y ` +
            `no deja espacio para la respuesta (limite ${CONTEXT_LIMIT}). Reduce los archivos.`,
        });
      }
      maxTokens = Math.min(MAX_TOKENS, room);
    } catch (e) {
      // si countTokens falla, seguimos con un tope conservador
      console.warn('[countTokens] no disponible, uso tope conservador:', e?.message);
      maxTokens = Math.min(MAX_TOKENS, 16000);
    }

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      ...(systemBlocks ? { system: systemBlocks } : {}),
      messages: apiMessages,
    });

    const text = (response.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    res.json({ text, raw: response });
  } catch (err) {
    const status = err?.status || 500;
    const detail = err?.error?.error?.message || err?.message || 'Error desconocido';
    console.error('[ /api/chat ]', status, detail);
    res.status(status).json({ error: detail });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, model: MODEL }));

app.listen(PORT, () => {
  console.log(`\n  Sicep TenderParser proxy escuchando en http://localhost:${PORT}`);
  console.log(`  Modelo: ${MODEL}  |  max_tokens: ${MAX_TOKENS}\n`);
});
