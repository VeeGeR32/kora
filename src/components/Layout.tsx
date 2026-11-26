import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Cloud,
  CloudOff,
  Disc3,
  FileText,
  Home,
  ListMusic,
  Moon,
  Search,
  Settings,
  Sun,
  Undo2,
  Users,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useAudioPlayer } from '../context/AudioPlayerContext';
import { groupMusicTracks } from '../lib/musicVersioning';
import { KoraLogo } from './ui/KoraLogo';
import { GlobalSearchModal } from './GlobalSearchModal';
import { MiniAudioPlayer } from './music/MiniAudioPlayer';
import type { MusicSubTab } from './music/MusicView';

export type AppPage = MusicSubTab | 'settings' | 'docs';

interface LayoutProps {
  activePage: AppPage;
  onPageChange: (page: AppPage) => void;
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
  { id: 'social', label: 'Social', mobileLabel: 'Social', shortcut: '5', icon: Users },
];

export function Layout({ activePage, onPageChange, children }: LayoutProps) {
  const { state, playlists, toggleTheme, toast, dismissToast, cloudUser, cloudSyncing } = useApp();
  const { currentTrack } = useAudioPlayer();

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('kora_sidebar_collapsed') === '1';
  });
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('kora_sidebar_collapsed', sidebarCollapsed ? '1' : '0');
    }
    document.documentElement.dataset.sidebarCollapsed = sidebarCollapsed ? 'true' : 'false';
    return () => {
      delete document.documentElement.dataset.sidebarCollapsed;
    };
  }, [sidebarCollapsed]);

  // Ctrl+B / Cmd+B toggles sidebar · Ctrl+K / Cmd+K opens Global Search
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((v) => !v);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        ) {
          return;
        }
        e.preventDefault();
        setSidebarCollapsed((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const songGroupsCount = useMemo(
    () => groupMusicTracks(state.musicTracks).length,
    [state.musicTracks]
  );
  const projectsCount = state.musicProjects.length + playlists.length;
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
      {/* Rowav Signature Top Crimson Accent Bar (visible across every page) */}
      <div
        aria-hidden="true"
        className="fixed top-0 inset-x-0 h-[3px] z-[65] pointer-events-none bg-gradient-to-r from-[#6E1D16] via-[#8C271E] to-[#C23B2E]"
      />

      {/* Desktop Fluid Collapsible Side Rail (smooth spring width 240px <-> 72px with side-edge handle) */}
      <motion.aside
        initial={false}
        animate={{ width: sidebarCollapsed ? 72 : 240 }}
        transition={{ type: 'spring', stiffness: 340, damping: 34, mass: 0.85 }}
        className="hidden md:flex md:flex-col shrink-0 relative bg-white/88 dark:bg-[#120c0c]/95 backdrop-blur-xl sticky top-0 h-screen justify-between border-r border-[#8C271E]/18 dark:border-[#8C271E]/30 z-30 py-5"
      >
        {/* Tactile Side-Edge Collapse/Expand Handle (always anchored cleanly on the right edge) */}
        <button
          type="button"
          onClick={() => setSidebarCollapsed((v) => !v)}
          title={sidebarCollapsed ? 'Agrandir la barre latérale (Ctrl+B)' : 'Réduire la barre latérale (Ctrl+B)'}
          aria-label={sidebarCollapsed ? 'Agrandir la barre latérale' : 'Réduire la barre latérale'}
          className="absolute -right-3.5 top-7 z-40 h-7 w-7 rounded-full border border-slate-200/90 dark:border-zinc-700/90 bg-white dark:bg-[#1b1414] text-slate-500 dark:text-zinc-300 hover:text-[#8C271E] dark:hover:text-white hover:border-[#8C271E]/50 shadow-sm flex items-center justify-center transition-all hover:scale-105 active:scale-95 cursor-pointer"
        >
          {sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>

        <div className={`space-y-6 overflow-hidden ${sidebarCollapsed ? 'px-2.5' : 'px-4'}`}>
          {/* Brand Header */}
          <div className={`flex items-center ${sidebarCollapsed ? 'justify-center' : 'justify-between px-1.5'}`}>
            <button
              type="button"
              onClick={() => onPageChange('dashboard')}
              className="flex items-center gap-2.5 cursor-pointer min-w-0"
              title="Rowav Music Studio"
            >
              <KoraLogo size={32} />
              <AnimatePresence initial={false}>
                {!sidebarCollapsed && (
                  <motion.div
                    key="brand-text"
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -6 }}
                    transition={{ duration: 0.16 }}
                    className="leading-tight text-left truncate"
                  >
                    <p className="text-sm font-bold tracking-tight text-slate-900 dark:text-zinc-50">
                      Rowav
                    </p>
                    <p className="text-[10px] font-medium text-[#8C271E] dark:text-[#E56B5F]">
                      Music Studio
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </button>

            {!sidebarCollapsed && (
              <button
                type="button"
                onClick={() => onPageChange('settings')}
                title={cloudUser ? `Synchronisé (${cloudUser.email})` : 'Compte & Profil'}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 dark:hover:text-zinc-200 cursor-pointer shrink-0"
              >
                {cloudUser ? (
                  <Cloud
                    size={14}
                    className={cloudSyncing ? 'text-[#8C271E] animate-pulse' : 'text-emerald-500'}
                  />
                ) : (
                  <CloudOff size={14} />
                )}
              </button>
            )}
          </div>

          {/* Global Instant Search Trigger (Ctrl+K) */}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            title="Recherche globale : sons, projets, packs & paroles (Ctrl+K)"
            className={`w-full flex items-center ${
              sidebarCollapsed ? 'justify-center px-0' : 'justify-between px-3'
            } rounded-xl py-2 text-xs font-medium text-slate-500 dark:text-zinc-400 bg-slate-100/80 dark:bg-zinc-900/70 hover:bg-slate-200/70 dark:hover:bg-zinc-800/80 border border-slate-200/60 dark:border-zinc-800/70 transition cursor-pointer`}
          >
            <span className="flex items-center gap-2 min-w-0">
              <Search size={14} className="shrink-0" />
              {!sidebarCollapsed && <span className="truncate">Rechercher…</span>}
            </span>
            {!sidebarCollapsed && (
              <kbd className="font-mono text-[9.5px] px-1.5 py-0.5 rounded bg-white dark:bg-zinc-800 border border-slate-200/80 dark:border-zinc-700 text-slate-400">
                ⌘K
              </kbd>
            )}
          </button>

          {/* 5-Section Music Navigation */}
          <nav className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = activePage === item.id;
              const badge = getBadgeCount(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onPageChange(item.id)}
                  title={sidebarCollapsed ? item.label : undefined}
                  className={`relative w-full flex items-center ${
                    sidebarCollapsed ? 'justify-center px-0' : 'justify-between px-3'
                  } rounded-xl py-2.5 text-sm font-medium transition-colors duration-100 cursor-pointer ${
                    active
                      ? 'text-white'
                      : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200 hover:bg-[#8C271E]/6 dark:hover:bg-[#8C271E]/12'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="desktopNavPill"
                      transition={{ type: 'spring', stiffness: 820, damping: 48, mass: 0.35 }}
                      className="absolute inset-0 rounded-xl bg-[#8C271E] shadow-sm shadow-[#8C271E]/30"
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-3 min-w-0">
                    <Icon size={17} strokeWidth={active ? 2.2 : 1.8} />
                    {!sidebarCollapsed && (
                      <motion.span
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.14 }}
                        className="truncate"
                      >
                        {item.label}
                      </motion.span>
                    )}
                  </span>
                  {!sidebarCollapsed &&
                    (badge !== null ? (
                      <span
                        className={`relative z-10 font-mono text-[10px] font-semibold rounded-full px-2 py-0.5 tabular-nums ${
                          active
                            ? 'bg-white/20 text-white'
                            : 'bg-[#8C271E]/10 dark:bg-[#8C271E]/20 text-[#8C271E] dark:text-[#E56B5F]'
                        }`}
                      >
                        {badge}
                      </span>
                    ) : (
                      <span
                        className={`relative z-10 font-mono text-[10px] ${
                          active ? 'text-white/70' : 'text-slate-300 dark:text-zinc-600'
                        }`}
                      >
                        {item.shortcut}
                      </span>
                    ))}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Profile & Settings Controls */}
        <div
          className={`space-y-2.5 pt-4 border-t border-slate-100 dark:border-zinc-800/80 overflow-hidden ${
            sidebarCollapsed ? 'px-2.5' : 'px-4'
          }`}
        >
          <button
            type="button"
            onClick={() => onPageChange('profile')}
            title="Mon Profil Artiste, Stats & Portfolio"
            className={`w-full flex items-center ${
              sidebarCollapsed ? 'justify-center' : 'gap-2.5'
            } rounded-xl p-1.5 transition cursor-pointer text-left ${
              activePage === 'profile'
                ? 'bg-[#8C271E]/12 dark:bg-[#8C271E]/22'
                : 'hover:bg-slate-100/80 dark:hover:bg-zinc-800/60'
            }`}
          >
            {state.preferences.avatarUrl || cloudUser?.photoURL ? (
              <img
                src={state.preferences.avatarUrl || cloudUser?.photoURL || ''}
                alt="Profil"
                className="h-8 w-8 rounded-full object-cover shrink-0 border border-slate-200 dark:border-zinc-700"
              />
            ) : (
              <div
                className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                  state.preferences.avatarColor === 'indigo'
                    ? 'bg-zinc-700 text-white'
                    : state.preferences.avatarColor === 'emerald'
                    ? 'bg-emerald-600 text-white'
                    : state.preferences.avatarColor === 'amber'
                    ? 'bg-amber-500 text-white'
                    : 'bg-[#8C271E] text-white'
                }`}
              >
                {(state.preferences.name || cloudUser?.displayName || cloudUser?.email || 'R')
                  .slice(0, 2)
                  .toUpperCase()}
              </div>
            )}
            {!sidebarCollapsed && (
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold truncate text-slate-900 dark:text-zinc-100">
                  {state.preferences.name || cloudUser?.displayName || 'Mon Profil'}
                </p>
                <p className="text-[10px] text-slate-400 truncate">
                  Voir mon profil
                </p>
              </div>
            )}
          </button>

          <div
            className={`flex ${
              sidebarCollapsed ? 'flex-col items-center gap-1' : 'items-center justify-between gap-1'
            }`}
          >
            <button
              type="button"
              onClick={toggleTheme}
              title={state.preferences.theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'}
              className={`${
                sidebarCollapsed ? 'h-9 w-9' : 'flex-1 py-2'
              } flex items-center justify-center gap-1.5 rounded-xl text-xs font-medium text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800/70 transition cursor-pointer`}
            >
              {state.preferences.theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
              {!sidebarCollapsed && (state.preferences.theme === 'dark' ? 'Clair' : 'Sombre')}
            </button>
            <button
              type="button"
              onClick={() => onPageChange(activePage === 'docs' ? 'dashboard' : 'docs')}
              title="Guide & Documentation"
              aria-label="Guide & Documentation"
              className={`inline-flex items-center justify-center gap-1 rounded-xl ${
                sidebarCollapsed ? 'h-9 w-9' : 'px-2.5 py-2'
              } text-xs font-medium transition cursor-pointer ${
                activePage === 'docs'
                  ? 'bg-[#8C271E] text-white'
                  : 'text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800/70'
              }`}
            >
              <BookOpen size={14} />
              {!sidebarCollapsed && <span>Guide</span>}
            </button>
            <button
              type="button"
              onClick={() => onPageChange('settings')}
              title="Paramètres"
              aria-label="Paramètres"
              className={`rounded-xl ${
                sidebarCollapsed ? 'h-9 w-9 flex items-center justify-center' : 'p-2'
              } transition cursor-pointer ${
                activePage === 'settings'
                  ? 'bg-[#8C271E] text-white'
                  : 'text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800/70'
              }`}
            >
              <Settings size={15} />
            </button>
          </div>
        </div>
      </motion.aside>

      {/* Mobile Fixed Safe-Area Top Bar (z-20 so Project/Track/Text full-screen pages cover it cleanly) */}
      <header className="md:hidden fixed top-0 inset-x-0 z-20 pt-[calc(env(safe-area-inset-top)+10px)] bg-white/95 dark:bg-[#120c0c]/95 backdrop-blur-xl border-b border-[#8C271E]/18 dark:border-[#8C271E]/30">
        <div className="h-12 px-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => onPageChange('dashboard')}
            className="flex items-center gap-2 cursor-pointer"
          >
            <KoraLogo size={26} />
            <span className="text-sm font-bold tracking-tight text-slate-900 dark:text-zinc-50">
              Rowav
            </span>
          </button>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label="Recherche globale"
              title="Rechercher un son, projet ou parole"
              className="rounded-xl p-2 text-slate-600 dark:text-zinc-300"
            >
              <Search size={16} />
            </button>
            <button
              type="button"
              onClick={() => onPageChange(activePage === 'docs' ? 'dashboard' : 'docs')}
              aria-label="Guide & Documentation"
              title="Guide & Documentation"
              className={`rounded-xl p-2 transition ${
                activePage === 'docs'
                  ? 'bg-[#8C271E] text-white'
                  : 'text-slate-600 dark:text-zinc-300'
              }`}
            >
              <BookOpen size={16} />
            </button>
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
              onClick={() => onPageChange(activePage === 'settings' ? 'dashboard' : 'settings')}
              aria-label="Paramètres"
              title="Paramètres"
              className={`rounded-xl p-2 transition ${
                activePage === 'settings'
                  ? 'bg-[#8C271E] text-white'
                  : 'text-slate-600 dark:text-zinc-300'
              }`}
            >
              <Settings size={16} />
            </button>
            <button
              type="button"
              onClick={() => onPageChange(activePage === 'profile' ? 'dashboard' : 'profile')}
              aria-label="Mon Profil"
              title="Mon Profil"
              className={`rounded-full p-0.5 transition ${
                activePage === 'profile'
                  ? 'ring-2 ring-[#8C271E]'
                  : ''
              }`}
            >
              {state.preferences.avatarUrl || cloudUser?.photoURL ? (
                <img
                  src={state.preferences.avatarUrl || cloudUser?.photoURL || ''}
                  alt="Profil"
                  className="h-7 w-7 rounded-full object-cover border border-slate-200 dark:border-zinc-700"
                />
              ) : (
                <span className="h-7 w-7 rounded-full bg-[#8C271E] text-white text-[10px] font-bold flex items-center justify-center">
                  {(state.preferences.name || cloudUser?.displayName || cloudUser?.email || 'R')
                    .slice(0, 2)
                    .toUpperCase()}
                </span>
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

      {/* Global Search Modal (Ctrl+K) */}
      <GlobalSearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />

      {/* Mobile Docked 4-Tab Music Bottom Bar (always visible above sub-pages, below maximized player) */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-[45] bg-white/95 dark:bg-[#0e0e11]/95 backdrop-blur-xl border-t border-slate-200/80 dark:border-zinc-800/90 px-2 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] flex items-center justify-around">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activePage === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onPageChange(item.id)}
              className={`relative flex-1 flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[10px] font-medium transition-colors duration-100 ${
                active ? 'text-white' : 'text-slate-400 dark:text-zinc-500'
              }`}
            >
              {active && (
                <motion.span
                  layoutId="mobileNavPill"
                  transition={{ type: 'spring', stiffness: 820, damping: 48, mass: 0.35 }}
                  className="absolute inset-x-1 inset-y-0 rounded-xl bg-[#8C271E] shadow-xs shadow-[#8C271E]/25"
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
            className="fixed bottom-24 md:bottom-6 right-4 md:right-6 z-50 flex items-center gap-3 rounded-2xl bg-[#8C271E] text-white px-4 py-2.5 text-xs font-medium shadow-xl shadow-[#8C271E]/30 border border-white/15"
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
