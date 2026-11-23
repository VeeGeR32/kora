import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Crosshair,
  Loader2,
  Music,
  Navigation,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Repeat,
} from 'lucide-react';
import type { LyricsBarBlock, LyricsBlockStatus, MusicTrack } from '../../types';
import { computeFourBarGrid, type ComputedBarBlock } from '../../lib/audioAnalyzer';
import { LyricLinesEditor } from './LyricLinesEditor';

const SECTION_PRESETS = ['Intro', 'Couplet', 'Pré-refrain', 'Refrain', 'Pont', 'Outro'] as const;
const STATUS_ORDER: LyricsBlockStatus[] = ['empty', 'planned', 'draft', 'done'];

const STATUS_META: Record<
  LyricsBlockStatus,
  { label: string; dot: string; pill: string; spine: string }
> = {
  empty: {
    label: 'Instru',
    dot: 'bg-slate-300 dark:bg-zinc-600',
    pill: 'text-slate-400 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-zinc-300',
    spine: 'bg-transparent',
  },
  planned: {
    label: 'À écrire',
    dot: 'bg-[#8C271E]',
    pill: 'bg-[#8C271E]/12 text-[#8C271E] dark:text-[#f08b82]',
    spine: 'bg-[#8C271E]/45',
  },
  draft: {
    label: 'Provisoire',
    dot: 'bg-amber-400',
    pill: 'bg-amber-500/12 text-amber-700 dark:text-amber-300',
    spine: 'bg-amber-400/60',
  },
  done: {
    label: 'Validé',
    dot: 'bg-emerald-500',
    pill: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
    spine: 'bg-emerald-500/65',
  },
};

