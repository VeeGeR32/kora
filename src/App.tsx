import { useCallback, useEffect, useRef, useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { AudioPlayerProvider, useAudioPlayer } from './context/AudioPlayerContext';
import { AuthGate } from './components/AuthGate';
import { KoraLogo } from './components/ui/KoraLogo';
import { Layout } from './components/Layout';
import { MusicView, type MusicSubTab } from './components/music/MusicView';
import { SettingsModal } from './components/SettingsModal';
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

  const [subTab, setSubTabState] = useState<MusicSubTab>(
    () => state.preferences.lastSession?.musicSubTab || 'dashboard'
  );
  const [settingsOpen, setSettingsOpen] = useState(false);

  const bootTimestampRef = useRef<number>(Date.now());
  const localRestoredRef = useRef(false);
  const cloudRestoredRef = useRef(false);

  const setSubTab = useCallback(
    (next: MusicSubTab) => {
      setSubTabState(next);
      updateLastSession({ activeTab: 'music', musicSubTab: next, scrollY: 0 });
    },
    [updateLastSession]
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
      setSubTabState(ls.musicSubTab);
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

      if (isInput || e.metaKey || e.ctrlKey || e.altKey || settingsOpen) {
        return;
      }

      if (e.key === '1') setSubTab('dashboard');
      else if (e.key === '2') setSubTab('library');
      else if (e.key === '3') setSubTab('projects');
      else if (e.key === '4') setSubTab('lyrics');
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setSubTab, settingsOpen]);

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
    <Layout
      subTab={subTab}
      onSubTabChange={setSubTab}
      onOpenSettings={() => setSettingsOpen(true)}
    >
      <MusicView subTab={subTab} onSubTabChange={setSubTab} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
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
