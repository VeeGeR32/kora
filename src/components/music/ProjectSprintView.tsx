import { useMemo, useState } from 'react';
import {
  ArrowUp,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Flame,
  Pause,
  Play,
  Plus,
  Trash2,
} from 'lucide-react';
import type { MusicProject, MusicProjectSprint, MusicTrack } from '../../types';
import { useApp } from '../../context/AppContext';
import { useAudioPlayer } from '../../context/AudioPlayerContext';
import type { TrackGroup } from '../../lib/musicVersioning';
import {
  countLyricsFixTags,
  findLinkedLyricsForTrack,
  resolveTrackWorkflow,
} from '../../lib/trackCover';
import {
  isReadyForHarmonization,
  TRACK_MOOD_META,
  TRACK_PIPELINE_ORDER,
  TRACK_STATUS_META,
} from '../../utils/theme';
import { uid } from '../../utils/dates';

interface ProjectSprintViewProps {
  project: MusicProject;
  projectTracks: MusicTrack[];
  allGroups: TrackGroup[];
  onOpenTrackDetails?: (trackId: string) => void;
}

const MAX_SPRINT_TRACKS = 3;

function fmtTargetDate(iso?: string): string {
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
}: ProjectSprintViewProps) {
  const { state, updateMusicProject, setTrackGroupWorkflow, notify } = useApp();
  const player = useAudioPlayer();

  const sprints = project.sprints || [];
  const pendingSprints = useMemo(
    () => sprints.filter((s) => !s.completedAt),
    [sprints]
  );
  const activeSprint = pendingSprints[0] || null;
  const upcomingSprints = useMemo(() => pendingSprints.slice(1), [pendingSprints]);
  const completedSprints = useMemo(
    () => sprints.filter((s) => Boolean(s.completedAt)),
    [sprints]
  );

  const [creating, setCreating] = useState(false);
  const [sprintTitle, setSprintTitle] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const byId = useMemo(
    () => new Map(projectTracks.map((t) => [t.id, t])),
    [projectTracks]
  );

  // Track -> Sprint title map for pending sprints so composer highlights unassigned songs first!
  const assignedSprintByTrackId = useMemo(() => {
    const map = new Map<string, string>();
    for (const spr of pendingSprints) {
      for (const tid of spr.trackIds) {
        if (!map.has(tid)) map.set(tid, spr.title);
      }
    }
    return map;
  }, [pendingSprints]);

  const getTrackContext = (trk: MusicTrack) => {
    const grp = allGroups.find((g) => g.allTrackIds.includes(trk.id));
    const siblings = grp?.versions.map((v) => v.track);
    const workflow = resolveTrackWorkflow(trk, siblings);
    const lyrics = findLinkedLyricsForTrack(trk, state.lyricsDocs, grp?.allTrackIds, siblings);
    const fixCount = lyrics ? countLyricsFixTags(lyrics.content) : 0;
    const allIds = grp && grp.allTrackIds.length > 0 ? grp.allTrackIds : [trk.id];
    const thumb =
      project.coverDataUrl ||
      trk.coverDataUrl ||
      trk.cloudCoverUrl ||
      siblings?.find((s) => Boolean(s.coverDataUrl))?.coverDataUrl ||
      null;
    return { grp, workflow, fixCount, allIds, thumb };
  };

  const activeSprintTracks = useMemo(() => {
    if (!activeSprint) return [];
    return activeSprint.trackIds
      .map((id) => byId.get(id))
      .filter((t): t is MusicTrack => Boolean(t));
  }, [activeSprint, byId]);

  const readyCount = useMemo(() => {
    return activeSprintTracks.filter((trk) => {
      const { workflow } = getTrackContext(trk);
      return isReadyForHarmonization(workflow.status);
    }).length;
  }, [activeSprintTracks, allGroups, state.lyricsDocs]);

  const canValidateSprint =
    activeSprint !== null &&
    activeSprintTracks.length > 0 &&
    readyCount === activeSprintTracks.length;

  const selectedMoods = useMemo(() => {
    return selectedIds
      .map((id) => {
        const trk = byId.get(id);
        if (!trk) return null;
        return getTrackContext(trk).workflow.mood;
      })
      .filter(Boolean);
  }, [selectedIds, byId, allGroups]);

  const sameMoodWarning =
    selectedIds.length === MAX_SPRINT_TRACKS &&
    selectedMoods.length === MAX_SPRINT_TRACKS &&
    new Set(selectedMoods).size === 1;

  const toggleSelectForSprint = (trackId: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(trackId)) return prev.filter((x) => x !== trackId);
      if (prev.length >= MAX_SPRINT_TRACKS) {
        notify(`Maximum ${MAX_SPRINT_TRACKS} titres par sprint pour éviter la dispersion`);
        return prev;
      }
      return [...prev, trackId];
    });
  };

  // Candidate tracks: prioritize unassigned + not-yet-v3 tracks!
  const sprintCandidates = useMemo(() => {
    return [...projectTracks].sort((a, b) => {
      const aAssigned = assignedSprintByTrackId.has(a.id) ? 1 : 0;
      const bAssigned = assignedSprintByTrackId.has(b.id) ? 1 : 0;
      if (aAssigned !== bAssigned) return aAssigned - bAssigned;
      const sa = getTrackContext(a).workflow.status;
      const sb = getTrackContext(b).workflow.status;
      const ra = isReadyForHarmonization(sa) ? 1 : 0;
      const rb = isReadyForHarmonization(sb) ? 1 : 0;
      return ra - rb;
    });
  }, [projectTracks, allGroups, assignedSprintByTrackId]);

  const openComposer = () => {
    const unassigned = sprintCandidates.filter((t) => !assignedSprintByTrackId.has(t.id));
    const seedList = unassigned.length > 0 ? unassigned : sprintCandidates;
    setSelectedIds(seedList.slice(0, Math.min(MAX_SPRINT_TRACKS, seedList.length)).map((t) => t.id));
    setSprintTitle('');
    setTargetDate('');
    setCreating(true);
  };

  const handleCreateSprint = () => {
    if (selectedIds.length === 0) {
      notify('Sélectionne au moins 1 titre (max 3)');
      return;
    }
    const nextNum = sprints.length + 1;
    const newSprint: MusicProjectSprint = {
      id: uid('spr'),
      title: sprintTitle.trim() || `Sprint #${nextNum}`,
      trackIds: selectedIds.slice(0, MAX_SPRINT_TRACKS),
      targetDate: targetDate || undefined,
      createdAt: new Date().toISOString(),
    };
    updateMusicProject(project.id, { sprints: [...sprints, newSprint] });
    setCreating(false);
    setSprintTitle('');
    setTargetDate('');
    setSelectedIds([]);
    notify(
      activeSprint
        ? `${newSprint.title} planifié à la suite ✓`
        : `${newSprint.title} lancé (${newSprint.trackIds.length} titre${newSprint.trackIds.length > 1 ? 's' : ''}) ✓`
    );
  };

  const handleValidateActiveSprint = () => {
    if (!activeSprint || !canValidateSprint) return;
    const nowIso = new Date().toISOString();
    const nextSprints = sprints.map((s) =>
      s.id === activeSprint.id ? { ...s, completedAt: nowIso } : s
    );
    updateMusicProject(project.id, { sprints: nextSprints });
    notify(
      upcomingSprints.length > 0
        ? `${activeSprint.title} validé ✓ · ${upcomingSprints[0].title} devient actif`
        : `${activeSprint.title} validé ✓`
    );
  };

  const handlePromoteSprintToActive = (sprintId: string) => {
    const target = sprints.find((s) => s.id === sprintId && !s.completedAt);
    if (!target) return;
    const rest = sprints.filter((s) => s.id !== sprintId);
    const completed = rest.filter((s) => Boolean(s.completedAt));
    const otherPending = rest.filter((s) => !s.completedAt);
    updateMusicProject(project.id, { sprints: [target, ...otherPending, ...completed] });
    notify(`${target.title} passé en sprint actif ✓`);
  };

  const handleDeleteSprint = (sprintId: string) => {
    updateMusicProject(project.id, {
      sprints: sprints.filter((s) => s.id !== sprintId),
    });
    notify('Sprint supprimé');
  };

  const handleRemoveTrackFromSprint = (sprintId: string, trackId: string) => {
    const target = sprints.find((s) => s.id === sprintId);
    if (!target) return;
    const nextIds = target.trackIds.filter((id) => id !== trackId);
    if (nextIds.length === 0) {
      handleDeleteSprint(sprintId);
      return;
    }
    updateMusicProject(project.id, {
      sprints: sprints.map((s) => (s.id === sprintId ? { ...s, trackIds: nextIds } : s)),
    });
  };

  return (
    <div className="space-y-4">
      {/* ACTIVE SPRINT CARD */}
      {activeSprint ? (
        <div className="space-y-3">
          <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/45 p-4 space-y-3">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-2 py-0.5 text-[10px] font-semibold">
                    <Flame size={10} /> Sprint actif
                  </span>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100">
                    {activeSprint.title}
                  </h3>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Focus sur {activeSprintTracks.length}/{MAX_SPRINT_TRACKS} titre
                  {activeSprintTracks.length > 1 ? 's' : ''} · objectif :{' '}
                  <strong className="text-slate-600 dark:text-zinc-300">Pré-mix (v3)</strong>
                  {activeSprint.targetDate ? ` · échéance ${fmtTargetDate(activeSprint.targetDate)}` : ''}
                </p>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={!canValidateSprint}
                  onClick={handleValidateActiveSprint}
                  title={
                    canValidateSprint
                      ? 'Valider ce sprint'
                      : `Tous les titres doivent atteindre au moins Pré-mix (v3) (${readyCount}/${activeSprintTracks.length})`
                  }
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    canValidateSprint
                      ? 'bg-emerald-600 text-white hover:bg-emerald-700 cursor-pointer'
                      : 'bg-slate-200/80 dark:bg-zinc-800 text-slate-400 cursor-not-allowed'
                  }`}
                >
                  <CheckCircle2 size={13} />
                  <span>
                    Valider ({readyCount}/{activeSprintTracks.length})
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteSprint(activeSprint.id)}
                  title="Supprimer ce sprint"
                  className="p-1.5 rounded-full text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition cursor-pointer"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>

            {/* Sprint Progress Bar */}
            <div className="h-1.5 rounded-full bg-slate-200/80 dark:bg-zinc-800 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  canValidateSprint ? 'bg-emerald-500' : 'bg-slate-900 dark:bg-zinc-100'
                }`}
                style={{
                  width: `${
                    activeSprintTracks.length > 0
                      ? Math.round((readyCount / activeSprintTracks.length) * 100)
                      : 0
                  }%`,
                }}
              />
            </div>

            {/* Focused Tracklist (ONLY the 1-3 Active Sprint tracks!) */}
            <div className="space-y-2 pt-1">
              {activeSprintTracks.map((trk) => {
                const { workflow, fixCount, allIds, thumb } = getTrackContext(trk);
                const stepIdx = TRACK_PIPELINE_ORDER.indexOf(workflow.status);
                const statusMeta = TRACK_STATUS_META[workflow.status];
                const moodMeta = workflow.mood ? TRACK_MOOD_META[workflow.mood] : null;
                const ready = isReadyForHarmonization(workflow.status);
                const isCur = player.currentTrack?.id === trk.id;
                const playing = isCur && player.isPlaying;
                const openTodos = (trk.todos || []).filter((t) => !t.done).length;

                return (
                  <div
                    key={trk.id}
                    className={`rounded-2xl border p-3 transition space-y-2.5 ${
                      ready
                        ? 'border-emerald-500/35 bg-emerald-500/5 dark:bg-emerald-950/20'
                        : 'border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-[#121216]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2.5">
                      <button
                        type="button"
                        onClick={() =>
                          isCur
                            ? player.togglePlay()
                            : void player.playTrack(trk, 0, activeSprintTracks)
                        }
                        className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer"
                      >
                        <div className="relative h-10 w-10 rounded-xl overflow-hidden bg-slate-200 dark:bg-zinc-800 shrink-0 flex items-center justify-center">
                          {thumb ? (
                            <img src={thumb} alt={trk.title} className="h-full w-full object-cover" />
                          ) : null}
                          <span className="absolute inset-0 bg-black/35 text-white flex items-center justify-center">
                            {playing ? (
                              <Pause size={13} fill="currentColor" />
                            ) : (
                              <Play size={13} fill="currentColor" className="ml-0.5" />
                            )}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-semibold text-slate-900 dark:text-zinc-100 truncate">
                              {getTrackContext(trk).grp?.baseTitle || trk.manualGroupTitle || trk.title}
                            </p>
                            {ready && (
                              <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 flex-nowrap overflow-hidden whitespace-nowrap mt-0.5 min-w-0">
                            <span
                              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${statusMeta.badge}`}
                            >
                              {statusMeta.step}/5 · {statusMeta.shortLabel}
                            </span>
                            {moodMeta && (
                              <span
                                className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${moodMeta.badge}`}
                              >
                                {moodMeta.emoji}
                              </span>
                            )}
                            {fixCount > 0 && (
                              <span className="shrink-0 rounded-full bg-rose-500/12 text-rose-600 dark:text-rose-400 px-1.5 py-0.5 font-mono text-[10px] font-semibold">
                                [FIX] ×{fixCount}
                              </span>
                            )}
                            {openTodos > 0 && (
                              <span className="shrink-0 font-mono text-[10px] text-slate-400">
                                {openTodos} tâche{openTodos > 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>

                      <div className="flex items-center gap-1 shrink-0">
                        {onOpenTrackDetails && (
                          <button
                            type="button"
                            onClick={() => onOpenTrackDetails(trk.id)}
                            title="Page du son"
                            className="p-1.5 rounded-full text-slate-400 hover:text-slate-900 dark:hover:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer"
                          >
                            <ChevronRight size={15} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleRemoveTrackFromSprint(activeSprint.id, trk.id)}
                          title="Retirer du sprint"
                          className="p-1.5 rounded-full text-slate-400 hover:text-rose-500 cursor-pointer"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>

                    {/* Inline 1-Tap Sequential Pipeline Bar (0..5: Brouillon v0 -> Master v4) */}
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-1">
                      {TRACK_PIPELINE_ORDER.map((st, idx) => {
                        const meta = TRACK_STATUS_META[st];
                        const active = idx === stepIdx;
                        const done = idx < stepIdx;
                        const adjacent = Math.abs(idx - stepIdx) <= 1;
                        return (
                          <button
                            key={st}
                            type="button"
                            disabled={!adjacent}
                            onClick={() => {
                              if (!adjacent || active) return;
                              if (st === 'rec-final' && fixCount > 0) {
                                notify(`Attention : encore ${fixCount} balise [FIX] dans le texte`);
                              }
                              setTrackGroupWorkflow(allIds, { status: st });
                            }}
                            title={`${meta.step}. ${meta.label}`}
                            className={`flex-1 rounded-lg py-1 text-[9px] font-medium text-center transition ${
                              active
                                ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 font-semibold'
                                : done
                                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                : 'bg-slate-100 dark:bg-zinc-900 text-slate-400'
                            } ${adjacent && !active ? 'cursor-pointer hover:opacity-90' : 'cursor-default opacity-70'}`}
                          >
                            {meta.shortLabel}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : !creating ? (
        <div className="rounded-2xl border border-dashed border-slate-200 dark:border-zinc-800 p-6 text-center space-y-3">
          <p className="text-xs font-semibold text-slate-700 dark:text-zinc-200">
            Aucun sprint actif sur ce projet
          </p>
          <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
            Découpe ta tracklist en sprints de <strong>3 titres max</strong> pour avancer en micro-batch jusqu’à <strong>Pré-mix (v3)</strong>.
          </p>
          <button
            type="button"
            disabled={projectTracks.length === 0}
            onClick={openComposer}
            className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-4 py-2 text-xs font-semibold hover:opacity-90 disabled:opacity-35 transition cursor-pointer"
          >
            <Plus size={13} /> Lancer un sprint (max 3 titres)
          </button>
        </div>
      ) : null}

      {/* UPCOMING / PLANNED SPRINTS ROADMAP OVERVIEW */}
      {upcomingSprints.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Sprints planifiés ({upcomingSprints.length})
            </span>
          </div>

          <div className="space-y-2">
            {upcomingSprints.map((spr) => {
              const sprTracks = spr.trackIds
                .map((id) => byId.get(id))
                .filter((t): t is MusicTrack => Boolean(t));
              return (
                <div
                  key={spr.id}
                  className="rounded-2xl border border-slate-200/80 dark:border-zinc-800/80 bg-white/70 dark:bg-zinc-900/30 p-3.5 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="rounded-full bg-slate-100 dark:bg-zinc-800 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:text-zinc-400 shrink-0">
                        À venir
                      </span>
                      <span className="text-xs font-bold text-slate-800 dark:text-zinc-100 truncate">
                        {spr.title}
                      </span>
                      {spr.targetDate && (
                        <span className="font-mono text-[10px] text-slate-400 shrink-0">
                          · {fmtTargetDate(spr.targetDate)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handlePromoteSprintToActive(spr.id)}
                        title="Passer en sprint actif"
                        className="inline-flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-zinc-800 px-2 py-1 text-[10px] font-semibold text-slate-600 dark:text-zinc-300 hover:bg-slate-900 hover:text-white dark:hover:bg-zinc-100 dark:hover:text-zinc-950 transition cursor-pointer"
                      >
                        <ArrowUp size={10} /> Activer
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteSprint(spr.id)}
                        title="Supprimer ce sprint"
                        className="p-1.5 text-slate-400 hover:text-rose-500 cursor-pointer"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {sprTracks.map((trk) => {
                      const { workflow } = getTrackContext(trk);
                      const moodMeta = workflow.mood ? TRACK_MOOD_META[workflow.mood] : null;
                      const stMeta = TRACK_STATUS_META[workflow.status];
                      return (
                        <button
                          key={trk.id}
                          type="button"
                          onClick={() => onOpenTrackDetails?.(trk.id)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-slate-50 dark:bg-zinc-900 border border-slate-200/70 dark:border-zinc-800 px-2.5 py-1 text-[11px] text-slate-700 dark:text-zinc-200 hover:border-slate-400 transition cursor-pointer max-w-full"
                        >
                          <span className="font-medium truncate max-w-[140px]">
                            {trk.manualGroupTitle || trk.title}
                          </span>
                          {moodMeta && <span className="text-[10px]">{moodMeta.emoji}</span>}
                          <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${stMeta.badge}`}>
                            {stMeta.shortLabel}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ALWAYS-AVAILABLE "+ PLANIFIER UN SPRINT" BUTTON (Plan multiple sprints ahead!) */}
      {activeSprint && !creating && projectTracks.length > 0 && (
        <button
          type="button"
          onClick={openComposer}
          className="w-full rounded-2xl border border-dashed border-slate-200 dark:border-zinc-800 hover:border-slate-400 dark:hover:border-zinc-600 py-2.5 px-4 flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-zinc-300 transition cursor-pointer"
        >
          <Plus size={13} />
          <span>Planifier un sprint suivant (max 3 titres)</span>
        </button>
      )}

      {/* CREATE SPRINT COMPOSER (works for BOTH first sprint AND upcoming sprints!) */}
      {creating && (
        <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/50 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-bold text-slate-900 dark:text-zinc-100">
              {activeSprint ? 'Planifier un prochain sprint' : 'Composer un sprint'} (
              {selectedIds.length}/{MAX_SPRINT_TRACKS})
            </h3>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="text-[11px] text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer"
            >
              Annuler
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              type="text"
              value={sprintTitle}
              onChange={(e) => setSprintTitle(e.target.value)}
              placeholder={`Sprint #${sprints.length + 1}`}
              className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-xs outline-none"
            />
            <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2">
              <Calendar size={12} className="text-slate-400 shrink-0" />
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className="w-full bg-transparent text-xs outline-none"
              />
            </div>
          </div>

          {sameMoodWarning && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-xl px-3 py-1.5">
              Tes 3 titres ont la même ambiance — pense à varier (Énergique / Chill / Expé) pour éviter la lassitude auditive.
            </p>
          )}

          <div className="max-h-56 overflow-y-auto space-y-1">
            {sprintCandidates.map((trk) => {
              const { workflow } = getTrackContext(trk);
              const selected = selectedIds.includes(trk.id);
              const statusMeta = TRACK_STATUS_META[workflow.status];
              const moodMeta = workflow.mood ? TRACK_MOOD_META[workflow.mood] : null;
              const existingSprintTitle = assignedSprintByTrackId.get(trk.id);
              return (
                <button
                  key={trk.id}
                  type="button"
                  onClick={() => toggleSelectForSprint(trk.id)}
                  className={`w-full flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-left transition cursor-pointer ${
                    selected
                      ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                      : existingSprintTitle
                      ? 'bg-white/60 dark:bg-zinc-900/50 border border-slate-200/50 dark:border-zinc-800/60 text-slate-500 dark:text-zinc-400 hover:border-slate-400'
                      : 'bg-white dark:bg-zinc-900 border border-slate-200/70 dark:border-zinc-800 text-slate-800 dark:text-zinc-100 hover:border-slate-400'
                  }`}
                >
                  <div className="min-w-0 flex-1 flex items-center gap-1.5 flex-nowrap overflow-hidden whitespace-nowrap">
                    <span className="text-xs font-semibold truncate min-w-0">
                      {trk.manualGroupTitle || trk.title}
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                        selected ? 'bg-white/15 dark:bg-black/15' : statusMeta.badge
                      }`}
                    >
                      {statusMeta.shortLabel}
                    </span>
                    {moodMeta && (
                      <span
                        className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                          selected ? 'bg-white/15 dark:bg-black/15' : moodMeta.badge
                        }`}
                      >
                        {moodMeta.emoji}
                      </span>
                    )}
                    {existingSprintTitle && (
                      <span
                        className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-mono ${
                          selected
                            ? 'bg-white/20 dark:bg-black/20'
                            : 'bg-slate-100 dark:bg-zinc-800 text-slate-400'
                        }`}
                      >
                        {existingSprintTitle}
                      </span>
                    )}
                  </div>
                  {selected && <Check size={14} className="shrink-0" />}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            disabled={selectedIds.length === 0}
            onClick={handleCreateSprint}
            className="w-full rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 py-2.5 text-xs font-semibold hover:opacity-90 disabled:opacity-35 transition cursor-pointer"
          >
            {activeSprint
              ? `Planifier ce sprint (${selectedIds.length} titre${selectedIds.length > 1 ? 's' : ''})`
              : `Démarrer le sprint (${selectedIds.length} titre${selectedIds.length > 1 ? 's' : ''})`}
          </button>
        </div>
      )}

      {/* COLLAPSIBLE VALIDATED SPRINTS HISTORY */}
      {completedSprints.length > 0 && (
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 transition cursor-pointer"
          >
            <CheckCircle2 size={12} className="text-emerald-500" />
            <span>Sprints validés ({completedSprints.length})</span>
            {showHistory ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {showHistory && (
            <div className="mt-2 space-y-1.5">
              {completedSprints.map((spr) => (
                <div
                  key={spr.id}
                  className="rounded-xl border border-slate-200/70 dark:border-zinc-800/80 px-3 py-2 flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-zinc-400"
                >
                  <div className="min-w-0">
                    <span className="font-semibold text-slate-700 dark:text-zinc-200">
                      {spr.title}
                    </span>
                    <span className="ml-2 text-[11px]">
                      {spr.trackIds
                        .map((id) => byId.get(id)?.manualGroupTitle || byId.get(id)?.title)
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteSprint(spr.id)}
                    className="p-1 text-slate-400 hover:text-rose-500 cursor-pointer shrink-0"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
