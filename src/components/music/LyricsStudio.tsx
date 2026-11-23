import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Disc3,
  Edit3,
  Eye,
  FileText,
  Folder,
  FolderPlus,
  LayoutList,
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
  Unlink,
  Upload,
  X,
} from 'lucide-react';
import type { LyricsBarBlock, LyricsDoc, MusicTrack } from '../../types';
import { useApp } from '../../context/AppContext';
import { useAudioPlayer } from '../../context/AudioPlayerContext';
import { AppleConfirmDialog } from '../ui/AppleConfirmDialog';
import { YoutubeBeatPlayer } from './YoutubeBeatPlayer';
import { LexCoreInspirationWidget, MetronomeWidget } from './LexCoreTools';
import { LexCoreImportModal } from './LexCoreImportModal';
import { LyricsMeasuresEditor } from './LyricsMeasuresEditor';
import { LyricLinesEditor, parseLyricLines } from './LyricLinesEditor';
import { groupMusicTracks } from '../../lib/musicVersioning';
import { countLyricsFixTags } from '../../lib/trackCover';
import {
  computeFourBarGrid,
  isTrackAnalyzed,
  serializeBarBlocksToContent,
  syncBarBlocksWithGrid,
} from '../../lib/audioAnalyzer';

interface LyricsStudioProps {
  initialDocId?: string | null;
  openRequest?: { docId: string; nonce: number } | null;
  resetNonce?: number;
  onCloseDoc?: () => void;
  backLabel?: string;
  onOpenDocContextMenu?: (e: React.MouseEvent, doc: LyricsDoc) => void;
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

export function LyricsStudio({
  initialDocId,
  openRequest,
  resetNonce = 0,
  onCloseDoc,
  backLabel,
  onOpenDocContextMenu,
}: LyricsStudioProps) {
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
    updateMusicTrack,
    notify,
  } = useApp();

  const player = useAudioPlayer();

  // Only open the full-screen editor when a doc is explicitly opened (or passed via openRequest / initialDocId)
  const [activeDocId, setActiveDocId] = useState<string | null>(
    openRequest?.docId || initialDocId || null
  );
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
  const [trackPickerOpen, setTrackPickerOpen] = useState(false);
  const [trackPickerSearch, setTrackPickerSearch] = useState('');
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [confirmEmptyTrashOpen, setConfirmEmptyTrashOpen] = useState(false);

  // Undo / Redo per active doc
  const [history, setHistory] = useState<string[]>([]);
  const [historyStep, setHistoryStep] = useState(-1);
  const isUndoing = useRef(false);

  useEffect(() => {
    if (resetNonce > 0) {
      setActiveDocId(null);
    }
  }, [resetNonce]);

  useEffect(() => {
    if (openRequest?.docId) {
      setActiveDocId(openRequest.docId);
      setViewMode('docs');
    } else if (initialDocId) {
      setActiveDocId(initialDocId);
      setViewMode('docs');
    }
  }, [initialDocId, openRequest?.docId, openRequest?.nonce]);

  const activeDoc = useMemo(
    () => state.lyricsDocs.find((d) => d.id === activeDocId && !d.deletedAt) || null,
    [state.lyricsDocs, activeDocId]
  );

  const trackGroups = useMemo(
    () => groupMusicTracks(state.musicTracks),
    [state.musicTracks]
  );

  const prodByTrackId = useMemo(() => {
    const map = new Map<string, (typeof state.musicTracks)[number]>();
    for (const g of trackGroups) {
      if (g.prodTrack) {
        for (const id of g.allTrackIds) {
          if (id !== g.prodTrack.id) map.set(id, g.prodTrack);
        }
      }
    }
    return map;
  }, [trackGroups]);

  const linkedGroup = useMemo(() => {
    if (!activeDoc?.linkedTrackId) return null;
    return trackGroups.find((g) => g.allTrackIds.includes(activeDoc.linkedTrackId!)) || null;
  }, [trackGroups, activeDoc?.linkedTrackId]);

  const linkedTrack = useMemo(
    () =>
      (activeDoc?.linkedTrackId
        ? state.musicTracks.find((t) => t.id === activeDoc.linkedTrackId)
        : null) ||
      linkedGroup?.latestTrack ||
      null,
    [state.musicTracks, activeDoc?.linkedTrackId, linkedGroup]
  );

  const linkedProdTrack = useMemo(
    () => (linkedTrack ? prodByTrackId.get(linkedTrack.id) || null : null),
    [linkedTrack, prodByTrackId]
  );

  // Prefer the clean instrumental *_prod track for BPM / Key / 4-bar energy analysis when available
  const analysisTrack = linkedProdTrack || linkedTrack;
  const [analyzingTrackId, setAnalyzingTrackId] = useState<string | null>(null);
  const [focusedBlockIndex, setFocusedBlockIndex] = useState<number>(0);
  const [livePlaySec, setLivePlaySec] = useState<number>(0);

