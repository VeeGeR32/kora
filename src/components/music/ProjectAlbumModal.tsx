import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Archive,
  ArrowUp,
  Camera,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Disc3,
  FolderOpen,
  GitBranch,
  Globe,
  GripVertical,
  Link2,
  ListChecks,
  ListPlus,
  Loader2,
  Lock,
  MoreHorizontal,
  Music2,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Shuffle,
  SlidersHorizontal,
  Trash2,
  Unlock,
  X,
} from 'lucide-react';
import type { MusicProject, ProjectKind } from '../../types';
import { useApp } from '../../context/AppContext';
import { useAudioPlayer } from '../../context/AudioPlayerContext';
import { AppleConfirmDialog } from '../ui/AppleConfirmDialog';
import { CheckCircle } from '../ui/CheckCircle';
import { PROJECT_GRADIENTS } from './MiniAudioPlayer';
import { shareOrCopyPublicLink } from '../../lib/publicShare';
import { postSocialAction } from '../../lib/socialApi';
import { triggerHapticTick } from '../../lib/haptics';
import {
  countLyricsFixTags,
  findLinkedLyricsForTrack,
  getProjectTrackIndividualCovers,
  prepareAndUploadHdCover,
  resolveTrackRatings,
  resolveTrackWorkflow,
} from '../../lib/trackCover';
import { groupMusicTracks, type TrackGroup } from '../../lib/musicVersioning';
import { TRACK_STATUS_META } from '../../utils/theme';
import { ProjectCoverArtwork } from './ProjectCoverArtwork';
import { ProjectSprintView } from './ProjectSprintView';

interface ProjectAlbumModalProps {
  projectId: string | null;
  onClose: () => void;
  onOpenProfile?: () => void;
  onOpenTrackDetails?: (trackId: string) => void;
  onOpenContextMenu?: (
    e: React.MouseEvent,
    group: TrackGroup,
    trackId: string,
    initialSection?: 'versions' | 'projects' | null
  ) => void;
  onOpenProjectContextMenu?: (e: React.MouseEvent, project: MusicProject) => void;
}

