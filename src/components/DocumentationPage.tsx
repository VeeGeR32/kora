import { useState } from 'react';
import {
  BookOpen,
  Check,
  Copy,
  Disc3,
  ExternalLink,
  FileText,
  Flame,
  GitBranch,
  HardDrive,
  Keyboard,
  ListChecks,
  MousePointerClick,
  Music2,
  Plus,
  Share2,
  Smartphone,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import type { MusicSubTab } from './music/MusicView';

interface DocumentationPageProps {
  onNavigateTab: (tab: MusicSubTab) => void;
  onOpenDriveManager: () => void;
  onCreateProject: () => void;
  onCreateLyrics: () => void;
}

type DocSectionId = 'all' | 'setup' | 'naming' | 'workflow' | 'projects' | 'lyrics' | 'player';

const SECTIONS: { id: DocSectionId; label: string }[] = [
  { id: 'all', label: 'Tout le guide' },
  { id: 'setup', label: '1. Setup Drive' },
  { id: 'naming', label: '2. Nommage & Versions' },
  { id: 'workflow', label: '3. Pipeline & Notes' },
  { id: 'projects', label: '4. Projets & Sprints' },
  { id: 'lyrics', label: '5. Textes & [FIX]' },
  { id: 'player', label: '6. Kora Connect & Raccourcis' },
];

export function DocumentationPage({
  onNavigateTab,
  onOpenDriveManager,
  onCreateProject,
  onCreateLyrics,
}: DocumentationPageProps) {
  const { serviceAccountEmail, driveSources } = useApp();
  const [activeSection, setActiveSection] = useState<DocSectionId>('all');
  const [copiedEmail, setCopiedEmail] = useState(false);

  const handleCopyEmail = async () => {
    if (!serviceAccountEmail) return;
    try {
      await navigator.clipboard.writeText(serviceAccountEmail);
      setCopiedEmail(true);
      window.setTimeout(() => setCopiedEmail(false), 2000);
    } catch {
      // ignore
    }
  };

  const show = (id: DocSectionId) => activeSection === 'all' || activeSection === id;

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-14">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-[#FF5500]/12 text-[#FF5500] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider mb-2">
            <BookOpen size={11} />
            <span>Manuel Kora Studio</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-zinc-50">
            Guide & Documentation
          </h1>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
            Comment configurer tes Google Drives, nommer tes fichiers MP3 et utiliser tout le workflow studio comme prévu.
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onOpenDriveManager}
            className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-3.5 py-1.5 text-xs font-semibold hover:opacity-90 transition cursor-pointer"
          >
            <HardDrive size={12} />
            <span>Drives ({driveSources.length})</span>
          </button>
          <button
            type="button"
            onClick={onCreateProject}
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-zinc-200 hover:border-slate-400 transition cursor-pointer"
          >
            <Plus size={12} />
            <span>Projet</span>
          </button>
        </div>
      </div>

      {/* Section Filter Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {SECTIONS.map((sec) => {
          const active = activeSection === sec.id;
          return (
            <button
              key={sec.id}
              type="button"
              onClick={() => setActiveSection(sec.id)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition cursor-pointer shrink-0 ${
                active
                  ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 shadow-2xs'
                  : 'bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 text-slate-600 dark:text-zinc-300 hover:border-slate-400'
              }`}
            >
              {sec.label}
            </button>
          );
        })}
      </div>

      {/* ================= 1. SETUP GOOGLE DRIVE ================= */}
      {show('setup') && (
        <section className="tempo-card rounded-3xl p-5 sm:p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-2xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 flex items-center justify-center shrink-0">
                <HardDrive size={17} />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-zinc-50">
                  1. Connecter un ou plusieurs Google Drives (30 sec)
                </h2>
                <p className="text-xs text-slate-400">
                  Accès permanent en lecture seule · Zéro popup d’expiration sur iPhone et PC
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/60 dark:bg-zinc-900/40 p-3.5 space-y-1.5">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#FF5500] text-white font-mono text-[10px] font-bold">
                1
              </span>
              <p className="font-semibold text-slate-900 dark:text-zinc-100">
                Partager ton dossier Drive
              </p>
              <p className="text-slate-500 dark:text-zinc-400 leading-relaxed">
                Dans{' '}
                <a
                  href="https://drive.google.com/drive/my-drive"
                  target="_blank"
                  rel="noreferrer"
                  className="underline font-medium text-slate-800 dark:text-zinc-200 inline-flex items-center gap-0.5"
                >
                  Google Drive <ExternalLink size={10} />
                </a>
                , fais clic droit sur ton dossier de sons → <strong>Partager</strong> → ajoute l’email Kora en rôle <strong>Lecteur</strong> (ou active <em>« Tous les utilisateurs disposant du lien »</em>).
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/60 dark:bg-zinc-900/40 p-3.5 space-y-1.5">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#FF5500] text-white font-mono text-[10px] font-bold">
                2
              </span>
              <p className="font-semibold text-slate-900 dark:text-zinc-100">
                Coller le lien du dossier
              </p>
              <p className="text-slate-500 dark:text-zinc-400 leading-relaxed">
                Clique sur <strong>Drives</strong> en haut à droite (ou dans <strong>Paramètres</strong>), colle le lien <code className="font-mono text-[10px]">drive.google.com/drive/folders/...</code> et clique <strong>Connecter & Synchroniser</strong>.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/60 dark:bg-zinc-900/40 p-3.5 space-y-1.5">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#FF5500] text-white font-mono text-[10px] font-bold">
                3
              </span>
              <p className="font-semibold text-slate-900 dark:text-zinc-100">
                Multi-Drive & Resync auto
              </p>
              <p className="text-slate-500 dark:text-zinc-400 leading-relaxed">
                Tu peux connecter <strong>plusieurs dossiers Drive</strong> en même temps (ex. <em>Maquettes 2026</em>, <em>Archives</em>, <em>Exports Mix</em>). Si tu retires un Drive, ses sons sont nettoyés automatiquement.
              </p>
            </div>
          </div>

          {/* Direct Copy Service Account Email Box */}
          <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Email technique Kora (à inviter en Lecteur sur tes dossiers Drive)
              </p>
              <code className="block font-mono text-xs text-slate-800 dark:text-zinc-200 truncate select-all mt-0.5">
                {serviceAccountEmail || 'Chargement…'}
              </code>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={!serviceAccountEmail}
                onClick={() => void handleCopyEmail()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-3 py-2 text-xs font-semibold hover:opacity-90 disabled:opacity-40 cursor-pointer"
              >
                {copiedEmail ? <Check size={13} /> : <Copy size={13} />}
                {copiedEmail ? 'Email copié ✓' : 'Copier l’email'}
              </button>
              <button
                type="button"
                onClick={onOpenDriveManager}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-zinc-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-900 cursor-pointer"
              >
                Gérer mes Drives →
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ================= 2. CONVENTION DE NOMMAGE SUR DRIVE ================= */}
      {show('naming') && (
        <section className="tempo-card rounded-3xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-2xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 flex items-center justify-center shrink-0">
              <GitBranch size={17} />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-zinc-50">
                2. Comment nommer tes fichiers MP3 sur Google Drive
              </h2>
              <p className="text-xs text-slate-400">
                Kora regroupe automatiquement tes versions, tes instrus et tes années par le nom des fichiers
              </p>
            </div>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-zinc-800/80 rounded-2xl border border-slate-200/80 dark:border-zinc-800 overflow-hidden text-xs">
            <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-50/40 dark:bg-zinc-900/30">
              <div className="space-y-0.5">
                <p className="font-semibold text-slate-900 dark:text-zinc-100 flex items-center gap-1.5">
                  <GitBranch size={13} className="text-[#FF5500]" />
                  Regroupement automatique des versions
                </p>
                <p className="text-slate-500 dark:text-zinc-400">
                  Ajoute un numéro ou <code className="font-mono">v2</code>, <code className="font-mono">v3.1</code> à la fin : Kora crée une seule carte, affiche la <strong>version la plus récente</strong> par défaut et garde toutes les anciennes versions dans le menu du son.
                </p>
              </div>
              <div className="flex flex-wrap sm:flex-col items-end gap-1 font-mono text-[11px] shrink-0">
                <span className="rounded-lg bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 px-2.5 py-1 text-slate-700 dark:text-zinc-300">
                  Minuit_1.mp3 → <strong className="text-[#FF5500]">v1</strong>
                </span>
                <span className="rounded-lg bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 px-2.5 py-1 text-slate-700 dark:text-zinc-300">
                  Minuit_v3.2.mp3 → <strong className="text-[#FF5500]">v3.2 (Actuelle)</strong>
                </span>
              </div>
            </div>

            <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-50/40 dark:bg-zinc-900/30">
              <div className="space-y-0.5">
                <p className="font-semibold text-slate-900 dark:text-zinc-100 flex items-center gap-1.5">
                  <Music2 size={13} className="text-emerald-500" />
                  Détection automatique de la Prod (Instru)
                </p>
                <p className="text-slate-500 dark:text-zinc-400">
                  Ajoute <code className="font-mono">_prod</code> ou <code className="font-mono">instru</code> au nom du fichier : l’instrumentale ne pollue pas ta liste de morceaux, mais débloque le bouton vert <strong>« ♫ Prod / Lancer la prod »</strong> sur la carte du son, la page du morceau et le lecteur !
                </p>
              </div>
              <div className="font-mono text-[11px] shrink-0">
                <span className="rounded-lg bg-emerald-500/10 border border-emerald-500/25 px-2.5 py-1 text-emerald-700 dark:text-emerald-300">
                  Minuit_prod.mp3 → <strong>♫ Bouton Prod</strong>
                </span>
              </div>
            </div>

            <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-50/40 dark:bg-zinc-900/30">
              <div className="space-y-0.5">
                <p className="font-semibold text-slate-900 dark:text-zinc-100">
                  Sous-dossiers par Année / Saison & Exclusion <code className="font-mono">drumkit</code>
                </p>
                <p className="text-slate-500 dark:text-zinc-400">
                  Si tu ranges tes MP3 dans des sous-dossiers d’années (ex. <code className="font-mono">2025/2026</code> ou <code className="font-mono">2026/2027</code>), Kora crée automatiquement les filtres d’années en haut d’Accueil et Sons. Tout dossier nommé <code className="font-mono">drumkit</code> est ignoré.
                </p>
              </div>
              <div className="font-mono text-[11px] shrink-0">
                <span className="rounded-lg bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 px-2.5 py-1 text-slate-700 dark:text-zinc-300">
                  /2026-2027/Minuit_3.mp3
                </span>
              </div>
            </div>
          </div>

          <p className="text-[11px] text-slate-400">
            <strong>Astuce :</strong> Si un morceau a changé de nom entre sa maquette (ex. <em>Project 306</em>) et sa version finale (ex. <em>Terminer le mois</em>), ouvre la page du son et clique sur <strong>« + Ajouter une version »</strong> ou <strong>« Rattacher à… »</strong> pour les lier manuellement.
          </p>
        </section>
      )}

      {/* ================= 3. PIPELINE 6 ÉTAPES & DOUBLE NOTATION ================= */}
      {show('workflow') && (
        <section className="tempo-card rounded-3xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-2xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 flex items-center justify-center shrink-0">
              <TrendingUp size={17} />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-zinc-50">
                3. Pipeline de production (v0 → v4) & Notation analytique
              </h2>
              <p className="text-xs text-slate-400">
                Un système conçu pour savoir immédiatement quels morceaux finir en priorité
              </p>
            </div>
          </div>

          {/* 6 Stages Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
            {[
              {
                step: '0/5',
                title: 'Brouillon (v0)',
                desc: 'Idée brute, toplines ou structure pas encore complète.',
              },
              {
                step: '1/5',
                title: 'Squelette',
                desc: 'Structure écrite à 100 %. Les lignes à revoir utilisent la balise [FIX].',
              },
              {
                step: '2/5',
                title: 'Maquette (v1)',
                desc: 'Prise témoin enregistrée pour valider le placement, le flow et les respirations.',
              },
              {
                step: '3/5',
                title: 'Rec final (v2)',
                desc: 'Prises voix définitives verrouillées, zéro balise [FIX] restante.',
              },
              {
                step: '4/5',
                title: 'Pré-mix (v3)',
                desc: 'Balance et nettoyage prêts. Débloque la phase d’Harmonisation du projet.',
              },
              {
                step: '5/5',
                title: 'Masterisé (v4)',
                desc: 'Mix & Master finalisés, prêt pour la sortie.',
              },
            ].map((st) => (
              <div
                key={st.step}
                className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-900/35 p-3 space-y-1"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900 dark:text-zinc-100">
                    {st.title}
                  </span>
                  <span className="font-mono text-[10px] text-[#FF5500] font-semibold">
                    {st.step}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-zinc-400 leading-relaxed">
                  {st.desc}
                </p>
              </div>
            ))}
          </div>

          {/* Dual Rating Explanation */}
          <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/60 dark:bg-zinc-900/45 p-4 space-y-2 text-xs">
            <p className="font-semibold text-slate-900 dark:text-zinc-100 flex items-center gap-1.5">
              <TrendingUp size={14} className="text-[#FF5500]" />
              Pourquoi noter « Note actuelle » ET « Potentiel ↗ » (/10) ?
            </p>
            <p className="text-slate-500 dark:text-zinc-400 leading-relaxed">
              Sur chaque page de morceau, attribue une <strong>Note actuelle</strong> (l’état du mix/prise aujourd’hui, ex. <code className="font-mono">4/10</code>) et une note de <strong>Potentiel ↗</strong> (la force du titre une fois terminé, ex. <code className="font-mono text-[#FF5500]">↗9/10</code>). Dans l’onglet <strong>Sons</strong> ou lors de l’ajout de titres à un <strong>Projet</strong>, trie par <strong>« Δ Écart »</strong> : Kora fait remonter en premier les sons qui ont le plus grand écart (<code className="font-mono">9 − 4 = +5</code>), c’est-à-dire tes pépites inachevées à travailler immédiatement.
            </p>
          </div>
        </section>
      )}

      {/* ================= 4. PROJETS, SPRINTS & HARMONISATION ================= */}
      {show('projects') && (
        <section className="tempo-card rounded-3xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-2xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 flex items-center justify-center shrink-0">
                <Disc3 size={17} />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-zinc-50">
                  4. Projets (Vue Spotify vs Studio), Sprints & Harmonisation
                </h2>
                <p className="text-xs text-slate-400">
                  Construis tes Singles, EP, Albums et Mixtapes sans te disperser
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onNavigateTab('projects')}
              className="text-xs font-semibold text-[#FF5500] hover:underline cursor-pointer"
            >
              Ouvrir mes projets →
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-900/35 p-4 space-y-1.5">
              <p className="font-semibold text-slate-900 dark:text-zinc-100">
                Bascule « Détails / Studio » en haut à droite
              </p>
              <p className="text-slate-500 dark:text-zinc-400 leading-relaxed">
                Par défaut, un projet s’affiche comme un <strong>album sur Spotify</strong> pour écouter ta tracklist dans les conditions réelles. Clique sur le bouton <strong>Détails / Studio</strong> en haut à droite pour afficher les badges d’avancement, choisir une version spécifique pour le projet (<em>Auto</em> ou <em>Fixée</em>), verrouiller la tracklist (🔒), gérer le <strong>Backlog</strong> et la <strong>TODO globale</strong>.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-900/35 p-4 space-y-1.5">
              <p className="font-semibold text-slate-900 dark:text-zinc-100 flex items-center gap-1.5">
                <Flame size={13} className="text-[#FF5500]" />
                Sprints (Micro-batch de 3 titres max)
              </p>
              <p className="text-slate-500 dark:text-zinc-400 leading-relaxed">
                Dans le mode Studio d’un projet, l’onglet <strong>Sprint actif</strong> te permet de sélectionner <strong>maximum 3 titres à la fois</strong> (et de planifier les sprints suivants à l’avance) pour les amener jusqu’à <strong>Pré-mix (v3)</strong> sans t’éparpiller sur 15 morceaux en même temps.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-900/35 p-4 space-y-1.5">
              <p className="font-semibold text-slate-900 dark:text-zinc-100 flex items-center gap-1.5">
                <Sparkles size={13} className="text-[#FF5500]" />
                Harmonisation & Séquençage
              </p>
              <p className="text-slate-500 dark:text-zinc-400 leading-relaxed">
                L’onglet <strong>Harmonisation</strong> affiche ta jauge de préparation globale (<code className="font-mono">≥ Pré-mix v3</code>), un tableau de séquençage rapide pour alterner les ambiances (<em>⚡ Énergique</em>, <em>🌊 Chill</em>, <em>🧪 Expé</em>) et la checklist finale (chaîne vocale, LUFS, transitions, export).
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-900/35 p-4 space-y-1.5">
              <p className="font-semibold text-slate-900 dark:text-zinc-100 flex items-center gap-1.5">
                <ListChecks size={13} />
                Agrégation automatique des TODOs
              </p>
              <p className="text-slate-500 dark:text-zinc-400 leading-relaxed">
                Chaque tâche ajoutée sur la page d’un morceau remonte automatiquement dans la <strong>TODO du projet</strong> auquel il appartient. Tu peux cocher une tâche depuis le morceau ou depuis le projet.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* ================= 5. STUDIO TEXTES & BALISES [FIX] ================= */}
      {show('lyrics') && (
        <section className="tempo-card rounded-3xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-2xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 flex items-center justify-center shrink-0">
                <FileText size={17} />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-zinc-50">
                  5. Studio Textes, Barre Instru & Balises [FIX]
                </h2>
                <p className="text-xs text-slate-400">
                  Écris en écoutant ta prod et repère les lignes à réécrire d’un coup d’œil
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onCreateLyrics}
              className="text-xs font-semibold text-[#FF5500] hover:underline cursor-pointer"
            >
              + Créer un texte →
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-900/35 p-3.5 space-y-1.5">
              <span className="inline-block rounded-md bg-rose-500/12 text-rose-600 dark:text-rose-400 px-2 py-0.5 font-mono text-[10px] font-bold">
                + [FIX]
              </span>
              <p className="font-semibold text-slate-900 dark:text-zinc-100">
                Balises de réécriture [FIX]
              </p>
              <p className="text-slate-500 dark:text-zinc-400 leading-relaxed">
                Quand une rime ou une mesure est provisoire, clique sur <strong>+ [FIX]</strong> dans l’éditeur. Kora affiche un badge <code className="font-mono text-rose-500">[FIX] ×N</code> sur la carte du morceau et t’avertit avant de passer en <em>Rec final (v2)</em>.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-900/35 p-3.5 space-y-1.5">
              <span className="inline-flex items-center gap-1 rounded-md bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-2 py-0.5 text-[10px] font-semibold">
                <Music2 size={10} /> Instru
              </span>
              <p className="font-semibold text-slate-900 dark:text-zinc-100">
                Barre Instru & YouTube
              </p>
              <p className="text-slate-500 dark:text-zinc-400 leading-relaxed">
                Associe un morceau de ta bibliothèque (ou colle un lien de prod YouTube) en haut de ton texte pour boucler sur tes marqueurs horodatés pendant que tu écris.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-900/35 p-3.5 space-y-1.5">
              <span className="inline-flex items-center gap-1 rounded-md bg-[#FF5500]/14 text-[#FF5500] px-2 py-0.5 text-[10px] font-semibold">
                <Sparkles size={10} /> Outils
              </span>
              <p className="font-semibold text-slate-900 dark:text-zinc-100">
                Inspiration & Métronome
              </p>
              <p className="text-slate-500 dark:text-zinc-400 leading-relaxed">
                Ouvre le panneau <strong>Outils</strong> pour tirer des mots courants, des expressions familières ou des dictons (filtrables par syllabes) et les insérer en 1 clic dans ton texte.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* ================= 6. KORA CONNECT, PARTAGE & RACCOURCIS ================= */}
      {show('player') && (
        <section className="tempo-card rounded-3xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-2xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 flex items-center justify-center shrink-0">
              <Smartphone size={17} />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-zinc-50">
                6. Kora Connect, Partage public & Raccourcis
              </h2>
              <p className="text-xs text-slate-400">
                Contrôle multi-appareils en direct et gestes rapides
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-950/20 p-4 space-y-1.5">
              <p className="font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                Kora Connect (Style Spotify Connect)
              </p>
              <p className="text-slate-600 dark:text-zinc-300 leading-relaxed">
                Écoute un son sur ton iPhone et ouvre Kora sur ton PC : le lecteur affiche la progression en direct (<em>« Lecture sur iPhone »</em>). Tu peux mettre en pause, changer de titre ou avancer à distance, ou cliquer sur <strong>« Ici / Jouer ici »</strong> pour transférer instantanément l’audio sur ton PC.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-900/35 p-4 space-y-1.5">
              <p className="font-semibold text-slate-900 dark:text-zinc-100 flex items-center gap-1.5">
                <Share2 size={13} className="text-emerald-500" />
                Liens de partage public sans compte
              </p>
              <p className="text-slate-500 dark:text-zinc-400 leading-relaxed">
                Clique sur <strong>Partager</strong> sur n’importe quel morceau ou projet pour copier un lien public sécurisé : tes collaborateurs ou amis peuvent écouter le son ou la tracklist complète du projet sans créer de compte.
              </p>
            </div>
          </div>

          {/* Keyboard & Gestures Table */}
          <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 overflow-hidden text-xs">
            <div className="px-4 py-2.5 bg-slate-50/80 dark:bg-zinc-900/60 border-b border-slate-200/70 dark:border-zinc-800 flex items-center gap-2 font-semibold text-slate-700 dark:text-zinc-200">
              <Keyboard size={13} />
              <span>Raccourcis clavier & gestes tactiles</span>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-zinc-800/70">
              {[
                {
                  key: 'Clic droit (partout)',
                  desc: 'Ouvre le menu contextuel sur un son, un projet, un texte ou n’importe où sur le fond de la page.',
                  icon: MousePointerClick,
                },
                {
                  key: 'Touches 1 · 2 · 3 · 4',
                  desc: 'Basculer instantanément entre Accueil (1), Sons (2), Projets (3) et Textes (4).',
                  icon: Keyboard,
                },
                {
                  key: 'Ctrl + B (ou Cmd + B)',
                  desc: 'Ouvrir ou masquer la barre latérale gauche sur ordinateur.',
                  icon: Keyboard,
                },
                {
                  key: 'Glisser le mini-lecteur',
                  desc: 'Sur mobile, glisse horizontalement sur le mini-lecteur en bas pour passer au titre suivant/précédent.',
                  icon: Smartphone,
                },
                {
                  key: 'Maintenir & glisser',
                  desc: 'Maintiens une ligne dans la tracklist d’un projet ou dans Harmonisation pour réordonner les titres.',
                  icon: MousePointerClick,
                },
              ].map((row) => (
                <div
                  key={row.key}
                  className="px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-4"
                >
                  <code className="font-mono text-[11px] font-semibold text-slate-900 dark:text-zinc-100 shrink-0">
                    {row.key}
                  </code>
                  <span className="text-slate-500 dark:text-zinc-400 sm:text-right">
                    {row.desc}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