  // 100% AUTOMATIC BPM, Key & 4-bar structure analysis whenever a track is attached or opened!
  useEffect(() => {
    if (!activeDoc || !analysisTrack) return;
    if (isTrackAnalyzed(analysisTrack)) return;
    if (!analysisTrack.mediaId && !analysisTrack.googleDriveFileId && !analysisTrack.cloudAudioUrl) {
      return;
    }
    let alive = true;
    setAnalyzingTrackId(analysisTrack.id);
    void player.analyzeTrackAudio(analysisTrack).then((res) => {
      if (!alive) return;
      setAnalyzingTrackId((prev) => (prev === analysisTrack.id ? null : prev));
      // Mirror detected BPM / Key / bar metadata onto linkedTrack when analysis ran on linkedProdTrack
      if (res && linkedTrack && linkedTrack.id !== analysisTrack.id) {
        updateMusicTrack(linkedTrack.id, {
          durationSec: linkedTrack.durationSec || Math.round(res.durationSec),
          bpm: linkedTrack.bpm || res.bpm,
          musicalKey: linkedTrack.musicalKey || res.musicalKey || undefined,
          barOffsetSec: res.barOffsetSec,
          barBlockEnergies: res.barBlockEnergies,
          audioAnalyzedAt: res.analyzedAt,
        });
      }
    });
    return () => {
      alive = false;
    };
  }, [activeDoc?.id, analysisTrack?.id, analysisTrack?.audioAnalyzedAt]);

  // Compute live 4-bar grid and seamlessly keep `activeDoc.barBlocks` synced with it
  const measuresVisible = Boolean(linkedTrack && activeDoc?.showMeasures !== false);
  const effectiveGrid = useMemo(() => {
    if (!linkedTrack || !analysisTrack) return [];
    const dur = analysisTrack.durationSec || linkedTrack.durationSec || 150;
    const bpm = analysisTrack.bpm || linkedTrack.bpm || 120;
    const offset = analysisTrack.barOffsetSec ?? linkedTrack.barOffsetSec ?? 0;
    const energies = analysisTrack.barBlockEnergies || linkedTrack.barBlockEnergies;
    return computeFourBarGrid(dur, bpm, offset, energies);
  }, [
    linkedTrack?.id,
    linkedTrack?.durationSec,
    linkedTrack?.bpm,
    linkedTrack?.barOffsetSec,
    linkedTrack?.barBlockEnergies,
    analysisTrack?.id,
    analysisTrack?.durationSec,
    analysisTrack?.bpm,
    analysisTrack?.barOffsetSec,
    analysisTrack?.barBlockEnergies,
  ]);

  const resolvedBarBlocks = useMemo<LyricsBarBlock[]>(() => {
    if (!activeDoc || effectiveGrid.length === 0) return [];
    return syncBarBlocksWithGrid(effectiveGrid, activeDoc.barBlocks, activeDoc.content);
  }, [activeDoc?.id, activeDoc?.barBlocks, activeDoc?.content, effectiveGrid]);

  // Persist initial auto-generated 4-bar structure onto the doc as soon as a track is attached
  useEffect(() => {
    if (!activeDoc || !linkedTrack || effectiveGrid.length === 0) return;
    if (!activeDoc.barBlocks || activeDoc.barBlocks.length === 0) {
      const initialBlocks = syncBarBlocksWithGrid(effectiveGrid, undefined, activeDoc.content);
      updateLyricsDoc(activeDoc.id, { barBlocks: initialBlocks });
    }
  }, [activeDoc?.id, linkedTrack?.id, effectiveGrid.length]);

  const isPlayingEitherLinked = Boolean(
    player.isPlaying &&
      player.currentTrack &&
      ((linkedTrack && player.currentTrack.id === linkedTrack.id) ||
        (linkedProdTrack && player.currentTrack.id === linkedProdTrack.id))
  );

  // Smooth ~5Hz playhead tracker for active 4-bar block & live M1..M4 bar pulse
  useEffect(() => {
    if (!activeDoc || !linkedTrack) {
      setLivePlaySec(0);
      return;
    }
    const isLoaded =
      player.currentTrack &&
      (player.currentTrack.id === linkedTrack.id ||
        (linkedProdTrack && player.currentTrack.id === linkedProdTrack.id));
    if (!isLoaded) {
      setLivePlaySec(0);
      return;
    }
    setLivePlaySec(player.getLiveTime());
    if (!player.isPlaying) return;
    const id = window.setInterval(() => {
      setLivePlaySec(player.getLiveTime());
    }, 180);
    return () => window.clearInterval(id);
  }, [activeDoc?.id, linkedTrack?.id, linkedProdTrack?.id, player.currentTrack?.id, player.isPlaying, player.currentTime]);

