import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Clock,
  Crosshair,
  Loader2,
  Music,
  Pause,
  PenLine,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  Sparkles,
} from 'lucide-react';
import type { LyricsBarBlock, LyricsBlockStatus, MusicTrack } from '../../types';
import { computeFourBarGrid, type ComputedBarBlock } from '../../lib/audioAnalyzer';

const SECTION_PRESETS = ['Intro', 'Couplet', 'Pré-refrain', 'Refrain', 'Pont', 'Outro'] as const;

const STATUS_STYLE: Record<
  LyricsBlockStatus,
  { label: string; shortLabel: string; pill: string; border: string; bg: string }
> = {
  empty: {
    label: 'Instru',
    shortLabel: 'Instru',
    pill: 'bg-slate-100 dark:bg-zinc-800/80 text-slate-500 dark:text-zinc-400',
    border: 'border-slate-200/70 dark:border-zinc-800/80',
    bg: 'bg-slate-50/40 dark:bg-zinc-900/25',
  },
  planned: {
    label: 'À écrire',
    shortLabel: 'À écrire',
    pill: 'bg-[#8C271E]/12 text-[#8C271E] dark:text-[#f08b82] border border-[#8C271E]/25',
    border: 'border-dashed border-[#8C271E]/45 dark:border-[#8C271E]/55',
    bg: 'bg-[#8C271E]/[0.03] dark:bg-[#8C271E]/[0.06]',
  },
  draft: {
    label: 'Provisoire',
    shortLabel: 'Provisoire',
    pill: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    border: 'border-amber-400/40 dark:border-amber-500/30',
    bg: 'bg-white dark:bg-zinc-900/50',
  },
  done: {
    label: 'Validé',
    shortLabel: 'Validé',
    pill: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    border: 'border-emerald-500/35 dark:border-emerald-500/30',
    bg: 'bg-white dark:bg-zinc-900/55',
  },
};

