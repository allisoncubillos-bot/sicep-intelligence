// Cliente del frontend hacia el backend proxy (/api/chat).
// El proxy es quien habla con Anthropic y guarda la API key.
import type { ChatMessage } from './types';

export interface ChatResponse {
  text: string; // texto concatenado de la respuesta del assistant
  raw?: unknown; // respuesta cruda de la API (por si se necesita)
}

export async function sendChat(messages: ChatMessage[], system: string): Promise<ChatResponse> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, system }),
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      detail = err?.error || err?.message || JSON.stringify(err);
    } catch {
      detail = (await res.text()) || detail;
    }
    throw new Error(detail);
  }

  return res.json();
}
