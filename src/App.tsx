import { useCallback, useEffect, useRef, useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { AudioPlayerProvider, useAudioPlayer } from './context/AudioPlayerContext';
import { AuthGate } from './components/AuthGate';
import { KoraLogo } from './components/ui/KoraLogo';
import { Layout, type AppPage } from './components/Layout';
import { MusicView, type MusicSubTab } from './components/music/MusicView';
import { PublicSharePage } from './components/music/PublicSharePage';

function KoraMusicApp() {
  const {
    state,
    cloudConfigured,
    cloudUser,
    authReady,
    lastCloudSyncAt,
    updateLastSession,
  } = useApp();
  const player = useAudioPlayer();

  const [activePage, setActivePageState] = useState<AppPage>(
    () => state.preferences.lastSession?.musicSubTab || 'dashboard'
  );
  const [navResetNonce, setNavResetNonce] = useState(0);

  const bootTimestampRef = useRef<number>(Date.now());
  const localRestoredRef = useRef(false);
  const cloudRestoredRef = useRef(false);

  const setActivePage = useCallback(
    (next: AppPage) => {
      setActivePageState(next);
      setNavResetNonce((n) => n + 1);
      if (next !== 'settings' && next !== 'docs') {
        updateLastSession({ activeTab: 'music', musicSubTab: next, scrollY: 0 });
      }
      window.scrollTo({ top: 0, behavior: 'auto' });
    },
    [updateLastSession]
  );

  const handleMusicSubTabChange = useCallback(
    (next: MusicSubTab) => {
      setActivePage(next);
    },
    [setActivePage]
  );

  // Restore exact last session (music tab, scroll position & audio track/timestamp) on app launch & cloud hydration
  useEffect(() => {
    const ls = state.preferences.lastSession;
    if (!ls) return;

    const shouldApplyLocal = !localRestoredRef.current;
    const shouldApplyCloud =
      Boolean(lastCloudSyncAt) &&
      !cloudRestoredRef.current &&
      ls.savedAt > 0 &&
      ls.savedAt <= bootTimestampRef.current + 15_000;

    if (!shouldApplyLocal && !shouldApplyCloud) return;
    if (shouldApplyLocal) localRestoredRef.current = true;
    if (lastCloudSyncAt) cloudRestoredRef.current = true;

    if (ls.musicSubTab) {
      setActivePageState(ls.musicSubTab);
    }

    if (ls.audioTrackId && !player.isPlaying) {
      const foundTrack = state.musicTracks.find((t) => t.id === ls.audioTrackId);
      if (foundTrack && player.currentTrack?.id !== foundTrack.id) {
        player.restoreTrack(foundTrack, ls.audioTimeSec || 0, Boolean(ls.audioExpanded));
      }
    }

    if (typeof ls.scrollY === 'number' && ls.scrollY > 20) {
      const targetY = ls.scrollY;
      window.setTimeout(() => {
        window.scrollTo({ top: targetY, behavior: 'auto' });
      }, 120);
    }
  }, [
    lastCloudSyncAt,
    state.preferences.lastSession?.savedAt,
    state.musicTracks.length,
  ]);

  // If user taps cover art inside the full-screen player while on Settings or Docs, switch back to MusicView so the Song Page opens!
  useEffect(() => {
    if (player.pendingOpenTrackId && (activePage === 'settings' || activePage === 'docs')) {
      setActivePageState('dashboard');
    }
  }, [player.pendingOpenTrackId, activePage]);

  // Persist exact scroll position when leaving / closing the app on any device
  useEffect(() => {
    const saveScroll = () => {
      updateLastSession({ scrollY: Math.round(window.scrollY || 0) });
    };
    const onVis = () => {
      if (document.visibilityState === 'hidden') saveScroll();
    };
    window.addEventListener('pagehide', saveScroll);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pagehide', saveScroll);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [updateLastSession]);

  // Global keyboard shortcuts (1: Accueil, 2: Sons, 3: Projets, 4: Textes)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (isInput || e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }

      if (e.key === '1') setActivePage('dashboard');
      else if (e.key === '2') setActivePage('library');
      else if (e.key === '3') setActivePage('projects');
      else if (e.key === '4') setActivePage('lyrics');
      else if (e.key === '5') setActivePage('social');
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setActivePage]);

  if (cloudConfigured && !authReady) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-3 bg-[var(--bg)]">
        <KoraLogo size={42} />
        <span className="text-xs text-slate-400 animate-pulse">Chargement de ton studio…</span>
      </div>
    );
  }

  if (cloudConfigured && !cloudUser) {
    return <AuthGate />;
  }

  return (
    <Layout activePage={activePage} onPageChange={setActivePage}>
      <MusicView
        subTab={activePage === 'settings' || activePage === 'docs' ? 'dashboard' : activePage}
        isSettingsOpen={activePage === 'settings'}
        onOpenSettings={() => setActivePage('settings')}
        isDocsOpen={activePage === 'docs'}
        onOpenDocs={() => setActivePage('docs')}
        onSubTabChange={handleMusicSubTabChange}
        navResetNonce={navResetNonce}
      />
    </Layout>
  );
}

export default function App() {
  const shareToken =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('share')?.trim() || ''
      : '';

  if (shareToken) {
    return <PublicSharePage token={shareToken} />;
  }

  return (
    <AppProvider>
      <AudioPlayerProvider>
        <KoraMusicApp />
      </AudioPlayerProvider>
    </AppProvider>
  );
}
