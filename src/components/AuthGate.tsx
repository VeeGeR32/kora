import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, Loader2, Lock, Mail, User } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { KoraLogo } from './ui/KoraLogo';

export function AuthGate() {
  const {
    authError,
    clearAuthError,
    connectGoogleCloud,
    connectEmailCloud,
    registerEmailCloud,
    clearAllData,
  } = useApp();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const errorText = localError || authError;

  const handleGoogle = async () => {
    setLocalError(null);
    clearAuthError();
    setBusy(true);
    try {
      await connectGoogleCloud();
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    clearAuthError();
    if (!email.trim() || password.length < 6) {
      setLocalError('Email valide et mot de passe (6+ caractères) requis.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'login') {
        await connectEmailCloud(email, password);
      } else {
        clearAllData();
        await registerEmailCloud(email, password, name);
      }
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    'w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50/80 dark:bg-zinc-900/70 pl-9 pr-3 py-2.5 text-sm text-slate-900 dark:text-zinc-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/15 dark:focus:ring-zinc-100/20';

  return (
    <div className="min-h-[100dvh] flex items-center justify-center p-4 bg-[var(--bg)] text-[var(--text)]">
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 360, damping: 30 }}
        className="w-full max-w-sm tempo-card rounded-3xl p-6 sm:p-7 space-y-5"
      >
        {/* Minimalist Brand Header */}
        <div className="flex flex-col items-center text-center space-y-2.5">
          <KoraLogo size={46} />
          <div>
            <h1 className="text-lg font-bold tracking-tight">Rowav Studio</h1>
            <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5">
              Sons · Projets · Textes — connecté à ton Google Drive
            </p>
          </div>
        </div>

        {/* Mode Toggle */}
        <div className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 dark:bg-zinc-900 p-1">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setLocalError(null);
              clearAuthError();
            }}
            className={`rounded-xl py-1.5 text-xs font-semibold transition cursor-pointer ${
              mode === 'login'
                ? 'bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 shadow-2xs'
                : 'text-slate-500'
            }`}
          >
            Se connecter
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('register');
              setLocalError(null);
              clearAuthError();
            }}
            className={`rounded-xl py-1.5 text-xs font-semibold transition cursor-pointer ${
              mode === 'register'
                ? 'bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 shadow-2xs'
                : 'text-slate-500'
            }`}
          >
            Créer un compte
          </button>
        </div>

        {/* Visible Inline Error Banner */}
        {errorText && (
          <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 px-3 py-2.5 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2 leading-relaxed">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span>{errorText}</span>
          </div>
        )}

        {/* Google Sign-In */}
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleGoogle()}
          className="w-full flex items-center justify-center gap-2.5 rounded-2xl bg-[#8C271E] hover:bg-[#A32E24] text-white py-3 text-xs font-semibold active:scale-[0.985] transition cursor-pointer disabled:opacity-50 shadow-sm shadow-[#8C271E]/25"
        >
          {busy ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
              <path
                fill="currentColor"
                d="M21.35 11.1h-9.18v2.98h5.27c-.23 1.35-1.52 3.96-5.27 3.96-3.17 0-5.76-2.63-5.76-5.87s2.59-5.87 5.76-5.87c1.81 0 3.02.77 3.71 1.43l2.53-2.44C16.79 3.77 14.69 2.8 12.17 2.8 6.99 2.8 2.8 6.99 2.8 12.17s4.19 9.37 9.37 9.37c5.41 0 9-3.8 9-9.16 0-.62-.07-1.08-.15-1.28z"
              />
            </svg>
          )}
          Continuer avec Google
        </button>

        <div className="relative flex items-center justify-center">
          <span className="border-t border-slate-200/80 dark:border-zinc-800 w-full" />
          <span className="bg-[var(--surface)] px-2.5 text-[10px] uppercase tracking-wider text-slate-400">
            ou email
          </span>
          <span className="border-t border-slate-200/80 dark:border-zinc-800 w-full" />
        </div>

        {/* Email / Password Form */}
        <form onSubmit={handleSubmit} className="space-y-2.5">
          {mode === 'register' && (
            <div className="relative">
              <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ton prénom / pseudo"
                className={inputCls}
              />
            </div>
          )}

          <div className="relative">
            <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Adresse email"
              className={inputCls}
            />
          </div>

          <div className="relative">
            <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mot de passe (6+ caractères)"
              className={inputCls}
            />
          </div>

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-2xl bg-[#8C271E] hover:bg-[#A32E24] text-white py-2.5 text-xs font-semibold transition cursor-pointer disabled:opacity-50 shadow-xs shadow-[#8C271E]/20"
          >
            {mode === 'login' ? 'Connexion' : 'Créer mon compte'}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