  const handleBarBlocksChange = (nextBlocks: LyricsBarBlock[]) => {
    if (!activeDoc) return;
    const serialized = serializeBarBlocksToContent(nextBlocks);
    updateLyricsDoc(activeDoc.id, {
      barBlocks: nextBlocks,
      content: serialized,
    });
  };

  const handleUpdateAnalysisMeta = (patch: Partial<MusicTrack>) => {
    if (analysisTrack) updateMusicTrack(analysisTrack.id, patch);
    if (linkedTrack && linkedTrack.id !== analysisTrack?.id) {
      updateMusicTrack(linkedTrack.id, patch);
    }
  };

  const handleReanalyzeTrack = () => {
    if (!analysisTrack) return;
    setAnalyzingTrackId(analysisTrack.id);
    void player.analyzeTrackAudio(analysisTrack, { force: true }).then((res) => {
      setAnalyzingTrackId(null);
      if (res && linkedTrack && linkedTrack.id !== analysisTrack.id) {
        updateMusicTrack(linkedTrack.id, {
          durationSec: linkedTrack.durationSec || Math.round(res.durationSec),
          bpm: res.bpm,
          musicalKey: res.musicalKey || undefined,
          barOffsetSec: res.barOffsetSec,
          barBlockEnergies: res.barBlockEnergies,
          audioAnalyzedAt: res.analyzedAt,
        });
      }
      if (res) {
        notify(`Analysé : ${res.bpm} BPM${res.musicalKey ? ` · ${res.musicalKey}` : ''} ✓`);
      }
    });
  };

  const handleJumpToBarSec = (startSec: number) => {
    const targetTrack =
      player.currentTrack && linkedProdTrack && player.currentTrack.id === linkedProdTrack.id
        ? linkedProdTrack
        : linkedTrack || linkedProdTrack;
    if (!targetTrack) return;
    if (player.currentTrack?.id === targetTrack.id) {
      player.seek(startSec);
      if (!player.isPlaying) player.togglePlay();
    } else {
      void player.playTrack(targetTrack, startSec);
    }
  };

  const handleToggleBlockLoop = (startSec: number, endSec: number) => {
    const isSameLoop =
      player.abLoop.start !== null &&
      player.abLoop.end !== null &&
      Math.abs(player.abLoop.start - startSec) < 0.35 &&
      Math.abs(player.abLoop.end - endSec) < 0.35;
    if (isSameLoop) {
      player.setAbLoop({ start: null, end: null });
      return;
    }
    player.setAbLoop({ start: startSec, end: endSec });
    if (player.repeatMode === 'off') {
      player.setRepeatMode('one');
    }
    handleJumpToBarSec(startSec);
  };

  useEffect(() => {
    if (activeDoc) {
      setBeatMode(activeDoc.linkedTrackId ? 'mp3' : activeDoc.mediaUrl ? 'youtube' : 'mp3');
      setBeatBarOpen(Boolean(activeDoc.linkedTrackId || activeDoc.mediaUrl));
      setHistory([activeDoc.content]);
      setHistoryStep(0);
      setMarkdownMode('edit');
    }
  }, [activeDocId]);

  const handleCloseEditor = () => {
    setActiveDocId(null);
    onCloseDoc?.();
  };

  // Escape key closes full-screen editor cleanly
  useEffect(() => {
    if (!activeDoc) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !importModalOpen && !trackPickerOpen) {
        setActiveDocId(null);
        onCloseDoc?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeDoc, importModalOpen, trackPickerOpen, onCloseDoc]);

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
    updateLyricsDoc(activeDoc.id, {
      content: nextContent,
      ...(measuresVisible ? {} : { barBlocks: undefined }),
    });
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

  const [focusedFreeLineIndex, setFocusedFreeLineIndex] = useState<number>(0);

  const insertWord = (word: string) => {
    if (!activeDoc) return;
    if (measuresVisible && resolvedBarBlocks.length > 0 && markdownMode === 'edit') {
      const targetIdx = Math.min(
        resolvedBarBlocks.length - 1,
        Math.max(0, focusedBlockIndex)
      );
      const nextBlocks = resolvedBarBlocks.map((b, i) => {
        if (i !== targetIdx) return b;
        const sep = b.text && !/\s$/.test(b.text) ? ' ' : '';
        return {
          ...b,
          status: b.status === 'empty' || b.status === 'planned' ? ('draft' as const) : b.status,
          text: `${b.text}${sep}${word} `,
        };
      });
      handleBarBlocksChange(nextBlocks);
      return;
    }
    const rawLines = (activeDoc.content || '').split('\n');
    const targetIdx = Math.min(Math.max(0, rawLines.length - 1), Math.max(0, focusedFreeLineIndex));
    const curLine = rawLines[targetIdx] || '';
    const sep = curLine && !/\s$/.test(curLine) ? ' ' : '';
    rawLines[targetIdx] = `${curLine}${sep}${word} `;
    handleContentChange(rawLines.join('\n'));
  };

