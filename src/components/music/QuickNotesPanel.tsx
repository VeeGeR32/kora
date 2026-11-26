import React, { useMemo, useState } from 'react';
import {
  Check,
  ExternalLink,
  ListChecks,
  Music2,
  Pause,
  Pencil,
  Play,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import type { MusicNoteItem } from '../../types';
import { useApp } from '../../context/AppContext';
import { useAudioPlayer } from '../../context/AudioPlayerContext';
import { groupMusicTracks } from '../../lib/musicVersioning';

interface QuickNotesPanelProps {
  notes: MusicNoteItem[];
  placeholder?: string;
  emptyHint?: string;
  onAdd: (text: string, linkedTrackId?: string) => void;
  onUpdate: (noteId: string, text: string) => void;
  onDelete: (noteId: string) => void;
  onPromoteToTodo: (noteId: string) => void;
}

const URL_SPLIT_RE = /(https?:\/\/[^\s]+)/gi;

function renderRichNoteText(text: string): React.ReactNode {
  const parts = text.split(URL_SPLIT_RE);
  if (parts.length === 1) return text;
  return parts.map((part, idx) => {
    if (/^https?:\/\//i.test(part)) {
      let label = part;
      try {
        const u = new URL(part);
        label = u.hostname.replace(/^www\./, '');
      } catch {
        // keep raw
      }
      return (
        <a
          key={idx}
          href={part}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-0.5 mx-0.5 px-1.5 py-0.5 rounded-md bg-sky-500/12 text-sky-600 dark:text-sky-400 hover:underline font-medium align-baseline"
        >
          <span>{label}</span>
          <ExternalLink size={9.5} />
        </a>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

export function QuickNotesPanel({
  notes,
  placeholder = '+ Noter une inspi, une idée ou coller un lien…',
  emptyHint = 'Aucune note d’inspi pour l’instant — note une vibe, colle un lien Spotify/YouTube ou lie un son de ta bibliothèque.',
  onAdd,
  onUpdate,
  onDelete,
  onPromoteToTodo,
}: QuickNotesPanelProps) {
  const { state } = useApp();
  const player = useAudioPlayer();

  const [draft, setDraft] = useState('');
  const [selectedRefTrackId, setSelectedRefTrackId] = useState<string | null>(null);
  const [refPickerOpen, setRefPickerOpen] = useState(false);
  const [refSearch, setRefSearch] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteDraft, setEditingNoteDraft] = useState('');

  const allGroups = useMemo(() => groupMusicTracks(state.musicTracks), [state.musicTracks]);

  const trackById = useMemo(
    () => new Map(state.musicTracks.map((t) => [t.id, t])),
    [state.musicTracks]
  );

  const selectedRefGroup = useMemo(
    () =>
      selectedRefTrackId
        ? allGroups.find((g) => g.allTrackIds.includes(selectedRefTrackId)) || null
        : null,
    [allGroups, selectedRefTrackId]
  );

  const filteredRefGroups = useMemo(() => {
    const q = refSearch.trim().toLowerCase();
    if (!q) return allGroups.slice(0, 12);
    return allGroups
      .filter((g) => g.baseTitle.toLowerCase().includes(q))
      .slice(0, 12);
  }, [allGroups, refSearch]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = draft.trim();
    const refTitle = selectedRefGroup?.baseTitle;
    if (!clean && !selectedRefTrackId) return;
    onAdd(clean || `Inspi : ${refTitle || 'Référence'}`, selectedRefTrackId || undefined);
    setDraft('');
    setSelectedRefTrackId(null);
    setRefPickerOpen(false);
    setRefSearch('');
  };

  return (
    <div className="space-y-2.5">
      {/* Notes list */}
      <div className="space-y-1.5">
        {notes.length === 0 ? (
          <p className="text-[11px] text-slate-400 py-1 leading-relaxed">{emptyHint}</p>
        ) : (
          notes.map((note) => {
            const isEditing = editingNoteId === note.id;
            const refTrack = note.linkedTrackId ? trackById.get(note.linkedTrackId) || null : null;
            const refGroup = refTrack
              ? allGroups.find((g) => g.allTrackIds.includes(refTrack.id)) || null
              : null;
            const playableRef = refGroup?.latestTrack || refTrack;
            const isPlayingRef = Boolean(
              playableRef && player.currentTrack?.id === playableRef.id && player.isPlaying
            );

            return (
              <div
                key={note.id}
                className="group rounded-xl px-2.5 py-2 bg-white/65 dark:bg-zinc-900/55 border border-slate-200/60 dark:border-zinc-800/70 hover:border-slate-300 dark:hover:border-zinc-700 transition space-y-1.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0 flex-1">
                    <Sparkles
                      size={12}
                      className="text-amber-500/80 dark:text-amber-400/80 shrink-0 mt-0.5"
                    />
                    {isEditing ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (editingNoteDraft.trim()) {
                            onUpdate(note.id, editingNoteDraft);
                          }
                          setEditingNoteId(null);
                        }}
                        className="flex-1 flex items-center gap-1.5 min-w-0"
                      >
                        <input
                          autoFocus
                          type="text"
                          value={editingNoteDraft}
                          onChange={(e) => setEditingNoteDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') setEditingNoteId(null);
                          }}
                          onBlur={() => {
                            if (editingNoteDraft.trim()) {
                              onUpdate(note.id, editingNoteDraft);
                            }
                            setEditingNoteId(null);
                          }}
                          className="flex-1 min-w-0 rounded-lg border border-[#8C271E]/50 bg-white dark:bg-zinc-950 px-2 py-1 text-xs text-slate-900 dark:text-zinc-100 outline-none"
                        />
                        <button
                          type="submit"
                          onMouseDown={(e) => e.preventDefault()}
                          aria-label="Enregistrer"
                          className="p-1 rounded-lg bg-[#8C271E] text-white cursor-pointer shrink-0"
                        >
                          <Check size={11} />
                        </button>
                      </form>
                    ) : (
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setEditingNoteId(note.id);
                          setEditingNoteDraft(note.text);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            setEditingNoteId(note.id);
                            setEditingNoteDraft(note.text);
                          }
                        }}
                        title="Cliquer pour modifier cette note"
                        className="text-xs text-slate-800 dark:text-zinc-100 leading-relaxed break-words flex-1 cursor-text"
                      >
                        {renderRichNoteText(note.text)}
                      </div>
                    )}
                  </div>

                  {!isEditing && (
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => onPromoteToTodo(note.id)}
                        title="Convertir en tâche TODO"
                        aria-label="Convertir en tâche TODO"
                        className="opacity-65 sm:opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-[#8C271E] dark:hover:text-[#F08B82] transition cursor-pointer"
                      >
                        <ListChecks size={11.5} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingNoteId(note.id);
                          setEditingNoteDraft(note.text);
                        }}
                        title="Modifier"
                        aria-label="Modifier"
                        className="opacity-65 sm:opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-slate-900 dark:hover:text-zinc-100 transition cursor-pointer"
                      >
                        <Pencil size={11} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(note.id)}
                        title="Supprimer"
                        aria-label="Supprimer"
                        className="opacity-65 sm:opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-500 transition cursor-pointer"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  )}
                </div>

                {/* Playable Linked Reference Song Pill */}
                {playableRef && (
                  <div className="pl-5 flex items-center gap-1.5">
                    <div className="inline-flex items-center rounded-full bg-[#8C271E]/10 dark:bg-[#8C271E]/22 border border-[#8C271E]/25 overflow-hidden max-w-full">
                      <button
                        type="button"
                        onClick={() => {
                          if (player.currentTrack?.id === playableRef.id) {
                            player.togglePlay();
                          } else {
                            void player.playTrack(playableRef, 0);
                          }
                        }}
                        title={isPlayingRef ? 'Pause' : 'Écouter ce son de référence'}
                        className="h-6 w-6 flex items-center justify-center bg-[#8C271E] text-white shrink-0 cursor-pointer hover:opacity-90"
                      >
                        {isPlayingRef ? (
                          <Pause size={10} fill="currentColor" />
                        ) : (
                          <Play size={10} fill="currentColor" className="ml-0.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => player.requestOpenTrackPage(playableRef.id)}
                        title="Ouvrir la page de ce son"
                        className="px-2.5 py-0.5 text-[11px] font-semibold text-[#8C271E] dark:text-[#F08B82] truncate hover:underline cursor-pointer"
                      >
                        Ref : {refGroup?.baseTitle || playableRef.manualGroupTitle || playableRef.title}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Selected Reference Track Chip before submit */}
      {selectedRefGroup && (
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#8C271E]/12 text-[#8C271E] dark:text-[#F08B82] px-2.5 py-0.5 text-[11px] font-semibold">
            <Music2 size={10.5} />
            <span>Ref : {selectedRefGroup.baseTitle}</span>
            <button
              type="button"
              onClick={() => setSelectedRefTrackId(null)}
              className="hover:text-rose-500 cursor-pointer"
            >
              <X size={10.5} />
            </button>
          </span>
        </div>
      )}

      {/* Compact Reference Song Picker Dropdown */}
      {refPickerOpen && (
        <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-2.5 space-y-2 shadow-sm">
          <div className="relative">
            <Search
              size={12}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              autoFocus
              type="text"
              value={refSearch}
              onChange={(e) => setRefSearch(e.target.value)}
              placeholder="Choisir un son de référence dans ta bibliothèque…"
              className="w-full rounded-xl bg-slate-100 dark:bg-zinc-900 pl-7 pr-2.5 py-1.5 text-[11px] text-slate-900 dark:text-zinc-100 outline-none"
            />
          </div>
          <div className="max-h-36 overflow-y-auto space-y-0.5">
            {filteredRefGroups.length === 0 ? (
              <p className="py-3 text-center text-[11px] text-slate-400">Aucun son trouvé</p>
            ) : (
              filteredRefGroups.map((g) => (
                <button
                  key={g.groupKey}
                  type="button"
                  onClick={() => {
                    setSelectedRefTrackId(g.latestTrack.id);
                    setRefPickerOpen(false);
                    setRefSearch('');
                  }}
                  className="w-full flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-slate-700 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 transition cursor-pointer"
                >
                  <span className="truncate font-medium">{g.baseTitle}</span>
                  <span className="font-mono text-[10px] text-slate-400 shrink-0">
                    {g.latestVersionLabel}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Add Note Form */}
      <form onSubmit={handleSubmit} className="flex items-center gap-1.5 pt-0.5">
        <button
          type="button"
          onClick={() => setRefPickerOpen((v) => !v)}
          title="Lier un son de ta bibliothèque comme inspiration"
          className={`h-9 px-2.5 rounded-xl inline-flex items-center gap-1 text-[11px] font-semibold transition cursor-pointer shrink-0 ${
            refPickerOpen || selectedRefTrackId
              ? 'bg-[#8C271E]/14 text-[#8C271E] dark:text-[#F08B82] border border-[#8C271E]/30'
              : 'bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100'
          }`}
        >
          <Music2 size={12} />
          <span className="hidden sm:inline">Son ref</span>
        </button>

        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          className="flex-1 min-w-0 rounded-xl border border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-xs text-slate-900 dark:text-zinc-100 placeholder:text-slate-400 outline-none focus:border-slate-400 dark:focus:border-zinc-600"
        />

        {(draft.trim() || selectedRefTrackId) && (
          <button
            type="submit"
            className="rounded-xl bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25 px-3 py-2 text-xs font-semibold cursor-pointer shrink-0"
          >
            Ajouter
          </button>
        )}
      </form>
    </div>
  );
}
