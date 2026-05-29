import { useRef, useState } from 'react';
import { FileText, FileSpreadsheet, X } from 'lucide-react';

interface Props {
  label: string;
  accept: string;
  kind: 'pdf' | 'excel';
  fileName?: string | null;
  disabled?: boolean;
  onFile: (file: File) => void;
  onClear: () => void;
}

export default function DropZone({ label, accept, kind, fileName, disabled, onFile, onClear }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const Icon = kind === 'pdf' ? FileText : FileSpreadsheet;

  function pick(files: FileList | null) {
    if (files && files[0]) onFile(files[0]);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled) pick(e.dataTransfer.files);
      }}
      onClick={() => !disabled && inputRef.current?.click()}
      className={[
        'cursor-pointer rounded-lg border-2 border-dashed p-4 transition',
        over ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white hover:border-gray-400',
        disabled ? 'cursor-not-allowed opacity-60' : '',
      ].join(' ')}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => pick(e.target.files)}
      />
      <div className="flex items-center gap-3">
        <Icon className="h-6 w-6 shrink-0 text-gray-500" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-gray-700">{label}</div>
          {fileName ? (
            <div className="truncate text-xs text-green-700">{fileName}</div>
          ) : (
            <div className="text-xs text-gray-400">Arrastra o haz clic para seleccionar</div>
          )}
        </div>
        {fileName && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            title="Quitar archivo"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
