import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { AIDomain, ActiveTab, CalendarOccurrence } from './types';
import { AppProvider, useApp } from './context/AppContext';
import { AudioPlayerProvider } from './context/AudioPlayerContext';
import { AIProvider, useAI } from './context/AIContext';
import { AuthGate } from './components/AuthGate';
import { KoraLogo } from './components/ui/KoraLogo';
import { Layout } from './components/Layout';
import { TodayView } from './components/TodayView';
import { PlanningView } from './components/PlanningView';
import { StudiesView } from './components/StudiesView';
import { SportView } from './components/SportView';
import { MusicView } from './components/music/MusicView';
import { QuickAddModal, type QuickAddContext } from './components/QuickAddModal';
import { EventDetailDrawer } from './components/EventDetailDrawer';
import { SettingsModal } from './components/SettingsModal';
import { AIAssistantDrawer } from './components/AIAssistantDrawer';
import { AIPreviewBar } from './components/AIPreviewBar';
import { FocusModal } from './components/FocusModal';
import { WeeklyReviewModal } from './components/WeeklyReviewModal';

function tabToDomain(tab: ActiveTab): AIDomain {
  if (tab === 'studies') return 'cours';
  if (tab === 'sport') return 'sport';
  if (tab === 'music') return 'music';
  return 'general';
}

function KoraApp() {
  const { cloudConfigured, cloudUser, authReady } = useApp();
  const { openAI, requestAIConfirmation } = useAI();

  const [activeTab, setActiveTab] = useState<ActiveTab>('today');
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddCtx, setQuickAddCtx] = useState<QuickAddContext | undefined>(undefined);
  const [selectedOccurrence, setSelectedOccurrence] = useState<CalendarOccurrence | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [focusOpen, setFocusOpen] = useState(false);
  const [weeklyOpen, setWeeklyOpen] = useState(false);

  const openQuickAdd = useCallback((ctx?: QuickAddContext) => {
    setQuickAddCtx(ctx);
    setQuickAddOpen(true);
  }, []);

  // Global keyboard shortcuts (Ctrl+K Quick-Add, Ctrl+J Kora AI, 1-5 tabs)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openQuickAdd();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        openAI(tabToDomain(activeTab));
        return;
      }

      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (isInput || e.metaKey || e.ctrlKey || e.altKey || quickAddOpen || settingsOpen) {
        return;
      }

      if (e.key === '1') setActiveTab('today');
      else if (e.key === '2') setActiveTab('planning');
      else if (e.key === '3') setActiveTab('studies');
      else if (e.key === '4') setActiveTab('sport');
      else if (e.key === '5') setActiveTab('music');
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openQuickAdd, openAI, activeTab, quickAddOpen, settingsOpen]);

  // Require Login / Sign-up on launch when Firebase DB is pre-loaded
  if (cloudConfigured && !authReady) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-3 bg-[var(--bg)]">
        <KoraLogo size={42} />
        <span className="text-xs text-slate-400 animate-pulse">Chargement de ton espace Kora…</span>
      </div>
    );
  }

  if (cloudConfigured && !cloudUser) {
    return <AuthGate />;
  }

  return (
    <Layout
      activeTab={activeTab}
      onTabChange={setActiveTab}
      onOpenQuickAdd={() => openQuickAdd()}
      onOpenAI={() => openAI(tabToDomain(activeTab))}
      onOpenFocus={() => setFocusOpen(true)}
      onOpenSettings={() => setSettingsOpen(true)}
    >
      <AIPreviewBar />

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
        >
          {activeTab === 'today' && (
            <TodayView
              onOpenQuickAdd={openQuickAdd}
              onSelectOccurrence={setSelectedOccurrence}
              onNavigate={setActiveTab}
              onOpenFocus={() => setFocusOpen(true)}
              onOpenWeeklyReview={() => setWeeklyOpen(true)}
              onRequestAI={requestAIConfirmation}
            />
          )}
          {activeTab === 'planning' && (
            <PlanningView
              onOpenQuickAdd={openQuickAdd}
              onSelectOccurrence={setSelectedOccurrence}
            />
          )}
          {activeTab === 'studies' && (
            <StudiesView onOpenQuickAdd={openQuickAdd} onRequestAI={requestAIConfirmation} />
          )}
          {activeTab === 'sport' && (
            <SportView onOpenQuickAdd={openQuickAdd} onRequestAI={requestAIConfirmation} />
          )}
          {activeTab === 'music' && <MusicView onOpenQuickAdd={openQuickAdd} />}
        </motion.div>
      </AnimatePresence>

      <QuickAddModal
        open={quickAddOpen}
        initial={quickAddCtx}
        onClose={() => setQuickAddOpen(false)}
      />

      <EventDetailDrawer
        occurrence={selectedOccurrence}
        onClose={() => setSelectedOccurrence(null)}
        onNavigate={setActiveTab}
      />

      {/* Non-blocking Floating Kora AI Overlay */}
      <AIAssistantDrawer onNavigate={setActiveTab} />

      <FocusModal open={focusOpen} onClose={() => setFocusOpen(false)} />

      <WeeklyReviewModal
        open={weeklyOpen}
        onClose={() => setWeeklyOpen(false)}
        onRequestAI={requestAIConfirmation}
      />

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </Layout>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AudioPlayerProvider>
        <AIProvider>
          <KoraApp />
        </AIProvider>
      </AudioPlayerProvider>
    </AppProvider>
  );
}
