import React, { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cloud,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  RotateCcw,
  Save,
  Server,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getEnvFirebaseConfig, parseFirebaseConfigSnippet } from '../lib/firebase';
import { sanitizeGeminiApiKey, testGeminiApiKey } from '../lib/koraAi';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

const AVATAR_COLORS = [
  { id: 'slate', cls: 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950' },
  { id: 'indigo', cls: 'bg-indigo-600 text-white' },
  { id: 'violet', cls: 'bg-violet-600 text-white' },
  { id: 'emerald', cls: 'bg-emerald-600 text-white' },
  { id: 'fuchsia', cls: 'bg-fuchsia-600 text-white' },
  { id: 'amber', cls: 'bg-amber-500 text-white' },
];

async function resizeImageToDataUrl(file: File, maxSize = 144): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = reject;
      img.src = String(reader.result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const {
    state,
    updatePreferences,
    resetToDemo,
    clearAllData,
    exportStateJSON,
    importStateJSON,
    cloudUser,
    cloudConfigured,
    cloudSyncing,
    lastCloudSyncAt,
    connectGoogleCloud,
    connectEmailCloud,
    registerEmailCloud,
    forceSaveCloud,
    disconnectGoogleCloud,
    notify,
  } = useApp();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const hasEnvFirebase = Boolean(getEnvFirebaseConfig());

  const [tab, setTab] = useState<'account' | 'apis' | 'data'>('account');
  const [showAdvancedDb, setShowAdvancedDb] = useState(!hasEnvFirebase);

  // User customization
  const [name, setName] = useState(state.preferences.name);
  const [bio, setBio] = useState(state.preferences.bio || '');
  const [avatarColor, setAvatarColor] = useState(state.preferences.avatarColor || 'slate');
  const [avatarUrl, setAvatarUrl] = useState(state.preferences.avatarUrl || '');

  // Auth & Firebase BYODB
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [configPaste, setConfigPaste] = useState('');
  const [fbApiKey, setFbApiKey] = useState(state.preferences.firebaseConfig?.apiKey || '');
  const [fbProjectId, setFbProjectId] = useState(state.preferences.firebaseConfig?.projectId || '');
  const [fbAuthDomain, setFbAuthDomain] = useState(state.preferences.firebaseConfig?.authDomain || '');
  const [fbBucket, setFbBucket] = useState(state.preferences.firebaseConfig?.storageBucket || '');
  const [fbSenderId, setFbSenderId] = useState(state.preferences.firebaseConfig?.messagingSenderId || '');
  const [fbAppId, setFbAppId] = useState(state.preferences.firebaseConfig?.appId || '');

  // APIs & Bridges
  const [geminiApiKey, setGeminiApiKey] = useState(state.preferences.geminiApiKey || '');
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [pronoteUrl, setPronoteUrl] = useState(
    state.preferences.pronoteBridgeUrl || 'http://127.0.0.1:4789'
  );
  const [pronoteToken, setPronoteToken] = useState(state.preferences.pronoteBridgeToken || '');
  const [testingGemini, setTestingGemini] = useState(false);
  const [geminiStatus, setGeminiStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [testingBridge, setTestingBridge] = useState(false);
  const [bridgeStatus, setBridgeStatus] = useState<string | null>(null);

  const handleAvatarUpload = async (file: File | undefined) => {
    if (!file) return;
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      setAvatarUrl(dataUrl);
      updatePreferences({ avatarUrl: dataUrl });
      notify('Photo de profil mise à jour');
    } catch {
      notify('Impossible de lire cette image');
    }
  };

  const handleApplyPaste = () => {
    const parsed = parseFirebaseConfigSnippet(configPaste);
    if (!parsed) {
      notify('Snippet firebaseConfig non reconnu (apiKey + projectId requis)');
      return;
    }
    setFbApiKey(parsed.apiKey);
    setFbProjectId(parsed.projectId);
    setFbAuthDomain(parsed.authDomain);
    setFbBucket(parsed.storageBucket);
    setFbSenderId(parsed.messagingSenderId);
    setFbAppId(parsed.appId);
    updatePreferences({ firebaseConfig: parsed });
    setConfigPaste('');
    notify(`Projet Firebase « ${parsed.projectId} » connecté ✓`);
  };

  const handleSaveProfileAndDb = (e: React.FormEvent) => {
    e.preventDefault();
    const hasFb = fbApiKey.trim() && fbProjectId.trim();
    updatePreferences({
      name: name.trim(),
      bio: bio.trim() || undefined,
      avatarColor,
      avatarUrl: avatarUrl || undefined,
      firebaseConfig: hasFb
        ? {
            apiKey: fbApiKey.trim(),
            projectId: fbProjectId.trim(),
            authDomain: fbAuthDomain.trim() || `${fbProjectId.trim()}.firebaseapp.com`,
            storageBucket: fbBucket.trim() || `${fbProjectId.trim()}.firebasestorage.app`,
            messagingSenderId: fbSenderId.trim(),
            appId: fbAppId.trim(),
          }
        : undefined,
    });
    notify('Profil & configuration enregistrés ✓');
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || password.length < 6) {
      notify('Email et mot de passe (6+ caractères) requis');
      return;
    }
    if (authMode === 'login') await connectEmailCloud(email, password);
    else await registerEmailCloud(email, password);
  };

  const handleSaveApis = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanedKey = geminiApiKey.trim() ? sanitizeGeminiApiKey(geminiApiKey) : '';
    setGeminiApiKey(cleanedKey);
    updatePreferences({
      geminiApiKey: cleanedKey || undefined,
      pronoteBridgeUrl: pronoteUrl.trim() || undefined,
      pronoteBridgeToken: pronoteToken.trim() || undefined,
    });
    notify('APIs & Services enregistrés ✓');
  };

  const handleTestGemini = async () => {
    setTestingGemini(true);
    setGeminiStatus(null);
    const cleaned = sanitizeGeminiApiKey(geminiApiKey);
    if (cleaned !== geminiApiKey) setGeminiApiKey(cleaned);
    const res = await testGeminiApiKey(cleaned);
    setGeminiStatus({ ok: res.ok, text: res.message });
    setTestingGemini(false);
  };

  const handleTestBridge = async () => {
    setTestingBridge(true);
    setBridgeStatus(null);
    try {
      const headers: Record<string, string> = {};
      if (pronoteToken.trim()) headers['X-Kora-Token'] = pronoteToken.trim();
      const res = await fetch(`${pronoteUrl.replace(/\/$/, '')}/health`, { headers });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setBridgeStatus(`Bridge connecté ✓ (uptime ${data.uptimeSec ?? 0}s)`);
    } catch (err) {
      setBridgeStatus(`Inaccessible : ${(err as Error).message}`);
    } finally {
      setTestingBridge(false);
    }
  };

  const handleExport = () => {
    const blob = new Blob([exportStateJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kora-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify('Sauvegarde JSON téléchargée');
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const ok = importStateJSON(String(reader.result || ''));
      if (!ok) notify('Fichier JSON invalide');
      else onClose();
    };
    reader.readAsText(file);
  };

  const activeColorCls =
    AVATAR_COLORS.find((c) => c.id === avatarColor)?.cls || AVATAR_COLORS[0].cls;
  const initials = (name.trim() || cloudUser?.displayName || cloudUser?.email || 'K')
    .slice(0, 2)
    .toUpperCase();

  const inputCls =
    'w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/70 px-3 py-2 text-xs text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-slate-900/15';

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-950/35 dark:bg-black/65 backdrop-blur-xs"
          />

          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            className="relative z-10 w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl bg-white dark:bg-[#121215] border border-slate-200 dark:border-zinc-800 shadow-2xl overflow-hidden max-h-[88vh] flex flex-col"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-zinc-800">
              <div>
                <h2 className="text-sm font-semibold">Paramètres · Kora</h2>
                <p className="text-[11px] text-slate-400">
                  Profil personnalisé, connexion Cloud & APIs
                </p>
              </div>
              <button type="button" onClick={onClose} className="p-1.5 text-slate-400 cursor-pointer">
                <X size={16} />
              </button>
            </div>

            {/* Tabs */}
            <div className="px-5 pt-3 flex gap-1.5">
              {(
                [
                  ['account', 'Profil & Compte'],
                  ['apis', 'APIs & Bridge'],
                  ['data', 'Données'],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setTab(k)}
                  className={`flex-1 rounded-xl py-1.5 text-xs font-medium cursor-pointer transition ${
                    tab === k
                      ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                      : 'bg-slate-100 dark:bg-zinc-800/80 text-slate-500'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              {/* TAB 1: PROFIL UTILISATEUR & CONNEXION CLOUD */}
              {tab === 'account' && (
                <div className="space-y-4">
                  {/* User Customization Card */}
                  <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 p-4 space-y-3">
                    <div className="flex items-center gap-3.5">
                      <div className="relative group shrink-0">
                        {avatarUrl || cloudUser?.photoURL ? (
                          <img
                            src={avatarUrl || cloudUser?.photoURL || ''}
                            alt="Avatar"
                            className="h-14 w-14 rounded-2xl object-cover border border-slate-200 dark:border-zinc-700"
                          />
                        ) : (
                          <div
                            className={`h-14 w-14 rounded-2xl flex items-center justify-center font-bold text-base ${activeColorCls}`}
                          >
                            {initials}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => avatarInputRef.current?.click()}
                          title="Changer la photo"
                          className="absolute inset-0 rounded-2xl bg-black/45 opacity-0 group-hover:opacity-100 text-white flex items-center justify-center transition cursor-pointer"
                        >
                          <Camera size={16} />
                        </button>
                        <input
                          ref={avatarInputRef}
                          type="file"
                          accept="image/*"
                          onChange={(e) => void handleAvatarUpload(e.target.files?.[0])}
                          className="hidden"
                        />
                      </div>

                      <div className="flex-1 min-w-0 space-y-2">
                        <input
                          type="text"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="Ton prénom / pseudo"
                          className={inputCls}
                        />
                        <input
                          type="text"
                          value={bio}
                          onChange={(e) => setBio(e.target.value)}
                          placeholder="Bio courte (ex. L2 Info · Gym · Music)"
                          className={inputCls}
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1">
                      <div className="flex items-center gap-1.5">
                        {AVATAR_COLORS.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              setAvatarColor(c.id);
                              setAvatarUrl('');
                            }}
                            className={`h-5 w-5 rounded-full ${c.cls} cursor-pointer transition ${
                              avatarColor === c.id && !avatarUrl
                                ? 'ring-2 ring-offset-2 ring-slate-900 dark:ring-zinc-100 dark:ring-offset-zinc-950'
                                : 'opacity-70 hover:opacity-100'
                            }`}
                          />
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => avatarInputRef.current?.click()}
                        className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                      >
                        Importer photo
                      </button>
                    </div>
                  </div>

                  {/* Cloud Auth Card (Pre-loaded DB: 1-click Google or Email/Password!) */}
                  <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold flex items-center gap-1.5">
                        <Cloud size={14} className="text-indigo-500" /> Connexion & Sauvegarde Cloud
                      </p>
                      {cloudUser ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 size={11} /> Connecté
                        </span>
                      ) : cloudConfigured ? (
                        <span className="text-[10px] font-medium text-indigo-600 dark:text-indigo-400">
                          DB prête ✓
                        </span>
                      ) : null}
                    </div>

                    {cloudUser ? (
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between rounded-xl bg-emerald-500/10 px-3 py-2">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold truncate">{cloudUser.email}</p>
                            <p className="text-[10px] text-slate-500">
                              {lastCloudSyncAt
                                ? `Dernière sync à ${new Date(lastCloudSyncAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
                                : 'Sync automatique active'}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void disconnectGoogleCloud()}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 cursor-pointer shrink-0"
                          >
                            <LogOut size={12} /> Quitter
                          </button>
                        </div>
                        <button
                          type="button"
                          disabled={cloudSyncing}
                          onClick={() => void forceSaveCloud()}
                          className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 py-2 text-xs font-semibold cursor-pointer disabled:opacity-50"
                        >
                          {cloudSyncing ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                          Sauvegarder maintenant
                        </button>
                      </div>
                    ) : cloudConfigured ? (
                      <div className="space-y-3">
                        <button
                          type="button"
                          onClick={() => void connectGoogleCloud()}
                          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 text-white py-2.5 text-xs font-semibold hover:bg-indigo-700 cursor-pointer"
                        >
                          <LogIn size={14} /> Continuer avec Google
                        </button>

                        <div className="relative flex items-center justify-center">
                          <span className="border-t border-slate-200 dark:border-zinc-800 w-full" />
                          <span className="bg-white dark:bg-[#121215] px-2 text-[10px] text-slate-400">
                            ou par email
                          </span>
                          <span className="border-t border-slate-200 dark:border-zinc-800 w-full" />
                        </div>

                        <form onSubmit={handleEmailAuth} className="space-y-2">
                          <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="Email"
                            className={inputCls}
                          />
                          <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Mot de passe (6+ car.)"
                            className={inputCls}
                          />
                          <div className="flex items-center gap-2">
                            <button
                              type="submit"
                              className="flex-1 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 py-2 text-xs font-semibold cursor-pointer"
                            >
                              {authMode === 'login' ? 'Se connecter' : 'Créer un compte'}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setAuthMode((m) => (m === 'login' ? 'register' : 'login'))
                              }
                              className="rounded-xl border border-slate-200 dark:border-zinc-800 px-3 py-2 text-[11px] text-slate-500 cursor-pointer"
                            >
                              {authMode === 'login' ? 'Inscription' : 'Connexion'}
                            </button>
                          </div>
                        </form>
                      </div>
                    ) : (
                      <p className="text-[11px] text-slate-500">
                        Aucune DB pré-chargée détectée — ouvre la configuration Firebase ci-dessous pour relier ta base.
                      </p>
                    )}
                  </div>

                  {/* Collapsible BYODB Firebase Override */}
                  <form onSubmit={handleSaveProfileAndDb} className="space-y-3">
                    <button
                      type="button"
                      onClick={() => setShowAdvancedDb((v) => !v)}
                      className="w-full flex items-center justify-between text-[11px] font-medium text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer"
                    >
                      <span>
                        {hasEnvFirebase
                          ? 'Base Firebase déjà chargée · Options avancées (BYODB)'
                          : 'Configurer ma base Firebase'}
                      </span>
                      {showAdvancedDb ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>

                    {showAdvancedDb && (
                      <div className="space-y-2.5 pt-1">
                        <div className="flex gap-1.5">
                          <textarea
                            rows={2}
                            value={configPaste}
                            onChange={(e) => setConfigPaste(e.target.value)}
                            placeholder={'Coller const firebaseConfig = { apiKey: "...", projectId: "..." };'}
                            className={`${inputCls} font-mono text-[11px]`}
                          />
                          <button
                            type="button"
                            onClick={handleApplyPaste}
                            disabled={!configPaste.trim()}
                            className="rounded-xl bg-indigo-600 text-white px-3 text-[11px] font-semibold disabled:opacity-40 cursor-pointer shrink-0"
                          >
                            Importer
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <input type="text" value={fbProjectId} onChange={(e) => setFbProjectId(e.target.value)} placeholder="projectId" className={`${inputCls} font-mono`} />
                          <input type="password" value={fbApiKey} onChange={(e) => setFbApiKey(e.target.value)} placeholder="apiKey" className={`${inputCls} font-mono`} />
                          <input type="text" value={fbAuthDomain} onChange={(e) => setFbAuthDomain(e.target.value)} placeholder="authDomain (auto)" className={`${inputCls} font-mono`} />
                          <input type="text" value={fbBucket} onChange={(e) => setFbBucket(e.target.value)} placeholder="storageBucket (auto)" className={`${inputCls} font-mono`} />
                          <input type="text" value={fbSenderId} onChange={(e) => setFbSenderId(e.target.value)} placeholder="messagingSenderId" className={`${inputCls} font-mono`} />
                          <input type="text" value={fbAppId} onChange={(e) => setFbAppId(e.target.value)} placeholder="appId" className={`${inputCls} font-mono`} />
                        </div>
                      </div>
                    )}

                    <button
                      type="submit"
                      className="w-full rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 py-2.5 text-xs font-semibold cursor-pointer"
                    >
                      Enregistrer mon profil
                    </button>
                  </form>
                </div>
              )}

              {/* TAB 2: APIS & BRIDGE PRONOTE */}
              {tab === 'apis' && (
                <form onSubmit={handleSaveApis} className="space-y-4">
                  {/* Gemini API */}
                  <div className="rounded-2xl border border-violet-200/80 dark:border-violet-900/60 bg-violet-50/45 dark:bg-violet-950/20 p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-violet-800 dark:text-violet-200 flex items-center gap-1.5">
                        <Sparkles size={13} /> Clé API Gemini (Kora AI)
                      </p>
                      <button
                        type="button"
                        disabled={testingGemini || !geminiApiKey.trim()}
                        onClick={() => void handleTestGemini()}
                        className="text-[11px] font-semibold text-violet-700 dark:text-violet-300 hover:underline disabled:opacity-40 cursor-pointer"
                      >
                        {testingGemini ? 'Test…' : 'Tester la clé'}
                      </button>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <input
                        type={showGeminiKey ? 'text' : 'password'}
                        value={geminiApiKey}
                        onChange={(e) => {
                          setGeminiApiKey(e.target.value);
                          setGeminiStatus(null);
                        }}
                        placeholder="AIzaSy... (39 caractères · aistudio.google.com/apikey)"
                        className={`${inputCls} font-mono flex-1 min-w-0`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowGeminiKey((v) => !v)}
                        title={showGeminiKey ? 'Masquer' : 'Afficher la clé'}
                        className="h-8 w-8 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-center justify-center text-slate-500 cursor-pointer shrink-0"
                      >
                        {showGeminiKey ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                      {geminiApiKey && (
                        <button
                          type="button"
                          onClick={() => {
                            setGeminiApiKey('');
                            setGeminiStatus(null);
                          }}
                          title="Effacer"
                          className="h-8 w-8 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-center justify-center text-slate-400 hover:text-rose-500 cursor-pointer shrink-0"
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>

                    {geminiApiKey.trim() && (
                      <p className="text-[10px] font-mono text-slate-400">
                        Longueur : {geminiApiKey.trim().length} car. (attendu : 39, commence par AIza)
                      </p>
                    )}

                    {geminiStatus && (
                      <p
                        className={`text-[11px] font-medium break-words leading-relaxed ${
                          geminiStatus.ok
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {geminiStatus.text}
                      </p>
                    )}
                  </div>

                  {/* Pronote Bridge (Local / Linux TV + Tailscale) */}
                  <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold flex items-center gap-1.5">
                        <Server size={13} className="text-indigo-500" /> Bridge Pronote (Local ou Tailscale)
                      </p>
                      <button
                        type="button"
                        disabled={testingBridge || !pronoteUrl.trim()}
                        onClick={() => void handleTestBridge()}
                        className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-40 cursor-pointer"
                      >
                        {testingBridge ? 'Test…' : 'Tester /health'}
                      </button>
                    </div>
                    <input
                      type="url"
                      value={pronoteUrl}
                      onChange={(e) => setPronoteUrl(e.target.value)}
                      placeholder="https://pc-tv.mon-tailnet.ts.net ou http://127.0.0.1:4789"
                      className={`${inputCls} font-mono`}
                    />
                    <div className="flex items-center gap-1.5">
                      <KeyRound size={13} className="text-slate-400 shrink-0" />
                      <input
                        type="password"
                        value={pronoteToken}
                        onChange={(e) => setPronoteToken(e.target.value)}
                        placeholder="Token secret X-Kora-Token (optionnel mais recommandé sur Tailscale)"
                        className={`${inputCls} font-mono`}
                      />
                    </div>
                    {bridgeStatus && (
                      <p className="text-[11px] font-medium break-words text-slate-600 dark:text-zinc-300">
                        {bridgeStatus}
                      </p>
                    )}
                  </div>

                  <button
                    type="submit"
                    className="w-full rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 py-2.5 text-xs font-semibold cursor-pointer"
                  >
                    Sauvegarder les APIs
                  </button>
                </form>
              )}

              {/* TAB 3: DONNÉES */}
              {tab === 'data' && (
                <div className="space-y-3">
                  <p className="text-xs text-slate-500">
                    Tes données sont enregistrées localement et synchronisées dans ton compte dès que tu es connecté.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={handleExport}
                      className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-zinc-800 py-2.5 text-xs font-medium cursor-pointer"
                    >
                      <Download size={13} /> Exporter JSON
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-zinc-800 py-2.5 text-xs font-medium cursor-pointer"
                    >
                      <Upload size={13} /> Importer JSON
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="application/json"
                      onChange={handleImportFile}
                      className="hidden"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 dark:border-zinc-800">
                    <button
                      type="button"
                      onClick={() => {
                        resetToDemo();
                        onClose();
                      }}
                      className="flex items-center justify-center gap-1.5 rounded-xl bg-slate-100 dark:bg-zinc-800 py-2.5 text-xs font-medium cursor-pointer"
                    >
                      <RotateCcw size={13} /> Données démo
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        clearAllData();
                        onClose();
                      }}
                      className="flex items-center justify-center gap-1.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 py-2.5 text-xs font-medium text-rose-600 dark:text-rose-400 cursor-pointer"
                    >
                      <Trash2 size={13} /> Partir de zéro
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
