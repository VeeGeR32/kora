import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { MusicTrack } from '../types';
import { getMediaObjectUrl, saveMediaBlob } from '../lib/mediaDb';
import { downloadGoogleDriveAudioBlob, ensureGoogleDriveToken } from '../lib/googleDrive';
import { useApp } from './AppContext';

interface AudioPlayerContextValue {
  currentTrack: MusicTrack | null;
  queue: MusicTrack[];
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  loop: boolean;
  expanded: boolean;
  abLoop: { start: number | null; end: number | null };
  hasNext: boolean;
  hasPrev: boolean;
  playTrack: (track: MusicTrack, startAtSec?: number, customQueue?: MusicTrack[]) => Promise<void>;
  playNext: () => void;
  playPrev: () => void;
  togglePlay: () => void;
  pause: () => void;
  seek: (sec: number) => void;
  setLoop: (v: boolean) => void;
  setExpanded: (v: boolean) => void;
  setAbLoop: (ab: { start: number | null; end: number | null }) => void;
  closePlayer: () => void;
  syncTrackMetadata: (track: MusicTrack) => void;
}

const AudioPlayerContext = createContext<AudioPlayerContextValue | null>(null);

export function AudioPlayerProvider({ children }: { children: React.ReactNode }) {
  const { state, notify } = useApp();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentTrack, setCurrentTrack] = useState<MusicTrack | null>(null);
  const [queue, setQueue] = useState<MusicTrack[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loop, setLoop] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [abLoop, setAbLoop] = useState<{ start: number | null; end: number | null }>({
    start: null,
    end: null,
  });

  const loopRef = useRef(loop);
  const abLoopRef = useRef(abLoop);
  const currentTrackRef = useRef(currentTrack);
  const queueRef = useRef(queue);
  const playNextRef = useRef<() => void>(() => {});
  const playPrevRef = useRef<() => void>(() => {});

  useEffect(() => {
    loopRef.current = loop;
  }, [loop]);
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
  const hasNext = effectiveQueue.length > 1 && currentIdx >= 0;
  const hasPrev = effectiveQueue.length > 1 && currentIdx >= 0;

  const playTrack = useCallback(
    async (track: MusicTrack, startAtSec?: number, customQueue?: MusicTrack[]) => {
      const audio = audioRef.current;
      if (!audio) return;

      if (customQueue && customQueue.length > 0) {
        setQueue(customQueue);
      } else if (queueRef.current.length === 0 || !queueRef.current.some((t) => t.id === track.id)) {
        setQueue(state.musicTracks);
      }

      let src: string | null = null;
      if (track.mediaId) {
        src = await getMediaObjectUrl(track.mediaId);
      }
      if (!src && track.cloudAudioUrl) {
        src = track.cloudAudioUrl;
      }
      if (!src && track.googleDriveFileId) {
        try {
          notify(`Téléchargement depuis Google Drive (« ${track.title} »)…`);
          const token = await ensureGoogleDriveToken(state.preferences.firebaseConfig);
          const blob = await downloadGoogleDriveAudioBlob(token, track.googleDriveFileId);
          const cacheKey = track.mediaId || `drive_${track.googleDriveFileId}`;
          await saveMediaBlob(cacheKey, blob, `${track.title}.mp3`);
          src = await getMediaObjectUrl(cacheKey);
        } catch (err) {
          notify(`Google Drive : ${(err as Error).message}`);
        }
      }

      setCurrentTrack(track);
      if (!src) {
        audio.pause();
        audio.removeAttribute('src');
        setDuration(track.durationSec || 0);
        setCurrentTime(startAtSec ?? 0);
        setIsPlaying(false);
        return;
      }

      const isSameTrack = currentTrackRef.current?.id === track.id && audio.src === src;
      if (!isSameTrack) {
        audio.src = src;
        setAbLoop({ start: null, end: null });
      }
      if (typeof startAtSec === 'number') {
        audio.currentTime = startAtSec;
        setCurrentTime(startAtSec);
      }
      try {
        await audio.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      }
    },
    [state.musicTracks, state.preferences.firebaseConfig, notify]
  );

  const playNext = useCallback(() => {
    const activeQ = queueRef.current.length > 0 ? queueRef.current : state.musicTracks;
    if (activeQ.length === 0) return;
    const cur = currentTrackRef.current;
    const idx = cur ? activeQ.findIndex((t) => t.id === cur.id) : -1;
    const nextIdx = idx >= 0 ? (idx + 1) % activeQ.length : 0;
    void playTrack(activeQ[nextIdx], 0, activeQ);
  }, [state.musicTracks, playTrack]);

  const playPrev = useCallback(() => {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      setCurrentTime(0);
      return;
    }
    const activeQ = queueRef.current.length > 0 ? queueRef.current : state.musicTracks;
    if (activeQ.length === 0) return;
    const cur = currentTrackRef.current;
    const idx = cur ? activeQ.findIndex((t) => t.id === cur.id) : 0;
    const prevIdx = idx > 0 ? idx - 1 : activeQ.length - 1;
    void playTrack(activeQ[prevIdx], 0, activeQ);
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
      setCurrentTime(t);
      const { start, end } = abLoopRef.current;
      if (end !== null && t >= end) {
        if (loopRef.current) {
          audio.currentTime = start ?? 0;
          void audio.play().catch(() => {});
        } else {
          audio.pause();
          setIsPlaying(false);
        }
      }
    };

    const onLoadedMeta = () => {
      if (isFinite(audio.duration)) setDuration(audio.duration);
    };

    const onEnded = () => {
      if (loopRef.current) {
        audio.currentTime = abLoopRef.current.start ?? 0;
        void audio.play().catch(() => {});
      } else {
        const activeQ = queueRef.current;
        if (activeQ.length > 1) {
          playNextRef.current();
        } else {
          setIsPlaying(false);
        }
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

  // Native iOS Lock Screen & AirPods MediaSession integration
  useEffect(() => {
    if (!currentTrack || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.artist || 'Kora Music',
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
    if (!audio || !audio.src) return;
    if (audio.paused) {
      void audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, []);

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const seek = useCallback((sec: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const clamped = Math.max(0, Math.min(audio.duration || sec, sec));
    audio.currentTime = clamped;
    setCurrentTime(clamped);
  }, []);

  const closePlayer = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
    }
    setCurrentTrack(null);
    setExpanded(false);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setAbLoop({ start: null, end: null });
  }, []);

  const syncTrackMetadata = useCallback((track: MusicTrack) => {
    setCurrentTrack((prev) => (prev && prev.id === track.id ? track : prev));
  }, []);

  return (
    <AudioPlayerContext.Provider
      value={{
        currentTrack,
        queue: effectiveQueue,
        isPlaying,
        currentTime,
        duration,
        loop,
        expanded,
        abLoop,
        hasNext,
        hasPrev,
        playTrack,
        playNext,
        playPrev,
        togglePlay,
        pause,
        seek,
        setLoop,
        setExpanded,
        setAbLoop,
        closePlayer,
        syncTrackMetadata,
      }}
    >
      {children}
    </AudioPlayerContext.Provider>
  );
}

export function useAudioPlayer() {
  const ctx = useContext(AudioPlayerContext);
  if (!ctx) throw new Error('useAudioPlayer must be used inside AudioPlayerProvider');
  return ctx;
}
