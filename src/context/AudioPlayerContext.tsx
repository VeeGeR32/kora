import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { LivePlaybackCommand, LivePlaybackState, MusicTrack } from '../types';
import {
  deleteMediaBlob,
  formatBytes,
  getMediaBlob,
  getMediaObjectUrl,
  getOfflineTrackKey,
  listOfflineMediaMeta,
  saveMediaBlob,
} from '../lib/mediaDb';
import { downloadGoogleDriveAudioBlob, ensureGoogleDriveToken } from '../lib/googleDrive';
import { getLocalDeviceInfo, type LocalDeviceInfo } from '../lib/deviceIdentity';
import { groupMusicTracks } from '../lib/musicVersioning';
import {
  analyzeTrackAudioUrl,
  isTrackAnalyzed,
  type TrackAudioAnalysis,
} from '../lib/audioAnalyzer';
import { useApp } from './AppContext';

function shuffleTracksFisherYates(
  tracks: MusicTrack[],
  avoidGroupKeys?: Set<string>,
  groupKeyOf?: (t: MusicTrack) => string
): MusicTrack[] {
  const arr = [...tracks];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  if (avoidGroupKeys && avoidGroupKeys.size > 0 && arr.length > 1) {
    const getKey = (t: MusicTrack) => (groupKeyOf ? groupKeyOf(t) : t.id);
    if (avoidGroupKeys.has(getKey(arr[0]))) {
      const freshIdx = arr.findIndex((t, idx) => idx > 0 && !avoidGroupKeys.has(getKey(t)));
      const swapIdx = freshIdx > 0 ? freshIdx : 1 + Math.floor(Math.random() * (arr.length - 1));
      [arr[0], arr[swapIdx]] = [arr[swapIdx], arr[0]];
    }
  }
  return arr;
}

function getTrackCacheKey(track: MusicTrack): string {
  return track.mediaId || (track.googleDriveFileId ? `drive_${track.googleDriveFileId}` : track.id);
}

const MAX_RAM_AUDIO_CACHE = 24;

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
  addToQueue: (track: MusicTrack, position?: 'next' | 'end') => void;
  removeFromQueue: (index: number) => void;
  moveInQueue: (fromIndex: number, toIndex: number) => void;
  clearUpcomingQueue: () => void;
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
  pendingOpenLyricsDocId: string | null;
  requestOpenLyricsDoc: (docId: string) => void;
  clearPendingOpenLyricsDoc: () => void;
  pendingOpenProjectId: string | null;
  requestOpenProjectPage: (projectId: string) => void;
  clearPendingOpenProjectPage: () => void;
  pendingOpenProfileUid: string | null;
  requestOpenProfile: (uid?: string) => void;
  clearPendingOpenProfile: () => void;
  // Rowav Connect (Spotify Connect-style cross-device live playback & remote control)
  localDevice: LocalDeviceInfo;
  remoteDevice: { id: string; name: string; type: 'mobile' | 'tablet' | 'desktop' } | null;
  isRemotePlayback: boolean;
  transferToThisDevice: () => Promise<void>;
  // Automatic BPM, Key & 4-bar audio analysis
  analyzeTrackAudio: (
    track: MusicTrack,
    options?: { force?: boolean; knownUrl?: string }
  ) => Promise<TrackAudioAnalysis | null>;
  // Persistent Offline Storage (IndexedDB)
  offlineTrackSizes: Record<string, number>;
  downloadingOfflineIds: Set<string>;
  downloadTrackOffline: (track: MusicTrack) => Promise<boolean>;
  removeTrackOffline: (trackId: string) => Promise<void>;
  downloadProjectOffline: (tracks: MusicTrack[], projectTitle?: string) => Promise<void>;
}

const AudioPlayerContext = createContext<AudioPlayerContextValue | null>(null);

