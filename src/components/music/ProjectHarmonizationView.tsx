import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  GripVertical,
  Headphones,
  ListChecks,
  Lock,
  Pause,
  Play,
  Plus,
  Sliders,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { MusicProject, MusicProjectStep, MusicTrack, TrackMood, TrackStatus } from '../../types';
import { useApp } from '../../context/AppContext';
import { useAudioPlayer } from '../../context/AudioPlayerContext';
import type { TrackGroup } from '../../lib/musicVersioning';
import { resolveTrackWorkflow } from '../../lib/trackCover';
import {
  DEFAULT_HARMONIZATION_STEPS,
  isMasteredTrack,
  isReadyForHarmonization,
  TRACK_MOOD_META,
  TRACK_PIPELINE_ORDER,
  TRACK_STATUS_META,
} from '../../utils/theme';
import { triggerHapticTick } from '../../lib/haptics';
import { CheckCircle } from '../ui/CheckCircle';
import { uid } from '../../utils/dates';

interface ProjectHarmonizationViewProps {
  project: MusicProject;
  projectTracks: MusicTrack[];
  allGroups: TrackGroup[];
  mode?: 'global-mix' | 'final-sequence';
  onCompleteGlobalMix?: () => void;
  onCompleteFinalSequence?: () => void;
  onOpenTrackDetails?: (trackId: string) => void;
  onOpenContextMenu?: (
    e: React.MouseEvent,
    group: TrackGroup,
    trackId: string,
    initialSection?: 'versions' | 'projects' | null
  ) => void;
}

const MOOD_CYCLE: Array<TrackMood | null> = ['energetic', 'chill', 'experimental', null];
const MIX_PHASE_STAGES: TrackStatus[] = ['rec-final', 'pre-mix', 'masterise'];

