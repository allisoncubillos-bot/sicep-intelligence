import { useEffect, useRef, useState } from 'react';
import { Send, Loader2, Paperclip } from 'lucide-react';
import type { UIMessage } from '../lib/types';
import QuestionOptions from './QuestionOptions';

interface Props {
  messages: UIMessage[];
  thinking: boolean;
  canSend: boolean;
  onSend: (text: string) => void;
}

export default function Chat({ messages, thinking, canSend, onSend }: Props) {
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  function submit() {
    const t = text.trim();
    if (!t || !canSend) return;
    onSend(t);
    setText('');
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="mt-10 text-center text-sm text-gray-400">
            Carga el PDF y el Excel, luego pulsa <span className="font-medium">Procesar</span>.
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex flex-col items-start gap-1'}>
            <div
              className={[
                'max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm',
                m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800',
              ].join(' ')}
            >
              {m.attachments && m.attachments.length > 0 && (
                <div className="mb-1 flex flex-wrap gap-1">
                  {m.attachments.map((a) => (
                    <span
                      key={a}
                      className="inline-flex items-center gap-1 rounded bg-white/20 px-1.5 py-0.5 text-[11px]"
                    >
                      <Paperclip className="h-3 w-3" /> {a}
                    </span>
                  ))}
                </div>
              )}
              {m.text}
            </div>
            {m.role === 'assistant' && m.question && !m.answered && (
              <div className="max-w-[85%]">
                <QuestionOptions
                  question={m.question.question}
                  options={m.question.options}
                  disabled={!canSend}
                  onAnswer={(ans) => onSend(ans)}
                />
              </div>
            )}
          </div>
        ))}
        {thinking && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl bg-gray-100 px-4 py-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Pensando…
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t bg-white p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
            placeholder={canSend ? 'Escribe un mensaje…' : 'Esperando respuesta…'}
            disabled={!canSend}
            className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none disabled:bg-gray-50"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!canSend || !text.trim()}
            className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white disabled:opacity-40"
            title="Enviar"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