  const renderedPreviewLines = useMemo(() => {
    if (!activeDoc) return [];
    return parseLyricLines(activeDoc.content || '');
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
    const cleaned = activeDoc.content.replace(/\[FIX(?::[^\]]*)?\]/gi, '').trim();
    if (!cleaned) return 0;
    return cleaned.split(/\s+/).length;
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
      {!activeDoc && (
        <>
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
          className="inline-flex items-center gap-1.5 rounded-2xl bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25 px-4 py-2.5 text-xs font-semibold hover:opacity-90 transition cursor-pointer"
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
                ? 'bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25'
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
                    ? 'bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25'
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
                onClick={() => setConfirmEmptyTrashOpen(true)}
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
                      {doc.content.replace(/\[FIX(?::[^\]]*)?\]\s*/gi, '').trim().slice(0, 60) || 'Texte vide'}
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
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25 px-4 py-2 text-xs font-semibold cursor-pointer"
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
            const docProdTrack = docTrack ? prodByTrackId.get(docTrack.id) : undefined;
            const isDocTrackPlaying = Boolean(
              docTrack && player.currentTrack?.id === docTrack.id && player.isPlaying
            );
            const isDocProdPlaying = Boolean(
              docProdTrack && player.currentTrack?.id === docProdTrack.id && player.isPlaying
            );
            const cleanPreview = doc.content.replace(/\[FIX(?::[^\]]*)?\]\s*/gi, '').trim();
            const words = cleanPreview ? cleanPreview.split(/\s+/).length : 0;
            const docFixCount = countLyricsFixTags(doc.content);

            return (
              <div
                key={doc.id}
                onClick={() => setActiveDocId(doc.id)}
                onContextMenu={(e) => {
                  if (!onOpenDocContextMenu) return;
                  e.preventDefault();
                  e.stopPropagation();
                  onOpenDocContextMenu(e, doc);
                }}
                className="group tempo-card rounded-2xl p-4 flex flex-col justify-between gap-3 cursor-pointer hover:border-slate-300 dark:hover:border-zinc-700 hover:shadow-sm transition"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-zinc-100 truncate">
                      {doc.title || 'Sans titre'}
                    </h3>
                    <div className="flex items-center gap-1 shrink-0">
                      {docFixCount > 0 && (
                        <span className="rounded-full bg-[#8C271E]/12 text-[#8C271E] dark:text-[#f08b82] px-1.5 py-0.5 font-mono text-[9.5px] font-semibold">
                          FIX ×{docFixCount}
                        </span>
                      )}
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
                    {cleanPreview ? (
                      cleanPreview
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
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition cursor-pointer truncate max-w-[115px] ${
                          isDocTrackPlaying
                            ? 'bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25'
                            : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-700'
                        }`}
                        title={`Écouter ${docTrack.title}`}
                      >
                        {isDocTrackPlaying ? <Pause size={9} fill="currentColor" /> : <Play size={9} fill="currentColor" />}
                        <span className="truncate">{docTrack.manualGroupTitle || docTrack.title}</span>
                      </button>
                    )}
                    {docProdTrack && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (player.currentTrack?.id === docProdTrack.id) player.togglePlay();
                          else void player.playTrack(docProdTrack);
                        }}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition cursor-pointer shrink-0 ${
                          isDocProdPlaying
                            ? 'bg-emerald-500 text-white'
                            : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20'
                        }`}
                        title={`Écouter la prod (${docProdTrack.title})`}
                      >
                        {isDocProdPlaying ? <Pause size={8} fill="currentColor" /> : <Play size={8} fill="currentColor" />}
                        <span>Prod</span>
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
        </>
      )}

      {/* ================= IN-APP EDITORIAL WRITING PAGE (inside <main> alongside sidebar & navbar!) ================= */}
      {activeDoc && (
        <div className="tempo-card rounded-3xl overflow-hidden flex flex-col">
          {/* Minimalist In-App Studio Header */}
          <header className="shrink-0 border-b border-slate-100 dark:border-zinc-800/80 bg-white/85 dark:bg-[#111114]/85 backdrop-blur-md">
            <div className="px-4 sm:px-6 h-14 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCloseEditor}
                  className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 transition cursor-pointer"
                >
                  <ArrowLeft size={15} />
                  <span>{backLabel || 'Textes'}</span>
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

                {/* Apple-Style Folder Picker Button */}
                {state.lyricsFolders.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setFolderPickerOpen(true)}
                    className="hidden sm:inline-flex items-center gap-1.5 rounded-xl border border-slate-200/80 dark:border-zinc-800 hover:border-slate-400 dark:hover:border-zinc-600 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:text-zinc-300 transition cursor-pointer"
                  >
                    <Folder size={11} className="text-slate-400" />
                    <span className="truncate max-w-[110px]">
                      {(activeDoc.folderId && folderMap.get(activeDoc.folderId)) || 'Dossier…'}
                    </span>
                    <ChevronDown size={11} className="opacity-60" />
                  </button>
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

                {/* Mesures 4-bar Skeleton Toggle (when a track is linked) */}
                {linkedTrack && (
                  <button
                    type="button"
                    onClick={() =>
                      updateLyricsDoc(activeDoc.id, { showMeasures: !measuresVisible })
                    }
                    title={
                      measuresVisible
                        ? 'Masquer les blocs de 4 mesures (texte libre)'
                        : 'Afficher le découpage automatique par blocs de 4 mesures'
                    }
                    className={`inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-medium transition cursor-pointer ${
                      measuresVisible
                        ? 'bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25'
                        : 'border border-slate-200/80 dark:border-zinc-800 text-slate-600 dark:text-zinc-300 hover:border-slate-400'
                    }`}
                  >
                    <LayoutList size={12} />
                    <span className="hidden sm:inline">Mesures</span>
                  </button>
                )}

                {/* Beat Bar Toggle */}
                <button
                  type="button"
                  onClick={() => setBeatBarOpen((v) => !v)}
                  className={`inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-medium transition cursor-pointer ${
                    beatBarOpen
                      ? 'bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25'
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
                      ? 'bg-[#8C271E] text-white'
                      : 'border border-slate-200/80 dark:border-zinc-800 text-slate-600 dark:text-zinc-300 hover:border-slate-400'
                  }`}
                >
                  <Sparkles size={12} className={toolsOpen ? 'text-white' : 'text-[#8C271E]'} />
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

          {/* Minimalist Integrated Beat / Instru Strip (full-width inside studio card!) */}
          {beatBarOpen && (
            <div className="shrink-0 border-b border-slate-100 dark:border-zinc-800/80 bg-slate-50/75 dark:bg-zinc-900/45 px-5 sm:px-7 py-2.5">
              <div className="w-full space-y-2">
                {beatMode === 'youtube' ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-medium text-slate-500 dark:text-zinc-400">
                        Prod YouTube
                      </span>
                      <button
                        type="button"
                        onClick={() => setBeatMode('mp3')}
                        className="text-[11px] font-medium text-slate-500 hover:text-slate-900 dark:hover:text-zinc-100 transition cursor-pointer"
                      >
                        ← Son Kora
                      </button>
                    </div>
                    <YoutubeBeatPlayer
                      url={activeDoc.mediaUrl || ''}
                      loop={activeDoc.loop}
                      markers={activeDoc.markers}
                      onUpdate={(patch) => updateLyricsDoc(activeDoc.id, patch)}
                    />
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      {/* Monochrome Play / Pause for linked song */}
                      <button
                        type="button"
                        disabled={!linkedTrack}
                        onClick={() => {
                          if (!linkedTrack) return;
                          if (player.currentTrack?.id === linkedTrack.id) player.togglePlay();
                          else void player.playTrack(linkedTrack);
                        }}
                        className="h-8 w-8 rounded-full bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25 flex items-center justify-center shrink-0 hover:opacity-90 disabled:opacity-25 transition cursor-pointer"
                        title={linkedTrack ? `Lire ${linkedTrack.manualGroupTitle || linkedTrack.title}` : 'Associer un son'}
                      >
                        {isPlayingLinked ? (
                          <Pause size={13} fill="currentColor" />
                        ) : (
                          <Play size={13} fill="currentColor" className="ml-0.5" />
                        )}
                      </button>

                      {/* Clean Clickable Searchable Track Picker Trigger (deduplicated songs!) */}
                      <button
                        type="button"
                        onClick={() => {
                          setTrackPickerSearch('');
                          setTrackPickerOpen(true);
                        }}
                        className="flex-1 min-w-0 flex items-center gap-1.5 text-left rounded-lg px-1.5 py-1 hover:bg-slate-200/60 dark:hover:bg-zinc-800/80 transition cursor-pointer"
                        title="Choisir ou changer le son associé"
                      >
                        <span
                          className={`text-xs font-medium truncate ${
                            linkedTrack
                              ? 'text-slate-800 dark:text-zinc-100'
                              : 'text-slate-400 dark:text-zinc-500'
                          }`}
                        >
                          {linkedGroup?.baseTitle ||
                            linkedTrack?.manualGroupTitle ||
                            linkedTrack?.title ||
                            'Associer un son…'}
                        </span>
                        <ChevronDown size={12} className="text-slate-400 shrink-0 ml-auto" />
                      </button>

                      {/* 1-Tap Linked Prod Playback Button (when a *_prod exists for this song!) */}
                      {linkedProdTrack && (
                        <button
                          type="button"
                          onClick={() => {
                            if (player.currentTrack?.id === linkedProdTrack.id) player.togglePlay();
                            else void player.playTrack(linkedProdTrack);
                          }}
                          title={`Lire la prod (${linkedProdTrack.title})`}
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer shrink-0 ${
                            player.currentTrack?.id === linkedProdTrack.id && player.isPlaying
                              ? 'bg-emerald-500 text-white'
                              : 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20'
                          }`}
                        >
                          {player.currentTrack?.id === linkedProdTrack.id && player.isPlaying ? (
                            <Pause size={10} fill="currentColor" />
                          ) : (
                            <Play size={10} fill="currentColor" />
                          )}
                          <span>Prod</span>
                        </button>
                      )}

                      {/* Loop Toggle */}
                      {linkedTrack && (
                        <button
                          type="button"
                          onClick={() => player.setLoop(!player.loop)}
                          className={`h-7 w-7 rounded-full flex items-center justify-center transition cursor-pointer shrink-0 ${
                            player.loop
                              ? 'bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25'
                              : 'text-slate-400 hover:text-slate-900 dark:hover:text-zinc-100 hover:bg-slate-200/60 dark:hover:bg-zinc-800'
                          }`}
                          title="Boucle"
                        >
                          <Repeat size={12} />
                        </button>
                      )}

                      {/* Subtle Switch to YouTube */}
                      <button
                        type="button"
                        onClick={() => setBeatMode('youtube')}
                        className="rounded-full px-2 py-1 text-[10px] font-medium text-slate-400 hover:text-slate-800 dark:hover:text-zinc-200 hover:bg-slate-200/60 dark:hover:bg-zinc-800 transition cursor-pointer shrink-0"
                        title="Passer sur une prod YouTube"
                      >
                        YouTube
                      </button>
                    </div>

                    {linkedTrack && linkedTrack.markers.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-slate-200/60 dark:border-zinc-800/70">
                        {linkedTrack.markers.map((mk) => (
                          <button
                            key={mk.id}
                            type="button"
                            onClick={() => void player.playTrack(linkedTrack, mk.timeSec)}
                            className="inline-flex items-center gap-1 rounded-full bg-white dark:bg-zinc-800/80 border border-slate-200/70 dark:border-zinc-700/70 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:text-zinc-300 hover:border-slate-400 transition cursor-pointer"
                          >
                            <Disc3 size={9} className="opacity-60" />
                            {mk.label}
                            <span className="font-mono text-[9px] text-slate-400">
                              {fmt(mk.timeSec)}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* Editorial Body + Optional Tools Sidebar (full-width like Accueil / Sons / Projets!) */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col">
            <div className="flex-1 min-h-full w-full px-5 sm:px-8 pt-5 sm:pt-7 pb-4 flex flex-col lg:flex-row gap-6">
              {/* Full-Width Writing Column */}
              <div className="flex-1 min-h-0 min-w-0 w-full flex flex-col">
                <input
                  type="text"
                  value={activeDoc.title}
                  onChange={(e) => updateLyricsDoc(activeDoc.id, { title: e.target.value })}
                  placeholder="Titre du texte…"
                  className="w-full text-2xl sm:text-3xl font-bold tracking-tight text-slate-950 dark:text-white bg-transparent outline-none placeholder:text-slate-300 dark:placeholder:text-zinc-700"
                />

                <div className="mt-2 pb-4 mb-4 border-b border-slate-100 dark:border-zinc-800/80 flex items-center justify-between gap-2 text-[11px] text-slate-400 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="font-mono">
                      {lineCount} lignes · {wordCount} mots
                      {activeDoc.lastModified ? ` · ${fmtShortDate(activeDoc.lastModified)}` : ''}
                    </span>
                    {countLyricsFixTags(activeDoc.content) > 0 && (
                      <span className="rounded-full bg-[#8C271E]/12 text-[#8C271E] dark:text-[#f08b82] px-2 py-0.5 font-mono text-[10px] font-semibold">
                        FIX ×{countLyricsFixTags(activeDoc.content)}
                      </span>
                    )}
                  </div>
                  <span className="text-[10.5px] text-slate-400 dark:text-zinc-500">
                    Clique sur l’icône à gauche d’une ligne pour la marquer À fix
                  </span>
                </div>

                {markdownMode === 'edit' ? (
                  measuresVisible && linkedTrack && analysisTrack ? (
                    <LyricsMeasuresEditor
                      track={linkedTrack}
                      analysisTrack={analysisTrack}
                      blocks={resolvedBarBlocks}
                      analyzing={analyzingTrackId === analysisTrack.id}
                      isPlayingThisSong={isPlayingEitherLinked}
                      liveTimeSec={livePlaySec}
                      activeAbLoop={player.abLoop}
                      onChangeBlocks={handleBarBlocksChange}
                      onUpdateTrackMeta={handleUpdateAnalysisMeta}
                      onReanalyze={handleReanalyzeTrack}
                      onJumpToSec={handleJumpToBarSec}
                      onToggleBlockLoop={handleToggleBlockLoop}
                      onActiveBlockFocus={setFocusedBlockIndex}
                    />
                  ) : (
                    <LyricLinesEditor
                      value={activeDoc.content}
                      onChange={handleContentChange}
                      onFocusLine={setFocusedFreeLineIndex}
                      placeholder="Commence à écrire tes couplets, refrains, idées de flow…"
                      minHeightClass="flex-1 w-full min-h-[68dvh] pb-6"
                    />
                  )
                ) : (
                  <div className="flex-1 w-full min-h-[68dvh] text-[15.5px] sm:text-base leading-[1.85] text-slate-800 dark:text-zinc-100 pb-6 space-y-0.5">
                    {renderedPreviewLines.map((ln, idx) =>
                      ln.text.trim().length === 0 && !ln.fix ? (
                        <div key={idx} className="h-4" />
                      ) : (
                        <div
                          key={idx}
                          className={`flex items-start gap-2 rounded-xl px-2 -mx-2 py-0.5 ${
                            ln.fix
                              ? 'bg-rose-500/[0.08] dark:bg-rose-500/[0.13] ring-1 ring-rose-500/25 my-0.5 font-medium text-slate-950 dark:text-white'
                              : ''
                          }`}
                        >
                          {ln.fix && (
                            <span className="mt-1 rounded-md bg-[#8C271E] text-white px-1.5 py-0.5 text-[9.5px] font-bold tracking-wide shrink-0">
                              FIX
                            </span>
                          )}
                          <span className="whitespace-pre-wrap break-words">{ln.text}</span>
                        </div>
                      )
                    )}
                  </div>
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

          {/* Searchable Deduplicated Song Picker Modal */}
          {trackPickerOpen && (
            <div
              onClick={() => setTrackPickerOpen(false)}
              className="fixed inset-0 z-[60] bg-slate-950/50 dark:bg-black/70 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-white dark:bg-[#141418] border border-slate-200 dark:border-zinc-800 shadow-2xl overflow-hidden flex flex-col max-h-[80dvh]"
              >
                <div className="px-4 py-3.5 border-b border-slate-100 dark:border-zinc-800 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-zinc-100 truncate">
                    Associer un son ({trackGroups.length})
                  </h3>
                  <button
                    type="button"
                    onClick={() => setTrackPickerOpen(false)}
                    className="p-1.5 rounded-full text-slate-400 hover:text-slate-800 dark:hover:text-zinc-200 cursor-pointer"
                  >
                    <X size={15} />
                  </button>
                </div>

                <div className="p-3 border-b border-slate-100 dark:border-zinc-800 space-y-2">
                  <div className="flex items-center gap-2 rounded-xl bg-slate-100/80 dark:bg-zinc-900 border border-slate-200/70 dark:border-zinc-800 px-3 py-2">
                    <Search size={13} className="text-slate-400 shrink-0" />
                    <input
                      autoFocus
                      type="text"
                      value={trackPickerSearch}
                      onChange={(e) => setTrackPickerSearch(e.target.value)}
                      placeholder="Rechercher un morceau…"
                      className="w-full bg-transparent text-xs outline-none text-slate-900 dark:text-zinc-100 placeholder:text-slate-400"
                    />
                    {trackPickerSearch && (
                      <button
                        type="button"
                        onClick={() => setTrackPickerSearch('')}
                        className="text-slate-400 hover:text-slate-700 cursor-pointer"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>

                  {linkedTrack && (
                    <button
                      type="button"
                      onClick={() => {
                        if (linkedGroup) {
                          for (const id of linkedGroup.allTrackIds) {
                            const t = state.musicTracks.find((x) => x.id === id);
                            if (t?.linkedLyricsId === activeDoc.id) {
                              updateMusicTrack(id, { linkedLyricsId: undefined });
                            }
                          }
                        } else if (linkedTrack.linkedLyricsId === activeDoc.id) {
                          updateMusicTrack(linkedTrack.id, { linkedLyricsId: undefined });
                        }
                        updateLyricsDoc(activeDoc.id, { linkedTrackId: undefined });
                        notify('Son dissocié');
                        setTrackPickerOpen(false);
                      }}
                      className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 dark:border-rose-900/60 px-3 py-2 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer"
                    >
                      <Unlink size={12} /> Dissocier « {linkedGroup?.baseTitle || linkedTrack.title} »
                    </button>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  {(() => {
                    const q = trackPickerSearch.trim().toLowerCase();
                    const matches = trackGroups.filter((g) => {
                      if (!q) return true;
                      return (
                        g.baseTitle.toLowerCase().includes(q) ||
                        g.versions.some((v) => v.track.title.toLowerCase().includes(q))
                      );
                    });
                    if (matches.length === 0) {
                      return (
                        <p className="py-8 text-center text-xs text-slate-400">
                          Aucun morceau trouvé.
                        </p>
                      );
                    }
                    return matches.map((g) => {
                      const isSelected = Boolean(
                        activeDoc.linkedTrackId && g.allTrackIds.includes(activeDoc.linkedTrackId)
                      );
                      return (
                        <button
                          key={g.groupKey}
                          type="button"
                          onClick={() => {
                            // Clear previous track's reverse link if different
                            if (linkedGroup && linkedGroup.groupKey !== g.groupKey) {
                              for (const id of linkedGroup.allTrackIds) {
                                const t = state.musicTracks.find((x) => x.id === id);
                                if (t?.linkedLyricsId === activeDoc.id) {
                                  updateMusicTrack(id, { linkedLyricsId: undefined });
                                }
                              }
                            }
                            updateLyricsDoc(activeDoc.id, { linkedTrackId: g.latestTrack.id });
                            updateMusicTrack(g.latestTrack.id, { linkedLyricsId: activeDoc.id });
                            notify(`Son « ${g.baseTitle} » associé ✓`);
                            setTrackPickerOpen(false);
                          }}
                          className={`w-full flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left transition cursor-pointer ${
                            isSelected
                              ? 'bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25'
                              : 'hover:bg-slate-100 dark:hover:bg-zinc-800/80 text-slate-800 dark:text-zinc-100'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-semibold truncate">{g.baseTitle}</span>
                              {g.hasMultipleVersions && (
                                <span
                                  className={`font-mono text-[9px] rounded-full px-1.5 py-0.5 shrink-0 ${
                                    isSelected
                                      ? 'bg-white/15 dark:bg-black/15'
                                      : 'bg-slate-100 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400'
                                  }`}
                                >
                                  {g.latestVersionLabel} · {g.versions.length}
                                </span>
                              )}
                              {g.prodTrack && (
                                <span
                                  className={`text-[9px] font-semibold rounded-full px-1.5 py-0.5 shrink-0 ${
                                    isSelected
                                      ? 'bg-emerald-500/30 text-emerald-200 dark:text-emerald-700'
                                      : 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400'
                                  }`}
                                >
                                  Prod
                                </span>
                              )}
                            </div>
                          </div>
                          {isSelected && <Check size={14} className="shrink-0" />}
                        </button>
                      );
                    });
                  })()}
                </div>
              </div>
            </div>
          )}

          {/* Apple-Style Folder Assignment Sheet */}
          {folderPickerOpen && (
            <div
              onClick={() => setFolderPickerOpen(false)}
              className="fixed inset-0 z-[60] bg-slate-950/50 dark:bg-black/70 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="w-full sm:max-w-xs rounded-t-3xl sm:rounded-3xl bg-white dark:bg-[#141418] border border-slate-200 dark:border-zinc-800 shadow-2xl overflow-hidden flex flex-col max-h-[70dvh]"
              >
                <div className="px-4 py-3.5 border-b border-slate-100 dark:border-zinc-800 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-zinc-100 truncate">
                    Classer dans un dossier
                  </h3>
                  <button
                    type="button"
                    onClick={() => setFolderPickerOpen(false)}
                    className="p-1.5 rounded-full text-slate-400 hover:text-slate-800 dark:hover:text-zinc-200 cursor-pointer"
                  >
                    <X size={15} />
                  </button>
                </div>

                <div className="p-2 overflow-y-auto space-y-1">
                  <button
                    type="button"
                    onClick={() => {
                      updateLyricsDoc(activeDoc.id, { folderId: null });
                      setFolderPickerOpen(false);
                    }}
                    className={`w-full flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left text-xs font-medium transition cursor-pointer ${
                      !activeDoc.folderId
                        ? 'bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25 font-semibold'
                        : 'text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800/80'
                    }`}
                  >
                    <span>Sans dossier</span>
                    {!activeDoc.folderId && <Check size={14} />}
                  </button>
                  {state.lyricsFolders.map((f) => {
                    const selected = activeDoc.folderId === f.id;
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => {
                          updateLyricsDoc(activeDoc.id, { folderId: f.id });
                          setFolderPickerOpen(false);
                        }}
                        className={`w-full flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left text-xs font-medium transition cursor-pointer ${
                          selected
                            ? 'bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25 font-semibold'
                            : 'text-slate-800 dark:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-800/80'
                        }`}
                      >
                        <span className="flex items-center gap-2 truncate">
                          <Folder size={13} className={selected ? 'text-current' : 'text-slate-400'} />
                          <span className="truncate">{f.name}</span>
                        </span>
                        {selected && <Check size={14} />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <AppleConfirmDialog
        open={confirmEmptyTrashOpen}
        title="Vider la corbeille ?"
        description="Tous les textes placés dans la corbeille seront supprimés définitivement."
        confirmLabel="Vider"
        destructive
        onConfirm={emptyLyricsTrash}
        onCancel={() => setConfirmEmptyTrashOpen(false)}
      />

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
