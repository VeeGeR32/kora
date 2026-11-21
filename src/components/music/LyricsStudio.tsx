import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Disc3,
  Edit3,
  Eye,
  FilePlus,
  FileText,
  Folder,
  FolderPlus,
  Menu,
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

function fmt(sec: number) {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function LyricsStudio({ initialDocId }: LyricsStudioProps) {
  const {
    state,
    addLyricsFolder,
    renameLyricsFolder,
    moveLyricsFolder,
    deleteLyricsFolder,
    addLyricsDoc,
    updateLyricsDoc,
    softDeleteLyricsDoc,
    restoreLyricsDoc,
    permanentDeleteLyricsDoc,
    emptyLyricsTrash,
  } = useApp();

  const player = useAudioPlayer();

  const [activeDocId, setActiveDocId] = useState<string | null>(
    initialDocId || state.lyricsDocs.find((d) => !d.deletedAt)?.id || null
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [treeView, setTreeView] = useState<'explorer' | 'trash'>('explorer');
  const [expandedFolders, setExpandedFolders] = useState<string[]>(() =>
    state.lyricsFolders.map((f) => f.id)
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [markdownMode, setMarkdownMode] = useState<'edit' | 'preview'>('edit');
  const [beatMode, setBeatMode] = useState<'mp3' | 'youtube'>('mp3');
  const [inlineEdit, setInlineEdit] = useState<{
    id: string;
    type: 'file' | 'folder' | 'new-folder';
    value: string;
    parentId?: string | null;
  } | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Undo / Redo per active doc
  const [history, setHistory] = useState<string[]>([]);
  const [historyStep, setHistoryStep] = useState(-1);
  const isUndoing = useRef(false);

  useEffect(() => {
    if (initialDocId) setActiveDocId(initialDocId);
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
      setHistory([activeDoc.content]);
      setHistoryStep(0);
    }
  }, [activeDocId]);

  const visibleDocs = useMemo(
    () => state.lyricsDocs.filter((d) => !d.deletedAt),
    [state.lyricsDocs]
  );
  const trashedDocs = useMemo(
    () => state.lyricsDocs.filter((d) => Boolean(d.deletedAt)),
    [state.lyricsDocs]
  );

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

  const handleCreateDoc = (folderId: string | null) => {
    const newId = addLyricsDoc({ folderId });
    setActiveDocId(newId);
    setTreeView('explorer');
    if (folderId && !expandedFolders.includes(folderId)) {
      setExpandedFolders((prev) => [...prev, folderId]);
    }
    setSidebarOpen(false);
  };

  const saveInlineEdit = () => {
    if (!inlineEdit || !inlineEdit.value.trim()) {
      setInlineEdit(null);
      return;
    }
    if (inlineEdit.type === 'file') {
      updateLyricsDoc(inlineEdit.id, { title: inlineEdit.value.trim() });
    } else if (inlineEdit.type === 'folder') {
      renameLyricsFolder(inlineEdit.id, inlineEdit.value.trim());
    } else if (inlineEdit.type === 'new-folder') {
      const fId = addLyricsFolder(inlineEdit.value.trim(), inlineEdit.parentId ?? null);
      setExpandedFolders((prev) => [...prev, fId]);
    }
    setInlineEdit(null);
  };

  const handleDrop = (e: React.DragEvent, targetFolderId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverId(null);
    const id = e.dataTransfer.getData('lexId');
    const type = e.dataTransfer.getData('lexType');
    if (!id) return;
    if (type === 'file') updateLyricsDoc(id, { folderId: targetFolderId });
    else if (type === 'folder' && id !== targetFolderId) moveLyricsFolder(id, targetFolderId);
    if (targetFolderId && !expandedFolders.includes(targetFolderId)) {
      setExpandedFolders((prev) => [...prev, targetFolderId]);
    }
  };

  const renderTree = (parentId: string | null = null, depth = 0): React.ReactNode => {
    const childFolders = state.lyricsFolders.filter((f) => f.parentId === parentId);
    const childDocs = visibleDocs.filter((d) => {
      const matchesParent =
        d.folderId === parentId ||
        (parentId === null && d.folderId && !state.lyricsFolders.some((f) => f.id === d.folderId));
      const matchesSearch =
        !searchQuery.trim() ||
        d.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        d.content.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesParent && matchesSearch;
    });

    return (
      <>
        {childFolders.map((folder) => {
          const isExpanded = expandedFolders.includes(folder.id);
          const isEditing = inlineEdit?.id === folder.id && inlineEdit.type === 'folder';
          return (
            <div key={folder.id}>
              <div
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('lexId', folder.id);
                  e.dataTransfer.setData('lexType', 'folder');
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOverId(folder.id);
                }}
                onDragLeave={() => setDragOverId(null)}
                onDrop={(e) => handleDrop(e, folder.id)}
                onClick={() =>
                  setExpandedFolders((prev) =>
                    isExpanded ? prev.filter((x) => x !== folder.id) : [...prev, folder.id]
                  )
                }
                style={{ paddingLeft: `${depth * 12 + 8}px` }}
                className={`group flex items-center gap-1.5 py-1.5 pr-2 rounded-lg text-xs font-semibold cursor-pointer transition ${
                  dragOverId === folder.id
                    ? 'bg-fuchsia-500/15'
                    : 'text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800/70'
                }`}
              >
                {isExpanded ? <ChevronDown size={13} className="opacity-50" /> : <ChevronRight size={13} className="opacity-50" />}
                <Folder size={13} className="opacity-70 shrink-0" />
                {isEditing ? (
                  <input
                    autoFocus
                    value={inlineEdit.value}
                    onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
                    onBlur={saveInlineEdit}
                    onKeyDown={(e) => e.key === 'Enter' && saveInlineEdit()}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 bg-transparent outline-none min-w-0"
                  />
                ) : (
                  <span
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setInlineEdit({ id: folder.id, type: 'folder', value: folder.name });
                    }}
                    className="truncate flex-1"
                  >
                    {folder.name}
                  </span>
                )}
                <div className="flex items-center gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCreateDoc(folder.id);
                    }}
                    className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-zinc-100 cursor-pointer"
                    title="Nouveau texte"
                  >
                    <Plus size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteLyricsFolder(folder.id);
                    }}
                    className="p-1 text-slate-400 hover:text-rose-500 cursor-pointer"
                    title="Supprimer dossier"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
              {isExpanded && renderTree(folder.id, depth + 1)}
            </div>
          );
        })}

        {childDocs.map((doc) => {
          const isActive = activeDocId === doc.id;
          return (
            <div
              key={doc.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('lexId', doc.id);
                e.dataTransfer.setData('lexType', 'file');
              }}
              onClick={() => {
                setActiveDocId(doc.id);
                setSidebarOpen(false);
              }}
              style={{ paddingLeft: `${depth * 12 + 24}px` }}
              className={`group flex items-center justify-between py-1.5 pr-2 rounded-lg text-xs cursor-pointer transition ${
                isActive
                  ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 font-medium'
                  : 'text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800/70'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <button
                  type="button"
                  title="Statut : Brouillon → En cours → Terminé"
                  onClick={(e) => {
                    e.stopPropagation();
                    const nextStatus = doc.status === 3 ? 1 : ((doc.status + 1) as 1 | 2 | 3);
                    updateLyricsDoc(doc.id, { status: nextStatus });
                  }}
                  className="shrink-0 cursor-pointer"
                >
                  <Circle
                    size={8}
                    className={`${
                      doc.status === 3
                        ? 'text-emerald-500'
                        : doc.status === 2
                        ? 'text-amber-500'
                        : 'text-slate-300 dark:text-zinc-600'
                    } fill-current`}
                  />
                </button>
                <span className="truncate">{doc.title}</span>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  softDeleteLyricsDoc(doc.id);
                  if (activeDocId === doc.id) setActiveDocId(null);
                }}
                className="opacity-100 md:opacity-0 md:group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-500 transition cursor-pointer shrink-0"
              >
                <Trash2 size={11} />
              </button>
            </div>
          );
        })}
      </>
    );
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

  return (
    <div className="tempo-card rounded-3xl overflow-hidden flex flex-col lg:flex-row min-h-[640px] relative">
      {/* Mobile Explorer Drawer Backdrop */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="lg:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]"
        />
      )}

      {/* LEFT: LexCore Folder & File Explorer */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-64 shrink-0 border-r border-slate-100 dark:border-zinc-800/80 bg-slate-50/95 dark:bg-[#101014] lg:bg-slate-50/60 lg:dark:bg-zinc-900/35 flex flex-col transition-transform duration-200 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="p-3.5 border-b border-slate-100 dark:border-zinc-800/80 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold tracking-tight text-slate-900 dark:text-zinc-100">
              LEXCORE · TEXTES
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setImportModalOpen(true)}
                title="Importer / Exporter backup LexCore (JSON MongoDB)"
                className="p-1.5 rounded-lg text-fuchsia-600 dark:text-fuchsia-400 hover:bg-fuchsia-500/12 cursor-pointer"
              >
                <Upload size={14} />
              </button>
              <button
                type="button"
                onClick={() => handleCreateDoc(null)}
                title="Nouveau texte"
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-zinc-100 hover:bg-slate-200/70 dark:hover:bg-zinc-800 cursor-pointer"
              >
                <FilePlus size={14} />
              </button>
              <button
                type="button"
                onClick={() =>
                  setInlineEdit({ id: 'new', type: 'new-folder', value: '', parentId: null })
                }
                title="Nouveau dossier"
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-zinc-100 hover:bg-slate-200/70 dark:hover:bg-zinc-800 cursor-pointer"
              >
                <FolderPlus size={14} />
              </button>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="lg:hidden p-1.5 rounded-lg text-slate-400"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-xl bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 px-2.5 py-1.5">
            <Search size={13} className="text-slate-400 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher un texte…"
              className="w-full bg-transparent text-xs outline-none"
            />
          </div>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOverId(null);
          }}
          onDrop={(e) => handleDrop(e, null)}
          className="flex-1 overflow-y-auto p-2 space-y-0.5"
        >
          {treeView === 'explorer' ? (
            <>
              {renderTree(null, 0)}
              {inlineEdit?.type === 'new-folder' && (
                <div className="flex items-center gap-1.5 px-2 py-1.5">
                  <Folder size={13} className="text-slate-400" />
                  <input
                    autoFocus
                    value={inlineEdit.value}
                    onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
                    onBlur={saveInlineEdit}
                    onKeyDown={(e) => e.key === 'Enter' && saveInlineEdit()}
                    placeholder="Nom du dossier…"
                    className="flex-1 bg-transparent border-b border-slate-400 text-xs outline-none"
                  />
                </div>
              )}
            </>
          ) : (
            <div className="space-y-1.5 p-1">
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Corbeille
                </span>
                {trashedDocs.length > 0 && (
                  <button
                    type="button"
                    onClick={emptyLyricsTrash}
                    className="text-[10px] font-semibold text-rose-500 hover:underline cursor-pointer"
                  >
                    Vider
                  </button>
                )}
              </div>
              {trashedDocs.length === 0 ? (
                <p className="text-xs text-slate-400 px-1 py-4 text-center">Corbeille vide</p>
              ) : (
                trashedDocs.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center justify-between gap-2 rounded-lg bg-rose-50/70 dark:bg-rose-950/30 px-2.5 py-1.5 text-xs"
                  >
                    <span className="truncate text-rose-800 dark:text-rose-200">{d.title}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => restoreLyricsDoc(d.id)}
                        title="Restaurer"
                        className="p-1 text-emerald-600 cursor-pointer"
                      >
                        <RefreshCcw size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => permanentDeleteLyricsDoc(d.id)}
                        title="Supprimer définitivement"
                        className="p-1 text-rose-500 cursor-pointer"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <div className="p-2.5 border-t border-slate-100 dark:border-zinc-800/80">
          <button
            type="button"
            onClick={() => setTreeView((v) => (v === 'explorer' ? 'trash' : 'explorer'))}
            className={`w-full flex items-center justify-between rounded-xl px-3 py-2 text-xs font-medium transition cursor-pointer ${
              treeView === 'trash'
                ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                : 'text-slate-500 hover:bg-slate-200/60 dark:hover:bg-zinc-800/70'
            }`}
          >
            <span className="flex items-center gap-2">
              {treeView === 'trash' ? <Folder size={13} /> : <Trash2 size={13} />}
              {treeView === 'trash' ? 'Retour textes' : 'Corbeille'}
            </span>
            <span className="font-mono text-[10px] opacity-75">{trashedDocs.length}</span>
          </button>
        </div>
      </aside>

      {/* CENTER: Minimalist Lyrics Editor + Beat Player */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Editor Toolbar */}
        <div className="px-4 py-3 border-b border-slate-100 dark:border-zinc-800/80 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-xl border border-slate-200 dark:border-zinc-800 text-slate-600 dark:text-zinc-300"
              aria-label="Ouvrir les textes"
            >
              <Menu size={15} />
            </button>

            {activeDoc ? (
              <input
                type="text"
                value={activeDoc.title}
                onChange={(e) => updateLyricsDoc(activeDoc.id, { title: e.target.value })}
                className="font-semibold text-base sm:text-lg text-slate-900 dark:text-zinc-100 bg-transparent outline-none truncate flex-1 min-w-0"
              />
            ) : (
              <span className="text-sm text-slate-400">Aucun texte sélectionné</span>
            )}
          </div>

          {activeDoc && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <div className="flex items-center rounded-xl border border-slate-200/80 dark:border-zinc-800 p-0.5 bg-slate-50 dark:bg-zinc-900">
                <button
                  type="button"
                  onClick={handleUndo}
                  disabled={historyStep <= 0}
                  className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-zinc-100 disabled:opacity-30 cursor-pointer"
                >
                  <Undo size={13} />
                </button>
                <button
                  type="button"
                  onClick={handleRedo}
                  disabled={historyStep >= history.length - 1}
                  className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-zinc-100 disabled:opacity-30 cursor-pointer"
                >
                  <Redo size={13} />
                </button>
              </div>

              <div className="hidden sm:flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => {
                    const idx = visibleDocs.findIndex((d) => d.id === activeDoc.id);
                    if (idx > 0) setActiveDocId(visibleDocs[idx - 1].id);
                  }}
                  className="p-1.5 text-slate-400 hover:text-slate-800 dark:hover:text-zinc-200 cursor-pointer"
                  title="Texte précédent"
                >
                  <ChevronLeft size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const idx = visibleDocs.findIndex((d) => d.id === activeDoc.id);
                    if (idx >= 0 && idx < visibleDocs.length - 1) setActiveDocId(visibleDocs[idx + 1].id);
                  }}
                  className="p-1.5 text-slate-400 hover:text-slate-800 dark:hover:text-zinc-200 cursor-pointer"
                  title="Texte suivant"
                >
                  <ChevronRight size={15} />
                </button>
              </div>

              <button
                type="button"
                onClick={() => wrapSelection('**')}
                className="px-2 py-1 rounded-lg text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                B
              </button>
              <button
                type="button"
                onClick={() => wrapSelection('*')}
                className="px-2 py-1 rounded-lg text-xs italic text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                I
              </button>

              <div className="flex items-center rounded-xl border border-slate-200/80 dark:border-zinc-800 p-0.5 bg-slate-50 dark:bg-zinc-900">
                <button
                  type="button"
                  onClick={() => setMarkdownMode('edit')}
                  className={`p-1.5 rounded-lg transition cursor-pointer ${
                    markdownMode === 'edit'
                      ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                      : 'text-slate-500'
                  }`}
                  title="Édition"
                >
                  <Edit3 size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => setMarkdownMode('preview')}
                  className={`p-1.5 rounded-lg transition cursor-pointer ${
                    markdownMode === 'preview'
                      ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                      : 'text-slate-500'
                  }`}
                  title="Aperçu"
                >
                  <Eye size={13} />
                </button>
              </div>

              <button
                type="button"
                onClick={() => setToolsOpen((v) => !v)}
                className={`inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-medium transition cursor-pointer ${
                  toolsOpen
                    ? 'bg-fuchsia-600 text-white'
                    : 'bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300'
                }`}
              >
                <Sparkles size={12} />
                Outils
              </button>
            </div>
          )}
        </div>

        {/* Main Writing Canvas */}
        {activeDoc ? (
          <>
            <div className="flex-1 flex flex-col md:flex-row min-h-[320px]">
              <div className="flex-1 flex flex-col min-w-0">
                {markdownMode === 'edit' ? (
                  <textarea
                    ref={textareaRef}
                    value={activeDoc.content}
                    onChange={(e) => handleContentChange(e.target.value)}
                    placeholder="Commence à écrire tes couplets, refrains, idées de flow…"
                    spellCheck={false}
                    className="flex-1 w-full min-h-[290px] p-5 sm:p-7 bg-transparent outline-none resize-none text-[15px] leading-[1.85] font-medium text-slate-800 dark:text-zinc-100 placeholder:text-slate-300 dark:placeholder:text-zinc-700"
                  />
                ) : (
                  <div
                    className="flex-1 w-full min-h-[290px] p-5 sm:p-7 text-[15px] leading-[1.85] text-slate-800 dark:text-zinc-100 overflow-y-auto"
                    dangerouslySetInnerHTML={{ __html: renderedMarkdown }}
                  />
                )}

                <div className="px-5 py-1.5 flex items-center justify-between text-[10px] font-mono text-slate-400 border-t border-slate-100/80 dark:border-zinc-800/60">
                  <span>
                    {lineCount} lignes · {wordCount} mots
                  </span>
                  <div className="flex items-center gap-2">
                    <select
                      value={activeDoc.linkedTrackId || ''}
                      onChange={(e) =>
                        updateLyricsDoc(activeDoc.id, { linkedTrackId: e.target.value || undefined })
                      }
                      className="bg-transparent text-[11px] text-slate-500 dark:text-zinc-400 outline-none cursor-pointer"
                    >
                      <option value="">Associer un MP3…</option>
                      {state.musicTracks.map((t) => (
                        <option key={t.id} value={t.id}>
                          MP3 : {t.title}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Right Collapsible LexCore Inspiration + Metronome Panel */}
              {toolsOpen && (
                <div className="w-full md:w-64 shrink-0 border-t md:border-t-0 md:border-l border-slate-100 dark:border-zinc-800/80 p-3.5 space-y-3 bg-white/40 dark:bg-zinc-950/30">
                  <LexCoreInspirationWidget onInsertWord={insertWord} />
                  <MetronomeWidget initialBpm={linkedTrack?.bpm || 120} />
                </div>
              )}
            </div>

            {/* Bottom Dual Beat Player (MP3 Bibliothèque OU Prod YouTube LexCore) */}
            <div className="border-t border-slate-100 dark:border-zinc-800/80 p-4 bg-slate-50/50 dark:bg-zinc-900/35 space-y-3">
              <div className="flex items-center justify-between gap-2">
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
                    MP3 Kora
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

                {linkedTrack && beatMode === 'mp3' && (
                  <span className="text-[11px] font-mono text-slate-400 truncate">
                    {linkedTrack.title} {linkedTrack.bpm ? `· ${linkedTrack.bpm} BPM` : ''}
                  </span>
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
                <div className="space-y-2.5">
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() =>
                        player.currentTrack?.id === linkedTrack.id
                          ? player.togglePlay()
                          : void player.playTrack(linkedTrack)
                      }
                      className="h-10 w-10 rounded-full bg-fuchsia-600 text-white flex items-center justify-center shrink-0 hover:bg-fuchsia-700 transition cursor-pointer"
                    >
                      {isPlayingLinked ? (
                        <Pause size={16} fill="currentColor" />
                      ) : (
                        <Play size={16} fill="currentColor" className="ml-0.5" />
                      )}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-900 dark:text-zinc-100 truncate">
                        {linkedTrack.title}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {linkedTrack.mediaId || linkedTrack.cloudAudioUrl
                          ? 'Lecture synchronisée avec le Mini-Player'
                          : 'Importe le fichier MP3 dans Bibliothèque MP3 pour l’écouter ici'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => player.setLoop(!player.loop)}
                      className={`h-9 w-9 rounded-xl flex items-center justify-center cursor-pointer ${
                        player.loop
                          ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                          : 'bg-slate-100 dark:bg-zinc-800 text-slate-500'
                      }`}
                    >
                      <Repeat size={14} />
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
                <p className="text-xs text-slate-400 dark:text-zinc-500">
                  Associe un MP3 de ta bibliothèque ci-dessus ou bascule sur <strong>Prod YouTube</strong> pour écrire sur instru.
                </p>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-10 text-center">
            <FileText size={36} className="text-slate-300 dark:text-zinc-700 mb-3" />
            <p className="text-sm font-medium text-slate-500 dark:text-zinc-400">
              Ouvre un texte ou crée une nouvelle page blanche
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => handleCreateDoc(null)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-4 py-2 text-xs font-semibold cursor-pointer"
              >
                <Plus size={14} /> Nouveau texte
              </button>
              <button
                type="button"
                onClick={() => setImportModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-zinc-800 px-4 py-2 text-xs font-semibold text-fuchsia-600 dark:text-fuchsia-400 hover:bg-fuchsia-500/10 cursor-pointer"
              >
                <Upload size={14} /> Importer backup JSON
              </button>
            </div>
          </div>
        )}
      </div>

      <LexCoreImportModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onImported={(firstDocId, newFolderIds) => {
          if (newFolderIds.length > 0) {
            setExpandedFolders((prev) => Array.from(new Set([...prev, ...newFolderIds])));
          }
          if (firstDocId) {
            setActiveDocId(firstDocId);
            setTreeView('explorer');
          }
        }}
      />
    </div>
  );
}
