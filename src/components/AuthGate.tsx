import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Lock, Mail, Sparkles, User } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { KoraLogo } from './ui/KoraLogo';

export function AuthGate() {
  const {
    connectGoogleCloud,
    connectEmailCloud,
    registerEmailCloud,
    resetToDemo,
    clearAllData,
    notify,
  } = useApp();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [startWithDemo, setStartWithDemo] = useState(true);
  const [busy, setBusy] = useState(false);

  const handleGoogle = async () => {
    setBusy(true);
    try {
      await connectGoogleCloud();
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || password.length < 6) {
      notify('Email valide et mot de passe (6+ caractères) requis');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'login') {
        await connectEmailCloud(email, password);
      } else {
        if (startWithDemo) resetToDemo();
        else clearAllData();
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
        className="w-full max-w-sm tempo-card rounded-3xl p-6 sm:p-7 space-y-6"
      >
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center space-y-2.5">
          <KoraLogo size={46} />
          <div>
            <h1 className="text-xl font-bold tracking-tight">Bienvenue sur Kora</h1>
            <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5">
              Cours · Gym · Music · IA — synchronisé partout
            </p>
          </div>
        </div>

        {/* Mode Toggle */}
        <div className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 dark:bg-zinc-900 p-1">
          <button
            type="button"
            onClick={() => setMode('login')}
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
            onClick={() => setMode('register')}
            className={`rounded-xl py-1.5 text-xs font-semibold transition cursor-pointer ${
              mode === 'register'
                ? 'bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 shadow-2xs'
                : 'text-slate-500'
            }`}
          >
            Créer un compte
          </button>
        </div>

        {/* Google Sign-In */}
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleGoogle()}
          className="w-full flex items-center justify-center gap-2.5 rounded-2xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 py-3 text-xs font-semibold hover:opacity-92 active:scale-[0.985] transition cursor-pointer disabled:opacity-50 shadow-xs"
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

          {mode === 'register' && (
            <label className="flex items-center justify-between rounded-xl bg-slate-50 dark:bg-zinc-900/60 border border-slate-200/70 dark:border-zinc-800 px-3 py-2 cursor-pointer">
              <span className="text-[11px] text-slate-600 dark:text-zinc-300 flex items-center gap-1.5">
                <Sparkles size={12} className="text-violet-500" />
                Pré-remplir avec des données démo
              </span>
              <input
                type="checkbox"
                checked={startWithDemo}
                onChange={(e) => setStartWithDemo(e.target.checked)}
                className="accent-violet-600 h-4 w-4 cursor-pointer"
              />
            </label>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-2xl bg-indigo-600 text-white py-2.5 text-xs font-semibold hover:bg-indigo-700 transition cursor-pointer disabled:opacity-50"
          >
            {mode === 'login' ? 'Connexion' : 'Créer mon espace Kora'}
          </button>
        </form>

        <p className="text-[11px] text-center text-slate-400 dark:text-zinc-500 leading-relaxed">
          Tu pourras charger ou vider les données démo à tout moment depuis <strong>Paramètres → Données</strong>.
        </p>
      </motion.div>
    </div>
  );
}
