import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  ImagePlus,
  KeyRound,
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
import {
  sanitizeGeminiApiKey,
  testGeminiApiKey,
  type AIImageAttachment,
} from '../lib/koraAi';
import { uid } from '../utils/dates';
import { MarkdownView } from './ui/MarkdownView';

interface AIAssistantDrawerProps {
  onNavigate: (tab: ActiveTab) => void;
}

const DOMAIN_OPTIONS: { id: AIDomain; label: string }[] = [
  { id: 'general', label: 'Général' },
  { id: 'cours', label: 'Cours' },
  { id: 'sport', label: 'Sport' },
  { id: 'music', label: 'Music' },
];

const SUGGESTIONS_BY_DOMAIN: Record<AIDomain, string[]> = {
  general: [
    'Organise ma journée en plaçant mes devoirs dans mes créneaux libres',
    'Résume mes priorités aujourd’hui',
  ],
  cours: [
    'Crée un plan de révision pour mon prochain DS',
    'Planifie des créneaux pour mes devoirs à rendre',
  ],
  sport: [
    'Crée une routine gym adaptée à mon objectif',
    'Estime les macros de mon repas (ou envoie une photo)',
  ],
  music: [
    'Planifie une session d’écriture ce soir dans mon Planning',
    'Propose une checklist pour avancer sur mon projet',
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

async function prepareImageAttachment(file: File): Promise<AIImageAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 1280;
        const scale = Math.min(maxDim / img.width, maxDim / img.height, 1);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        const mimeType = 'image/jpeg';
        const dataUrl = canvas.toDataURL(mimeType, 0.85);
        const base64 = dataUrl.split(',')[1] || '';
        resolve({
          id: uid('img'),
          name: file.name || 'image.jpg',
          mimeType,
          dataUrl,
          base64,
        });
      };
      img.onerror = reject;
      img.src = String(reader.result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function AIAssistantDrawer({ onNavigate }: AIAssistantDrawerProps) {
  const { state, updatePreferences, notify } = useApp();
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
  const [attachments, setAttachments] = useState<AIImageAttachment[]>([]);
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [confirmDraftText, setConfirmDraftText] = useState('');
  const [listening, setListening] = useState(false);

  // Integrated AI Settings panel (Gemini API Key)
  const [showAiSettings, setShowAiSettings] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState(state.preferences.geminiApiKey || '');
  const [showKey, setShowKey] = useState(false);
  const [testingKey, setTestingKey] = useState(false);
  const [keyStatus, setKeyStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    if (showAiSettings) {
      setApiKeyDraft(state.preferences.geminiApiKey || '');
      setKeyStatus(null);
    }
  }, [showAiSettings, state.preferences.geminiApiKey]);

  useEffect(() => {
    if (pendingConfirmation) {
      setConfirmDraftText(pendingConfirmation.prompt);
    }
  }, [pendingConfirmation]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConversation?.messages.length, loading, pendingConfirmation]);

  // Auto-resize composer textarea cleanly
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(140, Math.max(42, el.scrollHeight))}px`;
  }, [input]);

  useEffect(() => {
    if (!isOpen && listening) {
      recognitionRef.current?.stop();
      setListening(false);
    }
  }, [isOpen, listening]);

  const addImagesFromFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (list.length === 0) return;
    const remainingSlots = Math.max(0, 4 - attachments.length);
    if (remainingSlots === 0) {
      notify('Maximum 4 images par message');
      return;
    }
    try {
      const prepared = await Promise.all(list.slice(0, remainingSlots).map(prepareImageAttachment));
      setAttachments((prev) => [...prev, ...prepared]);
    } catch {
      notify('Impossible de lire cette image');
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const f = items[i].getAsFile();
        if (f) imageFiles.push(f);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      void addImagesFromFiles(imageFiles);
    }
  };

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
      notify('Dictée vocale non supportée sur ce navigateur');
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
      rec.onerror = () => setListening(false);
      rec.onend = () => setListening(false);

      recognitionRef.current = rec;
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
      notify('Impossible de démarrer le micro');
    }
  };

  const handleSaveApiKey = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = apiKeyDraft.trim() ? sanitizeGeminiApiKey(apiKeyDraft) : '';
    setApiKeyDraft(cleaned);
    updatePreferences({ geminiApiKey: cleaned || undefined });
    notify(cleaned ? 'Clé API Gemini enregistrée ✓' : 'Clé API Gemini retirée');
    setShowAiSettings(false);
  };

  const handleTestApiKey = async () => {
    setTestingKey(true);
    setKeyStatus(null);
    const cleaned = sanitizeGeminiApiKey(apiKeyDraft);
    if (cleaned !== apiKeyDraft) setApiKeyDraft(cleaned);
    const res = await testGeminiApiKey(cleaned);
    setKeyStatus({ ok: res.ok, text: res.message });
    setTestingKey(false);
  };

  const domainConversations = conversations.filter((c) => c.domain === activeDomain);
  const hasApiKey = Boolean(
    state.preferences.geminiApiKey?.trim() || import.meta.env.VITE_GEMINI_API_KEY
  );
  const canSend = (Boolean(input.trim()) || attachments.length > 0) && !loading;

  const triggerSend = () => {
    if (!canSend) return;
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
    }
    const text = input.trim();
    const imgs = attachments;
    setInput('');
    setAttachments([]);
    if (textareaRef.current) textareaRef.current.style.height = '42px';
    void sendDirectMessage(text, imgs.length > 0 ? imgs : undefined);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      triggerSend();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        /* Non-blocking floating AI studio panel */
        <div className="pointer-events-none fixed inset-x-2.5 bottom-[74px] md:inset-x-auto md:bottom-5 md:right-5 z-40 flex justify-end">
          <motion.section
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 440, damping: 34 }}
            className={`pointer-events-auto w-full md:w-[440px] rounded-2xl bg-white dark:bg-[#111114] border border-slate-200/90 dark:border-zinc-800 shadow-[0_24px_64px_-16px_rgba(15,23,42,0.26)] dark:shadow-[0_28px_72px_-12px_rgba(0,0,0,0.85)] flex flex-col overflow-hidden transition-all ${
              isMinimized ? 'max-h-[54px]' : 'h-[76dvh] max-h-[680px]'
            }`}
          >
            {/* Minimal Pro Header */}
            <div className="px-3.5 h-[52px] border-b border-slate-100 dark:border-zinc-800/80 flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <div className="h-7 w-7 rounded-lg bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 flex items-center justify-center shrink-0">
                  <Sparkles size={13} />
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-semibold tracking-tight text-slate-900 dark:text-zinc-100">
                    Kora AI
                  </span>
                  <span
                    title={hasApiKey ? 'Gemini connecté' : 'Clé API non configurée'}
                    className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                      hasApiKey ? 'bg-emerald-500' : 'bg-amber-400'
                    }`}
                  />
                  {draftActions.length > 0 && (
                    <span className="rounded-md bg-violet-500/12 text-violet-700 dark:text-violet-300 px-1.5 py-0.5 font-mono text-[10px] font-semibold">
                      {draftActions.length} aperçu
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  type="button"
                  onClick={() => createConversation(activeDomain)}
                  title="Nouvelle conversation"
                  className="h-7 w-7 rounded-lg text-slate-400 hover:text-slate-800 dark:hover:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-800/70 flex items-center justify-center transition cursor-pointer"
                >
                  <Plus size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => setShowAiSettings((v) => !v)}
                  title="Réglages API Gemini"
                  className={`h-7 w-7 rounded-lg flex items-center justify-center transition cursor-pointer ${
                    showAiSettings
                      ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                      : 'text-slate-400 hover:text-slate-800 dark:hover:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-800/70'
                  }`}
                >
                  <Settings size={13.5} />
                </button>
                <button
                  type="button"
                  onClick={() => setMinimized(!isMinimized)}
                  title={isMinimized ? 'Agrandir' : 'Réduire'}
                  className="h-7 w-7 rounded-lg text-slate-400 hover:text-slate-800 dark:hover:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-800/70 flex items-center justify-center transition cursor-pointer"
                >
                  {isMinimized ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                <button
                  type="button"
                  onClick={closeAI}
                  title="Fermer"
                  className="h-7 w-7 rounded-lg text-slate-400 hover:text-slate-800 dark:hover:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-800/70 flex items-center justify-center transition cursor-pointer"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {!isMinimized && (
              <>
                {/* Integrated AI Settings Drawer (Gemini API Key) */}
                <AnimatePresence>
                  {showAiSettings && (
                    <motion.form
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      onSubmit={handleSaveApiKey}
                      className="px-4 py-3.5 border-b border-slate-100 dark:border-zinc-800 bg-slate-50/80 dark:bg-zinc-900/60 space-y-2.5 shrink-0 overflow-hidden"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-slate-800 dark:text-zinc-100 flex items-center gap-1.5">
                          <KeyRound size={12} className="text-violet-500" />
                          Clé API Gemini
                        </span>
                        <button
                          type="button"
                          disabled={testingKey || !apiKeyDraft.trim()}
                          onClick={() => void handleTestApiKey()}
                          className="text-[11px] font-medium text-violet-600 dark:text-violet-400 hover:underline disabled:opacity-40 cursor-pointer"
                        >
                          {testingKey ? 'Test…' : 'Tester la clé'}
                        </button>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <input
                          type={showKey ? 'text' : 'password'}
                          value={apiKeyDraft}
                          onChange={(e) => {
                            setApiKeyDraft(e.target.value);
                            setKeyStatus(null);
                          }}
                          placeholder="AQ.... ou AIza... (aistudio.google.com/apikey)"
                          className="flex-1 min-w-0 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 font-mono text-xs text-slate-900 dark:text-zinc-100 outline-none focus:border-slate-400 dark:focus:border-zinc-500"
                        />
                        <button
                          type="button"
                          onClick={() => setShowKey((v) => !v)}
                          className="h-8 w-8 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 flex items-center justify-center text-slate-500 cursor-pointer shrink-0"
                        >
                          {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                        </button>
                        {apiKeyDraft && (
                          <button
                            type="button"
                            onClick={() => {
                              setApiKeyDraft('');
                              setKeyStatus(null);
                            }}
                            className="h-8 w-8 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 flex items-center justify-center text-slate-400 hover:text-rose-500 cursor-pointer shrink-0"
                          >
                            <X size={13} />
                          </button>
                        )}
                      </div>

                      {keyStatus && (
                        <p
                          className={`text-[11px] leading-relaxed ${
                            keyStatus.ok
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {keyStatus.text}
                        </p>
                      )}

                      <div className="flex items-center justify-between pt-0.5">
                        <span className="text-[10px] text-slate-400">
                          Synchronisée sur ton compte
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setShowAiSettings(false)}
                            className="rounded-lg px-2.5 py-1.5 text-[11px] text-slate-500 hover:text-slate-800 dark:hover:text-zinc-200 cursor-pointer"
                          >
                            Fermer
                          </button>
                          <button
                            type="submit"
                            className="rounded-lg bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-3 py-1.5 text-[11px] font-semibold cursor-pointer"
                          >
                            Enregistrer
                          </button>
                        </div>
                      </div>
                    </motion.form>
                  )}
                </AnimatePresence>

                {/* Sleek Conversation History Bar */}
                <div className="px-3.5 py-2 border-b border-slate-100 dark:border-zinc-800/70 flex items-center gap-1.5 shrink-0">
                  <select
                    value={activeConversation?.id || ''}
                    onChange={(e) => selectConversation(e.target.value)}
                    className="flex-1 min-w-0 bg-transparent text-[11px] font-medium text-slate-600 dark:text-zinc-300 outline-none truncate cursor-pointer"
                  >
                    {domainConversations.map((c) => (
                      <option
                        key={c.id}
                        value={c.id}
                        className="bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100"
                      >
                        {c.title} ({Math.max(0, c.messages.length - 1)})
                      </option>
                    ))}
                  </select>
                  {!hasApiKey && !showAiSettings && (
                    <button
                      type="button"
                      onClick={() => setShowAiSettings(true)}
                      className="rounded-md bg-amber-500/12 text-amber-700 dark:text-amber-300 px-2 py-0.5 text-[10px] font-medium cursor-pointer shrink-0"
                    >
                      Ajouter clé API
                    </button>
                  )}
                  {domainConversations.length > 1 && activeConversation && (
                    <button
                      type="button"
                      onClick={() => deleteConversation(activeConversation.id)}
                      title="Supprimer cette conversation"
                      className="h-6 w-6 rounded-md text-slate-400 hover:text-rose-500 flex items-center justify-center cursor-pointer shrink-0"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>

                {/* Confirmation Card BEFORE Sending App-Triggered AI Action */}
                <AnimatePresence>
                  {pendingConfirmation && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="px-4 py-3 bg-slate-50 dark:bg-zinc-900/80 border-b border-slate-200/80 dark:border-zinc-800 space-y-2 shrink-0"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-slate-800 dark:text-zinc-100 flex items-center gap-1.5">
                          <Sparkles size={12} className="text-violet-500" /> Confirmer le prompt
                        </span>
                        <button
                          type="button"
                          onClick={cancelConfirmation}
                          className="text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer"
                        >
                          <X size={13} />
                        </button>
                      </div>
                      <textarea
                        rows={3}
                        value={confirmDraftText}
                        onChange={(e) => setConfirmDraftText(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-xs text-slate-800 dark:text-zinc-100 outline-none focus:border-slate-400 resize-none"
                      />
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={cancelConfirmation}
                          className="rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-slate-500 hover:text-slate-800 dark:hover:text-zinc-200 cursor-pointer"
                        >
                          Annuler
                        </button>
                        <button
                          type="button"
                          onClick={() => void confirmAndSend(confirmDraftText)}
                          className="rounded-lg bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-3 py-1.5 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Send size={11} /> Envoyer
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Pro Editorial Messages Stream */}
                <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                  {activeConversation?.messages.map((m) => {
                    const pendingForMsg = draftActions.filter((d) => d.messageId === m.id);
                    const isUser = m.role === 'user';
                    return (
                      <div key={m.id} className="space-y-2">
                        {isUser ? (
                          <div className="rounded-2xl bg-slate-100/90 dark:bg-zinc-800/80 border border-slate-200/60 dark:border-zinc-700/50 px-3.5 py-2.5 space-y-2">
                            {m.images && m.images.length > 0 && (
                              <div className="flex flex-wrap gap-1.5">
                                {m.images.map((img) => (
                                  <img
                                    key={img.id}
                                    src={img.dataUrl}
                                    alt={img.name}
                                    className="h-16 w-16 rounded-xl object-cover border border-slate-200/80 dark:border-zinc-700"
                                  />
                                ))}
                              </div>
                            )}
                            {m.text && (
                              <p className="text-[13px] leading-relaxed text-slate-900 dark:text-zinc-100 whitespace-pre-wrap">
                                {m.text}
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="px-0.5 text-[13px] text-slate-800 dark:text-zinc-200">
                            <MarkdownView content={m.text} />
                          </div>
                        )}

                        {/* Live Preview Actions Linked to This Message */}
                        {pendingForMsg.length > 0 && (
                          <div className="rounded-2xl border border-dashed border-violet-400/80 dark:border-violet-600/70 bg-violet-50/50 dark:bg-violet-950/25 p-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-violet-700 dark:text-violet-300 flex items-center gap-1.5">
                                <Wand2 size={11} /> Aperçu en direct ({pendingForMsg.length})
                              </span>
                            </div>

                            <div className="space-y-1.5">
                              {pendingForMsg.map((item) => (
                                <div
                                  key={item.id}
                                  className="flex items-center justify-between gap-2 rounded-xl bg-white dark:bg-zinc-900/90 border border-slate-200/80 dark:border-zinc-800 px-2.5 py-1.5"
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
                                      title="Appliquer"
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
                                className="flex-1 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 py-1.5 text-[11px] font-semibold cursor-pointer"
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
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                            <Check size={10} /> Modifications appliquées
                          </span>
                        )}
                      </div>
                    );
                  })}

                  {loading && (
                    <div className="flex items-center gap-2 text-xs text-slate-400 py-1">
                      <Loader2 size={14} className="animate-spin text-slate-500 dark:text-zinc-400" />
                      Réflexion en cours…
                    </div>
                  )}

                  {activeConversation && activeConversation.messages.length <= 1 && !loading && (
                    <div className="space-y-1.5 pt-1">
                      {SUGGESTIONS_BY_DOMAIN[activeDomain].map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => void sendDirectMessage(s)}
                          className="w-full text-left rounded-xl border border-slate-200/80 dark:border-zinc-800 px-3 py-2 text-[11px] text-slate-600 dark:text-zinc-400 hover:border-slate-400 dark:hover:border-zinc-600 hover:text-slate-900 dark:hover:text-zinc-100 transition cursor-pointer"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                  <div ref={bottomRef} />
                </div>

                {/* Antigravity-Style Unified Composer (Images + Multi-line Text + Bottom Toolbar) */}
                <div className="p-3 pt-1 shrink-0">
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDraggingImage(true);
                    }}
                    onDragLeave={() => setIsDraggingImage(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDraggingImage(false);
                      if (e.dataTransfer.files.length > 0) {
                        void addImagesFromFiles(e.dataTransfer.files);
                      }
                    }}
                    className={`rounded-2xl border transition-all bg-slate-50/70 dark:bg-[#18181d] focus-within:bg-white dark:focus-within:bg-[#1a1a20] ${
                      isDraggingImage
                        ? 'border-violet-500 ring-2 ring-violet-500/20'
                        : 'border-slate-200/90 dark:border-zinc-700/80 focus-within:border-slate-400 dark:focus-within:border-zinc-500'
                    }`}
                  >
                    {/* Queued Image Previews Strip (Top of Composer) */}
                    {attachments.length > 0 && (
                      <div className="px-3 pt-2.5 pb-1.5 flex flex-wrap gap-2 border-b border-slate-200/60 dark:border-zinc-800/80">
                        {attachments.map((img) => (
                          <div key={img.id} className="relative group">
                            <img
                              src={img.dataUrl}
                              alt={img.name}
                              className="h-12 w-12 rounded-xl object-cover border border-slate-200 dark:border-zinc-700 shadow-2xs"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setAttachments((prev) => prev.filter((item) => item.id !== img.id))
                              }
                              title="Retirer l’image"
                              className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 flex items-center justify-center shadow cursor-pointer"
                            >
                              <X size={10} strokeWidth={2.5} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Multi-line Auto-Growing Textarea */}
                    <textarea
                      ref={textareaRef}
                      rows={1}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      onPaste={handlePaste}
                      placeholder={
                        listening
                          ? 'Écoute en cours… parle maintenant'
                          : attachments.length > 0
                          ? 'Ajoute une consigne avec ton image…'
                          : 'Demande à Kora AI ou colle une image…'
                      }
                      className="w-full resize-none bg-transparent px-3.5 pt-3 pb-1.5 text-[13px] leading-relaxed text-slate-900 dark:text-zinc-100 placeholder:text-slate-400 dark:placeholder:text-zinc-500 outline-none max-h-[140px]"
                    />

                    {/* Bottom Internal Toolbar (Antigravity Style) */}
                    <div className="px-2.5 pb-2 pt-1 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1 min-w-0">
                        {/* + Attach Image */}
                        <button
                          type="button"
                          onClick={() => imageInputRef.current?.click()}
                          title="Joindre une image (ou Ctrl+V)"
                          className="h-7 w-7 rounded-lg text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100 hover:bg-slate-200/70 dark:hover:bg-zinc-800 flex items-center justify-center transition cursor-pointer shrink-0"
                        >
                          {attachments.length > 0 ? <ImagePlus size={14} /> : <Plus size={15} />}
                        </button>
                        <input
                          ref={imageInputRef}
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={(e) => {
                            if (e.target.files) void addImagesFromFiles(e.target.files);
                            e.target.value = '';
                          }}
                          className="hidden"
                        />

                        {/* Compact Domain Pill Selector */}
                        <div className="relative flex items-center">
                          <select
                            value={activeDomain}
                            onChange={(e) => setDomain(e.target.value as AIDomain)}
                            aria-label="Domaine IA"
                            className="appearance-none rounded-lg bg-transparent hover:bg-slate-200/60 dark:hover:bg-zinc-800 pl-2 pr-5 py-1 text-[11px] font-medium text-slate-600 dark:text-zinc-300 outline-none cursor-pointer transition"
                          >
                            {DOMAIN_OPTIONS.map((d) => (
                              <option
                                key={d.id}
                                value={d.id}
                                className="bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100"
                              >
                                {d.label}
                              </option>
                            ))}
                          </select>
                          <ChevronDown
                            size={11}
                            className="pointer-events-none absolute right-1.5 text-slate-400"
                          />
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {/* Voice Dictation */}
                        <button
                          type="button"
                          onClick={toggleVoiceInput}
                          title={listening ? 'Arrêter la dictée' : 'Dictée vocale'}
                          className={`h-7 w-7 rounded-lg flex items-center justify-center transition cursor-pointer ${
                            listening
                              ? 'bg-rose-500 text-white animate-pulse'
                              : 'text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100 hover:bg-slate-200/70 dark:hover:bg-zinc-800'
                          }`}
                        >
                          {listening ? <MicOff size={14} /> : <Mic size={14} />}
                        </button>

                        {/* Circular Primary Send Button */}
                        <button
                          type="button"
                          disabled={!canSend}
                          onClick={triggerSend}
                          title="Envoyer (Entrée)"
                          className="h-7 w-7 rounded-full bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 flex items-center justify-center hover:opacity-90 disabled:opacity-25 transition cursor-pointer"
                        >
                          {loading ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <ArrowRight size={14} strokeWidth={2.3} />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </motion.section>
        </div>
      )}
    </AnimatePresence>
  );
}
