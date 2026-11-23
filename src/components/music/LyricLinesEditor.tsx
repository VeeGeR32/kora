import React, { useEffect, useMemo, useRef } from 'react';
import { Wrench } from 'lucide-react';

export interface ParsedLyricLine {
  text: string;
  fix: boolean;
}

const FIX_PREFIX_RE = /^\s*\[FIX(?::[^\]]*)?\]\s*/i;
const FIX_INLINE_RE = /\s*\[FIX(?::[^\]]*)?\]\s*/gi;

/** Parses raw lyric text into clean lines with visual `fix` flags (auto-migrates legacy `[FIX]` tags!) */
export function parseLyricLines(raw: string): ParsedLyricLine[] {
  const normalized = (raw || '').replace(/\r\n/g, '\n');
  if (!normalized) return [{ text: '', fix: false }];
  return normalized.split('\n').map((line) => {
    const hasFix = FIX_PREFIX_RE.test(line) || /\[FIX(?::[^\]]*)?\]/i.test(line);
    const clean = hasFix
      ? line.replace(FIX_PREFIX_RE, '').replace(FIX_INLINE_RE, ' ').trimEnd()
      : line;
    return { text: clean, fix: hasFix };
  });
}

/** Serializes lines back into canonical storage string (compatible with global `[FIX]` counters across projects/sprints!) */
export function serializeLyricLines(lines: ParsedLyricLine[]): string {
  return lines
    .map((l) => {
      const clean = l.text.replace(/\r?\n/g, ' ');
      if (l.fix) {
        return clean.trim().length > 0 ? `[FIX] ${clean}` : '[FIX]';
      }
      return clean;
    })
    .join('\n');
}

/**
 * Reconciles `fix` flags when the user edits text inside the single native `<textarea>`
 * (handles typing, Enter line-splits, Backspace merges, and multi-line paste cleanly!).
 */
function reconcileLinesWithFixFlags(
  prevLines: ParsedLyricLine[],
  nextCleanRaw: string
): ParsedLyricLine[] {
  const normalized = nextCleanRaw.replace(/\r\n/g, '\n');
  const nextRawLines = normalized.split('\n');

  // Auto-convert any pasted `[FIX]` tags into visual flags
  const parsedIncoming = nextRawLines.map((rawLine) => {
    const hasTag = FIX_PREFIX_RE.test(rawLine) || /\[FIX(?::[^\]]*)?\]/i.test(rawLine);
    const text = hasTag
      ? rawLine.replace(FIX_PREFIX_RE, '').replace(FIX_INLINE_RE, ' ').trimEnd()
      : rawLine;
    return { text, hasTag };
  });

  const oldLen = prevLines.length;
  const newLen = parsedIncoming.length;

  // Match unchanged prefix lines
  let prefix = 0;
  while (
    prefix < oldLen &&
    prefix < newLen &&
    prevLines[prefix].text === parsedIncoming[prefix].text &&
    !parsedIncoming[prefix].hasTag
  ) {
    prefix++;
  }

  // Match unchanged suffix lines
  let suffix = 0;
  while (
    suffix < oldLen - prefix &&
    suffix < newLen - prefix &&
    prevLines[oldLen - 1 - suffix].text === parsedIncoming[newLen - 1 - suffix].text &&
    !parsedIncoming[newLen - 1 - suffix].hasTag
  ) {
    suffix++;
  }

  const result: ParsedLyricLine[] = new Array(newLen);

  // 1. Copy prefix flags verbatim
  for (let i = 0; i < prefix; i++) {
    result[i] = { text: parsedIncoming[i].text, fix: prevLines[i].fix };
  }

  // 2. Copy suffix flags verbatim
  for (let s = 0; s < suffix; s++) {
    const oldIdx = oldLen - 1 - s;
    const newIdx = newLen - 1 - s;
    result[newIdx] = { text: parsedIncoming[newIdx].text, fix: prevLines[oldIdx].fix };
  }

  // 3. Reconcile edited middle span
  const oldMidCount = oldLen - prefix - suffix;
  const newMidCount = newLen - prefix - suffix;

  for (let m = 0; m < newMidCount; m++) {
    const newIdx = prefix + m;
    const incoming = parsedIncoming[newIdx];
    let keepFix = incoming.hasTag;

    if (!keepFix) {
      if (oldMidCount === newMidCount) {
        // Same number of lines edited in place -> preserve exact flag
        keepFix = prevLines[prefix + m]?.fix ?? false;
      } else if (newMidCount === 1 && oldMidCount > 1) {
        // Multiple lines merged into 1 (Backspace/Delete) -> keep fix if any merged line had fix
        for (let k = 0; k < oldMidCount; k++) {
          if (prevLines[prefix + k]?.fix) keepFix = true;
        }
      } else if (m === 0 && oldMidCount >= 1) {
        // Line split with Enter -> keep fix on the original top line, new line starts clean
        keepFix = prevLines[prefix]?.fix ?? false;
      }
    }

    result[newIdx] = {
      text: incoming.text,
      fix: keepFix && incoming.text.trim().length > 0,
    };
  }

  return result.length > 0 ? result : [{ text: '', fix: false }];
}

