import { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  Check,
  Database,
  Download,
  FileJson,
  Folder,
  FileText,
  Upload,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { parseLexCoreBackupPayloads, type ParsedLexCoreBackup } from '../../lib/lexcoreImport';

interface LexCoreImportModalProps {
  open: boolean;
  onClose: () => void;
  onImported?: (firstDocId: string | null, newFolderIds: string[]) => void;
}

export function LexCoreImportModal({ open, onClose, onImported }: LexCoreImportModalProps) {
  const { state, importLexCoreBackup, notify } = useApp();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [rawPayloads, setRawPayloads] = useState<{ name: string; text: string }[]>([]);
  const [pastedJson, setPastedJson] = useState('');
  const [error, setError] = useState<string | null>(null);

  const allRawTexts = useMemo(() => {
    const arr = rawPayloads.map((p) => p.text);
    if (pastedJson.trim()) arr.push(pastedJson);
    return arr;
  }, [rawPayloads, pastedJson]);

  const preview: { parsed: ParsedLexCoreBackup | null; err: string | null } = useMemo(() => {
    if (allRawTexts.length === 0) return { parsed: null, err: null };
    try {
      const parsed = parseLexCoreBackupPayloads(allRawTexts);
      return { parsed, err: null };
    } catch (e) {
      return { parsed: null, err: (e as Error).message };
    }
  }, [allRawTexts]);

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    const loaded: { name: string; text: string }[] = [];
    for (const file of Array.from(files)) {
      try {
        const text = await file.text();
        loaded.push({ name: file.name, text });
      } catch {
        setError(`Impossible de lire ${file.name}`);
      }
    }
    setRawPayloads((prev) => [...prev, ...loaded]);
  };

  const handleConfirmImport = () => {
    if (!preview.parsed) return;
    const { folders, docs } = preview.parsed;
    if (folders.length === 0 && docs.length === 0) {
      setError(
        'Aucun texte ni dossier reconnu dans ce JSON. Vérifie que le fichier contient tes documents/notes.'
      );
      return;
    }
    const { foldersAdded, docsAdded, skipped } = importLexCoreBackup(folders, docs);
    notify(
      `Import terminé : ${docsAdded} texte${docsAdded > 1 ? 's' : ''}, ${foldersAdded} dossier${
        foldersAdded > 1 ? 's' : ''
      }${skipped > 0 ? ` (${skipped} doublon${skipped > 1 ? 's' : ''} ignoré${skipped > 1 ? 's' : ''})` : ''} ✓`
    );
    const firstActive = docs.find((d) => !d.deletedAt)?.id || null;
    onImported?.(
      firstActive,
      folders.map((f) => f.id)
    );
    setRawPayloads([]);
    setPastedJson('');
    setError(null);
    onClose();
  };

  const handleExportJson = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      source: 'kora-lexcore',
      folders: state.lyricsFolders,
      docs: state.lyricsDocs,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kora-textes-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify('Backup Textes exporté en JSON ✓');
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[75] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-950/50 dark:bg-black/75 backdrop-blur-xs"
          />

          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.97 }}
            className="relative z-10 w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl bg-white dark:bg-[#121215] border border-slate-200 dark:border-zinc-800 shadow-2xl overflow-hidden max-h-[88vh] flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-zinc-800">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 flex items-center justify-center">
                  <Database size={16} />
                </div>
                <div>
                  <h2 className="text-sm font-semibold">Importer / Exporter Textes (JSON)</h2>
                  <p className="text-[11px] text-slate-400">
                    Supporte JSON, MongoDB Compass, Atlas, Extended JSON & NDJSON
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 overflow-y-auto space-y-4 flex-1 text-xs">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,.ndjson,.txt,application/json"
                multiple
                onChange={(e) => {
                  void handleFilesSelected(e.target.files);
                  e.target.value = '';
                }}
                className="hidden"
              />

              {/* Dropzone */}
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void handleFilesSelected(e.dataTransfer.files);
                }}
                onClick={() => fileInputRef.current?.click()}
                className="rounded-2xl border-2 border-dashed border-slate-200 dark:border-zinc-800 hover:border-slate-400 dark:hover:border-zinc-600 p-5 text-center space-y-2 cursor-pointer transition bg-slate-50/60 dark:bg-zinc-900/40"
              >
                <div className="mx-auto h-10 w-10 rounded-xl bg-slate-900/8 dark:bg-zinc-100/10 text-slate-800 dark:text-zinc-200 flex items-center justify-center">
                  <Upload size={18} />
                </div>
                <p className="font-semibold text-slate-900 dark:text-zinc-100">
                  Glisse un ou plusieurs fichiers JSON ici
                </p>
                <p className="text-[11px] text-slate-400">
                  Tu peux sélectionner <code className="font-mono">folders.json</code> +{' '}
                  <code className="font-mono">documents.json</code> ensemble, ou un seul fichier backup complet.
                </p>
              </div>

              {/* Loaded files chips */}
              {rawPayloads.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {rawPayloads.map((p, idx) => (
                    <span
                      key={`${p.name}-${idx}`}
                      className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-zinc-800 pl-2.5 pr-1.5 py-1 text-[11px] font-medium text-slate-700 dark:text-zinc-200"
                    >
                      <FileJson size={12} className="text-[#FF5500]" />
                      {p.name}
                      <button
                        type="button"
                        onClick={() => setRawPayloads((prev) => prev.filter((_, i) => i !== idx))}
                        className="p-0.5 text-slate-400 hover:text-rose-500 cursor-pointer"
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Or Paste Raw JSON */}
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Ou colle directement ton JSON MongoDB ici
                </label>
                <textarea
                  rows={4}
                  value={pastedJson}
                  onChange={(e) => setPastedJson(e.target.value)}
                  placeholder='[{"_id": {"$oid": "..."}, "title": "Mon texte", "content": "..."}]'
                  className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 font-mono text-[11px] outline-none focus:border-slate-400 dark:focus:border-zinc-600 resize-none"
                />
              </div>

              {/* Error */}
              {(error || preview.err) && (
                <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 px-3 py-2.5 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <span>{error || preview.err}</span>
                </div>
              )}

              {/* Live Parsed Preview */}
              {preview.parsed && (
                <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/60 dark:bg-emerald-950/25 p-3.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                      <Check size={14} /> Prêt à importer
                    </span>
                    <div className="flex items-center gap-2 font-mono text-[11px] text-emerald-700 dark:text-emerald-300">
                      <span className="inline-flex items-center gap-1">
                        <Folder size={11} /> {preview.parsed.folders.length} dossier
                        {preview.parsed.folders.length > 1 ? 's' : ''}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <FileText size={11} /> {preview.parsed.docs.length} texte
                        {preview.parsed.docs.length > 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>
                  {preview.parsed.docs.length > 0 && (
                    <p className="text-[11px] text-emerald-700/80 dark:text-emerald-400/80 truncate">
                      Aperçu :{' '}
                      {preview.parsed.docs
                        .slice(0, 4)
                        .map((d) => d.title)
                        .join(' · ')}
                      {preview.parsed.docs.length > 4 ? ` (+${preview.parsed.docs.length - 4})` : ''}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3.5 border-t border-slate-100 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2 bg-slate-50/60 dark:bg-zinc-950/40">
              <button
                type="button"
                onClick={handleExportJson}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-zinc-800 px-3 py-2 text-xs font-medium text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                <Download size={13} /> Exporter JSON
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl px-3 py-2 text-xs font-medium text-slate-500 hover:text-slate-800 dark:hover:text-zinc-200 cursor-pointer"
                >
                  Fermer
                </button>
                <button
                  type="button"
                  disabled={
                    !preview.parsed ||
                    (preview.parsed.docs.length === 0 && preview.parsed.folders.length === 0)
                  }
                  onClick={handleConfirmImport}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 hover:opacity-90 px-4 py-2 text-xs font-semibold disabled:opacity-40 cursor-pointer"
                >
                  <Upload size={13} /> Importer dans Kora
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
