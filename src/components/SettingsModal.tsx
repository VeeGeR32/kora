import {
  AlertTriangle,
  ArrowRight,
  LogOut,
  Mail,
  Moon,
  RefreshCw,
  Sun,
  User,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { DriveSourcesManager } from './music/DrivePermanentSetupModal';

interface SettingsPageProps {
  onOpenProfile?: () => void;
}

export function SettingsPage({ onOpenProfile }: SettingsPageProps) {
  const {
    state,
    toggleTheme,
    cloudUser,
    cloudSyncing,
    cloudError,
    lastCloudSyncAt,
    forceSaveCloud,
    disconnectGoogleCloud,
  } = useApp();

  const displayName =
    state.preferences.name?.trim() ||
    cloudUser?.displayName ||
    cloudUser?.email?.split('@')[0] ||
    'Mon profil';
  const avatarSrc = state.preferences.avatarUrl || cloudUser?.photoURL || '';
  const initials = displayName.slice(0, 2).toUpperCase();
  const providerLabel =
    cloudUser?.providerData?.[0]?.providerId === 'google.com' ? 'Google' : 'Email';

  return (
    <div className="w-full max-w-3xl mx-auto space-y-5 pb-14">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-zinc-50">
            Paramètres
          </h1>
          <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5">
            Google Drive, apparence et compte cloud
          </p>
        </div>
        {lastCloudSyncAt && (
          <span className="font-mono text-[11px] text-slate-400 dark:text-zinc-500 shrink-0">
            Sync{' '}
            {new Date(lastCloudSyncAt).toLocaleTimeString('fr-FR', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        )}
      </div>

      {/* Shortcut Card to Artist Profile (distinct from Settings!) */}
      <section className="tempo-card rounded-2xl p-4 sm:p-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3.5 min-w-0">
          {avatarSrc ? (
            <img
              src={avatarSrc}
              alt={displayName}
              className="h-12 w-12 rounded-full object-cover border border-slate-200 dark:border-zinc-700 shrink-0"
            />
          ) : (
            <div className="h-12 w-12 rounded-full bg-[#8C271E] text-white font-bold text-sm flex items-center justify-center shrink-0">
              {initials}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-900 dark:text-zinc-50 truncate">
              {displayName}
            </p>
            <p className="text-[11px] text-slate-400 dark:text-zinc-500 truncate">
              Photo, nom d’artiste, bio et publications publiques se gèrent sur ton profil.
            </p>
          </div>
        </div>
        {onOpenProfile && (
          <button
            type="button"
            onClick={onOpenProfile}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#8C271E] hover:bg-[#A32E24] text-white px-3.5 py-2 text-xs font-semibold shadow-xs shadow-[#8C271E]/25 transition cursor-pointer shrink-0"
          >
            <User size={12} />
            <span>Mon profil</span>
            <ArrowRight size={12} />
          </button>
        )}
      </section>

      {/* Connected Google Drives */}
      <section className="tempo-card rounded-2xl p-5 space-y-3">
        <div>
          <p className="text-xs font-semibold text-slate-900 dark:text-zinc-100">
            Sources Google Drive
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Gère les dossiers synchronisés avec ta bibliothèque Rowav.
          </p>
        </div>
        <DriveSourcesManager />
      </section>

      {/* Appearance Card */}
      <section className="tempo-card rounded-2xl p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-slate-900 dark:text-zinc-100">Apparence</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {state.preferences.theme === 'dark' ? 'Mode sombre actif' : 'Mode clair actif'}
            </p>
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 transition cursor-pointer"
          >
            {state.preferences.theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
            {state.preferences.theme === 'dark' ? 'Passer en clair' : 'Passer en sombre'}
          </button>
        </div>
      </section>

      {/* Cloud Account & Sign Out */}
      <section className="tempo-card rounded-2xl p-5 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold text-slate-900 dark:text-zinc-100">
              Compte & Synchronisation
            </p>
            {cloudUser?.email && (
              <p className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1.5">
                <Mail size={11} />
                <span className="truncate">{cloudUser.email}</span>
                <span>·</span>
                <span>{providerLabel}</span>
              </p>
            )}
          </div>
          <button
            type="button"
            disabled={cloudSyncing}
            onClick={() => void forceSaveCloud()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 transition cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={12} className={cloudSyncing ? 'animate-spin' : ''} />
            <span>Forcer la synchro</span>
          </button>
        </div>

        {cloudError && (
          <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 px-3.5 py-2.5 text-[11px] text-rose-700 dark:text-rose-300 flex items-start gap-2 leading-relaxed">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>{cloudError}</span>
          </div>
        )}

        <div className="pt-2 border-t border-slate-100 dark:border-zinc-800/80 flex justify-end">
          <button
            type="button"
            onClick={() => void disconnectGoogleCloud()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/70 dark:bg-rose-950/25 hover:bg-rose-100 dark:hover:bg-rose-950/50 px-3.5 py-2 text-xs font-semibold text-rose-600 dark:text-rose-400 transition cursor-pointer"
          >
            <LogOut size={13} />
            <span>Se déconnecter</span>
          </button>
        </div>
      </section>
    </div>
  );
}
