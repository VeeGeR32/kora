import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useMotionValue, animate } from 'framer-motion';
import {
  ChevronDown,
  Disc3,
  FileText,
  ListMusic,
  Loader2,
  Monitor,
  Music2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Share2,
  Shuffle,
  SkipBack,
  SkipForward,
  Smartphone,
  Star,
  Tablet,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAudioPlayer } from '../../context/AudioPlayerContext';
import { getMediaObjectUrl } from '../../lib/mediaDb';
import { triggerHapticTick } from '../../lib/haptics';
import { shareOrCopyPublicLink } from '../../lib/publicShare';
import { groupMusicTracks, parseTrackVersion } from '../../lib/musicVersioning';
import {
  findLinkedLyricsForTrack,
  findLinkedProjectForTrack,
  resolveEffectiveTrackCover,
} from '../../lib/trackCover';
import { parseLyricLines } from './LyricLinesEditor';
import type { MusicTrack } from '../../types';

export const PROJECT_GRADIENTS: { id: string; label: string; css: string }[] = [
  { id: 'pink', label: 'Rowav Crimson', css: 'from-[#B83529] via-[#8C271E] to-[#4A120D]' },
  { id: 'violet', label: 'Carbon Slate', css: 'from-zinc-500 via-zinc-700 to-zinc-900' },
  { id: 'emerald', label: 'Emerald Studio', css: 'from-emerald-500 via-teal-700 to-zinc-900' },
  { id: 'amber', label: 'Warm Bronze', css: 'from-amber-400 via-orange-600 to-stone-900' },
  { id: 'sky', label: 'Deep Ocean', css: 'from-sky-500 via-slate-700 to-zinc-950' },
  { id: 'midnight', label: 'Obsidian', css: 'from-zinc-700 via-zinc-900 to-black' },
];

export function getGradientClass(id?: string): string {
  return PROJECT_GRADIENTS.find((g) => g.id === id)?.css || PROJECT_GRADIENTS[0].css;
}

