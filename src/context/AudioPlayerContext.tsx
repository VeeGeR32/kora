import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { MusicTrack } from '../types';
import { getMediaObjectUrl, saveMediaBlob } from '../lib/mediaDb';
import { downloadGoogleDriveAudioBlob, ensureGoogleDriveToken } from '../lib/googleDrive';
import { useApp } from './AppContext';

function shuffleTracksFisherYates(tracks: MusicTrack[], avoidFirstId?: string): MusicTrack[] {
  const arr = [...tracks];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  if (avoidFirstId && arr.length > 1 && arr[0].id === avoidFirstId) {
    const swapIdx = 1 + Math.floor(Math.random() * (arr.length - 1));
    [arr[0], arr[swapIdx]] = [arr[swapIdx], arr[0]];
  }
  return arr;
}

export type RepeatMode = 'off' | 'all' | 'one';

interface AudioPlayerContextValue {
  currentTrack: MusicTrack | null;
  queue: MusicTrack[];
  isPlaying: boolean;
  isLoadingTrack: boolean;
  currentTime: number;
  duration: number;
  loop: boolean;
  repeatMode: RepeatMode;
  shuffle: boolean;
  expanded: boolean;
  abLoop: { start: number | null; end: number | null };
  hasNext: boolean;
  hasPrev: boolean;
  getLiveTime: () => number;
  playTrack: (track: MusicTrack, startAtSec?: number, customQueue?: MusicTrack[]) => Promise<void>;
  playShuffled: (tracks: MusicTrack[]) => Promise<void>;
  restoreTrack: (track: MusicTrack, startAtSec?: number, shouldExpand?: boolean) => void;
  playNext: () => void;
  playPrev: () => void;
  togglePlay: () => void;
  pause: () => void;
  seek: (sec: number) => void;
  setLoop: (v: boolean) => void;
  setRepeatMode: (mode: RepeatMode) => void;
  cycleRepeatMode: () => void;
  toggleShuffle: () => void;
  setExpanded: (v: boolean) => void;
  setAbLoop: (ab: { start: number | null; end: number | null }) => void;
  closePlayer: () => void;
  syncTrackMetadata: (track: MusicTrack) => void;
  hasFullscreenOverlay: boolean;
  registerFullscreenOverlay: () => () => void;
  pendingOpenTrackId: string | null;
  requestOpenTrackPage: (trackId: string) => void;
  clearPendingOpenTrackPage: () => void;
}

const AudioPlayerContext = createContext<AudioPlayerContextValue | null>(null);

