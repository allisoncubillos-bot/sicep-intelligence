import { useState } from 'react';
import { SOLICITADO_COLUMNS, OFERTA_COLUMNS, type ProcessedResult } from '../lib/excelOut';

interface Props {
  processed: ProcessedResult;
}

type Tab = 'solicitado' | 'oferta';

function Table({ columns, rows }: { columns: readonly string[]; rows: Record<string, unknown>[] }) {
  return (
    <div className="overflow-auto rounded border border-gray-200">
      <table className="min-w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-gray-100">
          <tr>
            {columns.map((c) => (
              <th key={c} className="whitespace-nowrap border-b border-gray-200 px-2 py-1 text-left font-semibold text-gray-600">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={i % 2 ? 'bg-gray-50' : 'bg-white'}>
              {columns.map((c) => (
                <td key={c} className="whitespace-nowrap border-b border-gray-100 px-2 py-1 text-gray-700">
                  {r[c] === undefined || r[c] === null || r[c] === '' ? '' : String(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function TablePreview({ processed }: Props) {
  const [tab, setTab] = useState<Tab>('solicitado');
  const isSol = tab === 'solicitado';

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex gap-1">
        <button
          onClick={() => setTab('solicitado')}
          className={`rounded px-3 py-1 text-xs font-medium ${isSol ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}
        >
          Solicitado ({processed.solicitado.length})
        </button>
        <button
          onClick={() => setTab('oferta')}
          className={`rounded px-3 py-1 text-xs font-medium ${!isSol ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}
        >
          Oferta ({processed.oferta.length})
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {isSol ? (
          <Table columns={SOLICITADO_COLUMNS} rows={processed.solicitado as unknown as Record<string, unknown>[]} />
        ) : (
          <Table columns={OFERTA_COLUMNS} rows={processed.oferta as unknown as Record<string, unknown>[]} />
        )}
      </div>
    </div>
  );
}
