import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Pause, Play, RefreshCw, Sparkles } from 'lucide-react';

type InspirationCategory = 'mix' | 'mots' | 'familier' | 'expressions' | 'dictons';

/**
 * Curated songwriter corpus:
 * 1. MOTS_COMMUNS: Everyday, evocative, punchy words used in French songwriting/rap/pop (no weird conjugations!)
 * 2. FAMILIER_QUOTIDIEN: Spoken, familiar, street & everyday words/short phrases people actually say
 * 3. EXPRESSIONS_COURTES: Punchy French idioms & conversational expressions
 * 4. DICTONS_CONNUS: Well-known proverbs & sayings that spark bars, hooks, or metaphors
 */
const MOTS_COMMUNS: string[] = [
  // 1 syllabe
  'nuit', 'ombre', 'feu', 'froid', 'or', 'sang', 'temps', 'vent', 'ciel', 'mer',
  'vide', 'plein', 'peur', 'paix', 'rêve', 'vrai', 'faux', 'loin', 'près', 'haut',
  'bas', 'seul', 'coeur', 'âme', 'voix', 'pas', 'main', 'oeil', 'mur', 'pont',
  'train', 'route', 'phare', 'bruit', 'cri', 'choc', 'coup', 'sort', 'choix', 'doute',
  'faim', 'soif', 'pluie', 'neige', 'glace', 'flamme', 'cendre', 'pierre', 'fer', 'verre',
  'fil', 'noeud', 'clé', 'porte', 'toit', 'rue', 'tour', 'quai', 'port', 'cap',
  // 2 syllabes
  'minuit', 'silence', 'bitume', 'béton', 'mirage', 'vertige', 'orage', 'fumée', 'écho', 'reflet',
  'instinct', 'promesse', 'mensonge', 'secret', 'mémoire', 'oubli', 'destin', 'hasard', 'retour', 'détour',
  'départ', 'vitesse', 'virage', 'impasse', 'falaise', 'sommet', 'abîme', 'couronne', 'trophée', 'fardeau',
  'remède', 'poison', 'blessure', 'fierté', 'orgueil', 'honneur', 'courage', 'galère', 'fortune', 'monnaie',
  'billet', 'contrat', 'parfum', 'regard', 'sourire', 'soupir', 'frisson', 'lueur', 'éclair', 'tonnerre',
  'saison', 'hiver', 'automne', 'printemps', 'matin', 'aurore', 'crépuscule', 'soleil', 'étoile', 'planète',
  'boussole', 'sablier', 'horloge', 'miroir', 'fenêtre', 'balcon', 'couloir', 'sous-sol', 'grenier', 'palier',
  'périph', 'tunnel', 'parking', 'trottoir', 'néon', 'vitrine', 'rideau', 'bagage', 'valise', 'ticket',
  'refrain', 'couplet', 'tempo', 'accord', 'vinyle', 'cassette', 'micro', 'studio', 'scène', 'public',
  // 3+ syllabes
  'cicatrice', 'solitude', 'horizon', 'labyrinthe', 'étincelle', 'incendie', 'équilibre', 'paradoxe',
  'souvenir', 'nostalgie', 'insomnie', 'adrénaline', 'patience', 'évidence', 'confiance', 'trahison',
  'aventure', 'liberté', 'vérité', 'illusion', 'obsession', 'ambition', 'résistance', 'renaissance',
  'étouffement', 'apesanteur', 'camouflage', 'carrefour', 'ascenseur', 'rétroviseur', 'passager', 'insulaire',
  'océan', 'continent', 'territoire', 'frontière', 'capitale', 'banlieue', 'silhouette', 'fantôme',
  'mélancolie', 'symphonie', 'mélodie', 'harmonie', 'fréquence', 'résonance', 'gravité', 'éternité',
];

const FAMILIER_QUOTIDIEN: string[] = [
  'charbon', 'la dalle', 'en scred', 'carré', 'la hess', 'le tarot', 'plein phare', 'sans filet',
  'en roue libre', 'sous l’eau', 'à bloc', 'la galère', 'le biff', 'la mif', 'les vrais', 'les faux',
  'dans le rétro', 'sur le fil', 'à contre-courant', 'la tête haute', 'les mains vides', 'les yeux fermés',
  'coup de poker', 'zone grise', 'faux semblants', 'mauvais œil', 'au charbon', 'faire le tri',
  'péter le score', 'dans le viseur', 'à la base', 'en vrai', 'sans forcer', 'au feeling',
  'prise de tête', 'coup de bluff', 'coup de foudre', 'coup de pression', 'baisser la garde',
  'changer de disque', 'plier bagage', 'passer un cap', 'tenir la barre', 'garder le cap',
  'la vie d’artiste', 'deuxième chance', 'partir de rien', 'tout donner', 'rien lâcher',
  'faire ses preuves', 'en douce', 'à l’ancienne', 'sur un coup de tête', 'à bout de souffle',
  'le coeur léger', 'la boule au ventre', 'avoir le seum', 'c’est carré', 'dans la foulée',
  'au pied du mur', 'sans détour', 'cartes sur table', 'à demi-mot', 'entre les lignes',
];

