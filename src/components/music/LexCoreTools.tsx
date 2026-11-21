import { useEffect, useRef, useState } from 'react';
import { Activity, Pause, Play, RefreshCw, Sparkles } from 'lucide-react';

let cachedDict: string[] | null = null;

/** Exact French syllable estimator adapted from LexCore */
function countSyllablesFR(raw: string): number {
  let word = raw.toLowerCase().trim();
  if (word.length <= 3) return 1;
  word = word.replace(/(?:[^laeiouy]es|ed|ue)$/, '');
  word = word.replace(/^y/, '');
  const match = word.match(/[aeiouyàâäéèêëîïôöùûü]{1,2}/g);
  let count = match ? match.length : 1;
  if (word.endsWith('e')) count--;
  return count > 0 ? count : 1;
}

async function loadDictionary(): Promise<string[]> {
  if (cachedDict) return cachedDict;
  const res = await fetch('/dictionnaire.txt');
  const text = await res.text();
  cachedDict = text
    .split(/\r?\n/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1);
  return cachedDict;
}

export function LexCoreInspirationWidget({ onInsertWord }: { onInsertWord?: (word: string) => void }) {
  const [words, setWords] = useState<string[]>([]);
  const [syllables, setSyllables] = useState<number>(0); // 0 = Tous, 1, 2, 3, 4 = 4+
  const [loading, setLoading] = useState(false);

  const generate = async (targetSyl = syllables) => {
    setLoading(true);
    try {
      const dict = await loadDictionary();
      let pool = dict;
      if (targetSyl > 0) {
        pool =
          targetSyl >= 4
            ? dict.filter((w) => countSyllablesFR(w) >= 4)
            : dict.filter((w) => countSyllablesFR(w) === targetSyl);
      }
      if (pool.length === 0) {
        setWords(['Aucun mot trouvé']);
        return;
      }
      const picked: string[] = [];
      for (let i = 0; i < 18; i++) {
        picked.push(pool[Math.floor(Math.random() * pool.length)]);
      }
      setWords(picked);
    } catch {
      setWords(['Erreur dictionnaire']);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/50 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-400 flex items-center gap-1.5">
          <Sparkles size={12} className="text-fuchsia-500" />
          LexCore · Inspiration
        </h4>
        <button
          type="button"
          onClick={() => generate(syllables)}
          disabled={loading}
          className="h-7 w-7 rounded-full bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 flex items-center justify-center text-slate-600 dark:text-zinc-200 hover:scale-105 transition cursor-pointer"
          title="Générer des mots"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Syllable filter */}
      <div className="flex items-center gap-1">
        {[
          { val: 0, label: 'Tous' },
          { val: 1, label: '1 syl' },
          { val: 2, label: '2' },
          { val: 3, label: '3' },
          { val: 4, label: '4+' },
        ].map((opt) => (
          <button
            key={opt.val}
            type="button"
            onClick={() => {
              setSyllables(opt.val);
              void generate(opt.val);
            }}
            className={`flex-1 rounded-lg py-1 text-[10px] font-medium transition cursor-pointer ${
              syllables === opt.val
                ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                : 'bg-white dark:bg-zinc-900 text-slate-500 dark:text-zinc-400 border border-slate-200/70 dark:border-zinc-800'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {words.length === 0 ? (
        <button
          type="button"
          onClick={() => generate(syllables)}
          className="py-5 text-center text-xs text-slate-400 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-zinc-300 transition cursor-pointer italic"
        >
          « La page blanche est un miroir. »
          <span className="block not-italic text-[11px] mt-1 font-medium text-fuchsia-600 dark:text-fuchsia-400">
            Cliquer pour tirer 18 mots
          </span>
        </button>
      ) : (
        <div className="flex flex-wrap gap-1.5 max-h-44 overflow-y-auto">
          {words.map((w, i) => (
            <button
              key={`${w}-${i}`}
              type="button"
              onClick={() => onInsertWord?.(w)}
              title={onInsertWord ? 'Cliquer pour insérer dans le texte' : w}
              className="rounded-lg bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-zinc-200 hover:border-fuchsia-400 dark:hover:border-fuchsia-500 transition cursor-pointer"
            >
              {w}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function MetronomeWidget({ initialBpm = 120 }: { initialBpm?: number }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [bpm, setBpm] = useState(initialBpm);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    setBpm(initialBpm);
  }, [initialBpm]);

  const playClick = () => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(840, ctx.currentTime);
    gain.gain.setValueAtTime(0.6, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
  };

  useEffect(() => {
    if (isPlaying) {
      const ms = (60 / bpm) * 1000;
      playClick();
      timerRef.current = window.setInterval(playClick, ms);
    } else if (timerRef.current) {
      window.clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [isPlaying, bpm]);

  const toggle = () => {
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtxRef.current = new Ctx();
    }
    if (audioCtxRef.current.state === 'suspended') {
      void audioCtxRef.current.resume();
    }
    setIsPlaying((p) => !p);
  };

  return (
    <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-400 flex items-center gap-1.5">
          <Activity size={12} /> Métronome
        </span>
        <span
          className={`h-2 w-2 rounded-full ${isPlaying ? 'bg-fuchsia-500 animate-pulse' : 'bg-slate-300 dark:bg-zinc-700'}`}
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 transition cursor-pointer ${
            isPlaying
              ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
              : 'bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 text-slate-900 dark:text-zinc-100'
          }`}
        >
          {isPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="ml-0.5" />}
        </button>

        <div className="flex-1">
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-[10px] text-slate-400">BPM</span>
            <span className="font-mono text-base font-bold tabular-nums text-slate-900 dark:text-zinc-100">
              {bpm}
            </span>
          </div>
          <input
            type="range"
            min={60}
            max={200}
            value={bpm}
            onChange={(e) => setBpm(Number(e.target.value))}
            className="w-full h-1 accent-slate-900 dark:accent-zinc-100 cursor-pointer"
          />
        </div>
      </div>
    </div>
  );
}
