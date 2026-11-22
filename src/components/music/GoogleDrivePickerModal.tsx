import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  ArrowDownAZ,
  ArrowUpAZ,
  Calendar,
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
  listAllGoogleDriveAudioFiles,
  type DriveAudioFile,
} from '../../lib/googleDrive';
import { getDeterministicGradientId, parseTrackVersion } from '../../lib/musicVersioning';
import { saveMediaBlob } from '../../lib/mediaDb';
import { useApp } from '../../context/AppContext';
import { uid } from '../../utils/dates';

interface GoogleDrivePickerModalProps {
  open: boolean;
  onClose: () => void;
}

type SortBy = 'date' | 'name' | 'size';
type SortDir = 'desc' | 'asc';

function fmtSize(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function fmtShortDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Reads audio duration with strict timeout so iOS Safari never hangs indefinitely */
function readAudioDurationSafe(blob: Blob, timeoutMs = 2000): Promise<number> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(blob);
    const audio = new Audio();
    audio.preload = 'metadata';
    let settled = false;
    const finish = (sec: number) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      audio.src = '';
      URL.revokeObjectURL(objectUrl);
      resolve(sec);
    };
    const timer = window.setTimeout(() => finish(0), timeoutMs);
    audio.onloadedmetadata = () => finish(isFinite(audio.duration) ? Math.round(audio.duration) : 0);
    audio.onerror = () => finish(0);
    audio.src = objectUrl;
    try {
      audio.load();
    } catch {
      finish(0);
    }
  });
}

