import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  Copy,
  Loader2,
  Lock,
  MessageSquare,
  Share2,
  Unlock,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAudioPlayer } from '../../context/AudioPlayerContext';
import {
  fetchOwnerShareMeta,
  shareOrCopyPublicLink,
  type PublicShareComment,
} from '../../lib/publicShare';

interface ShareOptionsModalProps {
  open: boolean;
  kind: 'track' | 'project';
  id: string;
  title: string;
  onClose: () => void;
}

function fmt(sec: number): string {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function ShareOptionsModal({
  open,
  kind,
  id,
  title,
  onClose,
}: ShareOptionsModalProps) {
  const { state, notify } = useApp();
  const player = useAudioPlayer();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasPasscode, setHasPasscode] = useState(false);
  const [passcodeDraft, setPasscodeDraft] = useState('');
  const [allowComments, setAllowComments] = useState(true);
  const [comments, setComments] = useState<PublicShareComment[]>([]);
  const [shareUrl, setShareUrl] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !id) return;
    let alive = true;
    setLoading(true);
    setPasscodeDraft('');
    setCopied(false);
    fetchOwnerShareMeta({
      kind,
      id,
      firebaseConfig: state.preferences.firebaseConfig,
    })
      .then((meta) => {
        if (!alive) return;
        setShareUrl(meta.url);
        setHasPasscode(meta.hasPasscode);
        setAllowComments(meta.allowComments);
        setComments(meta.comments);
      })
      .catch(() => {
        // Ignore initial load error (user can still click share)
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, kind, id, state.preferences.firebaseConfig]);

  const handleSaveAndShare = async (clearPasscode = false) => {
    setSaving(true);
    try {
      const res = await shareOrCopyPublicLink({
        kind,
        id,
        title,
        passcode: !clearPasscode && passcodeDraft.trim() ? passcodeDraft.trim() : undefined,
        clearPasscode,
        allowComments,
        firebaseConfig: state.preferences.firebaseConfig,
      });
      setShareUrl(res.url);
      if (clearPasscode) {
        setHasPasscode(false);
        setPasscodeDraft('');
      } else if (passcodeDraft.trim()) {
        setHasPasscode(true);
        setPasscodeDraft('');
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      notify(
        clearPasscode
          ? 'Code d’accès retiré & lien copié ✓'
          : res.method === 'native'
          ? 'Lien partagé ✓'
          : 'Lien public copié ✓'
      );
    } catch (err) {
      notify(`Partage : ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleJumpToComment = (cmt: PublicShareComment) => {
    const targetTrack = state.musicTracks.find((t) => t.id === cmt.trackId);
    if (!targetTrack) return;
    onClose();
    if (player.currentTrack?.id === targetTrack.id) {
      player.seek(cmt.timeSec);
    } else {
      void player.playTrack(targetTrack, cmt.timeSec);
    }
    notify(`Saut à ${fmt(cmt.timeSec)} · ${cmt.authorName}`);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-[72] bg-black/55 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.14 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-3xl bg-white dark:bg-[#141010] border border-slate-200/90 dark:border-zinc-800 shadow-2xl overflow-hidden flex flex-col max-h-[85dvh]"
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-100 dark:border-zinc-800/80 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8C271E] dark:text-[#E56B5F]">
                  Partage public · {kind === 'project' ? 'Projet' : 'Morceau'}
                </p>
                <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100 truncate">
                  {title}
                </h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="h-8 w-8 rounded-full bg-slate-100 dark:bg-zinc-900 text-slate-500 hover:text-slate-900 dark:hover:text-white flex items-center justify-center cursor-pointer shrink-0"
              >
                <X size={15} />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-4 overflow-y-auto overscroll-contain">
              {loading ? (
                <div className="py-6 flex items-center justify-center text-slate-400">
                  <Loader2 size={18} className="animate-spin" />
                </div>
              ) : (
                <>
                  {/* Passcode Protection */}
                  <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/50 p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-zinc-100">
                        {hasPasscode ? (
                          <Lock size={13} className="text-amber-500" />
                        ) : (
                          <Unlock size={13} className="text-slate-400" />
                        )}
                        Code d’accès optionnel
                      </span>
                      {hasPasscode && (
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void handleSaveAndShare(true)}
                          className="text-[11px] font-semibold text-rose-500 hover:underline cursor-pointer"
                        >
                          Retirer le code
                        </button>
                      )}
                    </div>
                    <input
                      type="text"
                      value={passcodeDraft}
                      onChange={(e) => setPasscodeDraft(e.target.value)}
                      placeholder={
                        hasPasscode
                          ? 'Nouveau code (laisse vide pour garder l’actuel)…'
                          : 'Ex. studio26 (optionnel — protège l’écoute)'
                      }
                      className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-xs text-slate-900 dark:text-zinc-100 placeholder:text-slate-400 outline-none focus:border-[#8C271E]"
                    />
                  </div>

                  {/* Allow Timestamped Comments Toggle */}
                  <label className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/50 px-3.5 py-3 cursor-pointer">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-800 dark:text-zinc-100 flex items-center gap-1.5">
                        <MessageSquare size={13} className="text-[#8C271E]" />
                        Retours horodatés
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Tes collaborateurs peuvent commenter à une seconde précise.
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={allowComments}
                      onChange={(e) => setAllowComments(e.target.checked)}
                      className="h-4 w-4 accent-[#8C271E] cursor-pointer shrink-0"
                    />
                  </label>

                  {/* Primary Copy / Share Button */}
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleSaveAndShare(false)}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-[#8C271E] hover:bg-[#A32E24] text-white py-2.5 px-4 text-xs font-semibold shadow-sm shadow-[#8C271E]/25 disabled:opacity-60 transition cursor-pointer"
                  >
                    {saving ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : copied ? (
                      <Check size={14} />
                    ) : (
                      <Share2 size={14} />
                    )}
                    <span>
                      {saving
                        ? 'Enregistrement…'
                        : copied
                        ? 'Lien copié !'
                        : passcodeDraft.trim()
                        ? 'Appliquer le code & copier le lien'
                        : 'Copier / Partager le lien'}
                    </span>
                  </button>

                  {shareUrl && (
                    <div className="flex items-center gap-1.5 rounded-xl bg-slate-100/80 dark:bg-zinc-900 px-3 py-2 text-[11px] font-mono text-slate-500 dark:text-zinc-400">
                      <span className="truncate flex-1">{shareUrl}</span>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard?.writeText(shareUrl);
                          setCopied(true);
                          window.setTimeout(() => setCopied(false), 1800);
                          notify('Lien copié ✓');
                        }}
                        className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer shrink-0"
                        title="Copier"
                      >
                        <Copy size={12} />
                      </button>
                    </div>
                  )}

                  {/* Received Timestamped Feedback Comments */}
                  <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-zinc-800/80">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        Retours reçus ({comments.length})
                      </span>
                    </div>

                    {comments.length === 0 ? (
                      <p className="text-[11px] text-slate-400 py-2">
                        Aucun retour horodaté pour le moment.
                      </p>
                    ) : (
                      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                        {comments.map((cmt) => (
                          <button
                            key={cmt.id}
                            type="button"
                            onClick={() => handleJumpToComment(cmt)}
                            className="w-full text-left rounded-xl border border-slate-200/70 dark:border-zinc-800/80 bg-slate-50/70 dark:bg-zinc-900/50 hover:border-[#8C271E]/40 px-3 py-2 transition cursor-pointer space-y-1"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] font-semibold text-slate-800 dark:text-zinc-100 truncate">
                                {cmt.authorName}
                              </span>
                              <span className="rounded-full bg-[#8C271E]/12 text-[#8C271E] dark:text-[#F08B82] px-2 py-0.5 font-mono text-[10px] font-semibold shrink-0">
                                {fmt(cmt.timeSec)}
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 dark:text-zinc-300 leading-snug break-words">
                              {cmt.text}
                            </p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
