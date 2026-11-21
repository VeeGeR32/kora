import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeftCircle,
  Check,
  ExternalLink,
  Flag,
  FlagOff,
  Link as LinkIcon,
  Pause,
  Play,
  Repeat,
  X,
} from 'lucide-react';

interface YoutubeBeatPlayerProps {
  url: string;
  loop?: boolean;
  markers?: { start: number | null; end: number | null };
  onUpdate: (updates: {
    mediaUrl?: string;
    loop?: boolean;
    markers?: { start: number | null; end: number | null };
  }) => void;
}

function getYoutubeId(link: string): string | null {
  if (!link) return null;
  const match = link.match(/^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/);
  return match && match[2].length === 11 ? match[2] : null;
}

function formatTime(seconds: number) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export function YoutubeBeatPlayer({
  url,
  loop = false,
  markers = { start: null, end: null },
  onUpdate,
}: YoutubeBeatPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoId, setVideoId] = useState<string | null>(getYoutubeId(url));
  const [draftLink, setDraftLink] = useState(url);
  const [isEditingLink, setIsEditingLink] = useState(!url);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const isDraggingRef = useRef(false);
  const loopRef = useRef(loop);
  const markersRef = useRef(markers);
  const startPressTimer = useRef<number | null>(null);
  const endPressTimer = useRef<number | null>(null);

  useEffect(() => {
    loopRef.current = loop;
    markersRef.current = markers;
  }, [loop, markers]);

  useEffect(() => {
    setDraftLink(url);
    const id = getYoutubeId(url);
    setVideoId(id);
    setIsPlaying(false);
    setProgress(0);
    setDuration(0);
    if (url) setIsEditingLink(false);
  }, [url]);

  const sendCommand = (command: string, args: unknown[] = []) => {
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'command', func: command, args }),
      '*'
    );
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;
      try {
        const data = JSON.parse(event.data);
        if (data.event === 'infoDelivery' && data.info) {
          if (data.info.duration) setDuration(data.info.duration);
          if (data.info.currentTime !== undefined && !isDraggingRef.current) {
            setProgress(data.info.currentTime);
          }
          if (data.info.playerState !== undefined) {
            if (data.info.playerState === 1) setIsPlaying(true);
            else if (data.info.playerState === 2) setIsPlaying(false);
            else if (data.info.playerState === 0) {
              setIsPlaying(false);
              if (loopRef.current) {
                const start = markersRef.current?.start || 0;
                sendCommand('seekTo', [start, true]);
                sendCommand('playVideo');
                setIsPlaying(true);
              }
            }
          }
        }
      } catch {
        // ignore non-JSON messages
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    const mEnd = markers?.end ?? null;
    const mStart = markers?.start ?? 0;
    if (!videoId || mEnd === null) return;
    if (progress >= mEnd) {
      if (loop) {
        sendCommand('seekTo', [mStart, true]);
        sendCommand('playVideo');
        setIsPlaying(true);
        setProgress(mStart);
      } else {
        sendCommand('pauseVideo');
        setIsPlaying(false);
      }
    }
  }, [progress, markers, loop, videoId]);

  const togglePlay = () => {
    if (isPlaying) {
      sendCommand('pauseVideo');
      setIsPlaying(false);
    } else {
      sendCommand('playVideo');
      setIsPlaying(true);
    }
  };

  const handleMarkerSet = (type: 'start' | 'end') => {
    onUpdate({ markers: { start: markers?.start ?? null, end: markers?.end ?? null, [type]: Math.floor(progress) } });
  };

  const handleMarkerClear = (type: 'start' | 'end') => {
    onUpdate({ markers: { start: markers?.start ?? null, end: markers?.end ?? null, [type]: null } });
    if (navigator.vibrate) navigator.vibrate(40);
  };

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <div className="w-full space-y-2.5">
      {/* Hidden YouTube audio iframe */}
      <div className="w-0 h-0 overflow-hidden opacity-0 pointer-events-none absolute">
        {videoId && origin && (
          <iframe
            ref={iframeRef}
            width="320"
            height="180"
            src={`https://www.youtube.com/embed/${videoId}?enablejsapi=1&controls=0&disablekb=1&fs=0&playsinline=1&origin=${origin}`}
            title="YouTube Beat"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            onLoad={() => {
              iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'listening' }), '*');
            }}
          />
        )}
      </div>

      {/* Progress Bar */}
      {videoId && duration > 0 && (
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-[11px] text-slate-400 tabular-nums w-9">
            {formatTime(progress)}
          </span>
          <input
            type="range"
            min={0}
            max={duration}
            step="any"
            value={progress}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setProgress(val);
              sendCommand('seekTo', [val, true]);
            }}
            onMouseDown={() => {
              isDraggingRef.current = true;
            }}
            onMouseUp={() => {
              isDraggingRef.current = false;
            }}
            onTouchStart={() => {
              isDraggingRef.current = true;
            }}
            onTouchEnd={() => {
              isDraggingRef.current = false;
            }}
            className="flex-1 h-1.5 accent-slate-900 dark:accent-zinc-100 cursor-pointer"
          />
          <span className="font-mono text-[11px] text-slate-400 tabular-nums w-9 text-right">
            {formatTime(duration)}
          </span>
        </div>
      )}

      {!videoId && draftLink && !isEditingLink && (
        <div className="flex items-center gap-1.5 text-rose-500 text-[11px]">
          <AlertCircle size={12} /> Lien YouTube non reconnu
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onUpdate({ loop: !loop })}
            title="Boucle A-B / Totale"
            className={`h-9 w-9 rounded-xl flex items-center justify-center transition cursor-pointer ${
              loop
                ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300'
            }`}
          >
            <Repeat size={15} />
          </button>
          <button
            type="button"
            onClick={() => handleMarkerSet('start')}
            onContextMenu={(e) => {
              e.preventDefault();
              handleMarkerClear('start');
            }}
            onTouchStart={() => {
              startPressTimer.current = window.setTimeout(() => handleMarkerClear('start'), 500);
            }}
            onTouchEnd={() => {
              if (startPressTimer.current) window.clearTimeout(startPressTimer.current);
            }}
            title="Marqueur A (début) · Clic droit / appui long pour effacer"
            className={`h-9 px-2.5 rounded-xl flex items-center gap-1 text-[11px] font-mono transition cursor-pointer ${
              markers?.start !== null && markers?.start !== undefined
                ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300'
            }`}
          >
            <Flag size={13} />
            {markers?.start !== null && markers?.start !== undefined ? formatTime(markers.start) : 'A'}
          </button>
          <button
            type="button"
            onClick={() => handleMarkerSet('end')}
            onContextMenu={(e) => {
              e.preventDefault();
              handleMarkerClear('end');
            }}
            onTouchStart={() => {
              endPressTimer.current = window.setTimeout(() => handleMarkerClear('end'), 500);
            }}
            onTouchEnd={() => {
              if (endPressTimer.current) window.clearTimeout(endPressTimer.current);
            }}
            title="Marqueur B (fin) · Clic droit / appui long pour effacer"
            className={`h-9 px-2.5 rounded-xl flex items-center gap-1 text-[11px] font-mono transition cursor-pointer ${
              markers?.end !== null && markers?.end !== undefined
                ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300'
            }`}
          >
            <FlagOff size={13} />
            {markers?.end !== null && markers?.end !== undefined ? formatTime(markers.end) : 'B'}
          </button>
        </div>

        {/* Play */}
        <button
          type="button"
          onClick={togglePlay}
          disabled={!videoId}
          className="h-11 w-11 rounded-full bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 flex items-center justify-center shadow-sm hover:scale-105 disabled:opacity-30 transition cursor-pointer shrink-0"
        >
          {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
        </button>

        {/* Right controls */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              const target = markers?.start ?? 0;
              sendCommand('seekTo', [target, true]);
              setProgress(target);
            }}
            title="Revenir au marqueur A"
            className="h-9 w-9 rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 flex items-center justify-center hover:bg-slate-200 dark:hover:bg-zinc-700 transition cursor-pointer"
          >
            <ArrowLeftCircle size={15} />
          </button>
          <button
            type="button"
            onClick={() => setIsEditingLink((v) => !v)}
            title="Lien YouTube"
            className="h-9 w-9 rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 flex items-center justify-center hover:bg-slate-200 dark:hover:bg-zinc-700 transition cursor-pointer"
          >
            <LinkIcon size={15} />
          </button>
          {videoId && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              title="Ouvrir sur YouTube"
              className="h-9 w-9 rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 flex items-center justify-center hover:bg-slate-200 dark:hover:bg-zinc-700 transition"
            >
              <ExternalLink size={14} />
            </a>
          )}
        </div>
      </div>

      {/* Link input */}
      {isEditingLink && (
        <div className="flex items-center gap-1.5 rounded-xl bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 px-3 py-1.5">
          <input
            type="url"
            value={draftLink}
            onChange={(e) => setDraftLink(e.target.value)}
            placeholder="Coller un lien prod YouTube (https://youtu.be/...)"
            className="flex-1 bg-transparent text-xs outline-none text-slate-800 dark:text-zinc-200 placeholder:text-slate-400"
          />
          <button
            type="button"
            onClick={() => {
              onUpdate({ mediaUrl: draftLink.trim() });
              setIsEditingLink(false);
            }}
            className="h-7 w-7 rounded-lg bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 flex items-center justify-center cursor-pointer"
          >
            <Check size={13} />
          </button>
          {url && (
            <button
              type="button"
              onClick={() => {
                setDraftLink(url);
                setIsEditingLink(false);
              }}
              className="h-7 w-7 rounded-lg bg-slate-200 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 flex items-center justify-center cursor-pointer"
            >
              <X size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