export function AudioPlayerProvider({ children }: { children: React.ReactNode }) {
  const { state, updateMusicTrack, updateLastSession, notify } = useApp();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pendingResumeSecRef = useRef<number | null>(null);
  const [currentTrack, setCurrentTrack] = useState<MusicTrack | null>(null);
  const [queue, setQueue] = useState<MusicTrack[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoadingTrack, setIsLoadingTrack] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('off');
  const [shuffle, setShuffle] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [overlayCount, setOverlayCount] = useState(0);
  const [pendingOpenTrackId, setPendingOpenTrackId] = useState<string | null>(null);
  const [abLoop, setAbLoop] = useState<{ start: number | null; end: number | null }>({
    start: null,
    end: null,
  });

  const registerFullscreenOverlay = useCallback(() => {
    setOverlayCount((c) => c + 1);
    return () => {
      setOverlayCount((c) => Math.max(0, c - 1));
    };
  }, []);
  const hasFullscreenOverlay = overlayCount > 0;

  // Lock background page scroll while any full-screen overlay or expanded player is open (prevents iOS Safari background scroll bleed-through)
  useEffect(() => {
    const locked = hasFullscreenOverlay || expanded;
    if (!locked) return;
    const html = document.documentElement;
    const body = document.body;
    const scrollY = window.scrollY;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const prevBodyPosition = body.style.position;
    const prevBodyTop = body.style.top;
    const prevBodyWidth = body.style.width;
    const prevBodyOverscroll = body.style.overscrollBehavior;

    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';
    body.style.overscrollBehavior = 'none';

    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
      body.style.position = prevBodyPosition;
      body.style.top = prevBodyTop;
      body.style.width = prevBodyWidth;
      body.style.overscrollBehavior = prevBodyOverscroll;
      window.scrollTo(0, scrollY);
    };
  }, [hasFullscreenOverlay, expanded]);
  const requestOpenTrackPage = useCallback((trackId: string) => {
    setPendingOpenTrackId(trackId);
  }, []);
  const clearPendingOpenTrackPage = useCallback(() => {
    setPendingOpenTrackId(null);
  }, []);

  const loop = repeatMode !== 'off';
  const setLoop = useCallback((v: boolean) => {
    setRepeatMode(v ? 'one' : 'off');
  }, []);

  const cycleRepeatMode = useCallback(() => {
    setRepeatMode((prev) => (prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off'));
  }, []);

  const repeatModeRef = useRef<RepeatMode>(repeatMode);
  const shuffleRef = useRef(shuffle);
  const abLoopRef = useRef(abLoop);
  const currentTrackRef = useRef(currentTrack);
  const queueRef = useRef(queue);
  const baseQueueRef = useRef<MusicTrack[]>([]);
  const playRequestIdRef = useRef(0);
  const lastReportedSecRef = useRef(-1);
  const playNextRef = useRef<() => void>(() => {});
  const playPrevRef = useRef<() => void>(() => {});
  // Instant in-memory ObjectURL cache + deduplicated in-flight downloads + active fetch abort
  const memoryUrlCacheRef = useRef<Map<string, string>>(new Map());
  const inFlightDownloadsRef = useRef<Map<string, Promise<string | null>>>(new Map());
  const activeFetchAbortRef = useRef<AbortController | null>(null);
  const driveTokenWarmedRef = useRef(false);

  useEffect(() => {
    repeatModeRef.current = repeatMode;
  }, [repeatMode]);
  useEffect(() => {
    shuffleRef.current = shuffle;
  }, [shuffle]);
  useEffect(() => {
    abLoopRef.current = abLoop;
  }, [abLoop]);
  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack]);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  // Keep queue in sync with library tracks if no custom project queue is active
  const effectiveQueue = queue.length > 0 ? queue : state.musicTracks;
  const currentIdx = currentTrack
    ? effectiveQueue.findIndex((t) => t.id === currentTrack.id)
    : -1;
  const hasNext =
    (effectiveQueue.length > 1 && currentIdx >= 0) || state.musicTracks.length > 1;
  const hasPrev = effectiveQueue.length > 1 && currentIdx >= 0;

  // Pre-warm Google Drive token silently on boot so the very first track click is instant
  useEffect(() => {
    if (driveTokenWarmedRef.current) return;
    const hasDriveTracks = state.musicTracks.some((t) => Boolean(t.googleDriveFileId));
    if (!hasDriveTracks) return;
    driveTokenWarmedRef.current = true;
    void ensureGoogleDriveToken(state.preferences.firebaseConfig).catch(() => {});
  }, [state.musicTracks, state.preferences.firebaseConfig]);

  // Fast track URL resolver with RAM cache -> IndexedDB -> Drive (non-blocking IDB save!)
  const resolveTrackAudioUrl = useCallback(
    async (track: MusicTrack, signal?: AbortSignal): Promise<string | null> => {
      const cacheKey = track.mediaId || (track.googleDriveFileId ? `drive_${track.googleDriveFileId}` : track.id);

      const memHit = memoryUrlCacheRef.current.get(cacheKey);
      if (memHit) return memHit;

      if (track.mediaId) {
        const idbUrl = await getMediaObjectUrl(track.mediaId);
        if (idbUrl) {
          memoryUrlCacheRef.current.set(cacheKey, idbUrl);
          return idbUrl;
        }
      }
      if (track.googleDriveFileId) {
        const driveIdbUrl = await getMediaObjectUrl(`drive_${track.googleDriveFileId}`);
        if (driveIdbUrl) {
          memoryUrlCacheRef.current.set(cacheKey, driveIdbUrl);
          return driveIdbUrl;
        }
      }
      if (track.cloudAudioUrl) {
        return track.cloudAudioUrl;
      }
      if (track.googleDriveFileId) {
        // Reuse an in-flight download (e.g. from lookahead pre-fetch!) instead of downloading twice
        const existingPromise = inFlightDownloadsRef.current.get(cacheKey);
        if (existingPromise) {
          return existingPromise;
        }

        const downloadPromise = (async (): Promise<string | null> => {
          try {
            const token = await ensureGoogleDriveToken(state.preferences.firebaseConfig);
            const blob = await downloadGoogleDriveAudioBlob(token, track.googleDriveFileId!, signal);
            // Play IMMEDIATELY from RAM ObjectURL (0ms!) and persist to IndexedDB in background
            const instantUrl = URL.createObjectURL(blob);
            memoryUrlCacheRef.current.set(cacheKey, instantUrl);
            void saveMediaBlob(cacheKey, blob, `${track.title}.mp3`).catch(() => {});
            return instantUrl;
          } catch (err) {
            if ((err as Error)?.name === 'AbortError') return null;
            throw err;
          } finally {
            inFlightDownloadsRef.current.delete(cacheKey);
          }
        })();

        inFlightDownloadsRef.current.set(cacheKey, downloadPromise);
        return downloadPromise;
      }
      return null;
    },
    [state.preferences.firebaseConfig]
  );

  // Silent lookahead prefetch: preloads the NEXT track in the queue in the background -> 0ms Next!
  const prefetchUpcomingTrack = useCallback(
    (currentId: string, activeQ: MusicTrack[]) => {
      if (activeQ.length <= 1) return;
      const idx = activeQ.findIndex((t) => t.id === currentId);
      if (idx < 0) return;
      const nextTrack = activeQ[idx + 1] || (repeatModeRef.current === 'all' ? activeQ[0] : null);
      if (!nextTrack || nextTrack.id === currentId) return;
      const cacheKey =
        nextTrack.mediaId ||
        (nextTrack.googleDriveFileId ? `drive_${nextTrack.googleDriveFileId}` : nextTrack.id);
      if (memoryUrlCacheRef.current.has(cacheKey) || inFlightDownloadsRef.current.has(cacheKey)) {
        return;
      }
      void resolveTrackAudioUrl(nextTrack).catch(() => {});
    },
    [resolveTrackAudioUrl]
  );

  const playTrack = useCallback(
    async (
      track: MusicTrack,
      startAtSec?: number,
      customQueue?: MusicTrack[],
      internalQueueSwap = false
    ) => {
      const audio = audioRef.current;
      if (!audio) return;

      const reqId = ++playRequestIdRef.current;

      // Cancel any previous in-flight Drive download so full bandwidth goes to this track
      if (activeFetchAbortRef.current) {
        activeFetchAbortRef.current.abort();
        activeFetchAbortRef.current = null;
      }

      const isDifferentTrack = currentTrackRef.current?.id !== track.id;

      // IMMEDIATELY silence & stop the current track when switching songs!
      if (isDifferentTrack) {
        audio.pause();
        audio.removeAttribute('src');
        setIsPlaying(false);
        setCurrentTime(startAtSec ?? 0);
        setDuration(track.durationSec || 0);
      }

      if (customQueue && customQueue.length > 0) {
        if (!internalQueueSwap) {
          baseQueueRef.current = customQueue;
          if (shuffleRef.current && customQueue.length > 1) {
            const rest = shuffleTracksFisherYates(
              customQueue.filter((t) => t.id !== track.id)
            );
            const nextQ = [track, ...rest];
            queueRef.current = nextQ;
            setQueue(nextQ);
          } else {
            queueRef.current = customQueue;
            setQueue(customQueue);
          }
        } else {
          queueRef.current = customQueue;
          setQueue(customQueue);
        }
      } else if (queueRef.current.length === 0 || !queueRef.current.some((t) => t.id === track.id)) {
        baseQueueRef.current = state.musicTracks;
        if (shuffleRef.current && state.musicTracks.length > 1) {
          const rest = shuffleTracksFisherYates(
            state.musicTracks.filter((t) => t.id !== track.id)
          );
          const nextQ = [track, ...rest];
          queueRef.current = nextQ;
          setQueue(nextQ);
        } else {
          queueRef.current = state.musicTracks;
          setQueue(state.musicTracks);
        }
      }

      // Immediately reflect track selection + clean player loading skeleton (if not already in RAM)
      currentTrackRef.current = track;
      setCurrentTrack(track);
      pendingResumeSecRef.current = null;
      lastReportedSecRef.current = -1;

      const cacheKey =
        track.mediaId || (track.googleDriveFileId ? `drive_${track.googleDriveFileId}` : track.id);
      const isInstantHit = Boolean(memoryUrlCacheRef.current.get(cacheKey) || track.cloudAudioUrl);
      if (!isInstantHit) {
        setIsLoadingTrack(true);
      }

      const abortController = new AbortController();
      activeFetchAbortRef.current = abortController;

      let src: string | null = null;
      try {
        src = await resolveTrackAudioUrl(track, abortController.signal);
      } catch (err) {
        if (reqId !== playRequestIdRef.current) return;
        setIsLoadingTrack(false);
        notify(`Google Drive : ${(err as Error).message}`);
      } finally {
        if (activeFetchAbortRef.current === abortController) {
          activeFetchAbortRef.current = null;
        }
      }
      if (reqId !== playRequestIdRef.current) return;

      if (!src) {
        audio.pause();
        audio.removeAttribute('src');
        setDuration(track.durationSec || 0);
        setCurrentTime(startAtSec ?? 0);
        setIsPlaying(false);
        setIsLoadingTrack(false);
        return;
      }

      const isSameSrc = audio.src === src;
      if (!isSameSrc) {
        audio.src = src;
        setDuration(track.durationSec || 0);
        setAbLoop({ start: null, end: null });
      }
      if (typeof startAtSec === 'number') {
        audio.currentTime = startAtSec;
        setCurrentTime(startAtSec);
      } else if (!isSameSrc) {
        setCurrentTime(0);
      }
      updateLastSession({
        audioTrackId: track.id,
        audioTimeSec: Math.round(typeof startAtSec === 'number' ? startAtSec : audio.currentTime || 0),
      });
      try {
        await audio.play();
        if (reqId === playRequestIdRef.current) {
          setIsPlaying(true);
          setIsLoadingTrack(false);
          // Silently prefetch the next track in the queue so the next skip is 0ms instant!
          prefetchUpcomingTrack(track.id, queueRef.current);
        }
      } catch {
        if (reqId === playRequestIdRef.current) {
          setIsPlaying(false);
          setIsLoadingTrack(false);
        }
      }
    },
    [state.musicTracks, resolveTrackAudioUrl, prefetchUpcomingTrack, notify, updateLastSession]
  );

  const playShuffled = useCallback(
    async (tracks: MusicTrack[]) => {
      if (tracks.length === 0) return;
      baseQueueRef.current = tracks;
      const shuffled = shuffleTracksFisherYates(tracks, currentTrackRef.current?.id);
      shuffleRef.current = true;
      setShuffle(true);
      await playTrack(shuffled[0], 0, shuffled, true);
    },
    [playTrack]
  );

  const toggleShuffle = useCallback(() => {
    const nextShuffle = !shuffleRef.current;
    shuffleRef.current = nextShuffle;
    setShuffle(nextShuffle);

    const cur = currentTrackRef.current;
    const base = baseQueueRef.current.length > 0 ? baseQueueRef.current : queueRef.current;
    if (base.length <= 1) return;

    if (nextShuffle) {
      const rest = cur
        ? shuffleTracksFisherYates(base.filter((t) => t.id !== cur.id))
        : shuffleTracksFisherYates(base);
      const nextQ = cur ? [cur, ...rest] : rest;
      queueRef.current = nextQ;
      setQueue(nextQ);
    } else {
      queueRef.current = base;
      setQueue(base);
    }
  }, []);

  const restoreTrack = useCallback(
    (track: MusicTrack, startAtSec = 0, shouldExpand = false) => {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
      }
      const clamped = Math.max(0, Math.round(startAtSec));
      pendingResumeSecRef.current = clamped;
      setCurrentTrack(track);
      setQueue((prev) => (prev.length > 0 ? prev : state.musicTracks));
      setCurrentTime(clamped);
      setDuration(track.durationSec || 0);
      setIsPlaying(false);
      setExpanded(Boolean(shouldExpand));
    },
    [state.musicTracks]
  );

  const playNext = useCallback(() => {
    const activeQ = queueRef.current.length > 0 ? queueRef.current : state.musicTracks;
    const cur = currentTrackRef.current;
    const idx = cur ? activeQ.findIndex((t) => t.id === cur.id) : -1;

    // 1. More tracks remain in the current queue (e.g. next song in project)
    if (idx >= 0 && idx < activeQ.length - 1) {
      void playTrack(activeQ[idx + 1], 0, activeQ, true);
      return;
    }

    // 2. End of queue reached:
    // If repeatMode === 'all', loop the current queue/project cleanly!
    if (repeatModeRef.current === 'all' && activeQ.length > 0) {
      if (shuffleRef.current && activeQ.length > 1) {
        const base = baseQueueRef.current.length > 0 ? baseQueueRef.current : activeQ;
        const reshuffled = shuffleTracksFisherYates(base, cur?.id);
        void playTrack(reshuffled[0], 0, reshuffled, true);
      } else {
        void playTrack(activeQ[0], 0, activeQ, true);
      }
      return;
    }

    // 3. No more tracks in queue (and not looping the project) -> play randomly from library without repeating!
    const playableLibrary = state.musicTracks.filter(
      (t) => Boolean(t.mediaId || t.cloudAudioUrl || t.googleDriveFileId)
    );
    const pool = playableLibrary.length > 0 ? playableLibrary : state.musicTracks;
    if (pool.length === 0) return;
    baseQueueRef.current = pool;
    const randomQueue = shuffleTracksFisherYates(pool, cur?.id);
    void playTrack(randomQueue[0], 0, randomQueue, true);
  }, [state.musicTracks, playTrack]);

  const playPrev = useCallback(() => {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      lastReportedSecRef.current = 0;
      setCurrentTime(0);
      return;
    }
    const activeQ = queueRef.current.length > 0 ? queueRef.current : state.musicTracks;
    if (activeQ.length === 0) return;
    const cur = currentTrackRef.current;
    const idx = cur ? activeQ.findIndex((t) => t.id === cur.id) : 0;
    const prevIdx = idx > 0 ? idx - 1 : activeQ.length - 1;
    void playTrack(activeQ[prevIdx], 0, activeQ, true);
  }, [state.musicTracks, playTrack]);

  useEffect(() => {
    playNextRef.current = playNext;
    playPrevRef.current = playPrev;
  }, [playNext, playPrev]);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audioRef.current = audio;

    const onTimeUpdate = () => {
      const t = audio.currentTime;
      const wholeSec = Math.floor(t);
      if (wholeSec !== lastReportedSecRef.current) {
        lastReportedSecRef.current = wholeSec;
        setCurrentTime(t);
      }
      const { start, end } = abLoopRef.current;
      if (end !== null && t >= end) {
        if (repeatModeRef.current !== 'off') {
          audio.currentTime = start ?? 0;
          void audio.play().catch(() => {});
        } else {
          audio.pause();
          setIsPlaying(false);
        }
      }
    };

    const onLoadedMeta = () => {
      if (isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
        const cur = currentTrackRef.current;
        if (cur && !cur.durationSec) {
          updateMusicTrack(cur.id, { durationSec: Math.round(audio.duration) });
        }
      }
    };

    const onEnded = () => {
      if (repeatModeRef.current === 'one') {
        audio.currentTime = abLoopRef.current.start ?? 0;
        void audio.play().catch(() => {});
      } else {
        playNextRef.current();
      }
    };

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMeta);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);

    return () => {
      audio.pause();
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMeta);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
    };
  }, []);

  // Keep currentTrack metadata live-synced when renamed/favorited/edited in AppContext
  useEffect(() => {
    setCurrentTrack((prev) => {
      if (!prev) return prev;
      const latest = state.musicTracks.find((t) => t.id === prev.id);
      if (!latest || latest === prev) return prev;
      return latest;
    });
  }, [state.musicTracks]);

  // Native iOS Lock Screen & AirPods MediaSession integration
  useEffect(() => {
    if (!currentTrack || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.manualGroupTitle || currentTrack.title,
        artist: state.preferences.name || currentTrack.artist || 'Kora Music',
      });
      navigator.mediaSession.setActionHandler('play', () => void audioRef.current?.play().catch(() => {}));
      navigator.mediaSession.setActionHandler('pause', () => audioRef.current?.pause());
      navigator.mediaSession.setActionHandler('previoustrack', () => playPrevRef.current());
      navigator.mediaSession.setActionHandler('nexttrack', () => playNextRef.current());
    } catch {
      // ignore unsupported handlers
    }
  }, [currentTrack]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.src) {
      const cur = currentTrackRef.current;
      if (cur) {
        void playTrack(cur, pendingResumeSecRef.current ?? 0);
      }
      return;
    }
    if (audio.paused) {
      void audio.play().catch(() => {});
    } else {
      audio.pause();
      if (currentTrackRef.current) {
        updateLastSession({
          audioTrackId: currentTrackRef.current.id,
          audioTimeSec: Math.round(audio.currentTime || 0),
        });
      }
    }
  }, [playTrack, updateLastSession]);

  const pause = useCallback(() => {
    const audio = audioRef.current;
    audio?.pause();
    if (audio && currentTrackRef.current) {
      updateLastSession({
        audioTrackId: currentTrackRef.current.id,
        audioTimeSec: Math.round(audio.currentTime || 0),
      });
    }
  }, [updateLastSession]);

  const seek = useCallback(
    (sec: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      const maxDur = audio.duration || currentTrackRef.current?.durationSec || sec;
      const clamped = Math.max(0, Math.min(maxDur, sec));
      if (audio.src) {
        audio.currentTime = clamped;
      } else {
        pendingResumeSecRef.current = clamped;
      }
      setCurrentTime(clamped);
      if (currentTrackRef.current) {
        updateLastSession({
          audioTrackId: currentTrackRef.current.id,
          audioTimeSec: Math.round(clamped),
        });
      }
    },
    [updateLastSession]
  );

  const setExpandedSynced = useCallback(
    (v: boolean) => {
      setExpanded(v);
      if (currentTrackRef.current) {
        updateLastSession({ audioExpanded: v });
      }
    },
    [updateLastSession]
  );

  const closePlayer = useCallback(() => {
    if (activeFetchAbortRef.current) {
      activeFetchAbortRef.current.abort();
      activeFetchAbortRef.current = null;
    }
    ++playRequestIdRef.current;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
    }
    pendingResumeSecRef.current = null;
    setCurrentTrack(null);
    setExpanded(false);
    setIsPlaying(false);
    setIsLoadingTrack(false);
    setCurrentTime(0);
    setDuration(0);
    setAbLoop({ start: null, end: null });
    updateLastSession({
      audioTrackId: undefined,
      audioTimeSec: undefined,
      audioExpanded: false,
    });
  }, [updateLastSession]);

  const getLiveTime = useCallback(() => {
    const a = audioRef.current;
    if (a && a.src && isFinite(a.currentTime)) return a.currentTime;
    return pendingResumeSecRef.current ?? 0;
  }, []);

  // Periodically save playback timestamp while playing + on app hide/close for cross-device resume
  useEffect(() => {
    const persistNow = () => {
      const cur = currentTrackRef.current;
      if (!cur) return;
      const t = Math.round(getLiveTime());
      updateLastSession({
        audioTrackId: cur.id,
        audioTimeSec: t,
      });
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') persistNow();
    };
    window.addEventListener('pagehide', persistNow);
    document.addEventListener('visibilitychange', onHide);
    const timer = isPlaying ? window.setInterval(persistNow, 10_000) : null;
    return () => {
      window.removeEventListener('pagehide', persistNow);
      document.removeEventListener('visibilitychange', onHide);
      if (timer !== null) window.clearInterval(timer);
    };
  }, [isPlaying, getLiveTime, updateLastSession]);

  const syncTrackMetadata = useCallback((track: MusicTrack) => {
    setCurrentTrack((prev) => (prev && prev.id === track.id ? track : prev));
  }, []);

  const contextValue = useMemo<AudioPlayerContextValue>(
    () => ({
      currentTrack,
      queue: effectiveQueue,
      isPlaying,
      isLoadingTrack,
      currentTime,
      duration,
      loop,
      repeatMode,
      shuffle,
      expanded,
      abLoop,
      hasNext,
      hasPrev,
      getLiveTime,
      playTrack,
      playShuffled,
      restoreTrack,
      playNext,
      playPrev,
      togglePlay,
      pause,
      seek,
      setLoop,
      setRepeatMode,
      cycleRepeatMode,
      toggleShuffle,
      setExpanded: setExpandedSynced,
      setAbLoop,
      closePlayer,
      syncTrackMetadata,
      hasFullscreenOverlay,
      registerFullscreenOverlay,
      pendingOpenTrackId,
      requestOpenTrackPage,
      clearPendingOpenTrackPage,
    }),
    [
      currentTrack,
      effectiveQueue,
      isPlaying,
      isLoadingTrack,
      currentTime,
      duration,
      loop,
      repeatMode,
      shuffle,
      expanded,
      abLoop,
      hasNext,
      hasPrev,
      getLiveTime,
      playTrack,
      playShuffled,
      restoreTrack,
      playNext,
      playPrev,
      togglePlay,
      pause,
      seek,
      setLoop,
      cycleRepeatMode,
      toggleShuffle,
      setExpandedSynced,
      closePlayer,
      syncTrackMetadata,
      hasFullscreenOverlay,
      registerFullscreenOverlay,
      pendingOpenTrackId,
      requestOpenTrackPage,
      clearPendingOpenTrackPage,
    ]
  );

  return (
    <AudioPlayerContext.Provider value={contextValue}>
      {children}
    </AudioPlayerContext.Provider>
  );
}

export function useAudioPlayer() {
  const ctx = useContext(AudioPlayerContext);
  if (!ctx) throw new Error('useAudioPlayer must be used inside AudioPlayerProvider');
  return ctx;
}
