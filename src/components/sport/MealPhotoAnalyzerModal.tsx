import React, { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  Camera,
  Check,
  Flame,
  ImagePlus,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react';
import type { MealSlot } from '../../types';
import { useApp } from '../../context/AppContext';
import { estimateMealFromPhoto, type PhotoMealEstimate } from '../../lib/koraAi';
import { MEAL_SLOT_LABELS } from '../../utils/theme';

interface MealPhotoAnalyzerModalProps {
  open: boolean;
  date: string;
  defaultSlot: MealSlot;
  onClose: () => void;
}

async function compressMealImage(
  file: File,
  maxSize = 960
): Promise<{ dataUrl: string; base64: string; mimeType: string }> {
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
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        const base64 = dataUrl.split(',')[1] || '';
        resolve({ dataUrl, base64, mimeType: 'image/jpeg' });
      };
      img.onerror = reject;
      img.src = String(reader.result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function MealPhotoAnalyzerModal({
  open,
  date,
  defaultSlot,
  onClose,
}: MealPhotoAnalyzerModalProps) {
  const { state, addMeal } = useApp();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const [image, setImage] = useState<{ dataUrl: string; base64: string; mimeType: string } | null>(
    null
  );
  const [hint, setHint] = useState('');
  const [slot, setSlot] = useState<MealSlot>(defaultSlot);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<PhotoMealEstimate | null>(null);

  // Editable draft fields once analyzed
  const [name, setName] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');

  const resetAll = () => {
    setImage(null);
    setHint('');
    setEstimate(null);
    setError(null);
    setAnalyzing(false);
    setName('');
    setCalories('');
    setProtein('');
    setCarbs('');
    setFat('');
  };

  const handleClose = () => {
    resetAll();
    onClose();
  };

  const runAnalysis = async (
    imgObj: { dataUrl: string; base64: string; mimeType: string },
    extraHint: string
  ) => {
    setAnalyzing(true);
    setError(null);
    try {
      const res = await estimateMealFromPhoto(
        state.preferences.geminiApiKey,
        { mimeType: imgObj.mimeType, base64: imgObj.base64 },
        extraHint
      );
      setEstimate(res);
      setName(res.name);
      setCalories(String(res.calories));
      setProtein(String(res.protein));
      setCarbs(String(res.carbs));
      setFat(String(res.fat));
    } catch (err) {
      setError((err as Error).message || 'Erreur lors de l’analyse photo.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleFilePicked = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setEstimate(null);
    try {
      const compressed = await compressMealImage(file);
      setImage(compressed);
      await runAnalysis(compressed, hint);
    } catch {
      setError('Impossible de lire cette image. Essaie un autre format (JPG, PNG, HEIC).');
    }
  };

  const handleConfirmMeal = (e: React.FormEvent) => {
    e.preventDefault();
    addMeal({
      date,
      slot,
      name: name.trim() || 'Repas photo IA',
      calories: Math.max(0, Math.round(Number(calories) || 0)),
      protein: Math.max(0, Math.round(Number(protein) || 0)),
      carbs: Math.max(0, Math.round(Number(carbs) || 0)),
      fat: Math.max(0, Math.round(Number(fat) || 0)),
    });
    handleClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            className="fixed inset-0 bg-slate-950/45 dark:bg-black/75 backdrop-blur-xs"
          />

          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            className="relative z-10 w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl bg-white dark:bg-[#121215] border border-slate-200 dark:border-zinc-800 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-zinc-800">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center">
                  <Camera size={15} />
                </div>
                <div>
                  <h2 className="text-sm font-semibold">Analyse photo IA · Kcal & Macros</h2>
                  <p className="text-[11px] text-slate-400">
                    Prends ton assiette en photo pour estimer automatiquement les macros
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 overflow-y-auto space-y-4 flex-1">
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => {
                  void handleFilePicked(e.target.files?.[0]);
                  e.target.value = '';
                }}
                className="hidden"
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => {
                  void handleFilePicked(e.target.files?.[0]);
                  e.target.value = '';
                }}
                className="hidden"
              />

              {/* Photo Dropzone or Preview */}
              {!image ? (
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    void handleFilePicked(e.dataTransfer.files?.[0]);
                  }}
                  className="rounded-2xl border-2 border-dashed border-slate-200 dark:border-zinc-800 p-6 text-center space-y-4 bg-slate-50/50 dark:bg-zinc-900/40"
                >
                  <div className="mx-auto h-12 w-12 rounded-2xl bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                    <Sparkles size={22} />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
                      Ajoute une photo de ton repas
                    </p>
                    <p className="text-xs text-slate-400">
                      L’IA identifie les aliments, portions, calories et protéines / glucides / lipides
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => cameraInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 text-xs font-semibold cursor-pointer"
                    >
                      <Camera size={14} /> Prendre une photo
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-xs font-medium text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-800 cursor-pointer"
                    >
                      <ImagePlus size={14} /> Galerie / Fichier
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="relative rounded-2xl overflow-hidden border border-slate-200 dark:border-zinc-800 bg-black/5">
                    <img
                      src={image.dataUrl}
                      alt="Repas à analyser"
                      className="w-full max-h-56 object-cover"
                    />
                    <button
                      type="button"
                      onClick={resetAll}
                      className="absolute top-2.5 right-2.5 rounded-full bg-black/65 text-white px-2.5 py-1 text-[11px] font-medium backdrop-blur-md hover:bg-black/80 cursor-pointer"
                    >
                      Changer photo
                    </button>
                  </div>

                  {/* Optional precision hint + re-analyze */}
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={hint}
                      onChange={(e) => setHint(e.target.value)}
                      placeholder="Précision optionnelle (ex. 150g riz cru, sauce barbecue…)"
                      className="flex-1 rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs outline-none focus:border-emerald-500"
                    />
                    <button
                      type="button"
                      disabled={analyzing}
                      onClick={() => void runAnalysis(image, hint)}
                      className="inline-flex items-center gap-1 rounded-xl border border-slate-200 dark:border-zinc-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 disabled:opacity-50 cursor-pointer shrink-0"
                    >
                      <RefreshCw size={12} className={analyzing ? 'animate-spin' : ''} />
                      Ré-analyser
                    </button>
                  </div>
                </div>
              )}

              {/* Loading State */}
              {analyzing && (
                <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/70 dark:bg-emerald-950/25 p-4 flex items-center justify-center gap-2.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                  <Loader2 size={16} className="animate-spin" />
                  Estimation IA des calories & macros en cours…
                </div>
              )}

              {/* Error State */}
              {error && (
                <div className="rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 px-3.5 py-3 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2 leading-relaxed">
                  <AlertCircle size={15} className="shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {/* Editable Result Form */}
              {estimate && !analyzing && (
                <form onSubmit={handleConfirmMeal} className="space-y-3.5 pt-1">
                  {estimate.details && (
                    <div className="rounded-2xl bg-slate-50 dark:bg-zinc-900/80 border border-slate-100 dark:border-zinc-800 p-3 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                          <Sparkles size={11} /> Détail estimé par l’IA
                        </span>
                        <span className="rounded-full bg-slate-200/70 dark:bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:text-zinc-300">
                          Confiance : {estimate.confidence}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-zinc-300 leading-relaxed">
                        {estimate.details}
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div className="sm:col-span-2">
                      <label className="block text-[10px] font-medium text-slate-400 mb-1">
                        Nom du repas
                      </label>
                      <input
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs font-medium"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-slate-400 mb-1">
                        Créneau
                      </label>
                      <select
                        value={slot}
                        onChange={(e) => setSlot(e.target.value as MealSlot)}
                        className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-2.5 py-2 text-xs"
                      >
                        {Object.entries(MEAL_SLOT_LABELS).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-2">
                    <div className="rounded-xl border border-emerald-200/80 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-950/20 p-2">
                      <label className="flex items-center gap-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                        <Flame size={10} /> Kcal
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={calories}
                        onChange={(e) => setCalories(e.target.value)}
                        className="w-full bg-transparent font-mono text-sm font-bold text-slate-900 dark:text-zinc-100 outline-none mt-0.5"
                      />
                    </div>
                    <div className="rounded-xl border border-indigo-200/80 dark:border-indigo-900/50 bg-indigo-50/40 dark:bg-indigo-950/20 p-2">
                      <label className="block text-[10px] font-medium text-indigo-600 dark:text-indigo-400">
                        Prot (g)
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={protein}
                        onChange={(e) => setProtein(e.target.value)}
                        className="w-full bg-transparent font-mono text-sm font-bold text-slate-900 dark:text-zinc-100 outline-none mt-0.5"
                      />
                    </div>
                    <div className="rounded-xl border border-amber-200/80 dark:border-amber-900/50 bg-amber-50/40 dark:bg-amber-950/20 p-2">
                      <label className="block text-[10px] font-medium text-amber-600 dark:text-amber-400">
                        Gluc (g)
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={carbs}
                        onChange={(e) => setCarbs(e.target.value)}
                        className="w-full bg-transparent font-mono text-sm font-bold text-slate-900 dark:text-zinc-100 outline-none mt-0.5"
                      />
                    </div>
                    <div className="rounded-xl border border-rose-200/80 dark:border-rose-900/50 bg-rose-50/40 dark:bg-rose-950/20 p-2">
                      <label className="block text-[10px] font-medium text-rose-600 dark:text-rose-400">
                        Lip (g)
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={fat}
                        onChange={(e) => setFat(e.target.value)}
                        className="w-full bg-transparent font-mono text-sm font-bold text-slate-900 dark:text-zinc-100 outline-none mt-0.5"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleClose}
                      className="rounded-xl px-3.5 py-2 text-xs font-medium text-slate-500 hover:text-slate-800 dark:hover:text-zinc-200 cursor-pointer"
                    >
                      Annuler
                    </button>
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 text-xs font-semibold cursor-pointer shadow-xs"
                    >
                      <Check size={14} /> Ajouter au journal
                    </button>
                  </div>
                </form>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
