import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { AIDomain, ActiveTab } from '../types';
import { useApp } from './AppContext';
import { runKoraAssistant, type AIImageAttachment, type KoraAIAction } from '../lib/koraAi';
import { uid } from '../utils/dates';

export interface AIMessageImage {
  id: string;
  name: string;
  dataUrl: string;
}

export interface AIMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  images?: AIMessageImage[];
  actions?: KoraAIAction[];
  applied?: boolean;
  createdAt: number;
}

export interface AIConversation {
  id: string;
  domain: AIDomain;
  title: string;
  messages: AIMessage[];
  updatedAt: number;
}

export interface DraftActionItem {
  id: string;
  conversationId: string;
  messageId: string;
  action: KoraAIAction;
}

interface PendingConfirmation {
  prompt: string;
  domain: AIDomain;
}

interface AIContextValue {
  isOpen: boolean;
  isMinimized: boolean;
  activeDomain: AIDomain;
  conversations: AIConversation[];
  activeConversation: AIConversation;
  loading: boolean;
  pendingConfirmation: PendingConfirmation | null;
  draftActions: DraftActionItem[];

  openAI: (domain?: AIDomain) => void;
  closeAI: () => void;
  setMinimized: (v: boolean) => void;
  setDomain: (d: AIDomain) => void;
  selectConversation: (id: string) => void;
  createConversation: (domain?: AIDomain) => void;
  deleteConversation: (id: string) => void;

  /** Opens Kora AI with a confirmation prompt card before sending to Gemini */
  requestAIConfirmation: (prompt: string, domain?: AIDomain) => void;
  cancelConfirmation: () => void;
  confirmAndSend: (editedPrompt?: string) => Promise<void>;
  sendDirectMessage: (prompt: string, images?: AIImageAttachment[]) => Promise<void>;

  /** Live Preview actions directly visible on Kora UI */
  applyDraftAction: (draftId: string) => void;
  dismissDraftAction: (draftId: string) => void;
  applyAllDrafts: () => void;
  clearDrafts: () => void;
  getSuggestedTabForAction: (action: KoraAIAction) => ActiveTab;
}

const STORAGE_KEY = 'kora_ai_conversations_v1';

const WELCOME_BY_DOMAIN: Record<AIDomain, string> = {
  general:
    'Je suis **Kora AI** *(Général)*. Je vois ton planning, tes cours, ta gym et ta music. Les modifs que je propose s’affichent en **aperçu en direct** sur ton app !',
  cours:
    'Domaine **Cours** actif. Demande-moi un plan de révision, d’organiser tes devoirs ou de préparer un DS.',
  sport:
    'Domaine **Sport** actif. Demande-moi un programme gym façon Hevy, d’ajuster tes macros ou de logger un repas.',
  music:
    'Domaine **Music** actif. Organisons tes sessions d’écriture, ton EP/Single ou tes objectifs musicaux.',
};

function makeInitialConversation(domain: AIDomain): AIConversation {
  return {
    id: uid('conv'),
    domain,
    title: 'Nouvelle conversation',
    messages: [
      {
        id: uid('msg'),
        role: 'assistant',
        text: WELCOME_BY_DOMAIN[domain],
        createdAt: Date.now(),
      },
    ],
    updatedAt: Date.now(),
  };
}

function loadConversations(): AIConversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AIConversation[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // ignore
  }
  return [
    makeInitialConversation('general'),
    makeInitialConversation('cours'),
    makeInitialConversation('sport'),
    makeInitialConversation('music'),
  ];
}

const AIContext = createContext<AIContextValue | null>(null);