function fmtTotalDuration(sec: number): string {
  if (!sec || !isFinite(sec)) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function fmtTrackDuration(sec?: number): string {
  if (!sec || !isFinite(sec)) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtAddedDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtProjectKindLabel(kind: ProjectKind): string {
  switch (kind) {
    case 'single':
      return 'Single';
    case 'ep':
      return 'EP';
    case 'mixtape':
      return 'Mixtape';
    default:
      return 'Album';
  }
}

function fmtReleaseShort(iso?: string): string {
  if (!iso) return String(new Date().getFullYear());
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function ProjectAlbumModal({
  projectId,
  onClose,
  onOpenProfile,
  onOpenTrackDetails,
  onOpenContextMenu,
  onOpenProjectContextMenu,
}: ProjectAlbumModalProps) {
  const {
    state,
    cloudUser,
    updateMusicProject,
    toggleMusicProjectStep,
    addMusicProjectStep,
    deleteMusicProjectStep,
    deleteMusicProject,
    updateMusicTrack,
    toggleMusicTrackTodo,
    renameTrackGroup,
    notify,
  } = useApp();
  const player = useAudioPlayer();

  const coverInputRef = useRef<HTMLInputElement>(null);
  const todoSectionRef = useRef<HTMLDivElement>(null);
  const [todoInput, setTodoInput] = useState('');
  // Two explicit modes: Mode Production (Tracklist & listening) vs Mode Studio (5-phase workflow, NO tracklist!)
  const [isStudioMode, setIsStudioMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('kora_project_tracklist_details') === '1';
  });
  const project: MusicProject | null = useMemo(
    () => (projectId ? state.musicProjects.find((p) => p.id === projectId) || null : null),
    [projectId, state.musicProjects]
  );

  const selectProjectMode = (studio: boolean) => {
    setIsStudioMode(studio);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('kora_project_tracklist_details', studio ? '1' : '0');
    }
    if (studio) {
      setShowAddTrack(false);
      setOpenTrackMenuId(null);
    }
  };
  const [showAddTrack, setShowAddTrack] = useState(false);
  const [addTrackSearch, setAddTrackSearch] = useState('');
  const [addTrackSort, setAddTrackSort] = useState<'recent' | 'potential' | 'gap'>('potential');
  const [showBench, setShowBench] = useState(false);
  const [showEditMeta, setShowEditMeta] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [openTrackMenuId, setOpenTrackMenuId] = useState<string | null>(null);
  const [renamingTrackId, setRenamingTrackId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [sharing, setSharing] = useState(false);

  // Press-and-hold fluid drag-and-drop reorder state
  const [draggingTrackId, setDraggingTrackId] = useState<string | null>(null);
  const [dragOrderIds, setDragOrderIds] = useState<string[] | null>(null);
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const dragOrderRef = useRef<string[] | null>(null);
  const justDraggedRef = useRef(false);
  const holdDragRef = useRef<{
    trackId: string;
    pointerId: number;
    startX: number;
    startY: number;
    originY: number;
    active: boolean;
    timerId: number | null;
  } | null>(null);

  useEffect(() => {
    if (!project) return;
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [project?.id]);

  const allGroups = useMemo(
    () => groupMusicTracks(state.musicTracks),
    [state.musicTracks]
  );

  const projectTracks = useMemo(() => {
    if (!project) return [];
    const byId = new Map(state.musicTracks.map((t) => [t.id, t]));
    const groupKeyByTrackId = new Map<string, string>();
    for (const g of allGroups) {
      for (const id of g.allTrackIds) groupKeyByTrackId.set(id, g.groupKey);
    }
    const benchSet = new Set(project.benchTrackIds || []);
    const ordered: typeof state.musicTracks = [];
    const seen = new Set<string>();
    const seenGroups = new Set<string>();

    for (const tid of project.trackIds) {
      const found = byId.get(tid);
      const gk = found ? groupKeyByTrackId.get(found.id) : undefined;
      if (
        found &&
        !seen.has(found.id) &&
        !benchSet.has(found.id) &&
        (!gk || !seenGroups.has(gk))
      ) {
        ordered.push(found);
        seen.add(found.id);
        if (gk) seenGroups.add(gk);
      }
    }
    for (const t of state.musicTracks) {
      const gk = groupKeyByTrackId.get(t.id);
      if (
        t.linkedProjectId === project.id &&
        !seen.has(t.id) &&
        !benchSet.has(t.id) &&
        (!gk || !seenGroups.has(gk))
      ) {
        ordered.push(t);
        seen.add(t.id);
        if (gk) seenGroups.add(gk);
      }
    }
    return ordered;
  }, [project, state.musicTracks, allGroups]);

  const benchTracks = useMemo(() => {
    if (!project || !project.benchTrackIds || project.benchTrackIds.length === 0) return [];
    const byId = new Map(state.musicTracks.map((t) => [t.id, t]));
    const activeSet = new Set(projectTracks.map((t) => t.id));
    const list: typeof state.musicTracks = [];
    const seen = new Set<string>();
    for (const tid of project.benchTrackIds) {
      const found = byId.get(tid);
      if (found && !seen.has(found.id) && !activeSet.has(found.id)) {
        list.push(found);
        seen.add(found.id);
      }
    }
    return list;
  }, [project, state.musicTracks, projectTracks]);

  // Display order uses live dragOrderIds during drag for instant zero-lag visual swaps
  const displayedProjectTracks = useMemo(() => {
    if (!dragOrderIds) return projectTracks;
    const byId = new Map(projectTracks.map((t) => [t.id, t]));
    const next: typeof projectTracks = [];
    for (const id of dragOrderIds) {
      const found = byId.get(id);
      if (found) next.push(found);
    }
    return next.length === projectTracks.length ? next : projectTracks;
  }, [dragOrderIds, projectTracks]);

  // Block iOS Safari native touch scroll ONLY while an item is actively being dragged
  useEffect(() => {
    if (!draggingTrackId) return;
    const preventScroll = (e: TouchEvent) => {
      if (holdDragRef.current?.active) {
        e.preventDefault();
      }
    };
    window.addEventListener('touchmove', preventScroll, { passive: false });
    return () => window.removeEventListener('touchmove', preventScroll);
  }, [draggingTrackId]);

  // Deduplicated available song groups with analytical sorting (Potentiel ↓ / Écart ↓ / Récent)
  const availableTrackGroups = useMemo(() => {
    const usedIds = new Set([
      ...projectTracks.map((t) => t.id),
      ...benchTracks.map((t) => t.id),
    ]);
    const q = addTrackSearch.trim().toLowerCase();
    const list = allGroups.filter((g) => {
      if (g.allTrackIds.some((id) => usedIds.has(id))) return false;
      if (!q) return true;
      return (
        g.baseTitle.toLowerCase().includes(q) ||
        g.versions.some((v) => v.track.title.toLowerCase().includes(q))
      );
    });
    return [...list].sort((a, b) => {
      const ra = resolveTrackRatings(a.latestTrack, a.versions.map((v) => v.track));
      const rb = resolveTrackRatings(b.latestTrack, b.versions.map((v) => v.track));
      if (addTrackSort === 'potential') {
        const pa = ra.potential ?? -1;
        const pb = rb.potential ?? -1;
        if (pb !== pa) return pb - pa;
      } else if (addTrackSort === 'gap') {
        const ga = ra.potential !== null && ra.current !== null ? ra.potential - ra.current : -99;
        const gb = rb.potential !== null && rb.current !== null ? rb.potential - rb.current : -99;
        if (gb !== ga) return gb - ga;
      }
      return b.latestTimestampMs - a.latestTimestampMs;
    });
  }, [allGroups, projectTracks, benchTracks, addTrackSearch, addTrackSort]);

  // Dynamic Roll-Up of ALL active tracks' TODOs + global project steps
  const rolledUpTrackTodos = useMemo(() => {
    const items: {
      trackId: string;
      trackTitle: string;
      todoId: string;
      label: string;
      done: boolean;
    }[] = [];
    for (const trk of projectTracks) {
      const grp = allGroups.find((g) => g.allTrackIds.includes(trk.id));
      for (const td of trk.todos || []) {
        items.push({
          trackId: trk.id,
          trackTitle: grp?.baseTitle || trk.manualGroupTitle || trk.title,
          todoId: td.id,
          label: td.label,
          done: td.done,
        });
      }
    }
    return items;
  }, [projectTracks]);

  if (!project) return null;

  const isLocked = Boolean(project.isTracklistLocked);
  const totalSec = projectTracks.reduce((acc, t) => acc + (t.durationSec || 0), 0);
  const doneSteps =
    project.steps.filter((s) => s.done).length +
    rolledUpTrackTodos.filter((t) => t.done).length;
  const totalSteps = project.steps.length + rolledUpTrackTodos.length;
  const todoPct = totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0;
  const isPlayingThisProject =
    player.isPlaying && projectTracks.some((t) => t.id === player.currentTrack?.id);

  const handleCoverUpload = async (file: File | undefined) => {
    if (!file) return;
    try {
      const coverUrl = await prepareAndUploadHdCover(file, state.preferences.firebaseConfig);
      updateMusicProject(project.id, { coverDataUrl: coverUrl });
      notify('Pochette HD du projet mise à jour ✓');
    } catch {
      notify('Impossible de lire cette image');
    }
  };

  const handlePlayAlbum = () => {
    if (projectTracks.length === 0) {
      setShowAddTrack(true);
      return;
    }
    if (isPlayingThisProject) {
      player.togglePlay();
    } else {
      void player.playTrack(projectTracks[0], 0, projectTracks);
    }
  };

  const handleAddTrackToProject = (trackId: string) => {
    if (project.isTracklistLocked) {
      handleBenchTrack(trackId);
      return;
    }
    const nextIds = Array.from(new Set([...projectTracks.map((t) => t.id), trackId]));
    const nextBench = (project.benchTrackIds || []).filter((id) => id !== trackId);
    updateMusicProject(project.id, { trackIds: nextIds, benchTrackIds: nextBench });
    updateMusicTrack(trackId, { linkedProjectId: project.id });
    notify('Son ajouté au projet ✓');
  };

  const handleBenchTrack = (trackId: string) => {
    const nextIds = projectTracks.map((t) => t.id).filter((id) => id !== trackId);
    const nextBench = Array.from(new Set([...(project.benchTrackIds || []), trackId]));
    updateMusicProject(project.id, { trackIds: nextIds, benchTrackIds: nextBench });
    updateMusicTrack(trackId, { linkedProjectId: undefined });
    setOpenTrackMenuId(null);
    notify(project.isTracklistLocked ? 'Ajouté au Backlog / Hors-projet' : 'Mis de côté');
  };

  const handleRestoreFromBench = (trackId: string) => {
    if (project.isTracklistLocked) {
      notify('Tracklist verrouillée — déverrouille le cadenas en haut pour la modifier');
      return;
    }
    const nextIds = Array.from(new Set([...projectTracks.map((t) => t.id), trackId]));
    const nextBench = (project.benchTrackIds || []).filter((id) => id !== trackId);
    updateMusicProject(project.id, { trackIds: nextIds, benchTrackIds: nextBench });
    updateMusicTrack(trackId, { linkedProjectId: project.id });
    notify('Remis dans la tracklist ✓');
  };

  const handleRemoveFromBench = (trackId: string) => {
    const grp = allGroups.find((g) => g.allTrackIds.includes(trackId));
    const removeSet = new Set(grp ? grp.allTrackIds : [trackId]);
    const nextBench = (project.benchTrackIds || []).filter((id) => !removeSet.has(id));
    const nextPins = { ...(project.pinnedVersionByGroup || {}) };
    if (grp) delete nextPins[grp.groupKey];
    updateMusicProject(project.id, {
      benchTrackIds: nextBench,
      pinnedVersionByGroup: Object.keys(nextPins).length > 0 ? nextPins : undefined,
    });
    notify('Retiré');
  };

  const handleRemoveTrackFromProject = (trackId: string) => {
    const grp = allGroups.find((g) => g.allTrackIds.includes(trackId));
    const removeSet = new Set(grp ? grp.allTrackIds : [trackId]);
    const nextIds = projectTracks.map((t) => t.id).filter((id) => !removeSet.has(id));
    const nextBench = (project.benchTrackIds || []).filter((id) => !removeSet.has(id));
    const nextPins = { ...(project.pinnedVersionByGroup || {}) };
    if (grp) delete nextPins[grp.groupKey];
    updateMusicProject(project.id, {
      trackIds: nextIds,
      benchTrackIds: nextBench,
      pinnedVersionByGroup: Object.keys(nextPins).length > 0 ? nextPins : undefined,
    });
    for (const id of removeSet) {
      const t = state.musicTracks.find((x) => x.id === id);
      if (t?.linkedProjectId === project.id) {
        updateMusicTrack(id, { linkedProjectId: undefined });
      }
    }
    setOpenTrackMenuId(null);
  };

  // Press-and-hold (220ms) OR instant grip-handle drag reordering
  const activateRowDrag = (trackId: string, clientY: number) => {
    const d = holdDragRef.current;
    if (!d || d.trackId !== trackId) return;
    d.active = true;
    d.originY = clientY;
    const initialIds = projectTracks.map((t) => t.id);
    dragOrderRef.current = initialIds;
    setDragOrderIds(initialIds);
    setDraggingTrackId(trackId);
    setDragOffsetY(0);
    setOpenTrackMenuId(null);
    triggerHapticTick(16);
  };

  const handleRowPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    trackId: string,
    instant = false
  ) => {
    if (projectTracks.length <= 1) return;
    const target = e.target as HTMLElement;
    if (!instant && target.closest('[data-no-drag]')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    if (holdDragRef.current?.timerId) {
      window.clearTimeout(holdDragRef.current.timerId);
    }

    const rowEl = e.currentTarget;
    holdDragRef.current = {
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
        rowEl.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      activateRowDrag(trackId, e.clientY);
    } else {
      const timerId = window.setTimeout(() => {
        if (!holdDragRef.current || holdDragRef.current.trackId !== trackId) return;
        try {
          rowEl.setPointerCapture(e.pointerId);
        } catch {
          // ignore
        }
        activateRowDrag(trackId, holdDragRef.current.startY);
      }, 220);
      holdDragRef.current.timerId = timerId;
    }
  };

  const handleRowPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = holdDragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;

    if (!d.active) {
      // User moved before hold threshold -> cancel hold so native scroll stays silky smooth
      if (Math.abs(e.clientY - d.startY) > 8 || Math.abs(e.clientX - d.startX) > 8) {
        if (d.timerId) window.clearTimeout(d.timerId);
        holdDragRef.current = null;
      }
      return;
    }

    const dy = e.clientY - d.originY;
    setDragOffsetY(dy);

    const curOrder = dragOrderRef.current;
    if (!curOrder) return;
    const curIdx = curOrder.indexOf(d.trackId);
    if (curIdx < 0) return;

    // Check swap with previous row
    if (curIdx > 0) {
      const prevId = curOrder[curIdx - 1];
      const prevEl = rowRefs.current.get(prevId);
      if (prevEl) {
        const rect = prevEl.getBoundingClientRect();
        if (e.clientY < rect.top + rect.height * 0.55) {
          const nextOrder = [...curOrder];
          [nextOrder[curIdx - 1], nextOrder[curIdx]] = [nextOrder[curIdx], nextOrder[curIdx - 1]];
          dragOrderRef.current = nextOrder;
          setDragOrderIds(nextOrder);
          d.originY -= rect.height;
          setDragOffsetY(e.clientY - d.originY);
          triggerHapticTick(8);
          return;
        }
      }
    }

    // Check swap with next row
    if (curIdx < curOrder.length - 1) {
      const nextId = curOrder[curIdx + 1];
      const nextEl = rowRefs.current.get(nextId);
      if (nextEl) {
        const rect = nextEl.getBoundingClientRect();
        if (e.clientY > rect.top + rect.height * 0.45) {
          const nextOrder = [...curOrder];
          [nextOrder[curIdx + 1], nextOrder[curIdx]] = [nextOrder[curIdx], nextOrder[curIdx + 1]];
          dragOrderRef.current = nextOrder;
          setDragOrderIds(nextOrder);
          d.originY += rect.height;
          setDragOffsetY(e.clientY - d.originY);
          triggerHapticTick(8);
        }
      }
    }
  };

  const finishRowDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = holdDragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (d.timerId) window.clearTimeout(d.timerId);
    const wasActive = d.active;
    holdDragRef.current = null;

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
      setDraggingTrackId(null);
      setDragOffsetY(0);
    }
  };

  const handleMoveTrack = (idx: number, delta: -1 | 1) => {
    const target = idx + delta;
    if (target < 0 || target >= projectTracks.length) return;
    const ids = projectTracks.map((t) => t.id);
    const [moved] = ids.splice(idx, 1);
    ids.splice(target, 0, moved);
    updateMusicProject(project.id, { trackIds: ids });
  };

  const handleAddTodo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!todoInput.trim()) return;
    addMusicProjectStep(project.id, todoInput.trim());
    setTodoInput('');
  };

  const artistName = state.preferences.name || 'Moi';
  const artistAvatarUrl = state.preferences.avatarUrl || cloudUser?.photoURL || '';

  return (
    <AnimatePresence>
      {/* In-App Full-Width Rowav Studio Project Page (coherent with Song, Playlist & Textes pages!) */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
        onContextMenu={(e) => {
          const target = e.target as HTMLElement | null;
          if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
          if (!onOpenProjectContextMenu) return;
          e.preventDefault();
          e.stopPropagation();
          onOpenProjectContextMenu(e, project);
        }}
        className="w-full tempo-card rounded-3xl text-slate-900 dark:text-zinc-100 overflow-hidden"
      >
        <div className="pb-8">
          {/* Minimalist In-App Studio Top Bar (identical to TrackDetailModal & PlaylistPage!) */}
          <header className="px-4 sm:px-6 py-3.5 border-b border-slate-100 dark:border-zinc-800/80">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Retour"
                  className="h-9 px-3 rounded-full bg-slate-100 dark:bg-zinc-900 text-slate-800 dark:text-zinc-100 inline-flex items-center gap-1 text-xs font-semibold hover:bg-slate-200/80 dark:hover:bg-zinc-800 transition cursor-pointer shrink-0"
                >
                  <ChevronLeft size={16} /> Retour
                </button>
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-zinc-900 px-2.5 py-1 font-mono text-[11px] font-semibold text-slate-700 dark:text-zinc-200 truncate">
                  {fmtProjectKindLabel(project.kind)} · {projectTracks.length}{' '}
                  {projectTracks.length > 1 ? 'titres' : 'titre'}
                  {totalSec > 0 ? ` · ${fmtTotalDuration(totalSec)}` : ''}
                </span>
                {isLocked && !isStudioMode && (
                  <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-amber-500/12 text-amber-600 dark:text-amber-400 px-2.5 py-1 text-[10px] font-semibold shrink-0">
                    <Lock size={10} /> Figée
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {!isStudioMode && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        const nextLocked = !isLocked;
                        updateMusicProject(project.id, { isTracklistLocked: nextLocked });
                        notify(
                          nextLocked
                            ? 'Tracklist verrouillée — les nouveaux sons iront dans le Backlog 🔒'
                            : 'Tracklist déverrouillée 🔓'
                        );
                      }}
                      title={
                        isLocked
                          ? 'Tracklist figée (cliquer pour déverrouiller)'
                          : 'Verrouiller / figer la tracklist définitive'
                      }
                      className={`h-9 w-9 rounded-full flex items-center justify-center transition cursor-pointer ${
                        isLocked
                          ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                          : 'bg-slate-100 dark:bg-zinc-900 text-slate-600 dark:text-zinc-300 hover:bg-slate-200/80 dark:hover:bg-zinc-800'
                      }`}
                    >
                      {isLocked ? <Lock size={14} /> : <Unlock size={14} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        window.setTimeout(
                          () => todoSectionRef.current?.scrollIntoView({ behavior: 'smooth' }),
                          60
                        );
                      }}
                      title="Voir la TODO"
                      className="hidden sm:inline-flex h-9 px-3 rounded-full bg-slate-100 dark:bg-zinc-900 text-slate-800 dark:text-zinc-100 items-center gap-1.5 text-xs font-semibold hover:bg-slate-200/80 dark:hover:bg-zinc-800 transition cursor-pointer"
                    >
                      <ListChecks size={14} />
                      <span className="font-mono text-[11px]">
                        {doneSteps}/{totalSteps}
                      </span>
                    </button>
                  </>
                )}

                {/* Explicit 2-Mode Switch: Production (Tracklist) vs Studio (5-Phase Sprints, ZERO Tracklist!) */}
                <div
                  role="tablist"
                  aria-label="Mode du projet"
                  className="inline-flex items-center rounded-full bg-slate-100 dark:bg-zinc-900 p-0.5 border border-slate-200/70 dark:border-zinc-800"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={!isStudioMode}
                    onClick={() => selectProjectMode(false)}
                    className={`h-8 px-3 rounded-full inline-flex items-center gap-1.5 text-[11px] font-semibold transition cursor-pointer ${
                      !isStudioMode
                        ? 'bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25'
                        : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100'
                    }`}
                  >
                    <Disc3 size={12} />
                    <span>Tracklist</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={isStudioMode}
                    onClick={() => selectProjectMode(true)}
                    className={`h-8 px-3 rounded-full inline-flex items-center gap-1.5 text-[11px] font-semibold transition cursor-pointer ${
                      isStudioMode
                        ? 'bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25'
                        : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100'
                    }`}
                  >
                    <FolderOpen size={12} />
                    <span>Packs</span>
                    {(project.packs?.length ?? project.sprints?.length ?? 0) > 0 && (
                      <span
                        className={`font-mono text-[10px] rounded-full px-1.5 py-0.2 ${
                          isStudioMode ? 'bg-white/20 text-white' : 'bg-slate-200 dark:bg-zinc-800'
                        }`}
                      >
                        {project.packs ? project.packs.length : project.sprints?.length || 0}
                      </span>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </header>

          {/* Full-Width Studio Body (identical layout & padding to TrackDetailModal & PlaylistPage!) */}
          <div className="px-4 sm:px-7 pt-6 space-y-6">
            {/* Horizontal Studio Hero: Square Cover + Title/Meta + Action Pills */}
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
              <div className="relative group shrink-0">
                <div
                  onClick={() => coverInputRef.current?.click()}
                  className="h-40 w-40 sm:h-36 sm:w-36 rounded-[24px] overflow-hidden shadow-xl border border-slate-200/70 dark:border-zinc-800 cursor-pointer"
                >
                  <ProjectCoverArtwork
                    title={project.title}
                    projectCoverUrl={project.coverDataUrl}
                    trackCoverUrls={getProjectTrackIndividualCovers(projectTracks)}
                    gradientId={project.coverGradient}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => coverInputRef.current?.click()}
                  title="Changer la pochette du projet"
                  className="absolute inset-0 rounded-[22px] bg-black/45 opacity-0 group-hover:opacity-100 text-white flex flex-col items-center justify-center gap-1 text-[10px] font-semibold transition cursor-pointer"
                >
                  <Camera size={16} />
                  Pochette
                </button>
                <button
                  type="button"
                  onClick={() => coverInputRef.current?.click()}
                  aria-label="Changer la pochette"
                  className="absolute bottom-1.5 right-1.5 h-7 w-7 rounded-full bg-black/65 text-white flex items-center justify-center shadow-md backdrop-blur-xs cursor-pointer sm:opacity-85 hover:scale-105 transition"
                >
                  <Camera size={13} />
                </button>
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => void handleCoverUpload(e.target.files?.[0])}
                  className="hidden"
                />
              </div>

              <div className="flex-1 min-w-0 w-full space-y-2.5 text-center sm:text-left">
                <div>
                  <input
                    type="text"
                    value={project.title}
                    onChange={(e) => updateMusicProject(project.id, { title: e.target.value })}
                    placeholder="Nom du projet…"
                    className="w-full bg-transparent text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-zinc-50 outline-none border-b border-transparent focus:border-slate-300 dark:focus:border-zinc-700 pb-0.5 text-center sm:text-left"
                  />
                  <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mt-1 text-xs text-slate-500 dark:text-zinc-400">
                    <button
                      type="button"
                      onClick={() => onOpenProfile?.()}
                      title="Voir mon profil"
                      className="inline-flex items-center gap-1.5 font-semibold text-slate-800 dark:text-zinc-200 hover:underline cursor-pointer"
                    >
                      {artistAvatarUrl ? (
                        <img
                          src={artistAvatarUrl}
                          alt={artistName}
                          className="h-5 w-5 rounded-full object-cover border border-black/10 dark:border-white/15 shrink-0"
                        />
                      ) : (
                        <span className="h-5 w-5 rounded-full bg-[#8C271E] text-white text-[9px] font-bold flex items-center justify-center shrink-0">
                          {artistName.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                      <span>{artistName}</span>
                    </button>
                    <span>·</span>
                    <span>
                      {fmtProjectKindLabel(project.kind)} · {fmtReleaseShort(project.targetReleaseDate)} ·{' '}
                      {projectTracks.length} {projectTracks.length > 1 ? 'titres' : 'titre'}
                      {totalSec > 0 ? ` · ${fmtTotalDuration(totalSec)}` : ''}
                    </span>
                  </div>
                </div>

                {/* Horizontal Action Pills (100% consistent with Song Page & Playlist Page!) */}
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handlePlayAlbum}
                    aria-label="Lire le projet"
                    className="inline-flex items-center gap-1.5 rounded-full bg-[#8C271E] hover:bg-[#A32E24] text-white px-4 py-2 text-xs font-semibold shadow-xs shadow-[#8C271E]/25 active:scale-95 transition cursor-pointer"
                  >
                    {isPlayingThisProject ? (
                      <>
                        <Pause size={13} fill="currentColor" /> Pause
                      </>
                    ) : (
                      <>
                        <Play size={13} fill="currentColor" className="ml-0.5" /> Écouter
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    disabled={projectTracks.length === 0}
                    onClick={() => {
                      if (projectTracks.length > 0) void player.playShuffled(projectTracks);
                    }}
                    title="Lecture aléatoire du projet"
                    className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition cursor-pointer disabled:opacity-40 ${
                      player.shuffle && isPlayingThisProject
                        ? 'bg-[#8C271E]/15 text-[#8C271E] dark:text-[#E56B5F]'
                        : 'bg-slate-100 dark:bg-zinc-900 hover:bg-slate-200/80 dark:hover:bg-zinc-800 text-slate-800 dark:text-zinc-100'
                    }`}
                  >
                    <Shuffle size={13} /> Aléatoire
                  </button>

                  <button
                    type="button"
                    disabled={sharing}
                    onClick={async () => {
                      setSharing(true);
                      try {
                        const tracksPayload = projectTracks.map((trk) => {
                          const grp = allGroups.find((g) => g.allTrackIds.includes(trk.id));
                          return {
                            id: trk.id,
                            title: grp?.baseTitle || trk.manualGroupTitle || trk.title,
                            artist: trk.artist || artistName,
                            versionLabel: grp?.latestVersionLabel,
                            coverGradient: trk.coverGradient || project.coverGradient || 'sunset',
                            durationSec: trk.durationSec || 155,
                            bpm: trk.bpm,
                            mood: trk.mood,
                          };
                        });
                        const res = await postSocialAction(
                          {
                            action: 'publish_project',
                            userName: artistName,
                            userBio: state.preferences.bio,
                            project: {
                              id: project.id,
                              title: project.title,
                              kind: project.kind,
                              description: project.notes || '',
                              coverUrl: project.coverDataUrl,
                              coverGradient: project.coverGradient || 'sunset',
                              releaseDate:
                                project.targetReleaseDate || new Date().toISOString().slice(0, 10),
                              tracks: tracksPayload,
                            },
                          },
                          state.preferences.firebaseConfig
                        );
                        if (res.ok) {
                          notify(`Projet « ${project.title} » publié sur Rowav Social & ton Portfolio ✓`);
                        } else {
                          notify(res.error || 'Impossible de publier sur Rowav Social');
                        }
                      } finally {
                        setSharing(false);
                      }
                    }}
                    title="Publier ce projet sur la communauté Rowav Social et ton Portfolio Artiste"
                    className="inline-flex items-center gap-1.5 rounded-full bg-[#8C271E]/12 hover:bg-[#8C271E]/20 text-[#8C271E] dark:text-[#E56B5F] px-3.5 py-2 text-xs font-semibold transition cursor-pointer disabled:opacity-50"
                  >
                    <Globe size={13} />
                    <span>Publier sur Social</span>
                  </button>

                  <button
                    type="button"
                    disabled={sharing}
                    onClick={async () => {
                      setSharing(true);
                      try {
                        const res = await shareOrCopyPublicLink({
                          kind: 'project',
                          id: project.id,
                          title: project.title,
                          firebaseConfig: state.preferences.firebaseConfig,
                        });
                        notify(
                          res.method === 'native'
                            ? `Projet « ${project.title} » partagé ✓`
                            : `Lien public du projet copié ✓ (écoute sans compte)`
                        );
                      } catch (err) {
                        notify(`Partage : ${(err as Error).message}`);
                      } finally {
                        setSharing(false);
                      }
                    }}
                    title="Partager ce projet (lien d’écoute publique sans compte)"
                    className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-zinc-900 hover:bg-slate-200/80 dark:hover:bg-zinc-800 text-slate-800 dark:text-zinc-100 px-3.5 py-2 text-xs font-semibold transition cursor-pointer disabled:opacity-50"
                  >
                    {sharing ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
                    <span>Lien public</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowEditMeta((v) => !v)}
                    title="Modifier pochette, format & statut du projet"
                    className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition cursor-pointer ${
                      showEditMeta
                        ? 'bg-[#8C271E] text-white'
                        : 'bg-slate-100 dark:bg-zinc-900 hover:bg-slate-200/80 dark:hover:bg-zinc-800 text-slate-800 dark:text-zinc-100'
                    }`}
                  >
                    <SlidersHorizontal size={13} />
                    <span>Options</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Collapsible Cover Gradients & Project Metadata Drawer */}
            <AnimatePresence>
              {showEditMeta && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/60 p-4 space-y-3 overflow-hidden"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {PROJECT_GRADIENTS.map((g) => (
                        <button
                          key={g.id}
                          type="button"
                          title={g.label}
                          onClick={() =>
                            updateMusicProject(project.id, {
                              coverGradient: g.id,
                              coverDataUrl: undefined,
                            })
                          }
                          className={`h-5 w-5 rounded-full bg-gradient-to-br ${g.css} cursor-pointer transition ${
                            !project.coverDataUrl && (project.coverGradient || 'pink') === g.id
                              ? 'ring-2 ring-offset-2 ring-[#8C271E] dark:ring-offset-zinc-900'
                              : 'opacity-75 hover:opacity-100'
                          }`}
                        />
                      ))}
                    </div>
                    <div className="flex items-center gap-2.5">
                      {project.coverDataUrl && (
                        <button
                          type="button"
                          onClick={() => {
                            updateMusicProject(project.id, { coverDataUrl: undefined });
                            notify('Pochette du projet retirée (pochettes individuelles des sons actives)');
                          }}
                          className="text-xs font-medium text-rose-500 hover:underline cursor-pointer"
                        >
                          Retirer pochette
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => coverInputRef.current?.click()}
                        className="text-xs font-semibold text-slate-700 dark:text-zinc-200 underline cursor-pointer"
                      >
                        Importer photo
                      </button>
                    </div>
                  </div>

                  {/* Apple Segmented Control: Format */}
                  <div className="space-y-1.5">
                    <span className="text-[11px] font-medium text-slate-400 dark:text-zinc-500">
                      Format du projet
                    </span>
                    <div className="grid grid-cols-4 gap-1 rounded-xl bg-slate-100 dark:bg-zinc-950 p-1">
                      {(
                        [
                          ['single', 'Single'],
                          ['ep', 'EP'],
                          ['album', 'Album'],
                          ['mixtape', 'Mixtape'],
                        ] as const
                      ).map(([id, lbl]) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => updateMusicProject(project.id, { kind: id })}
                          className={`rounded-lg py-1.5 text-xs font-semibold transition cursor-pointer ${
                            project.kind === id
                              ? 'bg-[#8C271E] text-white shadow-2xs'
                              : 'text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
                          }`}
                        >
                          {lbl}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Apple Segmented Control: Statut */}
                  <div className="space-y-1.5">
                    <span className="text-[11px] font-medium text-slate-400 dark:text-zinc-500">
                      Phase actuelle
                    </span>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 rounded-xl bg-slate-100 dark:bg-zinc-950 p-1">
                      {(
                        [
                          ['en-cours', 'En cours'],
                          ['mix', 'Mix / Master'],
                          ['pret', 'Prêt'],
                          ['sorti', 'Sorti / Archivé'],
                        ] as const
                      ).map(([id, lbl]) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => updateMusicProject(project.id, { status: id })}
                          className={`rounded-lg py-1.5 text-xs font-semibold transition cursor-pointer ${
                            project.status === id
                              ? 'bg-[#8C271E] text-white shadow-2xs'
                              : 'text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
                          }`}
                        >
                          {lbl}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-slate-400 dark:text-zinc-500">
                        Date de sortie :
                      </span>
                      <input
                        type="date"
                        value={project.targetReleaseDate || ''}
                        onChange={(e) =>
                          updateMusicProject(project.id, {
                            targetReleaseDate: e.target.value || undefined,
                          })
                        }
                        className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2.5 py-1.5 font-mono text-[11px]"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteOpen(true)}
                      className="inline-flex items-center gap-1 rounded-xl bg-rose-500/10 hover:bg-rose-500/15 text-rose-600 dark:text-rose-400 px-3 py-1.5 text-xs font-semibold transition cursor-pointer"
                    >
                      <Trash2 size={12} /> Supprimer…
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ================= MODE STUDIO: 5-PHASE PIPELINE ONLY (NO TRACKLIST!) ================= */}
            {isStudioMode ? (
              <ProjectSprintView
                project={project}
                projectTracks={projectTracks}
                allGroups={allGroups}
                onOpenTrackDetails={onOpenTrackDetails}
                onOpenContextMenu={onOpenContextMenu}
              />
            ) : (
              <>
            {/* ================= MODE PRODUCTION: TRACKLIST + BACKLOG + TODO ================= */}
            <button
              type="button"
              onClick={() => setShowAddTrack((v) => !v)}
              className="w-full rounded-2xl bg-slate-100 dark:bg-zinc-900 hover:bg-slate-200/80 dark:hover:bg-zinc-800/90 py-3 px-4 flex items-center justify-center gap-2 text-xs font-semibold text-slate-900 dark:text-zinc-100 transition cursor-pointer"
            >
              {isLocked ? <Archive size={14} /> : <Plus size={15} />}
              <span>
                {isLocked
                  ? 'Ajouter un son au Backlog / Hors-projet (tracklist figée)'
                  : 'Ajouter un son à ce projet'}
              </span>
            </button>

            {/* Collapsible Library Track Picker with Analytical Sort */}
            <AnimatePresence>
              {showAddTrack && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/50 p-3.5 space-y-2 overflow-hidden"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-[11px] font-semibold text-slate-600 dark:text-zinc-300">
                      Tes sons disponibles ({availableTrackGroups.length})
                    </span>
                    <div className="flex items-center gap-1">
                      {(
                        [
                          ['potential', '↗ Potentiel'],
                          ['gap', 'Δ Écart'],
                          ['recent', 'Récents'],
                        ] as const
                      ).map(([id, lbl]) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setAddTrackSort(id)}
                          className={`rounded-lg px-2 py-0.5 text-[10px] font-medium transition cursor-pointer ${
                            addTrackSort === id
                              ? 'bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25'
                              : 'text-slate-400 hover:text-slate-800 dark:hover:text-zinc-200'
                          }`}
                        >
                          {lbl}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setShowAddTrack(false)}
                        className="ml-1 text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 rounded-xl bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 px-2.5 py-1.5">
                    <Search size={12} className="text-slate-400 shrink-0" />
                    <input
                      type="text"
                      value={addTrackSearch}
                      onChange={(e) => setAddTrackSearch(e.target.value)}
                      placeholder="Rechercher un morceau…"
                      className="w-full bg-transparent text-xs outline-none text-slate-800 dark:text-zinc-100 placeholder:text-slate-400"
                    />
                    {addTrackSearch && (
                      <button
                        type="button"
                        onClick={() => setAddTrackSearch('')}
                        className="text-slate-400 hover:text-slate-700 cursor-pointer"
                      >
                        <X size={11} />
                      </button>
                    )}
                  </div>
                  {availableTrackGroups.length === 0 ? (
                    <p className="text-xs text-slate-400 py-2">
                      {addTrackSearch
                        ? 'Aucun morceau trouvé.'
                        : 'Tous tes morceaux sont déjà dans ce projet.'}
                    </p>
                  ) : (
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {availableTrackGroups.map((g) => {
                        const r = resolveTrackRatings(
                          g.latestTrack,
                          g.versions.map((v) => v.track)
                        );
                        return (
                          <div
                            key={g.groupKey}
                            className="w-full flex items-center justify-between gap-2 rounded-xl bg-white dark:bg-zinc-900 border border-slate-200/70 dark:border-zinc-800 px-3 py-2"
                          >
                            <span className="flex items-center gap-2 min-w-0 flex-1">
                              <Music2 size={13} className="text-slate-400 shrink-0" />
                              <span className="text-xs font-medium truncate">{g.baseTitle}</span>
                              {(r.current !== null || r.potential !== null) && (
                                <span className="font-mono text-[10px] text-slate-400 shrink-0">
                                  {r.current ?? '—'}
                                  <span className="text-[#8C271E]">↗{r.potential ?? '—'}</span>
                                </span>
                              )}
                            </span>
                            <div className="flex items-center gap-1 shrink-0">
                              {!isLocked && (
                                <button
                                  type="button"
                                  onClick={() => handleBenchTrack(g.latestTrack.id)}
                                  title="Ajouter au Backlog / Hors-projet"
                                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-medium text-slate-400 hover:text-slate-800 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 transition cursor-pointer"
                                >
                                  <Archive size={11} /> Backlog
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleAddTrackToProject(g.latestTrack.id)}
                                className="inline-flex items-center gap-1 rounded-lg bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25 px-2.5 py-1 text-[10px] font-semibold hover:opacity-90 transition cursor-pointer"
                              >
                                {isLocked ? (
                                  <>
                                    <Archive size={11} /> Backlog
                                  </>
                                ) : (
                                  <>
                                    <Plus size={11} /> Ajouter
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Tracklist: Pure Divider-less Spotify Album Style in Clean View · Numbered Studio List in Details View */}
            <div className="relative divide-y divide-slate-100 dark:divide-zinc-900">
              {displayedProjectTracks.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-400">
                  Aucun titre dans ce projet — clique sur « Ajouter un son » ci-dessus.
                </p>
              ) : (
                displayedProjectTracks.map((trk, idx) => {
                  const isCur = player.currentTrack?.id === trk.id;
                  const playing = isCur && player.isPlaying;
                  const menuOpen = openTrackMenuId === trk.id;
                  const isDragging = draggingTrackId === trk.id;
                  const trkGroup = allGroups.find((g) => g.allTrackIds.includes(trk.id));
                  const displayTitle = trkGroup?.baseTitle || trk.manualGroupTitle || trk.title;
                  const activeVersionEntry =
                    trkGroup?.versions.find((v) => v.track.id === trk.id) || null;
                  const hasMultipleVersions = Boolean(trkGroup && trkGroup.versions.length > 1);
                  const linkedLyrics = findLinkedLyricsForTrack(
                    trk,
                    state.lyricsDocs,
                    trkGroup?.allTrackIds,
                    trkGroup?.versions.map((v) => v.track)
                  );
                  const trkFixCount = linkedLyrics ? countLyricsFixTags(linkedLyrics.content) : 0;
                  const trkWorkflow = resolveTrackWorkflow(
                    trk,
                    trkGroup?.versions.map((v) => v.track)
                  );
                  const trkStatusMeta = TRACK_STATUS_META[trkWorkflow.status];
                  const trkRatings = resolveTrackRatings(
                    trk,
                    trkGroup?.versions.map((v) => v.track)
                  );
                  const trkOwnCover =
                    trk.coverDataUrl ||
                    trk.cloudCoverUrl ||
                    trkGroup?.versions.find((v) => Boolean(v.track.coverDataUrl))?.track
                      .coverDataUrl ||
                    trkGroup?.versions.find((v) => Boolean(v.track.cloudCoverUrl))?.track
                      .cloudCoverUrl ||
                    null;
                  const rowThumb = project.coverDataUrl || trkOwnCover;
                  return (
                    <div
                      key={trk.id}
                      ref={(el) => {
                        if (el) rowRefs.current.set(trk.id, el);
                        else rowRefs.current.delete(trk.id);
                      }}
                      onContextMenu={(e) => {
                        if (!trkGroup || !onOpenContextMenu) return;
                        e.preventDefault();
                        e.stopPropagation();
                        onOpenContextMenu(e, trkGroup, trk.id, null);
                      }}
                      onPointerDown={(e) => handleRowPointerDown(e, trk.id, false)}
                      onPointerMove={handleRowPointerMove}
                      onPointerUp={finishRowDrag}
                      onPointerCancel={finishRowDrag}
                      style={
                        isDragging
                          ? {
                              transform: `translate3d(0, ${dragOffsetY.toFixed(1)}px, 0) scale(1.02)`,
                              touchAction: 'none',
                            }
                          : { touchAction: 'pan-y' }
                      }
                      className={`py-3 select-none ${
                        isDragging
                          ? 'relative z-20 rounded-2xl bg-white dark:bg-zinc-900 px-2.5 -mx-2.5 shadow-xl ring-1 ring-slate-200 dark:ring-zinc-700'
                          : 'transition-transform duration-150'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2.5">
                        {projectTracks.length > 1 && (
                          <div
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              handleRowPointerDown(e, trk.id, true);
                            }}
                            title="Maintenir et glisser pour réordonner"
                            className="hidden sm:flex items-center justify-center p-1 -ml-1 text-slate-300 dark:text-zinc-700 hover:text-slate-500 dark:hover:text-zinc-400 cursor-grab active:cursor-grabbing shrink-0"
                          >
                            <GripVertical size={14} />
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (justDraggedRef.current) return;
                            const sameQueue =
                              player.queue.length === projectTracks.length &&
                              player.queue.every((q, i) => q.id === projectTracks[i].id);
                            if (isCur && sameQueue) {
                              player.togglePlay();
                            } else {
                              void player.playTrack(trk, 0, projectTracks);
                            }
                          }}
                          className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer"
                        >
                          <span className="w-5 text-center font-mono text-xs text-slate-400 dark:text-zinc-500 shrink-0">
                            {playing ? (
                              <Pause
                                size={13}
                                className="mx-auto text-[#8C271E] dark:text-[#E56B5F]"
                                fill="currentColor"
                              />
                            ) : (
                              idx + 1
                            )}
                          </span>
                          {/* Track Cover Thumbnail */}
                          {rowThumb && (
                            <img
                              src={rowThumb}
                              alt={displayTitle}
                              draggable={false}
                              className="h-9 w-9 rounded-lg object-cover border border-slate-200/70 dark:border-zinc-800 shrink-0 pointer-events-none"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <p
                              className={`text-sm font-semibold truncate ${
                                isCur
                                  ? 'text-[#8C271E] dark:text-[#E56B5F]'
                                  : 'text-slate-900 dark:text-zinc-100'
                              }`}
                            >
                              {displayTitle}
                            </p>
                            <div className="flex items-center gap-1.5 flex-nowrap overflow-hidden whitespace-nowrap mt-0.5 min-w-0">
                                <span className="text-[11px] text-slate-400 dark:text-zinc-500 truncate min-w-0">
                                  {fmtAddedDate(trk.modifiedAt || trk.addedAt) ||
                                    state.preferences.name ||
                                    trk.artist}
                                </span>
                                {hasMultipleVersions && activeVersionEntry && (
                                  <span
                                    title="Changer la version depuis la page du son"
                                    className="shrink-0 inline-flex items-center gap-0.5 rounded-full bg-slate-200/80 dark:bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600 dark:text-zinc-300"
                                  >
                                    <GitBranch size={9} className="shrink-0" />
                                    <span>{activeVersionEntry.versionLabel}</span>
                                  </span>
                                )}
                                <span
                                  className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${trkStatusMeta.badge}`}
                                >
                                  {trkStatusMeta.shortLabel}
                                </span>
                                {(trkRatings.current !== null || trkRatings.potential !== null) && (
                                  <span
                                    title={`Note actuelle : ${trkRatings.current ?? '—'}/10 · Potentiel : ${trkRatings.potential ?? '—'}/10`}
                                    className="shrink-0 inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-zinc-800/90 px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-slate-700 dark:text-zinc-200"
                                  >
                                    {trkRatings.current !== null && <span>{trkRatings.current}</span>}
                                    {trkRatings.current !== null && trkRatings.potential !== null && (
                                      <span className="opacity-35">·</span>
                                    )}
                                    {trkRatings.potential !== null && (
                                      <span className="text-[#8C271E]">
                                        ↗{trkRatings.potential}
                                      </span>
                                    )}
                                  </span>
                                )}
                                {trkFixCount > 0 && (
                                  <span className="shrink-0 rounded-full bg-rose-500/12 text-rose-600 dark:text-rose-400 px-1.5 py-0.5 font-mono text-[10px] font-semibold">
                                    [FIX] ×{trkFixCount}
                                  </span>
                                )}
                              </div>
                          </div>
                        </button>

                        <div data-no-drag="true" className="flex items-center gap-1 shrink-0">
                          {trk.durationSec ? (
                            <span className="font-mono text-[11px] text-slate-400 dark:text-zinc-500 tabular-nums pr-0.5">
                              {fmtTrackDuration(trk.durationSec)}
                            </span>
                          ) : null}
                          {onOpenTrackDetails && (
                            <button
                              type="button"
                              onClick={() => onOpenTrackDetails(trk.id)}
                              title="Ouvrir la page du son"
                              aria-label="Ouvrir la page du son"
                              className="p-2 rounded-full text-slate-400 hover:text-slate-800 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-900 cursor-pointer"
                            >
                              <ChevronRight size={16} />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setOpenTrackMenuId(menuOpen ? null : trk.id);
                            }}
                            className="p-2 rounded-full text-slate-400 hover:text-slate-800 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-900 cursor-pointer"
                          >
                            <MoreHorizontal size={16} />
                          </button>
                        </div>
                      </div>

                      {menuOpen && (
                        <div data-no-drag="true" className="mt-2 ml-9 space-y-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {onOpenTrackDetails && (
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenTrackMenuId(null);
                                  onOpenTrackDetails(trk.id);
                                }}
                                className="inline-flex items-center gap-1 rounded-lg bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25 px-2.5 py-1 text-[11px] font-semibold cursor-pointer"
                              >
                                Page du son
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                player.addToQueue(trk, 'end');
                                setOpenTrackMenuId(null);
                              }}
                              className="inline-flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-zinc-900 text-slate-600 dark:text-zinc-300 px-2.5 py-1 text-[11px] font-medium cursor-pointer"
                            >
                              <ListPlus size={11} /> + File d’attente
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (renamingTrackId === trk.id) {
                                  setRenamingTrackId(null);
                                } else {
                                  setRenamingTrackId(trk.id);
                                  setRenameDraft(trk.manualGroupTitle || trk.title);
                                }
                              }}
                              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium cursor-pointer transition ${
                                renamingTrackId === trk.id
                                  ? 'bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25'
                                  : 'bg-slate-100 dark:bg-zinc-900 text-slate-600 dark:text-zinc-300'
                              }`}
                            >
                              <Pencil size={11} /> Renommer
                            </button>
                            <button
                              type="button"
                              onClick={() => handleBenchTrack(trk.id)}
                              className="inline-flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:text-zinc-300 hover:text-slate-900 dark:hover:text-zinc-100 cursor-pointer"
                              title="Mettre ce morceau de côté (hors tracklist principale)"
                            >
                              <Archive size={11} /> De côté
                            </button>
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => handleMoveTrack(idx, -1)}
                              className="inline-flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:text-zinc-300 disabled:opacity-30 cursor-pointer"
                            >
                              <ChevronUp size={12} /> Monter
                            </button>
                            <button
                              type="button"
                              disabled={idx === projectTracks.length - 1}
                              onClick={() => handleMoveTrack(idx, 1)}
                              className="inline-flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:text-zinc-300 disabled:opacity-30 cursor-pointer"
                            >
                              <ChevronDown size={12} /> Descendre
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveTrackFromProject(trk.id)}
                              className="inline-flex items-center gap-1 rounded-lg bg-rose-50 dark:bg-rose-950/40 px-2.5 py-1 text-[11px] font-medium text-rose-600 dark:text-rose-400 cursor-pointer"
                            >
                              <X size={12} /> Retirer
                            </button>
                          </div>

                          {renamingTrackId === trk.id && (
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                const clean = renameDraft.trim();
                                if (!clean) return;
                                const allGroups = groupMusicTracks(state.musicTracks);
                                const grp = allGroups.find((g) => g.allTrackIds.includes(trk.id));
                                const ids =
                                  grp && grp.allTrackIds.length > 0 ? grp.allTrackIds : [trk.id];
                                renameTrackGroup(ids, clean);
                                notify(`Morceau renommé en « ${clean} » ✓`);
                                setRenamingTrackId(null);
                                setOpenTrackMenuId(null);
                              }}
                              className="flex items-center gap-1.5 max-w-sm"
                            >
                              <input
                                autoFocus
                                type="text"
                                value={renameDraft}
                                onChange={(e) => setRenameDraft(e.target.value)}
                                placeholder="Nouveau nom du morceau…"
                                className="flex-1 min-w-0 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-zinc-100 outline-none focus:border-slate-400"
                              />
                              <button
                                type="submit"
                                className="rounded-lg bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25 px-3 py-1.5 text-xs font-semibold cursor-pointer shrink-0"
                              >
                                OK
                              </button>
                              <button
                                type="button"
                                onClick={() => setRenamingTrackId(null)}
                                className="rounded-lg px-2 py-1.5 text-xs text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer shrink-0"
                              >
                                <X size={13} />
                              </button>
                            </form>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Ultra-Discreet Collapsible "Mis de côté" (Maybe / Bench) Drawer */}
            {benchTracks.length > 0 && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setShowBench((v) => !v)}
                  className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-400/80 dark:text-zinc-500 hover:text-slate-600 dark:hover:text-zinc-300 transition cursor-pointer"
                >
                  <Archive size={11} className="opacity-70" />
                  <span>Backlog / Mis de côté ({benchTracks.length})</span>
                  {showBench ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>

                <AnimatePresence>
                  {showBench && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-2 rounded-2xl border border-dashed border-slate-200/80 dark:border-zinc-800/80 bg-slate-50/40 dark:bg-zinc-900/25 divide-y divide-slate-100/80 dark:divide-zinc-800/60 px-3">
                        {benchTracks.map((trk) => {
                          const isCur = player.currentTrack?.id === trk.id;
                          const playing = isCur && player.isPlaying;
                          const trkGroup = allGroups.find((g) => g.allTrackIds.includes(trk.id));
                          const trkRatings = resolveTrackRatings(
                            trk,
                            trkGroup?.versions.map((v) => v.track)
                          );
                          return (
                            <div
                              key={trk.id}
                              onContextMenu={(e) => {
                                if (!trkGroup || !onOpenContextMenu) return;
                                e.preventDefault();
                                e.stopPropagation();
                                onOpenContextMenu(e, trkGroup, trk.id, null);
                              }}
                              className="py-2.5 flex items-center justify-between gap-2 opacity-75 hover:opacity-100 transition"
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  isCur
                                    ? player.togglePlay()
                                    : void player.playTrack(trk, 0, [trk])
                                }
                                className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer"
                              >
                                <span className="h-6 w-6 rounded-full bg-slate-200/70 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 flex items-center justify-center shrink-0">
                                  {playing ? (
                                    <Pause size={10} fill="currentColor" />
                                  ) : (
                                    <Play size={10} fill="currentColor" className="ml-0.5" />
                                  )}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-medium text-slate-700 dark:text-zinc-300 truncate">
                                    {trk.manualGroupTitle || trk.title}
                                  </p>
                                  {(trkRatings.current !== null || trkRatings.potential !== null) && (
                                    <span className="font-mono text-[10px] text-slate-400">
                                      {trkRatings.current !== null ? trkRatings.current : ''}
                                      {trkRatings.current !== null && trkRatings.potential !== null
                                        ? ' · '
                                        : ''}
                                      {trkRatings.potential !== null
                                        ? `↗${trkRatings.potential}`
                                        : ''}
                                    </span>
                                  )}
                                </div>
                              </button>

                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => handleRestoreFromBench(trk.id)}
                                  title="Remettre dans la tracklist"
                                  className="inline-flex items-center gap-1 rounded-lg bg-slate-200/70 dark:bg-zinc-800 px-2 py-1 text-[10px] font-semibold text-slate-700 dark:text-zinc-200 hover:bg-[#8C271E] hover:text-white transition cursor-pointer"
                                >
                                  <ArrowUp size={10} /> Remettre
                                </button>
                                {onOpenTrackDetails && (
                                  <button
                                    type="button"
                                    onClick={() => onOpenTrackDetails(trk.id)}
                                    title="Page du son"
                                    className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer"
                                  >
                                    <ChevronRight size={13} />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleRemoveFromBench(trk.id)}
                                  title="Retirer définitivement"
                                  className="p-1.5 rounded-full text-slate-400 hover:text-rose-500 cursor-pointer"
                                >
                                  <X size={12} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* Integrated Project TODO Checklist */}
            <section
              ref={todoSectionRef}
              className="pt-4 border-t border-slate-100 dark:border-zinc-900 space-y-3"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <ListChecks size={14} /> TODO du projet
                </h3>
                <span className="font-mono text-xs font-semibold text-slate-700 dark:text-zinc-300">
                  {doneSteps}/{totalSteps} ({todoPct}%)
                </span>
              </div>

              <div className="h-1.5 rounded-full bg-slate-100 dark:bg-zinc-900 overflow-hidden">
                <div
                  className="h-full bg-[#8C271E] rounded-full transition-all duration-300"
                  style={{ width: `${todoPct}%` }}
                />
              </div>

              <div className="space-y-1">
                {project.steps.map((step) => (
                  <div
                    key={step.id}
                    className="group flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-slate-50 dark:hover:bg-zinc-900/60"
                  >
                    <CheckCircle
                      checked={step.done}
                      onToggle={() => toggleMusicProjectStep(project.id, step.id)}
                      accent="violet"
                      size="sm"
                    />
                    <span
                      className={`flex-1 text-sm ${
                        step.done ? 'line-through text-slate-400' : 'text-slate-800 dark:text-zinc-200'
                      }`}
                    >
                      {step.label}
                    </span>
                    <button
                      type="button"
                      onClick={() => deleteMusicProjectStep(project.id, step.id)}
                      className="opacity-60 sm:opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-500 cursor-pointer"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}

                {/* Automatic Roll-Up of ALL active tracks' TODOs */}
                {rolledUpTrackTodos.length > 0 && (
                  <div className="pt-2 mt-2 border-t border-slate-100 dark:border-zinc-900 space-y-1">
                    <p className="px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      Tâches des titres actifs ({rolledUpTrackTodos.filter((t) => t.done).length}/
                      {rolledUpTrackTodos.length})
                    </p>
                    {rolledUpTrackTodos.map((item) => (
                      <div
                        key={`${item.trackId}-${item.todoId}`}
                        className="flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-zinc-900/60"
                      >
                        <CheckCircle
                          checked={item.done}
                          onToggle={() => toggleMusicTrackTodo(item.trackId, item.todoId)}
                          accent="violet"
                          size="sm"
                        />
                        <span
                          className={`flex-1 text-xs ${
                            item.done
                              ? 'line-through text-slate-400'
                              : 'text-slate-700 dark:text-zinc-200'
                          }`}
                        >
                          {item.label}
                        </span>
                        <button
                          type="button"
                          onClick={() => onOpenTrackDetails?.(item.trackId)}
                          className="rounded-full bg-slate-100 dark:bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100 truncate max-w-[110px] cursor-pointer shrink-0"
                        >
                          {item.trackTitle}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <form onSubmit={handleAddTodo} className="flex items-center gap-2 pt-1">
                <input
                  type="text"
                  value={todoInput}
                  onChange={(e) => setTodoInput(e.target.value)}
                  placeholder="+ Ajouter une tâche globale au projet…"
                  className="flex-1 rounded-2xl bg-slate-100 dark:bg-zinc-900 px-3.5 py-2.5 text-xs outline-none focus:ring-2 focus:ring-slate-900/15 dark:focus:ring-zinc-100/20"
                />
                {todoInput.trim() && (
                  <button
                    type="submit"
                    className="rounded-2xl bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25 px-4 py-2.5 text-xs font-semibold cursor-pointer"
                  >
                    Ajouter
                  </button>
                )}
              </form>
            </section>
              </>
            )}
          </div>
        </div>

        <AppleConfirmDialog
          open={confirmDeleteOpen}
          title={`Supprimer « ${project.title} » ?`}
          description="Le projet et sa TODO seront supprimés. Tes fichiers MP3 et tes sons resteront intacts dans ta bibliothèque."
          confirmLabel="Supprimer"
          destructive
          onConfirm={() => {
            deleteMusicProject(project.id);
            onClose();
          }}
          onCancel={() => setConfirmDeleteOpen(false)}
        />
      </motion.div>
    </AnimatePresence>
  );
}
