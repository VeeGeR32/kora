import React, { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Cloud,
  CloudOff,
  Disc3,
  FileText,
  Home,
  ListMusic,
  Moon,
  Settings,
  Sun,
  Undo2,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useAudioPlayer } from '../context/AudioPlayerContext';
import { groupMusicTracks } from '../lib/musicVersioning';
import { KoraLogo } from './ui/KoraLogo';
import { MiniAudioPlayer } from './music/MiniAudioPlayer';
import type { MusicSubTab } from './music/MusicView';

interface LayoutProps {
  subTab: MusicSubTab;
  onSubTabChange: (tab: MusicSubTab) => void;
  onOpenSettings: () => void;
  children: React.ReactNode;
}

const NAV_ITEMS: {
  id: MusicSubTab;
  label: string;
  mobileLabel: string;
  shortcut: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
}[] = [
  { id: 'dashboard', label: 'Accueil', mobileLabel: 'Accueil', shortcut: '1', icon: Home },
  { id: 'library', label: 'Sons', mobileLabel: 'Sons', shortcut: '2', icon: ListMusic },
  { id: 'projects', label: 'Projets', mobileLabel: 'Projets', shortcut: '3', icon: Disc3 },
  { id: 'lyrics', label: 'Textes', mobileLabel: 'Textes', shortcut: '4', icon: FileText },
];