export function AudioPlayerProvider({ children }: { children: React.ReactNode }) {
  const {
    state,
    updateMusicTrack,
    updateLastSession,
    livePlayback,
    liveCommand,
    publishLivePlayback,
    publishLiveCommand,
    notify,
  } = useApp();
  const localDevice = useMemo(() => getLocalDeviceInfo(), []);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pendingResumeSecRef = useRef<number | null>(null);
  const [currentTrack, setCurrentTrack] = useState<MusicTrack | null>(null);
  const [queue, setQueue] = useState<MusicTrack[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoadingTrack, setIsLoadingTrack] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [repeatMode, setRepeatModeState] = useState<RepeatMode>('off');
  const [shuffle, setShuffle] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [overlayCount, setOverlayCount] = useState(0);
  const [pendingOpenTrackId, setPendingOpenTrackId] = useState<string | null>(null);
  const [pendingOpenLyricsDocId, setPendingOpenLyricsDocId] = useState<string | null>(null);
  const [pendingOpenProjectId, setPendingOpenProjectId] = useState<string | null>(null);
  const [pendingOpenProfileUid, setPendingOpenProfileUid] = useState<string | null>(null);
  const [remoteSession, setRemoteSession] = useState<LivePlaybackState | null>(null);
  const [abLoop, setAbLoop] = useState<{ start: number | null; end: number | null }>({
    start: null,
    end: null,
  });
  const [offlineTrackSizes, setOfflineTrackSizes] = useState<Record<string, number>>({});
  const [downloadingOfflineIds, setDownloadingOfflineIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let alive = true;
    void listOfflineMediaMeta().then((meta) => {
      if (alive) setOfflineTrackSizes(meta);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Deduplicated song catalog (1 entry per song group = latest version) so auto-play / shuffle NEVER replays v1/v2/v3 back-to-back!
  const { dedupedLibraryTracks, groupKeyByTrackId } = useMemo(() => {
    const groups = groupMusicTracks(state.musicTracks);
    const keyMap = new Map<string, string>();
    const latestList: MusicTrack[] = [];
    for (const g of groups) {
      latestList.push(g.latestTrack);
      for (const id of g.allTrackIds) {
        keyMap.set(id, g.groupKey);
      }
    }
    return { dedupedLibraryTracks: latestList, groupKeyByTrackId: keyMap };
  }, [state.musicTracks]);

  const dedupedLibraryRef = useRef<MusicTrack[]>(dedupedLibraryTracks);
  const groupKeyMapRef = useRef<Map<string, string>>(groupKeyByTrackId);
  useEffect(() => {
    dedupedLibraryRef.current = dedupedLibraryTracks;
    groupKeyMapRef.current = groupKeyByTrackId;
  }, [dedupedLibraryTracks, groupKeyByTrackId]);

  const getGroupKey = useCallback((track: MusicTrack): string => {
    return groupKeyMapRef.current.get(track.id) || track.id;
  }, []);

  // Connect synchronization refs (monotonic claimSeq -> 100% immune to PC/iPhone clock skew!)
  const remoteSessionRef = useRef<LivePlaybackState | null>(null);
  const claimSeqRef = useRef<number>(0);
  const handledCommandIdsRef = useRef<Set<string>>(new Set());
  const suppressLocalPublishRef = useRef<boolean>(false);
  const pendingRemoteCmdRef = useRef<{
    id: string;
    type: LivePlaybackCommand['type'];
    sentAt: number;
  } | null>(null);
  const pendingAckCommandIdRef = useRef<string | undefined>(undefined);
  const lastAcceptedRemoteAtRef = useRef<number>(0);

  // Rolling history of recently played song groupKeys (prevents random repeats!)
  const recentGroupKeysRef = useRef<string[]>([]);
  const recordPlayedGroup = useCallback(
    (track: MusicTrack) => {
      const gk = getGroupKey(track);
      const next = [gk, ...recentGroupKeysRef.current.filter((k) => k !== gk)].slice(0, 18);
      recentGroupKeysRef.current = next;
    },
    [getGroupKey]
  );

  // Pre-selected fallback next track when on the last song of a queue (so we can prefetch it into RAM for iOS background!)
  const preselectedNextTrackRef = useRef<MusicTrack | null>(null);

  const registerFullscreenOverlay = useCallback(() => {
    setOverlayCount((c) => c + 1);
    return () => {
      setOverlayCount((c) => Math.max(0, c - 1));
    };
  }, []);
  const hasFullscreenOverlay = overlayCount > 0;

  // Lock background page scroll cleanly WITHOUT `position: fixed` or `window.scrollTo`
  // (changing body position/top caused the background tab to visibly jump/shift when minimizing the player!)
  useEffect(() => {
    const locked = hasFullscreenOverlay || expanded;
    if (!locked) return;
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const prevHtmlOverscroll = html.style.overscrollBehavior;
    const prevBodyOverscroll = body.style.overscrollBehavior;

    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    html.style.overscrollBehavior = 'none';
    body.style.overscrollBehavior = 'none';

    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
      html.style.overscrollBehavior = prevHtmlOverscroll;
      body.style.overscrollBehavior = prevBodyOverscroll;
    };
  }, [hasFullscreenOverlay, expanded]);

  const requestOpenTrackPage = useCallback((trackId: string) => {
    setPendingOpenTrackId(trackId);
  }, []);
  const clearPendingOpenTrackPage = useCallback(() => {
    setPendingOpenTrackId(null);
  }, []);
  const requestOpenLyricsDoc = useCallback((docId: string) => {
    setPendingOpenLyricsDocId(docId);
  }, []);
  const clearPendingOpenLyricsDoc = useCallback(() => {
    setPendingOpenLyricsDocId(null);
  }, []);
  const requestOpenProjectPage = useCallback((projectId: string) => {
    setPendingOpenProjectId(projectId);
  }, []);
  const clearPendingOpenProjectPage = useCallback(() => {
    setPendingOpenProjectId(null);
  }, []);
  const requestOpenProfile = useCallback((uid?: string) => {
    setPendingOpenProfileUid(uid || 'me');
  }, []);
  const clearPendingOpenProfile = useCallback(() => {
    setPendingOpenProfileUid(null);
  }, []);

  const repeatModeRef = useRef<RepeatMode>(repeatMode);
  const shuffleRef = useRef(shuffle);
  const abLoopRef = useRef(abLoop);
  const currentTrackRef = useRef(currentTrack);
  const queueRef = useRef(queue);
  const baseQueueRef = useRef<MusicTrack[]>([]);
  const playRequestIdRef = useRef(0);
  const lastEndedReqIdRef = useRef(-1);
  const lastReportedSecRef = useRef(-1);
  const prefetchedNearEndForReqIdRef = useRef(-1);
  const playNextRef = useRef<() => void>(() => {});
  const playPrevRef = useRef<() => void>(() => {});
  const togglePlayRef = useRef<() => void>(() => {});
  const pauseRef = useRef<() => void>(() => {});
  const seekRef = useRef<(sec: number) => void>(() => {});
  // Instant in-memory ObjectURL LRU cache + deduplicated in-flight downloads + active fetch abort
  const memoryUrlCacheRef = useRef<Map<string, string>>(new Map());
  const inFlightDownloadsRef = useRef<Map<string, Promise<string | null>>>(new Map());
  const inFlightAnalysisRef = useRef<Map<string, Promise<TrackAudioAnalysis | null>>>(new Map());
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

  // Keep queue in sync with deduplicated library tracks if no custom project queue is active
  const effectiveQueue = queue.length > 0 ? queue : dedupedLibraryTracks;
  const currentIdx = currentTrack
    ? effectiveQueue.findIndex((t) => t.id === currentTrack.id)
    : -1;
  const hasNext =
    (effectiveQueue.length > 1 && currentIdx >= 0) || dedupedLibraryTracks.length > 1;
  const hasPrev = effectiveQueue.length > 1 && currentIdx >= 0;

  // Pre-warm Google Drive token silently on boot so the very first track click is instant
  useEffect(() => {
    if (driveTokenWarmedRef.current) return;
    const hasDriveTracks = state.musicTracks.some((t) => Boolean(t.googleDriveFileId));
    if (!hasDriveTracks) return;
    driveTokenWarmedRef.current = true;
    void ensureGoogleDriveToken(state.preferences.firebaseConfig).catch(() => {});
  }, [state.musicTracks, state.preferences.firebaseConfig]);

  // Helper to insert into RAM LRU cache without leaking Blob URLs on iOS Safari
  const putInMemoryUrlCache = useCallback((cacheKey: string, url: string) => {
    const cache = memoryUrlCacheRef.current;
    if (cache.has(cacheKey)) {
      cache.delete(cacheKey);
    }
    cache.set(cacheKey, url);

    if (cache.size > MAX_RAM_AUDIO_CACHE) {
      const protectedKeys = new Set<string>();
      const cur = currentTrackRef.current;
      if (cur) protectedKeys.add(getTrackCacheKey(cur));
      const activeQ = queueRef.current;
      const curIdx = cur ? activeQ.findIndex((t) => t.id === cur.id) : -1;
      if (curIdx >= 0) {
        for (let offset = 1; offset <= 2; offset++) {
          const nextT = activeQ[curIdx + offset];
          if (nextT) protectedKeys.add(getTrackCacheKey(nextT));
        }
      }
      if (preselectedNextTrackRef.current) {
        protectedKeys.add(getTrackCacheKey(preselectedNextTrackRef.current));
      }

      for (const [k, oldUrl] of cache.entries()) {
        if (cache.size <= MAX_RAM_AUDIO_CACHE) break;
        if (protectedKeys.has(k)) continue;
        cache.delete(k);
        if (oldUrl.startsWith('blob:')) {
          try {
            URL.revokeObjectURL(oldUrl);
          } catch {
            // ignore
          }
        }
      }
    }
  }, []);

  // Fast track URL resolver with RAM cache -> IndexedDB -> Drive (non-blocking IDB save!)
  const resolveTrackAudioUrl = useCallback(
    async (track: MusicTrack, signal?: AbortSignal): Promise<string | null> => {
      const cacheKey = getTrackCacheKey(track);

      const memHit = memoryUrlCacheRef.current.get(cacheKey);
      if (memHit) return memHit;

      const offlineUrl = await getMediaObjectUrl(getOfflineTrackKey(track.id));
      if (offlineUrl) {
        putInMemoryUrlCache(cacheKey, offlineUrl);
        return offlineUrl;
      }

      if (track.mediaId) {
        const idbUrl = await getMediaObjectUrl(track.mediaId);
        if (idbUrl) {
          putInMemoryUrlCache(cacheKey, idbUrl);
          return idbUrl;
        }
      }
      if (track.googleDriveFileId) {
        const driveIdbUrl = await getMediaObjectUrl(`drive_${track.googleDriveFileId}`);
        if (driveIdbUrl) {
          putInMemoryUrlCache(cacheKey, driveIdbUrl);
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
            putInMemoryUrlCache(cacheKey, instantUrl);
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
    [state.preferences.firebaseConfig, putInMemoryUrlCache]
  );

  // Pick a fresh random non-repeating track from the deduplicated library
  const pickFreshLibraryTrack = useCallback(
    (currentTrackObj: MusicTrack | null): { next: MusicTrack; queue: MusicTrack[] } | null => {
      const allUnique = dedupedLibraryRef.current;
      const playable = allUnique.filter((t) =>
        Boolean(t.mediaId || t.cloudAudioUrl || t.googleDriveFileId)
      );
      const pool = playable.length > 0 ? playable : allUnique;
      if (pool.length === 0) return null;

      const curGroup = currentTrackObj ? getGroupKey(currentTrackObj) : null;
      const recentSet = new Set(recentGroupKeysRef.current);
      if (curGroup) recentSet.add(curGroup);

      // Prefer songs not played in the last ~18 tracks; if user listened to everything, only avoid the current song
      const freshCandidates = pool.filter((t) => !recentSet.has(getGroupKey(t)));
      const effectiveAvoid =
        freshCandidates.length > 0 ? recentSet : curGroup ? new Set([curGroup]) : undefined;

      const randomQueue = shuffleTracksFisherYates(pool, effectiveAvoid, getGroupKey);
      return { next: randomQueue[0], queue: randomQueue };
    },
    [getGroupKey]
  );

  // Automatic client-side BPM, Musical Key & 4-bar structure analyzer (deduplicated per track!)
  const analyzeTrackAudio = useCallback(
    async (
      track: MusicTrack,
      options?: { force?: boolean; knownUrl?: string }
    ): Promise<TrackAudioAnalysis | null> => {
      if (!options?.force && isTrackAnalyzed(track)) {
        return {
          durationSec: track.durationSec || 0,
          bpm: track.bpm!,
          musicalKey: track.musicalKey || '',
          barOffsetSec: track.barOffsetSec || 0,
          barBlockEnergies: track.barBlockEnergies || [],
          analyzedAt: track.audioAnalyzedAt || new Date().toISOString(),
        };
      }

      const existing = inFlightAnalysisRef.current.get(track.id);
      if (existing) return existing;

      const job = (async (): Promise<TrackAudioAnalysis | null> => {
        try {
          const url = options?.knownUrl || (await resolveTrackAudioUrl(track));
          if (!url) return null;
          const result = await analyzeTrackAudioUrl(url);
          // Persist onto the track (preserving any user-edited BPM/Key unless `force`)
          const patch: Partial<MusicTrack> = {
            durationSec: track.durationSec || Math.round(result.durationSec),
            bpm: options?.force || !track.bpm ? result.bpm : track.bpm,
            musicalKey: options?.force || !track.musicalKey ? result.musicalKey || undefined : track.musicalKey,
            barOffsetSec: result.barOffsetSec,
            barBlockEnergies: result.barBlockEnergies,
            audioAnalyzedAt: result.analyzedAt,
          };
          updateMusicTrack(track.id, patch);
          return result;
        } catch {
          return null;
        } finally {
          inFlightAnalysisRef.current.delete(track.id);
        }
      })();

      inFlightAnalysisRef.current.set(track.id, job);
      return job;
    },
    [resolveTrackAudioUrl, updateMusicTrack]
  );

  // Quiet background analyzer for tracks ALREADY cached locally in IndexedDB (0 network / 0 mobile data!)
  const cachedScanStartedRef = useRef(false);
  useEffect(() => {
    if (cachedScanStartedRef.current) return;
    const unanalyzed = dedupedLibraryTracks.filter((t) => !isTrackAnalyzed(t));
    if (unanalyzed.length === 0) return;
    cachedScanStartedRef.current = true;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      let scanned = 0;
      for (const trk of unanalyzed) {
        if (cancelled || scanned >= 20) break;
        const cacheKey = getTrackCacheKey(trk);
        const memHit = memoryUrlCacheRef.current.get(cacheKey);
        const localHit =
          memHit ||
          (trk.mediaId ? await getMediaObjectUrl(trk.mediaId) : null) ||
          (trk.googleDriveFileId ? await getMediaObjectUrl(`drive_${trk.googleDriveFileId}`) : null);
        if (!localHit) continue;
        putInMemoryUrlCache(cacheKey, localHit);
        await analyzeTrackAudio(trk, { knownUrl: localHit });
        scanned++;
        // Yield politely between tracks so UI stays 60fps
        await new Promise((r) => window.setTimeout(r, 350));
      }
    }, 5500);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [dedupedLibraryTracks, analyzeTrackAudio, putInMemoryUrlCache]);

  // Silent 2-track lookahead RAM prefetcher (guarantees 0ms synchronous swap on `ended` -> unbroken iOS PWA background audio!)
  const prefetchUpcomingTracks = useCallback(
    (currentId: string, activeQ: MusicTrack[]) => {
      const targets: MusicTrack[] = [];
      const idx = activeQ.findIndex((t) => t.id === currentId);

      if (idx >= 0) {
        if (idx + 1 < activeQ.length) targets.push(activeQ[idx + 1]);
        if (idx + 2 < activeQ.length) targets.push(activeQ[idx + 2]);
      }

      // If we are on the last track of the queue, also prefetch the loop-back or pre-selected random next track!
      if (targets.length === 0) {
        if (repeatModeRef.current === 'all' && activeQ.length > 1) {
          targets.push(activeQ[0]);
        } else {
          const cur = currentTrackRef.current;
          const existingPre = preselectedNextTrackRef.current;
          const isPreValid =
            existingPre &&
            existingPre.id !== currentId &&
            (!cur || getGroupKey(existingPre) !== getGroupKey(cur));
          if (isPreValid && existingPre) {
            targets.push(existingPre);
          } else {
            const picked = pickFreshLibraryTrack(cur);
            if (picked && picked.next.id !== currentId) {
              preselectedNextTrackRef.current = picked.next;
              targets.push(picked.next);
            }
          }
        }
      }

      for (const t of targets) {
        if (!t || t.id === currentId) continue;
        const cacheKey = getTrackCacheKey(t);
        if (memoryUrlCacheRef.current.has(cacheKey) || inFlightDownloadsRef.current.has(cacheKey)) {
          continue;
        }
        void resolveTrackAudioUrl(t).catch(() => {});
      }
    },
    [resolveTrackAudioUrl, getGroupKey, pickFreshLibraryTrack]
  );

  const publishLocalLive = useCallback(
    (
      overrides?: Partial<
        Pick<
          LivePlaybackState,
          'isPlaying' | 'positionSec' | 'durationSec' | 'trackId' | 'repeatMode' | 'shuffle' | 'ackCommandId'
        >
      >,
      bumpClaimSeq = false
    ) => {
      if (suppressLocalPublishRef.current || remoteSessionRef.current) return;
      const trk = currentTrackRef.current;
      const trackId = overrides?.trackId || trk?.id;
      if (!trackId) return;
      const audio = audioRef.current;
      const now = Date.now();
      const pos =
        typeof overrides?.positionSec === 'number'
          ? overrides.positionSec
          : audio && audio.src && isFinite(audio.currentTime)
          ? audio.currentTime
          : pendingResumeSecRef.current ?? 0;
      const dur =
        typeof overrides?.durationSec === 'number'
          ? overrides.durationSec
          : audio && isFinite(audio.duration) && audio.duration > 0
          ? audio.duration
          : trk?.durationSec || 0;
      const playing =
        typeof overrides?.isPlaying === 'boolean'
          ? overrides.isPlaying
          : Boolean(audio && audio.src && !audio.paused);

      const qIds = queueRef.current.slice(0, 60).map((t) => t.id);
      if (!qIds.includes(trackId)) qIds.unshift(trackId);

      if (bumpClaimSeq || claimSeqRef.current === 0) {
        claimSeqRef.current += 1;
      }

      const ackId = overrides?.ackCommandId ?? pendingAckCommandIdRef.current;
      if (ackId && pendingAckCommandIdRef.current === ackId) {
        pendingAckCommandIdRef.current = undefined;
      }

      const payload: LivePlaybackState = {
        activeDeviceId: localDevice.id,
        activeDeviceName: localDevice.name,
        activeDeviceType: localDevice.type,
        claimSeq: claimSeqRef.current,
        trackId,
        queueIds: qIds,
        isPlaying: playing,
        positionSec: Math.max(0, pos),
        durationSec: Math.max(0, dur),
        positionUpdatedAt: now,
        repeatMode: overrides?.repeatMode ?? repeatModeRef.current,
        shuffle: typeof overrides?.shuffle === 'boolean' ? overrides.shuffle : shuffleRef.current,
        ...(ackId ? { ackCommandId: ackId } : {}),
        updatedAt: now,
      };
      void publishLivePlayback(payload);
    },
    [localDevice, publishLivePlayback]
  );

  // Send remote control command to dedicated `liveCommand` field (NEVER touches `livePlayback` -> ZERO race conditions!)
  const sendRemoteCommand = useCallback(
    (
      type: LivePlaybackCommand['type'],
      extra?: {
        timeSec?: number;
        trackId?: string;
        queueIds?: string[];
        repeatMode?: RepeatMode;
        shuffle?: boolean;
      }
    ) => {
      const remote = remoteSessionRef.current;
      if (!remote) return;
      const now = Date.now();
      const cmd: LivePlaybackCommand = {
        id: `cmd_${Math.random().toString(36).slice(2, 9)}_${now.toString(36)}`,
        fromDeviceId: localDevice.id,
        targetDeviceId: remote.activeDeviceId,
        type,
        ...(typeof extra?.timeSec === 'number' ? { timeSec: extra.timeSec } : {}),
        ...(extra?.trackId ? { trackId: extra.trackId } : {}),
        ...(extra?.queueIds ? { queueIds: extra.queueIds } : {}),
        ...(extra?.repeatMode ? { repeatMode: extra.repeatMode } : {}),
        ...(typeof extra?.shuffle === 'boolean' ? { shuffle: extra.shuffle } : {}),
        issuedAt: now,
      };

      // Guard optimistic UI against stale pre-command heartbeats until active device ACKs `cmd.id`!
      pendingRemoteCmdRef.current = { id: cmd.id, type, sentAt: now };

      // Optimistic local mirror update so controls feel 0ms snappy while waiting for active device confirmation
      const elapsed = remote.isPlaying ? Math.max(0, (now - remote.positionUpdatedAt) / 1000) : 0;
      const curPos = Math.min(remote.durationSec || Infinity, remote.positionSec + elapsed);
      let nextRemote: LivePlaybackState = { ...remote };
      if (type === 'toggle') {
        nextRemote = {
          ...nextRemote,
          isPlaying: !remote.isPlaying,
          positionSec: curPos,
          positionUpdatedAt: now,
        };
        setIsPlaying(!remote.isPlaying);
      } else if (type === 'pause') {
        nextRemote = { ...nextRemote, isPlaying: false, positionSec: curPos, positionUpdatedAt: now };
        setIsPlaying(false);
      } else if (type === 'play') {
        nextRemote = { ...nextRemote, isPlaying: true, positionSec: curPos, positionUpdatedAt: now };
        setIsPlaying(true);
      } else if (type === 'seek' && typeof extra?.timeSec === 'number') {
        nextRemote = { ...nextRemote, positionSec: extra.timeSec, positionUpdatedAt: now };
        setCurrentTime(extra.timeSec);
      } else if (type === 'playTrack' && extra?.trackId) {
        nextRemote = {
          ...nextRemote,
          trackId: extra.trackId,
          queueIds: extra.queueIds || nextRemote.queueIds,
          isPlaying: true,
          positionSec: extra.timeSec ?? 0,
          positionUpdatedAt: now,
        };
        setIsPlaying(true);
      } else if (type === 'setRepeat' && extra?.repeatMode) {
        nextRemote = { ...nextRemote, repeatMode: extra.repeatMode };
        repeatModeRef.current = extra.repeatMode;
        setRepeatModeState(extra.repeatMode);
      } else if (type === 'setShuffle' && typeof extra?.shuffle === 'boolean') {
        nextRemote = { ...nextRemote, shuffle: extra.shuffle };
        shuffleRef.current = extra.shuffle;
        setShuffle(extra.shuffle);
      } else if (type === 'setQueue' && Array.isArray(extra?.queueIds)) {
        nextRemote = { ...nextRemote, queueIds: extra.queueIds };
      }
      remoteSessionRef.current = nextRemote;
      setRemoteSession(nextRemote);

      // Write ONLY to the isolated `liveCommand` slot!
      void publishLiveCommand(cmd);
    },
    [localDevice.id, publishLiveCommand]
  );

  const setRepeatMode = useCallback(
    (mode: RepeatMode) => {
      if (remoteSessionRef.current) {
        sendRemoteCommand('setRepeat', { repeatMode: mode });
        return;
      }
      repeatModeRef.current = mode;
      setRepeatModeState(mode);
      if (currentTrackRef.current) {
        publishLocalLive({ repeatMode: mode });
        prefetchUpcomingTracks(currentTrackRef.current.id, queueRef.current);
      }
    },
    [sendRemoteCommand, publishLocalLive, prefetchUpcomingTracks]
  );

  const loop = repeatMode !== 'off';
  const setLoop = useCallback(
    (v: boolean) => {
      setRepeatMode(v ? 'one' : 'off');
    },
    [setRepeatMode]
  );

  const cycleRepeatMode = useCallback(() => {
    const next: RepeatMode =
      repeatModeRef.current === 'off'
        ? 'all'
        : repeatModeRef.current === 'all'
        ? 'one'
        : 'off';
    setRepeatMode(next);
  }, [setRepeatMode]);

  const applyLocalShuffle = useCallback(
    (nextShuffle: boolean) => {
      shuffleRef.current = nextShuffle;
      setShuffle(nextShuffle);

      const cur = currentTrackRef.current;
      const base = baseQueueRef.current.length > 0 ? baseQueueRef.current : queueRef.current;
      if (base.length <= 1) return;

      if (nextShuffle) {
        const rest = cur
          ? shuffleTracksFisherYates(
              base.filter((t) => t.id !== cur.id),
              new Set([getGroupKey(cur)]),
              getGroupKey
            )
          : shuffleTracksFisherYates(base);
        const nextQ = cur ? [cur, ...rest] : rest;
        queueRef.current = nextQ;
        setQueue(nextQ);
      } else {
        queueRef.current = base;
        setQueue(base);
      }
      if (cur) {
        prefetchUpcomingTracks(cur.id, queueRef.current);
      }
    },
    [getGroupKey, prefetchUpcomingTracks]
  );

  const toggleShuffle = useCallback(() => {
    const nextShuffle = !shuffleRef.current;
    if (remoteSessionRef.current) {
      sendRemoteCommand('setShuffle', { shuffle: nextShuffle });
      return;
    }
    applyLocalShuffle(nextShuffle);
    if (currentTrackRef.current) {
      publishLocalLive({ shuffle: nextShuffle });
    }
  }, [sendRemoteCommand, applyLocalShuffle, publishLocalLive]);

  const playTrack = useCallback(
    async (
      track: MusicTrack,
      startAtSec?: number,
      customQueue?: MusicTrack[],
      internalQueueSwap = false,
      forceLocal = false
    ) => {
      // If controlling another device (Rowav Connect mode), send playTrack command to that device!
      if (!forceLocal && remoteSessionRef.current) {
        const qIds =
          customQueue && customQueue.length > 0
            ? customQueue.slice(0, 60).map((t) => t.id)
            : queueRef.current.length > 0
            ? queueRef.current.slice(0, 60).map((t) => t.id)
            : [track.id];
        currentTrackRef.current = track;
        setCurrentTrack(track);
        setCurrentTime(startAtSec ?? 0);
        setDuration(track.durationSec || 0);
        setIsPlaying(true);
        sendRemoteCommand('playTrack', {
          trackId: track.id,
          timeSec: startAtSec ?? 0,
          queueIds: qIds,
        });
        return;
      }

      // Claiming playback on this device (bump monotonic claimSeq so other devices respect it regardless of clock skew!)
      const wasRemote = Boolean(remoteSessionRef.current);
      remoteSessionRef.current = null;
      setRemoteSession(null);
      if (wasRemote || claimSeqRef.current === 0) {
        claimSeqRef.current += 1;
      }

      const audio = audioRef.current;
      if (!audio) return;

      const reqId = ++playRequestIdRef.current;
      prefetchedNearEndForReqIdRef.current = -1;
      preselectedNextTrackRef.current = null;

      // Cancel any previous in-flight Drive download so full bandwidth goes to this track
      if (activeFetchAbortRef.current) {
        activeFetchAbortRef.current.abort();
        activeFetchAbortRef.current = null;
      }

      const isDifferentTrack = currentTrackRef.current?.id !== track.id;

      // Update queue BEFORE playing (using deduplicated library tracks by default -> NO v1/v2/v3 back-to-back repeats!)
      if (customQueue && customQueue.length > 0) {
        // Deduplicate identical track IDs inside customQueue
        const seenIds = new Set<string>();
        const cleanCustom = customQueue.filter((t) => {
          if (seenIds.has(t.id)) return false;
          seenIds.add(t.id);
          return true;
        });
        if (!internalQueueSwap) {
          baseQueueRef.current = cleanCustom;
          if (shuffleRef.current && cleanCustom.length > 1) {
            const rest = shuffleTracksFisherYates(
              cleanCustom.filter((t) => t.id !== track.id),
              new Set([getGroupKey(track)]),
              getGroupKey
            );
            const nextQ = [track, ...rest];
            queueRef.current = nextQ;
            setQueue(nextQ);
          } else {
            queueRef.current = cleanCustom;
            setQueue(cleanCustom);
          }
        } else {
          queueRef.current = cleanCustom;
          setQueue(cleanCustom);
        }
      } else if (queueRef.current.length === 0 || !queueRef.current.some((t) => t.id === track.id)) {
        const clickedGroup = getGroupKey(track);
        // If current queue already contains another version of the same song, swap it in-place cleanly!
        if (queueRef.current.some((t) => getGroupKey(t) === clickedGroup)) {
          const swapped = queueRef.current.map((t) => (getGroupKey(t) === clickedGroup ? track : t));
          const dedupedSwapped: MusicTrack[] = [];
          const seenKeys = new Set<string>();
          for (const item of swapped) {
            const k = getGroupKey(item);
            if (seenKeys.has(k)) continue;
            seenKeys.add(k);
            dedupedSwapped.push(item);
          }
          queueRef.current = dedupedSwapped;
          baseQueueRef.current = dedupedSwapped;
          setQueue(dedupedSwapped);
        } else {
          const libPool = dedupedLibraryRef.current.length > 0 ? dedupedLibraryRef.current : state.musicTracks;
          // Replace the song's group entry with the exact clicked track version so there's only 1 entry for this song!
          const withoutSameGroup = libPool.filter(
            (t) => t.id !== track.id && getGroupKey(t) !== clickedGroup
          );
          const orderedBase = [track, ...withoutSameGroup];
          baseQueueRef.current = orderedBase;
          if (shuffleRef.current && orderedBase.length > 1) {
            const rest = shuffleTracksFisherYates(withoutSameGroup, new Set([clickedGroup]), getGroupKey);
            const nextQ = [track, ...rest];
            queueRef.current = nextQ;
            setQueue(nextQ);
          } else {
            queueRef.current = orderedBase;
            setQueue(orderedBase);
          }
        }
      }

      // Immediately update track metadata & history
      currentTrackRef.current = track;
      setCurrentTrack(track);
      recordPlayedGroup(track);
      pendingResumeSecRef.current = null;
      lastReportedSecRef.current = -1;
      if (isDifferentTrack) {
        setAbLoop({ start: null, end: null });
        setCurrentTime(startAtSec ?? 0);
        setDuration(track.durationSec || 0);
      }

      // CRITICAL FOR iOS PWA BACKGROUND AUDIO:
      // Check RAM ObjectURL cache SYNCHRONOUSLY before ANY `await`!
      // When switching tracks on `ended` in the background, swapping `audio.src` and calling `audio.play()`
      // synchronously with ZERO `await`s keeps iOS's native AVAudioSession continuously alive!
      const cacheKey = getTrackCacheKey(track);
      const instantSrc = memoryUrlCacheRef.current.get(cacheKey) || track.cloudAudioUrl || null;

      let src: string | null = instantSrc;

      if (!src) {
        // Track is not in RAM yet -> show loading indicator WITHOUT stripping `audio.src` (which kills iOS background audio!)
        if (isDifferentTrack && !audio.ended) {
          suppressLocalPublishRef.current = true;
          audio.pause();
          suppressLocalPublishRef.current = false;
          setIsPlaying(false);
        }
        setIsLoadingTrack(true);

        const abortController = new AbortController();
        activeFetchAbortRef.current = abortController;

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
      }

      if (!src) {
        audio.pause();
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
      }
      if (typeof startAtSec === 'number') {
        try {
          audio.currentTime = startAtSec;
        } catch {
          // Will seek once metadata is ready
        }
        setCurrentTime(startAtSec);
      } else if (!isSameSrc) {
        setCurrentTime(0);
      }

      // Call audio.play() IMMEDIATELY (still synchronous when `instantSrc` hit!)
      const playPromise = audio.play();

      updateLastSession({
        audioTrackId: track.id,
        audioTimeSec: Math.round(typeof startAtSec === 'number' ? startAtSec : 0),
      });

      try {
        await playPromise;
        if (reqId === playRequestIdRef.current) {
          setIsPlaying(true);
          setIsLoadingTrack(false);
          publishLocalLive(
            {
              trackId: track.id,
              isPlaying: true,
              positionSec: typeof startAtSec === 'number' ? startAtSec : audio.currentTime || 0,
              durationSec:
                isFinite(audio.duration) && audio.duration > 0
                  ? audio.duration
                  : track.durationSec || 0,
            },
            wasRemote
          );
          // Prefetch next 2 tracks into RAM so the next transition is 0ms synchronous (even with screen locked!)
          prefetchUpcomingTracks(track.id, queueRef.current);
          // Automatically detect BPM, musical Key & 4-bar energy structure in the background for every played track!
          if (!isTrackAnalyzed(track) && src) {
            void analyzeTrackAudio(track, { knownUrl: src });
          }
        }
      } catch {
        if (reqId === playRequestIdRef.current) {
          setIsPlaying(false);
          setIsLoadingTrack(false);
          publishLocalLive({
            trackId: track.id,
            isPlaying: false,
            positionSec: typeof startAtSec === 'number' ? startAtSec : audio.currentTime || 0,
          });
        }
      }
    },
    [
      state.musicTracks,
      resolveTrackAudioUrl,
      prefetchUpcomingTracks,
      notify,
      updateLastSession,
      publishLocalLive,
      sendRemoteCommand,
      getGroupKey,
      recordPlayedGroup,
      analyzeTrackAudio,
    ]
  );

  const playShuffled = useCallback(
    async (tracks: MusicTrack[]) => {
      if (tracks.length === 0) return;
      // Deduplicate by song groupKey (keeps only 1 version per song so shuffle never replays v1/v2/v3 back-to-back!)
      const seenGroups = new Set<string>();
      const uniqueTracks = tracks.filter((t) => {
        const gk = getGroupKey(t);
        if (seenGroups.has(gk)) return false;
        seenGroups.add(gk);
        return true;
      });
      const pool = uniqueTracks.length > 0 ? uniqueTracks : tracks;
      baseQueueRef.current = pool;
      const avoid = new Set<string>(recentGroupKeysRef.current);
      if (currentTrackRef.current) avoid.add(getGroupKey(currentTrackRef.current));
      const shuffled = shuffleTracksFisherYates(pool, avoid, getGroupKey);
      shuffleRef.current = true;
      setShuffle(true);
      await playTrack(shuffled[0], 0, shuffled, true);
    },
    [playTrack, getGroupKey]
  );

  const restoreTrack = useCallback(
    (track: MusicTrack, startAtSec = 0, shouldExpand = false) => {
      // Never clobber an active remote Connect session on startup restore!
      if (remoteSessionRef.current) return;
      const audio = audioRef.current;
      if (audio) {
        suppressLocalPublishRef.current = true;
        audio.pause();
        suppressLocalPublishRef.current = false;
      }
      const clamped = Math.max(0, Math.round(startAtSec));
      pendingResumeSecRef.current = clamped;
      currentTrackRef.current = track;
      setCurrentTrack(track);
      setAbLoop({ start: null, end: null });
      setQueue((prev) => (prev.length > 0 ? prev : dedupedLibraryRef.current));
      setCurrentTime(clamped);
      setDuration(track.durationSec || 0);
      setIsPlaying(false);
      setExpanded(Boolean(shouldExpand));
    },
    []
  );

  const playNext = useCallback(() => {
    if (remoteSessionRef.current) {
      sendRemoteCommand('next');
      return;
    }
    const activeQ = queueRef.current.length > 0 ? queueRef.current : dedupedLibraryRef.current;
    const cur = currentTrackRef.current;
    const curGroup = cur ? getGroupKey(cur) : null;
    const idx = cur ? activeQ.findIndex((t) => t.id === cur.id) : -1;

    // 1. More tracks remain in the current queue (skip accidental duplicate IDs)
    if (idx >= 0 && idx < activeQ.length - 1) {
      for (let i = idx + 1; i < activeQ.length; i++) {
        if (activeQ[i].id !== cur?.id) {
          void playTrack(activeQ[i], 0, activeQ, true, true);
          return;
        }
      }
    }

    // 2. End of queue reached:
    // If repeatMode === 'all' AND queue has > 1 distinct track, loop the current project/playlist cleanly!
    if (repeatModeRef.current === 'all' && activeQ.length > 1) {
      if (shuffleRef.current) {
        const base = baseQueueRef.current.length > 1 ? baseQueueRef.current : activeQ;
        const reshuffled = shuffleTracksFisherYates(
          base,
          curGroup ? new Set([curGroup]) : undefined,
          getGroupKey
        );
        void playTrack(reshuffled[0], 0, reshuffled, true, true);
      } else {
        const firstDifferent = activeQ.find((t) => t.id !== cur?.id) || activeQ[0];
        void playTrack(firstDifferent, 0, activeQ, true, true);
      }
      return;
    }

    // 3. End of queue (or 1-track queue) -> play the pre-fetched next song (or a fresh non-repeating library song!)
    const pre = preselectedNextTrackRef.current;
    preselectedNextTrackRef.current = null;
    if (pre && pre.id !== cur?.id && (!curGroup || getGroupKey(pre) !== curGroup)) {
      const picked = pickFreshLibraryTrack(cur);
      const rest = (picked?.queue || dedupedLibraryRef.current).filter(
        (t) => t.id !== pre.id && getGroupKey(t) !== getGroupKey(pre)
      );
      const nextQ = [pre, ...rest];
      baseQueueRef.current = nextQ;
      void playTrack(pre, 0, nextQ, true, true);
      return;
    }

    const picked = pickFreshLibraryTrack(cur);
    if (!picked) return;
    baseQueueRef.current = picked.queue;
    void playTrack(picked.next, 0, picked.queue, true, true);
  }, [playTrack, sendRemoteCommand, getGroupKey, pickFreshLibraryTrack]);

  const playPrev = useCallback(() => {
    if (remoteSessionRef.current) {
      sendRemoteCommand('prev');
      return;
    }
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      lastReportedSecRef.current = 0;
      setCurrentTime(0);
      publishLocalLive({ positionSec: 0 });
      return;
    }
    const activeQ = queueRef.current.length > 0 ? queueRef.current : dedupedLibraryRef.current;
    if (activeQ.length === 0) return;
    const cur = currentTrackRef.current;
    const idx = cur ? activeQ.findIndex((t) => t.id === cur.id) : 0;
    const prevIdx = idx > 0 ? idx - 1 : activeQ.length - 1;
    void playTrack(activeQ[prevIdx], 0, activeQ, true, true);
  }, [playTrack, sendRemoteCommand, publishLocalLive]);

  const togglePlay = useCallback(() => {
    if (remoteSessionRef.current) {
      // Idempotent remote command: explicitly send 'pause' or 'play' instead of ambiguous 'toggle'!
      sendRemoteCommand(remoteSessionRef.current.isPlaying ? 'pause' : 'play');
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.src) {
      const cur = currentTrackRef.current;
      if (cur) {
        void playTrack(cur, pendingResumeSecRef.current ?? 0, undefined, false, true);
      }
      return;
    }
    if (audio.paused) {
      void audio
        .play()
        .then(() => {
          publishLocalLive({ isPlaying: true }, true);
        })
        .catch(() => {});
    } else {
      audio.pause();
      publishLocalLive({ isPlaying: false, positionSec: audio.currentTime || 0 });
      if (currentTrackRef.current) {
        updateLastSession({
          audioTrackId: currentTrackRef.current.id,
          audioTimeSec: Math.round(audio.currentTime || 0),
        });
      }
    }
  }, [playTrack, updateLastSession, sendRemoteCommand, publishLocalLive]);

  const pause = useCallback(() => {
    if (remoteSessionRef.current) {
      sendRemoteCommand('pause');
      return;
    }
    const audio = audioRef.current;
    audio?.pause();
    if (audio && currentTrackRef.current) {
      publishLocalLive({ isPlaying: false, positionSec: audio.currentTime || 0 });
      updateLastSession({
        audioTrackId: currentTrackRef.current.id,
        audioTimeSec: Math.round(audio.currentTime || 0),
      });
    }
  }, [updateLastSession, sendRemoteCommand, publishLocalLive]);

  const seek = useCallback(
    (sec: number) => {
      if (remoteSessionRef.current) {
        const maxDur =
          remoteSessionRef.current.durationSec || currentTrackRef.current?.durationSec || sec;
        const clamped = Math.max(0, Math.min(maxDur, sec));
        sendRemoteCommand('seek', { timeSec: clamped });
        return;
      }
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
      publishLocalLive({ positionSec: clamped });
      if (currentTrackRef.current) {
        updateLastSession({
          audioTrackId: currentTrackRef.current.id,
          audioTimeSec: Math.round(clamped),
        });
      }
    },
    [updateLastSession, sendRemoteCommand, publishLocalLive]
  );

  useEffect(() => {
    playNextRef.current = playNext;
    playPrevRef.current = playPrev;
    togglePlayRef.current = togglePlay;
    pauseRef.current = pause;
    seekRef.current = seek;
  }, [playNext, playPrev, togglePlay, pause, seek]);

  // Attach listeners to the single persistent DOM <audio> element
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.preload = 'auto';

    const syncMediaSessionPosition = () => {
      if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
      if (typeof navigator.mediaSession.setPositionState !== 'function') return;
      if (!isFinite(audio.duration) || audio.duration <= 0) return;
      try {
        navigator.mediaSession.setPositionState({
          duration: audio.duration,
          playbackRate: audio.playbackRate || 1,
          position: Math.max(0, Math.min(audio.duration, audio.currentTime || 0)),
        });
      } catch {
        // Ignore unsupported browsers
      }
    };

    const onTimeUpdate = () => {
      const t = audio.currentTime;
      const wholeSec = Math.floor(t);
      if (wholeSec !== lastReportedSecRef.current) {
        lastReportedSecRef.current = wholeSec;
        setCurrentTime(t);
      }

      // Near-end safety prefetch: 20s before track ends, ensure next 2 tracks are warm in RAM for iOS background swap!
      const reqId = playRequestIdRef.current;
      if (
        isFinite(audio.duration) &&
        audio.duration > 10 &&
        audio.duration - t <= 20 &&
        prefetchedNearEndForReqIdRef.current !== reqId &&
        currentTrackRef.current
      ) {
        prefetchedNearEndForReqIdRef.current = reqId;
        prefetchUpcomingTracks(currentTrackRef.current.id, queueRef.current);
      }

      const { start, end } = abLoopRef.current;
      if (start !== null && end !== null && end > start && t >= end) {
        audio.currentTime = start;
        if (audio.paused) void audio.play().catch(() => {});
      } else if (end !== null && t >= end) {
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
        syncMediaSessionPosition();
        const cur = currentTrackRef.current;
        if (cur && !cur.durationSec) {
          updateMusicTrack(cur.id, { durationSec: Math.round(audio.duration) });
        }
      }
    };

    const onEnded = () => {
      const reqId = playRequestIdRef.current;
      if (repeatModeRef.current === 'one') {
        audio.currentTime = abLoopRef.current.start ?? 0;
        void audio.play().catch(() => {});
        syncMediaSessionPosition();
        return;
      }
      // Strict guard: never trigger playNext twice for the same playback request!
      if (lastEndedReqIdRef.current === reqId) return;
      lastEndedReqIdRef.current = reqId;
      playNextRef.current();
    };

    const onPlay = () => {
      setIsPlaying(true);
      if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
        try {
          navigator.mediaSession.playbackState = 'playing';
        } catch {
          // ignore
        }
      }
      syncMediaSessionPosition();
    };

    const onPause = () => {
      setIsPlaying(false);
      if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
        try {
          navigator.mediaSession.playbackState = 'paused';
        } catch {
          // ignore
        }
      }
      syncMediaSessionPosition();
    };

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
  }, [prefetchUpcomingTracks, updateMusicTrack]);

  // Keep currentTrack metadata live-synced when renamed/favorited/edited in AppContext
  useEffect(() => {
    setCurrentTrack((prev) => {
      if (!prev) return prev;
      const latest = state.musicTracks.find((t) => t.id === prev.id);
      if (!latest || latest === prev) return prev;
      return latest;
    });
  }, [state.musicTracks]);

  // Native iOS Lock Screen, Control Center & AirPods MediaSession integration
  useEffect(() => {
    if (!currentTrack || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      const linkedProj = state.musicProjects.find(
        (p) => p.id === currentTrack.linkedProjectId || p.trackIds.includes(currentTrack.id)
      );
      const coverSrc =
        linkedProj?.coverDataUrl ||
        currentTrack.coverDataUrl ||
        currentTrack.cloudCoverUrl ||
        `${window.location.origin}/icon-512.png`;
      const artwork: MediaImage[] = coverSrc
        ? [{ src: coverSrc, sizes: '512x512', type: 'image/png' }]
        : [];

      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.manualGroupTitle || currentTrack.title,
        artist: state.preferences.name || currentTrack.artist || 'Rowav',
        album: linkedProj?.title || 'Rowav Studio',
        artwork,
      });
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';

      navigator.mediaSession.setActionHandler('play', () => {
        if (remoteSessionRef.current) {
          sendRemoteCommand('play');
        } else {
          const a = audioRef.current;
          if (a && a.src && a.paused) {
            void a
              .play()
              .then(() => publishLocalLive({ isPlaying: true }))
              .catch(() => {});
          } else {
            togglePlayRef.current();
          }
        }
      });
      navigator.mediaSession.setActionHandler('pause', () => pauseRef.current());
      navigator.mediaSession.setActionHandler('previoustrack', () => playPrevRef.current());
      navigator.mediaSession.setActionHandler('nexttrack', () => playNextRef.current());
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (typeof details.seekTime === 'number') {
          seekRef.current(details.seekTime);
        }
      });
      // IMPORTANT for iOS Lock Screen / Control Center / Dynamic Island:
      // Registering seekbackward/seekforward forces WebKit into "Podcast mode" (-10s/+10s)
      // and HIDES Previous/Next track buttons! Explicitly clearing them restores ⏮ / ⏭.
      navigator.mediaSession.setActionHandler('seekbackward', null);
      navigator.mediaSession.setActionHandler('seekforward', null);
    } catch {
      // ignore unsupported handlers
    }
  }, [currentTrack, isPlaying, state.preferences.name, state.musicProjects, sendRemoteCommand, publishLocalLive]);

  // Also ensure MediaSession playbackState reflects remote playback state cleanly
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = !currentTrack
        ? 'none'
        : isPlaying
        ? 'playing'
        : 'paused';
    } catch {
      // ignore
    }
  }, [currentTrack, isPlaying]);

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
    if (remoteSessionRef.current) {
      sendRemoteCommand('stop');
      remoteSessionRef.current = null;
      setRemoteSession(null);
      currentTrackRef.current = null;
      setCurrentTrack(null);
      setExpanded(false);
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      return;
    }
    if (activeFetchAbortRef.current) {
      activeFetchAbortRef.current.abort();
      activeFetchAbortRef.current = null;
    }
    ++playRequestIdRef.current;
    if (audioRef.current) {
      suppressLocalPublishRef.current = true;
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      suppressLocalPublishRef.current = false;
    }
    pendingResumeSecRef.current = null;
    currentTrackRef.current = null;
    setCurrentTrack(null);
    setExpanded(false);
    setIsPlaying(false);
    setIsLoadingTrack(false);
    setCurrentTime(0);
    setDuration(0);
    setAbLoop({ start: null, end: null });
    void publishLivePlayback(null);
    updateLastSession({
      audioTrackId: undefined,
      audioTimeSec: undefined,
      audioExpanded: false,
    });
  }, [updateLastSession, publishLivePlayback, sendRemoteCommand]);

  const getLiveTime = useCallback(() => {
    const r = remoteSessionRef.current;
    if (r) {
      const elapsed = r.isPlaying ? Math.max(0, (Date.now() - r.positionUpdatedAt) / 1000) : 0;
      const maxD = r.durationSec || currentTrackRef.current?.durationSec || Infinity;
      return Math.min(maxD, Math.max(0, r.positionSec + elapsed));
    }
    const a = audioRef.current;
    if (a && a.src && isFinite(a.currentTime)) return a.currentTime;
    return pendingResumeSecRef.current ?? 0;
  }, []);

  const transferToThisDevice = useCallback(async () => {
    const r = remoteSessionRef.current;
    const trk =
      (r ? state.musicTracks.find((t) => t.id === r.trackId) : null) || currentTrackRef.current;
    if (!trk) return;
    const liveSec = getLiveTime();
    const byId = new Map(state.musicTracks.map((t) => [t.id, t]));
    const remoteQueue = r
      ? r.queueIds.map((id) => byId.get(id)).filter((t): t is MusicTrack => Boolean(t))
      : queueRef.current;
    // Bump claimSeq strictly above remote's claimSeq so the old device yields cleanly & immediately!
    claimSeqRef.current = Math.max(claimSeqRef.current, r?.claimSeq ?? 0) + 1;
    remoteSessionRef.current = null;
    setRemoteSession(null);
    await playTrack(trk, liveSec, remoteQueue.length > 0 ? remoteQueue : undefined, true, true);
    publishLocalLive({
      trackId: trk.id,
      isPlaying: true,
      positionSec: liveSec,
    });
    notify(`Lecture transférée sur ${localDevice.name} ✓`);
  }, [state.musicTracks, getLiveTime, playTrack, publishLocalLive, localDevice.name, notify]);

  // =========================================================================
  // ROWAV CONNECT LISTENER 1: Live playback state (`livePlayback` channel)
  // =========================================================================
  useEffect(() => {
    if (!livePlayback) {
      pendingRemoteCmdRef.current = null;
      lastAcceptedRemoteAtRef.current = 0;
      if (remoteSessionRef.current) {
        remoteSessionRef.current = null;
        setRemoteSession(null);
        currentTrackRef.current = null;
        setCurrentTrack(null);
        setIsPlaying(false);
        setExpanded(false);
      }
      return;
    }

    const incomingSeq = livePlayback.claimSeq ?? 0;

    // CASE 1: WE are the active playback device!
    if (livePlayback.activeDeviceId === localDevice.id) {
      pendingRemoteCmdRef.current = null;
      lastAcceptedRemoteAtRef.current = 0;
      if (incomingSeq > claimSeqRef.current) {
        claimSeqRef.current = incomingSeq;
      }
      if (remoteSessionRef.current) {
        remoteSessionRef.current = null;
        setRemoteSession(null);
      }
      return;
    }

    // CASE 2: ANOTHER device is publishing live playback!
    const ageMs = Date.now() - livePlayback.updatedAt;
    // Ignore stale sessions (e.g. closed browser tab > 10m ago or paused > 5m ago)
    const maxStaleMs = livePlayback.isPlaying ? 10 * 60 * 1000 : 5 * 60 * 1000;
    if (ageMs > maxStaleMs) return;

    // Prevent stale/older claims from hijacking an actively playing local device (immune to clock skew!)
    const alreadyMirroringThisDevice =
      remoteSessionRef.current?.activeDeviceId === livePlayback.activeDeviceId;
    const localAudioActive = Boolean(audioRef.current && audioRef.current.src && !audioRef.current.paused);

    if (!alreadyMirroringThisDevice && incomingSeq > 0 && incomingSeq < claimSeqRef.current) {
      return;
    }
    // If local device is actively playing and incoming has the SAME seq (tie without explicit takeover), keep local!
    if (!alreadyMirroringThisDevice && localAudioActive && incomingSeq <= claimSeqRef.current) {
      return;
    }

    // Monotonic freshness guard for updates from the same remote device (blocks out-of-order Firestore vs BroadcastChannel echoes!)
    if (alreadyMirroringThisDevice && livePlayback.updatedAt < lastAcceptedRemoteAtRef.current) {
      return;
    }

    // Optimistic command ACK guard: while waiting (< 2.2s) for the active device to acknowledge our command,
    // ignore stale pre-command heartbeats so Play/Pause/Seek controls NEVER flicker back!
    const pending = pendingRemoteCmdRef.current;
    if (pending) {
      if (livePlayback.ackCommandId === pending.id || !alreadyMirroringThisDevice) {
        pendingRemoteCmdRef.current = null;
      } else if (Date.now() - pending.sentAt < 2200) {
        return;
      } else {
        pendingRemoteCmdRef.current = null;
      }
    }

    lastAcceptedRemoteAtRef.current = livePlayback.updatedAt;

    // Valid remote takeover or update -> adopt remote claimSeq and pause local audio silently
    if (incomingSeq > claimSeqRef.current) {
      claimSeqRef.current = incomingSeq;
    }
    if (audioRef.current && !audioRef.current.paused) {
      suppressLocalPublishRef.current = true;
      audioRef.current.pause();
      suppressLocalPublishRef.current = false;
    }

    const remoteTrack = state.musicTracks.find((t) => t.id === livePlayback.trackId);
    if (!remoteTrack) return;

    remoteSessionRef.current = livePlayback;
    setRemoteSession(livePlayback);
    currentTrackRef.current = remoteTrack;
    setCurrentTrack(remoteTrack);
    setAbLoop({ start: null, end: null });

    const byId = new Map(state.musicTracks.map((t) => [t.id, t]));
    const remoteQueue = (livePlayback.queueIds || [])
      .map((id) => byId.get(id))
      .filter((t): t is MusicTrack => Boolean(t));
    if (remoteQueue.length > 0) {
      queueRef.current = remoteQueue;
      setQueue(remoteQueue);
    }

    const elapsed = livePlayback.isPlaying
      ? Math.max(0, (Date.now() - livePlayback.positionUpdatedAt) / 1000)
      : 0;
    const dur = livePlayback.durationSec || remoteTrack.durationSec || 0;
    const pos = Math.min(dur || Infinity, Math.max(0, livePlayback.positionSec + elapsed));

    setDuration(dur);
    setCurrentTime(pos);
    setIsPlaying(livePlayback.isPlaying);
    setIsLoadingTrack(false);
    if (livePlayback.repeatMode) {
      repeatModeRef.current = livePlayback.repeatMode;
      setRepeatModeState(livePlayback.repeatMode);
    }
    if (typeof livePlayback.shuffle === 'boolean') {
      shuffleRef.current = livePlayback.shuffle;
      setShuffle(livePlayback.shuffle);
    }
  }, [livePlayback, localDevice.id, state.musicTracks]);

  // =========================================================================
  // ROWAV CONNECT LISTENER 2: Dedicated command channel (`liveCommand`)
  // Executed ONLY by the target active device.
  // Strict single-writer isolation: active device NEVER writes `liveCommand`
  // (eliminates rapid-click race conditions); instead it stamps `ackCommandId` on `livePlayback`!
  // =========================================================================
  useEffect(() => {
    const cmd = liveCommand || livePlayback?.command || null;
    if (!cmd || !cmd.id) return;
    if (cmd.targetDeviceId !== localDevice.id) return;
    if (cmd.fromDeviceId === localDevice.id) return;
    if (handledCommandIdsRef.current.has(cmd.id)) return;
    // Allow up to 2 minutes of clock skew between PC & iPhone
    if (Math.abs(Date.now() - cmd.issuedAt) > 120_000) return;

    handledCommandIdsRef.current.add(cmd.id);
    if (handledCommandIdsRef.current.size > 100) {
      const oldest = handledCommandIdsRef.current.values().next().value;
      if (oldest) handledCommandIdsRef.current.delete(oldest);
    }

    // Attach ACK ID so the remote controller knows immediately when this exact command completes
    pendingAckCommandIdRef.current = cmd.id;

    const audio = audioRef.current;
    if (cmd.type === 'toggle') {
      if (audio && audio.src) {
        if (audio.paused) {
          void audio
            .play()
            .then(() => publishLocalLive({ isPlaying: true, ackCommandId: cmd.id }))
            .catch(() => publishLocalLive({ isPlaying: false, ackCommandId: cmd.id }));
        } else {
          audio.pause();
          publishLocalLive({ isPlaying: false, positionSec: audio.currentTime || 0, ackCommandId: cmd.id });
        }
      } else if (currentTrackRef.current) {
        void playTrack(currentTrackRef.current, pendingResumeSecRef.current ?? 0, undefined, false, true);
      } else {
        pendingAckCommandIdRef.current = undefined;
      }
    } else if (cmd.type === 'play') {
      if (audio && audio.src) {
        void audio
          .play()
          .then(() => publishLocalLive({ isPlaying: true, ackCommandId: cmd.id }))
          .catch(() => publishLocalLive({ isPlaying: false, ackCommandId: cmd.id }));
      } else if (currentTrackRef.current) {
        void playTrack(currentTrackRef.current, pendingResumeSecRef.current ?? 0, undefined, false, true);
      } else {
        pendingAckCommandIdRef.current = undefined;
      }
    } else if (cmd.type === 'pause') {
      if (audio) {
        audio.pause();
      }
      publishLocalLive({
        isPlaying: false,
        positionSec: audio && audio.src ? audio.currentTime || 0 : pendingResumeSecRef.current ?? 0,
        ackCommandId: cmd.id,
      });
    } else if (cmd.type === 'seek' && typeof cmd.timeSec === 'number') {
      if (audio && audio.src) {
        audio.currentTime = cmd.timeSec;
      } else {
        pendingResumeSecRef.current = cmd.timeSec;
      }
      setCurrentTime(cmd.timeSec);
      publishLocalLive({ positionSec: cmd.timeSec, ackCommandId: cmd.id });
    } else if (cmd.type === 'next') {
      playNextRef.current();
    } else if (cmd.type === 'prev') {
      playPrevRef.current();
    } else if (cmd.type === 'setRepeat' && cmd.repeatMode) {
      repeatModeRef.current = cmd.repeatMode;
      setRepeatModeState(cmd.repeatMode);
      publishLocalLive({ repeatMode: cmd.repeatMode, ackCommandId: cmd.id });
    } else if (cmd.type === 'setShuffle' && typeof cmd.shuffle === 'boolean') {
      applyLocalShuffle(cmd.shuffle);
      publishLocalLive({ shuffle: cmd.shuffle, ackCommandId: cmd.id });
    } else if (cmd.type === 'playTrack' && cmd.trackId) {
      const targetTrack = state.musicTracks.find((t) => t.id === cmd.trackId);
      if (targetTrack) {
        const byId = new Map(state.musicTracks.map((t) => [t.id, t]));
        const targetQueue = cmd.queueIds
          ? cmd.queueIds.map((id) => byId.get(id)).filter((t): t is MusicTrack => Boolean(t))
          : undefined;
        void playTrack(
          targetTrack,
          typeof cmd.timeSec === 'number' ? cmd.timeSec : 0,
          targetQueue && targetQueue.length > 0 ? targetQueue : undefined,
          true,
          true
        );
      } else {
        publishLocalLive({ ackCommandId: cmd.id });
      }
    } else if (cmd.type === 'setQueue' && Array.isArray(cmd.queueIds)) {
      const byId = new Map(state.musicTracks.map((t) => [t.id, t]));
      const nextQ = cmd.queueIds
        .map((id) => byId.get(id))
        .filter((t): t is MusicTrack => Boolean(t));
      if (nextQ.length > 0) {
        queueRef.current = nextQ;
        baseQueueRef.current = nextQ;
        setQueue(nextQ);
        if (currentTrackRef.current) {
          prefetchUpcomingTracks(currentTrackRef.current.id, nextQ);
        }
      }
      publishLocalLive({ ackCommandId: cmd.id });
    } else if (cmd.type === 'stop') {
      pendingAckCommandIdRef.current = undefined;
      closePlayer();
    }
  }, [
    liveCommand,
    livePlayback?.command,
    localDevice.id,
    state.musicTracks,
    playTrack,
    publishLocalLive,
    applyLocalShuffle,
    closePlayer,
  ]);

  // Smooth 1Hz React clock update while mirroring a playing remote device (60fps rAF reads getLiveTime())
  useEffect(() => {
    if (!remoteSession || !remoteSession.isPlaying) return;
    const id = window.setInterval(() => {
      setCurrentTime(getLiveTime());
    }, 1000);
    return () => window.clearInterval(id);
  }, [remoteSession, getLiveTime]);

  // Lightweight Connect heartbeat (~350 bytes every 20s while playing locally) — NEVER triggers full appState pushes!
  useEffect(() => {
    const heartbeat = () => {
      if (remoteSessionRef.current) return;
      const cur = currentTrackRef.current;
      if (!cur) return;
      const audio = audioRef.current;
      if (audio && audio.src && !audio.paused) {
        publishLocalLive({ isPlaying: true, positionSec: audio.currentTime || 0 });
      }
    };
    const saveOnLeave = () => {
      if (remoteSessionRef.current) return;
      const cur = currentTrackRef.current;
      if (!cur) return;
      const t = Math.round(getLiveTime());
      updateLastSession({
        audioTrackId: cur.id,
        audioTimeSec: t,
      });
    };
    const pauseConnectOnTabClose = () => {
      if (remoteSessionRef.current) return;
      const cur = currentTrackRef.current;
      const audio = audioRef.current;
      if (cur && audio && audio.src && !audio.paused) {
        publishLocalLive({ isPlaying: false, positionSec: audio.currentTime || 0 });
      }
    };
    window.addEventListener('pagehide', saveOnLeave);
    window.addEventListener('beforeunload', pauseConnectOnTabClose);
    const timer = isPlaying && !remoteSession ? window.setInterval(heartbeat, 20_000) : null;
    return () => {
      window.removeEventListener('pagehide', saveOnLeave);
      window.removeEventListener('beforeunload', pauseConnectOnTabClose);
      if (timer !== null) window.clearInterval(timer);
    };
  }, [isPlaying, remoteSession, getLiveTime, updateLastSession, publishLocalLive]);

  const remoteDevice = useMemo(
    () =>
      remoteSession
        ? {
            id: remoteSession.activeDeviceId,
            name: remoteSession.activeDeviceName,
            type: remoteSession.activeDeviceType,
          }
        : null,
    [remoteSession]
  );
  const isRemotePlayback = Boolean(remoteDevice);

  const syncTrackMetadata = useCallback((track: MusicTrack) => {
    setCurrentTrack((prev) => (prev && prev.id === track.id ? track : prev));
  }, []);

  const addToQueue = useCallback(
    (track: MusicTrack, position: 'next' | 'end' = 'end') => {
      const label = track.manualGroupTitle || track.title;
      const cur = currentTrackRef.current;
      if (!cur) {
        void playTrack(track, 0, [track]);
        notify(`Lecture de « ${label} »`);
        return;
      }
      if (track.id === cur.id) {
        notify(`« ${label} » est déjà en cours de lecture`);
        return;
      }
      const base =
        queueRef.current.length > 0 ? [...queueRef.current] : [...dedupedLibraryRef.current];
      if (!base.some((t) => t.id === cur.id)) {
        base.unshift(cur);
      }
      const existingIdx = base.findIndex((t) => t.id === track.id);
      if (existingIdx >= 0) {
        base.splice(existingIdx, 1);
      }
      const curIdx = base.findIndex((t) => t.id === cur.id);
      if (position === 'next') {
        base.splice(Math.max(0, curIdx + 1), 0, track);
      } else {
        base.push(track);
      }
      queueRef.current = base;
      baseQueueRef.current = base;
      setQueue(base);
      if (remoteSessionRef.current) {
        sendRemoteCommand('setQueue', { queueIds: base.map((t) => t.id) });
      } else {
        publishLocalLive();
        prefetchUpcomingTracks(cur.id, base);
      }
      notify(
        position === 'next'
          ? `Lire ensuite : « ${label} » ✓`
          : `« ${label} » ajouté à la file d’attente ✓`
      );
    },
    [playTrack, publishLocalLive, prefetchUpcomingTracks, sendRemoteCommand, notify]
  );

  const removeFromQueue = useCallback(
    (index: number) => {
      const base =
        queueRef.current.length > 0 ? [...queueRef.current] : [...dedupedLibraryRef.current];
      if (index < 0 || index >= base.length) return;
      const cur = currentTrackRef.current;
      if (cur && base[index].id === cur.id) return;
      base.splice(index, 1);
      queueRef.current = base;
      baseQueueRef.current = base;
      setQueue(base);
      if (remoteSessionRef.current) {
        sendRemoteCommand('setQueue', { queueIds: base.map((t) => t.id) });
      } else if (cur) {
        publishLocalLive();
        prefetchUpcomingTracks(cur.id, base);
      }
    },
    [publishLocalLive, prefetchUpcomingTracks, sendRemoteCommand]
  );

  const moveInQueue = useCallback(
    (fromIndex: number, toIndex: number) => {
      const base =
        queueRef.current.length > 0 ? [...queueRef.current] : [...dedupedLibraryRef.current];
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= base.length ||
        toIndex >= base.length
      ) {
        return;
      }
      const [moved] = base.splice(fromIndex, 1);
      base.splice(toIndex, 0, moved);
      queueRef.current = base;
      baseQueueRef.current = base;
      setQueue(base);
      const cur = currentTrackRef.current;
      if (remoteSessionRef.current) {
        sendRemoteCommand('setQueue', { queueIds: base.map((t) => t.id) });
      } else if (cur) {
        publishLocalLive();
        prefetchUpcomingTracks(cur.id, base);
      }
    },
    [publishLocalLive, prefetchUpcomingTracks, sendRemoteCommand]
  );

  const clearUpcomingQueue = useCallback(() => {
    const cur = currentTrackRef.current;
    const next = cur ? [cur] : [];
    queueRef.current = next;
    baseQueueRef.current = next;
    setQueue(next);
    if (remoteSessionRef.current) {
      sendRemoteCommand('setQueue', { queueIds: next.map((t) => t.id) });
    } else if (cur) {
      publishLocalLive();
    }
    notify('File d’attente vidée');
  }, [publishLocalLive, sendRemoteCommand, notify]);

  const downloadTrackOffline = useCallback(
    async (track: MusicTrack): Promise<boolean> => {
      if (!track.mediaId && !track.googleDriveFileId && !track.cloudAudioUrl) {
        notify('Aucun fichier audio téléchargeable pour ce son.');
        return false;
      }
      setDownloadingOfflineIds((prev) => {
        const next = new Set(prev);
        next.add(track.id);
        return next;
      });
      try {
        let blob: Blob | null = null;
        if (track.mediaId) {
          const stored = await getMediaBlob(track.mediaId);
          if (stored?.blob) blob = stored.blob;
        }
        if (!blob && track.googleDriveFileId) {
          const cachedDrive = await getMediaBlob(`drive_${track.googleDriveFileId}`);
          if (cachedDrive?.blob) {
            blob = cachedDrive.blob;
          } else {
            const token = await ensureGoogleDriveToken(state.preferences.firebaseConfig);
            blob = await downloadGoogleDriveAudioBlob(token, track.googleDriveFileId);
          }
        }
        if (!blob && track.cloudAudioUrl) {
          const res = await fetch(track.cloudAudioUrl);
          if (res.ok) blob = await res.blob();
        }
        if (!blob) {
          notify('Impossible de télécharger ce son hors-ligne.');
          return false;
        }
        const key = getOfflineTrackKey(track.id);
        await saveMediaBlob(key, blob, `${track.manualGroupTitle || track.title}.mp3`);
        const objUrl = await getMediaObjectUrl(key);
        if (objUrl) {
          putInMemoryUrlCache(getTrackCacheKey(track), objUrl);
        }
        setOfflineTrackSizes((prev) => ({ ...prev, [track.id]: blob!.size }));
        notify(
          `« ${track.manualGroupTitle || track.title} » disponible hors-ligne (${formatBytes(blob.size)}) ✓`
        );
        return true;
      } catch (err) {
        notify(`Téléchargement hors-ligne : ${(err as Error).message}`);
        return false;
      } finally {
        setDownloadingOfflineIds((prev) => {
          const next = new Set(prev);
          next.delete(track.id);
          return next;
        });
      }
    },
    [state.preferences.firebaseConfig, putInMemoryUrlCache, notify]
  );

  const removeTrackOffline = useCallback(
    async (trackId: string) => {
      await deleteMediaBlob(getOfflineTrackKey(trackId));
      setOfflineTrackSizes((prev) => {
        const next = { ...prev };
        delete next[trackId];
        return next;
      });
      notify('Supprimé du cache hors-ligne');
    },
    [notify]
  );

  const downloadProjectOffline = useCallback(
    async (tracks: MusicTrack[], projectTitle?: string) => {
      const eligible = tracks.filter(
        (t) =>
          offlineTrackSizes[t.id] === undefined &&
          Boolean(t.mediaId || t.googleDriveFileId || t.cloudAudioUrl)
      );
      if (eligible.length === 0) {
        notify(
          projectTitle
            ? `« ${projectTitle} » est déjà disponible hors-ligne ✓`
            : 'Tous les morceaux sont déjà hors-ligne ✓'
        );
        return;
      }
      notify(`Téléchargement hors-ligne de ${eligible.length} titre${eligible.length > 1 ? 's' : ''}…`);
      let okCount = 0;
      for (const t of eligible) {
        const ok = await downloadTrackOffline(t);
        if (ok) okCount++;
      }
      if (okCount > 0) {
        notify(
          `${okCount} titre${okCount > 1 ? 's' : ''} prêt${okCount > 1 ? 's' : ''} hors-ligne ✓`
        );
      }
    },
    [offlineTrackSizes, downloadTrackOffline, notify]
  );

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
      addToQueue,
      removeFromQueue,
      moveInQueue,
      clearUpcomingQueue,
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
      pendingOpenLyricsDocId,
      requestOpenLyricsDoc,
      clearPendingOpenLyricsDoc,
      pendingOpenProjectId,
      requestOpenProjectPage,
      clearPendingOpenProjectPage,
      pendingOpenProfileUid,
      requestOpenProfile,
      clearPendingOpenProfile,
      localDevice,
      remoteDevice,
      isRemotePlayback,
      transferToThisDevice,
      analyzeTrackAudio,
      offlineTrackSizes,
      downloadingOfflineIds,
      downloadTrackOffline,
      removeTrackOffline,
      downloadProjectOffline,
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
      addToQueue,
      removeFromQueue,
      moveInQueue,
      clearUpcomingQueue,
      togglePlay,
      pause,
      seek,
      setLoop,
      setRepeatMode,
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
      pendingOpenLyricsDocId,
      requestOpenLyricsDoc,
      clearPendingOpenLyricsDoc,
      pendingOpenProjectId,
      requestOpenProjectPage,
      clearPendingOpenProjectPage,
      pendingOpenProfileUid,
      requestOpenProfile,
      clearPendingOpenProfile,
      localDevice,
      remoteDevice,
      isRemotePlayback,
      transferToThisDevice,
      analyzeTrackAudio,
      offlineTrackSizes,
      downloadingOfflineIds,
      downloadTrackOffline,
      removeTrackOffline,
      downloadProjectOffline,
    ]
  );

  return (
    <AudioPlayerContext.Provider value={contextValue}>
      {/* Persistent DOM <audio playsInline> element for rock-solid iOS Safari / PWA background continuity */}
      <audio
        ref={audioRef}
        playsInline
        preload="auto"
        className="hidden"
        aria-hidden="true"
      />
      {children}
    </AudioPlayerContext.Provider>
  );
}

export function useAudioPlayer() {
  const ctx = useContext(AudioPlayerContext);
  if (!ctx) throw new Error('useAudioPlayer must be used inside AudioPlayerProvider');
  return ctx;
}
