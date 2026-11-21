import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Award,
  BookOpen,
  Briefcase,
  Check,
  Clock,
  ExternalLink,
  Eye,
  EyeOff,
  FileImage,
  FileText,
  FolderOpen,
  KeyRound,
  Link2,
  MapPin,
  Plus,
  RefreshCw,
  Save,
  Server,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { AIDomain, CourseDocument } from '../types';
import { useApp } from '../context/AppContext';
import { useAI } from '../context/AIContext';
import { formatCountdownBadge, formatShortDateFR, todayISO, uid } from '../utils/dates';
import { PRIORITY_STYLES } from '../utils/theme';
import { formatBytes, getMediaObjectUrl } from '../lib/mediaDb';
import { extractPronoteSummaryFromEvents, parseICSFile } from '../lib/icsParser';
import { CheckCircle } from './ui/CheckCircle';
import type { QuickAddContext } from './QuickAddModal';

interface StudiesViewProps {
  onOpenQuickAdd: (ctx?: QuickAddContext) => void;
  onRequestAI?: (prompt: string, domain?: AIDomain) => void;
}

type StudiesSubTab = 'exams' | 'cursus' | 'docs' | 'pronote';

export function StudiesView({ onOpenQuickAdd, onRequestAI }: StudiesViewProps) {
  const {
    state,
    lastCloudSyncAt,
    toggleHomework,
    deleteHomework,
    updateExam,
    toggleExamTopic,
    addExamTopic,
    deleteExamTopic,
    deleteExam,
    updateAcademicProfile,
    addSubject,
    deleteSubject,
    addGrade,
    addManyGrades,
    deleteGrade,
    addCourseDoc,
    deleteCourseDoc,
    addManyEvents,
    addHomework,
    updatePreferences,
    updateLastSession,
    saveAndOptionallySyncMedia,
    notify,
  } = useApp();
  const { draftActions, applyDraftAction, dismissDraftAction } = useAI();

  const [subTab, setSubTabState] = useState<StudiesSubTab>(
    () => state.preferences.lastSession?.studiesSubTab || 'exams'
  );
  const studiesCloudSyncedRef = useRef(false);

  const setSubTab = (next: StudiesSubTab) => {
    setSubTabState(next);
    updateLastSession({ studiesSubTab: next });
  };

  useEffect(() => {
    if (!lastCloudSyncAt || studiesCloudSyncedRef.current) return;
    studiesCloudSyncedRef.current = true;
    const saved = state.preferences.lastSession?.studiesSubTab;
    if (saved) setSubTabState(saved);
  }, [lastCloudSyncAt]);
  const [hwFilter, setHwFilter] = useState<'todo' | 'done' | 'all'>('todo');
  const [subjectFilter, setSubjectFilter] = useState<string>('all');
  const [topicInputs, setTopicInputs] = useState<Record<string, string>>({});
  const [editingUrlExamId, setEditingUrlExamId] = useState<string | null>(null);
  const [urlDraft, setUrlDraft] = useState('');
  const [titleDraft, setTitleDraft] = useState('');

  // Cursus & Grades state
  const [editingProfile, setEditingProfile] = useState(false);
  const [profDraft, setProfDraft] = useState(state.academicProfile);
  const [newSubName, setNewSubName] = useState('');
  const [newSubCoeff, setNewSubCoeff] = useState('2');
  const [gradeSub, setGradeSub] = useState(state.subjects[0]?.name || 'Maths');
  const [gradeTitle, setGradeTitle] = useState('');
  const [gradeScore, setGradeScore] = useState('');
  const gradeOutOf = '20';
  const gradeCoeff = '1';

  // Docs state
  const [docSubject, setDocSubject] = useState(state.subjects[0]?.name || 'Maths');
  const [docKind, setDocKind] = useState<CourseDocument['kind']>('cours-pdf');
  const [previewDoc, setPreviewDoc] = useState<{ title: string; url: string; mime: string } | null>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const icsInputRef = useRef<HTMLInputElement>(null);

  // Pronote bridge state (URL + Token + Health Test all integrated directly inside Cours → Pronote)
  const [bridgeUrl, setBridgeUrl] = useState(state.preferences.pronoteBridgeUrl || 'http://127.0.0.1:4789');
  const [bridgeToken, setBridgeToken] = useState(state.preferences.pronoteBridgeToken || '');
  const [showBridgeToken, setShowBridgeToken] = useState(false);
  const [testingBridge, setTestingBridge] = useState(false);
  const [bridgeStatus, setBridgeStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pronoteMode, setPronoteMode] = useState<'qr' | 'creds'>('qr');
  const [qrJson, setQrJson] = useState('');
  const [qrPin, setQrPin] = useState('');
  const [pnUrl, setPnUrl] = useState('');
  const [pnUser, setPnUser] = useState('');
  const [pnPass, setPnPass] = useState('');
  const [syncingPronote, setSyncingPronote] = useState(false);

  useEffect(() => {
    setBridgeUrl(state.preferences.pronoteBridgeUrl || 'http://127.0.0.1:4789');
    setBridgeToken(state.preferences.pronoteBridgeToken || '');
  }, [state.preferences.pronoteBridgeUrl, state.preferences.pronoteBridgeToken]);

  const subjects = useMemo(() => {
    const set = new Set<string>();
    state.subjects.forEach((s) => set.add(s.name));
    state.homework.forEach((h) => h.subject && set.add(h.subject));
    state.exams.forEach((e) => e.subject && set.add(e.subject));
    return Array.from(set).sort();
  }, [state.subjects, state.homework, state.exams]);

  const sortedExams = useMemo(() => {
    return [...state.exams]
      .filter((e) => subjectFilter === 'all' || e.subject === subjectFilter)
      .sort((a, b) => (a.done !== b.done ? (a.done ? 1 : -1) : a.date.localeCompare(b.date)));
  }, [state.exams, subjectFilter]);

  const filteredHomework = useMemo(() => {
    return [...state.homework]
      .filter((h) => {
        if (hwFilter === 'todo' && h.done) return false;
        if (hwFilter === 'done' && !h.done) return false;
        if (subjectFilter !== 'all' && h.subject !== subjectFilter) return false;
        return true;
      })
      .sort((a, b) => (a.done !== b.done ? (a.done ? 1 : -1) : a.dueDate.localeCompare(b.dueDate)));
  }, [state.homework, hwFilter, subjectFilter]);

  // Averages computation
  const { generalAvg, avgBySubject } = useMemo(() => {
    const map: Record<string, { sum: number; coef: number }> = {};
    for (const g of state.grades) {
      const normalized = (g.score / Math.max(1, g.outOf)) * 20;
      if (!map[g.subject]) map[g.subject] = { sum: 0, coef: 0 };
      map[g.subject].sum += normalized * g.coefficient;
      map[g.subject].coef += g.coefficient;
    }
    const perSub: Record<string, number> = {};
    let totalW = 0;
    let totalCoef = 0;
    for (const [sub, v] of Object.entries(map)) {
      const avg = v.coef > 0 ? v.sum / v.coef : 0;
      perSub[sub] = avg;
      const subObj = state.subjects.find((s) => s.name === sub);
      const subCoef = subObj?.coefficient || 1;
      totalW += avg * subCoef;
      totalCoef += subCoef;
    }
    return {
      generalAvg: totalCoef > 0 ? totalW / totalCoef : null,
      avgBySubject: perSub,
    };
  }, [state.grades, state.subjects]);

  const handleUploadCourseDocs = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      const mediaId = uid('doc');
      const saved = await saveAndOptionallySyncMedia(mediaId, file, file.name);
      const inferredKind: CourseDocument['kind'] = file.type.startsWith('image/')
        ? 'photo'
        : docKind;
      addCourseDoc({
        subject: docSubject || 'Général',
        title: file.name,
        kind: inferredKind,
        mimeType: file.type || 'application/pdf',
        sizeBytes: file.size,
        mediaId: saved.mediaId,
        cloudUrl: saved.cloudUrl,
        addedAt: new Date().toISOString(),
      });
    }
  };

  const handleOpenDoc = async (doc: CourseDocument) => {
    const url = (await getMediaObjectUrl(doc.mediaId)) || doc.cloudUrl;
    if (!url) {
      notify('Fichier introuvable sur cet appareil');
      return;
    }
    if (doc.mimeType.startsWith('image/')) {
      setPreviewDoc({ title: doc.title, url, mime: doc.mimeType });
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleImportICS = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    const parsed = parseICSFile(text);
    if (parsed.length === 0) {
      notify('Aucun cours trouvé dans ce fichier .ics');
      return;
    }
    addManyEvents(parsed);
    const summary = extractPronoteSummaryFromEvents(parsed);
    const existingNames = new Set(state.subjects.map((s) => s.name.toLowerCase()));
    summary.subjects.forEach((s) => {
      if (!existingNames.has(s.name.toLowerCase())) {
        addSubject({ name: s.name, coefficient: 1 });
      }
    });
  };

  const normalizeBridgeUrl = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/$/, '');
    return (/^(127\.0\.0\.1|localhost)/i.test(trimmed) ? `http://${trimmed}` : `https://${trimmed}`).replace(
      /\/$/,
      ''
    );
  };

  const handleSaveBridgeConfig = () => {
    const normalized = normalizeBridgeUrl(bridgeUrl);
    if (normalized) setBridgeUrl(normalized);
    updatePreferences({
      pronoteBridgeUrl: normalized || undefined,
      pronoteBridgeToken: bridgeToken.trim() || undefined,
    });
    notify('Configuration serveur Pronote enregistrée ✓');
  };

  const handleTestPronoteBridge = async () => {
    const targetUrl = normalizeBridgeUrl(bridgeUrl);
    if (!targetUrl) return;
    setBridgeUrl(targetUrl);
    setTestingBridge(true);
    setBridgeStatus(null);
    try {
      const headers: Record<string, string> = {};
      if (bridgeToken.trim()) headers['X-Kora-Token'] = bridgeToken.trim();
      const res = await fetch(`${targetUrl}/health`, { headers });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setBridgeStatus({ ok: true, text: `Bridge connecté ✓ (uptime ${data.uptimeSec ?? 0}s)` });
    } catch (err) {
      setBridgeStatus({ ok: false, text: `Inaccessible : ${(err as Error).message}` });
    } finally {
      setTestingBridge(false);
    }
  };

  const handleSyncPronoteBridge = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetUrl = normalizeBridgeUrl(bridgeUrl);
    if (!targetUrl) {
      notify('Indique l’URL de ton bridge Pronote');
      return;
    }
    setBridgeUrl(targetUrl);
    updatePreferences({
      pronoteBridgeUrl: targetUrl,
      pronoteBridgeToken: bridgeToken.trim() || undefined,
    });
    setSyncingPronote(true);
    try {
      const payload =
        pronoteMode === 'qr'
          ? { qrCode: qrJson, pin: qrPin }
          : { url: pnUrl, username: pnUser, password: pnPass };
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (bridgeToken.trim()) {
        headers['X-Kora-Token'] = bridgeToken.trim();
      }
      const res = await fetch(`${targetUrl}/sync`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur bridge Pronote');
      if (Array.isArray(data.events) && data.events.length > 0) addManyEvents(data.events);
      if (Array.isArray(data.grades) && data.grades.length > 0) addManyGrades(data.grades);
      if (Array.isArray(data.homework)) {
        data.homework.forEach((h: { title: string; subject: string; dueDate: string; done: boolean }) =>
          addHomework({
            title: h.title,
            subject: h.subject,
            dueDate: h.dueDate,
            priority: 'medium',
            done: h.done,
          })
        );
      }
      notify('Synchronisation Pronote réussie ✓');
    } catch (err) {
      notify(`Bridge Pronote inaccessible : ${(err as Error).message}`);
    } finally {
      setSyncingPronote(false);
    }
  };

  return (
    <div className="space-y-5 pb-10">
      {/* Header + Sub-tabs */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-zinc-50">
            Cours
          </h1>
          <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5">
            Cursus, notes, cours numériques, Pronote & Notebooks Gemini
          </p>
        </div>

        <div className="inline-flex items-center rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-1 self-start sm:self-auto overflow-x-auto max-w-full">
          {(
            [
              ['exams', 'Évals & Devoirs', Sparkles],
              ['cursus', 'Cursus & Notes', Award],
              ['docs', 'Cours & PDF', FolderOpen],
              ['pronote', 'Pronote', RefreshCw],
            ] as const
          ).map(([id, label, Icon]) => {
            const active = subTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setSubTab(id)}
                className={`relative flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition cursor-pointer whitespace-nowrap ${
                  active
                    ? 'text-white dark:text-zinc-950'
                    : 'text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="studiesSubTabPill"
                    transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                    className="absolute inset-0 rounded-xl bg-slate-900 dark:bg-zinc-100"
                  />
                )}
                <span className="relative z-10 flex items-center gap-1.5">
                  <Icon size={12} />
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ================= TAB 1: ÉVALS & DEVOIRS ================= */}
      {subTab === 'exams' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            {/* Subject Filter */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              <button
                type="button"
                onClick={() => setSubjectFilter('all')}
                className={`rounded-full px-3 py-1 text-xs font-medium cursor-pointer border ${
                  subjectFilter === 'all'
                    ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 border-transparent'
                    : 'bg-white dark:bg-zinc-900 text-slate-600 dark:text-zinc-400 border-slate-200 dark:border-zinc-800'
                }`}
              >
                Toutes
              </button>
              {subjects.map((sub) => (
                <button
                  key={sub}
                  type="button"
                  onClick={() => setSubjectFilter(sub)}
                  className={`rounded-full px-3 py-1 text-xs font-medium cursor-pointer border whitespace-nowrap ${
                    subjectFilter === sub
                      ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 border-transparent'
                      : 'bg-white dark:bg-zinc-900 text-slate-600 dark:text-zinc-400 border-slate-200 dark:border-zinc-800'
                  }`}
                >
                  {sub}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onOpenQuickAdd({ mode: 'devoir', date: todayISO() })}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs font-medium cursor-pointer"
              >
                <Plus size={13} /> Devoir
              </button>
              <button
                type="button"
                onClick={() => onOpenQuickAdd({ mode: 'eval', date: todayISO() })}
                className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-violet-700 cursor-pointer"
              >
                <Sparkles size={12} /> Éval
              </button>
            </div>
          </div>

          {/* Exams Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {sortedExams.map((exam) => {
              const badge = formatCountdownBadge(exam.date);
              const total = exam.topics.length;
              const done = exam.topics.filter((t) => t.done).length;
              const pct = total > 0 ? Math.round((done / total) * 100) : exam.done ? 100 : 0;
              const isEditingUrl = editingUrlExamId === exam.id;

              return (
                <div
                  key={exam.id}
                  className={`tempo-card rounded-3xl p-5 flex flex-col justify-between gap-4 ${
                    exam.done ? 'opacity-65' : ''
                  }`}
                >
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="rounded-full bg-violet-500/10 text-violet-700 dark:text-violet-300 px-2.5 py-0.5 text-[11px] font-semibold">
                            {exam.subject}
                          </span>
                          {exam.coefficient && (
                            <span className="font-mono text-[11px] text-slate-400">
                              Coeff. {exam.coefficient}
                            </span>
                          )}
                          <span
                            className={`font-mono text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                              exam.done
                                ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                                : badge.urgent
                                ? 'bg-violet-600 text-white'
                                : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300'
                            }`}
                          >
                            {exam.done ? 'Passée ✓' : badge.label}
                          </span>
                        </div>
                        <h3 className="text-base font-semibold mt-2">{exam.title}</h3>
                        <div className="flex items-center gap-3 text-xs text-slate-500 mt-1 flex-wrap">
                          <span>{formatShortDateFR(exam.date)}</span>
                          {exam.startTime && (
                            <span className="inline-flex items-center gap-1 font-mono">
                              <Clock size={11} /> {exam.startTime}
                              {exam.endTime ? `–${exam.endTime}` : ''}
                            </span>
                          )}
                          {exam.room && (
                            <span className="inline-flex items-center gap-1">
                              <MapPin size={11} /> {exam.room}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {onRequestAI && (
                          <button
                            type="button"
                            onClick={() =>
                              onRequestAI(
                                `Crée un plan de révision détaillé pour mon évaluation "${exam.title}" (${exam.subject}) prévue le ${exam.date}, ajoute les chapitres manquants et place les créneaux de révision dans les trous libres de mon Planning.`,
                                'cours'
                              )
                            }
                            title="Générer un plan de révision IA dans le Planning"
                            className="rounded-lg px-2 py-1 text-[11px] font-semibold bg-violet-500/12 text-violet-700 dark:text-violet-300 hover:bg-violet-500/20 cursor-pointer flex items-center gap-1"
                          >
                            <Sparkles size={11} /> Plan IA
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => updateExam(exam.id, { done: !exam.done })}
                          className={`rounded-lg p-1.5 cursor-pointer ${
                            exam.done ? 'bg-emerald-500/15 text-emerald-600' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-zinc-800'
                          }`}
                        >
                          <Check size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteExam(exam.id)}
                          className="rounded-lg p-1.5 text-slate-400 hover:text-rose-500 cursor-pointer"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Notebook Gemini Card */}
                    {!isEditingUrl ? (
                      <div className="rounded-2xl border border-violet-200/80 dark:border-violet-800/60 bg-violet-50/55 dark:bg-violet-950/25 p-3 flex items-center justify-between gap-2">
                        {exam.geminiNotebookUrl ? (
                          <a
                            href={exam.geminiNotebookUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2.5 min-w-0 flex-1 group"
                          >
                            <div className="h-8 w-8 rounded-xl bg-violet-600 text-white flex items-center justify-center shrink-0">
                              <Sparkles size={14} />
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-violet-950 dark:text-violet-100 truncate group-hover:underline">
                                {exam.geminiNotebookTitle || 'Ouvrir Notebook Gemini'}
                              </p>
                              <p className="text-[11px] text-violet-600/80 dark:text-violet-300/75 truncate">
                                Révision interactive · 1 clic
                              </p>
                            </div>
                            <ExternalLink size={13} className="text-violet-600 shrink-0 ml-auto" />
                          </a>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingUrlExamId(exam.id);
                              setUrlDraft('https://notebooklm.google.com/');
                              setTitleDraft('');
                            }}
                            className="flex items-center gap-2 text-xs font-medium text-violet-700 dark:text-violet-300 cursor-pointer"
                          >
                            <Sparkles size={14} /> Associer un Notebook Gemini
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setEditingUrlExamId(exam.id);
                            setUrlDraft(exam.geminiNotebookUrl || 'https://notebooklm.google.com/');
                            setTitleDraft(exam.geminiNotebookTitle || '');
                          }}
                          className="rounded-lg p-1.5 text-violet-600/70 hover:bg-violet-200/40 cursor-pointer shrink-0"
                        >
                          <Link2 size={14} />
                        </button>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-violet-300 dark:border-violet-700 bg-violet-50/70 dark:bg-violet-950/35 p-3 space-y-2">
                        <input
                          type="url"
                          value={urlDraft}
                          onChange={(e) => setUrlDraft(e.target.value)}
                          placeholder="https://notebooklm.google.com/notebook/..."
                          className="w-full rounded-lg border border-violet-200 dark:border-violet-800 bg-white dark:bg-zinc-900 px-2.5 py-1.5 text-xs"
                        />
                        <input
                          type="text"
                          value={titleDraft}
                          onChange={(e) => setTitleDraft(e.target.value)}
                          placeholder="Titre du notebook"
                          className="w-full rounded-lg border border-violet-200 dark:border-violet-800 bg-white dark:bg-zinc-900 px-2.5 py-1.5 text-xs"
                        />
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setEditingUrlExamId(null)}
                            className="px-2.5 py-1 text-[11px] text-slate-500 cursor-pointer"
                          >
                            Annuler
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              updateExam(exam.id, {
                                geminiNotebookUrl: urlDraft.trim() || undefined,
                                geminiNotebookTitle: titleDraft.trim() || undefined,
                              });
                              setEditingUrlExamId(null);
                            }}
                            className="rounded-lg bg-violet-600 text-white px-3 py-1 text-[11px] font-semibold cursor-pointer"
                          >
                            Valider
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Topics Checklist */}
                    <div>
                      <div className="flex justify-between text-[11px] text-slate-500 mb-1.5">
                        <span>Progression révisions</span>
                        <span className="font-mono font-semibold text-violet-700 dark:text-violet-300">
                          {pct}%
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-slate-100 dark:bg-zinc-800 overflow-hidden mb-2.5">
                        <div
                          className="h-full rounded-full bg-violet-600 transition-all duration-300"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="space-y-1">
                        {exam.topics.map((topic) => (
                          <div
                            key={topic.id}
                            className="group flex items-center gap-2.5 rounded-lg py-1 px-1 hover:bg-slate-50 dark:hover:bg-zinc-900/60"
                          >
                            <CheckCircle
                              checked={topic.done}
                              onToggle={() => toggleExamTopic(exam.id, topic.id)}
                              accent="violet"
                              size="sm"
                            />
                            <span
                              className={`flex-1 text-xs ${
                                topic.done ? 'line-through text-slate-400' : 'text-slate-700 dark:text-zinc-200'
                              }`}
                            >
                              {topic.label}
                            </span>
                            <button
                              type="button"
                              onClick={() => deleteExamTopic(exam.id, topic.id)}
                              className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-400 hover:text-rose-500 cursor-pointer"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const val = (topicInputs[exam.id] || '').trim();
                          if (!val) return;
                          addExamTopic(exam.id, val);
                          setTopicInputs((prev) => ({ ...prev, [exam.id]: '' }));
                        }}
                        className="mt-2 flex gap-1.5"
                      >
                        <input
                          type="text"
                          value={topicInputs[exam.id] || ''}
                          onChange={(e) =>
                            setTopicInputs((prev) => ({ ...prev, [exam.id]: e.target.value }))
                          }
                          placeholder="+ Chapitre à réviser…"
                          className="flex-1 rounded-xl bg-slate-50 dark:bg-zinc-900/70 border border-slate-200/70 dark:border-zinc-800 px-3 py-1.5 text-xs outline-none focus:border-violet-400"
                        />
                        {(topicInputs[exam.id] || '').trim() && (
                          <button
                            type="submit"
                            className="rounded-xl bg-violet-600 text-white px-2.5 py-1.5 text-[11px] font-semibold cursor-pointer"
                          >
                            OK
                          </button>
                        )}
                      </form>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Devoirs List */}
          <section className="tempo-card rounded-3xl p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <BookOpen size={15} className="text-amber-500" />
                <h2 className="text-sm font-semibold">Devoirs</h2>
              </div>
              <div className="flex items-center gap-2">
                {onRequestAI && (
                  <button
                    type="button"
                    onClick={() =>
                      onRequestAI(
                        'Organise un planning pour tous mes devoirs à faire cette semaine en plaçant des créneaux de travail dans les trous libres de mon emploi du temps.',
                        'cours'
                      )
                    }
                    className="rounded-xl bg-amber-500/12 text-amber-700 dark:text-amber-300 px-2.5 py-1 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <Sparkles size={11} /> Planifier mes devoirs IA
                  </button>
                )}
                <div className="inline-flex items-center rounded-xl bg-slate-100 dark:bg-zinc-900 p-0.5">
                  {(['todo', 'done', 'all'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setHwFilter(k)}
                      className={`rounded-lg px-2.5 py-1 text-xs font-medium cursor-pointer ${
                        hwFilter === k
                          ? 'bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 shadow-2xs'
                          : 'text-slate-500'
                      }`}
                    >
                      {k === 'todo' ? 'À faire' : k === 'done' ? 'Terminés' : 'Tous'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {draftActions
              .filter((d) => d.action.kind === 'add_homework')
              .map((draft) => {
                if (draft.action.kind !== 'add_homework') return null;
                const hw = draft.action.payload;
                return (
                  <div
                    key={draft.id}
                    className="mb-2 flex items-center justify-between gap-2 rounded-2xl border-2 border-dashed border-violet-400 bg-violet-50/60 dark:bg-violet-950/30 px-3.5 py-2.5"
                  >
                    <div className="min-w-0">
                      <span className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase text-violet-600 dark:text-violet-300">
                        <Sparkles size={9} /> Aperçu IA · {hw.subject}
                      </span>
                      <p className="text-xs font-semibold truncate">{hw.title}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => applyDraftAction(draft.id)}
                        className="h-7 w-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center cursor-pointer"
                      >
                        <Check size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => dismissDraftAction(draft.id)}
                        className="h-7 w-7 rounded-lg bg-white dark:bg-zinc-900 text-slate-400 flex items-center justify-center cursor-pointer"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}

            {filteredHomework.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-400">Aucun devoir ✨</p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-zinc-800/80">
                {filteredHomework.map((hw) => {
                  const badge = formatCountdownBadge(hw.dueDate);
                  return (
                    <div key={hw.id} className="group flex items-start justify-between gap-3 py-3 first:pt-1">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="pt-0.5">
                          <CheckCircle
                            checked={hw.done}
                            onToggle={() => toggleHomework(hw.id)}
                            accent="amber"
                          />
                        </div>
                        <div className="min-w-0">
                          <p
                            className={`text-sm font-medium ${
                              hw.done ? 'line-through text-slate-400' : 'text-slate-900 dark:text-zinc-100'
                            }`}
                          >
                            {hw.title}
                          </p>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className="rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300 px-2 py-0.5 text-[11px] font-medium">
                              {hw.subject}
                            </span>
                            <span
                              className={`text-[11px] font-mono ${
                                badge.urgent && !hw.done ? 'text-rose-600 font-semibold' : 'text-slate-400'
                              }`}
                            >
                              {formatShortDateFR(hw.dueDate) === badge.label
                                ? badge.label
                                : `${formatShortDateFR(hw.dueDate)} · ${badge.label}`}
                            </span>
                            <span
                              className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
                                PRIORITY_STYLES[hw.priority].badge
                              }`}
                            >
                              {PRIORITY_STYLES[hw.priority].label}
                            </span>
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => deleteHomework(hw.id)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-400 hover:text-rose-500 cursor-pointer"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {/* ================= TAB 2: CURSUS, CARRIÈRE & NOTES ================= */}
      {subTab === 'cursus' && (
        <div className="space-y-5">
          {/* Academic & Career Profile Card */}
          <section className="tempo-card rounded-3xl p-5 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-indigo-500/12 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                  <Briefcase size={16} />
                </div>
                <div>
                  <h2 className="text-sm font-semibold">Cursus, Plan d’études & Carrière</h2>
                  <p className="text-xs text-slate-400">
                    Utilisé automatiquement par ton Assistant IA pour adapter tes révisions
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setProfDraft(state.academicProfile);
                  setEditingProfile((v) => !v);
                }}
                className="rounded-xl border border-slate-200 dark:border-zinc-800 px-3 py-1.5 text-xs font-medium cursor-pointer"
              >
                {editingProfile ? 'Annuler' : 'Modifier'}
              </button>
            </div>

            {!editingProfile ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                <div className="rounded-2xl bg-slate-50/80 dark:bg-zinc-900/55 p-3.5 space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Formation actuelle
                  </p>
                  <p className="text-sm font-semibold">{state.academicProfile.program || 'Non renseigné'}</p>
                  <p className="text-xs text-slate-500">
                    {state.academicProfile.level} · {state.academicProfile.school}
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-50/80 dark:bg-zinc-900/55 p-3.5 space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Objectif carrière
                  </p>
                  <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
                    {state.academicProfile.careerGoal || 'Non renseigné'}
                  </p>
                  <div className="flex flex-wrap gap-1 pt-1">
                    {state.academicProfile.targetSkills.map((sk) => (
                      <span
                        key={sk}
                        className="rounded-full bg-white dark:bg-zinc-800 border border-slate-200/80 dark:border-zinc-700 px-2 py-0.5 text-[10px] font-medium"
                      >
                        {sk}
                      </span>
                    ))}
                  </div>
                </div>
                {state.academicProfile.studyPlanSummary && (
                  <p className="md:col-span-2 text-xs text-slate-600 dark:text-zinc-300 leading-relaxed bg-slate-50/60 dark:bg-zinc-900/40 rounded-2xl p-3.5">
                    {state.academicProfile.studyPlanSummary}
                  </p>
                )}
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  updateAcademicProfile(profDraft);
                  setEditingProfile(false);
                }}
                className="space-y-3 pt-2"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <input
                    type="text"
                    value={profDraft.program}
                    onChange={(e) => setProfDraft({ ...profDraft, program: e.target.value })}
                    placeholder="Filière / Cursus (ex. Terminale, Prépa, Licence Info)"
                    className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs"
                  />
                  <input
                    type="text"
                    value={profDraft.level}
                    onChange={(e) => setProfDraft({ ...profDraft, level: e.target.value })}
                    placeholder="Niveau / Semestre"
                    className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs"
                  />
                  <input
                    type="text"
                    value={profDraft.school}
                    onChange={(e) => setProfDraft({ ...profDraft, school: e.target.value })}
                    placeholder="Établissement"
                    className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs"
                  />
                  <input
                    type="text"
                    value={profDraft.careerGoal}
                    onChange={(e) => setProfDraft({ ...profDraft, careerGoal: e.target.value })}
                    placeholder="Objectif carrière (ex. Ingénieur IA, Médecin…)"
                    className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs"
                  />
                </div>
                <input
                  type="text"
                  value={profDraft.targetSkills.join(', ')}
                  onChange={(e) =>
                    setProfDraft({
                      ...profDraft,
                      targetSkills: e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder="Compétences visées (séparées par des virgules)"
                  className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs"
                />
                <textarea
                  rows={2}
                  value={profDraft.studyPlanSummary}
                  onChange={(e) => setProfDraft({ ...profDraft, studyPlanSummary: e.target.value })}
                  placeholder="Plan d’études / priorités du semestre…"
                  className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs"
                />
                <button
                  type="submit"
                  className="rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-4 py-2 text-xs font-semibold cursor-pointer"
                >
                  Enregistrer le profil
                </button>
              </form>
            )}
          </section>

          {/* Moyenne Générale & Matières */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-5 tempo-card rounded-3xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Moyenne générale
                  </p>
                  <p className="font-mono text-3xl font-bold tabular-nums text-indigo-600 dark:text-indigo-400 mt-1">
                    {generalAvg !== null ? generalAvg.toFixed(2) : '—'}
                    <span className="text-sm font-normal text-slate-400"> / 20</span>
                  </p>
                </div>
                <span className="font-mono text-xs text-slate-400">
                  {state.grades.length} notes
                </span>
              </div>

              <div className="space-y-2">
                {state.subjects.map((sub) => {
                  const avg = avgBySubject[sub.name];
                  return (
                    <div
                      key={sub.id}
                      className="group flex items-center justify-between rounded-xl bg-slate-50/80 dark:bg-zinc-900/55 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-semibold truncate">{sub.name}</p>
                        <p className="text-[10px] text-slate-400">
                          Coeff. {sub.coefficient}
                          {sub.targetGrade ? ` · Visé ${sub.targetGrade}/20` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold tabular-nums">
                          {avg !== undefined ? `${avg.toFixed(1)}/20` : '—'}
                        </span>
                        <button
                          type="button"
                          onClick={() => deleteSubject(sub.id)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-500 cursor-pointer"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newSubName.trim()) return;
                  addSubject({ name: newSubName.trim(), coefficient: Number(newSubCoeff) || 1 });
                  setNewSubName('');
                }}
                className="flex gap-1.5"
              >
                <input
                  type="text"
                  value={newSubName}
                  onChange={(e) => setNewSubName(e.target.value)}
                  placeholder="+ Matière"
                  className="flex-1 rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-1.5 text-xs"
                />
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={newSubCoeff}
                  onChange={(e) => setNewSubCoeff(e.target.value)}
                  className="w-16 rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-2 py-1.5 font-mono text-xs text-center"
                  title="Coefficient"
                />
                <button
                  type="submit"
                  className="rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-3 py-1.5 text-xs font-semibold cursor-pointer"
                >
                  +
                </button>
              </form>
            </div>

            {/* Grades Log */}
            <div className="lg:col-span-7 tempo-card rounded-3xl p-5 space-y-4">
              <h3 className="text-sm font-semibold">Relevé de notes</h3>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const score = parseFloat(gradeScore.replace(',', '.'));
                  if (isNaN(score) || !gradeTitle.trim()) return;
                  addGrade({
                    subject: gradeSub || 'Général',
                    title: gradeTitle.trim(),
                    score,
                    outOf: Number(gradeOutOf) || 20,
                    coefficient: Number(gradeCoeff) || 1,
                    date: todayISO(),
                    source: 'manual',
                  });
                  setGradeTitle('');
                  setGradeScore('');
                }}
                className="grid grid-cols-2 sm:grid-cols-6 gap-2"
              >
                <select
                  value={gradeSub}
                  onChange={(e) => setGradeSub(e.target.value)}
                  className="col-span-2 sm:col-span-2 rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-2.5 py-2 text-xs"
                >
                  {(subjects.length > 0 ? subjects : ['Maths', 'Physique', 'Informatique']).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  required
                  value={gradeTitle}
                  onChange={(e) => setGradeTitle(e.target.value)}
                  placeholder="Intitulé (DS1…)"
                  className="col-span-2 sm:col-span-2 rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-2.5 py-2 text-xs"
                />
                <input
                  type="number"
                  step="0.25"
                  required
                  value={gradeScore}
                  onChange={(e) => setGradeScore(e.target.value)}
                  placeholder="Note"
                  className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-2 py-2 font-mono text-xs text-center"
                />
                <button
                  type="submit"
                  className="rounded-xl bg-indigo-600 text-white py-2 text-xs font-semibold cursor-pointer"
                >
                  Ajouter
                </button>
              </form>

              <div className="divide-y divide-slate-100 dark:divide-zinc-800/80 max-h-72 overflow-y-auto">
                {state.grades.map((g) => (
                  <div key={g.id} className="group flex items-center justify-between py-2.5 gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate">{g.title}</p>
                      <p className="text-[11px] text-slate-400">
                        {g.subject} · Coeff. {g.coefficient} · {formatShortDateFR(g.date)}
                        {g.source === 'pronote' && ' · Pronote'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0">
                      <span className="font-mono text-sm font-bold tabular-nums">
                        {g.score}
                        <span className="text-xs font-normal text-slate-400">/{g.outOf}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => deleteGrade(g.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-500 cursor-pointer"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= TAB 3: COURS NUMÉRIQUES (PDF & PHOTOS) ================= */}
      {subTab === 'docs' && (
        <div className="space-y-4">
          <div className="tempo-card rounded-3xl p-5 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div>
                <h2 className="text-sm font-semibold">Coffre de cours numériques</h2>
                <p className="text-xs text-slate-400">
                  Stocke tes programmes PDF, polycopiés et photos de tableaux (IndexedDB + Cloud)
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={docSubject}
                  onChange={(e) => setDocSubject(e.target.value)}
                  className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-1.5 text-xs"
                >
                  {(subjects.length > 0 ? subjects : ['Maths', 'Informatique', 'Physique']).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <select
                  value={docKind}
                  onChange={(e) => setDocKind(e.target.value as CourseDocument['kind'])}
                  className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-1.5 text-xs"
                >
                  <option value="cours-pdf">Cours PDF</option>
                  <option value="programme-pdf">Programme officiel PDF</option>
                  <option value="photo">Photo cours / tableau</option>
                </select>
                <button
                  type="button"
                  onClick={() => docInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-3.5 py-1.5 text-xs font-semibold cursor-pointer"
                >
                  <Upload size={13} /> Importer PDF / Photo
                </button>
                <input
                  ref={docInputRef}
                  type="file"
                  accept="application/pdf,image/*"
                  multiple
                  onChange={(e) => void handleUploadCourseDocs(e.target.files)}
                  className="hidden"
                />
              </div>
            </div>
          </div>

          {state.courseDocs.length === 0 ? (
            <div className="tempo-card rounded-3xl p-10 text-center">
              <FolderOpen size={30} className="mx-auto text-slate-300 dark:text-zinc-700 mb-2" />
              <p className="text-sm font-medium text-slate-500">Aucun document importé</p>
              <p className="text-xs text-slate-400 mt-0.5">
                Importe ton programme PDF ou prends en photo tes cours depuis ton mobile.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {state.courseDocs.map((doc) => (
                <div key={doc.id} className="tempo-card rounded-2xl p-4 flex flex-col justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-xl bg-indigo-500/12 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                      {doc.kind === 'photo' ? <FileImage size={18} /> : <FileText size={18} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold truncate">{doc.title}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        {doc.subject} ·{' '}
                        {doc.kind === 'programme-pdf'
                          ? 'Programme PDF'
                          : doc.kind === 'photo'
                          ? 'Photo'
                          : 'Cours PDF'}{' '}
                        · {formatBytes(doc.sizeBytes)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-zinc-800/80">
                    <button
                      type="button"
                      onClick={() => void handleOpenDoc(doc)}
                      className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                    >
                      Ouvrir
                    </button>
                    <div className="flex items-center gap-2">
                      {onRequestAI && (
                        <button
                          type="button"
                          onClick={() =>
                            onRequestAI(
                              `Aide-moi à réviser le document "${doc.title}" en ${doc.subject} : propose un plan de révision et des créneaux dans mon emploi du temps.`,
                              'cours'
                            )
                          }
                          className="text-[11px] font-medium text-violet-600 dark:text-violet-400 cursor-pointer"
                        >
                          IA
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => deleteCourseDoc(doc.id)}
                        className="p-1 text-slate-400 hover:text-rose-500 cursor-pointer"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ================= TAB 4: PRONOTE SYNC ================= */}
      {subTab === 'pronote' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Option 1: Direct .ics Import */}
          <div className="tempo-card rounded-3xl p-5 space-y-3.5">
            <span className="rounded-full bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 px-2.5 py-0.5 text-[10px] font-semibold">
              Option 1 · Immédiat (0 serveur)
            </span>
            <h2 className="text-base font-semibold">Importer l’emploi du temps Pronote (.ics)</h2>
            <p className="text-xs text-slate-500 dark:text-zinc-400 leading-relaxed">
              Dans Pronote → <em>Emploi du temps</em> → icône <strong>iCal (.ics)</strong>, télécharge le fichier et importe-le ici. Tous tes cours et matières sont ajoutés instantanément.
            </p>
            <button
              type="button"
              onClick={() => icsInputRef.current?.click()}
              className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 py-3 text-xs font-semibold hover:opacity-90 cursor-pointer"
            >
              <Upload size={14} /> Choisir un fichier .ics Pronote
            </button>
            <input
              ref={icsInputRef}
              type="file"
              accept=".ics,text/calendar"
              onChange={(e) => void handleImportICS(e.target.files?.[0])}
              className="hidden"
            />
          </div>

          {/* Option 2: Auto Pronote Local Bridge */}
          <form onSubmit={handleSyncPronoteBridge} className="tempo-card rounded-3xl p-5 space-y-3.5">
            <span className="rounded-full bg-indigo-500/12 text-indigo-700 dark:text-indigo-300 px-2.5 py-0.5 text-[10px] font-semibold">
              Option 2 · Sync Auto (Notes + Devoirs + Cours)
            </span>
            <h2 className="text-base font-semibold">Bridge local Pronote (`pawnote`)</h2>
            <p className="text-xs text-slate-500 dark:text-zinc-400 leading-relaxed">
              Lance dans ton terminal : <code className="font-mono bg-slate-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">npm i -D pawnote && node server/pronote-bridge.mjs</code>
            </p>

            <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/60 dark:bg-zinc-900/50 p-3 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-slate-700 dark:text-zinc-200 flex items-center gap-1.5">
                  <Server size={12} className="text-indigo-500" /> Serveur Bridge (Local / Tailscale)
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={testingBridge || !bridgeUrl.trim()}
                    onClick={() => void handleTestPronoteBridge()}
                    className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-40 cursor-pointer"
                  >
                    {testingBridge ? 'Test…' : 'Tester /health'}
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveBridgeConfig}
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-2 py-1 text-[10px] font-semibold cursor-pointer"
                  >
                    <Save size={10} /> Sauver
                  </button>
                </div>
              </div>

              <input
                type="url"
                value={bridgeUrl}
                onChange={(e) => {
                  setBridgeUrl(e.target.value);
                  setBridgeStatus(null);
                }}
                placeholder="https://pc-tv.mon-tailnet.ts.net ou http://127.0.0.1:4789"
                className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 font-mono text-xs"
              />

              <div className="flex items-center gap-1.5">
                <div className="relative flex-1 min-w-0">
                  <KeyRound size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type={showBridgeToken ? 'text' : 'password'}
                    value={bridgeToken}
                    onChange={(e) => setBridgeToken(e.target.value)}
                    placeholder="Token secret X-Kora-Token (recommandé sur Tailscale)"
                    className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 pl-8 pr-3 py-2 font-mono text-xs"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setShowBridgeToken((v) => !v)}
                  className="h-8 w-8 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 flex items-center justify-center text-slate-500 cursor-pointer shrink-0"
                >
                  {showBridgeToken ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>

              {bridgeStatus && (
                <p
                  className={`text-[11px] font-medium ${
                    bridgeStatus.ok
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {bridgeStatus.text}
                </p>
              )}
            </div>

            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setPronoteMode('qr')}
                className={`flex-1 py-1.5 rounded-xl text-xs font-medium cursor-pointer ${
                  pronoteMode === 'qr'
                    ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                    : 'bg-slate-100 dark:bg-zinc-800 text-slate-500'
                }`}
              >
                QR Code Pronote
              </button>
              <button
                type="button"
                onClick={() => setPronoteMode('creds')}
                className={`flex-1 py-1.5 rounded-xl text-xs font-medium cursor-pointer ${
                  pronoteMode === 'creds'
                    ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                    : 'bg-slate-100 dark:bg-zinc-800 text-slate-500'
                }`}
              >
                Identifiants directs
              </button>
            </div>

            {pronoteMode === 'qr' ? (
              <div className="space-y-2">
                <textarea
                  rows={2}
                  value={qrJson}
                  onChange={(e) => setQrJson(e.target.value)}
                  placeholder='JSON du QR Code Pronote ({"jeton":"...","login":"...","url":"..."})'
                  className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 font-mono text-[11px]"
                />
                <input
                  type="password"
                  value={qrPin}
                  onChange={(e) => setQrPin(e.target.value)}
                  placeholder="Code PIN à 4 chiffres"
                  className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 font-mono text-xs"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <input
                  type="url"
                  value={pnUrl}
                  onChange={(e) => setPnUrl(e.target.value)}
                  placeholder="URL Pronote (ex. https://.../eleve.html)"
                  className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={pnUser}
                    onChange={(e) => setPnUser(e.target.value)}
                    placeholder="Identifiant"
                    className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs"
                  />
                  <input
                    type="password"
                    value={pnPass}
                    onChange={(e) => setPnPass(e.target.value)}
                    placeholder="Mot de passe"
                    className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={syncingPronote}
              className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 text-white py-2.5 text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw size={14} className={syncingPronote ? 'animate-spin' : ''} />
              {syncingPronote ? 'Synchronisation…' : 'Synchroniser Pronote'}
            </button>
          </form>
        </div>
      )}

      {/* Photo Preview Lightbox */}
      {previewDoc && (
        <div
          onClick={() => setPreviewDoc(null)}
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="relative max-w-3xl max-h-[85vh] flex flex-col items-center gap-2">
            <img
              src={previewDoc.url}
              alt={previewDoc.title}
              className="max-h-[80vh] rounded-2xl object-contain shadow-2xl"
            />
            <p className="text-xs text-white/80">{previewDoc.title}</p>
          </div>
        </div>
      )}
    </div>
  );
}
