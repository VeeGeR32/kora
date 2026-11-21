import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  Check,
  CloudDownload,
  FileAudio,
  HardDrive,
  Loader2,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import {
  downloadGoogleDriveAudioBlob,
  ensureGoogleDriveToken,
  getCachedDriveToken,
  listGoogleDriveAudioFiles,
  type DriveAudioFile,
} from '../../lib/googleDrive';
import { useApp } from '../../context/AppContext';
import { uid } from '../../utils/dates';

interface GoogleDrivePickerModalProps {
  open: boolean;
  onClose: () => void;
}

function fmtSize(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export function GoogleDrivePickerModal({ open, onClose }: GoogleDrivePickerModalProps) {
  const { state, addMusicTrack, saveAndOptionallySyncMedia, notify } = useApp();

  const [token, setToken] = useState<string | null>(() => getCachedDriveToken());
  const [files, setFiles] = useState<DriveAudioFile[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const existingDriveIds = new Set(
    state.musicTracks.map((t) => t.googleDriveFileId).filter((id): id is string => Boolean(id))
  );

  const loadFiles = async (activeToken: string, q = search) => {
    setLoading(true);
    setError(null);
    try {
      const list = await listGoogleDriveAudioFiles(activeToken, q);
      setFiles(list);
    } catch (err) {
      setError((err as Error).message);
      if (!getCachedDriveToken()) setToken(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const cached = getCachedDriveToken();
    setToken(cached);
    setSelectedIds(new Set());
    setError(null);
    if (cached) {
      void loadFiles(cached, '');
    }
  }, [open]);

  const handleConnectDrive = async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const newToken = await ensureGoogleDriveToken(state.preferences.firebaseConfig, forceRefresh);
      setToken(newToken);
      await loadFiles(newToken, search);
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleImportSelected = async () => {
    if (!token || selectedIds.size === 0 || importing) return;
    const chosen = files.filter((f) => selectedIds.has(f.id));
    setImporting(true);
    setImportProgress({ done: 0, total: chosen.length });
    setError(null);

    let importedCount = 0;
    try {
      for (const file of chosen) {
        const blob = await downloadGoogleDriveAudioBlob(token, file.id);
        const mediaId = uid('aud');
        const saved = await saveAndOptionallySyncMedia(mediaId, blob, file.name);

        const objectUrl = URL.createObjectURL(blob);
        const durationSec = await new Promise<number>((resolve) => {
          const a = new Audio(objectUrl);
          a.onloadedmetadata = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(isFinite(a.duration) ? Math.round(a.duration) : 0);
          };
          a.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(0);
          };
        });

        const cleanTitle = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ');
        addMusicTrack({
          title: cleanTitle,
          artist: state.preferences.name || 'Moi',
          mediaId: saved.mediaId,
          cloudAudioUrl: saved.cloudUrl,
          googleDriveFileId: file.id,
          durationSec: durationSec || undefined,
          status: 'demo',
          tags: ['Google Drive'],
          markers: [],
          addedAt: new Date().toISOString(),
        });
        importedCount++;
        setImportProgress({ done: importedCount, total: chosen.length });
      }
      notify(
        `${importedCount} morceau${importedCount > 1 ? 'x' : ''} importé${importedCount > 1 ? 's' : ''} depuis Google Drive ✓`
      );
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-950/40 dark:bg-black/70 backdrop-blur-xs"
          />

          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.97 }}
            className="relative z-10 w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl bg-white dark:bg-[#121215] border border-slate-200 dark:border-zinc-800 shadow-2xl overflow-hidden max-h-[85vh] flex flex-col"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-zinc-800">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 flex items-center justify-center">
                  <HardDrive size={15} />
                </div>
                <div>
                  <h2 className="text-sm font-semibold">Google Drive · Audio</h2>
                  <p className="text-[11px] text-slate-400">
                    Importer tes MP3, WAV & M4A directement dans ta bibliothèque
                  </p>
                </div>
              </div>
              <button type="button" onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer">
                <X size={16} />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-3.5 flex-1">
              {error && (
                <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 px-3 py-2.5 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2 leading-relaxed">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {!token ? (
                <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 p-6 text-center space-y-3">
                  <div className="mx-auto h-11 w-11 rounded-2xl bg-slate-100 dark:bg-zinc-900 flex items-center justify-center text-slate-700 dark:text-zinc-200">
                    <CloudDownload size={20} />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">Connecter ton Google Drive</p>
                    <p className="text-xs text-slate-500 dark:text-zinc-400 leading-relaxed">
                      Accès lecture seule à tes fichiers audio. Les morceaux importés sont mis en cache pour la lecture hors-ligne et accessibles sur tous tes appareils.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void handleConnectDrive(false)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-4 py-2.5 text-xs font-semibold hover:opacity-92 cursor-pointer disabled:opacity-50"
                  >
                    {loading ? <Loader2 size={14} className="animate-spin" /> : <HardDrive size={14} />}
                    Autoriser Google Drive
                  </button>
                </div>
              ) : (
                <>
                  {/* Search Bar */}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void loadFiles(token, search);
                    }}
                    className="flex items-center gap-1.5"
                  >
                    <div className="relative flex-1">
                      <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Rechercher un MP3 sur ton Drive…"
                        className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 pl-8 pr-3 py-2 text-xs outline-none focus:border-slate-400 dark:focus:border-zinc-600"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={loading}
                      className="rounded-xl border border-slate-200 dark:border-zinc-800 px-3 py-2 text-xs font-medium text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer"
                    >
                      Chercher
                    </button>
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => void loadFiles(token, search)}
                      title="Actualiser"
                      className="h-8 w-8 rounded-xl border border-slate-200 dark:border-zinc-800 flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer shrink-0"
                    >
                      <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                    </button>
                  </form>

                  {/* File List */}
                  {loading && files.length === 0 ? (
                    <div className="py-10 flex items-center justify-center gap-2 text-xs text-slate-400">
                      <Loader2 size={15} className="animate-spin" /> Chargement de tes fichiers audio…
                    </div>
                  ) : files.length === 0 ? (
                    <p className="py-8 text-center text-xs text-slate-400">
                      Aucun fichier audio (.mp3, .wav, .m4a) trouvé.
                    </p>
                  ) : (
                    <div className="space-y-1.5 max-h-[42vh] overflow-y-auto pr-0.5">
                      {files.map((f) => {
                        const alreadyImported = existingDriveIds.has(f.id);
                        const selected = selectedIds.has(f.id);
                        return (
                          <button
                            key={f.id}
                            type="button"
                            disabled={importing}
                            onClick={() => toggleSelect(f.id)}
                            className={`w-full flex items-center justify-between gap-2.5 rounded-xl px-3 py-2.5 text-left border transition cursor-pointer ${
                              selected
                                ? 'border-slate-900 dark:border-zinc-100 bg-slate-900/5 dark:bg-zinc-100/8'
                                : 'border-slate-200/70 dark:border-zinc-800/80 hover:bg-slate-50 dark:hover:bg-zinc-900/60'
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div
                                className={`h-5 w-5 rounded-md border flex items-center justify-center shrink-0 transition ${
                                  selected
                                    ? 'bg-slate-900 dark:bg-zinc-100 border-slate-900 dark:border-zinc-100 text-white dark:text-zinc-950'
                                    : 'border-slate-300 dark:border-zinc-700'
                                }`}
                              >
                                {selected && <Check size={12} strokeWidth={3} />}
                              </div>
                              <FileAudio size={14} className="text-fuchsia-500 shrink-0" />
                              <div className="min-w-0">
                                <p className="text-xs font-medium text-slate-800 dark:text-zinc-100 truncate">
                                  {f.name}
                                </p>
                                <p className="text-[10px] text-slate-400 font-mono">
                                  {fmtSize(f.sizeBytes)}
                                  {alreadyImported ? ' · Déjà dans Kora' : ''}
                                </p>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>

            {token && (
              <div className="px-5 py-3.5 border-t border-slate-100 dark:border-zinc-800 flex items-center justify-between gap-2 bg-slate-50/60 dark:bg-zinc-950/40">
                <span className="text-[11px] text-slate-500">
                  {importProgress
                    ? `Import ${importProgress.done}/${importProgress.total}…`
                    : `${selectedIds.size} sélectionné${selectedIds.size > 1 ? 's' : ''}`}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={importing}
                    className="rounded-xl px-3 py-2 text-xs font-medium text-slate-500 hover:text-slate-800 dark:hover:text-zinc-200 cursor-pointer"
                  >
                    Fermer
                  </button>
                  <button
                    type="button"
                    disabled={selectedIds.size === 0 || importing}
                    onClick={() => void handleImportSelected()}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-4 py-2 text-xs font-semibold disabled:opacity-40 cursor-pointer"
                  >
                    {importing ? <Loader2 size={13} className="animate-spin" /> : <CloudDownload size={13} />}
                    Importer
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
