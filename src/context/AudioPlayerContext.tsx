import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { MusicTrack } from '../types';
import { getMediaObjectUrl } from '../lib/mediaDb';

interface AudioPlayerContextValue {
  currentTrack: MusicTrack | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  loop: boolean;
  abLoop: { start: number | null; end: number | null };
  playTrack: (track: MusicTrack, startAtSec?: number) => Promise<void>;
  togglePlay: () => void;
  pause: () => void;
  seek: (sec: number) => void;
  setLoop: (v: boolean) => void;
  setAbLoop: (ab: { start: number | null; end: number | null }) => void;
  closePlayer: () => void;
  syncTrackMetadata: (track: MusicTrack) => void;
}

const AudioPlayerContext = createContext<AudioPlayerContextValue | null>(null);

export function AudioPlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentTrack, setCurrentTrack] = useState<MusicTrack | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loop, setLoop] = useState(false);
  const [abLoop, setAbLoop] = useState<{ start: number | null; end: number | null }>({
    start: null,
    end: null,
  });

  const loopRef = useRef(loop);
  const abLoopRef = useRef(abLoop);
  useEffect(() => {
    loopRef.current = loop;
  }, [loop]);
  useEffect(() => {
    abLoopRef.current = abLoop;
  }, [abLoop]);

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
        setIsPlaying(false);
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

  const playTrack = useCallback(async (track: MusicTrack, startAtSec?: number) => {
    const audio = audioRef.current;
    if (!audio) return;

    let src: string | null = null;
    if (track.mediaId) {
      src = await getMediaObjectUrl(track.mediaId);
    }
    if (!src && track.cloudAudioUrl) {
      src = track.cloudAudioUrl;
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

    const isSameTrack = currentTrack?.id === track.id && audio.src === src;
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
  }, [currentTrack?.id]);

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
        isPlaying,
        currentTime,
        duration,
        loop,
        abLoop,
        playTrack,
        togglePlay,
        pause,
        seek,
        setLoop,
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
