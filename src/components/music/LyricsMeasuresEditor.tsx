import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Crosshair,
  GripVertical,
  Loader2,
  Music,
  Navigation,
  RefreshCw,
  Repeat,
} from 'lucide-react';
import type { LyricsBarBlock, LyricsBlockStatus, MusicTrack } from '../../types';
import { computeFourBarGrid, type ComputedBarBlock } from '../../lib/audioAnalyzer';
import { triggerHapticTick } from '../../lib/haptics';
import { LyricLinesEditor } from './LyricLinesEditor';

const SECTION_PRESETS = ['Intro', 'Couplet', 'Pré-refrain', 'Refrain', 'Pont', 'Outro'] as const;
const STATUS_ORDER: LyricsBlockStatus[] = ['empty', 'planned', 'draft', 'done'];

const STATUS_DOT: Record<LyricsBlockStatus, { label: string; dot: string; text: string }> = {
  empty: { label: 'Instru', dot: 'bg-slate-300 dark:bg-zinc-600', text: 'text-slate-400 dark:text-zinc-500' },
  planned: { label: 'À écrire', dot: 'bg-[#8C271E]', text: 'text-[#8C271E] dark:text-[#f08b82]' },
  draft: { label: 'Provisoire', dot: 'bg-amber-400', text: 'text-amber-600 dark:text-amber-300' },
  done: { label: 'Validé', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
};

function fmtTime(sec: number): string {
  if (!sec || !isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface LyricsMeasuresEditorProps {
  track: MusicTrack;
  analysisTrack: MusicTrack;
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

/**
 * Pure Apple Notes-style continuous lyrics canvas where each 4-bar block is separated
 * ONLY by an ultra-subtle alternating background tint (zero obstructing headers or heavy boxes!).
 * Micro-controls (M1-4 jump, drag handle ⠿, loop, status dot) sit whisper-quiet in the top-right corner.
 */
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
  const [activeEditBlockIdx, setActiveEditBlockIdx] = useState<number | null>(null);

  // Touch + Mouse Pointer Drag-and-Drop state for moving/shifting 4-bar blocks
  const [dragState, setDragState] = useState<{
    fromIdx: number;
    overIdx: number;
    clientX: number;
    clientY: number;
    label: string;
    preview: string;
  } | null>(null);
  const dragInfoRef = useRef<{ pointerId: number; fromIdx: number; overIdx: number } | null>(null);

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

  // Pause auto-scroll briefly when user scrolls manually
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

  // Live active block, bar (0..3), and continuous progress (0..1)
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

  // Smooth centered auto-scroll following active measures
  const lastScrolledBlockRef = useRef<number>(-1);
  useEffect(() => {
    if (!followLive || !isPlayingThisSong || activeLocation.blockIdx < 0) return;
    if (Date.now() < userManualScrollUntilRef.current) return;
    if (activeLocation.blockIdx === lastScrolledBlockRef.current) return;
    lastScrolledBlockRef.current = activeLocation.blockIdx;
    blockRowRefs.current.get(activeLocation.blockIdx)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  }, [followLive, isPlayingThisSong, activeLocation.blockIdx]);

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
    setActiveEditBlockIdx(targetIndex);
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

  const applyBlockDrop = (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0 || fromIdx >= grid.length || toIdx >= grid.length) {
      return;
    }

    const byIdx = new Map(blocks.map((b) => [b.index, b]));
    const full: LyricsBarBlock[] = grid.map((g) => {
      const existing = byIdx.get(g.index);
      return existing
        ? { ...existing, index: g.index }
        : {
            id: `blk_${g.index}`,
            index: g.index,
            sectionLabel: g.suggestedSection,
            status: 'empty',
            text: '',
          };
    });

    const isBlockEmpty = (b: LyricsBarBlock) => b.status === 'empty' && !b.text.trim();
    const makeEmpty = (i: number): LyricsBarBlock => ({
      id: `blk_${i}`,
      index: i,
      sectionLabel: grid[i]?.suggestedSection || 'Couplet',
      status: 'empty',
      text: '',
    });

    const src = { ...full[fromIdx] };
    const dst = full[toIdx];

    if (isBlockEmpty(dst)) {
      full[toIdx] = { ...src, id: `blk_${toIdx}`, index: toIdx };
      full[fromIdx] = makeEmpty(fromIdx);
    } else if (fromIdx < toIdx) {
      const nextEmptyIdx = full.findIndex((b, idx) => idx > toIdx && isBlockEmpty(b));
      if (nextEmptyIdx !== -1) {
        for (let i = nextEmptyIdx; i > toIdx; i--) {
          full[i] = { ...full[i - 1], id: `blk_${i}`, index: i };
        }
        full[toIdx] = { ...src, id: `blk_${toIdx}`, index: toIdx };
        full[fromIdx] = makeEmpty(fromIdx);
      } else {
        full[toIdx] = { ...src, id: `blk_${toIdx}`, index: toIdx };
        full[fromIdx] = { ...dst, id: `blk_${fromIdx}`, index: fromIdx };
      }
    } else {
      for (let i = fromIdx; i > toIdx; i--) {
        full[i] = { ...full[i - 1], id: `blk_${i}`, index: i };
      }
      full[toIdx] = { ...src, id: `blk_${toIdx}`, index: toIdx };
    }

    onChangeBlocks(full);
    triggerHapticTick(12);
  };

  const findBlockIndexAtPoint = (clientY: number): number => {
    let bestIdx = dragInfoRef.current?.overIdx ?? 0;
    let bestDist = Infinity;
    for (const [idx, el] of blockRowRefs.current.entries()) {
      const rect = el.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) return idx;
      const center = (rect.top + rect.bottom) / 2;
      const dist = Math.abs(clientY - center);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = idx;
      }
    }
    return bestIdx;
  };

  const handleStartBlockDrag = (
    e: React.PointerEvent<HTMLButtonElement>,
    fromIdx: number,
    g: ComputedBarBlock,
    blk: LyricsBarBlock
  ) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragInfoRef.current = { pointerId: e.pointerId, fromIdx, overIdx: fromIdx };
    const cleanLine =
      blk.text.replace(/\[FIX(?::[^\]]*)?\]\s*/gi, '').split('\n')[0]?.trim() ||
      blk.note?.trim() ||
      STATUS_DOT[blk.status].label;
    setDragState({
      fromIdx,
      overIdx: fromIdx,
      clientX: e.clientX,
      clientY: e.clientY,
      label: `M${g.startBar}–${g.endBar}`,
      preview: cleanLine.slice(0, 36),
    });
    triggerHapticTick(10);
  };

  const handleMoveBlockDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    const info = dragInfoRef.current;
    if (!info || info.pointerId !== e.pointerId) return;
    e.preventDefault();
    const scrollParent = containerRef.current?.closest('.overflow-y-auto') as HTMLElement | null;
    if (scrollParent) {
      const rect = scrollParent.getBoundingClientRect();
      if (e.clientY < rect.top + 60) scrollParent.scrollTop -= 12;
      else if (e.clientY > rect.bottom - 70) scrollParent.scrollTop += 12;
    }
    const overIdx = findBlockIndexAtPoint(e.clientY);
    if (overIdx !== info.overIdx) {
      info.overIdx = overIdx;
      triggerHapticTick(6);
    }
    setDragState((prev) =>
      prev ? { ...prev, overIdx, clientX: e.clientX, clientY: e.clientY } : null
    );
  };

  const handleEndBlockDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    const info = dragInfoRef.current;
    if (!info || info.pointerId !== e.pointerId) return;
    dragInfoRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const { fromIdx, overIdx } = info;
    setDragState(null);
    if (fromIdx !== overIdx) applyBlockDrop(fromIdx, overIdx);
  };

  return (
    <div ref={containerRef} className="pb-28">
      {/* Whisper-Thin Single Metadata Row (stays completely out of the way of your lyrics!) */}
      <div className="mb-3 flex items-center justify-between gap-2 text-[11px] text-slate-400 dark:text-zinc-500 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {analyzing ? (
            <span className="inline-flex items-center gap-1 text-[#8C271E] dark:text-[#f08b82] font-medium">
              <Loader2 size={10} className="animate-spin" />
              Analyse…
            </span>
          ) : (
            <>
              <span className="inline-flex items-center gap-1 font-mono">
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
                    className="w-11 bg-transparent border-b border-[#8C271E] text-slate-900 dark:text-zinc-100 outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditingBpm(true)}
                    className="hover:text-slate-800 dark:hover:text-zinc-200 cursor-pointer"
                  >
                    {bpm} BPM
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => commitBpm(Math.max(55, Math.round(bpm / 2)))}
                  className="px-1 hover:text-[#8C271E] cursor-pointer"
                  title="Half-time"
                >
                  ÷2
                </button>
                <button
                  type="button"
                  onClick={() => commitBpm(Math.min(220, Math.round(bpm * 2)))}
                  className="px-1 hover:text-[#8C271E] cursor-pointer"
                  title="Double-time"
                >
                  ×2
                </button>
              </span>

              <span>·</span>

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
                  className="w-12 bg-transparent border-b border-[#8C271E] font-mono text-slate-900 dark:text-zinc-100 outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingKey(true)}
                  className="inline-flex items-center gap-1 font-mono hover:text-slate-800 dark:hover:text-zinc-200 cursor-pointer"
                >
                  <Music size={9.5} className="text-[#8C271E]" />
                  {musicalKey || 'Key'}
                </button>
              )}

              {liveTimeSec > 0.1 && (
                <>
                  <span>·</span>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateTrackMeta({
                        barOffsetSec: Math.round(liveTimeSec * 100) / 100,
                      })
                    }
                    className="inline-flex items-center gap-0.5 hover:text-[#8C271E] cursor-pointer"
                    title="Caler la mesure 1 sur la position actuelle"
                  >
                    <Crosshair size={9.5} /> M1
                  </button>
                </>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setFollowLive((v) => !v)}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold transition cursor-pointer ${
              followLive
                ? 'bg-[#8C271E] text-white'
                : 'text-slate-400 hover:text-slate-800 dark:hover:text-zinc-200'
            }`}
          >
            <Navigation size={9.5} className={followLive && isPlayingThisSong ? 'animate-pulse' : ''} />
            Suivi
          </button>
          <button
            type="button"
            disabled={analyzing}
            onClick={onReanalyze}
            title="Relancer la détection BPM / Key"
            className="p-1 text-slate-400 hover:text-slate-800 dark:hover:text-zinc-200 disabled:opacity-40 cursor-pointer"
          >
            <RefreshCw size={10.5} className={analyzing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* PURE APPLE-NOTES CANVAS: Alternating Subtle Background Bands per 4-Bar Block (Zero Obstructing Headers!) */}
      <div className="-mx-3 sm:-mx-4 rounded-2xl overflow-hidden">
        {grid.map((g) => {
          const blk: LyricsBarBlock = blocks.find((b) => b.index === g.index) || {
            id: `blk_${g.index}`,
            index: g.index,
            sectionLabel: g.suggestedSection,
            status: 'empty',
            text: '',
          };
          const dotMeta = STATUS_DOT[blk.status];
          const isCurrentBlock = activeLocation.blockIdx === g.index;
          const isLoopingThisBlock =
            activeAbLoop.start !== null &&
            activeAbLoop.end !== null &&
            Math.abs(activeAbLoop.start - g.startSec) < 0.35 &&
            Math.abs(activeAbLoop.end - g.endSec) < 0.35;

          const isEmpty = blk.status === 'empty' && !blk.text.trim();
          const isBeingDragged = dragState?.fromIdx === g.index;
          const isDropTarget =
            dragState !== null &&
            dragState.overIdx === g.index &&
            dragState.fromIdx !== g.index;
          const isFocusedBlock = activeEditBlockIdx === g.index;
          const sectionDisplay =
            blk.sectionLabel && !/^FIX(?::|$)/i.test(blk.sectionLabel.trim())
              ? blk.sectionLabel
              : g.suggestedSection;

          // Alternating soft background tints visually separate every 4 bars cleanly without ANY bulky borders or headers!
          const bandBg = isDropTarget
            ? 'bg-[#8C271E]/[0.12] dark:bg-[#8C271E]/[0.22] ring-1 ring-inset ring-[#8C271E]'
            : isCurrentBlock
            ? 'bg-[#8C271E]/[0.075] dark:bg-[#8C271E]/[0.15]'
            : blk.status === 'planned'
            ? 'bg-[#8C271E]/[0.03] dark:bg-[#8C271E]/[0.065]'
            : g.index % 2 === 1
            ? 'bg-slate-900/[0.028] dark:bg-white/[0.032]'
            : 'bg-transparent';

          return (
            <div
              key={blk.id}
              ref={(el) => {
                if (el) blockRowRefs.current.set(g.index, el);
                else blockRowRefs.current.delete(g.index);
              }}
              className={`group/band relative pl-3 pr-3 sm:pl-4 sm:pr-4 transition-colors duration-150 ${bandBg} ${
                isBeingDragged ? 'opacity-30' : ''
              } ${isEmpty ? 'py-2' : 'py-2.5'}`}
            >
              {/* Ultra-thin live crimson progress line on the far left edge while playing this 4-bar band */}
              {isCurrentBlock && (
                <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-[3px] bg-[#8C271E]/15 overflow-hidden">
                  <div
                    style={{
                      transform: `scaleY(${Math.max(0.05, activeLocation.progress).toFixed(3)})`,
                    }}
                    className="w-full h-full origin-top bg-[#8C271E] dark:bg-[#E04F42] transition-transform duration-100 ease-linear"
                  />
                </div>
              )}

              {isEmpty ? (
                /* Whisper-quiet Empty 4-Bar Band: 1 subtle clickable row — tap anywhere to start writing right here! */
                <div
                  onClick={() => focusBlockTextarea(g.index)}
                  className="flex items-center justify-between gap-2 cursor-text min-h-[22px] pl-[42px]"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onJumpToSec(g.startSec);
                      }}
                      className={`font-mono text-[10px] transition cursor-pointer ${
                        isCurrentBlock
                          ? 'text-[#8C271E] dark:text-[#f08b82] font-bold'
                          : 'text-slate-400/70 dark:text-zinc-600 hover:text-[#8C271E]'
                      }`}
                    >
                      M{g.startBar}–{g.endBar}
                    </button>
                    <span className="text-[10.5px] text-slate-300 dark:text-zinc-600 italic truncate">
                      {isDropTarget
                        ? `Déposer ici (M${g.startBar}–${g.endBar})`
                        : sectionDisplay}
                    </span>
                    {isCurrentBlock && (
                      <span className="font-mono text-[9px] text-[#8C271E] dark:text-[#f08b82] font-bold">
                        · {g.startBar + activeLocation.barInBlock}
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      updateBlock(g.index, { status: 'planned' });
                    }}
                    className="text-[10px] text-slate-400/75 dark:text-zinc-500 hover:text-[#8C271E] dark:hover:text-[#f08b82] transition cursor-pointer shrink-0"
                  >
                    + À écrire
                  </button>
                </div>
              ) : (
                /* Pure Notes Content Band: lyrics sit front-and-center; micro measure tag floats quietly top-right! */
                <div className="relative">
                  {/* Whisper-quiet top-right micro strip (never interrupts the left-aligned flow of lyrics!) */}
                  <div className="flex items-center justify-between gap-2 mb-0.5 pl-[42px]">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <button
                        type="button"
                        onClick={() => onJumpToSec(g.startSec)}
                        title={`Écouter M${g.startBar}–M${g.endBar} (${fmtTime(g.startSec)})`}
                        className={`font-mono text-[9.5px] transition cursor-pointer ${
                          isCurrentBlock
                            ? 'text-[#8C271E] dark:text-[#f08b82] font-bold'
                            : 'text-slate-400/75 dark:text-zinc-500 hover:text-[#8C271E]'
                        }`}
                      >
                        M{g.startBar}–{g.endBar}
                      </button>

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
                          className="w-20 bg-transparent border-b border-[#8C271E]/50 text-[9.5px] uppercase font-semibold text-slate-700 dark:text-zinc-200 outline-none"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleCycleSection(g.index, sectionDisplay)}
                          onDoubleClick={() => setEditingSectionIdx(g.index)}
                          className="text-[9.5px] uppercase tracking-wider font-medium text-slate-400/65 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-zinc-300 transition cursor-pointer truncate"
                        >
                          {sectionDisplay}
                        </button>
                      )}

                      {isCurrentBlock && (
                        <span className="font-mono text-[9px] font-bold text-[#8C271E] dark:text-[#f08b82]">
                          · mes. {g.startBar + activeLocation.barInBlock}
                        </span>
                      )}

                      {isDropTarget && (
                        <span className="rounded bg-[#8C271E] text-white px-1.5 py-0 text-[9px] font-bold">
                          Décaler ici
                        </span>
                      )}
                    </div>

                    {/* Ultra-discreet micro controls (status dot, loop, drag handle ⠿) */}
                    <div
                      className={`flex items-center gap-1 shrink-0 transition-opacity ${
                        isFocusedBlock || isCurrentBlock || isLoopingThisBlock || blk.status === 'planned'
                          ? 'opacity-100'
                          : 'opacity-45 group-hover/band:opacity-100'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleCycleStatus(g.index, blk.status)}
                        title={`État : ${dotMeta.label} (cliquer pour changer)`}
                        className={`inline-flex items-center gap-1 px-1 py-0.5 text-[9.5px] font-medium cursor-pointer ${dotMeta.text}`}
                      >
                        {blk.status === 'done' ? (
                          <Check size={9} />
                        ) : (
                          <span className={`h-1.5 w-1.5 rounded-full ${dotMeta.dot}`} />
                        )}
                        <span className="hidden sm:inline">{dotMeta.label}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onToggleBlockLoop(g.startSec, g.endSec)}
                        title={isLoopingThisBlock ? 'Arrêter la boucle' : 'Boucler ces 4 mesures'}
                        className={`p-0.5 rounded transition cursor-pointer ${
                          isLoopingThisBlock
                            ? 'text-[#8C271E] dark:text-[#E04F42]'
                            : 'text-slate-400 dark:text-zinc-500 hover:text-[#8C271E]'
                        }`}
                      >
                        <Repeat size={10} />
                      </button>

                      <button
                        type="button"
                        onPointerDown={(e) => handleStartBlockDrag(e, g.index, g, blk)}
                        onPointerMove={handleMoveBlockDrag}
                        onPointerUp={handleEndBlockDrag}
                        onPointerCancel={handleEndBlockDrag}
                        style={{ touchAction: 'none' }}
                        title="Glisser-déposer pour déplacer / décaler ce bloc"
                        aria-label={`Déplacer M${g.startBar}–M${g.endBar}`}
                        className="p-0.5 rounded text-slate-400 dark:text-zinc-500 hover:text-[#8C271E] cursor-grab active:cursor-grabbing"
                      >
                        <GripVertical size={11} />
                      </button>
                    </div>
                  </div>

                  {/* Planned Skeleton Cue (when marked 'À écrire' or cue present) */}
                  {(blk.status === 'planned' || Boolean(blk.note)) && (
                    <div className="flex items-center gap-2 pl-[42px] pb-0.5">
                      <input
                        type="text"
                        value={blk.note || ''}
                        onChange={(e) => updateBlock(g.index, { note: e.target.value })}
                        placeholder="À écrire ici (ex. topline, flow rapide, yaourt…)"
                        className="flex-1 min-w-0 bg-transparent text-[12px] italic text-[#8C271E]/85 dark:text-[#f08b82]/85 placeholder:text-[#8C271E]/45 dark:placeholder:text-[#f08b82]/45 outline-none"
                      />
                      {blk.status === 'planned' && !blk.text.trim() && (
                        <button
                          type="button"
                          onClick={() => {
                            updateBlock(g.index, { status: 'draft' });
                            window.setTimeout(() => blockFocusApisRef.current.get(g.index)?.focusStart(), 25);
                          }}
                          className="text-[10px] text-slate-400 hover:text-slate-900 dark:hover:text-zinc-100 shrink-0 cursor-pointer"
                        >
                          Écrire
                        </button>
                      )}
                    </div>
                  )}

                  {/* Pure Continuous Lyrics Text (single native <textarea> with mirrored left FIX gutter!) */}
                  {(blk.status !== 'planned' || blk.text.trim().length > 0) && (
                    <LyricLinesEditor
                      value={blk.text}
                      compact
                      placeholder={`Écris M${g.startBar}–M${g.endBar}…`}
                      registerFocusApi={(api) => {
                        if (api) blockFocusApisRef.current.set(g.index, api);
                        else blockFocusApisRef.current.delete(g.index);
                      }}
                      onFocusLine={() => {
                        setActiveEditBlockIdx(g.index);
                        onActiveBlockFocus?.(g.index);
                      }}
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

      {/* Floating Drag Pill */}
      {dragState && (
        <div
          style={{
            transform: `translate3d(${Math.max(
              12,
              Math.min(
                (typeof window !== 'undefined' ? window.innerWidth : 400) - 230,
                dragState.clientX - 30
              )
            )}px, ${Math.max(12, dragState.clientY - 46)}px, 0)`,
          }}
          className="fixed top-0 left-0 z-[90] pointer-events-none rounded-xl bg-[#8C271E] text-white shadow-xl shadow-black/30 px-3 py-1.5 flex items-center gap-2 max-w-[230px]"
        >
          <GripVertical size={12} className="opacity-80 shrink-0" />
          <div className="min-w-0">
            <p className="text-[10px] font-mono font-bold leading-tight">
              {dragState.label}
              {dragState.overIdx !== dragState.fromIdx && grid[dragState.overIdx]
                ? ` → M${grid[dragState.overIdx].startBar}–${grid[dragState.overIdx].endBar}`
                : ''}
            </p>
            <p className="text-[10.5px] opacity-90 truncate">{dragState.preview}</p>
          </div>
        </div>
      )}
    </div>
  );
}
