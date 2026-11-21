import { useMemo, useRef, useState } from 'react';
import {
  Calendar,
  Camera,
  ImagePlus,
  MoveHorizontal,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { ProgressPhoto, ProgressPhotoAngle } from '../../types';
import { useApp } from '../../context/AppContext';
import { saveMediaBlob } from '../../lib/mediaDb';
import { formatShortDateFR, todayISO, uid } from '../../utils/dates';

const ANGLE_LABELS: Record<ProgressPhotoAngle, string> = {
  face: 'Face',
  profil: 'Profil',
  dos: 'Dos',
};

function daysBetweenISO(a: string, b: string): number {
  const ta = new Date(`${a}T12:00:00`).getTime();
  const tb = new Date(`${b}T12:00:00`).getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
  return Math.round((tb - ta) / (24 * 60 * 60 * 1000));
}

async function compressProgressPhoto(file: File, maxSize = 360): Promise<string> {
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
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = reject;
      img.src = String(reader.result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function BeforeAfterSlider({
  before,
  after,
}: {
  before: ProgressPhoto;
  after: ProgressPhoto;
}) {
  const [pct, setPct] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);

  const updateFromClientX = (clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setPct(Math.round(ratio * 100));
  };

  const daysDiff = Math.max(0, daysBetweenISO(before.date, after.date));
  const weightDelta =
    typeof before.weightKg === 'number' && typeof after.weightKg === 'number'
      ? after.weightKg - before.weightKg
      : null;

  return (
    <div className="space-y-2.5">
      <div
        ref={containerRef}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          updateFromClientX(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 0 && e.pointerType === 'mouse') return;
          updateFromClientX(e.clientX);
        }}
        style={{ touchAction: 'none' }}
        className="relative aspect-[4/5] sm:aspect-[16/11] w-full rounded-2xl overflow-hidden bg-zinc-950 border border-slate-200/80 dark:border-zinc-800 select-none cursor-ew-resize"
      >
        {/* AFTER (Right / Full background) */}
        <img
          src={after.thumbDataUrl}
          alt={after.label}
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover pointer-events-none"
        />

        {/* BEFORE (Left clipped layer) */}
        <div
          style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }}
          className="absolute inset-0 pointer-events-none"
        >
          <img
            src={before.thumbDataUrl}
            alt={before.label}
            draggable={false}
            className="h-full w-full object-cover"
          />
        </div>

        {/* Vertical Divider + Handle */}
        <div
          style={{ left: `${pct}%` }}
          className="pointer-events-none absolute inset-y-0 w-[2px] -translate-x-1/2 bg-white shadow-[0_0_12px_rgba(0,0,0,0.8)]"
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-white text-zinc-900 shadow-lg flex items-center justify-center">
            <MoveHorizontal size={15} />
          </div>
        </div>

        {/* Labels */}
        <div className="pointer-events-none absolute top-2.5 left-2.5 rounded-full bg-black/65 backdrop-blur-md px-2.5 py-1 text-[10px] font-semibold text-white">
          {before.label} · {formatShortDateFR(before.date)}
          {before.weightKg ? ` · ${before.weightKg} kg` : ''}
        </div>
        <div className="pointer-events-none absolute top-2.5 right-2.5 rounded-full bg-emerald-600/90 backdrop-blur-md px-2.5 py-1 text-[10px] font-semibold text-white">
          {after.label} · {formatShortDateFR(after.date)}
          {after.weightKg ? ` · ${after.weightKg} kg` : ''}
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-zinc-400 px-0.5">
        <span>
          Écart : <strong className="text-slate-800 dark:text-zinc-200">{daysDiff} jours</strong> (
          {Math.max(1, Math.round(daysDiff / 7))} sem.)
        </span>
        {weightDelta !== null && (
          <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
            {weightDelta > 0 ? '+' : ''}
            {weightDelta.toFixed(1)} kg
          </span>
        )}
      </div>
    </div>
  );
}

