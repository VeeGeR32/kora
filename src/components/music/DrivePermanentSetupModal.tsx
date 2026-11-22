import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  Copy,
  ExternalLink,
  FolderPlus,
  HardDrive,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import type { DriveSource } from '../../types';

interface DriveSourcesManagerProps {
  onConnected?: () => void;
  compact?: boolean;
}

export function DriveSourcesManager({ onConnected, compact = false }: DriveSourcesManagerProps) {
  const {
    driveSources,
    serviceAccountEmail,
    autoSyncingDrive,
    connectDriveSource,
    updateDriveSource,
    removeDriveSource,
    syncAllConnectedDrives,
  } = useApp();

  const [copied, setCopied] = useState(false);
  const [showAddForm, setShowAddForm] = useState(driveSources.length === 0);
  const [folderInput, setFolderInput] = useState('');
  const [customName, setCustomName] = useState('');
  const [busyAdd, setBusyAdd] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Inline editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editFolderInput, setEditFolderInput] = useState('');
  const [busyEditId, setBusyEditId] = useState<string | null>(null);
  const [busyRemoveId, setBusyRemoveId] = useState<string | null>(null);

  const handleCopyEmail = async () => {
    if (!serviceAccountEmail) return;
    try {
      await navigator.clipboard.writeText(serviceAccountEmail);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!folderInput.trim()) {
      setErrorMsg('Colle le lien ou l’identifiant de ton dossier Google Drive.');
      return;
    }
    setBusyAdd(true);
    try {
      const res = await connectDriveSource(folderInput.trim(), customName.trim() || undefined);
      if (!res.ok) {
        setErrorMsg(res.error || 'Impossible de connecter ce dossier Google Drive.');
        return;
      }
      setFolderInput('');
      setCustomName('');
      setShowAddForm(false);
      onConnected?.();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusyAdd(false);
    }
  };

  const startEdit = (source: DriveSource) => {
    setEditingId(source.id);
    setEditName(source.name);
    setEditFolderInput(source.url || (source.folderId === 'root' ? '' : source.folderId));
    setErrorMsg(null);
  };

  const handleSaveEdit = async (source: DriveSource) => {
    setBusyEditId(source.id);
    setErrorMsg(null);
    try {
      const nextFolder = editFolderInput.trim();
      const folderChanged =
        source.folderId !== 'root' &&
        nextFolder &&
        nextFolder !== source.url &&
        nextFolder !== source.folderId;
      const res = await updateDriveSource(source.id, {
        name: editName.trim() || source.name,
        ...(folderChanged ? { folderInput: nextFolder } : {}),
      });
      if (!res.ok) {
        setErrorMsg(res.error || 'Impossible de modifier ce Drive.');
        return;
      }
      setEditingId(null);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusyEditId(null);
    }
  };

  const handleRemove = async (source: DriveSource) => {
    setBusyRemoveId(source.id);
    setErrorMsg(null);
    try {
      await removeDriveSource(source.id);
      if (driveSources.length <= 1) {
        setShowAddForm(true);
      }
    } finally {
      setBusyRemoveId(null);
    }
  };

  const inputCls =
    'w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-xs text-slate-900 dark:text-zinc-100 placeholder:text-slate-400 focus:outline-none focus:border-slate-400 dark:focus:border-zinc-600 transition';

  return (
    <div className="space-y-4">
      {/* Connected Drives List */}
      {driveSources.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-zinc-500">
              Drives connectés ({driveSources.length})
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={autoSyncingDrive}
                onClick={() => void syncAllConnectedDrives({ forceRefresh: true })}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200/80 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 disabled:opacity-50 transition cursor-pointer"
              >
                <RefreshCw size={11} className={autoSyncingDrive ? 'animate-spin' : ''} />
                Tout synchroniser
              </button>
              {!showAddForm && (
                <button
                  type="button"
                  onClick={() => {
                    setShowAddForm(true);
                    setErrorMsg(null);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-2.5 py-1 text-[11px] font-semibold hover:opacity-90 transition cursor-pointer"
                >
                  <Plus size={11} /> Ajouter un Drive
                </button>
              )}
            </div>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-zinc-800/80 rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/40 dark:bg-zinc-900/40 overflow-hidden">
            {driveSources.map((src) => {
              const isEditing = editingId === src.id;
              const isBusyEdit = busyEditId === src.id;
              const isBusyRemove = busyRemoveId === src.id;
              const driveHref =
                src.folderId === 'root'
                  ? 'https://drive.google.com/drive/my-drive'
                  : src.url || `https://drive.google.com/drive/folders/${src.folderId}`;

              return (
                <div key={src.id} className="p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="h-8 w-8 rounded-xl bg-slate-900/6 dark:bg-zinc-100/8 text-slate-700 dark:text-zinc-200 flex items-center justify-center shrink-0">
                        <HardDrive size={15} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs font-semibold text-slate-900 dark:text-zinc-100 truncate">
                            {src.name}
                          </p>
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-slate-400 dark:text-zinc-500">
                          <span className="font-mono">
                            {typeof src.trackCount === 'number'
                              ? `${src.trackCount} MP3`
                              : 'Synchronisé'}
                          </span>
                          <span>·</span>
                          <a
                            href={driveHref}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-0.5 hover:text-slate-700 dark:hover:text-zinc-300 hover:underline"
                          >
                            Ouvrir Drive <ExternalLink size={10} />
                          </a>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => (isEditing ? setEditingId(null) : startEdit(src))}
                        title="Renommer ou modifier le lien du dossier"
                        className="h-7 w-7 rounded-lg inline-flex items-center justify-center text-slate-400 hover:text-slate-800 dark:hover:text-zinc-100 hover:bg-slate-200/60 dark:hover:bg-zinc-800 transition cursor-pointer"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        disabled={isBusyRemove || autoSyncingDrive}
                        onClick={() => void handleRemove(src)}
                        title="Déconnecter ce Drive"
                        className="h-7 w-7 rounded-lg inline-flex items-center justify-center text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-40 transition cursor-pointer"
                      >
                        {isBusyRemove ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <Trash2 size={13} />
                        )}
                      </button>
                    </div>
                  </div>

                  {isEditing && (
                    <div className="pt-2 border-t border-slate-200/60 dark:border-zinc-800/80 space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          placeholder="Nom du Drive (ex. Studio 2026)"
                          className={inputCls}
                        />
                        {src.folderId !== 'root' && (
                          <input
                            type="text"
                            value={editFolderInput}
                            onChange={(e) => setEditFolderInput(e.target.value)}
                            placeholder="Lien du dossier Google Drive"
                            className={inputCls}
                          />
                        )}
                      </div>
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="rounded-lg px-2.5 py-1 text-[11px] font-medium text-slate-500 hover:text-slate-800 dark:hover:text-zinc-200 cursor-pointer"
                        >
                          Annuler
                        </button>
                        <button
                          type="button"
                          disabled={isBusyEdit}
                          onClick={() => void handleSaveEdit(src)}
                          className="inline-flex items-center gap-1 rounded-lg bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-3 py-1 text-[11px] font-semibold disabled:opacity-50 cursor-pointer"
                        >
                          {isBusyEdit && <Loader2 size={11} className="animate-spin" />}
                          Enregistrer & Resync
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Connect New Drive Form */}
      {(showAddForm || driveSources.length === 0) && (
        <form
          onSubmit={handleConnect}
          className="rounded-2xl border border-slate-200/90 dark:border-zinc-800 bg-slate-50/60 dark:bg-zinc-900/50 p-4 space-y-3.5"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FolderPlus size={15} className="text-slate-700 dark:text-zinc-200" />
              <h4 className="text-xs font-semibold text-slate-900 dark:text-zinc-100">
                {driveSources.length === 0
                  ? 'Connecter ton dossier Google Drive'
                  : 'Ajouter un autre dossier Google Drive'}
              </h4>
            </div>
            {driveSources.length > 0 && (
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="text-[11px] text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer"
              >
                Fermer
              </button>
            )}
          </div>

          {/* Step 1: Share folder */}
          <div className="rounded-xl border border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-medium text-slate-700 dark:text-zinc-300">
                <strong className="font-semibold">1.</strong> Dans{' '}
                <a
                  href="https://drive.google.com/drive/my-drive"
                  target="_blank"
                  rel="noreferrer"
                  className="underline font-semibold hover:opacity-80 inline-flex items-center gap-0.5"
                >
                  Google Drive <ExternalLink size={10} />
                </a>
                , partage ton dossier de sons en mode <strong>Lecteur</strong> avec :
              </p>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-lg bg-slate-50 dark:bg-zinc-900 border border-slate-200/70 dark:border-zinc-800 px-2.5 py-1.5 font-mono text-[11px] text-slate-800 dark:text-zinc-200 truncate select-all">
                {serviceAccountEmail || 'Chargement…'}
              </code>
              <button
                type="button"
                disabled={!serviceAccountEmail}
                onClick={() => void handleCopyEmail()}
                className="inline-flex items-center gap-1 rounded-lg bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-3 py-1.5 text-[11px] font-semibold hover:opacity-90 disabled:opacity-40 cursor-pointer shrink-0"
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? 'Copié' : 'Copier'}
              </button>
            </div>
            <p className="text-[10px] text-slate-400 dark:text-zinc-500">
              Astuce : fonctionne aussi si le dossier est en « Tous les utilisateurs disposant du lien (Lecteur) ».
            </p>
          </div>

          {/* Step 2: Paste folder URL */}
          <div className="space-y-2">
            <label className="block text-[11px] font-medium text-slate-700 dark:text-zinc-300">
              <strong className="font-semibold">2.</strong> Colle le lien de ton dossier Google Drive :
            </label>
            <input
              type="text"
              required
              value={folderInput}
              onChange={(e) => setFolderInput(e.target.value)}
              placeholder="https://drive.google.com/drive/folders/1AbC..."
              className={inputCls}
            />
            {!compact && (
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="Nom optionnel (ex. Sons 2026, Maquettes, Prods…)"
                className={inputCls}
              />
            )}
          </div>

          {errorMsg && (
            <p className="rounded-xl bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-[11px] text-rose-600 dark:text-rose-400">
              {errorMsg}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-0.5">
            <button
              type="submit"
              disabled={busyAdd || autoSyncingDrive}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-4 py-2.5 text-xs font-semibold hover:opacity-92 disabled:opacity-50 transition cursor-pointer"
            >
              {busyAdd || autoSyncingDrive ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Check size={13} />
              )}
              Connecter & Synchroniser
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

interface DrivePermanentSetupModalProps {
  open: boolean;
  onClose: () => void;
}

export function DrivePermanentSetupModal({ open, onClose }: DrivePermanentSetupModalProps) {
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[75] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-950/50 dark:bg-black/75 backdrop-blur-xs"
          />

          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.97 }}
            className="relative z-10 w-full sm:max-w-lg max-h-[88dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-white dark:bg-[#121215] border border-slate-200 dark:border-zinc-800 shadow-2xl"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-zinc-800 bg-white/95 dark:bg-[#121215]/95 backdrop-blur-md">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 flex items-center justify-center">
                  <HardDrive size={16} />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
                    Google Drives connectés
                  </h2>
                  <p className="text-[11px] text-slate-400">
                    Ajoute, modifie ou retire tes dossiers MP3 · Synchronisation instantanée
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5">
              <DriveSourcesManager
                onConnected={() => {
                  // Close automatically if it was the first Drive connection from onboarding
                }}
              />
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
