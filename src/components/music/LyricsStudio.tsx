import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Circle,
  Disc3,
  Edit3,
  Eye,
  FileText,
  Folder,
  FolderPlus,
  Music2,
  Pause,
  Play,
  Plus,
  Redo,
  RefreshCcw,
  Repeat,
  Search,
  Sparkles,
  Trash2,
  Undo,
  Upload,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAudioPlayer } from '../../context/AudioPlayerContext';
import { YoutubeBeatPlayer } from './YoutubeBeatPlayer';
import { LexCoreInspirationWidget, MetronomeWidget } from './LexCoreTools';
import { LexCoreImportModal } from './LexCoreImportModal';

interface LyricsStudioProps {
  initialDocId?: string | null;
}

const STATUS_META: Record<1 | 2 | 3, { label: string; dot: string; badge: string }> = {
  1: {
    label: 'Brouillon',
    dot: 'text-slate-300 dark:text-zinc-600',
    badge: 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300',
  },
  2: {
    label: 'En cours',
    dot: 'text-amber-500',
    badge: 'bg-amber-500/12 text-amber-700 dark:text-amber-300',
  },
  3: {
    label: 'Terminé',
    dot: 'text-emerald-500',
    badge: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
  },
};

function fmt(sec: number) {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtShortDate(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function LyricsStudio({ initialDocId }: LyricsStudioProps) {
  const {
    state,
    addLyricsFolder,
    deleteLyricsFolder,
    addLyricsDoc,
    updateLyricsDoc,
    softDeleteLyricsDoc,
    restoreLyricsDoc,
    permanentDeleteLyricsDoc,
    emptyLyricsTrash,
  } = useApp();

  const player = useAudioPlayer();

  // Only open the full-screen editor when a doc is explicitly opened (or passed via initialDocId)
  const [activeDocId, setActiveDocId] = useState<string | null>(initialDocId || null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [beatBarOpen, setBeatBarOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'docs' | 'trash'>('docs');
  const [selectedFolderId, setSelectedFolderId] = useState<string | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<0 | 1 | 2 | 3>(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [markdownMode, setMarkdownMode] = useState<'edit' | 'preview'>('edit');
  const [beatMode, setBeatMode] = useState<'mp3' | 'youtube'>('mp3');
  const [newFolderInput, setNewFolderInput] = useState<string | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Undo / Redo per active doc
  const [history, setHistory] = useState<string[]>([]);
  const [historyStep, setHistoryStep] = useState(-1);
  const isUndoing = useRef(false);

  useEffect(() => {
    if (initialDocId) {
      setActiveDocId(initialDocId);
      setViewMode('docs');
    }
  }, [initialDocId]);

  const activeDoc = useMemo(
    () => state.lyricsDocs.find((d) => d.id === activeDocId && !d.deletedAt) || null,
    [state.lyricsDocs, activeDocId]
  );

  const linkedTrack = useMemo(
    () => state.musicTracks.find((t) => t.id === activeDoc?.linkedTrackId) || null,
    [state.musicTracks, activeDoc?.linkedTrackId]
  );

  useEffect(() => {
    if (activeDoc) {
      setBeatMode(activeDoc.linkedTrackId ? 'mp3' : activeDoc.mediaUrl ? 'youtube' : 'mp3');
      setBeatBarOpen(Boolean(activeDoc.linkedTrackId || activeDoc.mediaUrl));
      setHistory([activeDoc.content]);
      setHistoryStep(0);
      setMarkdownMode('edit');
    }
  }, [activeDocId]);

  // Escape key closes full-screen editor cleanly
  useEffect(() => {
    if (!activeDoc) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !importModalOpen) {
        setActiveDocId(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeDoc, importModalOpen]);

  const visibleDocs = useMemo(() => {
    return state.lyricsDocs
      .filter((d) => !d.deletedAt)
      .sort((a, b) => new Date(b.lastModified || 0).getTime() - new Date(a.lastModified || 0).getTime());
  }, [state.lyricsDocs]);

  const trashedDocs = useMemo(
    () => state.lyricsDocs.filter((d) => Boolean(d.deletedAt)),
    [state.lyricsDocs]
  );

  const filteredDocs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return visibleDocs.filter((d) => {
      if (selectedFolderId !== 'all' && d.folderId !== selectedFolderId) return false;
      if (statusFilter !== 0 && d.status !== statusFilter) return false;
      if (q && !d.title.toLowerCase().includes(q) && !d.content.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [visibleDocs, selectedFolderId, statusFilter, searchQuery]);

  const folderMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of state.lyricsFolders) map.set(f.id, f.name);
    return map;
  }, [state.lyricsFolders]);

  const trackMap = useMemo(() => {
    const map = new Map(state.musicTracks.map((t) => [t.id, t]));
    return map;
  }, [state.musicTracks]);

  const handleContentChange = (nextContent: string) => {
    if (!activeDoc) return;
    if (!isUndoing.current) {
      const nextHist = history.slice(0, historyStep + 1);
      nextHist.push(nextContent);
      setHistory(nextHist);
      setHistoryStep(nextHist.length - 1);
    }
    updateLyricsDoc(activeDoc.id, { content: nextContent });
  };

  const handleUndo = () => {
    if (!activeDoc || historyStep <= 0) return;
    isUndoing.current = true;
    const prev = history[historyStep - 1];
    setHistoryStep(historyStep - 1);
    updateLyricsDoc(activeDoc.id, { content: prev });
    window.setTimeout(() => {
      isUndoing.current = false;
    }, 60);
  };

  const handleRedo = () => {
    if (!activeDoc || historyStep >= history.length - 1) return;
    isUndoing.current = true;
    const next = history[historyStep + 1];
    setHistoryStep(historyStep + 1);
    updateLyricsDoc(activeDoc.id, { content: next });
    window.setTimeout(() => {
      isUndoing.current = false;
    }, 60);
  };

  const wrapSelection = (wrapper: string) => {
    if (!activeDoc || !textareaRef.current) return;
    const ta = textareaRef.current;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const sel = ta.value.slice(s, e) || 'texte';
    const next = ta.value.slice(0, s) + `${wrapper}${sel}${wrapper}` + ta.value.slice(e);
    handleContentChange(next);
  };

  const insertWord = (word: string) => {
    if (!activeDoc) return;
    const ta = textareaRef.current;
    if (ta) {
      const s = ta.selectionStart ?? activeDoc.content.length;
      const e = ta.selectionEnd ?? activeDoc.content.length;
      const spaceBefore = s > 0 && !/\s/.test(activeDoc.content[s - 1]) ? ' ' : '';
      const next = activeDoc.content.slice(0, s) + spaceBefore + word + ' ' + activeDoc.content.slice(e);
      handleContentChange(next);
      ta.focus();
    } else {
      handleContentChange(activeDoc.content + (activeDoc.content ? ' ' : '') + word);
    }
  };

  const renderedMarkdown = useMemo(() => {
    if (!activeDoc) return '';
    const escaped = (activeDoc.content || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const renderLine = (line: string) =>
      line
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noreferrer" class="underline">$1</a>');
    return escaped
      .split(/\n{2,}/)
      .map((p) => `<p class="mb-3">${p.split('\n').map(renderLine).join('<br/>')}</p>`)
      .join('');
  }, [activeDoc?.content]);

  const handleCreateDoc = () => {
    const folderId = selectedFolderId !== 'all' ? selectedFolderId : null;
    const newId = addLyricsDoc({ folderId });
    setActiveDocId(newId);
    setViewMode('docs');
  };

  const handleSaveNewFolder = () => {
    if (!newFolderInput || !newFolderInput.trim()) {
      setNewFolderInput(null);
      return;
    }
    const fId = addLyricsFolder(newFolderInput.trim(), null);
    setSelectedFolderId(fId);
    setNewFolderInput(null);
  };

  const wordCount = useMemo(() => {
    if (!activeDoc?.content.trim()) return 0;
    return activeDoc.content.trim().split(/\s+/).length;
  }, [activeDoc?.content]);

  const lineCount = useMemo(() => {
    if (!activeDoc?.content.trim()) return 0;
    return activeDoc.content.split('\n').filter((l) => l.trim().length > 0).length;
  }, [activeDoc?.content]);

  const isPlayingLinked = Boolean(
    linkedTrack && player.currentTrack?.id === linkedTrack.id && player.isPlaying
  );

  const activeIdx = activeDoc ? visibleDocs.findIndex((d) => d.id === activeDoc.id) : -1;

  return (
    <div className="space-y-4">
      {/* Compact Native Kora Toolbar (mirrors Sons) */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[200px] flex items-center gap-2 rounded-2xl bg-white dark:bg-zinc-900/90 border border-slate-200/80 dark:border-zinc-800 px-3.5 py-2.5">
          <Search size={14} className="text-slate-400 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Rechercher un texte ou des paroles…"
            className="w-full bg-transparent text-xs sm:text-sm outline-none text-slate-800 dark:text-zinc-100 placeholder:text-slate-400"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer"
            >
              <X size={13} />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setImportModalOpen(true)}
          title="Importer ou exporter tes textes (JSON)"
          className="inline-flex items-center gap-1.5 rounded-2xl bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 px-3 py-2.5 text-xs font-medium text-slate-600 dark:text-zinc-300 hover:border-slate-400 dark:hover:border-zinc-600 transition cursor-pointer"
        >
          <Upload size={13} />
          <span className="hidden sm:inline">Importer</span>
        </button>

        <button
          type="button"
          onClick={handleCreateDoc}
          className="inline-flex items-center gap-1.5 rounded-2xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-4 py-2.5 text-xs font-semibold hover:opacity-90 transition cursor-pointer"
        >
          <Plus size={14} />
          Nouveau texte
        </button>
      </div>

      {/* Minimalist Folders + Status + Trash Pill Strip */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden pb-0.5">
          <button
            type="button"
            onClick={() => {
              setViewMode('docs');
              setSelectedFolderId('all');
            }}
            className={`rounded-full px-3 py-1 text-xs font-medium transition cursor-pointer shrink-0 ${
              viewMode === 'docs' && selectedFolderId === 'all'
                ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                : 'bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 text-slate-600 dark:text-zinc-300 hover:border-slate-400'
            }`}
          >
            Tous <span className="font-mono text-[10px] opacity-65 ml-0.5">{visibleDocs.length}</span>
          </button>

          {state.lyricsFolders.map((folder) => {
            const active = viewMode === 'docs' && selectedFolderId === folder.id;
            const count = visibleDocs.filter((d) => d.folderId === folder.id).length;
            return (
              <div
                key={folder.id}
                className={`inline-flex items-center gap-1 rounded-full pl-3 pr-2 py-1 text-xs font-medium transition shrink-0 ${
                  active
                    ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                    : 'bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 text-slate-600 dark:text-zinc-300 hover:border-slate-400'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setViewMode('docs');
                    setSelectedFolderId(folder.id);
                  }}
                  className="inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Folder size={11} className="opacity-70" />
                  <span>{folder.name}</span>
                  <span className="font-mono text-[10px] opacity-65">{count}</span>
                </button>
                {active && (
                  <button
                    type="button"
                    onClick={() => {
                      deleteLyricsFolder(folder.id);
                      setSelectedFolderId('all');
                    }}
                    title="Supprimer ce dossier"
                    className="ml-0.5 p-0.5 rounded-full hover:bg-rose-500/20 hover:text-rose-400 transition cursor-pointer"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            );
          })}

          {newFolderInput !== null ? (
            <div className="inline-flex items-center gap-1 rounded-full bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 px-3 py-1 shrink-0">
              <Folder size={11} className="text-slate-400" />
              <input
                autoFocus
                type="text"
                value={newFolderInput}
                onChange={(e) => setNewFolderInput(e.target.value)}
                onBlur={handleSaveNewFolder}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveNewFolder();
                  if (e.key === 'Escape') setNewFolderInput(null);
                }}
                placeholder="Nom du dossier…"
                className="w-28 bg-transparent text-xs outline-none"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setNewFolderInput('')}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-slate-400 hover:text-slate-800 dark:hover:text-zinc-200 border border-dashed border-slate-300 dark:border-zinc-700 transition cursor-pointer shrink-0"
            >
              <FolderPlus size={11} />
              Dossier
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {viewMode === 'docs' && (
            <div className="inline-flex items-center gap-1">
              {([0, 1, 2, 3] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition cursor-pointer ${
                    statusFilter === st
                      ? 'bg-slate-200/90 dark:bg-zinc-800 text-slate-900 dark:text-zinc-100'
                      : 'text-slate-400 hover:text-slate-700 dark:hover:text-zinc-300'
                  }`}
                >
                  {st === 0 ? 'Tous statuts' : STATUS_META[st].label}
                </button>
              ))}
            </div>
          )}

          {(trashedDocs.length > 0 || viewMode === 'trash') && (
            <button
              type="button"
              onClick={() => setViewMode((v) => (v === 'trash' ? 'docs' : 'trash'))}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition cursor-pointer ${
                viewMode === 'trash'
                  ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                  : 'text-slate-400 hover:text-rose-500'
              }`}
            >
              <Trash2 size={11} />
              <span>Corbeille</span>
              <span className="font-mono text-[10px]">{trashedDocs.length}</span>
            </button>
          )}
        </div>
      </div>

      {/* MAIN CONTENT: Clean Cards Grid (or Trash) */}
      {viewMode === 'trash' ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-slate-500 dark:text-zinc-400">
              Textes supprimés ({trashedDocs.length})
            </p>
            {trashedDocs.length > 0 && (
              <button
                type="button"
                onClick={emptyLyricsTrash}
                className="text-xs font-semibold text-rose-500 hover:underline cursor-pointer"
              >
                Vider la corbeille
              </button>
            )}
          </div>

          {trashedDocs.length === 0 ? (
            <div className="tempo-card rounded-2xl p-10 text-center">
              <p className="text-xs text-slate-400">La corbeille est vide.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {trashedDocs.map((doc) => (
                <div
                  key={doc.id}
                  className="tempo-card rounded-2xl p-4 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 dark:text-zinc-200 truncate">
                      {doc.title || 'Sans titre'}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                      {doc.content.trim().slice(0, 60) || 'Texte vide'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => restoreLyricsDoc(doc.id)}
                      title="Restaurer"
                      className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 cursor-pointer"
                    >
                      <RefreshCcw size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => permanentDeleteLyricsDoc(doc.id)}
                      title="Supprimer définitivement"
                      className="p-2 rounded-xl bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 cursor-pointer"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : filteredDocs.length === 0 ? (
        <div className="tempo-card rounded-2xl py-14 px-6 text-center flex flex-col items-center">
          <FileText size={28} className="text-slate-300 dark:text-zinc-700 mb-2.5" />
          <p className="text-sm font-medium text-slate-600 dark:text-zinc-300">
            {searchQuery || selectedFolderId !== 'all' || statusFilter !== 0
              ? 'Aucun texte ne correspond à ce filtre'
              : 'Aucun texte pour le moment'}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Crée une nouvelle page ou importe tes textes existants en JSON.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={handleCreateDoc}
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-4 py-2 text-xs font-semibold cursor-pointer"
            >
              <Plus size={13} /> Nouveau texte
            </button>
            <button
              type="button"
              onClick={() => setImportModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-zinc-800 px-3.5 py-2 text-xs font-medium text-slate-600 dark:text-zinc-300 hover:border-slate-400 cursor-pointer"
            >
              <Upload size={13} /> Importer JSON
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredDocs.map((doc) => {
            const st = STATUS_META[doc.status || 1];
            const folderName = doc.folderId ? folderMap.get(doc.folderId) : undefined;
            const docTrack = doc.linkedTrackId ? trackMap.get(doc.linkedTrackId) : undefined;
            const isDocTrackPlaying = Boolean(
              docTrack && player.currentTrack?.id === docTrack.id && player.isPlaying
            );
            const words = doc.content.trim() ? doc.content.trim().split(/\s+/).length : 0;

            return (
              <div
                key={doc.id}
                onClick={() => setActiveDocId(doc.id)}
                className="group tempo-card rounded-2xl p-4 flex flex-col justify-between gap-3 cursor-pointer hover:border-slate-300 dark:hover:border-zinc-700 hover:shadow-sm transition"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-zinc-100 truncate">
                      {doc.title || 'Sans titre'}
                    </h3>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        title={`Statut : ${st.label} (cliquer pour changer)`}
                        onClick={(e) => {
                          e.stopPropagation();
                          const nextStatus = doc.status === 3 ? 1 : ((doc.status + 1) as 1 | 2 | 3);
                          updateLyricsDoc(doc.id, { status: nextStatus });
                        }}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition cursor-pointer ${st.badge}`}
                      >
                        <Circle size={6} className={`${st.dot} fill-current`} />
                        {st.label}
                      </button>
                      <button
                        type="button"
                        title="Mettre à la corbeille"
                        onClick={(e) => {
                          e.stopPropagation();
                          softDeleteLyricsDoc(doc.id);
                        }}
                        className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 p-1 rounded-lg text-slate-400 hover:text-rose-500 transition cursor-pointer"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>

                  <p className="text-xs leading-relaxed text-slate-500 dark:text-zinc-400 line-clamp-3 whitespace-pre-line min-h-[3.3rem]">
                    {doc.content.trim() ? (
                      doc.content.trim()
                    ) : (
                      <span className="italic text-slate-300 dark:text-zinc-600">Page blanche…</span>
                    )}
                  </p>
                </div>

                <div className="pt-2.5 border-t border-slate-100 dark:border-zinc-800/70 flex items-center justify-between gap-2 text-[11px] text-slate-400">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {folderName && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 dark:bg-zinc-800/80 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:text-zinc-400 truncate max-w-[100px]">
                        <Folder size={9} />
                        {folderName}
                      </span>
                    )}
                    {docTrack && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (player.currentTrack?.id === docTrack.id) player.togglePlay();
                          else void player.playTrack(docTrack);
                        }}
                        className="inline-flex items-center gap-1 rounded-full bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400 px-2 py-0.5 text-[10px] font-semibold hover:bg-fuchsia-500/20 transition cursor-pointer truncate max-w-[125px]"
                        title={`Écouter ${docTrack.title}`}
                      >
                        {isDocTrackPlaying ? <Pause size={9} fill="currentColor" /> : <Play size={9} fill="currentColor" />}
                        <span className="truncate">{docTrack.title}</span>
                      </button>
                    )}
                    {!folderName && !docTrack && (
                      <span className="font-mono text-[10px]">{words} mots</span>
                    )}
                  </div>

                  <span className="font-mono text-[10px] shrink-0">
                    {fmtShortDate(doc.lastModified) || `${words} mots`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ================= FULL-SCREEN EDITORIAL WRITING PAGE ================= */}
      {activeDoc && (
        <div
          className={`fixed inset-0 z-40 bg-white dark:bg-[#0c0c0f] flex flex-col overflow-hidden ${
            player.currentTrack ? 'pb-24 sm:pb-28' : ''
          }`}
        >
          {/* Minimalist Safe-Area Header */}
          <header className="shrink-0 border-b border-slate-100 dark:border-zinc-800/80 bg-white/90 dark:bg-[#0c0c0f]/90 backdrop-blur-md pt-[env(safe-area-inset-top)]">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveDocId(null)}
                  className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 transition cursor-pointer"
                >
                  <ArrowLeft size={15} />
                  <span>Textes</span>
                </button>

                {visibleDocs.length > 1 && (
                  <div className="hidden sm:flex items-center gap-0.5 pl-1 border-l border-slate-200/80 dark:border-zinc-800">
                    <button
                      type="button"
                      disabled={activeIdx <= 0}
                      onClick={() => activeIdx > 0 && setActiveDocId(visibleDocs[activeIdx - 1].id)}
                      className="p-1.5 text-slate-400 hover:text-slate-900 dark:hover:text-zinc-100 disabled:opacity-25 cursor-pointer"
                      title="Texte précédent"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <button
                      type="button"
                      disabled={activeIdx < 0 || activeIdx >= visibleDocs.length - 1}
                      onClick={() =>
                        activeIdx >= 0 &&
                        activeIdx < visibleDocs.length - 1 &&
                        setActiveDocId(visibleDocs[activeIdx + 1].id)
                      }
                      className="p-1.5 text-slate-400 hover:text-slate-900 dark:hover:text-zinc-100 disabled:opacity-25 cursor-pointer"
                      title="Texte suivant"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1.5 flex-wrap justify-end">
                {/* Status Cycler */}
                <button
                  type="button"
                  onClick={() => {
                    const nextStatus = activeDoc.status === 3 ? 1 : ((activeDoc.status + 1) as 1 | 2 | 3);
                    updateLyricsDoc(activeDoc.id, { status: nextStatus });
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition cursor-pointer ${
                    STATUS_META[activeDoc.status || 1].badge
                  }`}
                >
                  <Circle size={7} className={`${STATUS_META[activeDoc.status || 1].dot} fill-current`} />
                  {STATUS_META[activeDoc.status || 1].label}
                </button>

                {/* Folder Picker */}
                {state.lyricsFolders.length > 0 && (
                  <select
                    value={activeDoc.folderId || ''}
                    onChange={(e) =>
                      updateLyricsDoc(activeDoc.id, { folderId: e.target.value || null })
                    }
                    className="hidden sm:block rounded-xl border border-slate-200/80 dark:border-zinc-800 bg-transparent px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:text-zinc-300 outline-none cursor-pointer"
                  >
                    <option value="">Sans dossier</option>
                    {state.lyricsFolders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                )}

                {/* Undo / Redo */}
                <div className="hidden sm:flex items-center rounded-xl border border-slate-200/80 dark:border-zinc-800 p-0.5">
                  <button
                    type="button"
                    onClick={handleUndo}
                    disabled={historyStep <= 0}
                    className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-zinc-100 disabled:opacity-25 cursor-pointer"
                    title="Annuler"
                  >
                    <Undo size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={handleRedo}
                    disabled={historyStep >= history.length - 1}
                    className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-zinc-100 disabled:opacity-25 cursor-pointer"
                    title="Rétablir"
                  >
                    <Redo size={13} />
                  </button>
                </div>

                {/* Edit / Preview */}
                <button
                  type="button"
                  onClick={() => setMarkdownMode((m) => (m === 'edit' ? 'preview' : 'edit'))}
                  className="p-1.5 rounded-xl border border-slate-200/80 dark:border-zinc-800 text-slate-500 hover:text-slate-900 dark:hover:text-zinc-100 transition cursor-pointer"
                  title={markdownMode === 'edit' ? 'Aperçu' : 'Édition'}
                >
                  {markdownMode === 'edit' ? <Eye size={14} /> : <Edit3 size={14} />}
                </button>

                {/* Beat Bar Toggle */}
                <button
                  type="button"
                  onClick={() => setBeatBarOpen((v) => !v)}
                  className={`inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-medium transition cursor-pointer ${
                    beatBarOpen
                      ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                      : 'border border-slate-200/80 dark:border-zinc-800 text-slate-600 dark:text-zinc-300 hover:border-slate-400'
                  }`}
                >
                  <Music2 size={12} />
                  <span className="hidden sm:inline">Instru</span>
                </button>

                {/* Tools Toggle (Inspiration + Métronome) */}
                <button
                  type="button"
                  onClick={() => setToolsOpen((v) => !v)}
                  className={`inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-medium transition cursor-pointer ${
                    toolsOpen
                      ? 'bg-fuchsia-600 text-white'
                      : 'bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300 hover:bg-fuchsia-500/15'
                  }`}
                >
                  <Sparkles size={12} />
                  <span className="hidden sm:inline">Outils</span>
                </button>

                {/* Delete */}
                <button
                  type="button"
                  onClick={() => {
                    softDeleteLyricsDoc(activeDoc.id);
                    setActiveDocId(null);
                  }}
                  title="Mettre à la corbeille"
                  className="p-1.5 rounded-xl text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition cursor-pointer"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </header>

          {/* Editorial Body + Optional Tools Sidebar */}
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 flex flex-col lg:flex-row gap-6">
              {/* Centered Writing Column */}
              <div className="flex-1 min-w-0 max-w-2xl mx-auto w-full flex flex-col">
                <input
                  type="text"
                  value={activeDoc.title}
                  onChange={(e) => updateLyricsDoc(activeDoc.id, { title: e.target.value })}
                  placeholder="Titre du texte…"
                  className="w-full text-2xl sm:text-3xl font-bold tracking-tight text-slate-950 dark:text-white bg-transparent outline-none placeholder:text-slate-300 dark:placeholder:text-zinc-700"
                />

                <div className="mt-2 pb-4 mb-4 border-b border-slate-100 dark:border-zinc-800/80 flex items-center justify-between gap-2 text-[11px] text-slate-400">
                  <span className="font-mono">
                    {lineCount} lignes · {wordCount} mots
                    {activeDoc.lastModified ? ` · ${fmtShortDate(activeDoc.lastModified)}` : ''}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => wrapSelection('**')}
                      className="px-2 py-0.5 rounded-md font-bold hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-500 cursor-pointer"
                      title="Gras"
                    >
                      B
                    </button>
                    <button
                      type="button"
                      onClick={() => wrapSelection('*')}
                      className="px-2 py-0.5 rounded-md italic hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-500 cursor-pointer"
                      title="Italique"
                    >
                      I
                    </button>
                  </div>
                </div>

                {markdownMode === 'edit' ? (
                  <textarea
                    ref={textareaRef}
                    value={activeDoc.content}
                    onChange={(e) => handleContentChange(e.target.value)}
                    placeholder="Commence à écrire tes couplets, refrains, idées de flow…"
                    spellCheck={false}
                    className="flex-1 w-full min-h-[45vh] bg-transparent outline-none resize-none text-[15px] sm:text-base leading-[1.9] text-slate-800 dark:text-zinc-100 placeholder:text-slate-300 dark:placeholder:text-zinc-700"
                  />
                ) : (
                  <div
                    className="flex-1 w-full min-h-[45vh] text-[15px] sm:text-base leading-[1.9] text-slate-800 dark:text-zinc-100"
                    dangerouslySetInnerHTML={{ __html: renderedMarkdown }}
                  />
                )}
              </div>

              {/* Optional Right Tools Column (Inspiration + Métronome) */}
              {toolsOpen && (
                <aside className="w-full lg:w-72 shrink-0 space-y-3">
                  <LexCoreInspirationWidget onInsertWord={insertWord} />
                  <MetronomeWidget initialBpm={linkedTrack?.bpm || 120} />
                </aside>
              )}
            </div>
          </div>

          {/* Collapsible Sleek Beat / Instru Footer */}
          {beatBarOpen && (
            <div className="shrink-0 border-t border-slate-100 dark:border-zinc-800/80 bg-slate-50/80 dark:bg-zinc-900/60 backdrop-blur-md">
              <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="inline-flex items-center rounded-xl bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 p-0.5">
                    <button
                      type="button"
                      onClick={() => setBeatMode('mp3')}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition cursor-pointer ${
                        beatMode === 'mp3'
                          ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                          : 'text-slate-500'
                      }`}
                    >
                      Son Kora
                    </button>
                    <button
                      type="button"
                      onClick={() => setBeatMode('youtube')}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition cursor-pointer ${
                        beatMode === 'youtube'
                          ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                          : 'text-slate-500'
                      }`}
                    >
                      Prod YouTube
                    </button>
                  </div>

                  {beatMode === 'mp3' && (
                    <select
                      value={activeDoc.linkedTrackId || ''}
                      onChange={(e) =>
                        updateLyricsDoc(activeDoc.id, { linkedTrackId: e.target.value || undefined })
                      }
                      className="rounded-xl border border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2.5 py-1 text-[11px] text-slate-600 dark:text-zinc-300 outline-none cursor-pointer max-w-[220px]"
                    >
                      <option value="">Associer un son…</option>
                      {state.musicTracks.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.title}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {beatMode === 'youtube' ? (
                  <YoutubeBeatPlayer
                    url={activeDoc.mediaUrl || ''}
                    loop={activeDoc.loop}
                    markers={activeDoc.markers}
                    onUpdate={(patch) => updateLyricsDoc(activeDoc.id, patch)}
                  />
                ) : linkedTrack ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() =>
                          player.currentTrack?.id === linkedTrack.id
                            ? player.togglePlay()
                            : void player.playTrack(linkedTrack)
                        }
                        className="h-9 w-9 rounded-full bg-fuchsia-600 text-white flex items-center justify-center shrink-0 hover:bg-fuchsia-700 transition cursor-pointer"
                      >
                        {isPlayingLinked ? (
                          <Pause size={15} fill="currentColor" />
                        ) : (
                          <Play size={15} fill="currentColor" className="ml-0.5" />
                        )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-slate-900 dark:text-zinc-100 truncate">
                          {linkedTrack.title}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {linkedTrack.bpm ? `${linkedTrack.bpm} BPM · ` : ''}
                          Lecture synchronisée avec le lecteur
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => player.setLoop(!player.loop)}
                        className={`h-8 w-8 rounded-xl flex items-center justify-center cursor-pointer ${
                          player.loop
                            ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                            : 'bg-white dark:bg-zinc-800 text-slate-500 border border-slate-200/80 dark:border-zinc-700'
                        }`}
                        title="Boucle"
                      >
                        <Repeat size={13} />
                      </button>
                    </div>

                    {linkedTrack.markers.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {linkedTrack.markers.map((mk) => (
                          <button
                            key={mk.id}
                            type="button"
                            onClick={() => void player.playTrack(linkedTrack, mk.timeSec)}
                            className="inline-flex items-center gap-1 rounded-full bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-zinc-300 hover:border-fuchsia-400 transition cursor-pointer"
                          >
                            <Disc3 size={10} className="text-fuchsia-500" />
                            {mk.label}
                            <span className="font-mono text-[10px] text-slate-400">
                              {fmt(mk.timeSec)}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">
                    Sélectionne un son ci-dessus ou bascule sur <strong>Prod YouTube</strong> pour écrire sur instru.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <LexCoreImportModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onImported={(firstDocId) => {
          if (firstDocId) {
            setActiveDocId(firstDocId);
            setViewMode('docs');
          }
        }}
      />
    </div>
  );
}