interface LyricLinesEditorProps {
  value: string;
  onChange: (nextSerialized: string) => void;
  placeholder?: string;
  compact?: boolean;
  minHeightClass?: string;
  onFocusLine?: (lineIndex: number) => void;
  onNavigateEdge?: (direction: 'prev' | 'next') => void;
  registerFocusApi?: (api: { focusStart: () => void; focusEnd: () => void } | null) => void;
}

/**
 * Single native `<textarea>` overlaid pixel-for-pixel onto an in-flow mirror with an interactive
 * left FIX gutter:
 * - 100% native multi-line selection & copy/paste (Ctrl+C, Ctrl+A, iOS selection handles)
 * - 1-click per-line FIX button aligned even on wrapped lines on mobile
 * - ZERO raw `[FIX]` tags ever visible inside the lyrics!
 */
export function LyricLinesEditor({
  value,
  onChange,
  placeholder = 'Écris tes lignes ici…',
  compact = false,
  minHeightClass = '',
  onFocusLine,
  onNavigateEdge,
  registerFocusApi,
}: LyricLinesEditorProps) {
  const lines = useMemo(() => parseLyricLines(value), [value]);
  const cleanText = useMemo(() => lines.map((l) => l.text).join('\n'), [lines]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!registerFocusApi) return;
    registerFocusApi({
      focusStart: () => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        try {
          el.setSelectionRange(0, 0);
        } catch {
          // ignore
        }
      },
      focusEnd: () => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        try {
          const len = el.value.length;
          el.setSelectionRange(len, len);
        } catch {
          // ignore
        }
      },
    });
    return () => registerFocusApi(null);
  }, [registerFocusApi]);

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const reconciled = reconcileLinesWithFixFlags(lines, e.target.value);
    onChange(serializeLyricLines(reconciled));
  };

  const handleToggleFix = (idx: number) => {
    const next = lines.map((l, i) => (i === idx ? { ...l, fix: !l.fix } : l));
    onChange(serializeLyricLines(next));
  };

  const reportCursorLine = (el: HTMLTextAreaElement) => {
    if (!onFocusLine) return;
    const pos = el.selectionStart ?? 0;
    const lineIdx = el.value.slice(0, pos).split('\n').length - 1;
    onFocusLine(lineIdx);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    if (e.key === 'ArrowDown' && !e.shiftKey && onNavigateEdge) {
      const after = el.value.slice(el.selectionEnd ?? 0);
      if (!after.includes('\n')) {
        e.preventDefault();
        onNavigateEdge('next');
      }
    } else if (e.key === 'ArrowUp' && !e.shiftKey && onNavigateEdge) {
      const before = el.value.slice(0, el.selectionStart ?? 0);
      if (!before.includes('\n')) {
        e.preventDefault();
        onNavigateEdge('prev');
      }
    } else if (
      e.key === 'Backspace' &&
      el.value.length === 0 &&
      (el.selectionStart ?? 0) === 0 &&
      onNavigateEdge
    ) {
      e.preventDefault();
      onNavigateEdge('prev');
    }
  };

  const textMetricsCls = compact
    ? 'font-sans text-[15px] sm:text-[15.5px] leading-[1.78]'
    : 'font-sans text-[15.5px] sm:text-base leading-[1.85]';

  return (
    <div
      className={`relative w-full ${minHeightClass}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          textareaRef.current?.focus();
        }
      }}
    >
      {/* Layer 1: Pixel-locked in-flow mirror + clickable per-line FIX gutter */}
      <div className="w-full">
        {lines.map((line, idx) => {
          const hasContent = line.text.trim().length > 0;
          return (
            <div
              key={idx}
              className={`group/line relative flex items-start rounded-lg transition-colors ${
                line.fix
                  ? 'bg-rose-500/[0.09] dark:bg-rose-500/[0.14] shadow-[inset_2px_0_0_#8C271E]'
                  : ''
              }`}
            >
              {/* Fixed-width 42px left gutter so textarea left offset never shifts */}
              <div className="relative z-20 w-[42px] shrink-0 flex items-start justify-start pt-[4px] pl-1 select-none">
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleToggleFix(idx)}
                  title={
                    line.fix
                      ? 'Retirer le repère À fix'
                      : 'Marquer cette ligne comme À fix'
                  }
                  className={`inline-flex items-center justify-center gap-0.5 rounded-md transition-all cursor-pointer ${
                    line.fix
                      ? 'bg-[#8C271E] text-white px-1.5 h-[19px] text-[9px] font-bold tracking-wide shadow-xs'
                      : hasContent
                      ? 'h-[19px] w-[19px] text-slate-300 dark:text-zinc-600 opacity-55 sm:opacity-30 hover:!opacity-100 hover:bg-rose-500/12 hover:text-[#8C271E] dark:hover:text-[#f08b82]'
                      : 'h-[19px] w-[19px] opacity-0 pointer-events-none'
                  }`}
                >
                  <Wrench size={9.5} />
                  {line.fix && <span>FIX</span>}
                </button>
              </div>

              {/* Invisible text mirror guaranteeing identical wrapping height with the overlaid textarea */}
              <div
                aria-hidden="true"
                style={{ overflowWrap: 'break-word', wordBreak: 'break-word' }}
                className={`flex-1 min-w-0 p-0 m-0 pr-1 text-transparent select-none pointer-events-none whitespace-pre-wrap ${textMetricsCls}`}
              >
                {line.text.length > 0 ? line.text : '\u200B'}
              </div>
            </div>
          );
        })}
      </div>

      {/* Layer 2: Single native <textarea> for 100% native multi-line selection, Ctrl+C & mobile handles */}
      <textarea
        ref={textareaRef}
        value={cleanText}
        spellCheck={false}
        onChange={handleTextareaChange}
        onKeyDown={handleKeyDown}
        onFocus={(e) => reportCursorLine(e.currentTarget)}
        onSelect={(e) => reportCursorLine(e.currentTarget)}
        onClick={(e) => reportCursorLine(e.currentTarget)}
        placeholder={placeholder}
        style={{ overflowWrap: 'break-word', wordBreak: 'break-word' }}
        className={`absolute top-0 bottom-0 left-[42px] right-0 z-10 w-[calc(100%-42px)] h-full p-0 m-0 pr-1 bg-transparent border-0 outline-none resize-none overflow-hidden whitespace-pre-wrap text-slate-800 dark:text-zinc-100 placeholder:text-slate-300 dark:placeholder:text-zinc-600 caret-[#8C271E] ${textMetricsCls}`}
      />
    </div>
  );
}