function fmtTime(sec: number): string {
  if (!sec || !isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface AutoGrowTextareaProps {
  value: string;
  placeholder: string;
  inputRef: (el: HTMLTextAreaElement | null) => void;
  onChange: (val: string) => void;
  onFocus: () => void;
  onNavigateBlock: (direction: 'prev' | 'next') => void;
}

function AutoGrowTextarea({
  value,
  placeholder,
  inputRef,
  onChange,
  onFocus,
  onNavigateBlock,
}: AutoGrowTextareaProps) {
  const localRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = localRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(52, el.scrollHeight)}px`;
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    if (e.key === 'ArrowDown' && !e.shiftKey) {
      const after = el.value.slice(el.selectionEnd);
      if (!after.includes('\n')) {
        e.preventDefault();
        onNavigateBlock('next');
      }
    } else if (e.key === 'ArrowUp' && !e.shiftKey) {
      const before = el.value.slice(0, el.selectionStart);
      if (!before.includes('\n')) {
        e.preventDefault();
        onNavigateBlock('prev');
      }
    }
  };

  return (
    <textarea
      ref={(el) => {
        localRef.current = el;
        inputRef(el);
      }}
      value={value}
      rows={2}
      spellCheck={false}
      onFocus={onFocus}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      className="w-full bg-transparent outline-none resize-none overflow-hidden text-[15px] sm:text-[15.5px] leading-[1.8] text-slate-900 dark:text-zinc-100 placeholder:text-slate-300 dark:placeholder:text-zinc-600"
    />
  );
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

  const textareaRefs = useRef<Map<number, HTMLTextAreaElement>>(new Map());
  const blockCardRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  useEffect(() => {
    setBpmDraft(String(bpm));
  }, [bpm]);

  useEffect(() => {
    setKeyDraft(musicalKey);
  }, [musicalKey]);

  // Compute active 4-bar block & exact bar (1..4 inside that block) in real time
  const activeLocation = useMemo(() => {
    if (!isPlayingThisSong && liveTimeSec <= 0) return { blockIdx: -1, barInBlock: -1 };
    const idx = grid.findIndex((g) => liveTimeSec >= g.startSec - 0.05 && liveTimeSec < g.endSec);
    if (idx < 0) return { blockIdx: -1, barInBlock: -1 };
    const g = grid[idx];
    const barDur = Math.max(0.25, (g.endSec - g.startSec) / 4);
    const barInBlock = Math.min(3, Math.max(0, Math.floor((liveTimeSec - g.startSec) / barDur)));
    return { blockIdx: idx, barInBlock };
  }, [grid, isPlayingThisSong, liveTimeSec]);

  // Smooth auto-scroll to active playing block when followLive is enabled
  const lastScrolledBlockRef = useRef<number>(-1);
  useEffect(() => {
    if (!followLive || !isPlayingThisSong || activeLocation.blockIdx < 0) return;
    if (activeLocation.blockIdx === lastScrolledBlockRef.current) return;
    lastScrolledBlockRef.current = activeLocation.blockIdx;
    const el = blockCardRefs.current.get(activeLocation.blockIdx);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [followLive, isPlayingThisSong, activeLocation.blockIdx]);

  const updateBlock = (index: number, patch: Partial<LyricsBarBlock>) => {
    const next = blocks.map((b) => (b.index === index ? { ...b, ...patch } : b));
    onChangeBlocks(next);
  };

  const focusBlockTextarea = (targetIndex: number) => {
    const targetBlock = blocks.find((b) => b.index === targetIndex);
    if (!targetBlock) return;
    if (targetBlock.status === 'empty') {
      updateBlock(targetIndex, { status: 'draft' });
      window.setTimeout(() => {
        const el = textareaRefs.current.get(targetIndex);
        el?.focus();
      }, 20);
    } else {
      const el = textareaRefs.current.get(targetIndex);
      if (el) {
        el.focus();
      } else {
        window.setTimeout(() => textareaRefs.current.get(targetIndex)?.focus(), 20);
      }
    }
  };

  const handleCycleSection = (index: number, current?: string) => {
    const curIdx = SECTION_PRESETS.findIndex((s) => s.toLowerCase() === (current || '').toLowerCase());
    const nextLabel = SECTION_PRESETS[(curIdx + 1) % SECTION_PRESETS.length];
    updateBlock(index, { sectionLabel: nextLabel });
  };

  const handleSetStatus = (index: number, nextStatus: LyricsBlockStatus) => {
    const cur = blocks.find((b) => b.index === index);
    if (!cur) return;
    updateBlock(index, { status: nextStatus });
    if (nextStatus === 'draft' || nextStatus === 'done') {
      window.setTimeout(() => textareaRefs.current.get(index)?.focus(), 25);
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

  // Summary counts for quick skeleton progress overview
  const stats = useMemo(() => {
    let planned = 0;
    let draft = 0;
    let done = 0;
    for (const b of blocks) {
      if (b.status === 'planned') planned++;
      else if (b.status === 'draft') draft++;
      else if (b.status === 'done') done++;
    }
    return { planned, draft, done, totalBars: grid.length * 4 };
  }, [blocks, grid.length]);

  return (
    <div className="space-y-3 pb-10">
      {/* Compact Musical Structure Header (BPM, ÷2/×2, Key, Align M1, Auto-follow) */}
      <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/75 dark:bg-zinc-900/50 px-3.5 py-2.5 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          {analyzing ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#8C271E]/12 text-[#8C271E] dark:text-[#f08b82] px-2.5 py-1 text-[11px] font-semibold">
              <Loader2 size={11} className="animate-spin" />
              Analyse BPM · Key · Mesures…
            </span>
          ) : (
            <>
              {/* BPM badge + ÷2 / ×2 */}
              <div className="inline-flex items-center rounded-xl border border-slate-200/80 dark:border-zinc-700/80 bg-white dark:bg-zinc-950 overflow-hidden">
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
                    className="w-14 px-2 py-1 text-[11px] font-mono font-bold text-slate-900 dark:text-zinc-100 bg-transparent outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditingBpm(true)}
                    title="Cliquer pour ajuster le BPM"
                    className="px-2.5 py-1 text-[11px] font-mono font-bold text-slate-900 dark:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-800 transition cursor-pointer"
                  >
                    {bpm} BPM
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => commitBpm(Math.max(55, Math.round(bpm / 2)))}
                  title="Diviser le BPM par 2 (half-time)"
                  className="px-1.5 py-1 text-[10px] font-mono font-semibold text-slate-500 hover:text-[#8C271E] hover:bg-slate-100 dark:hover:bg-zinc-800 border-l border-slate-200/70 dark:border-zinc-800 transition cursor-pointer"
                >
                  ÷2
                </button>
                <button
                  type="button"
                  onClick={() => commitBpm(Math.min(220, Math.round(bpm * 2)))}
                  title="Multiplier le BPM par 2 (double-time)"
                  className="px-1.5 py-1 text-[10px] font-mono font-semibold text-slate-500 hover:text-[#8C271E] hover:bg-slate-100 dark:hover:bg-zinc-800 border-l border-slate-200/70 dark:border-zinc-800 transition cursor-pointer"
                >
                  ×2
                </button>
              </div>

              {/* Musical Key badge */}
              {editingKey ? (
                <input
                  autoFocus
                  type="text"
                  value={keyDraft}
                  placeholder="ex. F#m"
                  onChange={(e) => setKeyDraft(e.target.value)}
                  onBlur={commitKey}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitKey();
                    if (e.key === 'Escape') setEditingKey(false);
                  }}
                  className="w-16 rounded-xl border border-[#8C271E]/40 bg-white dark:bg-zinc-950 px-2 py-1 text-[11px] font-mono font-bold text-slate-900 dark:text-zinc-100 outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingKey(true)}
                  title="Tonalité détectée (cliquer pour modifier)"
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-200/80 dark:border-zinc-700/80 bg-white dark:bg-zinc-950 px-2.5 py-1 text-[11px] font-mono font-bold text-slate-800 dark:text-zinc-100 hover:border-[#8C271E]/40 transition cursor-pointer"
                >
                  <Music size={10} className="text-[#8C271E]" />
                  {musicalKey || 'Key ?'}
                </button>
              )}

              {/* Grid summary */}
              <span className="text-[11px] font-mono text-slate-500 dark:text-zinc-400 px-1">
                {grid.length} blocs · {stats.totalBars} mes.
              </span>
            </>
          )}
        </div>

        {/* Right Quick Controls */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {stats.planned > 0 && (
            <span className="rounded-full bg-[#8C271E]/10 text-[#8C271E] dark:text-[#f08b82] px-2 py-0.5 text-[10px] font-semibold">
              {stats.planned} à écrire
            </span>
          )}
          {stats.draft > 0 && (
            <span className="rounded-full bg-amber-500/12 text-amber-700 dark:text-amber-300 px-2 py-0.5 text-[10px] font-semibold">
              {stats.draft} prov.
            </span>
          )}
          {stats.done > 0 && (
            <span className="rounded-full bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 text-[10px] font-semibold">
              {stats.done} validé{stats.done > 1 ? 's' : ''}
            </span>
          )}

          {/* Align Bar 1 to current playhead (useful if prod has a producer tag before Bar 1) */}
          {liveTimeSec > 0.1 && (
            <button
              type="button"
              onClick={() =>
                onUpdateTrackMeta({
                  barOffsetSec: Math.round(liveTimeSec * 100) / 100,
                })
              }
              title="Caler le début de la Mesure 1 pile sur la position actuelle du lecteur"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200/80 dark:border-zinc-700/80 bg-white dark:bg-zinc-950 px-2 py-1 text-[10px] font-medium text-slate-600 dark:text-zinc-300 hover:border-[#8C271E]/50 hover:text-[#8C271E] transition cursor-pointer"
            >
              <Crosshair size={10} />
              Caler M1 ({fmtTime(liveTimeSec)})
            </button>
          )}

          <button
            type="button"
            onClick={() => setFollowLive((v) => !v)}
            title="Suivre automatiquement le bloc en cours pendant l’écoute"
            className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold transition cursor-pointer ${
              followLive
                ? 'bg-[#8C271E]/12 text-[#8C271E] dark:text-[#f08b82]'
                : 'text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200'
            }`}
          >
            <Clock size={10} />
            Suivi
          </button>

          <button
            type="button"
            disabled={analyzing}
            onClick={onReanalyze}
            title="Relancer la détection automatique BPM / Key / Mesures"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 dark:hover:text-zinc-200 hover:bg-slate-200/60 dark:hover:bg-zinc-800 disabled:opacity-40 transition cursor-pointer"
          >
            <RefreshCw size={11} className={analyzing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Seamless Continuous Vertical Flow of 4-Bar "Folders" */}
      <div className="space-y-2">
        {grid.map((g) => {
          const blk: LyricsBarBlock = blocks.find((b) => b.index === g.index) || {
            id: `blk_${g.index}`,
            index: g.index,
            sectionLabel: g.suggestedSection,
            status: 'empty',
            text: '',
          };
          const style = STATUS_STYLE[blk.status];
          const isCurrentBlock = activeLocation.blockIdx === g.index;
          const isLoopingThisBlock =
            activeAbLoop.start !== null &&
            activeAbLoop.end !== null &&
            Math.abs(activeAbLoop.start - g.startSec) < 0.35 &&
            Math.abs(activeAbLoop.end - g.endSec) < 0.35;

          const energyBars = Math.max(1, Math.min(5, Math.round((g.energy / 100) * 5)));
          const isEmptyCompact = blk.status === 'empty' && !blk.text.trim();

          return (
            <div
              key={blk.id}
              ref={(el) => {
                if (el) blockCardRefs.current.set(g.index, el);
                else blockCardRefs.current.delete(g.index);
              }}
              className={`group relative rounded-2xl border transition-all duration-150 ${
                isCurrentBlock
                  ? 'border-[#8C271E] ring-1 ring-[#8C271E]/25 bg-[#8C271E]/[0.035] dark:bg-[#8C271E]/[0.09] shadow-xs'
                  : `${style.border} ${style.bg} hover:border-slate-300 dark:hover:border-zinc-700`
              }`}
            >
              {/* Left crimson spine on active playing block */}
              <div
                className={`absolute left-0 top-2.5 bottom-2.5 w-1 rounded-r-full transition-opacity ${
                  isCurrentBlock
                    ? 'bg-[#8C271E] opacity-100'
                    : blk.status === 'planned'
                    ? 'bg-[#8C271E]/45 opacity-80'
                    : blk.status === 'done'
                    ? 'bg-emerald-500/60 opacity-70'
                    : blk.status === 'draft'
                    ? 'bg-amber-400/70 opacity-70'
                    : 'opacity-0'
                }`}
              />

              {/* Block Header Row */}
              <div className="px-3.5 py-2 flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                  {/* Play / Jump to exact start of these 4 bars */}
                  <button
                    type="button"
                    onClick={() => onJumpToSec(g.startSec)}
                    title={`Écouter M${g.startBar}–M${g.endBar} (${fmtTime(g.startSec)})`}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-mono font-semibold transition cursor-pointer shrink-0 ${
                      isCurrentBlock && isPlayingThisSong
                        ? 'bg-[#8C271E] text-white shadow-xs'
                        : 'bg-slate-200/70 dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 hover:bg-[#8C271E] hover:text-white'
                    }`}
                  >
                    {isCurrentBlock && isPlayingThisSong ? (
                      <Pause size={10} fill="currentColor" />
                    ) : (
                      <Play size={10} fill="currentColor" />
                    )}
                    <span>
                      M{g.startBar}–{g.endBar}
                    </span>
                    <span className="opacity-70 text-[10px]">{fmtTime(g.startSec)}</span>
                  </button>

                  {/* Loop this exact 4-bar block */}
                  <button
                    type="button"
                    onClick={() => onToggleBlockLoop(g.startSec, g.endSec)}
                    title={
                      isLoopingThisBlock
                        ? 'Arrêter la boucle sur ce bloc'
                        : 'Boucler ces 4 mesures pour écrire dessus'
                    }
                    className={`h-6 w-6 rounded-lg inline-flex items-center justify-center transition cursor-pointer shrink-0 ${
                      isLoopingThisBlock
                        ? 'bg-[#8C271E] text-white shadow-xs'
                        : 'text-slate-400 hover:text-[#8C271E] hover:bg-slate-200/60 dark:hover:bg-zinc-800'
                    }`}
                  >
                    <Repeat size={11} />
                  </button>

                  {/* Section Tag (click to cycle, double-click to type custom) */}
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
                      className="w-24 rounded-md border border-[#8C271E]/40 bg-white dark:bg-zinc-950 px-1.5 py-0.5 text-[11px] font-semibold text-slate-900 dark:text-zinc-100 outline-none"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleCycleSection(g.index, blk.sectionLabel)}
                      onDoubleClick={() => setEditingSectionIdx(g.index)}
                      title="Cliquer pour changer de section · Double-clic pour nom personnalisé"
                      className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-400 hover:text-[#8C271E] dark:hover:text-[#f08b82] transition cursor-pointer truncate"
                    >
                      {blk.sectionLabel || g.suggestedSection}
                    </button>
                  )}

                  {/* Mini 5-bar beat energy indicator */}
                  <div
                    className="hidden sm:flex items-end gap-[2px] h-3 px-1 opacity-60"
                    title={`Énergie instru sur ce bloc : ${g.energy}%`}
                  >
                    {[1, 2, 3, 4, 5].map((lvl) => (
                      <span
                        key={lvl}
                        style={{ height: `${lvl * 20}%` }}
                        className={`w-[2.5px] rounded-full ${
                          lvl <= energyBars
                            ? isCurrentBlock
                              ? 'bg-[#8C271E]'
                              : 'bg-slate-400 dark:bg-zinc-500'
                            : 'bg-slate-200 dark:bg-zinc-800'
                        }`}
                      />
                    ))}
                  </div>

                  {/* Live 4-bar pulse dots (M1 · M2 · M3 · M4 inside the active block!) */}
                  {isCurrentBlock && (
                    <div className="flex items-center gap-1 ml-1">
                      {[0, 1, 2, 3].map((bIdx) => (
                        <span
                          key={bIdx}
                          className={`inline-flex items-center justify-center h-4 min-w-[16px] px-1 rounded text-[9px] font-mono font-bold transition ${
                            activeLocation.barInBlock === bIdx
                              ? 'bg-[#8C271E] text-white scale-105'
                              : 'bg-[#8C271E]/12 text-[#8C271E] dark:text-[#f08b82]'
                          }`}
                        >
                          {g.startBar + bIdx}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Status Switcher (Instru | À écrire | Provisoire | Validé) */}
                <div className="flex items-center gap-1 shrink-0">
                  {(['empty', 'planned', 'draft', 'done'] as LyricsBlockStatus[]).map((st) => {
                    const active = blk.status === st;
                    return (
                      <button
                        key={st}
                        type="button"
                        onClick={() => handleSetStatus(g.index, st)}
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition cursor-pointer ${
                          active
                            ? STATUS_STYLE[st].pill
                            : 'text-slate-400 dark:text-zinc-500 opacity-60 hover:opacity-100 hover:bg-slate-200/50 dark:hover:bg-zinc-800/70'
                        }`}
                      >
                        {st === 'done' && active && <Check size={9} className="inline mr-0.5 -mt-0.5" />}
                        {STATUS_STYLE[st].shortLabel}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Block Body: Compact when empty Instru, Skeleton Placeholder when 'planned', Fluid Textarea when writing */}
              {isEmptyCompact ? (
                <div className="px-3.5 pb-2.5 pt-0 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleSetStatus(g.index, 'planned')}
                    className="inline-flex items-center gap-1 rounded-lg border border-dashed border-slate-300 dark:border-zinc-700 px-2.5 py-1 text-[11px] font-medium text-slate-500 dark:text-zinc-400 hover:border-[#8C271E] hover:text-[#8C271E] transition cursor-pointer"
                  >
                    <Sparkles size={10} />
                    Marquer « À écrire ici »
                  </button>
                  <button
                    type="button"
                    onClick={() => focusBlockTextarea(g.index)}
                    className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium text-slate-400 hover:text-slate-800 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800/70 transition cursor-pointer"
                  >
                    <PenLine size={10} />
                    Écrire dans ces 4 mesures…
                  </button>
                </div>
              ) : (
                <div className="px-4 pb-3 pt-0.5 space-y-1.5">
                  {/* Skeleton Cue / Placeholder Note bar when 'planned' (or if note exists) */}
                  {(blk.status === 'planned' || Boolean(blk.note)) && (
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[#8C271E] dark:text-[#f08b82] shrink-0">
                        <Plus size={10} />
                        Repère squelette :
                      </span>
                      <input
                        type="text"
                        value={blk.note || ''}
                        onChange={(e) => updateBlock(g.index, { note: e.target.value })}
                        placeholder="ex. flow rapide, topline aiguë, yaourt provisoire, montée…"
                        className="flex-1 min-w-0 bg-transparent text-[11.5px] italic text-slate-600 dark:text-zinc-300 placeholder:text-slate-400/70 dark:placeholder:text-zinc-500 outline-none border-b border-transparent focus:border-[#8C271E]/35 py-0.5"
                      />
                    </div>
                  )}

                  {/* Fluid continuous lyrics textarea */}
                  <AutoGrowTextarea
                    value={blk.text}
                    placeholder={
                      blk.status === 'planned'
                        ? 'Zone réservée (tu peux laisser vide pour le squelette ou poser un premier jet ici)…'
                        : `Écris tes 4 mesures (M${g.startBar}–M${g.endBar})…`
                    }
                    inputRef={(el) => {
                      if (el) textareaRefs.current.set(g.index, el);
                      else textareaRefs.current.delete(g.index);
                    }}
                    onFocus={() => onActiveBlockFocus?.(g.index)}
                    onChange={(val) => {
                      const nextStatus: LyricsBlockStatus =
                        blk.status === 'planned' && val.trim().length > 0
                          ? 'draft'
                          : blk.status === 'empty' && val.trim().length > 0
                          ? 'draft'
                          : blk.status;
                      updateBlock(g.index, { text: val, status: nextStatus });
                    }}
                    onNavigateBlock={(dir) => {
                      const target = dir === 'next' ? g.index + 1 : g.index - 1;
                      if (target >= 0 && target < grid.length) {
                        focusBlockTextarea(target);
                      }
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
