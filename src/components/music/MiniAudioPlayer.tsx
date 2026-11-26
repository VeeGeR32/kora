import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useMotionValue, animate } from 'framer-motion';
import {
  ChevronDown,
  Disc3,
  Edit3,
  FileText,
  GripVertical,
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
  Trash2,
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
import { computeFourBarGrid } from '../../lib/audioAnalyzer';
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

interface CoverVisual {
  url: string | null;
  grad: string;
  title: string;
}

interface CarouselFreezeState {
  prev: CoverVisual | null;
  center: CoverVisual;
  next: CoverVisual | null;
}

export function MiniAudioPlayer() {
  const { state, setTrackGroupFavorite, addLyricsDoc, updateMusicTrack, notify } = useApp();
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
    abLoop,
    hasNext,
    hasPrev,
    getLiveTime,
    playTrack,
    playNext,
    playPrev,
    removeFromQueue,
    moveInQueue,
    clearUpcomingQueue,
    togglePlay,
    seek,
    cycleRepeatMode,
    toggleShuffle,
    setExpanded,
    setAbLoop,
    closePlayer,
    requestOpenTrackPage,
    requestOpenLyricsDoc,
    requestOpenProjectPage,
    requestOpenProfile,
    localDevice,
    remoteDevice,
    isRemotePlayback,
    transferToThisDevice,
  } = useAudioPlayer();

  const [blobCoverUrl, setBlobCoverUrl] = useState<string | null>(null);
  const [showQueue, setShowQueue] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [desktopSideTab, setDesktopSideTab] = useState<'queue' | 'lyrics'>('queue');
  const [scrubbing, setScrubbing] = useState(false);
  const [liveLyricsSec, setLiveLyricsSec] = useState(0);
  const playerLyricsBlockRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const lastScrolledPlayerBlockRef = useRef<number>(-1);

  // Mini-player text slide direction
  const [slideDir, setSlideDir] = useState<1 | -1>(1);
  const prevTrackIdRef = useRef<string | null>(null);
  const [draggingQueueIdx, setDraggingQueueIdx] = useState<number | null>(null);
  const [dragOverQueueIdx, setDragOverQueueIdx] = useState<number | null>(null);
  const queueRowRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const queueDragStateRef = useRef<{
    pointerId: number;
    fromIdx: number;
    overIdx: number;
  } | null>(null);
  const pendingDirRef = useRef<1 | -1 | null>(null);

  // Frozen 3-slide snapshot during the 230ms Spotify glide so cover never jumps or double-animates!
  const [carouselFreeze, setCarouselFreeze] = useState<CarouselFreezeState | null>(null);
  const carouselTimerRef = useRef<number | null>(null);

  // Direct GPU DOM refs (60/120fps, zero React re-renders during playback or drag!)
  const progressFillRef = useRef<HTMLDivElement>(null);
  const progressThumbRef = useRef<HTMLDivElement>(null);
  const miniProgressFillRef = useRef<HTMLDivElement>(null);
  const timeCurrentRef = useRef<HTMLSpanElement>(null);
  const timeTotalRef = useRef<HTMLSpanElement>(null);
  const miniSwipeContentRef = useRef<HTMLDivElement>(null);
  const coverCarouselTrackRef = useRef<HTMLDivElement>(null);

  // Smooth native iOS sheet vertical drag
  const sheetY = useMotionValue(0);
  const closingSheetRef = useRef(false);

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

  // Unified expanded-player gesture state (locks cleanly to horizontal Spotify cover carousel OR vertical sheet minimize!)
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
    () =>
      currentGroup
        ? [...currentGroup.versions.map((v) => v.track), ...currentGroup.prodTracks.map((p) => p.track)]
        : undefined,
    [currentGroup]
  );

  // Adjacent prev/next tracks for the off-screen slides of the 3-slide Spotify carousel
  const { prevQueueTrack, nextQueueTrack } = useMemo(() => {
    if (!currentTrack || queue.length <= 1) {
      return { prevQueueTrack: null as MusicTrack | null, nextQueueTrack: null as MusicTrack | null };
    }
    const idx = queue.findIndex((t) => t.id === currentTrack.id);
    if (idx < 0) return { prevQueueTrack: null, nextQueueTrack: null };
    const prevT = idx > 0 ? queue[idx - 1] : queue[queue.length - 1];
    const nextT = idx < queue.length - 1 ? queue[idx + 1] : queue[0];
    return {
      prevQueueTrack: prevT && prevT.id !== currentTrack.id ? prevT : null,
      nextQueueTrack: nextT && nextT.id !== currentTrack.id ? nextT : null,
    };
  }, [currentTrack?.id, queue]);

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
        setSlideDir(prevIdx >= 0 && curIdx >= 0 ? (curIdx >= prevIdx ? 1 : -1) : 1);
      }
    }
    prevTrackIdRef.current = curId;
  }, [currentTrack?.id, queue]);

  useLayoutEffect(() => {
    if (expanded) {
      closingSheetRef.current = false;
      sheetY.set(0);
    }
  }, [expanded, sheetY]);

  useEffect(() => {
    return () => {
      if (carouselTimerRef.current) window.clearTimeout(carouselTimerRef.current);
    };
  }, []);

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

  // Synced 4-bar blocks for Spotify-Lyrics view inside the maximized player (mobile & desktop!)
  const playerLyricsBlocks = useMemo(() => {
    if (!linkedLyrics?.barBlocks || linkedLyrics.barBlocks.length === 0 || !currentTrack) return null;
    const refTrack = currentGroup?.prodTrack || currentTrack;
    const bpm = refTrack.bpm || currentTrack.bpm;
    const dur = refTrack.durationSec || currentTrack.durationSec || duration;
    if (!bpm || !dur) return null;
    const grid = computeFourBarGrid(dur, bpm, refTrack.barOffsetSec ?? currentTrack.barOffsetSec ?? 0);
    const byIdx = new Map(linkedLyrics.barBlocks.map((b) => [b.index, b]));
    const items = grid
      .map((g) => {
        const blk = byIdx.get(g.index);
        if (!blk || (blk.status === 'empty' && !blk.text.trim())) return null;
        return {
          ...g,
          status: blk.status,
          sectionLabel: blk.sectionLabel || g.suggestedSection,
          note: blk.note,
          lines: blk.text.trim() ? parseLyricLines(blk.text) : [],
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
    return items.length > 0 ? items : null;
  }, [linkedLyrics?.barBlocks, currentTrack, currentGroup?.prodTrack, duration]);

  const lyricsPanelVisible = expanded && (showLyrics || desktopSideTab === 'lyrics');
  useEffect(() => {
    if (!lyricsPanelVisible || !playerLyricsBlocks) return;
    setLiveLyricsSec(getLiveTime());
    if (!isPlaying) return;
    const id = window.setInterval(() => setLiveLyricsSec(getLiveTime()), 140);
    return () => window.clearInterval(id);
  }, [lyricsPanelVisible, playerLyricsBlocks, isPlaying, getLiveTime, currentTime]);

  const activePlayerLyricsBlockIdx = useMemo(() => {
    if (!playerLyricsBlocks) return -1;
    const hit = playerLyricsBlocks.find(
      (b) => liveLyricsSec >= b.startSec - 0.1 && liveLyricsSec < b.endSec
    );
    return hit ? hit.index : -1;
  }, [playerLyricsBlocks, liveLyricsSec]);

  useEffect(() => {
    if (!lyricsPanelVisible || !isPlaying || activePlayerLyricsBlockIdx < 0) return;
    if (activePlayerLyricsBlockIdx === lastScrolledPlayerBlockRef.current) return;
    lastScrolledPlayerBlockRef.current = activePlayerLyricsBlockIdx;
    playerLyricsBlockRefs.current.get(activePlayerLyricsBlockIdx)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  }, [lyricsPanelVisible, isPlaying, activePlayerLyricsBlockIdx]);

  const handleOpenOrCreateLyricsInEditor = () => {
    if (!currentTrack) return;
    triggerHapticTick(8);
    if (linkedLyrics) {
      setShowLyrics(false);
      setExpanded(false);
      requestOpenLyricsDoc(linkedLyrics.id);
      return;
    }
    const newDocId = addLyricsDoc({
      title: displayTrackTitle || currentTrack.title,
      linkedTrackId: currentTrack.id,
      linkedProjectId: linkedProject?.id,
    });
    updateMusicTrack(currentTrack.id, { linkedLyricsId: newDocId });
    setShowLyrics(false);
    setExpanded(false);
    requestOpenLyricsDoc(newDocId);
  };

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

  const resolveCoverVisual = useCallback(
    (trk: MusicTrack | null): CoverVisual | null => {
      if (!trk) return null;
      const grp = allGroups.find((g) => g.allTrackIds.includes(trk.id));
      const eff = resolveEffectiveTrackCover(
        trk,
        state.musicProjects,
        grp?.groupKey,
        grp ? [...grp.versions.map((v) => v.track), ...grp.prodTracks.map((p) => p.track)] : undefined
      );
      return {
        url: eff.coverDataUrl || eff.cloudCoverUrl || null,
        grad: getGradientClass(eff.gradientId),
        title: grp?.baseTitle || trk.manualGroupTitle || trk.title,
      };
    },
    [allGroups, state.musicProjects]
  );

  const prevCoverVisual = useMemo(
    () => resolveCoverVisual(prevQueueTrack),
    [prevQueueTrack, resolveCoverVisual]
  );
  const nextCoverVisual = useMemo(
    () => resolveCoverVisual(nextQueueTrack),
    [nextQueueTrack, resolveCoverVisual]
  );

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

  const gradCls = getGradientClass(
    effectiveCover?.gradientId || currentTrack?.coverGradient || linkedProject?.coverGradient
  );
  const parsedCurrent = useMemo(
    () => (currentTrack ? parseTrackVersion(currentTrack) : null),
    [currentTrack]
  );

  const displayTrackTitle =
    currentGroup?.baseTitle ||
    currentTrack?.manualGroupTitle ||
    parsedCurrent?.baseTitle ||
    currentTrack?.title ||
    '';

  const currentCoverVisual: CoverVisual = useMemo(
    () => ({
      url: coverUrl,
      grad: gradCls,
      title: displayTrackTitle,
    }),
    [coverUrl, gradCls, displayTrackTitle]
  );

  const effectiveDuration = duration || currentTrack?.durationSec || 0;

  // Lightweight 60/120fps Spotify progress bar updater
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

  const alternateProdOrSong = useMemo(() => {
    if (!currentTrack || !parsedCurrent || !currentGroup?.prodTrack) return null;
    if (parsedCurrent.isProd) {
      if (currentGroup.latestTrack.id === currentTrack.id) return null;
      return { target: currentGroup.latestTrack, label: 'Son', isCurrentlyProd: true };
    }
    return { target: currentGroup.prodTrack, label: 'Prod', isCurrentlyProd: false };
  }, [currentTrack, parsedCurrent, currentGroup]);

  const authorDisplayName =
    state.preferences.name?.trim() || currentTrack?.artist || 'Moi';
  const subtitle = [authorDisplayName, linkedProject?.title].filter(Boolean).join(' · ');

  const canPlay = Boolean(
    isRemotePlayback ||
      currentTrack?.mediaId ||
      currentTrack?.cloudAudioUrl ||
      currentTrack?.googleDriveFileId
  );

  // True Spotify 3-slide full-width glide commit (continues seamlessly from current finger position to ±100%!)
  const commitTrackSwitch = useCallback(
    (dir: 1 | -1, animateCoverCarousel = true) => {
      if (dir === 1 && !hasNext) return;
      if (dir === -1 && !hasPrev && getLiveTime() <= 3) return;

      // If Prev only rewinds the current track (>3s), just bounce carousel cleanly back to 0 and rewind
      if (dir === -1 && getLiveTime() > 3) {
        if (coverCarouselTrackRef.current) {
          coverCarouselTrackRef.current.style.transition =
            'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)';
          coverCarouselTrackRef.current.style.transform = 'translate3d(0, 0, 0)';
        }
        playPrev();
        triggerHapticTick(8);
        return;
      }

      pendingDirRef.current = dir;
      setSlideDir(dir);
      triggerHapticTick(8);

      const trackEl = coverCarouselTrackRef.current;
      if (expanded && animateCoverCarousel && trackEl) {
        // Freeze the 3 slides while the incoming cover glides seamlessly to center (zero snap-back, zero flash!)
        setCarouselFreeze({
          prev: prevCoverVisual,
          center: currentCoverVisual,
          next: nextCoverVisual,
        });

        // Start audio IMMEDIATELY (0ms latency) while the visual slide finishes its 230ms glide!
        if (dir === 1) playNext();
        else playPrev();

        trackEl.style.transition = 'transform 230ms cubic-bezier(0.22, 1, 0.36, 1)';
        trackEl.style.transform = `translate3d(${dir === 1 ? '-100%' : '100%'}, 0, 0)`;

        if (carouselTimerRef.current) window.clearTimeout(carouselTimerRef.current);
        carouselTimerRef.current = window.setTimeout(() => {
          if (coverCarouselTrackRef.current) {
            coverCarouselTrackRef.current.style.transition = 'none';
            coverCarouselTrackRef.current.style.transform = 'translate3d(0, 0, 0)';
          }
          setCarouselFreeze(null);
          carouselTimerRef.current = null;
        }, 235);
      } else {
        if (dir === 1) playNext();
        else playPrev();
      }
    },
    [
      hasNext,
      hasPrev,
      getLiveTime,
      expanded,
      prevCoverVisual,
      currentCoverVisual,
      nextCoverVisual,
      playNext,
      playPrev,
    ]
  );

  const smoothMinimize = useCallback(() => {
    if (closingSheetRef.current) return;
    closingSheetRef.current = true;
    const targetY = typeof window !== 'undefined' ? window.innerHeight : 900;
    void animate(sheetY, targetY, {
      duration: 0.22,
      ease: [0.32, 0.72, 0, 1],
      onComplete: () => {
        setExpanded(false);
        closingSheetRef.current = false;
      },
    });
  }, [sheetY, setExpanded]);

  // Spotify-style linear progress bar scrubbing
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
      const opacity = Math.max(0.45, 1 - Math.abs(clamped) / 140);
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
        commitTrackSwitch(1, false);
      } else if (s.dx > 38 && (hasPrev || getLiveTime() > 3)) {
        commitTrackSwitch(-1, false);
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
    if (e.deltaX > 0 && hasNext) commitTrackSwitch(1, false);
    else if (e.deltaX < 0 && (hasPrev || getLiveTime() > 3)) commitTrackSwitch(-1, false);
  };

  // ================= MAXIMIZED PLAYER GESTURES (HORIZONTAL = TRUE 3-SLIDE SPOTIFY CAROUSEL · DOWN = SMOOTH MINIMIZE) =================
  const handleSheetPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (closingSheetRef.current) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-no-sheet-drag]')) return;
    const queueScrollEl = target.closest('[data-queue-scroll]') as HTMLElement | null;
    if (queueScrollEl && queueScrollEl.scrollTop > 0) return;

    const allowHorizontal =
      Boolean(target.closest('[data-cover-swipe]')) && !showQueue && !showLyrics && !carouselFreeze;
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
      if (g.allowHorizontal && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.15) {
        g.axis = 'x';
      } else if (dy > 8 && dy > Math.abs(dx) * 1.15) {
        g.axis = 'y';
      }
    }

    if (g.axis === 'x') {
      g.dx = dx;
      const blocked = (dx > 0 && !hasPrev && getLiveTime() <= 3) || (dx < 0 && !hasNext);
      const offset = blocked ? dx * 0.22 : dx;
      if (coverCarouselTrackRef.current) {
        coverCarouselTrackRef.current.style.transition = 'none';
        coverCarouselTrackRef.current.style.transform = `translate3d(${offset.toFixed(1)}px, 0, 0)`;
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
      const shouldNext = (g.dx < -60 || (g.dx < -28 && velocityX > 0.4)) && hasNext;
      const shouldPrev = (g.dx > 60 || (g.dx > 28 && velocityX > 0.4)) && (hasPrev || getLiveTime() > 3);

      if (shouldNext) {
        commitTrackSwitch(1, true);
      } else if (shouldPrev) {
        commitTrackSwitch(-1, true);
      } else if (coverCarouselTrackRef.current) {
        // Elastic bounce back to center
        coverCarouselTrackRef.current.style.transition =
          'transform 240ms cubic-bezier(0.22, 1, 0.36, 1)';
        coverCarouselTrackRef.current.style.transform = 'translate3d(0, 0, 0)';
      }
      return;
    }

    if (g.axis === 'y') {
      const velocityY = g.dy / elapsed;
      if (g.dy > 90 || (g.dy > 34 && velocityY > 0.42)) {
        triggerHapticTick(8);
        smoothMinimize();
      } else {
        void animate(sheetY, 0, { duration: 0.22, ease: [0.22, 1, 0.36, 1] });
      }
    }
  };

  const handleSheetWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-queue-scroll]')) return;
    const now = Date.now();
    if (now - sheetWheelCooldownRef.current < 420) return;

    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 26) {
      sheetWheelCooldownRef.current = now;
      if (e.deltaX > 0 && hasNext) commitTrackSwitch(1, true);
      else if (e.deltaX < 0 && (hasPrev || getLiveTime() > 3)) commitTrackSwitch(-1, true);
    } else if (e.deltaY > 42 && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      sheetWheelCooldownRef.current = now;
      smoothMinimize();
    }
  };

  const handleOpenTrackPageFromCover = () => {
    if (!currentTrack || justDraggedRef.current) return;
    triggerHapticTick(8);
    setExpanded(false);
    requestOpenTrackPage(currentTrack.id);
  };

  const handleOpenProjectFromPlayer = () => {
    if (!linkedProject || justDraggedRef.current) return;
    triggerHapticTick(8);
    setExpanded(false);
    requestOpenProjectPage(linkedProject.id);
  };

  const handleOpenAuthorFromPlayer = () => {
    if (justDraggedRef.current) return;
    triggerHapticTick(8);
    setExpanded(false);
    requestOpenProfile('me');
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

  const activeCarousel = carouselFreeze || {
    prev: prevCoverVisual,
    center: currentCoverVisual,
    next: nextCoverVisual,
  };

  const renderCoverCard = (vis: CoverVisual | null, clickable = false) => {
    if (!vis) return null;
    const inner = (
      <div
        className={`w-full max-w-[min(92vw,420px)] sm:max-w-[440px] lg:max-w-[465px] xl:max-w-[495px] aspect-square rounded-2xl lg:rounded-3xl overflow-hidden border border-slate-200/80 dark:border-white/10 shadow-xl shadow-black/15 dark:shadow-black/60 ${
          vis.url ? '' : `bg-gradient-to-br ${vis.grad}`
        } ${clickable && isLoadingTrack ? 'animate-pulse opacity-80' : ''}`}
      >
        {vis.url ? (
          <img
            src={vis.url}
            alt={vis.title}
            draggable={false}
            className="h-full w-full object-cover select-none pointer-events-none block"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center">
            <Disc3 size={64} className="text-white/40" strokeWidth={1.3} />
          </div>
        )}
      </div>
    );

    if (clickable) {
      return (
        <button
          type="button"
          onClick={handleOpenTrackPageFromCover}
          title="Glisser gauche/droite pour changer de son · Cliquer pour la page morceau"
          className="w-full flex items-center justify-center active:scale-[0.985] transition-transform cursor-pointer focus:outline-none"
        >
          {inner}
        </button>
      );
    }
    return <div className="w-full flex items-center justify-center pointer-events-none">{inner}</div>;
  };

  return (
    <>
      {/* ================= FLOATING SPOTIFY-STYLE MINI PLAYER ================= */}
      <AnimatePresence>
        {currentTrack && !expanded && (
          <motion.div
            key="rowav-mini-player"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            onWheel={handleMiniWheel}
            className={`fixed bottom-[calc(4.25rem+env(safe-area-inset-bottom))] md:bottom-4 left-2.5 right-2.5 md:left-64 [[data-sidebar-collapsed=true]_&]:md:left-24 md:right-6 z-[48] max-w-2xl md:mx-auto rounded-2xl bg-white/95 dark:bg-[#171313]/96 text-slate-900 dark:text-white border backdrop-blur-md transition-[bottom,left,border-color] duration-200 overflow-hidden ${
              isRemotePlayback
                ? 'border-emerald-500/40 dark:border-emerald-400/40 shadow-lg shadow-emerald-500/10'
                : 'border-slate-200/90 dark:border-white/10 shadow-lg shadow-black/10 dark:shadow-black/45'
            }`}
          >
            <div className="flex items-center justify-between gap-2 px-2 py-1.5">
              {/* Swipeable Cover + Title */}
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
                      initial={{ x: slideDir * 32, opacity: 0 }}
                      animate={{ x: 0, opacity: 1 }}
                      exit={{ x: slideDir * -32, opacity: 0 }}
                      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                      className="flex items-center gap-2.5 min-w-0"
                    >
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
                  onClick={() => commitTrackSwitch(-1, false)}
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
                  onClick={() => commitTrackSwitch(1, false)}
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

            {/* Ultra-Thin Spotify Hairline Progress Bar */}
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
              transition={{ duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
              style={{ touchAction: 'none' }}
              onPointerDown={handleSheetPointerDown}
              onPointerMove={handleSheetPointerMove}
              onPointerUp={finishSheetGesture}
              onPointerCancel={finishSheetGesture}
              onWheel={handleSheetWheel}
              className="w-full h-full bg-[#faf7f6] dark:bg-[#0d0a0a] text-slate-950 dark:text-white flex flex-col overflow-hidden select-none will-change-transform"
            >
              {/* Soft ambient crimson tint */}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#8C271E]/[0.08] via-transparent to-transparent dark:from-[#8C271E]/[0.18] dark:via-[#0d0a0a]/60 dark:to-[#0d0a0a]" />

              {/* Responsive Wrapper */}
              <div className="relative z-10 w-full max-w-md lg:max-w-6xl mx-auto flex-1 min-h-0 flex flex-col pt-[max(0.75rem,env(safe-area-inset-top))] lg:pt-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] lg:pb-8">
                {/* Top Handle & Header */}
                <div className="space-y-1.5 shrink-0 px-6 lg:px-10">
                  <div className="flex justify-center pt-1 lg:hidden">
                    <div className="h-1 w-9 rounded-full bg-slate-900/15 dark:bg-white/20" />
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={smoothMinimize}
                      aria-label="Réduire le lecteur"
                      className="h-10 w-10 rounded-full flex items-center justify-center text-slate-700 dark:text-white/80 hover:bg-slate-900/8 dark:hover:bg-white/10 transition cursor-pointer"
                    >
                      <ChevronDown size={22} />
                    </button>

                    <div className="min-w-0 flex-1 text-center">
                      {linkedProject ? (
                        <button
                          type="button"
                          onClick={handleOpenProjectFromPlayer}
                          className="max-w-full text-[10.5px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white truncate transition cursor-pointer"
                          title={`Ouvrir le projet « ${linkedProject.title} »`}
                        >
                          {linkedProject.title}
                        </button>
                      ) : (
                        <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-zinc-400 truncate">
                          En lecture
                        </p>
                      )}
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
                <div className="flex-1 min-h-0 flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)] lg:gap-12 xl:gap-16 lg:items-center lg:px-10 lg:py-4">
                  {/* LEFT COLUMN: True Full-Width 3-Slide Spotify Cover Carousel + Controls */}
                  <div className="flex-1 min-h-0 flex flex-col justify-between lg:justify-center lg:gap-5 lg:max-w-xl lg:mx-auto lg:w-full">
                    {/* FULL-WIDTH 3-SLIDE SPOTIFY CAROUSEL (Zero side slivers at rest · 1:1 finger glide on swipe!) */}
                    <div
                      data-cover-swipe="true"
                      className="flex-1 lg:flex-none flex items-center justify-center py-2 lg:py-0 min-h-0 w-full overflow-hidden"
                    >
                      <div
                        ref={coverCarouselTrackRef}
                        style={{ transform: 'translate3d(0, 0, 0)' }}
                        className="relative w-full will-change-transform"
                      >
                        {/* Slide -1 (Previous Cover — 100% off-screen left at rest!) */}
                        <div
                          aria-hidden="true"
                          className="absolute top-0 bottom-0 -left-full w-full px-4 sm:px-6 lg:px-0 flex items-center justify-center"
                        >
                          {renderCoverCard(activeCarousel.prev, false)}
                        </div>

                        {/* Slide 0 (Current Active Cover — dead center!) */}
                        <div className="w-full px-4 sm:px-6 lg:px-0 flex items-center justify-center">
                          {renderCoverCard(activeCarousel.center, true)}
                        </div>

                        {/* Slide +1 (Next Cover — 100% off-screen right at rest!) */}
                        <div
                          aria-hidden="true"
                          className="absolute top-0 bottom-0 left-full w-full px-4 sm:px-6 lg:px-0 flex items-center justify-center"
                        >
                          {renderCoverCard(activeCarousel.next, false)}
                        </div>
                      </div>
                    </div>

                    {/* Bottom Controls Stack */}
                    <div className="space-y-4 px-5 sm:px-6 lg:px-0">
                      {/* Title, Subtitle, Son/Prod Pill & Favorite Star */}
                      <div data-cover-swipe="true" className="flex items-center justify-between gap-2.5">
                        <div className="min-w-0 flex-1 overflow-hidden">
                          <AnimatePresence mode="popLayout" initial={false} custom={slideDir}>
                            <motion.div
                              key={currentTrack.id}
                              custom={slideDir}
                              initial={{ x: slideDir * 24, opacity: 0 }}
                              animate={{ x: 0, opacity: 1 }}
                              exit={{ x: slideDir * -24, opacity: 0 }}
                              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                              className="w-full text-left block"
                            >
                              <button
                                type="button"
                                onClick={handleOpenTrackPageFromCover}
                                title="Ouvrir la page du morceau"
                                className="block max-w-full text-left cursor-pointer group"
                              >
                                <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-950 dark:text-white truncate group-hover:underline">
                                  {displayTrackTitle}
                                </h2>
                              </button>
                              <div className="flex items-center gap-1.5 text-xs sm:text-sm text-slate-500 dark:text-zinc-400 mt-0.5 min-w-0">
                                <button
                                  type="button"
                                  onClick={handleOpenAuthorFromPlayer}
                                  title="Voir le profil de l’artiste"
                                  className="truncate hover:text-slate-900 dark:hover:text-white hover:underline transition cursor-pointer"
                                >
                                  {authorDisplayName}
                                </button>
                                {linkedProject && (
                                  <>
                                    <span className="opacity-50 shrink-0">·</span>
                                    <button
                                      type="button"
                                      onClick={handleOpenProjectFromPlayer}
                                      title={`Ouvrir le projet « ${linkedProject.title} »`}
                                      className="truncate hover:text-slate-900 dark:hover:text-white hover:underline transition cursor-pointer"
                                    >
                                      {linkedProject.title}
                                    </button>
                                  </>
                                )}
                              </div>
                            </motion.div>
                          </AnimatePresence>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {alternateProdOrSong && (
                            <button
                              type="button"
                              onClick={() => {
                                const keepSec = getLiveTime();
                                void playTrack(
                                  alternateProdOrSong.target,
                                  keepSec > 0.3 ? keepSec : 0,
                                  queue
                                );
                                triggerHapticTick(8);
                              }}
                              title="Comparateur A/B : bascule Son ↔ Prod au même timecode"
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

                      {/* SIMPLE SPOTIFY PROGRESS BAR */}
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
                          <div
                            className={`relative w-full rounded-full bg-slate-900/14 dark:bg-white/18 transition-[height] duration-100 overflow-hidden ${
                              scrubbing ? 'h-1.5' : 'h-1 group-hover/bar:h-1.5'
                            }`}
                          >
                            {effectiveDuration > 0 &&
                              abLoop.start !== null &&
                              abLoop.end !== null && (
                                <div
                                  style={{
                                    left: `${Math.min(100, (abLoop.start / effectiveDuration) * 100)}%`,
                                    width: `${Math.max(
                                      0.5,
                                      ((abLoop.end - abLoop.start) / effectiveDuration) * 100
                                    )}%`,
                                  }}
                                  className="absolute inset-y-0 bg-amber-500/55 dark:bg-amber-400/55 pointer-events-none z-10"
                                />
                              )}
                            <div
                              ref={progressFillRef}
                              style={{ transform: 'scaleX(0)' }}
                              className="h-full w-full origin-left bg-[#8C271E] dark:bg-[#E04F42] will-change-transform"
                            />
                          </div>

                          {effectiveDuration > 0 && abLoop.start !== null && (
                            <div
                              style={{
                                left: `${Math.min(100, (abLoop.start / effectiveDuration) * 100)}%`,
                              }}
                              className="pointer-events-none absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-3 w-0.5 rounded-full bg-amber-500 z-10"
                            />
                          )}
                          {effectiveDuration > 0 && abLoop.end !== null && (
                            <div
                              style={{
                                left: `${Math.min(100, (abLoop.end / effectiveDuration) * 100)}%`,
                              }}
                              className="pointer-events-none absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-3 w-0.5 rounded-full bg-amber-500 z-10"
                            />
                          )}

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
                          <div className="flex items-center justify-between gap-2 font-mono text-[11px] text-slate-500 dark:text-zinc-400 tabular-nums">
                            <span ref={timeCurrentRef}>0:00</span>

                            {!isRemotePlayback && (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const liveT = getLiveTime();
                                    if (abLoop.start === null) {
                                      setAbLoop({ start: liveT, end: null });
                                      notify(`Point A fixé à ${fmt(liveT)} — clique à nouveau pour B`);
                                    } else if (abLoop.end === null) {
                                      let a = abLoop.start;
                                      let b = liveT;
                                      if (Math.abs(b - a) < 0.6) {
                                        b = Math.min(effectiveDuration || a + 8, a + 8);
                                      } else if (b < a) {
                                        [a, b] = [b, a];
                                      }
                                      setAbLoop({ start: a, end: b });
                                      seek(a);
                                      applyVisualFrame(a, effectiveDuration);
                                      notify(`Boucle A–B active (${fmt(a)} → ${fmt(b)})`);
                                    } else {
                                      setAbLoop({ start: null, end: null });
                                      notify('Boucle A–B désactivée');
                                    }
                                    triggerHapticTick(8);
                                  }}
                                  title="Boucle A–B rapide : 1er clic = A · 2e clic = B · 3e clic = annuler"
                                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-sans text-[10px] font-semibold transition cursor-pointer ${
                                    abLoop.start !== null
                                      ? 'bg-amber-500/18 text-amber-700 dark:text-amber-300 border border-amber-500/35'
                                      : 'bg-slate-900/6 dark:bg-white/8 text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white'
                                  }`}
                                >
                                  <Repeat size={9.5} />
                                  {abLoop.start !== null && abLoop.end !== null ? (
                                    <span className="font-mono">
                                      {fmt(abLoop.start)}–{fmt(abLoop.end)}
                                    </span>
                                  ) : abLoop.start !== null ? (
                                    <span className="font-mono">A {fmt(abLoop.start)}</span>
                                  ) : (
                                    <span>A–B</span>
                                  )}
                                </button>
                                {abLoop.start !== null && (
                                  <button
                                    type="button"
                                    onClick={() => setAbLoop({ start: null, end: null })}
                                    aria-label="Effacer boucle A-B"
                                    className="h-4.5 w-4.5 rounded-full bg-slate-900/8 dark:bg-white/10 text-slate-500 hover:text-rose-500 inline-flex items-center justify-center cursor-pointer"
                                  >
                                    <X size={9} />
                                  </button>
                                )}
                              </div>
                            )}

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

                      {/* Transport Row */}
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
                          onClick={() => commitTrackSwitch(-1, true)}
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
                          onClick={() => commitTrackSwitch(1, true)}
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
                            onClick={() => {
                              setShowQueue(false);
                              setShowLyrics((v) => !v);
                            }}
                            aria-label="Paroles"
                            className={`h-8 px-2.5 rounded-full inline-flex items-center gap-1.5 text-[11px] font-medium transition cursor-pointer ${
                              showLyrics
                                ? 'bg-[#8C271E] text-white'
                                : linkedLyrics
                                ? 'bg-[#8C271E]/12 text-[#8C271E] dark:text-[#f08b82]'
                                : 'bg-slate-900/6 dark:bg-white/8 text-slate-500 dark:text-zinc-400'
                            }`}
                          >
                            <FileText size={13} />
                            <span>Paroles</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setShowLyrics(false);
                              setShowQueue((v) => !v);
                            }}
                            aria-label="File d’attente"
                            className={`h-8 px-2.5 rounded-full inline-flex items-center gap-1.5 text-[11px] font-medium transition cursor-pointer ${
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
                        {queue.length > 1 && (
                          <div className="flex items-center justify-between px-2 pb-1.5 text-[10px] text-slate-400 dark:text-zinc-500">
                            <span>Glisse ⠿ pour réordonner</span>
                            <button
                              type="button"
                              onClick={clearUpcomingQueue}
                              className="inline-flex items-center gap-1 hover:text-rose-500 transition cursor-pointer font-semibold"
                            >
                              <Trash2 size={10} /> Vider
                            </button>
                          </div>
                        )}
                        {queue.length === 0 ? (
                          <p className="py-12 text-center text-xs text-slate-400 dark:text-zinc-500">
                            File d’attente vide.
                          </p>
                        ) : (
                          queue.map((t, i) => {
                            const active = t.id === currentTrack.id;
                            const isDragging = draggingQueueIdx === i;
                            const isDropTarget =
                              draggingQueueIdx !== null &&
                              dragOverQueueIdx === i &&
                              draggingQueueIdx !== i;
                            return (
                              <div
                                key={`${t.id}_${i}`}
                                ref={(el) => {
                                  if (el) queueRowRefs.current.set(i, el);
                                  else queueRowRefs.current.delete(i);
                                }}
                                className={`group w-full flex items-center gap-1.5 rounded-xl px-2 py-2 transition ${
                                  active
                                    ? 'bg-[#8C271E]/12 dark:bg-[#8C271E]/28 text-[#8C271E] dark:text-[#F08B82] font-semibold'
                                    : 'text-slate-600 dark:text-zinc-300 hover:bg-slate-900/5 dark:hover:bg-white/8'
                                } ${isDragging ? 'opacity-50 scale-[0.98]' : ''} ${
                                  isDropTarget ? 'ring-2 ring-[#8C271E]/70' : ''
                                }`}
                              >
                                <button
                                  type="button"
                                  aria-label="Déplacer dans la file"
                                  title="Glisser pour déplacer"
                                  style={{ touchAction: 'none' }}
                                  onPointerDown={(e) => {
                                    e.stopPropagation();
                                    e.currentTarget.setPointerCapture(e.pointerId);
                                    queueDragStateRef.current = {
                                      pointerId: e.pointerId,
                                      fromIdx: i,
                                      overIdx: i,
                                    };
                                    setDraggingQueueIdx(i);
                                    setDragOverQueueIdx(i);
                                    triggerHapticTick(8);
                                  }}
                                  onPointerMove={(e) => {
                                    const st = queueDragStateRef.current;
                                    if (!st || st.pointerId !== e.pointerId) return;
                                    e.stopPropagation();
                                    let bestIdx = st.overIdx;
                                    for (let idx = 0; idx < queue.length; idx++) {
                                      const el = queueRowRefs.current.get(idx);
                                      if (!el) continue;
                                      const r = el.getBoundingClientRect();
                                      if (e.clientY >= r.top && e.clientY <= r.bottom) {
                                        bestIdx = idx;
                                        break;
                                      }
                                    }
                                    if (bestIdx !== st.overIdx) {
                                      st.overIdx = bestIdx;
                                      setDragOverQueueIdx(bestIdx);
                                      triggerHapticTick(6);
                                    }
                                  }}
                                  onPointerUp={(e) => {
                                    const st = queueDragStateRef.current;
                                    if (!st || st.pointerId !== e.pointerId) return;
                                    e.stopPropagation();
                                    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                                      e.currentTarget.releasePointerCapture(e.pointerId);
                                    }
                                    queueDragStateRef.current = null;
                                    if (st.fromIdx !== st.overIdx) {
                                      moveInQueue(st.fromIdx, st.overIdx);
                                    }
                                    setDraggingQueueIdx(null);
                                    setDragOverQueueIdx(null);
                                  }}
                                  onPointerCancel={() => {
                                    queueDragStateRef.current = null;
                                    setDraggingQueueIdx(null);
                                    setDragOverQueueIdx(null);
                                  }}
                                  className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-grab active:cursor-grabbing shrink-0"
                                >
                                  <GripVertical size={13} />
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    void playTrack(t, 0, queue);
                                    triggerHapticTick(8);
                                  }}
                                  className="flex-1 min-w-0 flex items-center gap-2.5 text-left cursor-pointer"
                                >
                                  <span className="font-mono text-[11px] opacity-55 w-5 shrink-0">
                                    {String(i + 1).padStart(2, '0')}
                                  </span>
                                  <span className="text-sm font-medium truncate">
                                    {t.manualGroupTitle || t.title}
                                  </span>
                                </button>

                                {t.durationSec ? (
                                  <span className="font-mono text-[11px] opacity-55 shrink-0">
                                    {fmt(t.durationSec)}
                                  </span>
                                ) : null}

                                {!active && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      removeFromQueue(i);
                                      triggerHapticTick(6);
                                    }}
                                    title="Retirer de la file"
                                    aria-label="Retirer de la file"
                                    className="p-1 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 opacity-70 sm:opacity-0 group-hover:opacity-100 transition cursor-pointer shrink-0"
                                  >
                                    <X size={13} />
                                  </button>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    ) : (
                      <div
                        data-queue-scroll="true"
                        style={{
                          maskImage:
                            'linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)',
                          WebkitMaskImage:
                            'linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)',
                        }}
                        className="flex-1 overflow-y-auto overscroll-contain px-6 py-10 select-text"
                      >
                        {(() => {
                          const writtenBlocks = playerLyricsBlocks
                            ? playerLyricsBlocks.filter((b) =>
                                b.lines.some((ln) => ln.text.trim().length > 0)
                              )
                            : null;
                          const cleanPlainLines = desktopLyricsLines.filter((ln) =>
                            ln.text.trim().length > 0
                          );
                          const hasListenerLyrics = Boolean(
                            linkedLyrics &&
                              ((writtenBlocks && writtenBlocks.length > 0) ||
                                cleanPlainLines.length > 0)
                          );

                          if (!hasListenerLyrics) {
                            return (
                              <div className="h-full flex flex-col items-center justify-center text-center gap-3 text-slate-400 dark:text-zinc-500">
                                <FileText size={24} className="opacity-40" />
                                <p className="text-xs">Aucune parole disponible.</p>
                                <button
                                  type="button"
                                  onClick={handleOpenOrCreateLyricsInEditor}
                                  className="inline-flex items-center gap-1.5 rounded-full bg-[#8C271E] text-white px-3.5 py-1.5 text-xs font-semibold hover:opacity-90 transition cursor-pointer"
                                >
                                  <Edit3 size={12} />
                                  Écrire les paroles
                                </button>
                              </div>
                            );
                          }

                          if (writtenBlocks && writtenBlocks.length > 0) {
                            return (
                              <div className="space-y-6 py-12">
                                {writtenBlocks.map((b) => {
                                  const isActive = activePlayerLyricsBlockIdx === b.index;
                                  const isPast =
                                    activePlayerLyricsBlockIdx >= 0 &&
                                    b.index < activePlayerLyricsBlockIdx;
                                  return (
                                    <button
                                      key={b.index}
                                      ref={(el) => {
                                        if (el) playerLyricsBlockRefs.current.set(b.index, el);
                                        else playerLyricsBlockRefs.current.delete(b.index);
                                      }}
                                      type="button"
                                      onClick={() => {
                                        seek(b.startSec);
                                        applyVisualFrame(b.startSec, effectiveDuration);
                                        triggerHapticTick(8);
                                      }}
                                      className={`w-full text-left transition-all duration-300 cursor-pointer space-y-1.5 ${
                                        isActive
                                          ? 'text-slate-950 dark:text-white opacity-100 scale-[1.01] origin-left'
                                          : isPast
                                          ? 'text-slate-900 dark:text-white opacity-28 hover:opacity-70'
                                          : 'text-slate-900 dark:text-white opacity-42 hover:opacity-80'
                                      }`}
                                    >
                                      {b.lines
                                        .filter((ln) => ln.text.trim().length > 0)
                                        .map((ln, lIdx) => (
                                          <p
                                            key={lIdx}
                                            className="text-[20px] font-bold leading-[1.42] tracking-tight whitespace-pre-wrap break-words"
                                          >
                                            {ln.text}
                                          </p>
                                        ))}
                                    </button>
                                  );
                                })}
                              </div>
                            );
                          }

                          return (
                            <div className="space-y-2.5 py-4">
                              {cleanPlainLines.map((ln, idx) => (
                                <p
                                  key={idx}
                                  className="text-[19px] font-bold leading-[1.48] tracking-tight text-slate-900 dark:text-white/90 whitespace-pre-wrap break-words"
                                >
                                  {ln.text}
                                </p>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Slide-Up Lyrics Overlay (Mobile Spotify-Lyrics Style!) */}
              <AnimatePresence>
                {showLyrics && (
                  <motion.div
                    initial={{ y: '100%' }}
                    animate={{ y: 0 }}
                    exit={{ y: '100%' }}
                    transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
                    className="lg:hidden absolute inset-x-0 bottom-0 top-16 z-20 rounded-t-3xl bg-[#faf7f6] dark:bg-[#130f0f] border-t border-slate-200/80 dark:border-white/10 flex flex-col"
                  >
                    <div className="px-5 py-3.5 flex items-center justify-between gap-2 shrink-0">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                          {displayTrackTitle}
                        </p>
                        <p className="text-[11px] text-slate-400 dark:text-zinc-500 truncate">
                          {authorDisplayName}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={handleOpenOrCreateLyricsInEditor}
                          title="Éditer dans Textes"
                          aria-label="Éditer dans Textes"
                          className="h-8 w-8 rounded-full flex items-center justify-center text-slate-500 dark:text-zinc-400 hover:bg-slate-900/8 dark:hover:bg-white/10 cursor-pointer"
                        >
                          <Edit3 size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowLyrics(false)}
                          className="h-8 w-8 rounded-full flex items-center justify-center text-slate-500 dark:text-zinc-400 hover:bg-slate-900/8 dark:hover:bg-white/10 cursor-pointer"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    </div>

                    <div
                      data-queue-scroll="true"
                      style={{
                        touchAction: 'pan-y',
                        maskImage:
                          'linear-gradient(to bottom, transparent 0%, black 10%, black 88%, transparent 100%)',
                        WebkitMaskImage:
                          'linear-gradient(to bottom, transparent 0%, black 10%, black 88%, transparent 100%)',
                      }}
                      className="flex-1 overflow-y-auto overscroll-contain px-6 py-8 pb-[max(3rem,env(safe-area-inset-bottom))] select-text"
                    >
                      {(() => {
                        const writtenBlocks = playerLyricsBlocks
                          ? playerLyricsBlocks.filter((b) =>
                              b.lines.some((ln) => ln.text.trim().length > 0)
                            )
                          : null;
                        const cleanPlainLines = desktopLyricsLines.filter((ln) =>
                          ln.text.trim().length > 0
                        );
                        const hasListenerLyrics = Boolean(
                          linkedLyrics &&
                            ((writtenBlocks && writtenBlocks.length > 0) ||
                              cleanPlainLines.length > 0)
                        );

                        if (!hasListenerLyrics) {
                          return (
                            <div className="h-full flex flex-col items-center justify-center text-center gap-3 py-12 text-slate-400 dark:text-zinc-500">
                              <FileText size={28} className="opacity-40" />
                              <p className="text-sm">Aucune parole disponible.</p>
                              <button
                                type="button"
                                onClick={handleOpenOrCreateLyricsInEditor}
                                className="inline-flex items-center gap-1.5 rounded-full bg-[#8C271E] text-white px-4 py-2 text-xs font-semibold cursor-pointer"
                              >
                                <Edit3 size={13} />
                                Écrire les paroles
                              </button>
                            </div>
                          );
                        }

                        if (writtenBlocks && writtenBlocks.length > 0) {
                          return (
                            <div className="space-y-7 py-16">
                              {writtenBlocks.map((b) => {
                                const isActive = activePlayerLyricsBlockIdx === b.index;
                                const isPast =
                                  activePlayerLyricsBlockIdx >= 0 &&
                                  b.index < activePlayerLyricsBlockIdx;
                                return (
                                  <button
                                    key={b.index}
                                    ref={(el) => {
                                      if (el) playerLyricsBlockRefs.current.set(b.index, el);
                                      else playerLyricsBlockRefs.current.delete(b.index);
                                    }}
                                    type="button"
                                    onClick={() => {
                                      seek(b.startSec);
                                      applyVisualFrame(b.startSec, effectiveDuration);
                                      triggerHapticTick(8);
                                    }}
                                    className={`w-full text-left transition-all duration-300 cursor-pointer space-y-1.5 ${
                                      isActive
                                        ? 'text-slate-950 dark:text-white opacity-100 scale-[1.01] origin-left'
                                        : isPast
                                        ? 'text-slate-900 dark:text-white opacity-28'
                                        : 'text-slate-900 dark:text-white opacity-42'
                                    }`}
                                  >
                                    {b.lines
                                      .filter((ln) => ln.text.trim().length > 0)
                                      .map((ln, lIdx) => (
                                        <p
                                          key={lIdx}
                                          className="text-[22px] font-bold leading-[1.42] tracking-tight whitespace-pre-wrap break-words"
                                        >
                                          {ln.text}
                                        </p>
                                      ))}
                                  </button>
                                );
                              })}
                            </div>
                          );
                        }

                        return (
                          <div className="space-y-3 py-4">
                            {cleanPlainLines.map((ln, idx) => (
                              <p
                                key={idx}
                                className="text-[21px] font-bold leading-[1.45] tracking-tight text-slate-900 dark:text-white/90 whitespace-pre-wrap break-words"
                              >
                                {ln.text}
                              </p>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Slide-Up Queue Overlay (Mobile) */}
              <AnimatePresence>
                {showQueue && queue.length > 0 && (
                  <motion.div
                    initial={{ y: '100%' }}
                    animate={{ y: 0 }}
                    exit={{ y: '100%' }}
                    transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
                    className="absolute inset-x-0 bottom-0 top-24 z-20 rounded-t-3xl bg-white dark:bg-[#131010] border-t border-slate-200/80 dark:border-white/10 flex flex-col"
                  >
                    <div className="px-5 py-3.5 border-b border-slate-200/80 dark:border-white/10 flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-zinc-300">
                        File d’attente ({queue.length})
                      </p>
                      <div className="flex items-center gap-1.5">
                        {queue.length > 1 && (
                          <button
                            type="button"
                            onClick={clearUpcomingQueue}
                            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold text-slate-500 dark:text-zinc-400 hover:text-rose-500 hover:bg-rose-500/10 transition cursor-pointer"
                          >
                            <Trash2 size={11} /> Vider
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setShowQueue(false)}
                          className="h-8 w-8 rounded-full flex items-center justify-center text-slate-500 dark:text-zinc-400 hover:bg-slate-900/8 dark:hover:bg-white/10 cursor-pointer"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    </div>
                    <div
                      data-queue-scroll="true"
                      style={{ touchAction: 'pan-y' }}
                      className="flex-1 overflow-y-auto px-3 py-3 space-y-1 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
                    >
                      {queue.map((t, i) => {
                        const active = t.id === currentTrack.id;
                        const isDragging = draggingQueueIdx === i;
                        const isDropTarget =
                          draggingQueueIdx !== null &&
                          dragOverQueueIdx === i &&
                          draggingQueueIdx !== i;
                        return (
                          <div
                            key={`${t.id}_${i}`}
                            ref={(el) => {
                              if (el) queueRowRefs.current.set(i, el);
                              else queueRowRefs.current.delete(i);
                            }}
                            className={`w-full flex items-center gap-1.5 rounded-xl px-2 py-2 transition ${
                              active
                                ? 'bg-[#8C271E]/12 dark:bg-[#8C271E]/28 text-[#8C271E] dark:text-[#F08B82] font-semibold'
                                : 'text-slate-600 dark:text-zinc-300 hover:bg-slate-900/5 dark:hover:bg-white/8'
                            } ${isDragging ? 'opacity-50 scale-[0.98]' : ''} ${
                              isDropTarget ? 'ring-2 ring-[#8C271E]/70' : ''
                            }`}
                          >
                            <button
                              type="button"
                              aria-label="Déplacer dans la file"
                              style={{ touchAction: 'none' }}
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                e.currentTarget.setPointerCapture(e.pointerId);
                                queueDragStateRef.current = {
                                  pointerId: e.pointerId,
                                  fromIdx: i,
                                  overIdx: i,
                                };
                                setDraggingQueueIdx(i);
                                setDragOverQueueIdx(i);
                                triggerHapticTick(8);
                              }}
                              onPointerMove={(e) => {
                                const st = queueDragStateRef.current;
                                if (!st || st.pointerId !== e.pointerId) return;
                                e.stopPropagation();
                                let bestIdx = st.overIdx;
                                for (let idx = 0; idx < queue.length; idx++) {
                                  const el = queueRowRefs.current.get(idx);
                                  if (!el) continue;
                                  const r = el.getBoundingClientRect();
                                  if (e.clientY >= r.top && e.clientY <= r.bottom) {
                                    bestIdx = idx;
                                    break;
                                  }
                                }
                                if (bestIdx !== st.overIdx) {
                                  st.overIdx = bestIdx;
                                  setDragOverQueueIdx(bestIdx);
                                  triggerHapticTick(6);
                                }
                              }}
                              onPointerUp={(e) => {
                                const st = queueDragStateRef.current;
                                if (!st || st.pointerId !== e.pointerId) return;
                                e.stopPropagation();
                                if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                                  e.currentTarget.releasePointerCapture(e.pointerId);
                                }
                                queueDragStateRef.current = null;
                                if (st.fromIdx !== st.overIdx) {
                                  moveInQueue(st.fromIdx, st.overIdx);
                                }
                                setDraggingQueueIdx(null);
                                setDragOverQueueIdx(null);
                              }}
                              onPointerCancel={() => {
                                queueDragStateRef.current = null;
                                setDraggingQueueIdx(null);
                                setDragOverQueueIdx(null);
                              }}
                              className="p-1.5 text-slate-400 active:text-slate-800 dark:active:text-zinc-100 cursor-grab active:cursor-grabbing shrink-0"
                            >
                              <GripVertical size={14} />
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                void playTrack(t, 0, queue);
                                triggerHapticTick(8);
                              }}
                              className="flex-1 min-w-0 flex items-center gap-2.5 text-left cursor-pointer"
                            >
                              <span className="font-mono text-[11px] opacity-55 w-5 shrink-0">
                                {String(i + 1).padStart(2, '0')}
                              </span>
                              <span className="text-sm font-medium truncate">
                                {t.manualGroupTitle || t.title}
                              </span>
                            </button>

                            {t.durationSec ? (
                              <span className="font-mono text-[11px] opacity-55 shrink-0">
                                {fmt(t.durationSec)}
                              </span>
                            ) : null}

                            {!active && (
                              <button
                                type="button"
                                onClick={() => {
                                  removeFromQueue(i);
                                  triggerHapticTick(6);
                                }}
                                aria-label="Retirer de la file"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 active:bg-rose-500/15 transition cursor-pointer shrink-0"
                              >
                                <X size={14} />
                              </button>
                            )}
                          </div>
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