export function AIProvider({ children }: { children: React.ReactNode }) {
  const {
    state,
    addEvent,
    addHomework,
    addExamTopic,
    addRoutine,
    addMeal,
    updatePreferences,
    addTask,
    notify,
  } = useApp();

  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [activeDomain, setActiveDomain] = useState<AIDomain>('general');
  const [conversations, setConversations] = useState<AIConversation[]>(loadConversations);
  const [activeConvIdByDomain, setActiveConvIdByDomain] = useState<Record<AIDomain, string>>(() => {
    const init = loadConversations();
    const pick = (d: AIDomain) => init.find((c) => c.domain === d)?.id || init[0].id;
    return {
      general: pick('general'),
      cours: pick('cours'),
      sport: pick('sport'),
      music: pick('music'),
    };
  });
  const [loading, setLoading] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [draftActions, setDraftActions] = useState<DraftActionItem[]>([]);

  useEffect(() => {
    try {
      // Strip heavy base64 dataUrls beyond the 4 most recent messages to avoid localStorage quota issues
      const compact = conversations.map((c) => ({
        ...c,
        messages: c.messages.map((m, idx) =>
          m.images && idx < c.messages.length - 4 ? { ...m, images: undefined } : m
        ),
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(compact));
    } catch {
      try {
        const stripped = conversations.map((c) => ({
          ...c,
          messages: c.messages.map((m) => (m.images ? { ...m, images: undefined } : m)),
        }));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stripped));
      } catch {
        // ignore
      }
    }
  }, [conversations]);

  const domainConvs = conversations.filter((c) => c.domain === activeDomain);
  const activeConversation =
    domainConvs.find((c) => c.id === activeConvIdByDomain[activeDomain]) ||
    domainConvs[0] ||
    conversations[0];

  const openAI = useCallback((domain?: AIDomain) => {
    if (domain) setActiveDomain(domain);
    setIsOpen(true);
    setIsMinimized(false);
  }, []);

  const closeAI = useCallback(() => {
    setIsOpen(false);
    setPendingConfirmation(null);
  }, []);

  const setDomain = useCallback((d: AIDomain) => {
    setActiveDomain(d);
    setConversations((prev) => {
      if (prev.some((c) => c.domain === d)) return prev;
      const fresh = makeInitialConversation(d);
      setActiveConvIdByDomain((map) => ({ ...map, [d]: fresh.id }));
      return [fresh, ...prev];
    });
  }, []);

  const selectConversation = useCallback(
    (id: string) => {
      setActiveConvIdByDomain((prev) => ({ ...prev, [activeDomain]: id }));
    },
    [activeDomain]
  );

  const createConversation = useCallback(
    (domain?: AIDomain) => {
      const targetDomain = domain || activeDomain;
      const fresh = makeInitialConversation(targetDomain);
      setConversations((prev) => [fresh, ...prev]);
      setActiveDomain(targetDomain);
      setActiveConvIdByDomain((prev) => ({ ...prev, [targetDomain]: fresh.id }));
    },
    [activeDomain]
  );

  const deleteConversation = useCallback(
    (id: string) => {
      setConversations((prev) => {
        const target = prev.find((c) => c.id === id);
        const remaining = prev.filter((c) => c.id !== id);
        if (!target) return prev;
        const stillHasDomain = remaining.some((c) => c.domain === target.domain);
        if (!stillHasDomain) {
          const fresh = makeInitialConversation(target.domain);
          setActiveConvIdByDomain((map) => ({ ...map, [target.domain]: fresh.id }));
          return [fresh, ...remaining];
        }
        const nextInDomain = remaining.find((c) => c.domain === target.domain)!;
        setActiveConvIdByDomain((map) => ({ ...map, [target.domain]: nextInDomain.id }));
        return remaining;
      });
      setDraftActions((prev) => prev.filter((d) => d.conversationId !== id));
    },
    []
  );

  const executeSingleAction = useCallback(
    (act: KoraAIAction) => {
      if (act.kind === 'add_schedule_event') {
        addEvent({ ...act.payload, recurringWeekly: false });
      } else if (act.kind === 'add_homework') {
        addHomework({ ...act.payload, done: false });
      } else if (act.kind === 'add_exam_topics') {
        const target =
          state.exams.find((e) =>
            e.title.toLowerCase().includes(act.payload.examTitle.toLowerCase())
          ) || state.exams[0];
        if (target) act.payload.topics.forEach((t) => addExamTopic(target.id, t));
      } else if (act.kind === 'create_workout_routine') {
        addRoutine({
          title: act.payload.title,
          focus: act.payload.focus,
          exercises: act.payload.exercises.map((e) => ({ ...e, id: uid('re') })),
        });
      } else if (act.kind === 'log_meal') {
        addMeal(act.payload);
      } else if (act.kind === 'update_nutrition_goals') {
        updatePreferences({
          nutritionGoals: { ...state.preferences.nutritionGoals, ...act.payload },
        });
      } else if (act.kind === 'add_task') {
        addTask({ ...act.payload, done: false });
      }
    },
    [
      state.exams,
      state.preferences.nutritionGoals,
      addEvent,
      addHomework,
      addExamTopic,
      addRoutine,
      addMeal,
      updatePreferences,
      addTask,
    ]
  );

  const sendDirectMessage = useCallback(
    async (rawPrompt: string, images?: AIImageAttachment[]) => {
      const prompt = rawPrompt.trim();
      const hasImages = Boolean(images && images.length > 0);
      if ((!prompt && !hasImages) || loading) return;

      const convId = activeConversation.id;
      const domain = activeConversation.domain;
      const userMsg: AIMessage = {
        id: uid('msg'),
        role: 'user',
        text: prompt,
        images: hasImages
          ? images!.map((img) => ({ id: img.id, name: img.name, dataUrl: img.dataUrl }))
          : undefined,
        createdAt: Date.now(),
      };

      const historySnapshot = activeConversation.messages
        .filter((m) => m.id !== activeConversation.messages[0]?.id)
        .map((m) => ({ role: m.role, text: m.text || '[Image jointe]' }));

      const fallbackTitle = prompt || `Image (${images?.[0]?.name || 'photo'})`;

      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== convId) return c;
          const isDefaultTitle = c.title === 'Nouvelle conversation';
          return {
            ...c,
            title: isDefaultTitle
              ? fallbackTitle.slice(0, 34) + (fallbackTitle.length > 34 ? '…' : '')
              : c.title,
            messages: [...c.messages, userMsg],
            updatedAt: Date.now(),
          };
        })
      );

      setLoading(true);
      try {
        const res = await runKoraAssistant(prompt, state, {
          apiKey: state.preferences.geminiApiKey,
          domain,
          history: historySnapshot,
          images,
        });
        const assistantMsgId = uid('msg');
        const assistantMsg: AIMessage = {
          id: assistantMsgId,
          role: 'assistant',
          text: res.text,
          actions: res.actions,
          applied: false,
          createdAt: Date.now(),
        };
        setConversations((prev) =>
          prev.map((c) =>
            c.id === convId
              ? { ...c, messages: [...c.messages, assistantMsg], updatedAt: Date.now() }
              : c
          )
        );
        // Push proposed actions directly into Live App Preview!
        if (res.actions.length > 0) {
          setDraftActions((prev) => [
            ...prev,
            ...res.actions.map((action) => ({
              id: uid('draft'),
              conversationId: convId,
              messageId: assistantMsgId,
              action,
            })),
          ]);
        }
      } catch (err) {
        const errMsg: AIMessage = {
          id: uid('msg'),
          role: 'assistant',
          text: `**Erreur Gemini** : ${(err as Error).message}\n\nVérifie ta clé API en cliquant sur **⚙** en haut de Kora AI.`,
          createdAt: Date.now(),
        };
        setConversations((prev) =>
          prev.map((c) =>
            c.id === convId ? { ...c, messages: [...c.messages, errMsg], updatedAt: Date.now() } : c
          )
        );
      } finally {
        setLoading(false);
      }
    },
    [activeConversation, loading, state]
  );

  const requestAIConfirmation = useCallback((prompt: string, domain: AIDomain = 'general') => {
    setActiveDomain(domain);
    setPendingConfirmation({ prompt, domain });
    setIsOpen(true);
    setIsMinimized(false);
  }, []);

  const cancelConfirmation = useCallback(() => {
    setPendingConfirmation(null);
  }, []);

  const confirmAndSend = useCallback(
    async (editedPrompt?: string) => {
      const toSend = (editedPrompt ?? pendingConfirmation?.prompt ?? '').trim();
      setPendingConfirmation(null);
      if (toSend) {
        await sendDirectMessage(toSend);
      }
    },
    [pendingConfirmation, sendDirectMessage]
  );

  const applyDraftAction = useCallback(
    (draftId: string) => {
      const target = draftActions.find((d) => d.id === draftId);
      if (!target) return;
      executeSingleAction(target.action);
      setDraftActions((prev) => prev.filter((d) => d.id !== draftId));
      notify('Modification IA appliquée ✓');
    },
    [draftActions, executeSingleAction, notify]
  );

  const dismissDraftAction = useCallback((draftId: string) => {
    setDraftActions((prev) => prev.filter((d) => d.id !== draftId));
  }, []);

  const applyAllDrafts = useCallback(() => {
    if (draftActions.length === 0) return;
    const count = draftActions.length;
    draftActions.forEach((d) => executeSingleAction(d.action));
    const appliedMsgIds = new Set(draftActions.map((d) => d.messageId));
    setConversations((prev) =>
      prev.map((c) => ({
        ...c,
        messages: c.messages.map((m) => (appliedMsgIds.has(m.id) ? { ...m, applied: true } : m)),
      }))
    );
    setDraftActions([]);
    notify(`${count} modification${count > 1 ? 's' : ''} IA appliquée${count > 1 ? 's' : ''} ✓`);
  }, [draftActions, executeSingleAction, notify]);

  const clearDrafts = useCallback(() => {
    setDraftActions([]);
    notify('Aperçu IA annulé');
  }, [notify]);

  const getSuggestedTabForAction = useCallback((action: KoraAIAction): ActiveTab => {
    if (action.kind === 'add_schedule_event') return 'planning';
    if (action.kind === 'add_homework' || action.kind === 'add_exam_topics') return 'studies';
    if (
      action.kind === 'create_workout_routine' ||
      action.kind === 'log_meal' ||
      action.kind === 'update_nutrition_goals'
    ) {
      return 'sport';
    }
    if (action.kind === 'add_task' && action.payload.category === 'musique') return 'music';
    return 'today';
  }, []);

  return (
    <AIContext.Provider
      value={{
        isOpen,
        isMinimized,
        activeDomain,
        conversations,
        activeConversation,
        loading,
        pendingConfirmation,
        draftActions,
        openAI,
        closeAI,
        setMinimized: setIsMinimized,
        setDomain,
        selectConversation,
        createConversation,
        deleteConversation,
        requestAIConfirmation,
        cancelConfirmation,
        confirmAndSend,
        sendDirectMessage,
        applyDraftAction,
        dismissDraftAction,
        applyAllDrafts,
        clearDrafts,
        getSuggestedTabForAction,
      }}
    >
      {children}
    </AIContext.Provider>
  );
}

export function useAI() {
  const ctx = useContext(AIContext);
  if (!ctx) throw new Error('useAI must be used inside AIProvider');
  return ctx;
}