export function BodyEvolutionSection() {
  const { state, updateFitnessProfile, notify } = useApp();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const today = todayISO();
  const sortedWeights = useMemo(
    () => [...state.weights].sort((a, b) => a.date.localeCompare(b.date)),
    [state.weights]
  );
  const latestWeight = sortedWeights[sortedWeights.length - 1]?.weightKg;

  const photos = useMemo(
    () =>
      [...(state.fitnessProfile.progressPhotos || [])].sort((a, b) =>
        a.date.localeCompare(b.date)
      ),
    [state.fitnessProfile.progressPhotos]
  );

  const baselinePhoto = photos.find((p) => p.isBaseline) || photos[0] || null;
  const latestPhoto = photos[photos.length - 1] || null;

  const daysSinceLast = latestPhoto ? Math.max(0, daysBetweenISO(latestPhoto.date, today)) : null;
  const currentWeekNum = baselinePhoto
    ? Math.max(1, Math.floor(Math.max(0, daysBetweenISO(baselinePhoto.date, today)) / 7) + 1)
    : 1;
  const weeklyDue = photos.length > 0 && daysSinceLast !== null && daysSinceLast >= 7;

  // Upload composer state
  const [composerOpen, setComposerOpen] = useState(false);
  const [draftAngle, setDraftAngle] = useState<ProgressPhotoAngle>('face');
  const [draftWeight, setDraftWeight] = useState(latestWeight ? String(latestWeight) : '');
  const [draftDate, setDraftDate] = useState(today);
  const [draftNote, setDraftNote] = useState('');
  const [saving, setSaving] = useState(false);

  // Comparison selection
  const [beforeId, setBeforeId] = useState<string>('');
  const [afterId, setAfterId] = useState<string>('');
  const [lightboxPhoto, setLightboxPhoto] = useState<ProgressPhoto | null>(null);

  const resolvedBefore =
    photos.find((p) => p.id === beforeId) || baselinePhoto || photos[0] || null;
  const resolvedAfter =
    photos.find((p) => p.id === afterId) || latestPhoto || photos[photos.length - 1] || null;

  const handleSavePhotoFile = async (file: File | undefined) => {
    if (!file) return;
    setSaving(true);
    try {
      const thumbDataUrl = await compressProgressPhoto(file, 360);
      const mediaId = uid('body');
      await saveMediaBlob(mediaId, file, file.name);

      const isFirst = photos.length === 0;
      const weekNum = baselinePhoto
        ? Math.max(1, Math.floor(Math.max(0, daysBetweenISO(baselinePhoto.date, draftDate)) / 7) + 1)
        : 1;
      const parsedWeight = parseFloat(draftWeight.replace(',', '.'));
      const weightKg =
        !isNaN(parsedWeight) && parsedWeight >= 25 && parsedWeight <= 250
          ? Math.round(parsedWeight * 10) / 10
          : latestWeight;

      const entry: ProgressPhoto = {
        id: uid('ph'),
        date: draftDate || today,
        label: isFirst ? 'Photo initiale · Jour 1' : `Semaine ${weekNum}`,
        angle: draftAngle,
        weightKg,
        note: draftNote.trim() || undefined,
        thumbDataUrl,
        mediaId,
        isBaseline: isFirst || undefined,
        createdAt: new Date().toISOString(),
      };

      const next = [...photos, entry];
      updateFitnessProfile({ progressPhotos: next });
      setDraftNote('');
      setComposerOpen(false);
      notify(
        isFirst
          ? 'Photo initiale enregistrée · Ton suivi visuel démarre !'
          : `Check-in ${entry.label} enregistré ✓`
      );
    } catch {
      notify('Impossible de charger cette photo');
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePhoto = (id: string) => {
    const next = photos.filter((p) => p.id !== id);
    updateFitnessProfile({ progressPhotos: next });
    notify('Photo supprimée');
  };

  return (
    <section className="space-y-4">
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="user"
        onChange={(e) => {
          void handleSavePhotoFile(e.target.files?.[0]);
          e.target.value = '';
        }}
        className="hidden"
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        onChange={(e) => {
          void handleSavePhotoFile(e.target.files?.[0]);
          e.target.value = '';
        }}
        className="hidden"
      />

      {/* Section Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
            Évolution visuelle physique
          </h2>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {photos.length === 0
              ? 'Prends ta photo initiale (Jour 1), puis un check-in chaque semaine'
              : `${photos.length} photo${photos.length > 1 ? 's' : ''} · Semaine ${currentWeekNum} · synchronisées sur tes appareils`}
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setDraftDate(today);
            setDraftWeight(latestWeight ? String(latestWeight) : '');
            setComposerOpen((v) => !v);
          }}
          className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-3.5 py-2 text-xs font-semibold hover:opacity-92 transition cursor-pointer"
        >
          <Plus size={13} />
          {photos.length === 0 ? 'Photo initiale (Jour 1)' : 'Check-in photo'}
        </button>
      </div>

      {/* Onboarding Prompt (Day 1) OR Weekly Reminder Banner */}
      {photos.length === 0 && !composerOpen && (
        <div className="tempo-card rounded-3xl p-6 text-center space-y-3 border-dashed border-2 border-emerald-300/70 dark:border-emerald-800/70 bg-emerald-50/35 dark:bg-emerald-950/15">
          <div className="mx-auto h-12 w-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-sm">
            <Camera size={22} />
          </div>
          <div className="space-y-1 max-w-md mx-auto">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
              Commence avec ta photo initiale (Jour 1)
            </h3>
            <p className="text-xs text-slate-500 dark:text-zinc-400 leading-relaxed">
              Kora te proposera un check-in chaque semaine et générera ton comparateur Avant / Après dans le Showcase mensuel.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setDraftDate(today);
              setDraftWeight(latestWeight ? String(latestWeight) : '');
              setComposerOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 text-xs font-semibold cursor-pointer"
          >
            <Camera size={14} /> Ajouter ma photo initiale
          </button>
        </div>
      )}

      {weeklyDue && !composerOpen && (
        <div className="rounded-2xl border border-emerald-300/80 dark:border-emerald-800/80 bg-emerald-50/70 dark:bg-emerald-950/25 px-4 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-9 w-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
              <Sparkles size={16} />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-emerald-950 dark:text-emerald-200">
                Check-in Semaine {currentWeekNum} prêt !
              </p>
              <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                Dernière photo il y a {daysSinceLast} jours — ajoute ta photo de cette semaine pour suivre ta progression.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setDraftDate(today);
              setDraftWeight(latestWeight ? String(latestWeight) : '');
              setComposerOpen(true);
            }}
            className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 text-xs font-semibold cursor-pointer shrink-0"
          >
            Faire le check-in
          </button>
        </div>
      )}

      {!weeklyDue && photos.length > 0 && !composerOpen && daysSinceLast !== null && (
        <div className="flex items-center gap-2 text-[11px] text-slate-400 px-1">
          <Calendar size={12} className="text-emerald-500" />
          <span>
            Prochain check-in hebdo recommandé dans{' '}
            <strong className="text-slate-600 dark:text-zinc-300">
              {Math.max(1, 7 - daysSinceLast)} jour{7 - daysSinceLast > 1 ? 's' : ''}
            </strong>
            .
          </span>
        </div>
      )}

      {/* Upload Composer Panel */}
      {composerOpen && (
        <div className="tempo-card rounded-3xl p-4 sm:p-5 space-y-3.5 border border-emerald-300/70 dark:border-emerald-800/70">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-900 dark:text-zinc-100">
              {photos.length === 0
                ? 'Nouvelle photo initiale (Jour 1)'
                : `Nouveau check-in · Semaine ${currentWeekNum}`}
            </p>
            <button
              type="button"
              onClick={() => setComposerOpen(false)}
              className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div>
              <label className="block text-[10px] font-medium text-slate-400 mb-1">Angle</label>
              <div className="grid grid-cols-3 gap-1">
                {(['face', 'profil', 'dos'] as ProgressPhotoAngle[]).map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setDraftAngle(a)}
                    className={`rounded-xl py-2 text-xs font-medium transition cursor-pointer ${
                      draftAngle === a
                        ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                        : 'bg-slate-100 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400'
                    }`}
                  >
                    {ANGLE_LABELS[a]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-medium text-slate-400 mb-1">Date</label>
              <input
                type="date"
                value={draftDate}
                onChange={(e) => setDraftDate(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 font-mono text-xs"
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-slate-400 mb-1">
                Poids du jour (kg)
              </label>
              <input
                type="number"
                step="0.1"
                value={draftWeight}
                onChange={(e) => setDraftWeight(e.target.value)}
                placeholder={latestWeight ? String(latestWeight) : '73.0'}
                className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 font-mono text-xs"
              />
            </div>
          </div>

          <input
            type="text"
            value={draftNote}
            onChange={(e) => setDraftNote(e.target.value)}
            placeholder="Note optionnelle (ex. À jeun, lumière naturelle, fin de semaine 4…)"
            className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs"
          />

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              disabled={saving}
              onClick={() => cameraInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 text-xs font-semibold disabled:opacity-50 cursor-pointer"
            >
              <Camera size={14} /> Prendre une photo
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => galleryInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2 text-xs font-medium text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-800 disabled:opacity-50 cursor-pointer"
            >
              <ImagePlus size={14} /> Choisir dans la galerie
            </button>
          </div>
        </div>
      )}

      {/* Interactive Before / After Comparison Slider (>= 2 photos) */}
      {photos.length >= 2 && resolvedBefore && resolvedAfter && (
        <div className="tempo-card rounded-3xl p-4 sm:p-5 space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Comparateur Avant / Après
            </h3>
            <div className="flex items-center gap-1.5 flex-wrap">
              <select
                value={resolvedBefore.id}
                onChange={(e) => setBeforeId(e.target.value)}
                className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-2 py-1 text-[11px]"
              >
                {photos.map((p) => (
                  <option key={p.id} value={p.id}>
                    Avant : {p.label} ({formatShortDateFR(p.date)})
                  </option>
                ))}
              </select>
              <span className="text-xs text-slate-400">vs</span>
              <select
                value={resolvedAfter.id}
                onChange={(e) => setAfterId(e.target.value)}
                className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-2 py-1 text-[11px]"
              >
                {photos.map((p) => (
                  <option key={p.id} value={p.id}>
                    Après : {p.label} ({formatShortDateFR(p.date)})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <BeforeAfterSlider before={resolvedBefore} after={resolvedAfter} />
        </div>
      )}

      {/* Chronological Timeline Gallery */}
      {photos.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {[...photos].reverse().map((ph) => (
            <div
              key={ph.id}
              className="group relative rounded-2xl overflow-hidden border border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900"
            >
              <button
                type="button"
                onClick={() => setLightboxPhoto(ph)}
                className="block w-full aspect-[3/4] overflow-hidden bg-zinc-950 cursor-pointer"
              >
                <img
                  src={ph.thumbDataUrl}
                  alt={ph.label}
                  className="h-full w-full object-cover group-hover:scale-105 transition duration-300"
                />
              </button>

              <span className="absolute top-2 left-2 rounded-full bg-black/60 backdrop-blur-md px-2 py-0.5 text-[9px] font-semibold text-white">
                {ANGLE_LABELS[ph.angle]}
              </span>

              <button
                type="button"
                onClick={() => handleDeletePhoto(ph.id)}
                title="Supprimer cette photo"
                className="absolute top-2 right-2 h-6 w-6 rounded-full bg-black/60 text-white/80 hover:text-rose-400 flex items-center justify-center opacity-80 sm:opacity-0 group-hover:opacity-100 transition cursor-pointer"
              >
                <Trash2 size={11} />
              </button>

              <div className="p-2.5 space-y-0.5">
                <div className="flex items-center justify-between gap-1">
                  <p className="text-[11px] font-semibold text-slate-900 dark:text-zinc-100 truncate">
                    {ph.label}
                  </p>
                  {ph.weightKg && (
                    <span className="font-mono text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 shrink-0">
                      {ph.weightKg} kg
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-slate-400 truncate">
                  {formatShortDateFR(ph.date)}
                  {ph.note ? ` · ${ph.note}` : ''}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Fullscreen Lightbox */}
      {lightboxPhoto && (
        <div
          onClick={() => setLightboxPhoto(null)}
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-md w-full rounded-3xl overflow-hidden bg-zinc-950 border border-white/15 shadow-2xl"
          >
            <img
              src={lightboxPhoto.thumbDataUrl}
              alt={lightboxPhoto.label}
              className="w-full max-h-[72vh] object-contain bg-black"
            />
            <div className="p-4 flex items-center justify-between gap-2 text-white">
              <div>
                <p className="text-sm font-semibold">{lightboxPhoto.label}</p>
                <p className="text-xs text-zinc-400">
                  {formatShortDateFR(lightboxPhoto.date)} · {ANGLE_LABELS[lightboxPhoto.angle]}
                  {lightboxPhoto.weightKg ? ` · ${lightboxPhoto.weightKg} kg` : ''}
                </p>
                {lightboxPhoto.note && (
                  <p className="text-xs text-zinc-300 mt-1">{lightboxPhoto.note}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setLightboxPhoto(null)}
                className="h-9 w-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
