import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  Disc3,
  Loader2,
  Pause,
  Play,
  Repeat,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import {
  fetchPublicShare,
  type PublicSharePayload,
  type PublicSharedTrack,
} from '../../lib/publicShare';
import { triggerHapticTick } from '../../lib/haptics';
import { getGradientClass } from './MiniAudioPlayer';
import { ProjectCoverArtwork } from './ProjectCoverArtwork';
import { KoraLogo } from '../ui/KoraLogo';

interface PublicSharePageProps {
  token: string;
}

const BAR_COUNT = 110;
const BAR_STEP_PX = 4.5;
const TOTAL_TAPE_PX = BAR_COUNT * BAR_STEP_PX;

function fmt(sec: number): string {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtTotal(sec: number): string {
  if (!sec || !isFinite(sec)) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function fmtDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function PublicSharePage({ token }: PublicSharePageProps) {
  const [data, setData] = useState<PublicSharePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [duration, setDuration] = useState(0);
  const [loop, setLoop] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);

  // 60/120fps direct GPU DOM refs
  const discRef = useRef<HTMLDivElement>(null);
  const miniDiscRef = useRef<HTMLDivElement>(null);
  const tapePlayedRef = useRef<HTMLDivElement>(null);
  const tapeUnplayedRef = useRef<HTMLDivElement>(null);
  const timeTextRef = useRef<HTMLParagraphElement>(null);
  const scrubPillRef = useRef<HTMLSpanElement>(null);

  const scrubbingRef = useRef(false);
  const scrubTimeRef = useRef(0);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startTime: number;
    lastTickBar: number;
  } | null>(null);

  const loopRef = useRef(loop);
  loopRef.current = loop;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetchPublicShare(token)
      .then((payload) => {
        if (!active) return;
        setData(payload);
        if (payload.kind === 'track') {
          setExpanded(true);
        }
        document.title =
          payload.kind === 'project' && payload.project
            ? `${payload.project.title} · ${payload.artist}`
            : payload.tracks[0]
            ? `${payload.tracks[0].title} · ${payload.artist}`
            : 'Kora Music';
      })
      .catch((err) => {
        if (active) setError((err as Error).message || 'Lien invalide.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  const tracks = data?.tracks || [];
  const activeTrack: PublicSharedTrack | null = tracks[activeIdx] || null;
  const effectiveDuration = duration || activeTrack?.durationSec || 0;

  const bars = useMemo(() => {
    const id = activeTrack?.id || 'kora';
    let seed = id.split('').reduce((a, c) => a + c.charCodeAt(0), 31);
    return Array.from({ length: BAR_COUNT }, (_, idx) => {
      seed = (seed * 9301 + 49297) % 233280;
      const base = 18 + Math.round((seed / 233280) * 82);
      const edge = Math.min(1, Math.min(idx + 3, BAR_COUNT - idx + 2) / 7);
      return Math.max(14, Math.round(base * (0.5 + 0.5 * edge)));
    });
  }, [activeTrack?.id]);

  const playedBarsEl = useMemo(
    () =>
      bars.map((h, i) => (
        <div
          key={i}
          style={{ width: `${BAR_STEP_PX}px` }}
          className="h-full flex items-center justify-center shrink-0"
        >
          <div style={{ height: `${h}%` }} className="w-[2px] rounded-full bg-white" />
        </div>
      )),
    [bars]
  );

  const unplayedBarsEl = useMemo(
    () =>
      bars.map((h, i) => (
        <div
          key={i}
          style={{ width: `${BAR_STEP_PX}px` }}
          className="h-full flex items-center justify-center shrink-0"
        >
          <div style={{ height: `${h}%` }} className="w-[2px] rounded-full bg-white/25" />
        </div>
      )),
    [bars]
  );

  const getLiveTime = useCallback(() => {
    const a = audioRef.current;
    return a && isFinite(a.currentTime) ? a.currentTime : 0;
  }, []);

  const applyVisualFrame = useCallback((t: number, dur: number) => {
    const r = dur > 0 ? Math.min(1, Math.max(0, t / dur)) : 0;
    const tx = -r * TOTAL_TAPE_PX;
    const tapeTransform = `translate3d(${tx}px, 0, 0)`;
    if (tapePlayedRef.current) tapePlayedRef.current.style.transform = tapeTransform;
    if (tapeUnplayedRef.current) tapeUnplayedRef.current.style.transform = tapeTransform;

    const rot = `rotate(${t * 24}deg)`;
    if (discRef.current) discRef.current.style.transform = rot;
    if (miniDiscRef.current) miniDiscRef.current.style.transform = rot;

    const label = `${fmt(t)} / ${fmt(dur)}`;
    if (timeTextRef.current) timeTextRef.current.textContent = label;
    if (scrubPillRef.current) scrubPillRef.current.textContent = label;
  }, []);

  const playAtIndex = useCallback(
    async (idx: number) => {
      const target = tracks[idx];
      const audio = audioRef.current;
      if (!target || !target.audioUrl || !audio) return;

      const changing = idx !== activeIdx || !audio.src || !audio.src.includes(target.id);
      setActiveIdx(idx);
      if (changing) {
        setIsBuffering(true);
        setDuration(target.durationSec || 0);
        audio.src = target.audioUrl;
        audio.currentTime = 0;
        applyVisualFrame(0, target.durationSec || 0);
      }
      try {
        await audio.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      } finally {
        setIsBuffering(false);
      }
    },
    [tracks, activeIdx, applyVisualFrame]
  );

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !activeTrack?.audioUrl) return;
    if (!audio.src) {
      void playAtIndex(activeIdx);
      return;
    }
    if (audio.paused) {
      setIsBuffering(true);
      void audio
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false))
        .finally(() => setIsBuffering(false));
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  }, [activeTrack, activeIdx, playAtIndex]);

  const seekTo = useCallback(
    (sec: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      const maxD = (isFinite(audio.duration) && audio.duration > 0 ? audio.duration : effectiveDuration) || sec;
      const clamped = Math.max(0, Math.min(maxD, sec));
      if (audio.src) {
        audio.currentTime = clamped;
      }
      applyVisualFrame(clamped, maxD);
    },
    [effectiveDuration, applyVisualFrame]
  );

  // Audio element setup
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audioRef.current = audio;

    const onLoadedMeta = () => {
      if (isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
        applyVisualFrame(audio.currentTime || 0, audio.duration);
      }
      setIsBuffering(false);
    };
    const onPlay = () => {
      setIsPlaying(true);
      setIsBuffering(false);
    };
    const onPause = () => setIsPlaying(false);
    const onWaiting = () => setIsBuffering(true);
    const onCanPlay = () => setIsBuffering(false);
    const onEnded = () => {
      if (loopRef.current) {
        audio.currentTime = 0;
        void audio.play().catch(() => {});
      } else if (tracks.length > 1 && activeIdx < tracks.length - 1) {
        void playAtIndex(activeIdx + 1);
      } else {
        setIsPlaying(false);
      }
    };

    audio.addEventListener('loadedmetadata', onLoadedMeta);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.pause();
      audio.removeEventListener('loadedmetadata', onLoadedMeta);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('ended', onEnded);
    };
  }, [tracks.length, activeIdx, playAtIndex, applyVisualFrame]);

  useLayoutEffect(() => {
    if (!activeTrack) return;
    applyVisualFrame(scrubbingRef.current ? scrubTimeRef.current : getLiveTime(), effectiveDuration);
  }, [activeTrack?.id, expanded, effectiveDuration, applyVisualFrame, getLiveTime]);

  useEffect(() => {
    if (!isPlaying) return;
    let rafId = 0;
    const tick = () => {
      if (!scrubbingRef.current) {
        applyVisualFrame(getLiveTime(), effectiveDuration);
      }
      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [isPlaying, effectiveDuration, applyVisualFrame, getLiveTime]);

  // Drag-to-scrub on tape reel
  const handleTapeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!effectiveDuration) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const liveT = getLiveTime();
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startTime: liveT,
      lastTickBar: Math.floor((liveT / effectiveDuration) * BAR_COUNT),
    };
    scrubTimeRef.current = liveT;
    scrubbingRef.current = true;
    setScrubbing(true);
    applyVisualFrame(liveT, effectiveDuration);
    triggerHapticTick(10);
  };

  const handleTapeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId || !effectiveDuration) return;
    const dx = drag.startX - e.clientX;
    const nextSec = Math.max(
      0,
      Math.min(effectiveDuration, drag.startTime + (dx / TOTAL_TAPE_PX) * effectiveDuration)
    );
    scrubTimeRef.current = nextSec;
    applyVisualFrame(nextSec, effectiveDuration);
    const barIdx = Math.floor((nextSec / effectiveDuration) * BAR_COUNT);
    if (barIdx !== drag.lastTickBar) {
      drag.lastTickBar = barIdx;
      triggerHapticTick(24);
    }
  };

  const handleTapeUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const target = scrubTimeRef.current;
    scrubbingRef.current = false;
    setScrubbing(false);
    seekTo(target);
    triggerHapticTick(10);
  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-[#0b0b0d] text-white flex flex-col items-center justify-center gap-3">
        <Loader2 size={24} className="animate-spin text-zinc-400" />
        <p className="text-xs text-zinc-400">Chargement de l’écoute…</p>
      </div>
    );
  }

  if (error || !data || tracks.length === 0) {
    return (
      <div className="min-h-[100dvh] bg-[#0b0b0d] text-white flex flex-col items-center justify-center p-6 text-center gap-4">
        <div className="h-12 w-12 rounded-2xl bg-rose-500/15 text-rose-400 flex items-center justify-center">
          <AlertCircle size={22} />
        </div>
        <div className="space-y-1 max-w-xs">
          <h1 className="text-base font-semibold">Lien indisponible</h1>
          <p className="text-xs text-zinc-400 leading-relaxed">
            {error || 'Ce morceau ou projet n’est plus partagé.'}
          </p>
        </div>
      </div>
    );
  }

  const coverUrl =
    data.project?.coverDataUrl || activeTrack?.coverDataUrl || null;
  const gradCls = getGradientClass(
    activeTrack?.coverGradient || data.project?.coverGradient || 'pink'
  );
  const subtitle = [data.project?.title, data.artist || activeTrack?.artist]
    .filter(Boolean)
    .join(' · ');
  const totalProjectSec = tracks.reduce((acc, t) => acc + (t.durationSec || 0), 0);

  // ===== VIEW A: SINGLE TRACK OR EXPANDED PLAYER ([UNTITLED] OBSIDIAN CARD) =====
  const renderObsidianPlayerCard = (canCollapse: boolean) => (
    <div className="w-full max-w-[360px] flex flex-col items-center gap-4">
      <div className="w-full rounded-[32px] bg-[#0b0b0d] text-white border border-white/10 shadow-[0_32px_90px_-14px_rgba(0,0,0,0.88)] px-6 pt-6 pb-6 flex flex-col items-center space-y-5">
        {/* Title & Subtitle */}
        <div className="w-full text-center space-y-0.5 px-2">
          <h1 className="text-[15px] font-semibold tracking-tight text-white truncate">
            {activeTrack?.title}
          </h1>
          <p className="text-xs text-zinc-400 truncate">{subtitle}</p>
        </div>

        {/* Spinning Circular Disc */}
        <div className="py-1">
          <div
            ref={discRef}
            className={`h-52 w-52 sm:h-56 sm:w-56 rounded-full overflow-hidden border border-white/15 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.9)] will-change-transform ${
              coverUrl ? '' : `bg-gradient-to-br ${gradCls}`
            }`}
          >
            {coverUrl ? (
              <img
                src={coverUrl}
                alt={activeTrack?.title}
                draggable={false}
                className="h-full w-full object-cover select-none pointer-events-none"
              />
            ) : (
              <div className="h-full w-full flex items-center justify-center">
                <div className="h-12 w-12 rounded-full bg-black/25 border border-white/20" />
              </div>
            )}
          </div>
        </div>

        {/* 60/120fps Tape-Reel Waveform */}
        <div className="w-full space-y-2.5">
          <div className="h-6 flex items-center justify-center">
            <span
              ref={scrubPillRef}
              className={`rounded-full bg-amber-300 text-zinc-950 px-3 py-0.5 font-mono text-[11px] font-bold tabular-nums shadow-md transition-all duration-150 ${
                scrubbing ? 'opacity-100 scale-100' : 'opacity-0 scale-90 pointer-events-none'
              }`}
            />
          </div>

          <div
            onPointerDown={handleTapeDown}
            onPointerMove={handleTapeMove}
            onPointerUp={handleTapeUp}
            onPointerCancel={handleTapeUp}
            style={{ touchAction: 'none' }}
            className="relative w-full h-12 overflow-hidden cursor-grab active:cursor-grabbing select-none"
          >
            <div className="pointer-events-none absolute inset-y-0 left-0 w-7 bg-gradient-to-r from-[#0b0b0d] to-transparent z-20" />
            <div className="pointer-events-none absolute inset-y-0 right-0 w-7 bg-gradient-to-l from-[#0b0b0d] to-transparent z-20" />

            <div className="pointer-events-none absolute inset-y-0 left-0 right-1/2 overflow-hidden">
              <div
                ref={tapePlayedRef}
                style={{ width: `${TOTAL_TAPE_PX}px` }}
                className="absolute inset-y-0 left-full flex items-center will-change-transform"
              >
                {playedBarsEl}
              </div>
            </div>
            <div className="pointer-events-none absolute inset-y-0 left-1/2 right-0 overflow-hidden">
              <div
                ref={tapeUnplayedRef}
                style={{ width: `${TOTAL_TAPE_PX}px` }}
                className="absolute inset-y-0 left-0 flex items-center will-change-transform"
              >
                {unplayedBarsEl}
              </div>
            </div>

            <div className="pointer-events-none absolute left-1/2 top-0.5 bottom-0.5 w-[2.5px] -translate-x-1/2 rounded-full bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,0.85)] z-30" />
          </div>

          <p
            ref={timeTextRef}
            className="text-center font-mono text-xs text-zinc-400 tabular-nums min-h-[1rem]"
          />
        </div>

        {/* Transport Controls */}
        {!activeTrack?.streamable ? (
          <p className="text-xs text-amber-300 text-center px-2">
            Audio non synchronisé sur le cloud pour ce fichier.
          </p>
        ) : (
          <div className="w-full flex items-center justify-around px-2 pt-1">
            {tracks.length > 1 ? (
              <button
                type="button"
                onClick={() => void playAtIndex(activeIdx > 0 ? activeIdx - 1 : tracks.length - 1)}
                className="h-11 w-11 rounded-full flex items-center justify-center text-white hover:bg-white/10 cursor-pointer"
                aria-label="Précédent"
              >
                <SkipBack size={20} fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => seekTo(getLiveTime() - 10)}
                className="h-11 w-11 rounded-full flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/10 cursor-pointer"
                aria-label="-10s"
              >
                <RotateCcw size={18} />
              </button>
            )}

            <button
              type="button"
              onClick={togglePlay}
              aria-label={isPlaying ? 'Pause' : 'Lecture'}
              className="h-14 w-14 rounded-full bg-white text-zinc-950 flex items-center justify-center hover:scale-105 active:scale-95 transition shadow-lg cursor-pointer"
            >
              {isBuffering ? (
                <Loader2 size={22} className="animate-spin" />
              ) : isPlaying ? (
                <Pause size={24} fill="currentColor" />
              ) : (
                <Play size={24} fill="currentColor" className="ml-1" />
              )}
            </button>

            {tracks.length > 1 ? (
              <button
                type="button"
                onClick={() => void playAtIndex((activeIdx + 1) % tracks.length)}
                className="h-11 w-11 rounded-full flex items-center justify-center text-white hover:bg-white/10 cursor-pointer"
                aria-label="Suivant"
              >
                <SkipForward size={20} fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => seekTo(getLiveTime() + 10)}
                className="h-11 w-11 rounded-full flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/10 cursor-pointer"
                aria-label="+10s"
              >
                <RotateCw size={18} />
              </button>
            )}

            <button
              type="button"
              onClick={() => setLoop((v) => !v)}
              className={`h-10 w-10 rounded-full flex items-center justify-center transition cursor-pointer ${
                loop
                  ? 'bg-white/16 text-amber-300'
                  : 'text-zinc-400 hover:text-white hover:bg-white/10'
              }`}
              aria-label="Boucle"
            >
              <Repeat size={17} />
            </button>
          </div>
        )}
      </div>

      {canCollapse ? (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="h-10 px-5 rounded-full bg-white text-zinc-950 text-xs font-semibold inline-flex items-center gap-1.5 shadow-lg cursor-pointer"
        >
          <ChevronDown size={15} /> Retour à l’album
        </button>
      ) : (
        <div className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500">
          <KoraLogo size={16} />
          <span>Partagé via Kora</span>
        </div>
      )}
    </div>
  );

  // Single Track Mode
  if (data.kind === 'track') {
    return (
      <div className="min-h-[100dvh] bg-gradient-to-b from-zinc-900 via-[#0e0e11] to-black flex flex-col items-center justify-center p-4">
        {renderObsidianPlayerCard(false)}
      </div>
    );
  }

  // ===== VIEW B: PROJECT / ALBUM / EP PUBLIC PAGE ([UNTITLED] EDITORIAL STYLE) =====
  const projectCover = data.project?.coverDataUrl || null;
  const projectTrackCovers = Array.from(
    new Set(tracks.map((t) => t.coverDataUrl).filter((c): c is string => Boolean(c)))
  );

  return (
    <div className="min-h-[100dvh] bg-white text-zinc-950 pb-28">
      <div className="max-w-lg mx-auto px-5 pt-[calc(env(safe-area-inset-top)+20px)] space-y-6">
        {/* Top subtle brand pill */}
        <div className="flex items-center justify-between">
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-zinc-500">
            <KoraLogo size={22} />
            <span className="uppercase tracking-wider text-[10px]">
              {data.project?.kind || 'Projet'}
            </span>
          </div>
          <span className="text-[11px] text-zinc-400">Écoute publique</span>
        </div>

        {/* Large Centered Cover Art */}
        <div className="flex justify-center pt-1">
          <div className="aspect-square w-64 sm:w-72 rounded-[28px] overflow-hidden shadow-xl border border-zinc-200/80">
            <ProjectCoverArtwork
              title={data.project?.title || 'Projet'}
              projectCoverUrl={projectCover}
              trackCoverUrls={projectTrackCovers}
              gradientId={data.project?.coverGradient || 'pink'}
            />
          </div>
        </div>

        {/* Title + Big Play Button Row */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <h1 className="text-2xl sm:text-3xl font-extrabold uppercase tracking-tight leading-[1.08] text-zinc-950 break-words">
              {data.project?.title || 'Projet'}
            </h1>
            <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
              {data.artist} · {tracks.length} track{tracks.length > 1 ? 's' : ''}
              {totalProjectSec > 0 ? ` · ${fmtTotal(totalProjectSec)}` : ''}
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              if (isPlaying) togglePlay();
              else void playAtIndex(activeIdx);
            }}
            className="h-12 w-12 rounded-2xl bg-zinc-950 text-white flex items-center justify-center shrink-0 shadow-md hover:scale-105 active:scale-95 transition cursor-pointer"
            aria-label={isPlaying ? 'Pause' : 'Lire'}
          >
            {isBuffering ? (
              <Loader2 size={18} className="animate-spin" />
            ) : isPlaying ? (
              <Pause size={18} fill="currentColor" />
            ) : (
              <Play size={18} fill="currentColor" className="ml-0.5" />
            )}
          </button>
        </div>

        {/* Clean Numbered Tracklist */}
        <div className="divide-y divide-zinc-100 border-t border-zinc-100">
          {tracks.map((trk, idx) => {
            const isCur = idx === activeIdx;
            const playingThis = isCur && isPlaying;
            return (
              <button
                key={trk.id}
                type="button"
                disabled={!trk.streamable}
                onClick={() => {
                  if (isCur) togglePlay();
                  else void playAtIndex(idx);
                }}
                className={`w-full py-3.5 flex items-center justify-between gap-3 text-left transition cursor-pointer disabled:opacity-40 ${
                  isCur ? 'text-zinc-950' : 'text-zinc-800 hover:bg-zinc-50'
                }`}
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <span className="w-5 text-center font-mono text-xs text-zinc-400 shrink-0">
                    {playingThis ? (
                      <span className="inline-block h-2 w-2 rounded-full bg-[#FF5500] animate-pulse" />
                    ) : (
                      idx + 1
                    )}
                  </span>
                  {(projectCover || trk.coverDataUrl) && (
                    <img
                      src={projectCover || trk.coverDataUrl || ''}
                      alt={trk.title}
                      className="h-9 w-9 rounded-lg object-cover border border-zinc-200 shrink-0"
                    />
                  )}
                  <div className="min-w-0">
                    <p
                      className={`text-sm truncate ${
                        isCur ? 'font-bold text-zinc-950' : 'font-semibold text-zinc-900'
                      }`}
                    >
                      {trk.title}
                    </p>
                    <p className="text-[11px] text-zinc-400 truncate mt-0.5">
                      {[fmtDate(trk.addedAt), trk.durationSec ? fmt(trk.durationSec) : '']
                        .filter(Boolean)
                        .join(' · ') || data.artist || trk.artist}
                    </p>
                  </div>
                </div>

                <span className="h-8 w-8 rounded-full bg-zinc-100 text-zinc-700 flex items-center justify-center shrink-0">
                  {playingThis ? (
                    <Pause size={13} fill="currentColor" />
                  ) : (
                    <Play size={13} fill="currentColor" className="ml-0.5" />
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Floating [untitled] Mini Pill */}
      {activeTrack && !expanded && (
        <div className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-3 right-3 z-40 max-w-lg mx-auto rounded-full bg-[#141418]/96 text-white border border-white/10 shadow-2xl backdrop-blur-xl px-2.5 py-2 flex items-center justify-between gap-2.5">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer"
          >
            <div
              ref={miniDiscRef}
              className="h-10 w-10 rounded-full overflow-hidden border border-white/15 shrink-0 will-change-transform"
            >
              {coverUrl ? (
                <img src={coverUrl} alt={activeTrack.title} className="h-full w-full object-cover" />
              ) : (
                <div
                  className={`h-full w-full bg-gradient-to-br ${gradCls} flex items-center justify-center`}
                >
                  <Disc3 size={15} className="text-white/90" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold truncate">{activeTrack.title}</p>
              <p className="text-[10px] text-zinc-400 truncate">{subtitle}</p>
            </div>
          </button>

          <button
            type="button"
            onClick={togglePlay}
            className="h-9 w-9 rounded-full bg-white text-zinc-950 flex items-center justify-center shrink-0 cursor-pointer"
          >
            {isBuffering ? (
              <Loader2 size={14} className="animate-spin" />
            ) : isPlaying ? (
              <Pause size={15} fill="currentColor" />
            ) : (
              <Play size={15} fill="currentColor" className="ml-0.5" />
            )}
          </button>
        </div>
      )}

      {/* Expanded Player Overlay for Project Mode */}
      {expanded && (
        <div
          onClick={() => setExpanded(false)}
          className="fixed inset-0 z-50 bg-neutral-900/80 backdrop-blur-2xl flex items-center justify-center p-4"
        >
          <div onClick={(e) => e.stopPropagation()}>{renderObsidianPlayerCard(true)}</div>
        </div>
      )}
    </div>
  );
}