function fmt(sec: number) {
  if (!sec || !isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function MiniAudioPlayer() {
  const { state, setTrackGroupFavorite, notify } = useApp();
  const {
    currentTrack,
    queue,
    isPlaying,
    isLoadingTrack,
    currentTime,
    duration,
    repeatMode,
    shuffle,
    expanded,
    hasNext,
    hasPrev,
    getLiveTime,
    playTrack,
    playNext,
    playPrev,
    togglePlay,
    seek,
    cycleRepeatMode,
    toggleShuffle,
    setExpanded,
    closePlayer,
    requestOpenTrackPage,
    localDevice,
    remoteDevice,
    isRemotePlayback,
    transferToThisDevice,
  } = useAudioPlayer();

  const [blobCoverUrl, setBlobCoverUrl] = useState<string | null>(null);
  const [showQueue, setShowQueue] = useState(false);
  const [desktopSideTab, setDesktopSideTab] = useState<'queue' | 'lyrics'>('queue');
  const [scrubbing, setScrubbing] = useState(false);

  // Direction of track switch for Spotify-style horizontal slide transition (+1 = Next, -1 = Prev)
  const [slideDir, setSlideDir] = useState<1 | -1>(1);
  const prevTrackIdRef = useRef<string | null>(null);
  const pendingDirRef = useRef<1 | -1 | null>(null);

  // Direct GPU DOM refs updated at 60/120fps (ZERO React re-renders during playback or scrubbing!)
  const progressFillRef = useRef<HTMLDivElement>(null);
  const progressThumbRef = useRef<HTMLDivElement>(null);
  const miniProgressFillRef = useRef<HTMLDivElement>(null);
  const timeCurrentRef = useRef<HTMLSpanElement>(null);
  const timeTotalRef = useRef<HTMLSpanElement>(null);
  const miniSwipeContentRef = useRef<HTMLDivElement>(null);
  const expandedCoverDragRef = useRef<HTMLDivElement>(null);

  // Single continuous Framer Motion value for sheet vertical drag-to-minimize (eliminates cover flicker/jump!)
  const sheetY = useMotionValue(0);

  const scrubTimeRef = useRef(0);
  const scrubbingRef = useRef(false);
  const scrubDragRef = useRef<{ pointerId: number } | null>(null);

  const miniSwipeRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    dx: number;
    swiping: boolean;
  } | null>(null);
  const miniWheelCooldownRef = useRef(0);

  // Unified expanded-player gesture state (locks cleanly to EITHER vertical minimize OR horizontal track switch!)
  const sheetGestureRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startTs: number;
    axis: 'none' | 'x' | 'y';
    dx: number;
    dy: number;
    allowHorizontal: boolean;
  } | null>(null);
  const sheetWheelCooldownRef = useRef(0);
  const justDraggedRef = useRef(false);

  const allGroups = useMemo(() => groupMusicTracks(state.musicTracks), [state.musicTracks]);

  const currentGroup = useMemo(() => {
    if (!currentTrack) return null;
    return allGroups.find((g) => g.allTrackIds.includes(currentTrack.id)) || null;
  }, [currentTrack?.id, allGroups]);

  const siblingTracks = useMemo(
    () => (currentGroup ? currentGroup.versions.map((v) => v.track) : undefined),
    [currentGroup]
  );

  // Determine adjacent prev/next tracks in queue for Spotify peeking covers during horizontal drag
  const { prevQueueTrack, nextQueueTrack } = useMemo(() => {
    if (!currentTrack || queue.length <= 1) {
      return { prevQueueTrack: null as MusicTrack | null, nextQueueTrack: null as MusicTrack | null };
    }
    const idx = queue.findIndex((t) => t.id === currentTrack.id);
    if (idx < 0) return { prevQueueTrack: null, nextQueueTrack: null };
    const prevT = idx > 0 ? queue[idx - 1] : queue[queue.length - 1];
    const nextT = idx < queue.length - 1 ? queue[idx + 1] : repeatMode === 'all' ? queue[0] : null;
    return {
      prevQueueTrack: prevT && prevT.id !== currentTrack.id ? prevT : null,
      nextQueueTrack: nextT && nextT.id !== currentTrack.id ? nextT : null,
    };
  }, [currentTrack?.id, queue, repeatMode]);

  // Infer slide direction cleanly whenever currentTrack.id changes
  useEffect(() => {
    const curId = currentTrack?.id || null;
    if (!curId) {
      prevTrackIdRef.current = null;
      return;
    }
    if (prevTrackIdRef.current && prevTrackIdRef.current !== curId) {
      if (pendingDirRef.current) {
        setSlideDir(pendingDirRef.current);
        pendingDirRef.current = null;
      } else {
        const prevIdx = queue.findIndex((t) => t.id === prevTrackIdRef.current);
        const curIdx = queue.findIndex((t) => t.id === curId);
        if (prevIdx >= 0 && curIdx >= 0) {
          setSlideDir(curIdx >= prevIdx ? 1 : -1);
        } else {
          setSlideDir(1);
        }
      }
    }
    prevTrackIdRef.current = curId;
  }, [currentTrack?.id, queue]);

  // Reset sheetY cleanly whenever expanded toggles on
  useLayoutEffect(() => {
    if (expanded) {
      sheetY.set(0);
    }
  }, [expanded, sheetY]);

  const linkedProject = useMemo(
    () =>
      currentTrack
        ? findLinkedProjectForTrack(currentTrack, state.musicProjects, siblingTracks)
        : null,
    [currentTrack, state.musicProjects, siblingTracks]
  );

  const linkedLyrics = useMemo(
    () =>
      currentTrack
        ? findLinkedLyricsForTrack(
            currentTrack,
            state.lyricsDocs,
            currentGroup?.allTrackIds,
            siblingTracks
          )
        : null,
    [currentTrack, state.lyricsDocs, currentGroup?.allTrackIds, siblingTracks]
  );

  const desktopLyricsLines = useMemo(
    () => (linkedLyrics?.content ? parseLyricLines(linkedLyrics.content) : []),
    [linkedLyrics?.content]
  );

  const effectiveCover = useMemo(
    () =>
      currentTrack
        ? resolveEffectiveTrackCover(
            currentTrack,
            state.musicProjects,
            currentGroup?.groupKey,
            siblingTracks
          )
        : null,
    [currentTrack, state.musicProjects, currentGroup?.groupKey, siblingTracks]
  );

  const resolveSimpleCover = useCallback(
    (trk: MusicTrack | null) => {
      if (!trk) return null;
      const grp = allGroups.find((g) => g.allTrackIds.includes(trk.id));
      const eff = resolveEffectiveTrackCover(
        trk,
        state.musicProjects,
        grp?.groupKey,
        grp?.versions.map((v) => v.track)
      );
      return {
        url: eff.coverDataUrl || eff.cloudCoverUrl || null,
        grad: getGradientClass(eff.gradientId),
      };
    },
    [allGroups, state.musicProjects]
  );

  const prevPeekCover = useMemo(() => resolveSimpleCover(prevQueueTrack), [prevQueueTrack, resolveSimpleCover]);
  const nextPeekCover = useMemo(() => resolveSimpleCover(nextQueueTrack), [nextQueueTrack, resolveSimpleCover]);

  useEffect(() => {
    let active = true;
    if (effectiveCover && !effectiveCover.coverDataUrl && effectiveCover.coverMediaId) {
      getMediaObjectUrl(effectiveCover.coverMediaId).then((url) => {
        if (active) setBlobCoverUrl(url);
      });
    } else {
      setBlobCoverUrl(null);
    }
    return () => {
      active = false;
    };
  }, [effectiveCover?.coverDataUrl, effectiveCover?.coverMediaId]);

  const coverUrl =
    effectiveCover?.coverDataUrl || blobCoverUrl || effectiveCover?.cloudCoverUrl || null;

  const effectiveDuration = duration || currentTrack?.durationSec || 0;

  // Lightweight 60/120fps Spotify progress bar updater (pure GPU scaleX + left%, ZERO clip-path / ZERO waveform DOM!)
  const applyVisualFrame = useCallback((t: number, dur: number) => {
    const r = dur > 0 ? Math.min(1, Math.max(0, t / dur)) : 0;
    const scaleX = `scaleX(${r.toFixed(4)})`;
    const leftPct = `${(r * 100).toFixed(3)}%`;

    if (progressFillRef.current) progressFillRef.current.style.transform = scaleX;
    if (progressThumbRef.current) progressThumbRef.current.style.left = leftPct;
    if (miniProgressFillRef.current) miniProgressFillRef.current.style.transform = scaleX;

    const curLabel = fmt(t);
    const totalLabel = dur > 0 ? fmt(dur) : '—';
    if (timeCurrentRef.current && timeCurrentRef.current.textContent !== curLabel) {
      timeCurrentRef.current.textContent = curLabel;
    }
    if (timeTotalRef.current && timeTotalRef.current.textContent !== totalLabel) {
      timeTotalRef.current.textContent = totalLabel;
    }
  }, []);

  useLayoutEffect(() => {
    if (!currentTrack) return;
    applyVisualFrame(scrubbingRef.current ? scrubTimeRef.current : getLiveTime(), effectiveDuration);
  }, [currentTrack?.id, expanded, effectiveDuration, isPlaying, getLiveTime, applyVisualFrame]);

  useEffect(() => {
    if (!currentTrack || !isPlaying) return;
    let rafId = 0;
    const tick = () => {
      if (!scrubbingRef.current) {
        applyVisualFrame(getLiveTime(), effectiveDuration);
      }
      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [currentTrack?.id, isPlaying, expanded, effectiveDuration, getLiveTime, applyVisualFrame]);

  const gradCls = getGradientClass(
    effectiveCover?.gradientId || currentTrack?.coverGradient || linkedProject?.coverGradient
  );
  const parsedCurrent = useMemo(
    () => (currentTrack ? parseTrackVersion(currentTrack) : null),
    [currentTrack]
  );

  const alternateProdOrSong = useMemo(() => {
    if (!currentTrack || !parsedCurrent || !currentGroup?.prodTrack) return null;
    if (parsedCurrent.isProd) {
      if (currentGroup.latestTrack.id === currentTrack.id) return null;
      return { target: currentGroup.latestTrack, label: 'Son', isCurrentlyProd: true };
    }
    return { target: currentGroup.prodTrack, label: 'Prod', isCurrentlyProd: false };
  }, [currentTrack, parsedCurrent, currentGroup]);

  const displayTrackTitle =
    currentGroup?.baseTitle ||
    currentTrack?.manualGroupTitle ||
    parsedCurrent?.baseTitle ||
    currentTrack?.title ||
    '';
  const versionSuffix =
    parsedCurrent && parsedCurrent.versionLabel !== 'Original' ? parsedCurrent.versionLabel : '';
  const subtitle = [
    versionSuffix,
    linkedProject?.title,
    state.preferences.name || currentTrack?.artist || 'Moi',
  ]
    .filter(Boolean)
    .join(' · ');

  const canPlay = Boolean(
    isRemotePlayback ||
      currentTrack?.mediaId ||
      currentTrack?.cloudAudioUrl ||
      currentTrack?.googleDriveFileId
  );

  const triggerNext = useCallback(() => {
    if (!hasNext) return;
    pendingDirRef.current = 1;
    setSlideDir(1);
    playNext();
    triggerHapticTick(10);
  }, [hasNext, playNext]);

  const triggerPrev = useCallback(() => {
    if (!hasPrev && getLiveTime() <= 3) return;
    pendingDirRef.current = -1;
    setSlideDir(-1);
    playPrev();
    triggerHapticTick(10);
  }, [hasPrev, getLiveTime, playPrev]);

  // Spotify-style linear progress bar scrubbing (click or drag anywhere)
  const computeScrubTime = (el: HTMLDivElement, clientX: number, dur: number) => {
    const rect = el.getBoundingClientRect();
    if (!rect.width) return 0;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * dur;
  };

  const handleBarPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!effectiveDuration) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const nextSec = computeScrubTime(e.currentTarget, e.clientX, effectiveDuration);
    scrubDragRef.current = { pointerId: e.pointerId };
    scrubTimeRef.current = nextSec;
    scrubbingRef.current = true;
    setScrubbing(true);
    applyVisualFrame(nextSec, effectiveDuration);
    triggerHapticTick(8);
  };

  const handleBarPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = scrubDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId || !effectiveDuration) return;
    const nextSec = computeScrubTime(e.currentTarget, e.clientX, effectiveDuration);
    scrubTimeRef.current = nextSec;
    applyVisualFrame(nextSec, effectiveDuration);
  };

  const finishBarDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = scrubDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    scrubDragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const targetSec = scrubTimeRef.current;
    scrubbingRef.current = false;
    setScrubbing(false);
    seek(targetSec);
    applyVisualFrame(targetSec, effectiveDuration);
  };

  // ================= MINI-PLAYER SWIPE (LEFT = NEXT · RIGHT = PREV · TAP = EXPAND) =================
  const handleMiniPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button[data-mini-ctrl]')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    miniSwipeRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      dx: 0,
      swiping: false,
    };
  };

  const handleMiniPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = miniSwipeRef.current;
    if (!s || s.pointerId !== e.pointerId) return;
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    if (!s.swiping && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
      s.swiping = true;
    }
    if (s.swiping) {
      s.dx = dx;
      const clamped = Math.max(-72, Math.min(72, dx * 0.72));
      const opacity = Math.max(0.45, 1 - Math.abs(clamped) / 150);
      if (miniSwipeContentRef.current) {
        miniSwipeContentRef.current.style.transition = 'none';
        miniSwipeContentRef.current.style.transform = `translate3d(${clamped.toFixed(1)}px, 0, 0)`;
        miniSwipeContentRef.current.style.opacity = opacity.toFixed(2);
      }
    }
  };

  const finishMiniSwipe = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = miniSwipeRef.current;
    if (!s || s.pointerId !== e.pointerId) return;
    miniSwipeRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (miniSwipeContentRef.current) {
      miniSwipeContentRef.current.style.transition =
        'transform 180ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease-out';
      miniSwipeContentRef.current.style.transform = 'translate3d(0, 0, 0)';
      miniSwipeContentRef.current.style.opacity = '1';
    }
    if (s.swiping) {
      if (s.dx < -38 && hasNext) {
        triggerNext();
      } else if (s.dx > 38 && (hasPrev || getLiveTime() > 3)) {
        triggerPrev();
      }
    } else {
      setShowQueue(false);
      setExpanded(true);
    }
  };

  const handleMiniWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || Math.abs(e.deltaX) < 22) return;
    const now = Date.now();
    if (now - miniWheelCooldownRef.current < 420) return;
    miniWheelCooldownRef.current = now;
    if (e.deltaX > 0 && hasNext) triggerNext();
    else if (e.deltaX < 0 && (hasPrev || getLiveTime() > 3)) triggerPrev();
  };

  // ================= MAXIMIZED PLAYER GESTURES (HORIZONTAL = SPOTIFY SWITCH · VERTICAL DOWN = MINIMIZE) =================
  const handleSheetPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-no-sheet-drag]')) return;
    const queueScrollEl = target.closest('[data-queue-scroll]') as HTMLElement | null;
    if (queueScrollEl && queueScrollEl.scrollTop > 0) return;

    const allowHorizontal = Boolean(target.closest('[data-cover-swipe]')) && !showQueue;
    sheetGestureRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startTs: performance.now(),
      axis: 'none',
      dx: 0,
      dy: 0,
      allowHorizontal,
    };
  };

  const handleSheetPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = sheetGestureRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;

    if (g.axis === 'none') {
      if (g.allowHorizontal && Math.abs(dx) > 9 && Math.abs(dx) > Math.abs(dy) * 1.15) {
        g.axis = 'x';
      } else if (dy > 10 && dy > Math.abs(dx) * 1.15) {
        g.axis = 'y';
      }
    }

    if (g.axis === 'x') {
      g.dx = dx;
      const damp = dx > 0 && !hasPrev && getLiveTime() <= 3 ? 0.25 : dx < 0 && !hasNext ? 0.25 : 0.88;
      const offset = Math.max(-240, Math.min(240, dx * damp));
      if (expandedCoverDragRef.current) {
        expandedCoverDragRef.current.style.transition = 'none';
        expandedCoverDragRef.current.style.transform = `translate3d(${offset.toFixed(1)}px, 0, 0)`;
      }
    } else if (g.axis === 'y') {
      g.dy = Math.max(0, dy);
      sheetY.set(g.dy);
    }
  };

  const finishSheetGesture = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = sheetGestureRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    sheetGestureRef.current = null;
    if (g.axis === 'none') return;

    justDraggedRef.current = true;
    window.setTimeout(() => {
      justDraggedRef.current = false;
    }, 140);

    const elapsed = Math.max(1, performance.now() - g.startTs);

    if (g.axis === 'x') {
      const velocityX = Math.abs(g.dx) / elapsed;
      const shouldNext = (g.dx < -55 || (g.dx < -28 && velocityX > 0.45)) && hasNext;
      const shouldPrev = (g.dx > 55 || (g.dx > 28 && velocityX > 0.45)) && (hasPrev || getLiveTime() > 3);

      if (expandedCoverDragRef.current) {
        expandedCoverDragRef.current.style.transition =
          'transform 200ms cubic-bezier(0.22, 1, 0.36, 1)';
        expandedCoverDragRef.current.style.transform = 'translate3d(0, 0, 0)';
      }

      if (shouldNext) triggerNext();
      else if (shouldPrev) triggerPrev();
      return;
    }

    if (g.axis === 'y') {
      const velocityY = g.dy / elapsed;
      if (g.dy > 95 || (g.dy > 36 && velocityY > 0.45)) {
        triggerHapticTick(8);
        setExpanded(false);
      } else {
        void animate(sheetY, 0, { duration: 0.2, ease: [0.22, 1, 0.36, 1] });
      }
    }
  };

  const handleSheetWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-queue-scroll]')) return;
    const now = Date.now();
    if (now - sheetWheelCooldownRef.current < 400) return;

    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 26) {
      sheetWheelCooldownRef.current = now;
      if (e.deltaX > 0 && hasNext) triggerNext();
      else if (e.deltaX < 0 && (hasPrev || getLiveTime() > 3)) triggerPrev();
    } else if (e.deltaY > 42 && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      sheetWheelCooldownRef.current = now;
      setExpanded(false);
    }
  };

  const handleOpenTrackPageFromCover = () => {
    if (!currentTrack || justDraggedRef.current) return;
    triggerHapticTick(8);
    setExpanded(false);
    requestOpenTrackPage(currentTrack.id);
  };

  const isFavorite = currentTrack
    ? currentGroup?.isFavorite ?? Boolean(currentTrack.isFavorite)
    : false;

  const handleToggleFav = () => {
    if (!currentTrack) return;
    const ids =
      currentGroup && currentGroup.allTrackIds.length > 0
        ? currentGroup.allTrackIds
        : [currentTrack.id];
    const nextFav = !isFavorite;
    setTrackGroupFavorite(ids, nextFav);
    triggerHapticTick(8);
    notify(nextFav ? 'Ajouté aux favoris ★' : 'Retiré des favoris');
  };

  return (
    <>
      {/* ================= FLOATING SPOTIFY-STYLE MINI PLAYER ================= */}
      <AnimatePresence>
        {currentTrack && !expanded && (
          <motion.div
            key="rowav-mini-player"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 14 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            onWheel={handleMiniWheel}
            className={`fixed bottom-[calc(4.25rem+env(safe-area-inset-bottom))] md:bottom-4 left-2.5 right-2.5 md:left-64 [[data-sidebar-collapsed=true]_&]:md:left-24 md:right-6 z-[48] max-w-2xl md:mx-auto rounded-2xl bg-white/95 dark:bg-[#171313]/96 text-slate-900 dark:text-white border backdrop-blur-md transition-[bottom,left,border-color] duration-200 overflow-hidden ${
              isRemotePlayback
                ? 'border-emerald-500/40 dark:border-emerald-400/40 shadow-lg shadow-emerald-500/10'
                : 'border-slate-200/90 dark:border-white/10 shadow-lg shadow-black/10 dark:shadow-black/45'
            }`}
          >
            <div className="flex items-center justify-between gap-2 px-2 py-1.5">
              {/* Swipeable Cover + Title (Spotify Horizontal Slide on Switch) */}
              <div
                onPointerDown={handleMiniPointerDown}
                onPointerMove={handleMiniPointerMove}
                onPointerUp={finishMiniSwipe}
                onPointerCancel={finishMiniSwipe}
                style={{ touchAction: 'pan-y' }}
                className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer select-none overflow-hidden"
                title="Glisser gauche/droite pour changer de son · Cliquer pour agrandir"
              >
                <div
                  ref={miniSwipeContentRef}
                  className="min-w-0 flex-1 will-change-transform overflow-hidden"
                >
                  <AnimatePresence mode="popLayout" initial={false} custom={slideDir}>
                    <motion.div
                      key={currentTrack.id}
                      custom={slideDir}
                      initial={{ x: slideDir * 28, opacity: 0 }}
                      animate={{ x: 0, opacity: 1 }}
                      exit={{ x: slideDir * -28, opacity: 0 }}
                      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                      className="flex items-center gap-2.5 min-w-0"
                    >
                      {/* Static crisp square cover (ZERO rotation jump or crop glitch on minimize!) */}
                      <div
                        className={`relative h-10 w-10 rounded-lg overflow-hidden border border-slate-200/70 dark:border-white/10 shrink-0 ${
                          isLoadingTrack ? 'animate-pulse opacity-75' : ''
                        }`}
                      >
                        {coverUrl ? (
                          <img
                            src={coverUrl}
                            alt={displayTrackTitle}
                            draggable={false}
                            className="h-full w-full object-cover pointer-events-none block"
                          />
                        ) : (
                          <div
                            className={`h-full w-full bg-gradient-to-br ${gradCls} flex items-center justify-center`}
                          >
                            <Disc3 size={16} className="text-white/85" />
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-slate-900 dark:text-white truncate leading-tight">
                          {displayTrackTitle}
                        </p>
                        {isLoadingTrack ? (
                          <div className="mt-1.5 h-2 w-20 rounded-full bg-slate-200 dark:bg-white/15 animate-pulse" />
                        ) : isRemotePlayback && remoteDevice ? (
                          <p className="text-[10.5px] font-medium text-emerald-600 dark:text-emerald-400 truncate mt-0.5 flex items-center gap-1">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                            <span className="truncate">{remoteDevice.name}</span>
                          </p>
                        ) : (
                          <p className="text-[11px] text-slate-500 dark:text-zinc-400 truncate mt-0.5">
                            {subtitle}
                          </p>
                        )}
                      </div>
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>

              {/* Compact Spotify Transport Controls */}
              <div className="flex items-center gap-0.5 shrink-0">
                {isRemotePlayback && remoteDevice && (
                  <button
                    type="button"
                    data-mini-ctrl="true"
                    onClick={() => void transferToThisDevice()}
                    title={`Transférer la lecture depuis ${remoteDevice.name} vers ${localDevice.name}`}
                    className="h-7 px-2.5 mr-0.5 rounded-full bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/35 text-emerald-700 dark:text-emerald-300 text-[10px] font-semibold transition cursor-pointer shrink-0"
                  >
                    Ici
                  </button>
                )}

                <button
                  type="button"
                  data-mini-ctrl="true"
                  onClick={triggerPrev}
                  disabled={!hasPrev && currentTime <= 3}
                  aria-label="Précédent"
                  className="hidden sm:flex h-8 w-8 rounded-full items-center justify-center text-slate-600 dark:text-zinc-300 hover:text-slate-950 dark:hover:text-white hover:bg-slate-900/8 dark:hover:bg-white/10 disabled:opacity-30 transition cursor-pointer"
                >
                  <SkipBack size={14} fill="currentColor" />
                </button>

                <button
                  type="button"
                  data-mini-ctrl="true"
                  onClick={togglePlay}
                  disabled={!canPlay || isLoadingTrack}
                  aria-label={isLoadingTrack ? 'Chargement' : isPlaying ? 'Pause' : 'Lecture'}
                  className="h-9 w-9 rounded-full bg-[#8C271E] hover:bg-[#A32E24] text-white flex items-center justify-center active:scale-95 disabled:opacity-70 transition cursor-pointer"
                >
                  {isLoadingTrack ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : isPlaying ? (
                    <Pause size={15} fill="currentColor" />
                  ) : (
                    <Play size={15} fill="currentColor" className="ml-0.5" />
                  )}
                </button>

                <button
                  type="button"
                  data-mini-ctrl="true"
                  onClick={triggerNext}
                  disabled={!hasNext}
                  aria-label="Suivant"
                  className="h-8 w-8 rounded-full flex items-center justify-center text-slate-600 dark:text-zinc-300 hover:text-slate-950 dark:hover:text-white hover:bg-slate-900/8 dark:hover:bg-white/10 disabled:opacity-30 transition cursor-pointer"
                >
                  <SkipForward size={14} fill="currentColor" />
                </button>

                <button
                  type="button"
                  data-mini-ctrl="true"
                  onClick={closePlayer}
                  aria-label="Fermer le lecteur"
                  className="h-7 w-7 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-900/8 dark:hover:bg-white/10 transition cursor-pointer"
                >
                  <X size={13} />
                </button>
              </div>
            </div>

            {/* Ultra-Thin Spotify Hairline Progress Bar along the bottom edge */}
            <div className="h-[2.5px] w-full bg-slate-200/80 dark:bg-white/10 overflow-hidden">
              <div
                ref={miniProgressFillRef}
                style={{ transform: 'scaleX(0)' }}
                className={`h-full w-full origin-left will-change-transform ${
                  isRemotePlayback ? 'bg-emerald-500' : 'bg-[#8C271E] dark:bg-[#E04F42]'
                }`}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ================= ULTRA-LIGHT SPOTIFY-STYLE FULL-SCREEN PLAYER ================= */}
      <AnimatePresence>
        {currentTrack && expanded && (
          <motion.div
            key="rowav-expanded-player"
            style={{ y: sheetY }}
            className="fixed inset-0 z-[60] will-change-transform"
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              style={{ touchAction: 'none' }}
              onPointerDown={handleSheetPointerDown}
              onPointerMove={handleSheetPointerMove}
              onPointerUp={finishSheetGesture}
              onPointerCancel={finishSheetGesture}
              onWheel={handleSheetWheel}
              className="w-full h-full bg-[#faf7f6] dark:bg-[#0d0a0a] text-slate-950 dark:text-white flex flex-col overflow-hidden select-none will-change-transform"
            >
            {/* Ultra-lightweight ambient crimson tint (zero heavy blur-3xl GPU lag!) */}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#8C271E]/[0.08] via-transparent to-transparent dark:from-[#8C271E]/[0.18] dark:via-[#0d0a0a]/60 dark:to-[#0d0a0a]" />

            {/* Responsive Wrapper */}
            <div className="relative z-10 w-full max-w-md lg:max-w-6xl mx-auto flex-1 min-h-0 flex flex-col px-6 lg:px-10 pt-[max(0.75rem,env(safe-area-inset-top))] lg:pt-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] lg:pb-8">
              {/* Top Handle & Header */}
              <div className="space-y-1.5 shrink-0">
                <div className="flex justify-center pt-1 lg:hidden">
                  <div className="h-1 w-9 rounded-full bg-slate-900/15 dark:bg-white/20" />
                </div>

                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setExpanded(false)}
                    aria-label="Réduire le lecteur"
                    className="h-10 w-10 rounded-full flex items-center justify-center text-slate-700 dark:text-white/80 hover:bg-slate-900/8 dark:hover:bg-white/10 transition cursor-pointer"
                  >
                    <ChevronDown size={22} />
                  </button>

                  <div className="min-w-0 flex-1 text-center">
                    <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-zinc-400 truncate">
                      {linkedProject?.title || 'En lecture'}
                    </p>
                  </div>

                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={async () => {
                        if (!currentTrack.googleDriveFileId && !currentTrack.cloudAudioUrl) {
                          notify('Ce son est uniquement local — synchronise-le via Drive pour le partager.');
                          return;
                        }
                        try {
                          const res = await shareOrCopyPublicLink({
                            kind: 'track',
                            id: currentTrack.id,
                            title: currentTrack.title,
                            firebaseConfig: state.preferences.firebaseConfig,
                          });
                          notify(
                            res.method === 'native'
                              ? 'Lien public partagé ✓'
                              : 'Lien public copié ✓ (écoute sans compte)'
                          );
                        } catch (err) {
                          notify(`Partage : ${(err as Error).message}`);
                        }
                      }}
                      title="Partager ce son"
                      aria-label="Partager"
                      className="h-10 w-10 rounded-full inline-flex items-center justify-center text-slate-600 dark:text-white/75 hover:bg-slate-900/8 dark:hover:bg-white/10 transition cursor-pointer"
                    >
                      <Share2 size={17} />
                    </button>
                    <button
                      type="button"
                      onClick={closePlayer}
                      title="Arrêter et fermer"
                      aria-label="Arrêter"
                      className="hidden lg:inline-flex h-10 w-10 rounded-full items-center justify-center text-slate-500 dark:text-zinc-400 hover:bg-slate-900/8 dark:hover:bg-white/10 transition cursor-pointer"
                    >
                      <X size={18} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Main Body */}
              <div className="flex-1 min-h-0 flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)] lg:gap-12 xl:gap-16 lg:items-center lg:py-4">
                {/* LEFT COLUMN: Swipeable Cover Art + Title + Simple Spotify Progress Bar + Transport */}
                <div className="flex-1 min-h-0 flex flex-col justify-between lg:justify-center lg:gap-6 lg:max-w-lg lg:mx-auto lg:w-full">
                  {/* SPOTIFY-STYLE HORIZONTALLY SWIPEABLE COVER CAROUSEL */}
                  <div
                    data-cover-swipe="true"
                    className="flex-1 lg:flex-none flex items-center justify-center py-3 lg:py-0 min-h-0 w-full overflow-hidden"
                  >
                    <div
                      ref={expandedCoverDragRef}
                      className="relative w-full max-w-[330px] sm:max-w-[355px] lg:max-w-[375px] aspect-square will-change-transform"
                    >
                      {/* Peeking Previous Cover (visible only while swiping right!) */}
                      {prevPeekCover && (
                        <div
                          aria-hidden="true"
                          className="pointer-events-none absolute top-3 bottom-3 -left-[92%] w-[88%] rounded-2xl overflow-hidden opacity-45 scale-95 border border-slate-200/60 dark:border-white/10"
                        >
                          {prevPeekCover.url ? (
                            <img src={prevPeekCover.url} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <div className={`h-full w-full bg-gradient-to-br ${prevPeekCover.grad} flex items-center justify-center`}>
                              <Disc3 size={44} className="text-white/40" />
                            </div>
                          )}
                        </div>
                      )}

                      {/* Active Track Cover with Crisp Spotify Horizontal Slide Transition */}
                      <AnimatePresence mode="popLayout" initial={false} custom={slideDir}>
                        <motion.button
                          key={currentTrack.id}
                          type="button"
                          custom={slideDir}
                          initial={{ x: slideDir * 90, opacity: 0, scale: 0.96 }}
                          animate={{ x: 0, opacity: 1, scale: 1 }}
                          exit={{ x: slideDir * -90, opacity: 0, scale: 0.96 }}
                          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                          onClick={handleOpenTrackPageFromCover}
                          title="Glisser gauche/droite pour changer de son · Cliquer pour la page morceau"
                          className={`absolute inset-0 w-full h-full rounded-2xl lg:rounded-3xl overflow-hidden border border-slate-200/80 dark:border-white/10 shadow-xl shadow-black/15 dark:shadow-black/60 active:scale-[0.985] cursor-pointer focus:outline-none ${
                            coverUrl ? '' : `bg-gradient-to-br ${gradCls}`
                          } ${isLoadingTrack ? 'animate-pulse opacity-80' : ''}`}
                        >
                          {coverUrl ? (
                            <img
                              src={coverUrl}
                              alt={displayTrackTitle}
                              draggable={false}
                              className="h-full w-full object-cover select-none pointer-events-none block"
                            />
                          ) : (
                            <div className="h-full w-full flex items-center justify-center">
                              <Disc3 size={64} className="text-white/40" strokeWidth={1.3} />
                            </div>
                          )}
                        </motion.button>
                      </AnimatePresence>

                      {/* Peeking Next Cover (visible only while swiping left!) */}
                      {nextPeekCover && (
                        <div
                          aria-hidden="true"
                          className="pointer-events-none absolute top-3 bottom-3 -right-[92%] w-[88%] rounded-2xl overflow-hidden opacity-45 scale-95 border border-slate-200/60 dark:border-white/10"
                        >
                          {nextPeekCover.url ? (
                            <img src={nextPeekCover.url} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <div className={`h-full w-full bg-gradient-to-br ${nextPeekCover.grad} flex items-center justify-center`}>
                              <Disc3 size={44} className="text-white/40" />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Bottom Controls Stack */}
                  <div className="space-y-4">
                    {/* Title, Subtitle, Son/Prod Pill & Favorite Star (Spotify Layout!) */}
                    <div data-cover-swipe="true" className="flex items-center justify-between gap-2.5">
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <AnimatePresence mode="popLayout" initial={false} custom={slideDir}>
                          <motion.button
                            key={currentTrack.id}
                            type="button"
                            custom={slideDir}
                            initial={{ x: slideDir * 24, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            exit={{ x: slideDir * -24, opacity: 0 }}
                            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                            onClick={handleOpenTrackPageFromCover}
                            className="w-full text-left cursor-pointer group block"
                            title="Ouvrir la page du morceau"
                          >
                            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-950 dark:text-white truncate group-hover:underline">
                              {displayTrackTitle}
                            </h2>
                            <p className="text-xs sm:text-sm text-slate-500 dark:text-zinc-400 truncate mt-0.5">
                              {subtitle}
                            </p>
                          </motion.button>
                        </AnimatePresence>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {alternateProdOrSong && (
                          <button
                            type="button"
                            onClick={() => {
                              void playTrack(alternateProdOrSong.target, 0, queue);
                              triggerHapticTick(8);
                            }}
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer ${
                              alternateProdOrSong.isCurrentlyProd
                                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
                                : 'bg-slate-900/8 dark:bg-white/10 text-slate-700 dark:text-zinc-200 border border-slate-200 dark:border-white/15'
                            }`}
                          >
                            <Music2 size={11} />
                            {alternateProdOrSong.isCurrentlyProd ? 'Son' : 'Prod'}
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={handleToggleFav}
                          aria-label="Favori"
                          className={`h-9 w-9 rounded-full inline-flex items-center justify-center transition cursor-pointer ${
                            isFavorite
                              ? 'text-amber-500 dark:text-amber-400'
                              : 'text-slate-500 dark:text-zinc-400 hover:text-slate-950 dark:hover:text-white hover:bg-slate-900/8 dark:hover:bg-white/10'
                          }`}
                        >
                          <Star size={19} fill={isFavorite ? 'currentColor' : 'none'} />
                        </button>
                      </div>
                    </div>

                    {/* SIMPLE SPOTIFY PROGRESS BAR (Zero waveform bars, ultra-responsive 60fps scrub!) */}
                    <div data-no-sheet-drag="true" className="w-full space-y-1">
                      <div
                        onPointerDown={handleBarPointerDown}
                        onPointerMove={handleBarPointerMove}
                        onPointerUp={finishBarDrag}
                        onPointerCancel={finishBarDrag}
                        style={{ touchAction: 'none' }}
                        className={`group/bar relative w-full h-8 flex items-center cursor-pointer select-none ${
                          isLoadingTrack ? 'opacity-40 pointer-events-none' : ''
                        }`}
                        title="Cliquer ou glisser pour naviguer"
                      >
                        {/* Track Rail */}
                        <div
                          className={`relative w-full rounded-full bg-slate-900/14 dark:bg-white/18 transition-[height] duration-100 overflow-hidden ${
                            scrubbing ? 'h-1.5' : 'h-1 group-hover/bar:h-1.5'
                          }`}
                        >
                          <div
                            ref={progressFillRef}
                            style={{ transform: 'scaleX(0)' }}
                            className="h-full w-full origin-left bg-[#8C271E] dark:bg-[#E04F42] will-change-transform"
                          />
                        </div>

                        {/* Circular Spotify Thumb */}
                        <div
                          ref={progressThumbRef}
                          style={{ left: '0%' }}
                          className={`pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#8C271E] dark:bg-white shadow-sm transition-transform duration-100 will-change-[left] ${
                            scrubbing
                              ? 'h-4 w-4 scale-100'
                              : 'h-3 w-3 scale-90 group-hover/bar:scale-110'
                          }`}
                        />
                      </div>

                      {isLoadingTrack ? (
                        <div className="h-4 flex items-center justify-between">
                          <span className="h-2.5 w-9 rounded-full bg-slate-200 dark:bg-white/15 animate-pulse" />
                          <span className="h-2.5 w-9 rounded-full bg-slate-200 dark:bg-white/15 animate-pulse" />
                        </div>
                      ) : (
                        <div className="flex items-center justify-between font-mono text-[11px] text-slate-500 dark:text-zinc-400 tabular-nums">
                          <span ref={timeCurrentRef}>0:00</span>
                          <span ref={timeTotalRef}>
                            {effectiveDuration > 0 ? fmt(effectiveDuration) : '—'}
                          </span>
                        </div>
                      )}

                      {currentTrack.markers.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          {currentTrack.markers.map((mk) => (
                            <button
                              key={mk.id}
                              type="button"
                              onClick={() => {
                                seek(mk.timeSec);
                                applyVisualFrame(mk.timeSec, effectiveDuration);
                                triggerHapticTick(8);
                              }}
                              className="rounded-full bg-slate-900/8 dark:bg-white/10 hover:bg-slate-900/14 dark:hover:bg-white/18 px-2.5 py-0.5 font-mono text-[10px] text-slate-700 dark:text-zinc-200 transition cursor-pointer"
                            >
                              {fmt(mk.timeSec)} · {mk.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Transport Row (Shuffle · Prev · Play/Pause · Next · Repeat) */}
                    <div className="w-full flex items-center justify-between pt-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          toggleShuffle();
                          triggerHapticTick(8);
                        }}
                        aria-label="Aléatoire"
                        className={`relative h-11 w-11 rounded-full flex items-center justify-center transition cursor-pointer ${
                          shuffle
                            ? 'text-[#8C271E] dark:text-[#E04F42]'
                            : 'text-slate-500 dark:text-zinc-400 hover:text-slate-950 dark:hover:text-white'
                        }`}
                      >
                        <Shuffle size={18} />
                        {shuffle && (
                          <span className="absolute bottom-1.5 h-1 w-1 rounded-full bg-[#8C271E] dark:bg-[#E04F42]" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={triggerPrev}
                        disabled={!hasPrev && currentTime <= 3}
                        aria-label="Précédent"
                        className="h-12 w-12 rounded-full flex items-center justify-center text-slate-900 dark:text-white active:scale-90 disabled:opacity-30 transition cursor-pointer"
                      >
                        <SkipBack size={25} fill="currentColor" />
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          togglePlay();
                          triggerHapticTick(8);
                        }}
                        disabled={!canPlay || isLoadingTrack}
                        aria-label={isLoadingTrack ? 'Chargement' : isPlaying ? 'Pause' : 'Lecture'}
                        className="h-16 w-16 rounded-full bg-[#8C271E] hover:bg-[#A32E24] text-white flex items-center justify-center active:scale-95 disabled:opacity-75 transition shadow-md shadow-[#8C271E]/25 cursor-pointer"
                      >
                        {isLoadingTrack ? (
                          <Loader2 size={24} className="animate-spin" />
                        ) : isPlaying ? (
                          <Pause size={26} fill="currentColor" />
                        ) : (
                          <Play size={26} fill="currentColor" className="ml-1" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={triggerNext}
                        disabled={!hasNext}
                        aria-label="Suivant"
                        className="h-12 w-12 rounded-full flex items-center justify-center text-slate-900 dark:text-white active:scale-90 disabled:opacity-30 transition cursor-pointer"
                      >
                        <SkipForward size={25} fill="currentColor" />
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          cycleRepeatMode();
                          triggerHapticTick(8);
                        }}
                        aria-label="Mode boucle"
                        className={`relative h-11 w-11 rounded-full flex items-center justify-center transition cursor-pointer ${
                          repeatMode !== 'off'
                            ? 'text-[#8C271E] dark:text-[#E04F42]'
                            : 'text-slate-500 dark:text-zinc-400 hover:text-slate-950 dark:hover:text-white'
                        }`}
                      >
                        {repeatMode === 'one' ? <Repeat1 size={18} /> : <Repeat size={18} />}
                        {repeatMode !== 'off' && (
                          <span className="absolute bottom-1.5 h-1 w-1 rounded-full bg-[#8C271E] dark:bg-[#E04F42]" />
                        )}
                      </button>
                    </div>

                    {/* Slim Connect Device Pill + Mobile Queue/Close Row */}
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <div
                        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 min-w-0 ${
                          isRemotePlayback && remoteDevice
                            ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                            : 'border-slate-200/80 dark:border-white/10 bg-white/70 dark:bg-white/[0.04] text-slate-500 dark:text-zinc-400'
                        }`}
                      >
                        {isRemotePlayback && remoteDevice ? (
                          <>
                            {remoteDevice.type === 'mobile' ? (
                              <Smartphone size={13} className="shrink-0" />
                            ) : remoteDevice.type === 'tablet' ? (
                              <Tablet size={13} className="shrink-0" />
                            ) : (
                              <Monitor size={13} className="shrink-0" />
                            )}
                            <span className="text-[11px] font-semibold truncate">
                              {remoteDevice.name}
                            </span>
                            <button
                              type="button"
                              onClick={() => void transferToThisDevice()}
                              className="ml-1 rounded-full bg-emerald-600 text-white px-2 py-0.5 text-[10px] font-bold cursor-pointer shrink-0"
                            >
                              Ici
                            </button>
                          </>
                        ) : (
                          <>
                            {localDevice.type === 'mobile' ? (
                              <Smartphone size={12} className="shrink-0" />
                            ) : localDevice.type === 'tablet' ? (
                              <Tablet size={12} className="shrink-0" />
                            ) : (
                              <Monitor size={12} className="shrink-0" />
                            )}
                            <span className="text-[11px] font-medium truncate">
                              {localDevice.name}
                            </span>
                          </>
                        )}
                      </div>

                      <div className="flex lg:hidden items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => setShowQueue((v) => !v)}
                          aria-label="File d’attente"
                          className={`h-8 px-3 rounded-full inline-flex items-center gap-1.5 text-[11px] font-medium transition cursor-pointer ${
                            showQueue
                              ? 'bg-[#8C271E] text-white'
                              : 'bg-slate-900/6 dark:bg-white/8 text-slate-700 dark:text-zinc-300'
                          }`}
                        >
                          <ListMusic size={14} />
                          <span>{queue.length}</span>
                        </button>
                        <button
                          type="button"
                          onClick={closePlayer}
                          aria-label="Arrêter"
                          className="h-8 w-8 rounded-full inline-flex items-center justify-center text-slate-500 dark:text-zinc-400 hover:bg-slate-900/8 dark:hover:bg-white/10 transition cursor-pointer"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* RIGHT COLUMN (DESKTOP ONLY): File d'attente & Paroles */}
                <div
                  data-queue-scroll="true"
                  className="hidden lg:flex flex-col h-[min(600px,calc(100vh-140px))] rounded-3xl border border-slate-200/80 dark:border-white/10 bg-white/80 dark:bg-white/[0.04] overflow-hidden"
                >
                  <div className="px-4 py-3 border-b border-slate-200/80 dark:border-white/10 flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setDesktopSideTab('queue')}
                      className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold transition cursor-pointer ${
                        desktopSideTab === 'queue'
                          ? 'bg-[#8C271E] text-white'
                          : 'text-slate-500 dark:text-zinc-400 hover:text-slate-950 dark:hover:text-white'
                      }`}
                    >
                      <ListMusic size={14} />
                      <span>File d’attente ({queue.length})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDesktopSideTab('lyrics')}
                      className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold transition cursor-pointer ${
                        desktopSideTab === 'lyrics'
                          ? 'bg-[#8C271E] text-white'
                          : 'text-slate-500 dark:text-zinc-400 hover:text-slate-950 dark:hover:text-white'
                      }`}
                    >
                      <FileText size={14} />
                      <span>Paroles</span>
                    </button>
                  </div>

                  {desktopSideTab === 'queue' ? (
                    <div
                      data-queue-scroll="true"
                      className="flex-1 overflow-y-auto overscroll-contain px-3 py-3 space-y-1"
                    >
                      {queue.length === 0 ? (
                        <p className="py-12 text-center text-xs text-slate-400 dark:text-zinc-500">
                          File d’attente vide.
                        </p>
                      ) : (
                        queue.map((t, i) => {
                          const active = t.id === currentTrack.id;
                          return (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => {
                                void playTrack(t, 0, queue);
                                triggerHapticTick(8);
                              }}
                              className={`w-full flex items-center justify-between gap-2.5 rounded-xl px-3 py-2.5 text-left transition cursor-pointer ${
                                active
                                  ? 'bg-[#8C271E]/12 dark:bg-[#8C271E]/28 text-[#8C271E] dark:text-[#F08B82] font-semibold'
                                  : 'text-slate-500 dark:text-zinc-400 hover:bg-slate-900/5 dark:hover:bg-white/8 hover:text-slate-900 dark:hover:text-zinc-100'
                              }`}
                            >
                              <span className="flex items-center gap-3 min-w-0">
                                <span className="font-mono text-[11px] opacity-55 w-5 shrink-0">
                                  {String(i + 1).padStart(2, '0')}
                                </span>
                                <span className="text-sm font-medium truncate">
                                  {t.manualGroupTitle || t.title}
                                </span>
                              </span>
                              {t.durationSec ? (
                                <span className="font-mono text-[11px] opacity-55 shrink-0">
                                  {fmt(t.durationSec)}
                                </span>
                              ) : null}
                            </button>
                          );
                        })
                      )}
                    </div>
                  ) : (
                    <div
                      data-queue-scroll="true"
                      className="flex-1 overflow-y-auto overscroll-contain px-6 py-5 select-text"
                    >
                      {linkedLyrics && desktopLyricsLines.some((l) => l.text.trim()) ? (
                        <div className="space-y-1">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-zinc-500 mb-3">
                            {linkedLyrics.title}
                          </p>
                          {desktopLyricsLines.map((ln, idx) =>
                            !ln.text.trim() && !ln.fix ? (
                              <div key={idx} className="h-3" />
                            ) : (
                              <div
                                key={idx}
                                className={`flex items-start gap-2 rounded-lg px-2 -mx-2 py-0.5 text-[15px] leading-[1.85] ${
                                  ln.fix
                                    ? 'bg-rose-500/10 text-slate-950 dark:text-white font-medium'
                                    : 'text-slate-800 dark:text-zinc-200'
                                }`}
                              >
                                {ln.fix && (
                                  <span className="mt-1.5 rounded bg-[#8C271E] text-white px-1.5 py-0.5 text-[9px] font-bold shrink-0">
                                    FIX
                                  </span>
                                )}
                                <span className="whitespace-pre-wrap break-words">{ln.text}</span>
                              </div>
                            )
                          )}
                        </div>
                      ) : (
                        <div className="h-full flex flex-col items-center justify-center text-center gap-2 text-slate-400 dark:text-zinc-500">
                          <FileText size={24} className="opacity-40" />
                          <p className="text-xs">Aucun texte lié à ce morceau.</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Slide-Up Queue Overlay (Mobile) */}
            <AnimatePresence>
              {showQueue && queue.length > 0 && (
                <motion.div
                  initial={{ y: '100%' }}
                  animate={{ y: 0 }}
                  exit={{ y: '100%' }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                  className="absolute inset-x-0 bottom-0 top-24 z-20 rounded-t-3xl bg-white dark:bg-[#131010] border-t border-slate-200/80 dark:border-white/10 flex flex-col"
                >
                  <div className="px-5 py-3.5 border-b border-slate-200/80 dark:border-white/10 flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-zinc-300">
                      File d’attente ({queue.length})
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowQueue(false)}
                      className="h-8 w-8 rounded-full flex items-center justify-center text-slate-500 dark:text-zinc-400 hover:bg-slate-900/8 dark:hover:bg-white/10 cursor-pointer"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <div
                    data-queue-scroll="true"
                    style={{ touchAction: 'pan-y' }}
                    className="flex-1 overflow-y-auto px-4 py-3 space-y-1 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
                  >
                    {queue.map((t, i) => {
                      const active = t.id === currentTrack.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => {
                            void playTrack(t, 0, queue);
                            triggerHapticTick(8);
                          }}
                          className={`w-full flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left transition cursor-pointer ${
                            active
                              ? 'bg-[#8C271E]/12 dark:bg-[#8C271E]/28 text-[#8C271E] dark:text-[#F08B82] font-semibold'
                              : 'text-slate-500 dark:text-zinc-400 hover:bg-slate-900/5 dark:hover:bg-white/8'
                          }`}
                        >
                          <span className="flex items-center gap-3 min-w-0">
                            <span className="font-mono text-[11px] opacity-55 w-5">
                              {String(i + 1).padStart(2, '0')}
                            </span>
                            <span className="text-sm font-medium truncate">
                              {t.manualGroupTitle || t.title}
                            </span>
                          </span>
                          {t.durationSec ? (
                            <span className="font-mono text-[11px] opacity-55 shrink-0">
                              {fmt(t.durationSec)}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
