import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Camera,
  Check,
  Disc3,
  FileText,
  ListMusic,
  Loader2,
  LogOut,
  Mail,
  Moon,
  Save,
  Star,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { useApp } from '../context/AppContext';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

const AVATAR_COLORS = [
  { id: 'slate', cls: 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950' },
  { id: 'indigo', cls: 'bg-indigo-600 text-white' },
  { id: 'violet', cls: 'bg-violet-600 text-white' },
  { id: 'emerald', cls: 'bg-emerald-600 text-white' },
  { id: 'fuchsia', cls: 'bg-fuchsia-600 text-white' },
  { id: 'amber', cls: 'bg-amber-500 text-white' },
];

async function resizeImageToDataUrl(file: File, maxSize = 160): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.84));
      };
      img.onerror = reject;
      img.src = String(reader.result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const {
    state,
    toggleTheme,
    cloudUser,
    cloudSyncing,
    cloudError,
    lastCloudSyncAt,
    forceSaveCloud,
    disconnectGoogleCloud,
    notify,
  } = useApp();

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const wasOpenRef = useRef(false);

  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [avatarColor, setAvatarColor] = useState('slate');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [savedPulse, setSavedPulse] = useState(false);


  // Sync draft state cleanly ONLY when modal opens (never clobbering active typing on avatar/theme updates!)
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setName(state.preferences.name || cloudUser?.displayName || '');
      setBio(state.preferences.bio || '');
      setAvatarColor(state.preferences.avatarColor || 'slate');
      setAvatarUrl(state.preferences.avatarUrl || '');
      setSavedPulse(false);
    }
    wasOpenRef.current = open;
  }, [open, state.preferences, cloudUser?.displayName]);


  const handleAvatarUpload = async (file: File | undefined) => {
    if (!file) return;
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      setAvatarUrl(dataUrl);
    } catch {
      notify('Impossible de lire cette image');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await forceSaveCloud({
      name: name.trim(),
      bio: bio.trim() || undefined,
      avatarColor,
      avatarUrl: avatarUrl || undefined,
    });
    setSavedPulse(true);
    window.setTimeout(() => setSavedPulse(false), 1800);
  };

  const handleSignOut = async () => {
    onClose();
    await disconnectGoogleCloud();
  };

  const activeColorCls =
    AVATAR_COLORS.find((c) => c.id === avatarColor)?.cls || AVATAR_COLORS[0].cls;
  const displayName = name.trim() || cloudUser?.displayName || cloudUser?.email?.split('@')[0] || 'Mon profil';
  const initials = displayName.slice(0, 2).toUpperCase();
  const providerLabel = cloudUser?.providerData?.[0]?.providerId === 'google.com' ? 'Google' : 'Email';

  const stats = [
    { label: 'Sons', value: state.musicTracks.length, icon: ListMusic },
    { label: 'Projets', value: state.musicProjects.length, icon: Disc3 },
    { label: 'Textes', value: state.lyricsDocs.filter((d) => !d.deletedAt).length, icon: FileText },
    { label: 'Favoris', value: state.musicTracks.filter((t) => t.isFavorite).length, icon: Star },
  ];

  const inputCls =
    'w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/70 px-3.5 py-2.5 text-xs text-slate-900 dark:text-zinc-100 placeholder:text-slate-400 focus:outline-none focus:border-slate-400 dark:focus:border-zinc-600 transition';

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-950/40 dark:bg-black/70 backdrop-blur-xs"
          />

          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className="relative z-10 w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-white dark:bg-[#111114] border border-slate-200 dark:border-zinc-800 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
          >
            {/* Header Banner */}
            <div className="relative px-5 pt-5 pb-4 border-b border-slate-100 dark:border-zinc-800/80 bg-gradient-to-b from-slate-50/90 to-white dark:from-zinc-900/60 dark:to-[#111114]">
              <button
                type="button"
                onClick={onClose}
                aria-label="Fermer"
                className="absolute top-4 right-4 h-7 w-7 rounded-lg text-slate-400 hover:text-slate-800 dark:hover:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-800 flex items-center justify-center transition cursor-pointer"
              >
                <X size={15} />
              </button>

              <div className="flex items-center gap-4 pr-8">
                {/* Interactive Avatar */}
                <div className="relative group shrink-0">
                  {avatarUrl || cloudUser?.photoURL ? (
                    <img
                      src={avatarUrl || cloudUser?.photoURL || ''}
                      alt={displayName}
                      className="h-16 w-16 rounded-2xl object-cover border border-slate-200 dark:border-zinc-700 shadow-xs"
                    />
                  ) : (
                    <div
                      className={`h-16 w-16 rounded-2xl flex items-center justify-center font-bold text-lg shadow-xs ${activeColorCls}`}
                    >
                      {initials}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    title="Changer la photo"
                    className="absolute inset-0 rounded-2xl bg-black/50 opacity-0 group-hover:opacity-100 text-white flex items-center justify-center transition cursor-pointer"
                  >
                    <Camera size={16} />
                  </button>
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/*"
                    onChange={(e) => void handleAvatarUpload(e.target.files?.[0])}
                    className="hidden"
                  />
                </div>

                {/* Live Identity Preview */}
                <div className="min-w-0 flex-1 space-y-0.5">
                  <h2 className="text-base font-semibold tracking-tight text-slate-900 dark:text-zinc-50 truncate">
                    {displayName}
                  </h2>
                  {bio.trim() ? (
                    <p className="text-xs text-slate-500 dark:text-zinc-400 truncate">{bio.trim()}</p>
                  ) : (
                    <p className="text-xs text-slate-400 dark:text-zinc-500 truncate">
                      Ajoute une bio courte…
                    </p>
                  )}
                  {cloudUser?.email && (
                    <div className="flex items-center gap-1.5 pt-1 text-[11px] text-slate-400 dark:text-zinc-500">
                      <Mail size={11} className="shrink-0" />
                      <span className="truncate">{cloudUser.email}</span>
                      <span className="rounded-md bg-slate-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500 dark:text-zinc-400 shrink-0">
                        {providerLabel}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <form onSubmit={handleSave} className="p-5 overflow-y-auto space-y-5">
              {/* Quick Workspace Stats */}
              <div className="grid grid-cols-4 gap-2">
                {stats.map((st) => {
                  const Icon = st.icon;
                  return (
                    <div
                      key={st.label}
                      className="rounded-xl border border-slate-200/70 dark:border-zinc-800/80 bg-slate-50/50 dark:bg-zinc-900/40 px-2.5 py-2.5 text-center space-y-1"
                    >
                      <Icon size={13} className="mx-auto text-slate-400 dark:text-zinc-500" />
                      <p className="font-mono text-sm font-semibold text-slate-900 dark:text-zinc-100 tabular-nums leading-none">
                        {st.value}
                      </p>
                      <p className="text-[10px] text-slate-400 dark:text-zinc-500 truncate">
                        {st.label}
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* Profile Fields */}
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-slate-500 dark:text-zinc-400">
                    Prénom / Pseudo
                  </label>
                  <input
                    type="text"
                    maxLength={100}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ton prénom ou pseudo"
                    className={inputCls}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-slate-500 dark:text-zinc-400">
                    Bio
                  </label>
                  <input
                    type="text"
                    maxLength={160}
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    placeholder="Ex. Rappeur · Beatmaker · Paris"
                    className={inputCls}
                  />
                </div>

                {/* Avatar Controls */}
                <div className="flex items-center justify-between gap-2 pt-0.5">
                  <div className="flex items-center gap-1.5">
                    {AVATAR_COLORS.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setAvatarColor(c.id);
                          setAvatarUrl('');
                        }}
                        aria-label={`Couleur ${c.id}`}
                        className={`h-5 w-5 rounded-full ${c.cls} cursor-pointer transition ${
                          avatarColor === c.id && !avatarUrl
                            ? 'ring-2 ring-offset-2 ring-slate-900 dark:ring-zinc-100 dark:ring-offset-[#111114]'
                            : 'opacity-70 hover:opacity-100'
                        }`}
                      />
                    ))}
                  </div>
                  <div className="flex items-center gap-2.5">
                    {avatarUrl && (
                      <button
                        type="button"
                        onClick={() => setAvatarUrl('')}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-rose-500 cursor-pointer"
                      >
                        <Trash2 size={11} /> Retirer
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => avatarInputRef.current?.click()}
                      className="text-[11px] font-medium text-slate-700 dark:text-zinc-300 hover:underline cursor-pointer"
                    >
                      Importer photo
                    </button>
                  </div>
                </div>
              </div>

              {/* Appearance Switch */}
              <div className="flex items-center justify-between rounded-xl border border-slate-200/70 dark:border-zinc-800/80 px-3.5 py-2.5">
                <div>
                  <p className="text-xs font-medium text-slate-900 dark:text-zinc-100">Apparence</p>
                  <p className="text-[11px] text-slate-400">
                    {state.preferences.theme === 'dark' ? 'Mode sombre actif' : 'Mode clair actif'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={toggleTheme}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 transition cursor-pointer"
                >
                  {state.preferences.theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
                  {state.preferences.theme === 'dark' ? 'Clair' : 'Sombre'}
                </button>
              </div>

              {/* Sync Error Alert (only if an actual error occurs) */}
              {cloudError && (
                <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-[11px] text-rose-700 dark:text-rose-300 flex items-start gap-2 leading-relaxed">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <span>{cloudError}</span>
                </div>
              )}

              {/* Clean Footer Actions: Save + Sign Out */}
              <div className="pt-2 border-t border-slate-100 dark:border-zinc-800/80 space-y-2.5">
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={cloudSyncing}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 py-2.5 text-xs font-semibold hover:opacity-92 transition cursor-pointer disabled:opacity-50"
                  >
                    {cloudSyncing ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : savedPulse ? (
                      <Check size={13} />
                    ) : (
                      <Save size={13} />
                    )}
                    {savedPulse ? 'Sauvegardé' : 'Sauvegarder'}
                  </button>

                  {cloudUser && (
                    <button
                      type="button"
                      onClick={() => void handleSignOut()}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-200/80 dark:border-rose-900/60 bg-rose-50/60 dark:bg-rose-950/25 text-rose-600 dark:text-rose-400 px-4 py-2.5 text-xs font-semibold hover:bg-rose-100/70 dark:hover:bg-rose-950/45 transition cursor-pointer"
                    >
                      <LogOut size={13} /> Déconnexion
                    </button>
                  )}
                </div>

                {lastCloudSyncAt && (
                  <p className="text-center text-[10px] text-slate-400 dark:text-zinc-500">
                    Synchronisé à{' '}
                    {new Date(lastCloudSyncAt).toLocaleTimeString('fr-FR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                )}
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