function fmtDur(sec?: number): string {
  if (!sec || !Number.isFinite(sec) || sec <= 0) return '—:—';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtTotalDur(totalSec: number): string {
  if (!totalSec || totalSec <= 0) return '';
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return m > 0 ? `${m} min ${String(s).padStart(2, '0')} s` : `${s} s`;
}

export function ProjectHarmonizationView({
  project,
  projectTracks,
  allGroups,
  mode = 'global-mix',
  onCompleteGlobalMix,
  onCompleteFinalSequence,
  onOpenTrackDetails,
  onOpenContextMenu,
}: ProjectHarmonizationViewProps) {
  const { updateMusicProject, setTrackGroupWorkflow, notify } = useApp();
  const player = useAudioPlayer();

  const [newStepLabel, setNewStepLabel] = useState('');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOrderIds, setDragOrderIds] = useState<string[] | null>(null);
  const [dragOffsetY, setDragOffsetY] = useState(0);

  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const dragOrderRef = useRef<string[] | null>(null);
  const justDraggedRef = useRef(false);
  const holdRef = useRef<{
    trackId: string;
    pointerId: number;
    startX: number;
    startY: number;
    originY: number;
    active: boolean;
    timerId: number | null;
  } | null>(null);

  const checklist: MusicProjectStep[] = useMemo(
    () =>
      project.harmonizationChecklist && project.harmonizationChecklist.length > 0
        ? project.harmonizationChecklist
        : DEFAULT_HARMONIZATION_STEPS,
    [project.harmonizationChecklist]
  );

  const displayedTracks = useMemo(() => {
    if (!dragOrderIds) return projectTracks;
    const byId = new Map(projectTracks.map((t) => [t.id, t]));
    const next: MusicTrack[] = [];
    for (const id of dragOrderIds) {
      const f = byId.get(id);
      if (f) next.push(f);
    }
    return next.length === projectTracks.length ? next : projectTracks;
  }, [dragOrderIds, projectTracks]);

  const mixMetrics = useMemo(() => {
    let preMixCount = 0;
    let masterCount = 0;
    for (const trk of projectTracks) {
      const grp = allGroups.find((g) => g.allTrackIds.includes(trk.id));
      const wf = resolveTrackWorkflow(trk, grp?.versions.map((v) => v.track));
      if (isReadyForHarmonization(wf.status)) preMixCount++;
      if (isMasteredTrack(wf.status)) masterCount++;
    }
    const total = projectTracks.length;
    const preMixPct = total > 0 ? Math.round((preMixCount / total) * 100) : 0;
    const masterPct = total > 0 ? Math.round((masterCount / total) * 100) : 0;
    return {
      preMixCount,
      masterCount,
      total,
      preMixPct,
      masterPct,
      allMastered: total > 0 && masterCount === total,
    };
  }, [projectTracks, allGroups]);

  const totalSec = useMemo(
    () => projectTracks.reduce((acc, t) => acc + (t.durationSec || 0), 0),
    [projectTracks]
  );

  const isPlayingProject =
    player.isPlaying && projectTracks.some((t) => t.id === player.currentTrack?.id);

  // Block iOS Safari native touch scroll while actively dragging a row
  useEffect(() => {
    if (!draggingId) return;
    const prevent = (e: TouchEvent) => {
      if (holdRef.current?.active) e.preventDefault();
    };
    window.addEventListener('touchmove', prevent, { passive: false });
    return () => window.removeEventListener('touchmove', prevent);
  }, [draggingId]);

  const activateDrag = (trackId: string, clientY: number) => {
    const d = holdRef.current;
    if (!d || d.trackId !== trackId) return;
    d.active = true;
    d.originY = clientY;
    const init = projectTracks.map((t) => t.id);
    dragOrderRef.current = init;
    setDragOrderIds(init);
    setDraggingId(trackId);
    setDragOffsetY(0);
    triggerHapticTick(16);
  };

  const handlePointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    trackId: string,
    instant = false
  ) => {
    if (projectTracks.length <= 1) return;
    const target = e.target as HTMLElement;
    if (!instant && target.closest('input, button[data-no-drag]')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    if (holdRef.current?.timerId) window.clearTimeout(holdRef.current.timerId);
    const el = e.currentTarget;
    holdRef.current = {
      trackId,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originY: e.clientY,
      active: false,
      timerId: null,
    };

    if (instant) {
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      activateDrag(trackId, e.clientY);
    } else {
      holdRef.current.timerId = window.setTimeout(() => {
        if (!holdRef.current || holdRef.current.trackId !== trackId) return;
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // ignore
        }
        activateDrag(trackId, holdRef.current.startY);
      }, 220);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = holdRef.current;
    if (!d || d.pointerId !== e.pointerId) return;

    if (!d.active) {
      if (Math.abs(e.clientY - d.startY) > 8 || Math.abs(e.clientX - d.startX) > 8) {
        if (d.timerId) window.clearTimeout(d.timerId);
        holdRef.current = null;
      }
      return;
    }

    setDragOffsetY(e.clientY - d.originY);
    const order = dragOrderRef.current;
    if (!order) return;
    const idx = order.indexOf(d.trackId);
    if (idx < 0) return;

    if (idx > 0) {
      const prevEl = rowRefs.current.get(order[idx - 1]);
      if (prevEl) {
        const rect = prevEl.getBoundingClientRect();
        if (e.clientY < rect.top + rect.height * 0.55) {
          const next = [...order];
          [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
          dragOrderRef.current = next;
          setDragOrderIds(next);
          d.originY -= rect.height;
          setDragOffsetY(e.clientY - d.originY);
          triggerHapticTick(8);
          return;
        }
      }
    }

    if (idx < order.length - 1) {
      const nextEl = rowRefs.current.get(order[idx + 1]);
      if (nextEl) {
        const rect = nextEl.getBoundingClientRect();
        if (e.clientY > rect.top + rect.height * 0.45) {
          const next = [...order];
          [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
          dragOrderRef.current = next;
          setDragOrderIds(next);
          d.originY += rect.height;
          setDragOffsetY(e.clientY - d.originY);
          triggerHapticTick(8);
        }
      }
    }
  };

  const finishDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = holdRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (d.timerId) window.clearTimeout(d.timerId);
    const wasActive = d.active;
    holdRef.current = null;

    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }

    if (wasActive) {
      justDraggedRef.current = true;
      window.setTimeout(() => {
        justDraggedRef.current = false;
      }, 160);
      const finalOrder = dragOrderRef.current;
      if (finalOrder && finalOrder.length === projectTracks.length) {
        updateMusicProject(project.id, { trackIds: finalOrder });
      }
      dragOrderRef.current = null;
      setDragOrderIds(null);
      setDraggingId(null);
      setDragOffsetY(0);
    }
  };

  const moveTrackOrder = (idx: number, delta: -1 | 1) => {
    const target = idx + delta;
    if (target < 0 || target >= projectTracks.length) return;
    const ids = projectTracks.map((t) => t.id);
    const [moved] = ids.splice(idx, 1);
    ids.splice(target, 0, moved);
    updateMusicProject(project.id, { trackIds: ids });
    triggerHapticTick(8);
  };

  const toggleChecklistItem = (stepId: string) => {
    const next = checklist.map((s) => (s.id === stepId ? { ...s, done: !s.done } : s));
    updateMusicProject(project.id, { harmonizationChecklist: next });
  };

  const addChecklistItem = (e: React.FormEvent) => {
    e.preventDefault();
    const label = newStepLabel.trim();
    if (!label) return;
    const next = [...checklist, { id: uid('harm'), label, done: false }];
    updateMusicProject(project.id, { harmonizationChecklist: next });
    setNewStepLabel('');
  };

  const deleteChecklistItem = (stepId: string) => {
    const next = checklist.filter((s) => s.id !== stepId);
    updateMusicProject(project.id, { harmonizationChecklist: next });
  };

  const doneChecklist = checklist.filter((s) => s.done).length;
  const checklistPct = checklist.length > 0 ? Math.round((doneChecklist / checklist.length) * 100) : 0;

  // ==================== MODE A: PHASE 4 — SPRINT GLOBAL PRÉ-MIX + MASTER (ALL TRACKS TOGETHER!) ====================
  if (mode === 'global-mix') {
    return (
      <div className="space-y-5">
        {/* Global Mix & Master Banner */}
        <div
          className={`rounded-2xl border p-4 space-y-3 ${
            mixMetrics.allMastered
              ? 'border-emerald-500/40 bg-emerald-500/8 dark:bg-emerald-950/25'
              : 'border-[#8C271E]/25 bg-[#8C271E]/[0.04] dark:bg-[#8C271E]/[0.09]'
          }`}
        >
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-[#8C271E] text-white px-2.5 py-0.5 text-[10px] font-semibold">
                  <Sliders size={10} /> Sprint Global · Tous les sons ensemble
                </span>
                <span className="font-mono text-[11px] font-semibold text-slate-600 dark:text-zinc-300">
                  {mixMetrics.masterCount}/{mixMetrics.total} en v5 - Master
                </span>
              </div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100">
                Pré-mix (v4) & Master (v5) simultanés pour l’homogénéité
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-zinc-400">
                Travaille les {projectTracks.length} titres en parallèle (chaîne vocale, LUFS, dynamique) pour garantir une vraie cohérence sonore sur tout le projet.
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              <button
                type="button"
                disabled={projectTracks.length === 0}
                onClick={() => {
                  if (isPlayingProject) player.togglePlay();
                  else if (projectTracks.length > 0) void player.playTrack(projectTracks[0], 0, projectTracks);
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#8C271E]/30 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-[#8C271E] dark:text-[#E56B5F] hover:bg-[#8C271E]/8 transition cursor-pointer"
              >
                {isPlayingProject ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" className="ml-0.5" />}
                <span>Comparer en boucle</span>
              </button>

              {onCompleteGlobalMix && (
                <button
                  type="button"
                  disabled={!mixMetrics.allMastered}
                  onClick={onCompleteGlobalMix}
                  title={
                    mixMetrics.allMastered
                      ? 'Valider le Pré-mix + Master et passer à l’écoute finale'
                      : `Passe d'abord tous les titres en v5 - Master (${mixMetrics.masterCount}/${mixMetrics.total})`
                  }
                  className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                    mixMetrics.allMastered
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer'
                      : 'bg-slate-200/80 dark:bg-zinc-800 text-slate-400 cursor-not-allowed'
                  }`}
                >
                  <CheckCircle2 size={13} />
                  <span>
                    {project.globalMixDoneAt
                      ? 'Passer à l’écoute finale →'
                      : `Valider Pré-mix & Master (${mixMetrics.masterCount}/${mixMetrics.total})`}
                  </span>
                </button>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 dark:text-zinc-400">
              <span>v4 - Pré-mix : {mixMetrics.preMixCount}/{mixMetrics.total} ({mixMetrics.preMixPct}%)</span>
              <span>v5 - Master : {mixMetrics.masterCount}/{mixMetrics.total} ({mixMetrics.masterPct}%)</span>
            </div>
            <div className="h-2 rounded-full bg-slate-200/80 dark:bg-zinc-800 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  mixMetrics.allMastered ? 'bg-emerald-500' : 'bg-[#8C271E]'
                }`}
                style={{ width: `${mixMetrics.masterPct}%` }}
              />
            </div>
          </div>
        </div>

        {/* ALL Project Tracks Together for Simultaneous Pre-Mix & Master */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Tous les sons du projet ({projectTracks.length}) — Avancement v3 → v4 → v5
            </h4>
          </div>

          <div className="space-y-2">
            {projectTracks.map((trk) => {
              const grp = allGroups.find((g) => g.allTrackIds.includes(trk.id));
              const siblings = grp?.versions.map((v) => v.track);
              const wf = resolveTrackWorkflow(trk, siblings);
              const stepIdx = TRACK_PIPELINE_ORDER.indexOf(wf.status);
              const moodMeta = wf.mood ? TRACK_MOOD_META[wf.mood] : null;
              const allIds = grp && grp.allTrackIds.length > 0 ? grp.allTrackIds : [trk.id];
              const mastered = isMasteredTrack(wf.status);
              const isCur = player.currentTrack?.id === trk.id;
              const playing = isCur && player.isPlaying;

              return (
                <div
                  key={trk.id}
                  onContextMenu={(e) => {
                    if (!grp || !onOpenContextMenu) return;
                    e.preventDefault();
                    e.stopPropagation();
                    onOpenContextMenu(e, grp, trk.id, null);
                  }}
                  className={`rounded-2xl border p-3 transition space-y-2.5 ${
                    mastered
                      ? 'border-emerald-500/35 bg-emerald-500/5 dark:bg-emerald-950/20'
                      : 'border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-[#141010]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2.5">
                    <button
                      type="button"
                      onClick={() =>
                        isCur ? player.togglePlay() : void player.playTrack(trk, 0, projectTracks)
                      }
                      className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer"
                    >
                      <span
                        className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 transition ${
                          playing
                            ? 'bg-[#8C271E] text-white'
                            : 'bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 hover:bg-[#8C271E]/15 hover:text-[#8C271E]'
                        }`}
                      >
                        {playing ? (
                          <Pause size={12} fill="currentColor" />
                        ) : (
                          <Play size={12} fill="currentColor" className="ml-0.5" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p
                            className={`text-sm font-semibold truncate ${
                              isCur
                                ? 'text-[#8C271E] dark:text-[#E56B5F]'
                                : 'text-slate-900 dark:text-zinc-100'
                            }`}
                          >
                            {grp?.baseTitle || trk.manualGroupTitle || trk.title}
                          </p>
                          {mastered && <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-slate-400">
                          <span className={`rounded-full px-1.5 py-0.5 font-medium ${TRACK_STATUS_META[wf.status].badge}`}>
                            {TRACK_STATUS_META[wf.status].shortLabel}
                          </span>
                          {moodMeta && (
                            <span className={`rounded-full px-1.5 py-0.5 font-medium ${moodMeta.badge}`}>
                              {moodMeta.emoji} {moodMeta.short}
                            </span>
                          )}
                          {trk.durationSec ? <span className="font-mono">{fmtDur(trk.durationSec)}</span> : null}
                        </div>
                      </div>
                    </button>

                    {onOpenTrackDetails && (
                      <button
                        type="button"
                        onClick={() => onOpenTrackDetails(trk.id)}
                        title="Ouvrir la page du son"
                        className="p-1.5 rounded-full text-slate-400 hover:text-slate-900 dark:hover:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer shrink-0"
                      >
                        <ChevronRight size={15} />
                      </button>
                    )}
                  </div>

                  {/* Focused 3-stage Mix & Master progress bar (v3 - Rec -> v4 - Pré-mix -> v5 - Master) */}
                  <div className="grid grid-cols-3 gap-1.5">
                    {MIX_PHASE_STAGES.map((st) => {
                      const meta = TRACK_STATUS_META[st];
                      const targetIdx = TRACK_PIPELINE_ORDER.indexOf(st);
                      const active = stepIdx === targetIdx;
                      const done = stepIdx > targetIdx;
                      const clickable = Math.abs(targetIdx - stepIdx) <= 1;
                      return (
                        <button
                          key={st}
                          type="button"
                          disabled={!clickable}
                          onClick={() => {
                            if (!clickable || active) return;
                            setTrackGroupWorkflow(allIds, { status: st });
                            notify(
                              `${grp?.baseTitle || trk.title} → ${meta.shortLabel} ✓`
                            );
                          }}
                          className={`rounded-xl py-1.5 text-[11px] font-semibold text-center transition ${
                            active
                              ? st === 'masterise'
                                ? 'bg-emerald-600 text-white shadow-xs'
                                : 'bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25'
                              : done
                              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                              : 'bg-slate-100 dark:bg-zinc-900 text-slate-400'
                          } ${clickable && !active ? 'cursor-pointer hover:opacity-90' : 'cursor-default opacity-80'}`}
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
        </section>

        {/* Global Homogeneity & Mix Checklist */}
        <section className="pt-3 border-t border-slate-100 dark:border-zinc-900 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <ListChecks size={14} /> Checklist d’homogénéité Pré-mix & Master
            </h3>
            <span className="font-mono text-xs font-semibold text-slate-700 dark:text-zinc-300">
              {doneChecklist}/{checklist.length} ({checklistPct}%)
            </span>
          </div>

          <div className="h-1.5 rounded-full bg-slate-100 dark:bg-zinc-900 overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all duration-300"
              style={{ width: `${checklistPct}%` }}
            />
          </div>

          <div className="space-y-1">
            {checklist.map((step) => (
              <div
                key={step.id}
                className="group flex items-center justify-between gap-2 rounded-xl px-2 py-2 hover:bg-slate-50 dark:hover:bg-zinc-900/60 transition"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <CheckCircle
                    checked={step.done}
                    onToggle={() => toggleChecklistItem(step.id)}
                    size="sm"
                  />
                  <span
                    className={`text-xs ${
                      step.done
                        ? 'line-through text-slate-400 dark:text-zinc-600'
                        : 'text-slate-800 dark:text-zinc-200'
                    }`}
                  >
                    {step.label}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => deleteChecklistItem(step.id)}
                  className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-500 cursor-pointer shrink-0"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>

          <form onSubmit={addChecklistItem} className="flex items-center gap-2 pt-1">
            <input
              type="text"
              value={newStepLabel}
              onChange={(e) => setNewStepLabel(e.target.value)}
              placeholder="+ Ajouter un contrôle de mix / export…"
              className="flex-1 rounded-xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs outline-none focus:border-slate-400 dark:focus:border-zinc-600"
            />
            <button
              type="submit"
              className="rounded-xl bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25 px-3 py-2 text-xs font-semibold hover:opacity-90 cursor-pointer inline-flex items-center gap-1"
            >
              <Plus size={12} /> Ajouter
            </button>
          </form>
        </section>
      </div>
    );
  }

  // ==================== MODE B: PHASE 5 — ÉCOUTE FINALE & CHOIX DE L'ORDRE DE LA MIXTAPE ====================
  return (
    <div className="space-y-5">
      {/* Final Continuous Listen & Order Banner */}
      <div
        className={`rounded-2xl border p-4 space-y-3 ${
          project.finalSequenceDoneAt
            ? 'border-emerald-500/40 bg-emerald-500/8 dark:bg-emerald-950/25'
            : 'border-[#8C271E]/25 bg-[#8C271E]/[0.04] dark:bg-[#8C271E]/[0.09]'
        }`}
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-[#8C271E] text-white px-2.5 py-0.5 text-[10px] font-semibold">
                <Headphones size={10} /> Phase 5 · Écoute finale & Ordre
              </span>
              {totalSec > 0 && (
                <span className="font-mono text-[11px] text-slate-500 dark:text-zinc-400">
                  {projectTracks.length} titres · {fmtTotalDur(totalSec)}
                </span>
              )}
            </div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100">
              {project.finalSequenceDoneAt
                ? 'Ordre définitif validé · Projet prêt pour la sortie ✓'
                : 'Écoute finale & séquençage de la mixtape'}
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-zinc-400">
              Écoute l’enchaînement complet du début à la fin et glisse les titres (ou utilise ↑/↓) pour choisir l’ordre final définitif.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <button
              type="button"
              disabled={projectTracks.length === 0}
              onClick={() => {
                if (isPlayingProject) player.togglePlay();
                else if (projectTracks.length > 0) void player.playTrack(projectTracks[0], 0, projectTracks);
              }}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#8C271E] hover:bg-[#A32E24] text-white px-4 py-2 text-xs font-semibold shadow-xs shadow-[#8C271E]/25 transition cursor-pointer"
            >
              {isPlayingProject ? (
                <Pause size={13} fill="currentColor" />
              ) : (
                <Play size={13} fill="currentColor" className="ml-0.5" />
              )}
              <span>{isPlayingProject ? 'Pause' : 'Écouter du début à la fin'}</span>
            </button>

            {onCompleteFinalSequence && (
              <button
                type="button"
                onClick={onCompleteFinalSequence}
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition cursor-pointer ${
                  project.finalSequenceDoneAt
                    ? 'bg-emerald-600 text-white'
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs'
                }`}
              >
                {project.finalSequenceDoneAt ? <Lock size={12} /> : <Sparkles size={12} />}
                <span>
                  {project.finalSequenceDoneAt
                    ? 'Ordre validé ✓'
                    : 'Valider l’ordre final · Projet prêt'}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Visual Mood / Energy Pacing Strip */}
        {displayedTracks.length > 0 && (
          <div className="flex items-center gap-1 pt-1 overflow-x-auto">
            {displayedTracks.map((trk, i) => {
              const grp = allGroups.find((g) => g.allTrackIds.includes(trk.id));
              const wf = resolveTrackWorkflow(trk, grp?.versions.map((v) => v.track));
              const moodMeta = wf.mood ? TRACK_MOOD_META[wf.mood] : null;
              return (
                <span
                  key={trk.id}
                  title={`#${i + 1} ${grp?.baseTitle || trk.title}`}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-mono shrink-0 ${
                    moodMeta
                      ? moodMeta.badge
                      : 'bg-slate-200/70 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400'
                  }`}
                >
                  <span>{i + 1}</span>
                  {moodMeta && <span>{moodMeta.emoji}</span>}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Drag & Drop + Up/Down Final Sequencing Table */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Ordre de la mixtape (glisser ou ↑/↓ pour réordonner)
          </h3>
          <span className="text-[10px] text-slate-400 font-mono">
            {projectTracks.length} titre{projectTracks.length > 1 ? 's' : ''}
          </span>
        </div>

        {displayedTracks.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-400">
            Aucun titre dans la tracklist active.
          </p>
        ) : (
          <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 overflow-hidden bg-white dark:bg-[#141010]">
            <div className="grid grid-cols-[28px_minmax(0,1fr)_76px_64px] sm:grid-cols-[36px_minmax(0,1fr)_104px_80px] items-center gap-1.5 px-3 py-2 border-b border-slate-100 dark:border-zinc-800/80 text-[10px] font-semibold uppercase tracking-wider text-slate-400 bg-slate-50/70 dark:bg-zinc-900/50">
              <span>#</span>
              <span>Titre</span>
              <span className="text-center">Ambiance</span>
              <span className="text-right">Ordre</span>
            </div>

            <div className="divide-y divide-slate-100 dark:divide-zinc-800/70">
              {displayedTracks.map((trk, idx) => {
                const grp = allGroups.find((g) => g.allTrackIds.includes(trk.id));
                const siblings = grp?.versions.map((v) => v.track);
                const wf = resolveTrackWorkflow(trk, siblings);
                const moodMeta = wf.mood ? TRACK_MOOD_META[wf.mood] : null;
                const allIds = grp && grp.allTrackIds.length > 0 ? grp.allTrackIds : [trk.id];
                const isDragging = draggingId === trk.id;
                const isCur = player.currentTrack?.id === trk.id;
                const playing = isCur && player.isPlaying;

                return (
                  <div
                    key={trk.id}
                    ref={(el) => {
                      if (el) rowRefs.current.set(trk.id, el);
                      else rowRefs.current.delete(trk.id);
                    }}
                    onContextMenu={(e) => {
                      if (!grp || !onOpenContextMenu) return;
                      e.preventDefault();
                      e.stopPropagation();
                      onOpenContextMenu(e, grp, trk.id, null);
                    }}
                    onPointerDown={(e) => handlePointerDown(e, trk.id, false)}
                    onPointerMove={handlePointerMove}
                    onPointerUp={finishDrag}
                    onPointerCancel={finishDrag}
                    style={
                      isDragging
                        ? {
                            transform: `translate3d(0, ${dragOffsetY.toFixed(1)}px, 0) scale(1.01)`,
                            touchAction: 'none',
                          }
                        : { touchAction: 'pan-y' }
                    }
                    className={`grid grid-cols-[28px_minmax(0,1fr)_76px_64px] sm:grid-cols-[36px_minmax(0,1fr)_104px_80px] items-center gap-1.5 px-3 py-2.5 text-xs select-none ${
                      isDragging
                        ? 'relative z-20 bg-white dark:bg-zinc-900 shadow-lg ring-1 ring-[#8C271E]/40 rounded-xl'
                        : ''
                    }`}
                  >
                    {/* Order + Drag Grip */}
                    <div
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        handlePointerDown(e, trk.id, true);
                      }}
                      className="flex items-center gap-0.5 font-mono text-[11px] font-semibold text-slate-500 dark:text-zinc-400 cursor-grab active:cursor-grabbing"
                      title="Glisser pour changer l'ordre"
                    >
                      <GripVertical size={12} className="opacity-50 shrink-0" />
                      <span>{idx + 1}</span>
                    </div>

                    {/* Title (Play + Open Details) */}
                    <div className="min-w-0 flex items-center gap-2">
                      <button
                        type="button"
                        data-no-drag="true"
                        onClick={() => {
                          if (justDraggedRef.current) return;
                          if (isCur) player.togglePlay();
                          else void player.playTrack(trk, 0, projectTracks);
                        }}
                        className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 transition cursor-pointer ${
                          playing
                            ? 'bg-[#8C271E] text-white'
                            : 'bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 hover:bg-[#8C271E]/15 hover:text-[#8C271E]'
                        }`}
                      >
                        {playing ? (
                          <Pause size={10} fill="currentColor" />
                        ) : (
                          <Play size={10} fill="currentColor" className="ml-0.5" />
                        )}
                      </button>
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          data-no-drag="true"
                          onClick={() => onOpenTrackDetails?.(trk.id)}
                          className={`text-xs font-semibold truncate text-left hover:underline cursor-pointer block max-w-full ${
                            isCur
                              ? 'text-[#8C271E] dark:text-[#E56B5F]'
                              : 'text-slate-900 dark:text-zinc-100'
                          }`}
                        >
                          {grp?.baseTitle || trk.manualGroupTitle || trk.title}
                        </button>
                        {trk.durationSec ? (
                          <span className="font-mono text-[10px] text-slate-400">
                            {fmtDur(trk.durationSec)}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {/* 1-Tap Mood Cycler */}
                    <button
                      type="button"
                      data-no-drag="true"
                      onClick={() => {
                        const curIdx = MOOD_CYCLE.indexOf(wf.mood);
                        const nextMood = MOOD_CYCLE[(curIdx + 1) % MOOD_CYCLE.length];
                        setTrackGroupWorkflow(allIds, { mood: nextMood });
                      }}
                      title="Cliquer pour changer l'ambiance"
                      className={`w-full rounded-full px-1.5 py-0.5 text-[10px] font-medium text-center truncate transition cursor-pointer ${
                        moodMeta
                          ? moodMeta.badge
                          : 'text-slate-300 dark:text-zinc-600 hover:bg-slate-100 dark:hover:bg-zinc-800'
                      }`}
                    >
                      {moodMeta ? `${moodMeta.emoji} ${moodMeta.short}` : '+ Mood'}
                    </button>

                    {/* Quick Up / Down Order Controls */}
                    <div data-no-drag="true" className="flex items-center justify-end gap-0.5">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => moveTrackOrder(idx, -1)}
                        title="Monter dans la mixtape"
                        className="h-7 w-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-[#8C271E] hover:bg-slate-100 dark:hover:bg-zinc-800 disabled:opacity-25 cursor-pointer"
                      >
                        <ChevronUp size={14} />
                      </button>
                      <button
                        type="button"
                        disabled={idx === displayedTracks.length - 1}
                        onClick={() => moveTrackOrder(idx, 1)}
                        title="Descendre dans la mixtape"
                        className="h-7 w-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-[#8C271E] hover:bg-slate-100 dark:hover:bg-zinc-800 disabled:opacity-25 cursor-pointer"
                      >
                        <ChevronDown size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
