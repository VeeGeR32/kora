import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, CloudDownload, Copy, ExternalLink, HardDrive, Loader2, ShieldCheck, X } from 'lucide-react';

interface DrivePermanentSetupModalProps {
  open: boolean;
  serviceAccountEmail: string | null;
  syncing: boolean;
  onVerifyAndSync: () => Promise<void>;
  onClose: () => void;
}

export function DrivePermanentSetupModal({
  open,
  serviceAccountEmail,
  syncing,
  onVerifyAndSync,
  onClose,
}: DrivePermanentSetupModalProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!serviceAccountEmail) return;
    try {
      await navigator.clipboard.writeText(serviceAccountEmail);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[75] flex items-end sm:items-center justify-center p-0 sm:p-4">
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
            exit={{ opacity: 0, y: 14, scale: 0.97 }}
            className="relative z-10 w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl bg-white dark:bg-[#121215] border border-slate-200 dark:border-zinc-800 shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-zinc-800">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center">
                  <ShieldCheck size={17} />
                </div>
                <div>
                  <h2 className="text-sm font-semibold">Accès Google Drive permanent</h2>
                  <p className="text-[11px] text-slate-400">
                    À configurer 1 seule fois · Zéro popup sur tous tes appareils
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <p className="text-slate-600 dark:text-zinc-300 leading-relaxed">
                Pour ne plus jamais voir l’écran <em>« Google n’a pas validé cette application »</em> ni devoir te reconnecter sur iPhone ou PC, partage simplement ton dossier de musiques Drive avec ton compte technique Kora (en lecture seule) :
              </p>

              {/* Service Account Email Copy Box */}
              <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 p-3 space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  1. Copie cet email Kora (lecture seule)
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-xl bg-white dark:bg-zinc-950 border border-slate-200/80 dark:border-zinc-800 px-3 py-2 font-mono text-[11px] text-slate-800 dark:text-zinc-100 break-all select-all">
                    {serviceAccountEmail || 'Chargement…'}
                  </code>
                  <button
                    type="button"
                    disabled={!serviceAccountEmail}
                    onClick={() => void handleCopy()}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-3.5 py-2 text-xs font-semibold hover:opacity-92 disabled:opacity-40 cursor-pointer shrink-0"
                  >
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                    {copied ? 'Copié' : 'Copier'}
                  </button>
                </div>
              </div>

              {/* 2 Simple Steps */}
              <ol className="space-y-2 rounded-2xl border border-slate-200/80 dark:border-zinc-800 p-3.5 text-slate-700 dark:text-zinc-300 leading-relaxed">
                <li className="flex items-start gap-2">
                  <span className="h-5 w-5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-mono text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                    2
                  </span>
                  <span>
                    Ouvre{' '}
                    <a
                      href="https://drive.google.com/drive/my-drive"
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-fuchsia-600 dark:text-fuchsia-400 inline-flex items-center gap-0.5 hover:underline"
                    >
                      Google Drive <ExternalLink size={10} />
                    </a>
                    , fais clic droit sur le dossier contenant tes MP3 → <strong>Partager</strong>.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="h-5 w-5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-mono text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                    3
                  </span>
                  <span>
                    Colle l’email ci-dessus en rôle <strong>Lecteur</strong> (décoche « Notifier les personnes ») puis clique <strong>Partager</strong>.
                  </span>
                </li>
              </ol>

              <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <HardDrive size={12} className="shrink-0" />
                Le dossier <code className="font-mono">drumkit</code> reste exclu automatiquement. Une fois partagé, ça marche à vie sur tous tes appareils !
              </p>
            </div>

            <div className="px-5 py-3.5 border-t border-slate-100 dark:border-zinc-800 flex items-center justify-end gap-2 bg-slate-50/60 dark:bg-zinc-950/40">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl px-3 py-2 text-xs font-medium text-slate-500 hover:text-slate-800 dark:hover:text-zinc-200 cursor-pointer"
              >
                Plus tard
              </button>
              <button
                type="button"
                disabled={syncing}
                onClick={() => void onVerifyAndSync()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 text-xs font-semibold disabled:opacity-50 cursor-pointer"
              >
                {syncing ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <CloudDownload size={13} />
                )}
                C’est fait · Synchroniser maintenant
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
