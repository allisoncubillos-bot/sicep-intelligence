import { useMemo, useState } from 'react';
import { Download, AlertTriangle, Play, Loader2, RotateCcw } from 'lucide-react';
import DropZone from './components/DropZone';
import Chat from './components/Chat';
import TablePreview from './components/TablePreview';
import { SYSTEM_PROMPT } from './system-prompt';
import { loadPdf, loadExcel, pdfToBlock, excelToBlocks } from './lib/files';
import { sendChat } from './lib/api';
import { extractFinalResult, stripJsonBlock } from './lib/extractJson';
import { extractQuestion, stripQuestionBlock } from './lib/parseQuestion';
import { processResult, downloadWorkbook, type ProcessedResult } from './lib/excelOut';
import type { ChatMessage, ContentBlock, LoadedExcel, LoadedPdf, UIMessage } from './lib/types';

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

export default function App() {
  const [pdf, setPdf] = useState<LoadedPdf | null>(null);
  const [excel, setExcel] = useState<LoadedExcel | null>(null);

  const [apiMessages, setApiMessages] = useState<ChatMessage[]>([]);
  const [uiMessages, setUiMessages] = useState<UIMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processed, setProcessed] = useState<ProcessedResult | null>(null);

  const started = apiMessages.length > 0;
  const canProcess = !!pdf && !!excel && !thinking && !started;
  const canSend = started && !thinking;

  // --- Carga de archivos ---
  async function onPdf(file: File) {
    setError(null);
    try {
      setPdf(await loadPdf(file));
    } catch (e) {
      setError(`No se pudo leer el PDF: ${(e as Error).message}`);
    }
  }
  async function onExcel(file: File) {
    setError(null);
    try {
      setExcel(await loadExcel(file));
    } catch (e) {
      setError(`No se pudo leer el Excel: ${(e as Error).message}`);
    }
  }

  // --- Un turno de conversacion: envia historial y procesa la respuesta ---
  async function runTurn(nextApi: ChatMessage[], nextUi: UIMessage[]) {
    setApiMessages(nextApi);
    setUiMessages(nextUi);
    setThinking(true);
    setError(null);
    try {
      const { text } = await sendChat(nextApi, SYSTEM_PROMPT);
      const assistantApi: ChatMessage = { role: 'assistant', content: [{ type: 'text', text }] };
      // Texto mostrado: sin el bloque JSON final ni el bloque ```question.
      const displayText = stripQuestionBlock(stripJsonBlock(text));
      const question = extractQuestion(text);
      const assistantUi: UIMessage = {
        id: uid(),
        role: 'assistant',
        text: displayText || (question ? '' : '(resultado generado — ver tabla a la derecha)'),
        question: question ?? undefined,
      };
      setApiMessages([...nextApi, assistantApi]);
      setUiMessages([...nextUi, assistantUi]);

      const result = extractFinalResult(text);
      if (result) setProcessed(processResult(result));
    } catch (e) {
      setError((e as Error).message);
      setUiMessages([
        ...nextUi,
        { id: uid(), role: 'assistant', text: `⚠️ Error: ${(e as Error).message}` },
      ]);
    } finally {
      setThinking(false);
    }
  }

  function handleProcess() {
    if (!pdf || !excel) return;
    const blocks: ContentBlock[] = [
      pdfToBlock(pdf),
      ...excelToBlocks(excel),
      {
        type: 'text',
        text:
          'Procesa esta convocatoria SICEP. Adjunto el PDF de la audiencia pública y el Excel insumo ' +
          '(una hoja por documento, en CSV). Sigue los pasos del sistema. Si algo no es claro, pregúntame ' +
          'antes de generar el resultado final.',
      },
    ];
    runTurn(
      [{ role: 'user', content: blocks }],
      [{ id: uid(), role: 'user', text: 'Procesa esta convocatoria.', attachments: [pdf.name, excel.name] }],
    );
  }

  function handleSend(text: string) {
    // Si la ultima respuesta del assistant tenia una pregunta abierta, la
    // marcamos respondida para que la UI esconda los botones.
    const closedUi = uiMessages.map((m, i) =>
      i === uiMessages.length - 1 && m.role === 'assistant' && m.question && !m.answered
        ? { ...m, answered: true }
        : m,
    );
    runTurn(
      [...apiMessages, { role: 'user', content: [{ type: 'text', text }] }],
      [...closedUi, { id: uid(), role: 'user', text }],
    );
  }

  function reset() {
    setApiMessages([]);
    setUiMessages([]);
    setProcessed(null);
    setError(null);
    setThinking(false);
  }

  const okMappings = useMemo(
    () => (processed ? processed.mappings.filter((m) => m.codigo) : []),
    [processed],
  );

  return (
    <div className="flex h-full flex-col bg-gray-50 text-gray-900">
      <header className="flex items-center justify-between border-b bg-white px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold">Sicep TenderParser</h1>
          <p className="text-xs text-gray-500">
            Convocatorias de energía SICEP → Excel Solicitado / Oferta
          </p>
        </div>
        {started && (
          <button
            onClick={reset}
            className="flex items-center gap-1 rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Nueva convocatoria
          </button>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Panel izquierdo: archivos, descarga, advertencias */}
        <aside className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-r bg-white p-4">
          <section className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Archivos</h2>
            <DropZone
              label="PDF de audiencia"
              accept="application/pdf,.pdf"
              kind="pdf"
              fileName={pdf?.name}
              disabled={started}
              onFile={onPdf}
              onClear={() => setPdf(null)}
            />
            <DropZone
              label="Excel insumo"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              kind="excel"
              fileName={excel ? `${excel.name} (${excel.sheets.length} hojas)` : null}
              disabled={started}
              onFile={onExcel}
              onClear={() => setExcel(null)}
            />
            <button
              onClick={handleProcess}
              disabled={!canProcess}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {thinking && !started ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Procesar
            </button>
          </section>

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-xs text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {processed && (
            <>
              <section className="space-y-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Resultado</h2>
                <div className="rounded-lg border border-gray-200 p-3 text-xs">
                  <div className="font-medium text-gray-800">{processed.filename.replace('.xlsx', '')}</div>
                  <div className="text-gray-500">
                    {processed.solicitado.length} filas Solicitado · {processed.oferta.length} filas Oferta
                  </div>
                </div>
                <button
                  onClick={() => downloadWorkbook(processed)}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-green-600 py-2 text-sm font-medium text-white"
                >
                  <Download className="h-4 w-4" /> Descargar Excel
                </button>
              </section>

              <section className="space-y-1">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Agentes → código SIC
                </h2>
                <ul className="space-y-1 text-xs">
                  {processed.mappings.map((m) => (
                    <li key={m.nombre} className="flex items-center justify-between gap-2">
                      <span className="truncate text-gray-600" title={m.matchedNombre || m.nombre}>
                        {m.nombre}
                      </span>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 font-mono ${
                          m.codigo ? 'bg-gray-100 text-gray-700' : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {m.codigo || 'sin match'}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="pt-1 text-[11px] text-gray-400">
                  {okMappings.length}/{processed.mappings.length} agentes mapeados
                </p>
              </section>

              {(processed.unmapped.length > 0 || processed.advertencias.length > 0) && (
                <section className="space-y-1">
                  <h2 className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-amber-500">
                    <AlertTriangle className="h-3.5 w-3.5" /> Advertencias
                  </h2>
                  <ul className="list-disc space-y-1 pl-4 text-xs text-amber-700">
                    {processed.unmapped.map((u) => (
                      <li key={u}>
                        Agente sin código SIC: <span className="font-medium">{u}</span>
                      </li>
                    ))}
                    {processed.advertencias.map((w, i) => (
                      <li key={`w${i}`}>{w}</li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </aside>

        {/* Panel derecho: tabla (revisión) arriba + chat abajo.
            Uso ratios flex (no porcentajes) para que ambos respeten su area
            dentro del flex-col padre y no se superpongan. */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {processed && (
            <div className="flex min-h-0 flex-[3] flex-col overflow-hidden border-b bg-white p-4">
              <TablePreview processed={processed} />
            </div>
          )}
          <div className={`flex min-h-0 flex-col overflow-hidden ${processed ? 'flex-[2]' : 'flex-1'}`}>
            <Chat messages={uiMessages} thinking={thinking} canSend={canSend} onSend={handleSend} />
          </div>
        </main>
      </div>
    </div>
  );
}