const EXPRESSIONS_COURTES: string[] = [
  'Tourner la page',
  'Couper les ponts',
  'Prendre le large',
  'Jouer avec le feu',
  'Tomber le masque',
  'Remettre les pendules à l’heure',
  'Brûler les étapes',
  'Marcher sur des œufs',
  'Avoir le cœur sur la main',
  'Dormir sur ses deux oreilles',
  'Mettre de l’eau dans son vin',
  'Jeter de l’huile sur le feu',
  'Tirer son épingle du jeu',
  'Rendre la monnaie de sa pièce',
  'Partir en fumée',
  'Chercher midi à quatorze heures',
  'Avoir la tête dans les nuages',
  'Garder les pieds sur terre',
  'Être dans l’œil du cyclone',
  'Revenir de loin',
  'Tourner en rond',
  'Voir le bout du tunnel',
  'Frapper un grand coup',
  'Prendre son mal en patience',
  'Renvoyer l’ascenseur',
  'Cacher son jeu',
  'Abattre ses cartes',
  'À quitte ou double',
  'Au bord du précipice',
  'Le calme avant la tempête',
  'Entre l’enclume et le marteau',
  'Comme un poisson dans l’eau',
  'La goutte d’eau qui fait déborder le vase',
  'Avoir plusieurs cordes à son arc',
  'Se brûler les ailes',
  'Sortir de l’ombre',
];

const DICTONS_CONNUS: string[] = [
  'Tout ce qui brille n’est pas or',
  'Après la pluie, le beau temps',
  'Loin des yeux, près du cœur',
  'La nuit porte conseil',
  'Le temps c’est de l’argent',
  'Qui vivra verra',
  'L’habit ne fait pas le moine',
  'Rira bien qui rira le dernier',
  'Chasser le naturel, il revient au galop',
  'Les paroles s’envolent, les écrits restent',
  'Mieux vaut tard que jamais',
  'À cœur vaillant rien d’impossible',
  'Les murs ont des oreilles',
  'Qui sème le vent récolte la tempête',
  'Il n’y a pas de fumée sans feu',
  'On ne fait pas d’omelette sans casser des œufs',
  'La roue tourne',
  'Tout vient à point à qui sait attendre',
  'Mieux vaut être seul que mal accompagné',
  'La parole est d’argent, le silence est d’or',
  'L’union fait la force',
  'Qui ne tente rien n’a rien',
  'Les apparences sont trompeuses',
  'Chacun voit midi à sa porte',
  'Il faut battre le fer tant qu’il est chaud',
  'Pierre qui roule n’amasse pas mousse',
  'Petit à petit, l’oiseau fait son nid',
  'La fortune sourit aux audacieux',
  'Tel est pris qui croyait prendre',
  'Un mal pour un bien',
];

/** French syllable estimator for single words / short tokens */
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

function pickRandomUnique<T>(pool: T[], count: number): T[] {
  const copy = [...pool];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(count, copy.length));
}

