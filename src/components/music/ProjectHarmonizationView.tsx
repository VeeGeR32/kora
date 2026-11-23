import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  GripVertical,
  ListChecks,
  Pause,
  Play,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { MusicProject, MusicProjectStep, MusicTrack, TrackMood } from '../../types';
import { useApp } from '../../context/AppContext';
import { useAudioPlayer } from '../../context/AudioPlayerContext';
import type { TrackGroup } from '../../lib/musicVersioning';
import { resolveTrackWorkflow } from '../../lib/trackCover';
import {
  DEFAULT_HARMONIZATION_STEPS,
  isReadyForHarmonization,
  TRACK_MOOD_META,
  TRACK_STATUS_META,
} from '../../utils/theme';
import { triggerHapticTick } from '../../lib/haptics';
import { CheckCircle } from '../ui/CheckCircle';
import { uid } from '../../utils/dates';

interface ProjectHarmonizationViewProps {
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

const MOOD_CYCLE: Array<TrackMood | null> = ['energetic', 'chill', 'experimental', null];

export function ProjectHarmonizationView({
  project,
  projectTracks,
  allGroups,
  onOpenTrackDetails,
  onOpenContextMenu,
}: ProjectHarmonizationViewProps) {
  const { updateMusicProject, setTrackGroupWorkflow } = useApp();
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

  const readiness = useMemo(() => {
    let ready = 0;
    for (const trk of projectTracks) {
      const grp = allGroups.find((g) => g.allTrackIds.includes(trk.id));
      const wf = resolveTrackWorkflow(trk, grp?.versions.map((v) => v.track));
      if (isReadyForHarmonization(wf.status)) ready++;
    }
    const total = projectTracks.length;
    const pct = total > 0 ? Math.round((ready / total) * 100) : 0;
    return { ready, total, pct, unlocked: total > 0 && ready === total };
  }, [projectTracks, allGroups]);

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

  return (
    <div className="space-y-5">
      {/* Visual Unlock / Readiness Banner */}
      <div
        className={`rounded-2xl border p-4 space-y-2.5 ${
          readiness.unlocked
            ? 'border-emerald-500/40 bg-emerald-500/8 dark:bg-emerald-950/25'
            : 'border-slate-200/80 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/45'
        }`}
      >
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            {readiness.unlocked ? (
              <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
            ) : (
              <Sparkles size={15} className="text-[#8C271E] shrink-0" />
            )}
            <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-zinc-100">
              {readiness.unlocked
                ? 'Prêt pour le mix & mastering global ✓'
                : `${readiness.ready} / ${readiness.total} prêts pour harmonisation`}
            </h3>
          </div>
          <span className="font-mono text-xs font-semibold tabular-nums text-slate-600 dark:text-zinc-300">
            {readiness.pct}% (≥ v4 - Pré-mix)
          </span>
        </div>

        <div className="h-1.5 rounded-full bg-slate-200/80 dark:bg-zinc-800 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              readiness.unlocked ? 'bg-emerald-500' : 'bg-[#8C271E]'
            }`}
            style={{ width: `${readiness.pct}%` }}
          />
        </div>

        {!readiness.unlocked && readiness.total > 0 && (
          <p className="text-[11px] text-slate-400">
            Fais avancer tous tes titres au moins jusqu’à <strong>v4 - Pré-mix</strong> pour débloquer la phase de finition globale.
          </p>
        )}
      </div>

      {/* Compact Drag & Drop Sequencing Table */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Tableau de séquençage (maintenir pour réordonner)
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
          <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 overflow-hidden bg-white dark:bg-[#111115]">
            {/* Header Row (BPM & Ton. live exclusively in the Song Page) */}
            <div className="grid grid-cols-[24px_minmax(0,1fr)_74px_86px] sm:grid-cols-[32px_minmax(0,1fr)_96px_108px] items-center gap-1.5 px-3 py-2 border-b border-slate-100 dark:border-zinc-800/80 text-[10px] font-semibold uppercase tracking-wider text-slate-400 bg-slate-50/70 dark:bg-zinc-900/50">
              <span>#</span>
              <span>Titre</span>
              <span className="text-center">Mood</span>
              <span className="text-right">Statut</span>
            </div>

            <div className="divide-y divide-slate-100 dark:divide-zinc-800/70">
              {displayedTracks.map((trk, idx) => {
                const grp = allGroups.find((g) => g.allTrackIds.includes(trk.id));
                const siblings = grp?.versions.map((v) => v.track);
                const wf = resolveTrackWorkflow(trk, siblings);
                const stMeta = TRACK_STATUS_META[wf.status];
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
                    className={`grid grid-cols-[24px_minmax(0,1fr)_74px_86px] sm:grid-cols-[32px_minmax(0,1fr)_96px_108px] items-center gap-1.5 px-3 py-2 text-xs select-none ${
                      isDragging
                        ? 'relative z-20 bg-white dark:bg-zinc-900 shadow-lg ring-1 ring-slate-300 dark:ring-zinc-700 rounded-xl'
                        : ''
                    }`}
                  >
                    {/* Order + Drag Grip */}
                    <div
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        handlePointerDown(e, trk.id, true);
                      }}
                      className="flex items-center gap-0.5 font-mono text-[11px] text-slate-400 cursor-grab active:cursor-grabbing"
                      title="Glisser pour changer l'ordre"
                    >
                      <GripVertical size={11} className="hidden sm:block opacity-45 shrink-0" />
                      <span>{idx + 1}</span>
                    </div>

                    {/* Title (Play + Open Details) */}
                    <div className="min-w-0 flex items-center gap-1.5">
                      <button
                        type="button"
                        data-no-drag="true"
                        onClick={() => {
                          if (justDraggedRef.current) return;
                          if (isCur) player.togglePlay();
                          else void player.playTrack(trk, 0, projectTracks);
                        }}
                        className="h-6 w-6 rounded-full bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 flex items-center justify-center shrink-0 hover:bg-slate-200 dark:hover:bg-zinc-700 cursor-pointer"
                      >
                        {playing ? (
                          <Pause size={10} fill="currentColor" />
                        ) : (
                          <Play size={10} fill="currentColor" className="ml-0.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        data-no-drag="true"
                        onClick={() => onOpenTrackDetails?.(trk.id)}
                        className={`text-xs font-medium truncate text-left hover:underline cursor-pointer ${
                          isCur
                            ? 'text-[#8C271E] font-semibold'
                            : 'text-slate-900 dark:text-zinc-100'
                        }`}
                      >
                        {grp?.baseTitle || trk.manualGroupTitle || trk.title}
                      </button>
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

                    {/* Status Pill */}
                    <div className="flex justify-end">
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold truncate ${stMeta.badge}`}
                      >
                        {stMeta.shortLabel}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Pre-Filled Final Finishing Checklist */}
      <section className="pt-3 border-t border-slate-100 dark:border-zinc-900 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <ListChecks size={14} /> Checklist finition & mix global
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
