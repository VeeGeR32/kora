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

interface LineRowInputProps {
  line: ParsedLyricLine;
  lineIndex: number;
  placeholder?: string;
  compact?: boolean;
  inputRef: (el: HTMLTextAreaElement | null) => void;
  onChangeText: (text: string) => void;
  onToggleFix: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onFocus: () => void;
}

function LineRowInput({
  line,
  placeholder,
  compact,
  inputRef,
  onChangeText,
  onToggleFix,
  onKeyDown,
  onPaste,
  onFocus,
}: LineRowInputProps) {
  const localRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = localRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.max(compact ? 26 : 28, el.scrollHeight)}px`;
  }, [line.text, compact]);

  const hasContent = line.text.trim().length > 0;

  return (
    <div
      className={`group/line flex items-start gap-2 rounded-xl px-1.5 -mx-1.5 transition-colors ${
        line.fix
          ? 'bg-rose-500/[0.08] dark:bg-rose-500/[0.13] ring-1 ring-rose-500/25 py-0.5 my-0.5'
          : 'hover:bg-slate-100/50 dark:hover:bg-zinc-800/35 py-[1px]'
      }`}
    >
      {/* 1-Click Per-Line FIX Toggle Button */}
      <button
        type="button"
        tabIndex={-1}
        onMouseDown={(e) => {
          // Keep typing flow smooth without stealing scroll
          e.preventDefault();
        }}
        onClick={onToggleFix}
        title={
          line.fix
            ? 'Retirer le repère À fix sur cette ligne'
            : 'Marquer cette ligne comme À fix'
        }
        className={`mt-[3px] inline-flex items-center justify-center gap-1 rounded-md transition-all cursor-pointer shrink-0 ${
          line.fix
            ? 'bg-[#8C271E] text-white px-1.5 h-5 text-[9.5px] font-bold tracking-wide shadow-xs'
            : hasContent
            ? 'h-5 w-5 text-slate-300 dark:text-zinc-600 opacity-50 sm:opacity-0 sm:group-hover/line:opacity-100 sm:group-focus-within/line:opacity-100 hover:!opacity-100 hover:bg-rose-500/12 hover:text-[#8C271E] dark:hover:text-[#f08b82]'
            : 'h-5 w-5 text-slate-300 dark:text-zinc-700 opacity-0 pointer-events-none'
        }`}
      >
        <Wrench size={10} />
        {line.fix && <span>FIX</span>}
      </button>

      {/* Clean, borderless wrapping lyric line */}
      <textarea
        ref={(el) => {
          localRef.current = el;
          inputRef(el);
        }}
        rows={1}
        value={line.text}
        spellCheck={false}
        onFocus={onFocus}
        onChange={(e) => onChangeText(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        placeholder={placeholder}
        className={`flex-1 min-w-0 bg-transparent outline-none resize-none overflow-hidden ${
          compact
            ? 'text-[15px] sm:text-[15.5px] leading-[1.7]'
            : 'text-[15.5px] sm:text-base leading-[1.8]'
        } ${
          line.fix
            ? 'text-slate-950 dark:text-white font-medium'
            : 'text-slate-800 dark:text-zinc-100'
        } placeholder:text-slate-300 dark:placeholder:text-zinc-600`}
      />
    </div>
  );
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
  const lineRefs = useRef<Map<number, HTMLTextAreaElement>>(new Map());
  const pendingFocusRef = useRef<{ idx: number; pos: number } | null>(null);

  const focusLineAt = (idx: number, pos?: number) => {
    const clampedIdx = Math.max(0, Math.min(lines.length - 1, idx));
    const el = lineRefs.current.get(clampedIdx);
    if (el) {
      el.focus();
      const targetPos = typeof pos === 'number' ? Math.min(el.value.length, Math.max(0, pos)) : el.value.length;
      try {
        el.setSelectionRange(targetPos, targetPos);
      } catch {
        // ignore
      }
    }
  };

  useEffect(() => {
    if (!registerFocusApi) return;
    registerFocusApi({
      focusStart: () => {
        const el = lineRefs.current.get(0);
        if (el) {
          el.focus();
          try {
            el.setSelectionRange(0, 0);
          } catch {
            // ignore
          }
        }
      },
      focusEnd: () => {
        const lastIdx = Math.max(0, lines.length - 1);
        const el = lineRefs.current.get(lastIdx);
        if (el) {
          el.focus();
          try {
            el.setSelectionRange(el.value.length, el.value.length);
          } catch {
            // ignore
          }
        }
      },
    });
    return () => registerFocusApi(null);
  }, [registerFocusApi, lines.length]);

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    pendingFocusRef.current = null;
    const el = lineRefs.current.get(pending.idx);
    if (el) {
      el.focus();
      const p = Math.min(el.value.length, Math.max(0, pending.pos));
      try {
        el.setSelectionRange(p, p);
      } catch {
        // ignore
      }
    }
  }, [lines]);

  const commitLines = (next: ParsedLyricLine[], focusTarget?: { idx: number; pos: number }) => {
    const safe = next.length > 0 ? next : [{ text: '', fix: false }];
    if (focusTarget) {
      pendingFocusRef.current = focusTarget;
    }
    onChange(serializeLyricLines(safe));
  };

  const handleChangeText = (idx: number, rawNext: string) => {
    // Handle IME / mobile autocomplete inserting newlines directly into onChange
    if (rawNext.includes('\n')) {
      const parts = rawNext.replace(/\r\n/g, '\n').split('\n');
      const next = [...lines];
      const replacement: ParsedLyricLine[] = parts.map((p, pIdx) => ({
        text: p,
        fix: pIdx === 0 ? lines[idx].fix : false,
      }));
      next.splice(idx, 1, ...replacement);
      commitLines(next, { idx: idx + replacement.length - 1, pos: replacement[replacement.length - 1].text.length });
      return;
    }
    const next = lines.map((l, i) => (i === idx ? { ...l, text: rawNext } : l));
    commitLines(next);
  };

  const handleToggleFix = (idx: number) => {
    const next = lines.map((l, i) => (i === idx ? { ...l, fix: !l.fix } : l));
    commitLines(next);
  };

  const handleKeyDown = (idx: number, e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const before = el.value.slice(0, start);
      const after = el.value.slice(end);
      const next = [...lines];
      next[idx] = { ...next[idx], text: before };
      next.splice(idx + 1, 0, { text: after, fix: false });
      commitLines(next, { idx: idx + 1, pos: 0 });
      return;
    }

    if (e.key === 'Backspace' && start === 0 && end === 0) {
      if (idx > 0) {
        e.preventDefault();
        const prev = lines[idx - 1];
        const cur = lines[idx];
        const joinPos = prev.text.length;
        const next = [...lines];
        next[idx - 1] = {
          text: prev.text + cur.text,
          fix: prev.fix || cur.fix,
        };
        next.splice(idx, 1);
        commitLines(next, { idx: idx - 1, pos: joinPos });
      } else if (lines.length === 1 && lines[0].text === '' && onNavigateEdge) {
        e.preventDefault();
        onNavigateEdge('prev');
      }
      return;
    }

    if (e.key === 'Delete' && start === el.value.length && end === el.value.length && idx < lines.length - 1) {
      e.preventDefault();
      const cur = lines[idx];
      const nextLine = lines[idx + 1];
      const joinPos = cur.text.length;
      const next = [...lines];
      next[idx] = {
        text: cur.text + nextLine.text,
        fix: cur.fix || nextLine.fix,
      };
      next.splice(idx + 1, 1);
      commitLines(next, { idx, pos: joinPos });
      return;
    }

    if (e.key === 'ArrowUp' && !e.shiftKey) {
      // Only navigate up if caret is near top of textarea (no wrapped text before or caret at start)
      if (idx > 0) {
        e.preventDefault();
        focusLineAt(idx - 1, start);
      } else if (onNavigateEdge) {
        e.preventDefault();
        onNavigateEdge('prev');
      }
      return;
    }

    if (e.key === 'ArrowDown' && !e.shiftKey) {
      if (idx < lines.length - 1) {
        e.preventDefault();
        focusLineAt(idx + 1, start);
      } else if (onNavigateEdge) {
        e.preventDefault();
        onNavigateEdge('next');
      }
    }
  };

  const handlePaste = (idx: number, e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = e.clipboardData.getData('text/plain');
    if (!pasted) return;
    if (!pasted.includes('\n') && !/\[FIX(?::[^\]]*)?\]/i.test(pasted)) {
      return; // Let native single-line paste run cleanly
    }
    e.preventDefault();
    const el = e.currentTarget;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const before = el.value.slice(0, start);
    const after = el.value.slice(end);

    const parsedPasted = parseLyricLines(pasted);
    const next = [...lines];
    if (parsedPasted.length === 1) {
      next[idx] = {
        text: before + parsedPasted[0].text + after,
        fix: next[idx].fix || parsedPasted[0].fix,
      };
      commitLines(next, { idx, pos: before.length + parsedPasted[0].text.length });
    } else {
      const inserted: ParsedLyricLine[] = parsedPasted.map((p, i) => {
        if (i === 0) {
          return { text: before + p.text, fix: next[idx].fix || p.fix };
        }
        if (i === parsedPasted.length - 1) {
          return { text: p.text + after, fix: p.fix };
        }
        return p;
      });
      next.splice(idx, 1, ...inserted);
      const lastInsertedIdx = idx + inserted.length - 1;
      const lastCursorPos = parsedPasted[parsedPasted.length - 1].text.length;
      commitLines(next, { idx: lastInsertedIdx, pos: lastCursorPos });
    }
  };

  return (
    <div
      className={`space-y-0.5 ${minHeightClass}`}
      onClick={(e) => {
        // Clicking empty space below the last line focuses the last line naturally
        if (e.target === e.currentTarget) {
          focusLineAt(lines.length - 1);
        }
      }}
    >
      {lines.map((line, idx) => (
        <LineRowInput
          key={idx}
          line={line}
          lineIndex={idx}
          compact={compact}
          placeholder={idx === 0 ? placeholder : undefined}
          inputRef={(el) => {
            if (el) lineRefs.current.set(idx, el);
            else lineRefs.current.delete(idx);
          }}
          onFocus={() => onFocusLine?.(idx)}
          onChangeText={(txt) => handleChangeText(idx, txt)}
          onToggleFix={() => handleToggleFix(idx)}
          onKeyDown={(e) => handleKeyDown(idx, e)}
          onPaste={(e) => handlePaste(idx, e)}
        />
      ))}
    </div>
  );
}
