import { useMemo, useState } from 'react';
import {
  Calendar,
  Check,
  ChevronDown,
  ChevronUp,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  Music2,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import type {
  MusicProject,
  MusicProjectPack,
  MusicTrack,
  ProjectPackColor,
} from '../../types';
import { useApp } from '../../context/AppContext';
import { useAudioPlayer } from '../../context/AudioPlayerContext';
import { AppleConfirmDialog } from '../ui/AppleConfirmDialog';
import { CheckCircle } from '../ui/CheckCircle';
import type { TrackGroup } from '../../lib/musicVersioning';
import {
  countLyricsFixTags,
  findLinkedLyricsForTrack,
  resolveEffectiveTrackCover,
  resolveTrackWorkflow,
} from '../../lib/trackCover';
import { TRACK_STATUS_META } from '../../utils/theme';
import { uid } from '../../utils/dates';

interface ProjectSprintViewProps {
  project: MusicProject;
  projectTracks: MusicTrack[];
  allGroups: TrackGroup[];
  onOpenTrackDetails?: (trackId: string) => void;
  onOpenContextMenu?: (
    e: React.MouseEvent,
    group: TrackGroup,
    trackId: string,
    initialSection?: 'versions' | 'projects' | null
  ) => void;
}

const PACK_COLORS: {
  id: ProjectPackColor;
  label: string;
  dot: string;
  badge: string;
  bar: string;
  ring: string;
}[] = [
  {
    id: 'crimson',
    label: 'Rouge',
    dot: 'bg-[#8C271E]',
    badge: 'bg-[#8C271E]/12 text-[#8C271E] dark:text-[#E56B5F]',
    bar: 'bg-[#8C271E]',
    ring: 'ring-[#8C271E]',
  },
  {
    id: 'emerald',
    label: 'Vert',
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
    bar: 'bg-emerald-500',
    ring: 'ring-emerald-500',
  },
  {
    id: 'amber',
    label: 'Ambre',
    dot: 'bg-amber-500',
    badge: 'bg-amber-500/12 text-amber-700 dark:text-amber-300',
    bar: 'bg-amber-500',
    ring: 'ring-amber-500',
  },
  {
    id: 'sky',
    label: 'Bleu',
    dot: 'bg-sky-500',
    badge: 'bg-sky-500/12 text-sky-700 dark:text-sky-300',
    bar: 'bg-sky-500',
    ring: 'ring-sky-500',
  },
  {
    id: 'violet',
    label: 'Violet',
    dot: 'bg-violet-500',
    badge: 'bg-violet-500/12 text-violet-700 dark:text-violet-300',
    bar: 'bg-violet-500',
    ring: 'ring-violet-500',
  },
  {
    id: 'zinc',
    label: 'Neutre',
    dot: 'bg-slate-400 dark:bg-zinc-500',
    badge: 'bg-slate-200/70 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300',
    bar: 'bg-slate-500 dark:bg-zinc-400',
    ring: 'ring-slate-400',
  },
];

const STARTER_PACK_IDEAS = [
  'Session studio',
  'À enregistrer',
  'À retravailler',
  'Face A',
  'Face B',
  'Ambiance chill',
  'Bangers',
  'Prêts mix',
];

function getPackColorMeta(color?: ProjectPackColor) {
  return PACK_COLORS.find((c) => c.id === color) || PACK_COLORS[0];
}

function fmtShortDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export function ProjectSprintView({
  project,
  projectTracks,
  allGroups,
  onOpenTrackDetails,
  onOpenContextMenu,
}: ProjectSprintViewProps) {
  const { state, updateMusicProject, notify } = useApp();
  const player = useAudioPlayer();

  // Transparently read `project.packs`, or fall back to legacy `project.sprints` so older projects lose zero data!
  const packs = useMemo<MusicProjectPack[]>(() => {
    if (Array.isArray(project.packs)) return project.packs;
    const legacy = [...(project.sprints || []), ...(project.recSprints || [])];
    return legacy.map((s) => ({
      id: s.id,
      title: s.title,
      color: s.phase === 'rec' ? 'emerald' : 'crimson',
      trackIds: s.trackIds,
      doneTrackIds: s.completedAt ? [...s.trackIds] : [],
      targetDate: s.targetDate,
      createdAt: s.createdAt,
    }));
  }, [project.packs, project.sprints, project.recSprints]);

  const byId = useMemo(() => new Map(projectTracks.map((t) => [t.id, t])), [projectTracks]);
  const validTrackIdSet = useMemo(() => new Set(projectTracks.map((t) => t.id)), [projectTracks]);

  const savePacks = (nextPacks: MusicProjectPack[]) => {
    updateMusicProject(project.id, { packs: nextPacks });
  };

  // Create Pack form state
  const [creatingPack, setCreatingPack] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newColor, setNewColor] = useState<ProjectPackColor>('crimson');
  const [newTargetDate, setNewTargetDate] = useState('');
  const [newSelectedIds, setNewSelectedIds] = useState<string[]>([]);

  // Per-pack inline edit / add tracks / collapse / delete confirm
  const [editingPackId, setEditingPackId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editColor, setEditColor] = useState<ProjectPackColor>('crimson');
  const [editTargetDate, setEditTargetDate] = useState('');
  const [pickingTracksForPackId, setPickingTracksForPackId] = useState<string | null>(null);
  const [collapsedPackIds, setCollapsedPackIds] = useState<Record<string, boolean>>({});
  const [deleteConfirmPack, setDeleteConfirmPack] = useState<MusicProjectPack | null>(null);
  const [quickAssignTrackId, setQuickAssignTrackId] = useState<string | null>(null);

  const packCountByTrackId = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of packs) {
      for (const id of p.trackIds) {
        if (validTrackIdSet.has(id)) {
          map.set(id, (map.get(id) || 0) + 1);
        }
      }
    }
    return map;
  }, [packs, validTrackIdSet]);

  const unassignedTracks = useMemo(
    () => projectTracks.filter((t) => !packCountByTrackId.has(t.id)),
    [projectTracks, packCountByTrackId]
  );

  const getTrackMeta = (trk: MusicTrack) => {
    const grp = allGroups.find((g) => g.allTrackIds.includes(trk.id));
    const siblings = grp
      ? [...grp.versions.map((v) => v.track), ...grp.prodTracks.map((p) => p.track)]
      : undefined;
    const workflow = resolveTrackWorkflow(trk, siblings);
    const lyrics = findLinkedLyricsForTrack(trk, state.lyricsDocs, grp?.allTrackIds, siblings);
    const fixCount = lyrics ? countLyricsFixTags(lyrics.content) : 0;
    const effCover = resolveEffectiveTrackCover(trk, state.musicProjects, grp?.groupKey, siblings);
    const thumb = effCover.coverDataUrl || effCover.cloudCoverUrl || null;
    const versionEntry = grp?.versions.find((v) => v.track.id === trk.id);
    return {
      grp,
      workflow,
      fixCount,
      thumb,
      displayTitle: grp?.baseTitle || trk.manualGroupTitle || trk.title,
      versionLabel:
        versionEntry && versionEntry.versionLabel !== 'Original' ? versionEntry.versionLabel : '',
    };
  };

  const handleCreatePack = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = newTitle.trim();
    if (!cleanTitle) return;
    const nextPack: MusicProjectPack = {
      id: uid('pack'),
      title: cleanTitle,
      description: newDescription.trim() || undefined,
      color: newColor,
      trackIds: newSelectedIds.filter((id) => validTrackIdSet.has(id)),
      doneTrackIds: [],
      targetDate: newTargetDate || undefined,
      createdAt: new Date().toISOString(),
    };
    savePacks([...packs, nextPack]);
    setNewTitle('');
    setNewDescription('');
    setNewColor('crimson');
    setNewTargetDate('');
    setNewSelectedIds([]);
    setCreatingPack(false);
    notify(`Pack « ${cleanTitle} » créé ✓`);
  };

  const handleStartEditPack = (pack: MusicProjectPack) => {
    setEditingPackId(pack.id);
    setEditTitle(pack.title);
    setEditDescription(pack.description || '');
    setEditColor(pack.color || 'crimson');
    setEditTargetDate(pack.targetDate || '');
  };

  const handleSaveEditPack = (packId: string) => {
    const cleanTitle = editTitle.trim();
    if (!cleanTitle) return;
    savePacks(
      packs.map((p) =>
        p.id === packId
          ? {
              ...p,
              title: cleanTitle,
              description: editDescription.trim() || undefined,
              color: editColor,
              targetDate: editTargetDate || undefined,
            }
          : p
      )
    );
    setEditingPackId(null);
    notify(`Pack « ${cleanTitle} » mis à jour ✓`);
  };

  const handleMovePack = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= packs.length) return;
    const next = [...packs];
    const [item] = next.splice(idx, 1);
    next.splice(target, 0, item);
    savePacks(next);
  };

  const handleToggleTrackInPack = (packId: string, trackId: string) => {
    savePacks(
      packs.map((p) => {
        if (p.id !== packId) return p;
        const exists = p.trackIds.includes(trackId);
        return {
          ...p,
          trackIds: exists
            ? p.trackIds.filter((id) => id !== trackId)
            : [...p.trackIds, trackId],
          doneTrackIds: exists
            ? (p.doneTrackIds || []).filter((id) => id !== trackId)
            : p.doneTrackIds || [],
        };
      })
    );
  };

  const handleToggleTrackDoneInPack = (packId: string, trackId: string) => {
    savePacks(
      packs.map((p) => {
        if (p.id !== packId) return p;
        const doneList = p.doneTrackIds || [];
        const isDone = doneList.includes(trackId);
        return {
          ...p,
          doneTrackIds: isDone
            ? doneList.filter((id) => id !== trackId)
            : [...doneList, trackId],
        };
      })
    );
  };

  const handleDeletePack = (pack: MusicProjectPack) => {
    savePacks(packs.filter((p) => p.id !== pack.id));
    setDeleteConfirmPack(null);
    notify(`Pack « ${pack.title} » supprimé (les sons restent dans le projet)`);
  };

  const handlePlayPack = (packTracks: MusicTrack[]) => {
    if (packTracks.length === 0) return;
    const isPlayingThisPack = Boolean(
      player.currentTrack && packTracks.some((t) => t.id === player.currentTrack?.id)
    );
    if (isPlayingThisPack) {
      player.togglePlay();
    } else {
      void player.playTrack(packTracks[0], 0, packTracks);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-0.5">
          <h2 className="text-sm font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
            <FolderOpen size={15} className="text-[#8C271E]" />
            <span>Packs & dossiers libres</span>
            <span className="font-mono text-[11px] font-medium text-slate-400">
              ({packs.length})
            </span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-zinc-400">
            Organise les sons de ton projet à ta façon : sessions, ambiances, chapitres, lots de mix ou idées.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setCreatingPack((v) => !v)}
          className="inline-flex items-center justify-center gap-1.5 rounded-full bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25 hover:opacity-90 px-4 py-2 text-xs font-semibold transition cursor-pointer shrink-0"
        >
          {creatingPack ? <X size={13} /> : <FolderPlus size={13} />}
          <span>{creatingPack ? 'Fermer' : 'Nouveau pack'}</span>
        </button>
      </div>

      {/* Inline Create Pack Builder */}
      {creatingPack && (
        <form
          onSubmit={handleCreatePack}
          className="rounded-3xl border border-slate-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/55 p-4 sm:p-5 space-y-4"
        >
          <div className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Nom du pack
            </label>
            <input
              autoFocus
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Ex. Session studio #1, Face A, À retravailler, Sons chill…"
              className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3.5 py-2.5 text-sm font-medium outline-none focus:border-[#8C271E]"
            />
            {/* Optional 1-click starter ideas */}
            <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
              {STARTER_PACK_IDEAS.map((idea) => (
                <button
                  key={idea}
                  type="button"
                  onClick={() => setNewTitle(idea)}
                  className="rounded-full border border-slate-200/80 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900 px-2.5 py-0.5 text-[10px] font-medium text-slate-500 dark:text-zinc-400 hover:border-[#8C271E]/50 hover:text-slate-900 dark:hover:text-zinc-100 transition cursor-pointer"
                >
                  {idea}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Note / objectif (optionnel)
              </label>
              <input
                type="text"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Ex. Enregistrer les refrains ce week-end…"
                className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-xs outline-none focus:border-slate-400 dark:focus:border-zinc-600"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Couleur
                </label>
                <div className="flex items-center gap-1.5 h-9 px-2 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
                  {PACK_COLORS.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      title={c.label}
                      onClick={() => setNewColor(c.id)}
                      className={`h-5 w-5 rounded-full ${c.dot} transition cursor-pointer ${
                        newColor === c.id
                          ? 'ring-2 ring-offset-2 ring-offset-white dark:ring-offset-zinc-950 ' + c.ring
                          : 'opacity-55 hover:opacity-100'
                      }`}
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Date cible (opt.)
                </label>
                <input
                  type="date"
                  value={newTargetDate}
                  onChange={(e) => setNewTargetDate(e.target.value)}
                  className="w-full h-9 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2.5 text-xs outline-none"
                />
              </div>
            </div>
          </div>

          {/* Track Picker */}
          {projectTracks.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Choisir des sons ({newSelectedIds.length} sélectionné{newSelectedIds.length > 1 ? 's' : ''})
                </label>
                <div className="flex items-center gap-2 text-[11px]">
                  {unassignedTracks.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setNewSelectedIds(unassignedTracks.map((t) => t.id))}
                      className="text-slate-500 hover:text-slate-900 dark:hover:text-zinc-100 cursor-pointer"
                    >
                      Non rangés ({unassignedTracks.length})
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      setNewSelectedIds(
                        newSelectedIds.length === projectTracks.length
                          ? []
                          : projectTracks.map((t) => t.id)
                      )
                    }
                    className="text-[#8C271E] dark:text-[#E56B5F] font-medium cursor-pointer"
                  >
                    {newSelectedIds.length === projectTracks.length ? 'Tout décocher' : 'Tout choisir'}
                  </button>
                </div>
              </div>

              <div className="max-h-48 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-1.5 pr-0.5">
                {projectTracks.map((trk) => {
                  const selected = newSelectedIds.includes(trk.id);
                  const meta = getTrackMeta(trk);
                  const alreadyInCount = packCountByTrackId.get(trk.id) || 0;
                  return (
                    <button
                      key={trk.id}
                      type="button"
                      onClick={() =>
                        setNewSelectedIds((prev) =>
                          prev.includes(trk.id)
                            ? prev.filter((id) => id !== trk.id)
                            : [...prev, trk.id]
                        )
                      }
                      className={`flex items-center justify-between gap-2 rounded-xl border px-2.5 py-2 text-left text-xs transition cursor-pointer ${
                        selected
                          ? 'border-[#8C271E] bg-[#8C271E]/8 text-slate-900 dark:text-zinc-50 font-semibold'
                          : 'border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-slate-700 dark:text-zinc-300 hover:border-slate-400 dark:hover:border-zinc-600'
                      }`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span
                          className={`h-4 w-4 rounded-md border flex items-center justify-center shrink-0 ${
                            selected
                              ? 'bg-[#8C271E] border-[#8C271E] text-white'
                              : 'border-slate-300 dark:border-zinc-700'
                          }`}
                        >
                          {selected && <Check size={10} />}
                        </span>
                        <span className="truncate">{meta.displayTitle}</span>
                      </span>
                      {alreadyInCount > 0 && (
                        <span className="text-[9px] font-mono text-slate-400 shrink-0">
                          {alreadyInCount} pack{alreadyInCount > 1 ? 's' : ''}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setCreatingPack(false)}
              className="rounded-xl px-3.5 py-2 text-xs font-medium text-slate-500 hover:text-slate-800 dark:hover:text-zinc-200 cursor-pointer"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={!newTitle.trim()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#8C271E] text-white px-4 py-2 text-xs font-semibold hover:opacity-90 disabled:opacity-40 transition cursor-pointer"
            >
              <Check size={13} />
              Créer le pack
            </button>
          </div>
        </form>
      )}

      {/* Empty State */}
      {packs.length === 0 && !creatingPack ? (
        <div className="rounded-3xl border border-dashed border-slate-200 dark:border-zinc-800 bg-slate-50/40 dark:bg-zinc-900/25 px-6 py-10 text-center space-y-3">
          <div className="mx-auto h-11 w-11 rounded-2xl bg-[#8C271E]/10 text-[#8C271E] flex items-center justify-center">
            <FolderOpen size={20} />
          </div>
          <div className="space-y-1 max-w-md mx-auto">
            <p className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
              Aucun pack dans « {project.title} »
            </p>
            <p className="text-xs text-slate-500 dark:text-zinc-400 leading-relaxed">
              Crée des packs comme des dossiers libres pour regrouper tes morceaux par session studio, ambiance, étape de travail, face A/B ou objectif.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreatingPack(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25 px-4 py-2 text-xs font-semibold hover:opacity-90 transition cursor-pointer"
          >
            <Plus size={13} />
            Créer mon premier pack
          </button>
        </div>
      ) : (
        /* Pack Cards List */
        <div className="space-y-3">
          {packs.map((pack, packIdx) => {
            const colorMeta = getPackColorMeta(pack.color);
            const packTracks = pack.trackIds
              .map((id) => byId.get(id))
              .filter((t): t is MusicTrack => Boolean(t));
            const doneSet = new Set(
              (pack.doneTrackIds || []).filter((id) => packTracks.some((t) => t.id === id))
            );
            const doneCount = doneSet.size;
            const pct =
              packTracks.length > 0 ? Math.round((doneCount / packTracks.length) * 100) : 0;
            const isCollapsed = Boolean(collapsedPackIds[pack.id]);
            const isEditing = editingPackId === pack.id;
            const isPicking = pickingTracksForPackId === pack.id;
            const isPackPlaying = Boolean(
              player.isPlaying &&
                player.currentTrack &&
                packTracks.some((t) => t.id === player.currentTrack?.id)
            );

            return (
              <div
                key={pack.id}
                className="rounded-3xl border border-slate-200/80 dark:border-zinc-800/90 bg-white dark:bg-[#131317] overflow-hidden shadow-2xs"
              >
                {/* Pack Header */}
                <div className="px-4 py-3.5 flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-100 dark:border-zinc-800/80">
                  {isEditing ? (
                    <div className="w-full space-y-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          autoFocus
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEditPack(pack.id);
                            if (e.key === 'Escape') setEditingPackId(null);
                          }}
                          className="flex-1 min-w-[160px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3 py-1.5 text-sm font-semibold outline-none"
                        />
                        <input
                          type="date"
                          value={editTargetDate}
                          onChange={(e) => setEditTargetDate(e.target.value)}
                          className="rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-2.5 py-1.5 text-xs outline-none"
                        />
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <input
                          type="text"
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          placeholder="Note / objectif (optionnel)…"
                          className="flex-1 min-w-[180px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3 py-1.5 text-xs outline-none"
                        />
                        <div className="flex items-center gap-1.5">
                          {PACK_COLORS.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => setEditColor(c.id)}
                              className={`h-4 w-4 rounded-full ${c.dot} cursor-pointer ${
                                editColor === c.id ? 'ring-2 ring-offset-1 ' + c.ring : 'opacity-50'
                              }`}
                            />
                          ))}
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setEditingPackId(null)}
                            className="rounded-lg px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer"
                          >
                            Annuler
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSaveEditPack(pack.id)}
                            className="rounded-lg bg-[#8C271E] text-white px-3 py-1 text-xs font-semibold cursor-pointer"
                          >
                            Enregistrer
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() =>
                            setCollapsedPackIds((prev) => ({
                              ...prev,
                              [pack.id]: !prev[pack.id],
                            }))
                          }
                          className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 transition cursor-pointer shrink-0"
                          title={isCollapsed ? 'Déplier le pack' : 'Replier le pack'}
                        >
                          {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                        </button>

                        <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${colorMeta.dot}`} />

                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-50 truncate">
                              {pack.title}
                            </h3>
                            <span
                              className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${colorMeta.badge}`}
                            >
                              {packTracks.length} son{packTracks.length > 1 ? 's' : ''}
                            </span>
                            {doneCount > 0 && (
                              <span className="rounded-full bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 font-mono text-[10px] font-semibold">
                                {doneCount}/{packTracks.length} ✓
                              </span>
                            )}
                            {pack.targetDate && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-zinc-800 px-2 py-0.5 font-mono text-[10px] text-slate-500 dark:text-zinc-400">
                                <Calendar size={9} />
                                {fmtShortDate(pack.targetDate)}
                              </span>
                            )}
                          </div>
                          {pack.description && (
                            <p className="text-[11px] text-slate-500 dark:text-zinc-400 truncate mt-0.5">
                              {pack.description}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {packTracks.length > 0 && (
                          <button
                            type="button"
                            onClick={() => handlePlayPack(packTracks)}
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer ${
                              isPackPlaying
                                ? 'bg-[#8C271E] text-white'
                                : 'bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 hover:bg-slate-200 dark:hover:bg-zinc-700'
                            }`}
                          >
                            {isPackPlaying ? (
                              <Pause size={10} fill="currentColor" />
                            ) : (
                              <Play size={10} fill="currentColor" />
                            )}
                            <span>{isPackPlaying ? 'Pause' : 'Lire'}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setPickingTracksForPackId((cur) => (cur === pack.id ? null : pack.id))
                          }
                          title="Ajouter ou retirer des sons dans ce pack"
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer ${
                            isPicking
                              ? 'bg-slate-900 dark:bg-white text-white dark:text-zinc-950'
                              : 'border border-slate-200 dark:border-zinc-800 text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800'
                          }`}
                        >
                          <Plus size={11} />
                          <span>Sons</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleStartEditPack(pack)}
                          title="Modifier le pack"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 dark:hover:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-800 transition cursor-pointer"
                        >
                          <Pencil size={12} />
                        </button>
                        {packs.length > 1 && (
                          <>
                            <button
                              type="button"
                              disabled={packIdx === 0}
                              onClick={() => handleMovePack(packIdx, -1)}
                              title="Monter ce pack"
                              className="p-1 rounded-lg text-slate-400 hover:text-slate-800 dark:hover:text-zinc-100 disabled:opacity-25 cursor-pointer"
                            >
                              <ChevronUp size={13} />
                            </button>
                            <button
                              type="button"
                              disabled={packIdx === packs.length - 1}
                              onClick={() => handleMovePack(packIdx, 1)}
                              title="Descendre ce pack"
                              className="p-1 rounded-lg text-slate-400 hover:text-slate-800 dark:hover:text-zinc-100 disabled:opacity-25 cursor-pointer"
                            >
                              <ChevronDown size={13} />
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmPack(pack)}
                          title="Supprimer ce pack"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition cursor-pointer"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {/* Optional subtle progress bar (only appears if user checked at least 1 track) */}
                {doneCount > 0 && !isCollapsed && (
                  <div className="h-1 w-full bg-slate-100 dark:bg-zinc-800/80">
                    <div
                      style={{ width: `${pct}%` }}
                      className={`h-full ${colorMeta.bar} transition-all duration-300`}
                    />
                  </div>
                )}

                {/* Inline Track Picker for this Pack */}
                {isPicking && !isCollapsed && (
                  <div className="px-4 py-3 bg-slate-50/80 dark:bg-zinc-900/60 border-b border-slate-100 dark:border-zinc-800/80 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        Coche les morceaux à ranger dans « {pack.title} »
                      </span>
                      <button
                        type="button"
                        onClick={() => setPickingTracksForPackId(null)}
                        className="text-[11px] font-semibold text-[#8C271E] dark:text-[#E56B5F] cursor-pointer"
                      >
                        Terminé
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
                      {projectTracks.map((trk) => {
                        const inPack = pack.trackIds.includes(trk.id);
                        const meta = getTrackMeta(trk);
                        return (
                          <button
                            key={trk.id}
                            type="button"
                            onClick={() => handleToggleTrackInPack(pack.id, trk.id)}
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium border transition cursor-pointer ${
                              inPack
                                ? 'bg-[#8C271E] text-white border-[#8C271E]'
                                : 'bg-white dark:bg-zinc-950 border-slate-200 dark:border-zinc-800 text-slate-600 dark:text-zinc-300 hover:border-slate-400'
                            }`}
                          >
                            {inPack ? <Check size={10} /> : <Plus size={10} />}
                            <span className="truncate max-w-[180px]">{meta.displayTitle}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Pack Tracks List */}
                {!isCollapsed && (
                  <div className="divide-y divide-slate-100 dark:divide-zinc-800/60">
                    {packTracks.length === 0 ? (
                      <div className="px-4 py-5 text-center text-xs text-slate-400">
                        Ce pack est vide — clique sur <strong>+ Sons</strong> pour y ajouter des morceaux du projet.
                      </div>
                    ) : (
                      packTracks.map((trk) => {
                        const meta = getTrackMeta(trk);
                        const stMeta = TRACK_STATUS_META[meta.workflow.status];
                        const isCur = player.currentTrack?.id === trk.id;
                        const isPl = isCur && player.isPlaying;
                        const isChecked = doneSet.has(trk.id);

                        return (
                          <div
                            key={trk.id}
                            onContextMenu={(e) => {
                              if (meta.grp && onOpenContextMenu) {
                                onOpenContextMenu(e, meta.grp, trk.id);
                              }
                            }}
                            className="px-3.5 py-2.5 flex items-center justify-between gap-2.5 hover:bg-slate-50/80 dark:hover:bg-zinc-900/50 transition group"
                          >
                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                              {/* Optional check toggle */}
                              <CheckCircle
                                checked={isChecked}
                                onToggle={() => handleToggleTrackDoneInPack(pack.id, trk.id)}
                                accent="violet"
                              />

                              {/* Cover / Play */}
                              <button
                                type="button"
                                onClick={() =>
                                  isCur
                                    ? player.togglePlay()
                                    : void player.playTrack(trk, 0, packTracks)
                                }
                                className="relative h-9 w-9 rounded-xl overflow-hidden bg-slate-100 dark:bg-zinc-800 shrink-0 flex items-center justify-center cursor-pointer"
                              >
                                {meta.thumb ? (
                                  <img
                                    src={meta.thumb}
                                    alt={meta.displayTitle}
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <Music2 size={14} className="text-slate-400" />
                                )}
                                <span
                                  className={`absolute inset-0 flex items-center justify-center bg-black/40 text-white transition ${
                                    isCur ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                                  }`}
                                >
                                  {isPl ? (
                                    <Pause size={13} fill="currentColor" />
                                  ) : (
                                    <Play size={13} fill="currentColor" className="ml-0.5" />
                                  )}
                                </span>
                              </button>

                              {/* Title & meta */}
                              <button
                                type="button"
                                onClick={() => onOpenTrackDetails?.(trk.id)}
                                className="min-w-0 flex-1 text-left cursor-pointer"
                              >
                                <p
                                  className={`text-xs font-semibold truncate ${
                                    isChecked
                                      ? 'line-through text-slate-400 dark:text-zinc-500'
                                      : isCur
                                      ? 'text-[#8C271E] dark:text-[#E56B5F]'
                                      : 'text-slate-900 dark:text-zinc-100'
                                  }`}
                                >
                                  {meta.displayTitle}
                                </p>
                                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                  {meta.versionLabel && (
                                    <span className="font-mono text-[10px] text-slate-400">
                                      {meta.versionLabel}
                                    </span>
                                  )}
                                  {stMeta && (
                                    <span className="inline-flex items-center gap-1 text-[10px] text-slate-400">
                                      <span className={`h-1.5 w-1.5 rounded-full ${stMeta.dot}`} />
                                      {stMeta.label}
                                    </span>
                                  )}
                                  {meta.fixCount > 0 && (
                                    <span className="rounded-full bg-rose-500/12 text-rose-600 dark:text-rose-400 px-1.5 py-0.2 font-mono text-[9px] font-bold">
                                      FIX ×{meta.fixCount}
                                    </span>
                                  )}
                                </div>
                              </button>
                            </div>

                            <div className="flex items-center gap-1 shrink-0">
                              {meta.grp && onOpenContextMenu && (
                                <button
                                  type="button"
                                  onClick={(e) => onOpenContextMenu(e, meta.grp!, trk.id)}
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 opacity-60 sm:opacity-0 group-hover:opacity-100 transition cursor-pointer"
                                  title="Options du morceau"
                                >
                                  <MoreHorizontal size={13} />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleToggleTrackInPack(pack.id, trk.id)}
                                title="Retirer de ce pack"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 opacity-60 sm:opacity-0 group-hover:opacity-100 transition cursor-pointer"
                              >
                                <X size={12} />
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Unassigned Project Tracks (quick sort into any pack!) */}
      {packs.length > 0 && unassignedTracks.length > 0 && (
        <section className="rounded-3xl border border-slate-200/70 dark:border-zinc-800/70 bg-slate-50/50 dark:bg-zinc-900/30 p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Hors packs ({unassignedTracks.length})
            </h3>
          </div>

          <div className="space-y-1.5">
            {unassignedTracks.map((trk) => {
              const meta = getTrackMeta(trk);
              const isOpen = quickAssignTrackId === trk.id;
              return (
                <div
                  key={trk.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white dark:bg-[#131317] border border-slate-200/70 dark:border-zinc-800/80 px-3 py-2"
                >
                  <button
                    type="button"
                    onClick={() => onOpenTrackDetails?.(trk.id)}
                    className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
                  >
                    <Music2 size={12} className="text-slate-400 shrink-0" />
                    <span className="text-xs font-medium text-slate-800 dark:text-zinc-200 truncate">
                      {meta.displayTitle}
                    </span>
                  </button>

                  {isOpen ? (
                    <div className="flex items-center gap-1 flex-wrap">
                      {packs.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            handleToggleTrackInPack(p.id, trk.id);
                            setQuickAssignTrackId(null);
                            notify(`« ${meta.displayTitle} » ajouté à « ${p.title} » ✓`);
                          }}
                          className="inline-flex items-center gap-1 rounded-full border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 hover:border-[#8C271E] px-2 py-0.5 text-[10px] font-semibold text-slate-700 dark:text-zinc-200 cursor-pointer"
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${getPackColorMeta(p.color).dot}`} />
                          {p.title}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setQuickAssignTrackId(null)}
                        className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setQuickAssignTrackId(trk.id)}
                      className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 px-2.5 py-1 text-[10px] font-semibold text-slate-600 dark:text-zinc-300 transition cursor-pointer shrink-0"
                    >
                      <Plus size={10} />
                      Ranger dans un pack
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Delete Pack Confirm Dialog */}
      <AppleConfirmDialog
        open={Boolean(deleteConfirmPack)}
        title={`Supprimer le pack « ${deleteConfirmPack?.title || ''} » ?`}
        description="Les morceaux ne seront pas supprimés du projet — ils reviendront simplement hors packs."
        confirmLabel="Supprimer le pack"
        destructive
        onCancel={() => setDeleteConfirmPack(null)}
        onConfirm={() => {
          if (deleteConfirmPack) handleDeletePack(deleteConfirmPack);
        }}
      />
    </div>
  );
}
