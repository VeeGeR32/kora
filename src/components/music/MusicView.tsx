import React, { useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowDownAZ,
  Calendar,
  CalendarPlus,
  CloudDownload,
  Disc3,
  FileText,
  FolderKanban,
  GitBranch,
  HardDrive,
  Layers,
  ListChecks,
  Loader2,
  Pause,
  Play,
  Plus,
  Search,
  Star,
  Upload,
} from 'lucide-react';
import type { MusicTrack, ProjectKind } from '../../types';
import { useApp } from '../../context/AppContext';
import { useAudioPlayer } from '../../context/AudioPlayerContext';
import {
  ensureGoogleDriveToken,
  listAllGoogleDriveAudioFilesWithExclusions,
} from '../../lib/googleDrive';
import {
  getDeterministicGradientId,
  groupMusicTracks,
  parseTrackVersion,
  type TrackGroup,
} from '../../lib/musicVersioning';
import { todayISO, uid } from '../../utils/dates';
import { LyricsStudio } from './LyricsStudio';
import { GoogleDrivePickerModal } from './GoogleDrivePickerModal';
import { ProjectAlbumModal } from './ProjectAlbumModal';
import { TrackCard } from './TrackCard';
import { TrackContextMenu, type TrackContextMenuState } from './TrackContextMenu';
import { TrackDetailModal } from './TrackDetailModal';
import { getGradientClass, PROJECT_GRADIENTS } from './MiniAudioPlayer';
import type { QuickAddContext } from '../QuickAddModal';

interface MusicViewProps {
  onOpenQuickAdd: (ctx?: QuickAddContext) => void;
}

type MusicSubTab = 'dashboard' | 'library' | 'lyrics';
type LibraryFilter = 'all' | 'favorites' | 'todo';
type LibrarySort = 'recent' | 'name' | 'versions';

