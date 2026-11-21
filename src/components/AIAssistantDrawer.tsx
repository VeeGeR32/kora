import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  Loader2,
  Mic,
  MicOff,
  Plus,
  Send,
  Settings,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import type { AIDomain, ActiveTab } from '../types';
import { useApp } from '../context/AppContext';
import { useAI } from '../context/AIContext';
import { MarkdownView } from './ui/MarkdownView';

interface AIAssistantDrawerProps {
  onOpenSettings: () => void;
  onNavigate: (tab: ActiveTab) => void;
}

const DOMAIN_TABS: { id: AIDomain; label: string }[] = [
  { id: 'general', label: 'Général' },
  { id: 'cours', label: 'Cours' },
  { id: 'sport', label: 'Sport' },
  { id: 'music', label: 'Music' },
];

const SUGGESTIONS_BY_DOMAIN: Record<AIDomain, string[]> = {
  general: [
    'Organise ma journée en plaçant mes devoirs et révisions dans les créneaux libres',
    'Fais un résumé de ce qui est prioritaire aujourd’hui',
  ],
  cours: [
    'Crée un plan de révision pour mon prochain DS dans le Planning',
    'Planifie des créneaux pour tous mes devoirs à faire',
  ],
  sport: [
    'Crée une routine gym adaptée à mon objectif et planifie-la',
    'Estime et log un repas : 200g poulet, 120g riz basmati et 1 banane',
  ],
  music: [
    'Planifie une session d’écriture Music ce soir dans mon Planning',
    'Propose une checklist pour finir mon EP Minuit',
  ],
};

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export function AIAssistantDrawer({ onOpenSettings, onNavigate }: AIAssistantDrawerProps) {
  const { state, notify } = useApp();
  const {
    isOpen,
    isMinimized,
    activeDomain,
    conversations,
    activeConversation,
    loading,
    pendingConfirmation,
    draftActions,
    closeAI,
    setMinimized,
    setDomain,
    selectConversation,
    createConversation,
    deleteConversation,
    cancelConfirmation,
    confirmAndSend,
    sendDirectMessage,
    applyDraftAction,
    dismissDraftAction,
    applyAllDrafts,
    clearDrafts,
    getSuggestedTabForAction,
  } = useAI();

  const [input, setInput] = useState('');
  const [confirmDraftText, setConfirmDraftText] = useState('');
  const [listening, setListening] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    if (pendingConfirmation) {
      setConfirmDraftText(pendingConfirmation.prompt);
    }
  }, [pendingConfirmation]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConversation?.messages.length, loading, pendingConfirmation]);

  // Stop speech recognition on unmount or close
  useEffect(() => {
    if (!isOpen && listening) {
      recognitionRef.current?.stop();
      setListening(false);
    }
  }, [isOpen, listening]);

  const toggleVoiceInput = () => {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    const SpeechRec =
      (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;

    if (!SpeechRec) {
      notify('Reconnaissance vocale non supportée sur ce navigateur (utilise Chrome / Edge / Safari)');
      return;
    }

    try {
      const rec = new SpeechRec();
      rec.lang = 'fr-FR';
      rec.continuous = false;
      rec.interimResults = true;
      const baseInput = input ? `${input.trim()} ` : '';

      rec.onresult = (ev) => {
        let transcript = '';
        for (let i = 0; i < ev.results.length; i++) {
          transcript += ev.results[i][0].transcript;
        }
        setInput(baseInput + transcript);
      };
      rec.onerror = () => {
        setListening(false);
      };
      rec.onend = () => {
        setListening(false);
      };

      recognitionRef.current = rec;
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
      notify('Impossible de démarrer le micro');
    }
  };

  const domainConversations = conversations.filter((c) => c.domain === activeDomain);
  const hasApiKey = Boolean(
    state.preferences.geminiApiKey?.trim() || import.meta.env.VITE_GEMINI_API_KEY
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
    }
    const text = input.trim();
    setInput('');
    void sendDirectMessage(text);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        /* Floating NON-BLOCKING overlay: no backdrop, pointer-events-none wrapper */
        <div className="pointer-events-none fixed inset-x-3 bottom-[76px] md:inset-x-auto md:bottom-5 md:right-5 z-40 flex justify-end">
          <motion.section
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className={`pointer-events-auto w-full md:w-[410px] rounded-3xl bg-white/96 dark:bg-[#121216]/96 backdrop-blur-xl border border-slate-200/90 dark:border-zinc-800 shadow-[0_18px_50px_-12px_rgba(15,23,42,0.28)] dark:shadow-[0_24px_60px_-12px_rgba(0,0,0,0.75)] flex flex-col overflow-hidden transition-all ${
              isMinimized ? 'max-h-[60px]' : 'h-[72dvh] max-h-[640px]'
            }`}
          >
            {/* Header */}
            <div className="px-4 py-3 border-b border-slate-100 dark:border-zinc-800/80 flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="h-7 w-7 rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white flex items-center justify-center shrink-0">
                  <Sparkles size={14} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h2 className="text-xs font-semibold">Kora AI</h2>
                    {draftActions.length > 0 && (
                      <span className="rounded-full bg-violet-600 text-white px-1.5 py-0.5 font-mono text-[9px] font-semibold">
                        {draftActions.length} aperçu
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400 truncate">
                    {hasApiKey ? 'Gemini connecté · Non-bloquant' : 'Mode local · Clé Gemini dans Paramètres'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setMinimized(!isMinimized)}
                  title={isMinimized ? 'Agrandir' : 'Réduire pour voir l’app'}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 dark:hover:text-zinc-200 cursor-pointer"
                >
                  {isMinimized ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                </button>
                <button
                  type="button"
                  onClick={onOpenSettings}
                  title="Configurer API Gemini"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 dark:hover:text-zinc-200 cursor-pointer"
                >
                  <Settings size={14} />
                </button>
                <button
                  type="button"
                  onClick={closeAI}
                  title="Fermer"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 dark:hover:text-zinc-200 cursor-pointer"
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            {!isMinimized && (
              <>
                {/* Domain Selector + Multi-Conversation Switcher */}
                <div className="px-3.5 pt-2.5 pb-2 border-b border-slate-100 dark:border-zinc-800/70 space-y-2 shrink-0 bg-slate-50/50 dark:bg-zinc-900/35">
                  <div className="grid grid-cols-4 gap-1">
                    {DOMAIN_TABS.map((d) => {
                      const active = activeDomain === d.id;
                      return (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => setDomain(d.id)}
                          className={`rounded-xl py-1 text-[11px] font-medium transition cursor-pointer ${
                            active
                              ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                              : 'text-slate-500 dark:text-zinc-400 hover:bg-slate-200/60 dark:hover:bg-zinc-800'
                          }`}
                        >
                          {d.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Conversation Picker inside active domain */}
                  <div className="flex items-center gap-1.5">
                    <select
                      value={activeConversation?.id || ''}
                      onChange={(e) => selectConversation(e.target.value)}
                      className="flex-1 min-w-0 rounded-xl border border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-zinc-200 outline-none truncate cursor-pointer"
                    >
                      {domainConversations.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title} ({Math.max(0, c.messages.length - 1)} msg)
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => createConversation(activeDomain)}
                      title="Nouvelle conversation dans ce domaine"
                      className="h-7 px-2 rounded-xl bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 text-slate-600 dark:text-zinc-300 hover:border-violet-400 inline-flex items-center gap-1 text-[11px] font-medium cursor-pointer shrink-0"
                    >
                      <Plus size={12} /> Conv
                    </button>
                    {domainConversations.length > 1 && activeConversation && (
                      <button
                        type="button"
                        onClick={() => deleteConversation(activeConversation.id)}
                        title="Supprimer cette conversation"
                        className="h-7 w-7 rounded-xl text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center justify-center cursor-pointer shrink-0"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Confirmation Card BEFORE Sending App-Triggered AI Action */}
                <AnimatePresence>
                  {pendingConfirmation && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="px-3.5 py-3 bg-violet-50/90 dark:bg-violet-950/40 border-b border-violet-200 dark:border-violet-800/70 space-y-2 shrink-0"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-violet-800 dark:text-violet-200 flex items-center gap-1.5">
                          <Sparkles size={12} /> Confirmer l’envoi à Kora AI ?
                        </span>
                        <button
                          type="button"
                          onClick={cancelConfirmation}
                          className="text-violet-500 hover:text-violet-800 cursor-pointer"
                        >
                          <X size={13} />
                        </button>
                      </div>
                      <textarea
                        rows={3}
                        value={confirmDraftText}
                        onChange={(e) => setConfirmDraftText(e.target.value)}
                        className="w-full rounded-xl border border-violet-200 dark:border-violet-800 bg-white dark:bg-zinc-900 px-2.5 py-2 text-xs text-slate-800 dark:text-zinc-100 outline-none focus:border-violet-500 resize-none"
                      />
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={cancelConfirmation}
                          className="rounded-xl px-3 py-1.5 text-[11px] font-medium text-slate-500 hover:text-slate-800 dark:hover:text-zinc-200 cursor-pointer"
                        >
                          Annuler
                        </button>
                        <button
                          type="button"
                          onClick={() => void confirmAndSend(confirmDraftText)}
                          className="rounded-xl bg-violet-600 text-white px-3.5 py-1.5 text-[11px] font-semibold hover:bg-violet-700 inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Send size={11} /> Confirmer & Envoyer
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Messages Stream */}
                <div className="flex-1 overflow-y-auto px-3.5 py-3 space-y-3">
                  {activeConversation?.messages.map((m) => {
                    const pendingForMsg = draftActions.filter((d) => d.messageId === m.id);
                    return (
                      <div
                        key={m.id}
                        className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}
                      >
                        <div
                          className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 ${
                            m.role === 'user'
                              ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 text-xs leading-relaxed whitespace-pre-wrap'
                              : 'bg-slate-100/90 dark:bg-zinc-900 border border-slate-200/70 dark:border-zinc-800 text-slate-800 dark:text-zinc-200'
                          }`}
                        >
                          {m.role === 'assistant' ? <MarkdownView content={m.text} /> : m.text}
                        </div>

                        {/* Live Preview Actions Linked to This Message */}
                        {pendingForMsg.length > 0 && (
                          <div className="mt-2 w-[94%] rounded-2xl border border-dashed border-violet-400 dark:border-violet-600 bg-violet-50/75 dark:bg-violet-950/30 p-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-violet-700 dark:text-violet-300 flex items-center gap-1">
                                <Wand2 size={11} /> En aperçu sur l’app ({pendingForMsg.length})
                              </span>
                            </div>

                            <div className="space-y-1.5">
                              {pendingForMsg.map((item) => (
                                <div
                                  key={item.id}
                                  className="flex items-center justify-between gap-1.5 rounded-xl bg-white/90 dark:bg-zinc-900/90 border border-violet-200/70 dark:border-violet-900/60 px-2.5 py-1.5"
                                >
                                  <button
                                    type="button"
                                    onClick={() => onNavigate(getSuggestedTabForAction(item.action))}
                                    title="Voir l’aperçu dans l’app"
                                    className="flex-1 text-left text-[11px] text-slate-700 dark:text-zinc-200 hover:text-violet-600 dark:hover:text-violet-300 flex items-center gap-1.5 min-w-0 cursor-pointer"
                                  >
                                    <Eye size={11} className="text-violet-500 shrink-0" />
                                    <span className="truncate">{item.action.summary}</span>
                                  </button>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => applyDraftAction(item.id)}
                                      title="Appliquer cette modification"
                                      className="h-6 w-6 rounded-lg bg-emerald-600 text-white flex items-center justify-center hover:bg-emerald-700 cursor-pointer"
                                    >
                                      <Check size={11} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => dismissDraftAction(item.id)}
                                      title="Retirer"
                                      className="h-6 w-6 rounded-lg bg-slate-100 dark:bg-zinc-800 text-slate-500 hover:text-rose-500 flex items-center justify-center cursor-pointer"
                                    >
                                      <X size={11} />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>

                            <div className="flex items-center gap-1.5 pt-0.5">
                              <button
                                type="button"
                                onClick={applyAllDrafts}
                                className="flex-1 rounded-xl bg-violet-600 text-white py-1.5 text-[11px] font-semibold hover:bg-violet-700 cursor-pointer"
                              >
                                Tout appliquer
                              </button>
                              <button
                                type="button"
                                onClick={clearDrafts}
                                className="rounded-xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 px-3 py-1.5 text-[11px] font-medium text-slate-500 cursor-pointer"
                              >
                                Annuler
                              </button>
                            </div>
                          </div>
                        )}

                        {m.actions && m.actions.length > 0 && pendingForMsg.length === 0 && m.applied && (
                          <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 px-1">
                            <Check size={10} /> Modifications appliquées dans Kora
                          </span>
                        )}
                      </div>
                    );
                  })}

                  {loading && (
                    <div className="flex items-center gap-2 text-xs text-slate-400 px-1">
                      <Loader2 size={14} className="animate-spin text-violet-500" />
                      Kora AI prépare l’aperçu…
                    </div>
                  )}

                  {activeConversation && activeConversation.messages.length <= 1 && !loading && (
                    <div className="space-y-1.5 pt-1">
                      {SUGGESTIONS_BY_DOMAIN[activeDomain].map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => void sendDirectMessage(s)}
                          className="w-full text-left rounded-xl border border-slate-200/80 dark:border-zinc-800 px-3 py-2 text-[11px] text-slate-600 dark:text-zinc-300 hover:border-violet-400 transition cursor-pointer"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                  <div ref={bottomRef} />
                </div>

                {/* Input + Speech-to-Text Micro */}
                <form
                  onSubmit={handleSubmit}
                  className="p-3 border-t border-slate-100 dark:border-zinc-800/80 flex items-center gap-1.5 shrink-0"
                >
                  <button
                    type="button"
                    onClick={toggleVoiceInput}
                    title={listening ? 'Arrêter la dictée vocale' : 'Dictée vocale (Speech-to-Text)'}
                    className={`h-9 w-9 rounded-xl flex items-center justify-center transition cursor-pointer shrink-0 ${
                      listening
                        ? 'bg-rose-500 text-white animate-pulse'
                        : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-700'
                    }`}
                  >
                    {listening ? <MicOff size={15} /> : <Mic size={15} />}
                  </button>
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={listening ? 'Écoute en cours… parle maintenant' : 'Écris ou dicte à Kora AI…'}
                    className="flex-1 rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs outline-none focus:border-violet-500 min-w-0"
                  />
                  <button
                    type="submit"
                    disabled={!input.trim() || loading}
                    className="h-9 w-9 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 flex items-center justify-center disabled:opacity-35 cursor-pointer shrink-0"
                  >
                    <Send size={14} />
                  </button>
                </form>
              </>
            )}
          </motion.section>
        </div>
      )}
    </AnimatePresence>
  );
}