export function Layout({
  subTab,
  onSubTabChange,
  onOpenSettings,
  children,
}: LayoutProps) {
  const { state, toggleTheme, toast, dismissToast, cloudUser, cloudSyncing } = useApp();
  const { currentTrack } = useAudioPlayer();

  const songGroupsCount = useMemo(
    () => groupMusicTracks(state.musicTracks).length,
    [state.musicTracks]
  );
  const projectsCount = state.musicProjects.length;
  const lyricsCount = useMemo(
    () => state.lyricsDocs.filter((d) => !d.deletedAt).length,
    [state.lyricsDocs]
  );

  const getBadgeCount = (id: MusicSubTab): number | null => {
    if (id === 'library') return songGroupsCount > 0 ? songGroupsCount : null;
    if (id === 'projects') return projectsCount > 0 ? projectsCount : null;
    if (id === 'lyrics') return lyricsCount > 0 ? lyricsCount : null;
    return null;
  };

  return (
    <div className="min-h-[100dvh] flex flex-col md:flex-row bg-[var(--bg)] text-[var(--text)] transition-colors duration-200">
      {/* Desktop Dedicated Music Sidebar */}
      <aside className="hidden md:flex md:flex-col md:w-60 shrink-0 border-r border-slate-200/70 dark:border-zinc-800/80 bg-white/80 dark:bg-[#0e0e11]/92 backdrop-blur-md sticky top-0 h-screen px-4 py-5 justify-between">
        <div className="space-y-6">
          {/* Brand Header */}
          <div className="flex items-center justify-between px-1.5">
            <div className="flex items-center gap-2.5">
              <KoraLogo size={32} />
              <div className="leading-tight">
                <p className="text-sm font-bold tracking-tight text-slate-900 dark:text-zinc-50">
                  Kora
                </p>
                <p className="text-[10px] font-medium text-slate-400 dark:text-zinc-500">
                  Music Studio
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onOpenSettings}
              title={cloudUser ? `Synchronisé (${cloudUser.email})` : 'Compte & Profil'}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 dark:hover:text-zinc-200 cursor-pointer"
            >
              {cloudUser ? (
                <Cloud
                  size={14}
                  className={cloudSyncing ? 'text-fuchsia-500 animate-pulse' : 'text-emerald-500'}
                />
              ) : (
                <CloudOff size={14} />
              )}
            </button>
          </div>

          {/* 4-Section Music Navigation */}
          <nav className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = subTab === item.id;
              const badge = getBadgeCount(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSubTabChange(item.id)}
                  className={`relative w-full flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition cursor-pointer ${
                    active
                      ? 'text-slate-900 dark:text-zinc-50'
                      : 'text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200 hover:bg-slate-100/70 dark:hover:bg-zinc-800/50'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="desktopNavPill"
                      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                      className="absolute inset-0 rounded-xl bg-slate-100 dark:bg-zinc-800/85"
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-3">
                    <Icon size={17} strokeWidth={active ? 2.2 : 1.8} />
                    {item.label}
                  </span>
                  {badge !== null ? (
                    <span className="relative z-10 font-mono text-[10px] font-semibold rounded-full bg-slate-200/70 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 px-2 py-0.5 tabular-nums">
                      {badge}
                    </span>
                  ) : (
                    <span className="relative z-10 font-mono text-[10px] text-slate-300 dark:text-zinc-600">
                      {item.shortcut}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Profile & Theme Controls */}
        <div className="space-y-2.5 pt-4 border-t border-slate-100 dark:border-zinc-800/80">
          <button
            type="button"
            onClick={onOpenSettings}
            className="w-full flex items-center gap-2.5 rounded-xl p-1.5 hover:bg-slate-100/80 dark:hover:bg-zinc-800/60 transition cursor-pointer text-left"
          >
            {state.preferences.avatarUrl || cloudUser?.photoURL ? (
              <img
                src={state.preferences.avatarUrl || cloudUser?.photoURL || ''}
                alt="Profil"
                className="h-8 w-8 rounded-xl object-cover shrink-0 border border-slate-200 dark:border-zinc-700"
              />
            ) : (
              <div
                className={`h-8 w-8 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 ${
                  state.preferences.avatarColor === 'indigo'
                    ? 'bg-indigo-600 text-white'
                    : state.preferences.avatarColor === 'violet'
                    ? 'bg-violet-600 text-white'
                    : state.preferences.avatarColor === 'emerald'
                    ? 'bg-emerald-600 text-white'
                    : state.preferences.avatarColor === 'fuchsia'
                    ? 'bg-fuchsia-600 text-white'
                    : state.preferences.avatarColor === 'amber'
                    ? 'bg-amber-500 text-white'
                    : 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                }`}
              >
                {(state.preferences.name || cloudUser?.displayName || cloudUser?.email || 'K')
                  .slice(0, 2)
                  .toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold truncate text-slate-900 dark:text-zinc-100">
                {state.preferences.name || cloudUser?.displayName || 'Se connecter'}
              </p>
              <p className="text-[10px] text-slate-400 truncate">
                {state.preferences.bio || (cloudUser ? 'Cloud synchronisé' : 'Profil & Cloud')}
              </p>
            </div>
          </button>

          <div className="flex items-center justify-between gap-1">
            <button
              type="button"
              onClick={toggleTheme}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-medium text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800/70 transition cursor-pointer"
            >
              {state.preferences.theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
              {state.preferences.theme === 'dark' ? 'Clair' : 'Sombre'}
            </button>
            <button
              type="button"
              onClick={onOpenSettings}
              aria-label="Paramètres"
              className="rounded-xl p-2 text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800/70 transition cursor-pointer"
            >
              <Settings size={15} />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Fixed Safe-Area Top Bar */}
      <header className="md:hidden fixed top-0 inset-x-0 z-40 pt-[calc(env(safe-area-inset-top)+10px)] bg-white dark:bg-[#0e0e11] border-b border-slate-200/80 dark:border-zinc-800/90">
        <div className="h-12 px-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <KoraLogo size={26} />
            <span className="text-sm font-bold tracking-tight text-slate-900 dark:text-zinc-50">
              Kora
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Thème"
              className="rounded-xl p-2 text-slate-600 dark:text-zinc-300"
            >
              {state.preferences.theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button
              type="button"
              onClick={onOpenSettings}
              aria-label="Profil & Paramètres"
              className="rounded-xl p-1.5 text-slate-600 dark:text-zinc-300 flex items-center gap-1.5"
            >
              {state.preferences.avatarUrl || cloudUser?.photoURL ? (
                <img
                  src={state.preferences.avatarUrl || cloudUser?.photoURL || ''}
                  alt="Profil"
                  className="h-7 w-7 rounded-xl object-cover border border-slate-200 dark:border-zinc-700"
                />
              ) : (
                <Settings size={16} />
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Full-Width Standalone Music Main Workspace */}
      <main
        className={`flex-1 min-w-0 px-3.5 sm:px-7 lg:px-10 pt-[calc(4.75rem+env(safe-area-inset-top))] md:pt-6 max-w-7xl w-full mx-auto ${
          currentTrack ? 'pb-44 md:pb-28' : 'pb-24 md:pb-10'
        }`}
      >
        {children}
      </main>

      {/* Persistent Global Mini Audio Player */}
      <MiniAudioPlayer />

      {/* Mobile Docked 4-Tab Music Bottom Bar */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 dark:bg-[#0e0e11]/95 backdrop-blur-xl border-t border-slate-200/80 dark:border-zinc-800/90 px-2 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] flex items-center justify-around">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = subTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSubTabChange(item.id)}
              className={`relative flex-1 flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[10px] font-medium transition ${
                active ? 'text-slate-900 dark:text-zinc-50' : 'text-slate-400 dark:text-zinc-500'
              }`}
            >
              {active && (
                <motion.span
                  layoutId="mobileNavPill"
                  className="absolute inset-x-1 inset-y-0 rounded-xl bg-slate-100 dark:bg-zinc-800/85"
                />
              )}
              <span className="relative z-10">
                <Icon size={17} strokeWidth={active ? 2.2 : 1.8} />
              </span>
              <span className="relative z-10">{item.mobileLabel}</span>
            </button>
          );
        })}
      </nav>

      {/* Floating Undo Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            className="fixed bottom-24 md:bottom-6 right-4 md:right-6 z-50 flex items-center gap-3 rounded-2xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-4 py-2.5 text-xs font-medium shadow-xl"
          >
            <span>{toast.text}</span>
            {toast.undo && (
              <button
                type="button"
                onClick={() => {
                  toast.undo?.();
                  dismissToast();
                }}
                className="inline-flex items-center gap-1 rounded-lg bg-white/15 dark:bg-black/10 px-2 py-1 text-[11px] font-semibold cursor-pointer"
              >
                <Undo2 size={11} /> Annuler
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