export function MusicView({ onOpenQuickAdd }: MusicViewProps) {
  const {
    state,
    addMusicTrack,
    syncMusicTracksBatch,
    updateMusicTrack,
    setTrackGroupFavorite,
    addMusicProject,
    addLyricsDoc,
    saveAndOptionallySyncMedia,
    notify,
  } = useApp();

  const player = useAudioPlayer();
  const [subTab, setSubTab] = useState<MusicSubTab>('dashboard');
  const [selectedLyricsId, setSelectedLyricsId] = useState<string | null>(null);

  // Selected version override per groupKey (defaults to latest version)
  const [selectedVersionByGroup, setSelectedVersionByGroup] = useState<Record<string, string>>({});

  // Context Menu & Track Detail Modal
  const [contextMenu, setContextMenu] = useState<TrackContextMenuState | null>(null);
  const [detailTarget, setDetailTarget] = useState<{ groupKey: string; trackId: string } | null>(
    null
  );

  // Google Drive Full Sync state
  const [syncingDrive, setSyncingDrive] = useState(false);
  const [syncProgressText, setSyncProgressText] = useState('');
  const [drivePickerOpen, setDrivePickerOpen] = useState(false);

  // Library search / filter / sort / grouping toggle
  const [libSearch, setLibSearch] = useState('');
  const [libFilter, setLibFilter] = useState<LibraryFilter>('all');
  const [libSort, setLibSort] = useState<LibrarySort>('recent');
  const [groupVersions, setGroupVersions] = useState(true);

  // New project quick modal inline
  const [showNewProj, setShowNewProj] = useState(false);
  const [newProjTitle, setNewProjTitle] = useState('');
  const [newProjKind, setNewProjKind] = useState<ProjectKind>('ep');
  const [newProjDate, setNewProjDate] = useState('');
  const [openProjectId, setOpenProjectId] = useState<string | null>(null);

  const audioInputRef = useRef<HTMLInputElement>(null);

  // Grouped tracks (deduplicated by project/base name, latest version promoted to front!)
  const trackGroups = useMemo(() => groupMusicTracks(state.musicTracks), [state.musicTracks]);

  // Flat individual pseudo-groups when user toggles "Toutes les versions" in library
  const flatTrackGroups = useMemo<TrackGroup[]>(() => {
    return [...state.musicTracks]
      .sort((a, b) => {
        const ta = new Date(a.modifiedAt || a.addedAt || 0).getTime();
        const tb = new Date(b.modifiedAt || b.addedAt || 0).getTime();
        return tb - ta;
      })
      .map((t) => {
        const parsed = parseTrackVersion(t);
        const ts = new Date(t.modifiedAt || t.addedAt || 0).getTime() || 0;
        const todos = t.todos || [];
        return {
          groupKey: `single_${t.id}`,
          baseTitle: t.title,
          latestTrack: t,
          latestVersionLabel: parsed.versionLabel,
          versions: [
            {
              track: t,
              parsed,
              versionLabel: parsed.versionLabel,
              isLatest: true,
              timestampMs: ts,
            },
          ],
          isFavorite: Boolean(t.isFavorite),
          latestTimestampMs: ts,
          hasMultipleVersions: false,
          todoDone: todos.filter((x) => x.done).length,
          todoTotal: todos.length,
          description: t.description?.trim() || undefined,
        };
      });
  }, [state.musicTracks]);

  const favoriteGroups = useMemo(
    () => trackGroups.filter((g) => g.isFavorite),
    [trackGroups]
  );

  const recentGroups = useMemo(() => trackGroups.slice(0, 12), [trackGroups]);

  const filteredLibraryGroups = useMemo(() => {
    const baseList = groupVersions ? trackGroups : flatTrackGroups;
    const q = libSearch.trim().toLowerCase();

    const filtered = baseList.filter((g) => {
      if (libFilter === 'favorites' && !g.isFavorite) return false;
      if (libFilter === 'todo' && g.todoTotal === 0) return false;
      if (!q) return true;
      return (
        g.baseTitle.toLowerCase().includes(q) ||
        (g.description && g.description.toLowerCase().includes(q)) ||
        g.versions.some(
          (v) =>
            v.track.title.toLowerCase().includes(q) ||
            (v.track.sourceFilename && v.track.sourceFilename.toLowerCase().includes(q)) ||
            v.versionLabel.toLowerCase().includes(q)
        )
      );
    });

    return [...filtered].sort((a, b) => {
      if (libSort === 'name') {
        return a.baseTitle.localeCompare(b.baseTitle, 'fr', { numeric: true, sensitivity: 'base' });
      }
      if (libSort === 'versions') {
        if (b.versions.length !== a.versions.length) return b.versions.length - a.versions.length;
        return b.latestTimestampMs - a.latestTimestampMs;
      }
      return b.latestTimestampMs - a.latestTimestampMs;
    });
  }, [groupVersions, trackGroups, flatTrackGroups, libSearch, libFilter, libSort]);

  const getActiveTrackForGroup = (group: TrackGroup): MusicTrack => {
    const overrideId = selectedVersionByGroup[group.groupKey];
    if (overrideId) {
      const found = group.versions.find((v) => v.track.id === overrideId);
      if (found) return found.track;
    }
    return group.latestTrack;
  };

  const detailGroup = useMemo(() => {
    if (!detailTarget) return null;
    return (
      trackGroups.find((g) => g.groupKey === detailTarget.groupKey) ||
      flatTrackGroups.find((g) => g.groupKey === detailTarget.groupKey) ||
      trackGroups.find((g) => g.versions.some((v) => v.track.id === detailTarget.trackId)) ||
      null
    );
  }, [detailTarget, trackGroups, flatTrackGroups]);

  // 1-Click Full Google Drive MP3 Sync (loads ALL MP3 files excluding drumkit folders!)
  const handleSyncAllDrive = async () => {
    if (syncingDrive) return;
    setSyncingDrive(true);
    setSyncProgressText('Connexion Drive…');
    try {
      const token = await ensureGoogleDriveToken(state.preferences.firebaseConfig);
      setSyncProgressText('Analyse des MP3 (hors drumkit)…');
      const { files: allFiles, excludedFileIds } = await listAllGoogleDriveAudioFilesWithExclusions(
        token,
        '',
        (count) => {
          setSyncProgressText(`${count} MP3 trouvés…`);
        }
      );

      if (allFiles.length === 0 && excludedFileIds.length === 0) {
        notify('Aucun fichier MP3 trouvé sur ton Google Drive.');
        return;
      }

      const artist = state.preferences.name || 'Moi';
      const nowIso = new Date().toISOString();
      const payload = allFiles.map((f) => {
        const cleanTitle = f.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ').trim();
        const parsed = parseTrackVersion({ title: cleanTitle, sourceFilename: f.name });
        return {
          title: cleanTitle || f.name,
          artist,
          googleDriveFileId: f.id,
          sourceFilename: f.name,
          modifiedAt: f.modifiedTime || nowIso,
          coverGradient: getDeterministicGradientId(parsed.groupKey),
          status: 'demo' as const,
          tags: ['Google Drive'],
          markers: [],
          addedAt: f.modifiedTime || nowIso,
        };
      });

      const { added, updated, removed } = syncMusicTracksBatch(payload, excludedFileIds);
      const uniqueProjects = new Set(
        allFiles.map((f) => parseTrackVersion({ title: f.name, sourceFilename: f.name }).groupKey)
      ).size;

      const drumkitNote =
        removed > 0
          ? ` · ${removed} sample${removed > 1 ? 's' : ''} drumkit retiré${removed > 1 ? 's' : ''}`
          : excludedFileIds.length > 0
          ? ` · dossier drumkit exclu`
          : '';

      if (added === 0 && updated === 0 && removed === 0) {
        notify(`Drive à jour (${allFiles.length} MP3 · ${uniqueProjects} projets${drumkitNote}) ✓`);
      } else {
        notify(
          `${added} MP3 chargé${added > 1 ? 's' : ''}${
            updated > 0 ? ` · ${updated} mis à jour` : ''
          } (${uniqueProjects} projets${drumkitNote}) ✓`
        );
      }
    } catch (err) {
      notify(`Google Drive : ${(err as Error).message}`);
    } finally {
      setSyncingDrive(false);
      setSyncProgressText('');
    }
  };

  const handleUploadAudioFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      const mediaId = uid('aud');
      const saved = await saveAndOptionallySyncMedia(mediaId, file, file.name);
      const objectUrl = URL.createObjectURL(file);
      const durationSec = await new Promise<number>((resolve) => {
        const a = new Audio();
        a.preload = 'metadata';
        let done = false;
        const finish = (sec: number) => {
          if (done) return;
          done = true;
          window.clearTimeout(timer);
          a.src = '';
          URL.revokeObjectURL(objectUrl);
          resolve(sec);
        };
        const timer = window.setTimeout(() => finish(0), 2000);
        a.onloadedmetadata = () => finish(isFinite(a.duration) ? Math.round(a.duration) : 0);
        a.onerror = () => finish(0);
        a.src = objectUrl;
        try {
          a.load();
        } catch {
          finish(0);
        }
      });

      const cleanTitle = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ').trim();
      const parsed = parseTrackVersion({ title: cleanTitle, sourceFilename: file.name });
      const modifiedIso = file.lastModified
        ? new Date(file.lastModified).toISOString()
        : new Date().toISOString();

      addMusicTrack({
        title: cleanTitle || file.name,
        artist: state.preferences.name || 'Moi',
        mediaId: saved.mediaId,
        cloudAudioUrl: saved.cloudUrl,
        sourceFilename: file.name,
        modifiedAt: modifiedIso,
        coverGradient: getDeterministicGradientId(parsed.groupKey),
        durationSec: durationSec || undefined,
        status: 'demo',
        tags: [],
        markers: [],
        addedAt: modifiedIso,
      });
    }
  };

  const openLinkedLyrics = (track: MusicTrack) => {
    if (track.linkedLyricsId) {
      setSelectedLyricsId(track.linkedLyricsId);
      setSubTab('lyrics');
      return;
    }
    const newDocId = addLyricsDoc({
      title: track.title,
      linkedTrackId: track.id,
      linkedProjectId: track.linkedProjectId,
    });
    updateMusicTrack(track.id, { linkedLyricsId: newDocId });
    setSelectedLyricsId(newDocId);
    setSubTab('lyrics');
  };

  const handleToggleFavorite = (group: TrackGroup) => {
    const allIds = group.versions.map((v) => v.track.id);
    const nextFav = !group.isFavorite;
    setTrackGroupFavorite(allIds, nextFav);
    notify(
      nextFav
        ? `« ${group.baseTitle} » ajouté aux favoris ★`
        : `« ${group.baseTitle} » retiré des favoris`
    );
  };

  const handleSelectVersion = (groupKey: string, trackId: string, autoPlay = false) => {
    setSelectedVersionByGroup((prev) => ({ ...prev, [groupKey]: trackId }));
    if (detailTarget?.groupKey === groupKey) {
      setDetailTarget({ groupKey, trackId });
    }
    if (autoPlay) {
      const targetTrack = state.musicTracks.find((t) => t.id === trackId);
      const grp = trackGroups.find((g) => g.groupKey === groupKey);
      if (targetTrack) {
        void player.playTrack(
          targetTrack,
          0,
          grp ? grp.versions.map((v) => v.track) : state.musicTracks
        );
      }
    }
  };

  const handleOpenContextMenu = (
    e: React.MouseEvent,
    group: TrackGroup,
    trackId: string,
    initialSection: 'versions' | 'projects' | null = null
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      group,
      activeTrackId: trackId,
      x: e.clientX,
      y: e.clientY,
      initialSection,
    });
  };

  const handleCreateProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjTitle.trim()) return;
    const grad = PROJECT_GRADIENTS[state.musicProjects.length % PROJECT_GRADIENTS.length].id;
    const newId = addMusicProject({
      title: newProjTitle.trim(),
      kind: newProjKind,
      coverGradient: grad,
      targetReleaseDate: newProjDate || undefined,
      status: 'en-cours',
      trackIds: [],
      steps: [
        { id: uid('ps'), label: 'Sélection des prods / MP3', done: false },
        { id: uid('ps'), label: 'Écriture des textes (LexCore)', done: false },
        { id: uid('ps'), label: 'Enregistrement voix', done: false },
        { id: uid('ps'), label: 'Mix / Master & Pochette', done: false },
      ],
    });
    setNewProjTitle('');
    setNewProjDate('');
    setShowNewProj(false);
    setOpenProjectId(newId);
  };

  const activeQueueTracks = useMemo(
    () => (subTab === 'library' ? filteredLibraryGroups : trackGroups).map(getActiveTrackForGroup),
    [subTab, filteredLibraryGroups, trackGroups, selectedVersionByGroup]
  );

  return (
    <div className="space-y-5 pb-14">
      {/* Hidden local audio uploader */}
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.m4a"
        multiple
        onChange={(e) => void handleUploadAudioFiles(e.target.files)}
        className="hidden"
      />

      {/* Header + Sub-tabs */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-zinc-50">
            Music
          </h1>
          <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5">
            Dernières versions, favoris, TODO par son & projets musicaux
          </p>
        </div>

        <div className="inline-flex items-center rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-1 self-start sm:self-auto overflow-x-auto max-w-full">
          {(
            [
              ['dashboard', 'Dashboard', FolderKanban],
              ['library', 'Bibliothèque', Disc3],
              ['lyrics', 'LexCore · Textes', FileText],
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
                    layoutId="musicSubTabPill"
                    transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                    className="absolute inset-0 rounded-xl bg-slate-900 dark:bg-zinc-100"
                  />
                )}
                <span className="relative z-10 flex items-center gap-1.5">
                  <Icon size={13} />
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ================= TAB 1: DASHBOARD MUSIC (MISE EN AVANT) ================= */}
      {subTab === 'dashboard' && (
        <div className="space-y-6">
          {/* Quick Action Strip: Sync all Drive MP3s + Pick + Local Upload + Session */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 tempo-card rounded-2xl px-4 py-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-9 w-9 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 flex items-center justify-center shrink-0">
                <HardDrive size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-900 dark:text-zinc-100 truncate">
                  Google Drive · Synchronisation automatique
                </p>
                <p className="text-[11px] text-slate-400 truncate">
                  Charge tous tes MP3 et regroupe tes versions (ex. Project 306 → v3.2)
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={syncingDrive}
                onClick={() => void handleSyncAllDrive()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-3.5 py-2 text-xs font-semibold hover:opacity-92 disabled:opacity-50 transition cursor-pointer"
              >
                {syncingDrive ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <CloudDownload size={13} />
                )}
                {syncingDrive ? syncProgressText || 'Sync…' : 'Sync tous mes MP3 Drive'}
              </button>

              <button
                type="button"
                onClick={() => setDrivePickerOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-zinc-800 px-3 py-2 text-xs font-medium text-slate-600 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800 transition cursor-pointer"
              >
                Choisir
              </button>

              <button
                type="button"
                onClick={() => audioInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-zinc-800 px-3 py-2 text-xs font-medium text-slate-600 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800 transition cursor-pointer"
              >
                <Upload size={13} />
                Local
              </button>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="tempo-card rounded-2xl p-4">
              <p className="text-[11px] text-slate-400">Sons (dernière ver.)</p>
              <div className="flex items-baseline gap-2 mt-1">
                <p className="font-mono text-2xl font-semibold tabular-nums">
                  {trackGroups.length}
                </p>
                {state.musicTracks.length > trackGroups.length && (
                  <span className="font-mono text-[10px] text-slate-400">
                    ({state.musicTracks.length} MP3)
                  </span>
                )}
              </div>
            </div>
            <div className="tempo-card rounded-2xl p-4">
              <p className="text-[11px] text-slate-400 flex items-center gap-1">
                <Star size={11} className="text-amber-400" fill="currentColor" /> Favoris
              </p>
              <p className="font-mono text-2xl font-semibold tabular-nums text-amber-500 mt-1">
                {favoriteGroups.length}
              </p>
            </div>
            <div className="tempo-card rounded-2xl p-4">
              <p className="text-[11px] text-slate-400">Textes LexCore</p>
              <p className="font-mono text-2xl font-semibold tabular-nums mt-1">
                {state.lyricsDocs.filter((d) => !d.deletedAt).length}
              </p>
            </div>
            <div className="tempo-card rounded-2xl p-4">
              <p className="text-[11px] text-slate-400">Albums / EPs</p>
              <p className="font-mono text-2xl font-semibold tabular-nums mt-1">
                {state.musicProjects.length}
              </p>
            </div>
          </div>

          {/* ===== FEATURED SECTION 1: FAVORIS ★ ===== */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Star size={15} className="text-amber-400" fill="currentColor" />
                <h2 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
                  Favoris
                </h2>
                {favoriteGroups.length > 0 && (
                  <span className="font-mono text-[11px] text-slate-400">
                    ({favoriteGroups.length})
                  </span>
                )}
              </div>
              {favoriteGroups.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const favQueue = favoriteGroups.map(getActiveTrackForGroup);
                    if (favQueue[0]) void player.playTrack(favQueue[0], 0, favQueue);
                  }}
                  className="inline-flex items-center gap-1 text-xs font-medium text-fuchsia-600 dark:text-fuchsia-400 hover:underline cursor-pointer"
                >
                  <Play size={11} fill="currentColor" /> Tout lire
                </button>
              )}
            </div>

            {favoriteGroups.length === 0 ? (
              <div className="tempo-card rounded-2xl px-4 py-5 text-center">
                <p className="text-xs text-slate-400">
                  Aucun favori pour l’instant — clique sur <span className="text-amber-400 font-semibold">★</span> ou fais un <strong>clic droit</strong> sur un son pour le mettre en avant ici.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {favoriteGroups.map((group) => {
                  const activeTrack = getActiveTrackForGroup(group);
                  const isCurrent = player.currentTrack?.id === activeTrack.id;
                  const favQueue = favoriteGroups.map(getActiveTrackForGroup);
                  return (
                    <TrackCard
                      key={group.groupKey}
                      group={group}
                      selectedTrackId={activeTrack.id}
                      isCurrentTrack={isCurrent}
                      isPlaying={isCurrent && player.isPlaying}
                      onPlay={(trk) =>
                        player.currentTrack?.id === trk.id
                          ? player.togglePlay()
                          : void player.playTrack(trk, 0, favQueue)
                      }
                      onToggleFavorite={handleToggleFavorite}
                      onOpenDetails={(g, tid) =>
                        setDetailTarget({ groupKey: g.groupKey, trackId: tid })
                      }
                      onOpenContextMenu={handleOpenContextMenu}
                    />
                  );
                })}
              </div>
            )}
          </section>

          {/* ===== FEATURED SECTION 2: SONS RÉCENTS (DERNIÈRE VERSION) ===== */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
                  Sons récents · Dernière version
                </h2>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Clic gauche pour écouter · Clic droit (ou ⋯) pour versions, favoris, description & TODO
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onOpenQuickAdd({ mode: 'music', date: todayISO() })}
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-200 dark:border-zinc-800 px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800 cursor-pointer"
                >
                  <CalendarPlus size={13} />
                  Session
                </button>
                <button
                  type="button"
                  onClick={() => setSubTab('library')}
                  className="text-xs font-medium text-fuchsia-600 dark:text-fuchsia-400 hover:underline cursor-pointer"
                >
                  Tout voir ({trackGroups.length}) →
                </button>
              </div>
            </div>

            {recentGroups.length === 0 ? (
              <div className="tempo-card rounded-3xl p-8 text-center space-y-3">
                <p className="text-xs text-slate-400">
                  Ta bibliothèque est encore vide. Synchronise ton Google Drive en un clic pour charger tous tes MP3 !
                </p>
                <button
                  type="button"
                  disabled={syncingDrive}
                  onClick={() => void handleSyncAllDrive()}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-4 py-2 text-xs font-semibold cursor-pointer"
                >
                  <CloudDownload size={14} />
                  Sync tous mes MP3 Drive
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {recentGroups.map((group) => {
                  const activeTrack = getActiveTrackForGroup(group);
                  const isCurrent = player.currentTrack?.id === activeTrack.id;
                  const recentQueue = recentGroups.map(getActiveTrackForGroup);
                  return (
                    <TrackCard
                      key={group.groupKey}
                      group={group}
                      selectedTrackId={activeTrack.id}
                      isCurrentTrack={isCurrent}
                      isPlaying={isCurrent && player.isPlaying}
                      onPlay={(trk) =>
                        player.currentTrack?.id === trk.id
                          ? player.togglePlay()
                          : void player.playTrack(trk, 0, recentQueue)
                      }
                      onToggleFavorite={handleToggleFavorite}
                      onOpenDetails={(g, tid) =>
                        setDetailTarget({ groupKey: g.groupKey, trackId: tid })
                      }
                      onOpenContextMenu={handleOpenContextMenu}
                    />
                  );
                })}
              </div>
            )}
          </section>

          {/* ===== SECTION 3: PROJETS / ALBUMS / EPS ([UNTITLED] STYLE) ===== */}
          <section className="space-y-3.5 pt-1">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
                Projets & Albums (EP, Singles, Mixtapes)
              </h2>
              <button
                type="button"
                onClick={() => setShowNewProj((v) => !v)}
                className="inline-flex items-center gap-1 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-3 py-1.5 text-xs font-semibold cursor-pointer"
              >
                <Plus size={13} /> Nouveau projet
              </button>
            </div>

            {showNewProj && (
              <form
                onSubmit={handleCreateProject}
                className="tempo-card rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-4 gap-2.5"
              >
                <input
                  autoFocus
                  type="text"
                  required
                  value={newProjTitle}
                  onChange={(e) => setNewProjTitle(e.target.value)}
                  placeholder="Nom du projet (ex. EP Minuit)"
                  className="sm:col-span-2 rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs"
                />
                <select
                  value={newProjKind}
                  onChange={(e) => setNewProjKind(e.target.value as ProjectKind)}
                  className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs"
                >
                  <option value="single">Single</option>
                  <option value="ep">EP</option>
                  <option value="album">Album</option>
                  <option value="mixtape">Mixtape</option>
                </select>
                <div className="flex gap-1.5">
                  <input
                    type="date"
                    value={newProjDate}
                    onChange={(e) => setNewProjDate(e.target.value)}
                    className="flex-1 rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-2 py-2 font-mono text-xs"
                  />
                  <button
                    type="submit"
                    className="rounded-xl bg-fuchsia-600 text-white px-3 py-2 text-xs font-semibold cursor-pointer"
                  >
                    Créer
                  </button>
                </div>
              </form>
            )}

            {state.musicProjects.length === 0 ? (
              <div className="tempo-card rounded-3xl p-7 text-center space-y-2">
                <p className="text-xs text-slate-400">
                  Crée un projet (Single, EP, Album) pour regrouper plusieurs sons, sa pochette et sa TODO globale.
                </p>
                <button
                  type="button"
                  onClick={() => setShowNewProj(true)}
                  className="inline-flex items-center gap-1 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-3.5 py-2 text-xs font-semibold cursor-pointer"
                >
                  <Plus size={13} /> Créer un projet
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5">
                {state.musicProjects.map((proj) => {
                  const done = proj.steps.filter((s) => s.done).length;
                  const total = proj.steps.length;
                  const linkedTracks = state.musicTracks.filter(
                    (t) => t.linkedProjectId === proj.id || proj.trackIds.includes(t.id)
                  );
                  const isPlayingProj =
                    player.isPlaying &&
                    linkedTracks.some((t) => t.id === player.currentTrack?.id);
                  const gradCls = getGradientClass(proj.coverGradient);

                  return (
                    <div
                      key={proj.id}
                      onClick={() => setOpenProjectId(proj.id)}
                      className="group cursor-pointer space-y-2.5"
                    >
                      <div className="relative aspect-square w-full rounded-[26px] overflow-hidden shadow-md border border-slate-200/70 dark:border-zinc-800/80 transition group-hover:scale-[1.015] group-active:scale-[0.985]">
                        {proj.coverDataUrl ? (
                          <img
                            src={proj.coverDataUrl}
                            alt={proj.title}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className={`h-full w-full bg-gradient-to-br ${gradCls}`} />
                        )}

                        <span className="absolute top-2.5 left-2.5 rounded-full bg-black/35 backdrop-blur-md px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white">
                          {proj.kind}
                        </span>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (linkedTracks.length === 0) {
                              setOpenProjectId(proj.id);
                              return;
                            }
                            if (isPlayingProj) {
                              player.togglePlay();
                            } else {
                              void player.playTrack(linkedTracks[0], 0, linkedTracks);
                            }
                          }}
                          aria-label={`Lire ${proj.title}`}
                          className="absolute bottom-2.5 right-2.5 h-10 w-10 rounded-2xl bg-slate-950/80 text-white flex items-center justify-center hover:scale-105 active:scale-95 transition shadow-lg backdrop-blur-xs cursor-pointer"
                        >
                          {isPlayingProj ? (
                            <Pause size={16} fill="currentColor" />
                          ) : (
                            <Play size={16} fill="currentColor" className="ml-0.5" />
                          )}
                        </button>
                      </div>

                      <div className="px-0.5 space-y-0.5">
                        <div className="flex items-center justify-between gap-1.5">
                          <h3 className="text-sm font-semibold text-slate-900 dark:text-zinc-100 truncate">
                            {proj.title}
                          </h3>
                          {total > 0 && (
                            <span className="font-mono text-[10px] font-semibold text-fuchsia-600 dark:text-fuchsia-400 shrink-0">
                              {done}/{total}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 dark:text-zinc-500 truncate">
                          {state.preferences.name || 'Moi'} · {linkedTracks.length} son
                          {linkedTracks.length > 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {/* ================= TAB 2: BIBLIOTHÈQUE COMPLÈTE (CARTES CLIQUABLES + VERSIONS) ================= */}
      {subTab === 'library' && (
        <div className="space-y-4">
          {/* Import & Sync Toolbar */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <button
              type="button"
              disabled={syncingDrive}
              onClick={() => void handleSyncAllDrive()}
              className="tempo-card rounded-2xl p-4 text-left flex items-center gap-3 hover:border-fuchsia-400 dark:hover:border-fuchsia-600 transition cursor-pointer disabled:opacity-60"
            >
              <div className="h-10 w-10 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 flex items-center justify-center shrink-0">
                {syncingDrive ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <CloudDownload size={16} />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-900 dark:text-zinc-100 truncate">
                  {syncingDrive ? syncProgressText || 'Synchronisation…' : 'Sync tous mes MP3 Drive'}
                </p>
                <p className="text-[11px] text-slate-400 truncate">
                  Charge tout & regroupe les versions
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setDrivePickerOpen(true)}
              className="tempo-card rounded-2xl p-4 text-left flex items-center gap-3 hover:border-slate-400 dark:hover:border-zinc-600 transition cursor-pointer"
            >
              <div className="h-10 w-10 rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 flex items-center justify-center shrink-0">
                <HardDrive size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-900 dark:text-zinc-100 truncate">
                  Parcourir Google Drive
                </p>
                <p className="text-[11px] text-slate-400 truncate">
                  Choisir des fichiers précis
                </p>
              </div>
            </button>

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void handleUploadAudioFiles(e.dataTransfer.files);
              }}
              onClick={() => audioInputRef.current?.click()}
              className="tempo-card rounded-2xl border-dashed border-2 border-slate-200 dark:border-zinc-800 p-4 text-left flex items-center gap-3 hover:border-fuchsia-400 dark:hover:border-fuchsia-600 transition cursor-pointer"
            >
              <div className="h-10 w-10 rounded-xl bg-fuchsia-500/12 text-fuchsia-600 dark:text-fuchsia-400 flex items-center justify-center shrink-0">
                <Upload size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-900 dark:text-zinc-100 truncate">
                  Importer MP3 / WAV local
                </p>
                <p className="text-[11px] text-slate-400 truncate">
                  Glisser-déposer ou parcourir
                </p>
              </div>
            </div>
          </div>

          {/* Search + Filters + Grouping + Sort Bar */}
          <div className="tempo-card rounded-2xl p-3 space-y-2.5">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="text"
                  value={libSearch}
                  onChange={(e) => setLibSearch(e.target.value)}
                  placeholder="Rechercher un projet, une version (ex. Project 306) ou une note…"
                  className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 pl-9 pr-3 py-2 text-xs outline-none focus:border-slate-400 dark:focus:border-zinc-600"
                />
              </div>

              {/* Group vs All Versions Toggle */}
              <button
                type="button"
                onClick={() => setGroupVersions((v) => !v)}
                className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium border transition cursor-pointer shrink-0 ${
                  groupVersions
                    ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 border-slate-900 dark:border-zinc-100'
                    : 'border-slate-200 dark:border-zinc-800 text-slate-600 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800'
                }`}
              >
                {groupVersions ? <GitBranch size={13} /> : <Layers size={13} />}
                {groupVersions ? 'Versions regroupées' : 'Toutes les versions'}
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              {/* Filter Pills */}
              <div className="flex items-center gap-1 flex-wrap">
                {(
                  [
                    ['all', `Tous (${groupVersions ? trackGroups.length : state.musicTracks.length})`, null],
                    ['favorites', `Favoris (${favoriteGroups.length})`, Star],
                    ['todo', 'Avec TODO', ListChecks],
                  ] as const
                ).map(([id, label, Icon]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setLibFilter(id)}
                    className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium transition cursor-pointer ${
                      libFilter === id
                        ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                        : 'bg-slate-100 dark:bg-zinc-800/80 text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100'
                    }`}
                  >
                    {Icon && (
                      <Icon
                        size={11}
                        className={id === 'favorites' ? 'text-amber-400' : undefined}
                        fill={id === 'favorites' ? 'currentColor' : 'none'}
                      />
                    )}
                    {label}
                  </button>
                ))}
              </div>

              {/* Sort Pills */}
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-slate-400 mr-0.5">Tri :</span>
                <button
                  type="button"
                  onClick={() => setLibSort('recent')}
                  className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition cursor-pointer ${
                    libSort === 'recent'
                      ? 'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400'
                      : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  <Calendar size={11} /> Récent
                </button>
                <button
                  type="button"
                  onClick={() => setLibSort('name')}
                  className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition cursor-pointer ${
                    libSort === 'name'
                      ? 'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400'
                      : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  <ArrowDownAZ size={11} /> Nom
                </button>
                {groupVersions && (
                  <button
                    type="button"
                    onClick={() => setLibSort('versions')}
                    className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition cursor-pointer ${
                      libSort === 'versions'
                        ? 'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400'
                        : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800'
                    }`}
                  >
                    <GitBranch size={11} /> Versions
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Clickable Cards Grid */}
          {filteredLibraryGroups.length === 0 ? (
            <div className="tempo-card rounded-3xl p-10 text-center space-y-2">
              <p className="text-xs text-slate-400">
                {state.musicTracks.length === 0
                  ? 'Aucun MP3 dans ta bibliothèque. Clique sur « Sync tous mes MP3 Drive » ci-dessus.'
                  : 'Aucun morceau ne correspond à ce filtre.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredLibraryGroups.map((group) => {
                const activeTrack = getActiveTrackForGroup(group);
                const isCurrent = player.currentTrack?.id === activeTrack.id;
                return (
                  <TrackCard
                    key={group.groupKey}
                    group={group}
                    selectedTrackId={activeTrack.id}
                    isCurrentTrack={isCurrent}
                    isPlaying={isCurrent && player.isPlaying}
                    onPlay={(trk) =>
                      player.currentTrack?.id === trk.id
                        ? player.togglePlay()
                        : void player.playTrack(trk, 0, activeQueueTracks)
                    }
                    onToggleFavorite={handleToggleFavorite}
                    onOpenDetails={(g, tid) =>
                      setDetailTarget({ groupKey: g.groupKey, trackId: tid })
                    }
                    onOpenContextMenu={handleOpenContextMenu}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ================= TAB 3: LEXCORE STUDIO ÉCRITURE ================= */}
      {subTab === 'lyrics' && <LyricsStudio initialDocId={selectedLyricsId} />}

      {/* ================= MODALS & RIGHT-CLICK CONTEXT MENU ================= */}
      <GoogleDrivePickerModal open={drivePickerOpen} onClose={() => setDrivePickerOpen(false)} />

      <ProjectAlbumModal projectId={openProjectId} onClose={() => setOpenProjectId(null)} />

      <TrackDetailModal
        group={detailGroup}
        selectedTrackId={detailTarget?.trackId || null}
        onSelectVersion={(trackId) => {
          if (detailGroup) handleSelectVersion(detailGroup.groupKey, trackId, false);
        }}
        onOpenLyrics={openLinkedLyrics}
        onClose={() => setDetailTarget(null)}
      />

      <TrackContextMenu
        menu={contextMenu}
        queueTracks={activeQueueTracks}
        onClose={() => setContextMenu(null)}
        onSelectVersion={handleSelectVersion}
        onOpenDetails={(groupKey, trackId) => setDetailTarget({ groupKey, trackId })}
        onOpenLyrics={openLinkedLyrics}
      />
    </div>
  );
}
