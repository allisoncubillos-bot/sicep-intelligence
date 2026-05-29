import { useState } from 'react';
import { CornerDownLeft } from 'lucide-react';

interface Props {
  question: string;
  options: string[];
  disabled?: boolean;
  onAnswer: (answer: string) => void;
}

// Renderiza una pregunta del assistant con botones de opcion + campo "Otro"
// para respuesta libre. Imita el patron de AskUserQuestion de Claude Code.
export default function QuestionOptions({ question, options, disabled, onAnswer }: Props) {
  const [other, setOther] = useState('');
  const [showOther, setShowOther] = useState(false);

  function submitOther() {
    const t = other.trim();
    if (!t) return;
    onAnswer(t);
    setOther('');
    setShowOther(false);
  }

  return (
    <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
      <div className="mb-2 text-sm font-medium text-blue-900">{question}</div>
      <div className="flex flex-col gap-1.5">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            disabled={disabled}
            onClick={() => onAnswer(opt)}
            className="rounded border border-blue-300 bg-white px-3 py-1.5 text-left text-sm text-gray-800 hover:bg-blue-100 disabled:opacity-50"
          >
            {opt}
          </button>
        ))}
        {!showOther ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setShowOther(true)}
            className="rounded border border-dashed border-blue-300 bg-white px-3 py-1.5 text-left text-sm text-blue-700 hover:bg-blue-100 disabled:opacity-50"
          >
            Otro…
          </button>
        ) : (
          <div className="flex gap-1">
            <input
              autoFocus
              value={other}
              onChange={(e) => setOther(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitOther();
                else if (e.key === 'Escape') {
                  setShowOther(false);
                  setOther('');
                }
              }}
              placeholder="Escribe tu respuesta…"
              disabled={disabled}
              className="flex-1 rounded border border-blue-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none disabled:opacity-50"
            />
            <button
              type="button"
              onClick={submitOther}
              disabled={disabled || !other.trim()}
              className="rounded bg-blue-600 px-2 text-white disabled:opacity-40"
              title="Enviar"
            >
              <CornerDownLeft className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