export function GoogleDrivePickerModal({ open, onClose }: GoogleDrivePickerModalProps) {
  const { state, addMusicTrack, syncMusicTracksBatch, notify } = useApp();

  const [token, setToken] = useState<string | null>(() => getCachedDriveToken());
  const [files, setFiles] = useState<DriveAudioFile[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const existingDriveIds = useMemo(
    () =>
      new Set(
        state.musicTracks.map((t) => t.googleDriveFileId).filter((id): id is string => Boolean(id))
      ),
    [state.musicTracks]
  );

  const sortedFiles = useMemo(() => {
    const mult = sortDir === 'asc' ? 1 : -1;
    return [...files].sort((a, b) => {
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name, 'fr', { numeric: true, sensitivity: 'base' }) * mult;
      }
      if (sortBy === 'size') {
        return (a.sizeBytes - b.sizeBytes) * mult;
      }
      const ta = a.modifiedTime ? new Date(a.modifiedTime).getTime() : 0;
      const tb = b.modifiedTime ? new Date(b.modifiedTime).getTime() : 0;
      return (ta - tb) * mult;
    });
  }, [files, sortBy, sortDir]);

  const loadFiles = async (activeToken: string, q = search) => {
    setLoading(true);
    setError(null);
    try {
      const list = await listAllGoogleDriveAudioFiles(activeToken, q);
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
    setSelectedIds(new Set());
    setError(null);
    const cached = getCachedDriveToken();
    if (cached) {
      setToken(cached);
      void loadFiles(cached, '');
      return;
    }
    // Try silent permanent zero-popup Drive access automatically on modal open!
    setLoading(true);
    void ensureGoogleDriveToken(state.preferences.firebaseConfig, false, false)
      .then((permToken) => {
        setToken(permToken);
        return loadFiles(permToken, '');
      })
      .catch((err) => {
        setToken(null);
        setLoading(false);
        if (err instanceof Error && err.name === 'DrivePermanentSetupRequiredError') {
          setError(err.message);
        }
      });
  }, [open]);

  const handleConnectDrive = async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const newToken = await ensureGoogleDriveToken(
        state.preferences.firebaseConfig,
        forceRefresh,
        false
      );
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

  const handleSelectSort = (nextBy: SortBy) => {
    if (sortBy === nextBy) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(nextBy);
      setSortDir(nextBy === 'name' ? 'asc' : 'desc');
    }
  };

  const handleSyncAllInstant = () => {
    if (files.length === 0 || importing) return;
    const artist = state.preferences.name || 'Moi';
    const nowIso = new Date().toISOString();
    const payload = files.map((f) => {
      const cleanTitle = f.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ').trim();
      const parsed = parseTrackVersion({ title: cleanTitle, sourceFilename: f.name });
      return {
        title: cleanTitle || f.name,
        artist,
        googleDriveFileId: f.id,
        sourceFilename: f.name,
        driveYearFolder: f.yearFolder,
        modifiedAt: f.modifiedTime || nowIso,
        coverGradient: getDeterministicGradientId(parsed.groupKey),
        status: 'maquette' as const,
        tags: ['Google Drive'],
        markers: [],
        addedAt: f.modifiedTime || nowIso,
      };
    });
    const { added, updated } = syncMusicTracksBatch(payload);
    if (added === 0 && updated === 0) {
      notify(`Tous tes ${files.length} MP3 Drive sont déjà synchronisés ✓`);
    } else {
      notify(
        `${added} MP3 ajouté${added > 1 ? 's' : ''}${
          updated > 0 ? ` · ${updated} mis à jour` : ''
        } (versions groupées automatiquement) ✓`
      );
    }
    onClose();
  };

  const handleImportSelected = async () => {
    if (!token || selectedIds.size === 0 || importing) return;
    const chosen = sortedFiles.filter((f) => selectedIds.has(f.id));
    setImporting(true);
    setImportProgress({ done: 0, total: chosen.length, label: chosen[0]?.name || '' });
    setError(null);

    let importedCount = 0;
    try {
      for (const file of chosen) {
        setImportProgress({ done: importedCount, total: chosen.length, label: file.name });
        const blob = await downloadGoogleDriveAudioBlob(token, file.id);
        const mediaId = uid('aud');
        // Save directly to local IndexedDB (fast, never blocks on Storage upload; Drive fileId handles cross-device sync!)
        await saveMediaBlob(mediaId, blob, file.name);
        const durationSec = await readAudioDurationSafe(blob);

        const cleanTitle = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ').trim();
        const parsed = parseTrackVersion({ title: cleanTitle, sourceFilename: file.name });
        addMusicTrack({
          title: cleanTitle,
          artist: state.preferences.name || 'Moi',
          mediaId,
          googleDriveFileId: file.id,
          sourceFilename: file.name,
          driveYearFolder: file.yearFolder,
          modifiedAt: file.modifiedTime || new Date().toISOString(),
          coverGradient: getDeterministicGradientId(parsed.groupKey),
          durationSec: durationSec || undefined,
          status: 'maquette',
          tags: ['Google Drive'],
          markers: [],
          addedAt: file.modifiedTime || new Date().toISOString(),
        });
        importedCount++;
        setImportProgress({ done: importedCount, total: chosen.length, label: file.name });
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
                  <h2 className="text-sm font-semibold">Google Drive · MP3</h2>
                  <p className="text-[11px] text-slate-400">
                    Importer uniquement tes fichiers MP3 dans ta bibliothèque
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

            <div className="p-5 overflow-y-auto space-y-3 flex-1">
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
                      Accès lecture seule à tes fichiers MP3. Les morceaux importés sont mis en cache pour la lecture hors-ligne et accessibles sur tous tes appareils.
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

                  {/* Sort Controls: Date / Nom / Taille + Direction */}
                  {files.length > 0 && (
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1">
                        <span className="text-[11px] text-slate-400 mr-0.5">Trier :</span>
                        <button
                          type="button"
                          onClick={() => handleSelectSort('date')}
                          className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium transition cursor-pointer ${
                            sortBy === 'date'
                              ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                              : 'bg-slate-100 dark:bg-zinc-800 text-slate-500 hover:text-slate-800 dark:hover:text-zinc-200'
                          }`}
                        >
                          <Calendar size={11} /> Date {sortBy === 'date' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSelectSort('name')}
                          className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium transition cursor-pointer ${
                            sortBy === 'name'
                              ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                              : 'bg-slate-100 dark:bg-zinc-800 text-slate-500 hover:text-slate-800 dark:hover:text-zinc-200'
                          }`}
                        >
                          {sortBy === 'name' && sortDir === 'desc' ? (
                            <ArrowUpAZ size={12} />
                          ) : (
                            <ArrowDownAZ size={12} />
                          )}
                          Nom {sortBy === 'name' ? (sortDir === 'asc' ? 'A→Z' : 'Z→A') : ''}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSelectSort('size')}
                          className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium transition cursor-pointer ${
                            sortBy === 'size'
                              ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                              : 'bg-slate-100 dark:bg-zinc-800 text-slate-500 hover:text-slate-800 dark:hover:text-zinc-200'
                          }`}
                        >
                          Taille {sortBy === 'size' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                        </button>
                      </div>
                      <span className="text-[10px] font-mono text-slate-400">
                        {sortedFiles.length} MP3
                      </span>
                    </div>
                  )}

                  {/* File List */}
                  {loading && sortedFiles.length === 0 ? (
                    <div className="py-10 flex items-center justify-center gap-2 text-xs text-slate-400">
                      <Loader2 size={15} className="animate-spin" /> Chargement de tes MP3…
                    </div>
                  ) : sortedFiles.length === 0 ? (
                    <p className="py-8 text-center text-xs text-slate-400">
                      Aucun fichier MP3 trouvé sur ton Google Drive.
                    </p>
                  ) : (
                    <div className="space-y-1.5 max-h-[42vh] overflow-y-auto pr-0.5">
                      {sortedFiles.map((f) => {
                        const alreadyImported = existingDriveIds.has(f.id);
                        const selected = selectedIds.has(f.id);
                        const dateStr = fmtShortDate(f.modifiedTime);
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
                                  {[fmtSize(f.sizeBytes), dateStr, alreadyImported ? 'Déjà dans Kora' : '']
                                    .filter(Boolean)
                                    .join(' · ')}
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
              <div className="px-5 py-3.5 border-t border-slate-100 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2 bg-slate-50/60 dark:bg-zinc-950/40">
                <span className="text-[11px] text-slate-500 truncate min-w-0">
                  {importProgress
                    ? `Import ${importProgress.done}/${importProgress.total} · ${importProgress.label}`
                    : selectedIds.size > 0
                    ? `${selectedIds.size} sélectionné${selectedIds.size > 1 ? 's' : ''}`
                    : `${sortedFiles.length} MP3 détectés`}
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  {sortedFiles.length > 0 && selectedIds.size === 0 && (
                    <button
                      type="button"
                      disabled={importing || loading}
                      onClick={handleSyncAllInstant}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-fuchsia-600 hover:bg-fuchsia-500 text-white px-3.5 py-2 text-xs font-semibold disabled:opacity-40 cursor-pointer transition"
                    >
                      <CloudDownload size={13} />
                      Tout charger ({sortedFiles.length})
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={importing}
                    className="rounded-xl px-3 py-2 text-xs font-medium text-slate-500 hover:text-slate-800 dark:hover:text-zinc-200 cursor-pointer"
                  >
                    Fermer
                  </button>
                  {selectedIds.size > 0 && (
                    <button
                      type="button"
                      disabled={importing}
                      onClick={() => void handleImportSelected()}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-4 py-2 text-xs font-semibold disabled:opacity-40 cursor-pointer"
                    >
                      {importing ? <Loader2 size={13} className="animate-spin" /> : <CloudDownload size={13} />}
                      Importer ({selectedIds.size})
                    </button>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
