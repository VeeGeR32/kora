import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Disc3, GitBranch, Link2, Search, X } from 'lucide-react';
import type { TrackGroup } from '../../lib/musicVersioning';

export interface LinkVersionModalState {
  mode: 'attach-to-target' | 'pull-into-group';
  /** When mode === 'attach-to-target': the track/group being moved into another song.
   *  When mode === 'pull-into-group': the destination group receiving another MP3. */
  sourceGroup: TrackGroup;
  sourceTrackId: string;
}

interface LinkVersionModalProps {
  modal: LinkVersionModalState | null;
  allGroups: TrackGroup[];
  onClose: () => void;
  onConfirmLink: (
    movingTrackIds: string[],
    targetGroupKey: string,
    targetGroupTitle: string,
    customVersionLabel?: string
  ) => void;
}

export function LinkVersionModal({
  modal,
  allGroups,
  onClose,
  onConfirmLink,
}: LinkVersionModalProps) {
  const [search, setSearch] = useState('');
  const [customLabel, setCustomLabel] = useState('');

  const candidates = useMemo(() => {
    if (!modal) return [];
    const q = search.trim().toLowerCase();
    return allGroups
      .filter((g) => g.groupKey !== modal.sourceGroup.groupKey)
      .filter((g) => {
        if (!q) return true;
        return (
          g.baseTitle.toLowerCase().includes(q) ||
          g.versions.some(
            (v) =>
              v.track.title.toLowerCase().includes(q) ||
              (v.track.sourceFilename && v.track.sourceFilename.toLowerCase().includes(q))
          )
        );
      });
  }, [modal, allGroups, search]);

  if (!modal) return null;

  const isAttachMode = modal.mode === 'attach-to-target';
  const sourceTrack =
    modal.sourceGroup.versions.find((v) => v.track.id === modal.sourceTrackId)?.track ||
    modal.sourceGroup.latestTrack;

  const handlePickCandidate = (candidate: TrackGroup) => {
    if (isAttachMode) {
      // Attach source track (or entire source group if single) into candidate group
      onConfirmLink(
        [sourceTrack.id],
        candidate.groupKey,
        candidate.baseTitle,
        customLabel.trim() || undefined
      );
    } else {
      // Pull all tracks from candidate group into modal.sourceGroup
      onConfirmLink(
        candidate.versions.map((v) => v.track.id),
        modal.sourceGroup.groupKey,
        modal.sourceGroup.baseTitle,
        customLabel.trim() || undefined
      );
    }
    setSearch('');
    setCustomLabel('');
    onClose();
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-slate-950/50 dark:bg-black/75 backdrop-blur-xs"
        />

        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.97 }}
          className="relative z-10 w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-white dark:bg-[#131317] border border-slate-200 dark:border-zinc-800 shadow-2xl overflow-hidden max-h-[85vh] flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-zinc-800">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-8 w-8 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 flex items-center justify-center shrink-0">
                <Link2 size={15} />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold truncate">
                  {isAttachMode
                    ? `Associer « ${sourceTrack.title} » à un son`
                    : `Ajouter une version dans « ${modal.sourceGroup.baseTitle} »`}
                </h2>
                <p className="text-[11px] text-slate-400 truncate">
                  {isAttachMode
                    ? 'Choisis le son principal dont ce MP3 est une version'
                    : 'Choisis un MP3 existant à regrouper ici'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer shrink-0"
            >
              <X size={16} />
            </button>
          </div>

          <div className="p-4 space-y-3 flex-1 overflow-y-auto">
            {/* Search Target Song */}
            <div className="relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                autoFocus
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher un son (ex. FOLIE, Project 271…)"
                className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 pl-9 pr-3 py-2 text-xs outline-none focus:border-slate-400 dark:focus:border-zinc-600"
              />
            </div>

            {/* Optional Custom Version Name */}
            <div>
              <label className="block text-[10px] font-medium text-slate-400 mb-1">
                Nom de version personnalisé (optionnel)
              </label>
              <input
                type="text"
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                placeholder="Ex. Mix final, v2, Acoustique, Instru… (sinon auto)"
                className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-1.5 text-xs outline-none focus:border-slate-400 dark:focus:border-zinc-600"
              />
            </div>

            {/* Candidate Songs List */}
            {candidates.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-400">
                Aucun autre son trouvé.
              </p>
            ) : (
              <div className="space-y-1 max-h-[42vh] overflow-y-auto pr-0.5">
                {candidates.map((cand) => (
                  <button
                    key={cand.groupKey}
                    type="button"
                    onClick={() => handlePickCandidate(cand)}
                    className="w-full flex items-center justify-between gap-2.5 rounded-xl border border-slate-200/70 dark:border-zinc-800/80 hover:border-slate-400 dark:hover:border-zinc-600 hover:bg-slate-50 dark:hover:bg-zinc-900/70 px-3 py-2.5 text-left transition cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Disc3 size={15} className="text-slate-500 dark:text-zinc-400 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900 dark:text-zinc-100 truncate">
                          {cand.baseTitle}
                        </p>
                        <p className="text-[10px] font-mono text-slate-400 truncate">
                          {cand.latestVersionLabel}
                          {cand.hasMultipleVersions ? ` · ${cand.versions.length} versions` : ''}
                        </p>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:text-zinc-300 shrink-0">
                      <GitBranch size={10} /> Associer
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