function fmtTime(sec: number): string {
  if (!sec || !isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface LyricsMeasuresEditorProps {
  track: MusicTrack;
  analysisTrack: MusicTrack; // Either linkedProdTrack (cleaner beat) or linkedTrack
  blocks: LyricsBarBlock[];
  analyzing: boolean;
  isPlayingThisSong: boolean;
  liveTimeSec: number;
  activeAbLoop: { start: number | null; end: number | null };
  onChangeBlocks: (nextBlocks: LyricsBarBlock[]) => void;
  onUpdateTrackMeta: (patch: Partial<MusicTrack>) => void;
  onReanalyze: () => void;
  onJumpToSec: (sec: number) => void;
  onToggleBlockLoop: (startSec: number, endSec: number) => void;
  onActiveBlockFocus?: (blockIndex: number) => void;
}

export function LyricsMeasuresEditor({
  track,
  analysisTrack,
  blocks,
  analyzing,
  isPlayingThisSong,
  liveTimeSec,
  activeAbLoop,
  onChangeBlocks,
  onUpdateTrackMeta,
  onReanalyze,
  onJumpToSec,
  onToggleBlockLoop,
  onActiveBlockFocus,
}: LyricsMeasuresEditorProps) {
  const bpm = analysisTrack.bpm || track.bpm || 120;
  const musicalKey = analysisTrack.musicalKey || track.musicalKey || '';
  const durationSec = analysisTrack.durationSec || track.durationSec || 150;
  const barOffsetSec = analysisTrack.barOffsetSec ?? track.barOffsetSec ?? 0;
  const barBlockEnergies = analysisTrack.barBlockEnergies || track.barBlockEnergies;

  const grid: ComputedBarBlock[] = useMemo(
    () => computeFourBarGrid(durationSec, bpm, barOffsetSec, barBlockEnergies),
    [durationSec, bpm, barOffsetSec, barBlockEnergies]
  );

  const [editingBpm, setEditingBpm] = useState(false);
  const [bpmDraft, setBpmDraft] = useState(String(bpm));
  const [editingKey, setEditingKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState(musicalKey);
  const [editingSectionIdx, setEditingSectionIdx] = useState<number | null>(null);
  const [followLive, setFollowLive] = useState(true);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const blockFocusApisRef = useRef<
    Map<number, { focusStart: () => void; focusEnd: () => void }>
  >(new Map());
  const blockRowRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const userManualScrollUntilRef = useRef<number>(0);

  useEffect(() => {
    setBpmDraft(String(bpm));
  }, [bpm]);

  useEffect(() => {
    setKeyDraft(musicalKey);
  }, [musicalKey]);

  // Pause auto-scroll briefly when the user scrolls manually so the view never fights their finger!
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const scrollParent = el.closest('.overflow-y-auto') as HTMLElement | null;
    if (!scrollParent) return;
    const onUserScroll = () => {
      userManualScrollUntilRef.current = Date.now() + 3500;
    };
    scrollParent.addEventListener('wheel', onUserScroll, { passive: true });
    scrollParent.addEventListener('touchstart', onUserScroll, { passive: true });
    return () => {
      scrollParent.removeEventListener('wheel', onUserScroll);
      scrollParent.removeEventListener('touchstart', onUserScroll);
    };
  }, []);

  // Real-time active block, exact bar (0..3) AND continuous progress ratio (0..1) inside the active 4 bars!
  const activeLocation = useMemo(() => {
    if (!isPlayingThisSong && liveTimeSec <= 0) {
      return { blockIdx: -1, barInBlock: -1, progress: 0 };
    }
    const idx = grid.findIndex((g) => liveTimeSec >= g.startSec - 0.05 && liveTimeSec < g.endSec);
    if (idx < 0) return { blockIdx: -1, barInBlock: -1, progress: 0 };
    const g = grid[idx];
    const span = Math.max(0.5, g.endSec - g.startSec);
    const progress = Math.min(1, Math.max(0, (liveTimeSec - g.startSec) / span));
    const barInBlock = Math.min(3, Math.max(0, Math.floor(progress * 4)));
    return { blockIdx: idx, barInBlock, progress };
  }, [grid, isPlayingThisSong, liveTimeSec]);

  // Smooth Spotify-Lyrics-style centered auto-scroll following the active 4-bar block!
  const lastScrolledBlockRef = useRef<number>(-1);
  useEffect(() => {
    if (!followLive || !isPlayingThisSong || activeLocation.blockIdx < 0) return;
    if (Date.now() < userManualScrollUntilRef.current) return;
    if (activeLocation.blockIdx === lastScrolledBlockRef.current) return;
    lastScrolledBlockRef.current = activeLocation.blockIdx;
    const rowEl = blockRowRefs.current.get(activeLocation.blockIdx);
    if (rowEl) {
      rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [followLive, isPlayingThisSong, activeLocation.blockIdx]);

  // Reset scroll tracker when user toggles Follow ON so it immediately glides to the active block
  useEffect(() => {
    if (followLive && isPlayingThisSong && activeLocation.blockIdx >= 0) {
      userManualScrollUntilRef.current = 0;
      lastScrolledBlockRef.current = activeLocation.blockIdx;
      blockRowRefs.current.get(activeLocation.blockIdx)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [followLive]);

  const updateBlock = (index: number, patch: Partial<LyricsBarBlock>) => {
    const next = blocks.map((b) => (b.index === index ? { ...b, ...patch } : b));
    onChangeBlocks(next);
  };

  const focusBlockTextarea = (targetIndex: number, edge: 'start' | 'end' = 'start') => {
    const targetBlock = blocks.find((b) => b.index === targetIndex);
    if (!targetBlock) return;
    const doFocus = () => {
      const api = blockFocusApisRef.current.get(targetIndex);
      if (api) {
        if (edge === 'end') api.focusEnd();
        else api.focusStart();
      }
    };
    if (targetBlock.status === 'empty') {
      updateBlock(targetIndex, { status: 'draft' });
      window.setTimeout(doFocus, 25);
    } else {
      const api = blockFocusApisRef.current.get(targetIndex);
      if (api) doFocus();
      else window.setTimeout(doFocus, 25);
    }
  };

  const handleCycleSection = (index: number, current?: string) => {
    const curIdx = SECTION_PRESETS.findIndex((s) => s.toLowerCase() === (current || '').toLowerCase());
    const nextLabel = SECTION_PRESETS[(curIdx + 1) % SECTION_PRESETS.length];
    updateBlock(index, { sectionLabel: nextLabel });
  };

  const handleCycleStatus = (index: number, current: LyricsBlockStatus) => {
    const curIdx = STATUS_ORDER.indexOf(current);
    const nextStatus = STATUS_ORDER[(curIdx + 1) % STATUS_ORDER.length];
    updateBlock(index, { status: nextStatus });
    if (nextStatus === 'draft' || nextStatus === 'done') {
      window.setTimeout(() => blockFocusApisRef.current.get(index)?.focusStart(), 25);
    }
  };

  const commitBpm = (val: number) => {
    const clamped = Math.max(50, Math.min(240, Math.round(val)));
    onUpdateTrackMeta({ bpm: clamped });
    setEditingBpm(false);
  };

  const commitKey = () => {
    onUpdateTrackMeta({ musicalKey: keyDraft.trim() || undefined });
    setEditingKey(false);
  };

  return (
    <div ref={containerRef} className="pb-24">
      {/* Ultra-Compact Single-Row Musical Controls Strip */}
      <div className="mb-4 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          {analyzing ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#8C271E]/12 text-[#8C271E] dark:text-[#f08b82] px-2.5 py-1 text-[11px] font-semibold">
              <Loader2 size={11} className="animate-spin" />
              Analyse…
            </span>
          ) : (
            <>
              {/* BPM + ÷2 / ×2 */}
              <div className="inline-flex items-center rounded-lg border border-slate-200/80 dark:border-zinc-800 bg-slate-50/80 dark:bg-zinc-900/70 overflow-hidden">
                {editingBpm ? (
                  <input
                    autoFocus
                    type="number"
                    min={50}
                    max={240}
                    value={bpmDraft}
                    onChange={(e) => setBpmDraft(e.target.value)}
                    onBlur={() => commitBpm(Number(bpmDraft) || bpm)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitBpm(Number(bpmDraft) || bpm);
                      if (e.key === 'Escape') setEditingBpm(false);
                    }}
                    className="w-12 px-2 py-0.5 text-[11px] font-mono font-bold text-slate-900 dark:text-zinc-100 bg-transparent outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditingBpm(true)}
                    title="Modifier le BPM"
                    className="px-2 py-0.5 text-[11px] font-mono font-semibold text-slate-700 dark:text-zinc-200 hover:text-[#8C271E] cursor-pointer"
                  >
                    {bpm} BPM
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => commitBpm(Math.max(55, Math.round(bpm / 2)))}
                  className="px-1.5 py-0.5 text-[10px] font-mono text-slate-400 hover:text-[#8C271E] border-l border-slate-200/70 dark:border-zinc-800 cursor-pointer"
                  title="Half-time (÷2)"
                >
                  ÷2
                </button>
                <button
                  type="button"
                  onClick={() => commitBpm(Math.min(220, Math.round(bpm * 2)))}
                  className="px-1.5 py-0.5 text-[10px] font-mono text-slate-400 hover:text-[#8C271E] border-l border-slate-200/70 dark:border-zinc-800 cursor-pointer"
                  title="Double-time (×2)"
                >
                  ×2
                </button>
              </div>

              {/* Musical Key */}
              {editingKey ? (
                <input
                  autoFocus
                  type="text"
                  value={keyDraft}
                  placeholder="F#m"
                  onChange={(e) => setKeyDraft(e.target.value)}
                  onBlur={commitKey}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitKey();
                    if (e.key === 'Escape') setEditingKey(false);
                  }}
                  className="w-14 rounded-lg border border-[#8C271E]/40 bg-white dark:bg-zinc-950 px-2 py-0.5 text-[11px] font-mono font-semibold outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingKey(true)}
                  title="Tonalité (cliquer pour modifier)"
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200/80 dark:border-zinc-800 bg-slate-50/80 dark:bg-zinc-900/70 px-2 py-0.5 text-[11px] font-mono font-semibold text-slate-700 dark:text-zinc-200 hover:border-[#8C271E]/40 cursor-pointer"
                >
                  <Music size={10} className="text-[#8C271E]" />
                  {musicalKey || 'Key'}
                </button>
              )}

              {liveTimeSec > 0.1 && (
                <button
                  type="button"
                  onClick={() =>
                    onUpdateTrackMeta({
                      barOffsetSec: Math.round(liveTimeSec * 100) / 100,
                    })
                  }
                  title="Caler la Mesure 1 sur la position actuelle"
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200/80 dark:border-zinc-800 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:text-zinc-400 hover:text-[#8C271E] hover:border-[#8C271E]/40 cursor-pointer"
                >
                  <Crosshair size={10} />
                  M1 ({fmtTime(liveTimeSec)})
                </button>
              )}
            </>
          )}
        </div>

        {/* Right: Smooth Live Follow Toggle + Reanalyze */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setFollowLive((v) => !v)}
            title={
              followLive
                ? 'Suivi fluide activé : le texte défile avec les mesures en lecture (cliquer pour désactiver)'
                : 'Activer le suivi fluide des mesures pendant la lecture'
            }
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer ${
              followLive
                ? 'bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25'
                : 'border border-slate-200/80 dark:border-zinc-800 text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100'
            }`}
          >
            <Navigation size={10} className={followLive && isPlayingThisSong ? 'animate-pulse' : ''} />
            <span>Suivi live</span>
          </button>

          <button
            type="button"
            disabled={analyzing}
            onClick={onReanalyze}
            title="Relancer l’analyse BPM / Key"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 dark:hover:text-zinc-200 disabled:opacity-40 cursor-pointer"
          >
            <RefreshCw size={11} className={analyzing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* CLEAN CONTINUOUS EDITORIAL LYRICS STREAM (Zero Heavy Boxes — Reads Like One Fluid Page!) */}
      <div className="divide-y divide-slate-100/80 dark:divide-zinc-800/45">
        {grid.map((g) => {
          const blk: LyricsBarBlock = blocks.find((b) => b.index === g.index) || {
            id: `blk_${g.index}`,
            index: g.index,
            sectionLabel: g.suggestedSection,
            status: 'empty',
            text: '',
          };
          const meta = STATUS_META[blk.status];
          const isCurrentBlock = activeLocation.blockIdx === g.index;
          const isLoopingThisBlock =
            activeAbLoop.start !== null &&
            activeAbLoop.end !== null &&
            Math.abs(activeAbLoop.start - g.startSec) < 0.35 &&
            Math.abs(activeAbLoop.end - g.endSec) < 0.35;

          const isEmptyCompact = blk.status === 'empty' && !blk.text.trim();
          const sectionDisplay =
            blk.sectionLabel && !/^FIX(?::|$)/i.test(blk.sectionLabel.trim())
              ? blk.sectionLabel
              : g.suggestedSection;

          return (
            <div
              key={blk.id}
              ref={(el) => {
                if (el) blockRowRefs.current.set(g.index, el);
                else blockRowRefs.current.delete(g.index);
              }}
              className={`relative pl-3 transition-colors duration-200 ${
                isCurrentBlock
                  ? 'bg-[#8C271E]/[0.045] dark:bg-[#8C271E]/[0.10] rounded-xl my-0.5'
                  : ''
              } ${isEmptyCompact ? 'py-1.5' : 'py-2.5'}`}
            >
              {/* Subtle Left Status / Live Progress Spine */}
              <div className="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] rounded-full overflow-hidden bg-slate-200/50 dark:bg-zinc-800/70">
                {isCurrentBlock ? (
                  <div
                    style={{
                      transform: `scaleY(${Math.max(0.06, activeLocation.progress).toFixed(3)})`,
                    }}
                    className="w-full h-full origin-top bg-[#8C271E] dark:bg-[#E04F42] transition-transform duration-150 ease-linear"
                  />
                ) : (
                  <div className={`w-full h-full ${meta.spine}`} />
                )}
              </div>

              {/* SINGLE ULTRA-SLIM INLINE MEASURE HEADER (1 line only, zero clutter!) */}
              <div className="flex items-center justify-between gap-2 min-h-[22px]">
                <div className="flex items-center gap-1.5 min-w-0">
                  {/* Compact Play/Jump Measure Pill */}
                  <button
                    type="button"
                    onClick={() => onJumpToSec(g.startSec)}
                    title={`Écouter M${g.startBar}–M${g.endBar} (${fmtTime(g.startSec)})`}
                    className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-mono font-semibold transition cursor-pointer shrink-0 ${
                      isCurrentBlock && isPlayingThisSong
                        ? 'bg-[#8C271E] text-white'
                        : 'text-slate-400 dark:text-zinc-500 hover:text-[#8C271E] dark:hover:text-[#f08b82] hover:bg-slate-100 dark:hover:bg-zinc-800/70'
                    }`}
                  >
                    {isCurrentBlock && isPlayingThisSong ? (
                      <Pause size={8} fill="currentColor" />
                    ) : (
                      <Play size={8} fill="currentColor" />
                    )}
                    <span>
                      M{g.startBar}–{g.endBar}
                    </span>
                  </button>

                  {/* Section Name (subtle uppercase) */}
                  {editingSectionIdx === g.index ? (
                    <input
                      autoFocus
                      type="text"
                      value={blk.sectionLabel || ''}
                      onChange={(e) => updateBlock(g.index, { sectionLabel: e.target.value })}
                      onBlur={() => setEditingSectionIdx(null)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === 'Escape') setEditingSectionIdx(null);
                      }}
                      className="w-20 rounded border border-[#8C271E]/40 bg-transparent px-1 text-[10px] font-semibold uppercase text-slate-900 dark:text-zinc-100 outline-none"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleCycleSection(g.index, sectionDisplay)}
                      onDoubleClick={() => setEditingSectionIdx(g.index)}
                      title="Cliquer pour changer la section · Double-clic pour renommer"
                      className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-zinc-500 hover:text-slate-800 dark:hover:text-zinc-200 transition cursor-pointer truncate"
                    >
                      {sectionDisplay}
                    </button>
                  )}

                  {/* Live 4-bar fluid tracker ONLY on the active playing block */}
                  {isCurrentBlock && (
                    <div className="flex items-center gap-0.5 ml-1">
                      {[0, 1, 2, 3].map((bIdx) => (
                        <span
                          key={bIdx}
                          className={`inline-flex items-center justify-center h-3.5 min-w-[14px] px-0.5 rounded text-[8.5px] font-mono font-bold transition-all duration-150 ${
                            activeLocation.barInBlock === bIdx
                              ? 'bg-[#8C271E] text-white'
                              : bIdx < activeLocation.barInBlock
                              ? 'bg-[#8C271E]/25 text-[#8C271E] dark:text-[#f08b82]'
                              : 'bg-slate-200/70 dark:bg-zinc-800 text-slate-400 dark:text-zinc-500'
                          }`}
                        >
                          {g.startBar + bIdx}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Quick inline trigger on empty Instru blocks (single subtle button, zero clutter!) */}
                  {isEmptyCompact && (
                    <div className="flex items-center gap-1 ml-1">
                      <button
                        type="button"
                        onClick={() => updateBlock(g.index, { status: 'planned' })}
                        className="text-[10px] font-medium text-slate-400 dark:text-zinc-500 hover:text-[#8C271E] dark:hover:text-[#f08b82] px-1.5 py-0.5 rounded hover:bg-[#8C271E]/10 transition cursor-pointer"
                      >
                        + À écrire
                      </button>
                      <button
                        type="button"
                        onClick={() => focusBlockTextarea(g.index)}
                        className="text-[10px] font-medium text-slate-400 dark:text-zinc-500 hover:text-slate-800 dark:hover:text-zinc-200 px-1.5 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-zinc-800 transition cursor-pointer"
                      >
                        Écrire…
                      </button>
                    </div>
                  )}
                </div>

                {/* Right: Single 1-Tap Status Pill + Loop Icon */}
                <div className="flex items-center gap-1 shrink-0">
                  {!isEmptyCompact && (
                    <button
                      type="button"
                      onClick={() => handleCycleStatus(g.index, blk.status)}
                      title="Cliquer pour changer l’état (Instru → À écrire → Provisoire → Validé)"
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-semibold transition cursor-pointer ${meta.pill}`}
                    >
                      {blk.status === 'done' ? (
                        <Check size={9} />
                      ) : (
                        <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                      )}
                      {meta.label}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => onToggleBlockLoop(g.startSec, g.endSec)}
                    title={isLoopingThisBlock ? 'Arrêter la boucle' : 'Boucler ces 4 mesures'}
                    className={`h-5 w-5 rounded inline-flex items-center justify-center transition cursor-pointer ${
                      isLoopingThisBlock
                        ? 'bg-[#8C271E] text-white'
                        : 'text-slate-300 dark:text-zinc-600 hover:text-[#8C271E]'
                    }`}
                  >
                    <Repeat size={10} />
                  </button>
                </div>
              </div>

              {/* Clean Lyrics Body (directly beneath the slim divider — reads seamlessly top to bottom!) */}
              {!isEmptyCompact && (
                <div className="mt-1 space-y-1">
                  {/* Optional Skeleton Cue Line when 'planned' or note present */}
                  {(blk.status === 'planned' || Boolean(blk.note)) && (
                    <div className="flex items-center gap-1.5 pl-6">
                      <Plus size={9} className="text-[#8C271E] shrink-0" />
                      <input
                        type="text"
                        value={blk.note || ''}
                        onChange={(e) => updateBlock(g.index, { note: e.target.value })}
                        placeholder="Repère squelette (ex. flow rapide, topline, yaourt…)"
                        className="flex-1 min-w-0 bg-transparent text-[11.5px] italic text-[#8C271E]/85 dark:text-[#f08b82]/85 placeholder:text-slate-400/60 dark:placeholder:text-zinc-600 outline-none"
                      />
                      {blk.status === 'planned' && !blk.text.trim() && (
                        <button
                          type="button"
                          onClick={() => {
                            updateBlock(g.index, { status: 'draft' });
                            window.setTimeout(() => blockFocusApisRef.current.get(g.index)?.focusStart(), 25);
                          }}
                          className="text-[10px] font-medium text-slate-400 hover:text-slate-900 dark:hover:text-zinc-100 px-1.5 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-zinc-800 shrink-0 cursor-pointer"
                        >
                          Écrire
                        </button>
                      )}
                    </div>
                  )}

                  {/* Per-line lyric editor (only rendered when writing/draft/done OR when user wants to type in a planned slot) */}
                  {(blk.status !== 'planned' || blk.text.trim().length > 0) && (
                    <LyricLinesEditor
                      value={blk.text}
                      compact
                      placeholder={`Écris M${g.startBar}–M${g.endBar}…`}
                      registerFocusApi={(api) => {
                        if (api) blockFocusApisRef.current.set(g.index, api);
                        else blockFocusApisRef.current.delete(g.index);
                      }}
                      onFocusLine={() => onActiveBlockFocus?.(g.index)}
                      onChange={(val) => {
                        const nextStatus: LyricsBlockStatus =
                          (blk.status === 'planned' || blk.status === 'empty') && val.trim().length > 0
                            ? 'draft'
                            : blk.status;
                        updateBlock(g.index, { text: val, status: nextStatus });
                      }}
                      onNavigateEdge={(dir) => {
                        const target = dir === 'next' ? g.index + 1 : g.index - 1;
                        if (target >= 0 && target < grid.length) {
                          focusBlockTextarea(target, dir === 'prev' ? 'end' : 'start');
                        }
                      }}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