export function LexCoreInspirationWidget({
  onInsertWord,
}: {
  onInsertWord?: (word: string) => void;
}) {
  const [category, setCategory] = useState<InspirationCategory>('mix');
  const [syllables, setSyllables] = useState<number>(0); // 0 = Tous, 1, 2, 3 = 3+
  const [seedNonce, setSeedNonce] = useState<number>(0);

  const items = useMemo(() => {
    // Build pool according to chosen category
    if (category === 'dictons') {
      return pickRandomUnique(DICTONS_CONNUS, 8);
    }
    if (category === 'expressions') {
      return pickRandomUnique(EXPRESSIONS_COURTES, 10);
    }
    if (category === 'familier') {
      let pool = FAMILIER_QUOTIDIEN;
      if (syllables > 0) {
        pool = pool.filter((item) => {
          const syl = countSyllablesFR(item);
          return syllables >= 3 ? syl >= 3 : syl === syllables;
        });
      }
      return pickRandomUnique(pool.length > 0 ? pool : FAMILIER_QUOTIDIEN, 14);
    }
    if (category === 'mots') {
      let pool = MOTS_COMMUNS;
      if (syllables > 0) {
        pool = pool.filter((w) => {
          const syl = countSyllablesFR(w);
          return syllables >= 3 ? syl >= 3 : syl === syllables;
        });
      }
      return pickRandomUnique(pool.length > 0 ? pool : MOTS_COMMUNS, 16);
    }

    // Default 'mix': smart blend of common evocative words, familiar phrases, expressions, and dictons!
    let wordPool = MOTS_COMMUNS;
    let famPool = FAMILIER_QUOTIDIEN;
    if (syllables > 0) {
      wordPool = wordPool.filter((w) => {
        const syl = countSyllablesFR(w);
        return syllables >= 3 ? syl >= 3 : syl === syllables;
      });
      famPool = famPool.filter((w) => {
        const syl = countSyllablesFR(w);
        return syllables >= 3 ? syl >= 3 : syl === syllables;
      });
      return pickRandomUnique([...wordPool, ...famPool], 14);
    }

    const pickedWords = pickRandomUnique(wordPool, 6);
    const pickedFam = pickRandomUnique(famPool, 4);
    const pickedExpr = pickRandomUnique(EXPRESSIONS_COURTES, 3);
    const pickedDictons = pickRandomUnique(DICTONS_CONNUS, 2);
    return pickRandomUnique(
      [...pickedWords, ...pickedFam, ...pickedExpr, ...pickedDictons],
      15
    );
  }, [category, syllables, seedNonce]);

  const showSyllableFilter = category === 'mix' || category === 'mots' || category === 'familier';

  return (
    <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/50 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-400 flex items-center gap-1.5">
          <Sparkles size={12} className="text-[#8C271E]" />
          Inspiration
        </h4>
        <button
          type="button"
          onClick={() => setSeedNonce((n) => n + 1)}
          className="h-7 w-7 rounded-full bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 flex items-center justify-center text-slate-600 dark:text-zinc-200 hover:scale-105 active:scale-95 transition cursor-pointer"
          title="Nouveau tirage"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {/* Category Filter Pills (Mix · Mots · Familier · Expressions · Dictons) */}
      <div className="flex flex-wrap items-center gap-1">
        {(
          [
            { id: 'mix', label: 'Mix' },
            { id: 'mots', label: 'Mots' },
            { id: 'familier', label: 'Familier' },
            { id: 'expressions', label: 'Expressions' },
            { id: 'dictons', label: 'Dictons' },
          ] as const
        ).map((tab) => {
          const active = category === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setCategory(tab.id);
                if (tab.id === 'expressions' || tab.id === 'dictons') {
                  setSyllables(0);
                }
              }}
              className={`rounded-lg px-2.5 py-1 text-[10px] font-semibold transition cursor-pointer ${
                active
                  ? 'bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25 shadow-2xs'
                  : 'bg-white dark:bg-zinc-900 text-slate-500 dark:text-zinc-400 border border-slate-200/70 dark:border-zinc-800 hover:text-slate-900 dark:hover:text-zinc-200'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Optional Syllable Filter (for Mots / Familier / Mix) */}
      {showSyllableFilter && (
        <div className="flex items-center gap-1">
          {[
            { val: 0, label: 'Toutes syl.' },
            { val: 1, label: '1 syl' },
            { val: 2, label: '2 syl' },
            { val: 3, label: '3+' },
          ].map((opt) => (
            <button
              key={opt.val}
              type="button"
              onClick={() => setSyllables(opt.val)}
              className={`flex-1 rounded-lg py-1 text-[10px] font-medium transition cursor-pointer ${
                syllables === opt.val
                  ? 'bg-[#8C271E]/14 text-[#8C271E] font-semibold'
                  : 'bg-white/70 dark:bg-zinc-900/60 text-slate-400 dark:text-zinc-500 border border-slate-200/50 dark:border-zinc-800/70 hover:text-slate-700 dark:hover:text-zinc-300'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* Clickable Inspiration Chips */}
      <div className="flex flex-wrap gap-1.5 max-h-56 overflow-y-auto pr-0.5">
        {items.map((item, i) => {
          const isLongPhrase = item.split(' ').length >= 4;
          return (
            <button
              key={`${item}-${i}`}
              type="button"
              onClick={() => onInsertWord?.(item)}
              title={onInsertWord ? 'Cliquer pour insérer dans ton texte' : item}
              className={`rounded-xl bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 px-2.5 py-1.5 text-left text-xs font-medium text-slate-700 dark:text-zinc-200 hover:border-[#8C271E] hover:text-slate-950 dark:hover:text-white active:scale-[0.98] transition cursor-pointer ${
                isLongPhrase ? 'w-full' : ''
              }`}
            >
              {isLongPhrase ? `« ${item} »` : item}
            </button>
          );
        })}
      </div>
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
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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
          className={`h-2 w-2 rounded-full ${
            isPlaying ? 'bg-[#8C271E] animate-pulse' : 'bg-slate-300 dark:bg-zinc-700'
          }`}
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 transition cursor-pointer ${
            isPlaying
              ? 'bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25'
              : 'bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 text-slate-900 dark:text-zinc-100'
          }`}
        >
          {isPlaying ? (
            <Pause size={15} fill="currentColor" />
          ) : (
            <Play size={15} fill="currentColor" className="ml-0.5" />
          )}
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
