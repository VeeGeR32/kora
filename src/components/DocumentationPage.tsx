import { useState } from 'react';
import {
  BookOpen,
  Check,
  Copy,
  Disc3,
  ExternalLink,
  FileText,
  FolderOpen,
  GitBranch,
  HardDrive,
  Keyboard,
  Layers,
  Music2,
  Play,
  Plus,
  Share2,
  Smartphone,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import type { MusicSubTab } from './music/MusicView';

interface DocumentationPageProps {
  onNavigateTab: (tab: MusicSubTab) => void;
  onOpenDriveManager: () => void;
  onCreateProject: () => void;
  onCreateLyrics: () => void;
}

type DocSectionId = 'all' | 'drive' | 'tracks' | 'projects' | 'lyrics' | 'player';

const SECTIONS: { id: DocSectionId; label: string }[] = [
  { id: 'all', label: 'Tout le guide' },
  { id: 'drive', label: '1. Google Drive' },
  { id: 'tracks', label: '2. Sons, Versions & Prods' },
  { id: 'projects', label: '3. Projets & Packs' },
  { id: 'lyrics', label: '4. Textes & Mesures' },
  { id: 'player', label: '5. Lecteur & Connect' },
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
    <div className="w-full max-w-4xl mx-auto space-y-6 pb-16">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-[#8C271E]/12 text-[#8C271E] dark:text-[#E56B5F] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider mb-2">
            <BookOpen size={11} />
            <span>Documentation Rowav</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-zinc-50">
            Guide d’utilisation
          </h1>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">
            Tout ce qu’il faut pour connecter tes sons, organiser tes projets librement et écrire au rythme de tes instrus.
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
          <button
            type="button"
            onClick={onOpenDriveManager}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25 px-3.5 py-1.5 text-xs font-semibold hover:opacity-90 transition cursor-pointer"
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
          <button
            type="button"
            onClick={onCreateLyrics}
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-zinc-200 hover:border-slate-400 transition cursor-pointer"
          >
            <FileText size={12} />
            <span>Texte</span>
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
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition cursor-pointer shrink-0 ${
                active
                  ? 'bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25'
                  : 'bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 text-slate-600 dark:text-zinc-300 hover:border-slate-400'
              }`}
            >
              {sec.label}
            </button>
          );
        })}
      </div>

      {/* ================= 1. GOOGLE DRIVE ================= */}
      {show('drive') && (
        <section className="tempo-card rounded-3xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-[#8C271E] text-white flex items-center justify-center shrink-0">
              <HardDrive size={17} />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-zinc-50">
                1. Connecter Google Drive
              </h2>
              <p className="text-xs text-slate-400">
                Synchronisation permanente de tes MP3 & WAV sur PC et iPhone, sans reconnexion répétée.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/60 dark:bg-zinc-900/40 p-3.5 space-y-1.5">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#8C271E] text-white font-mono text-[10px] font-bold">
                1
              </span>
              <p className="font-semibold text-slate-900 dark:text-zinc-100">
                Partager ton dossier
              </p>
              <p className="text-slate-500 dark:text-zinc-400 leading-relaxed">
                Ouvre{' '}
                <a
                  href="https://drive.google.com/drive/my-drive"
                  target="_blank"
                  rel="noreferrer"
                  className="underline font-medium text-slate-800 dark:text-zinc-200 inline-flex items-center gap-0.5"
                >
                  Google Drive <ExternalLink size={10} />
                </a>
                , fais clic droit sur ton dossier de sons → <strong>Partager</strong> → ajoute l’email Rowav ci-dessous en <strong>Lecteur</strong> (ou active le lien partagé).
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/60 dark:bg-zinc-900/40 p-3.5 space-y-1.5">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#8C271E] text-white font-mono text-[10px] font-bold">
                2
              </span>
              <p className="font-semibold text-slate-900 dark:text-zinc-100">
                Coller le lien dans Rowav
              </p>
              <p className="text-slate-500 dark:text-zinc-400 leading-relaxed">
                Clique sur <strong>Drives</strong>, colle l’URL de ton dossier et lance <strong>Synchroniser</strong>. Tu peux connecter plusieurs dossiers Drive à la fois.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/60 dark:bg-zinc-900/40 p-3.5 space-y-1.5">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#8C271E] text-white font-mono text-[10px] font-bold">
                3
              </span>
              <p className="font-semibold text-slate-900 dark:text-zinc-100">
                Sauvegarde cloud auto
              </p>
              <p className="text-slate-500 dark:text-zinc-400 leading-relaxed">
                Tes textes, projets, packs, pochettes et favoris sont sauvegardés automatiquement sur ton compte et sauvegardés dans <code className="font-mono text-[10px]">_Rowav_Data</code> sur ton Drive.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Email de lecture Google Drive Rowav
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
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#8C271E] text-white px-3 py-2 text-xs font-semibold hover:opacity-90 disabled:opacity-40 cursor-pointer"
              >
                {copiedEmail ? <Check size={13} /> : <Copy size={13} />}
                {copiedEmail ? 'Copié ✓' : 'Copier'}
              </button>
              <button
                type="button"
                onClick={onOpenDriveManager}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-zinc-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-900 cursor-pointer"
              >
                Gérer mes Drives
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ================= 2. SONS, VERSIONS & MULTI-PRODS ================= */}
      {show('tracks') && (
        <section className="tempo-card rounded-3xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-2xl bg-[#8C271E] text-white flex items-center justify-center shrink-0">
                <GitBranch size={17} />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-zinc-50">
                  2. Sons, versions & plusieurs versions de prod
                </h2>
                <p className="text-xs text-slate-400">
                  Regroupement automatique par nom de fichier ou association manuelle en 1 clic.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('library')}
              className="hidden sm:inline-flex items-center gap-1 rounded-full border border-slate-200 dark:border-zinc-800 px-3 py-1 text-[11px] font-semibold text-slate-600 dark:text-zinc-300 hover:border-slate-400 cursor-pointer"
            >
              Ouvrir Sons →
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 p-4 space-y-2">
              <p className="font-semibold text-slate-900 dark:text-zinc-100 flex items-center gap-1.5">
                <GitBranch size={13} className="text-[#8C271E]" />
                Versions d’un même morceau
              </p>
              <p className="text-slate-500 dark:text-zinc-400 leading-relaxed">
                Les fichiers avec un suffixe de version (<code className="font-mono">v2</code>, <code className="font-mono">v3.1</code>, <code className="font-mono">MIX</code>, <code className="font-mono">FINAL</code>) sont regroupés sur une seule carte. La version la plus récente s’affiche en premier, et toutes les autres restent accessibles dans la page du son.
              </p>
              <div className="flex flex-wrap gap-1 pt-0.5 font-mono text-[10px]">
                <span className="rounded-md bg-slate-100 dark:bg-zinc-800 px-2 py-0.5">Horizon.mp3</span>
                <span className="rounded-md bg-slate-100 dark:bg-zinc-800 px-2 py-0.5">Horizon v2.mp3</span>
                <span className="rounded-md bg-[#8C271E]/12 text-[#8C271E] dark:text-[#E56B5F] px-2 py-0.5">Horizon FINAL.mp3</span>
              </div>
            </div>

            <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-4 space-y-2">
              <p className="font-semibold text-slate-900 dark:text-zinc-100 flex items-center gap-1.5">
                <Music2 size={13} className="text-emerald-600 dark:text-emerald-400" />
                Plusieurs versions de prod (instrumentales)
              </p>
              <p className="text-slate-500 dark:text-zinc-400 leading-relaxed">
                Un même morceau peut avoir <strong>autant de versions de prod que tu veux</strong> : automatiquement via le nom du fichier, ou manuellement via <strong>+ Ajouter une prod</strong> dans la page du son (ou le menu <code className="font-mono">⋯</code>). Bascule entre le son et chaque prod depuis la fiche, les textes ou le lecteur.
              </p>
              <div className="flex flex-wrap gap-1 pt-0.5 font-mono text-[10px]">
                <span className="rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-2 py-0.5">Horizon_prod.mp3</span>
                <span className="rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-2 py-0.5">Horizon_prod_v2.mp3</span>
                <span className="rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-2 py-0.5">Horizon - prod guitare.mp3</span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/70 dark:border-zinc-800/80 bg-slate-50/50 dark:bg-zinc-900/35 px-4 py-3 text-xs text-slate-600 dark:text-zinc-300 flex items-start gap-2.5">
            <Disc3 size={15} className="text-[#8C271E] shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              <strong>Pochettes cohérentes :</strong> dès qu’un morceau appartient à un projet qui a une pochette, la pochette du projet s’affiche partout (onglets, lecteur, playlists). La pochette individuelle du morceau reste visible sur sa propre page dédiée.
            </p>
          </div>
        </section>
      )}

      {/* ================= 3. PROJETS & PACKS LIBRES ================= */}
      {show('projects') && (
        <section className="tempo-card rounded-3xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-2xl bg-[#8C271E] text-white flex items-center justify-center shrink-0">
                <FolderOpen size={17} />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-zinc-50">
                  3. Projets, Tracklists & Packs libres
                </h2>
                <p className="text-xs text-slate-400">
                  Aucun processus imposé — organise tes albums, EP ou mixtapes selon ta propre méthode.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('projects')}
              className="hidden sm:inline-flex items-center gap-1 rounded-full border border-slate-200 dark:border-zinc-800 px-3 py-1 text-[11px] font-semibold text-slate-600 dark:text-zinc-300 hover:border-slate-400 cursor-pointer"
            >
              Ouvrir Projets →
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 p-4 space-y-1.5">
              <p className="font-semibold text-slate-900 dark:text-zinc-100 flex items-center gap-1.5">
                <Disc3 size={13} className="text-[#8C271E]" />
                Onglet Tracklist
              </p>
              <p className="text-slate-500 dark:text-zinc-400 leading-relaxed">
                Ajoute tes morceaux, réorganise l’ordre par appui long + glisser-déposer, choisis la version active par titre (auto ou fixée), garde des idées en réserve (Hors-projet) et suis ta checklist libre.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 p-4 space-y-1.5">
              <p className="font-semibold text-slate-900 dark:text-zinc-100 flex items-center gap-1.5">
                <Layers size={13} className="text-[#8C271E]" />
                Onglet Packs (dossiers libres)
              </p>
              <p className="text-slate-500 dark:text-zinc-400 leading-relaxed">
                Crée autant de <strong>Packs</strong> que tu veux dans un projet avec nom, couleur, note et date optionnelle : par session d’enregistrement, par ambiance, Face A / Face B, ou lots à retravailler. Chaque pack a son bouton <strong>Lire</strong> et des cases à cocher facultatives.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 p-4 space-y-1.5">
              <p className="font-semibold text-slate-900 dark:text-zinc-100 flex items-center gap-1.5">
                <Share2 size={13} className="text-emerald-500" />
                Partage & Playlists
              </p>
              <p className="text-slate-500 dark:text-zinc-400 leading-relaxed">
                Génère un <strong>lien public d’écoute</strong> en 1 clic pour faire écouter un son ou un projet complet à un ingé son, un feat ou des proches — sans qu’ils aient besoin de compte.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* ================= 4. TEXTES, MESURES & SQUELETTE ================= */}
      {show('lyrics') && (
        <section className="tempo-card rounded-3xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-2xl bg-[#8C271E] text-white flex items-center justify-center shrink-0">
                <FileText size={17} />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-zinc-50">
                  4. Textes, mesures automatiques & squelette
                </h2>
                <p className="text-xs text-slate-400">
                  Confort d’une app de notes + découpage automatique en blocs de 4 mesures calés sur ton audio.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('lyrics')}
              className="hidden sm:inline-flex items-center gap-1 rounded-full border border-slate-200 dark:border-zinc-800 px-3 py-1 text-[11px] font-semibold text-slate-600 dark:text-zinc-300 hover:border-slate-400 cursor-pointer"
            >
              Ouvrir Textes →
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 p-4 space-y-1.5">
              <p className="font-semibold text-slate-900 dark:text-zinc-100 flex items-center gap-1.5">
                <Sparkles size={13} className="text-[#8C271E]" />
                Analyse BPM, Tonalité & blocs de 4 mesures
              </p>
              <p className="text-slate-500 dark:text-zinc-400 leading-relaxed">
                Dès qu’un son est associé à un texte, Rowav détecte automatiquement le <strong>BPM</strong>, la <strong>tonalité</strong> et découpe la page en bandes de 4 mesures (<code className="font-mono">M1–4</code>, <code className="font-mono">M5–8</code>…). Clique sur une mesure pour lancer l’audio pile à cet endroit, et active <strong>Suivre</strong> pour défiler automatiquement au rythme du morceau.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 p-4 space-y-1.5">
              <p className="font-semibold text-slate-900 dark:text-zinc-100 flex items-center gap-1.5">
                <Wrench size={13} className="text-amber-500" />
                Écriture fluide, FIX par ligne & Glisser-déposer
              </p>
              <p className="text-slate-500 dark:text-zinc-400 leading-relaxed">
                Sélectionne et copie plusieurs lignes librement comme dans Notes. Clique sur l’icône clé à gauche d’une ligne pour la marquer <strong>À fix</strong> sans polluer ton texte, et attrape la poignée <code className="font-mono">⠿</code> d’un bloc pour décaler tes mesures sans recopier.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* ================= 5. LECTEUR & ROWAV CONNECT ================= */}
      {show('player') && (
        <section className="tempo-card rounded-3xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-[#8C271E] text-white flex items-center justify-center shrink-0">
              <Play size={16} />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-zinc-50">
                5. Lecteur audio, paroles live & Rowav Connect
              </h2>
              <p className="text-xs text-slate-400">
                Écoute fluide façon Spotify, paroles intégrées et télécommande instantanée entre tes onglets et appareils.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 p-4 space-y-1.5">
              <p className="font-semibold text-slate-900 dark:text-zinc-100 flex items-center gap-1.5">
                <Smartphone size={13} className="text-emerald-500" />
                Rowav Connect (multi-onglets & PC ↔ iPhone)
              </p>
              <p className="text-slate-500 dark:text-zinc-400 leading-relaxed">
                Lance un son sur ton PC et mets pause, change de titre ou transfère le son sur ton iPhone (ou un autre onglet) instantanément. Tes onglets ouverts et ton scroll restent <strong>indépendants sur chaque appareil</strong>.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 p-4 space-y-1.5">
              <p className="font-semibold text-slate-900 dark:text-zinc-100 flex items-center gap-1.5">
                <FileText size={13} className="text-[#8C271E]" />
                Paroles & switch Prod dans le lecteur
              </p>
              <p className="text-slate-500 dark:text-zinc-400 leading-relaxed">
                En plein écran, glisse la pochette à gauche/droite pour changer de morceau, affiche les <strong>paroles en direct</strong> synchronisées avec la lecture, ou bascule entre le morceau et ses versions de <strong>Prod</strong> en un tap.
              </p>
            </div>
          </div>

          {/* Keyboard shortcuts */}
          <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-900/35 p-4 space-y-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Keyboard size={12} /> Raccourcis clavier (PC / Mac)
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              {[
                { key: 'Espace', label: 'Lecture / Pause' },
                { key: '← / →', label: 'Avancer / reculer' },
                { key: 'Ctrl + B', label: 'Réduire la barre latérale' },
                { key: 'Échap', label: 'Fermer lecteur / fenêtre' },
              ].map((s) => (
                <div
                  key={s.key}
                  className="rounded-xl bg-white dark:bg-zinc-950 border border-slate-200/70 dark:border-zinc-800 px-2.5 py-2 flex flex-col gap-0.5"
                >
                  <kbd className="font-mono text-[10px] font-bold text-[#8C271E] dark:text-[#E56B5F]">
                    {s.key}
                  </kbd>
                  <span className="text-[11px] text-slate-600 dark:text-zinc-300">{s.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
