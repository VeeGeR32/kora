import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownAZ,
  Calendar,
  GitBranch,
  Layers,
  ListChecks,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Shuffle,
  Star,
} from 'lucide-react';
import type { MusicTrack, ProjectKind } from '../../types';
import { useApp } from '../../context/AppContext';
import { useAudioPlayer } from '../../context/AudioPlayerContext';
import {
  DrivePermanentSetupRequiredError,
  ensureGoogleDriveToken,
  fetchPermanentDriveSession,
  listAllGoogleDriveAudioFilesWithExclusions,
} from '../../lib/googleDrive';
import { DrivePermanentSetupModal } from './DrivePermanentSetupModal';
import {
  getDeterministicGradientId,
  groupMusicTracks,
  parseTrackVersion,
  type TrackGroup,
} from '../../lib/musicVersioning';
import { uid } from '../../utils/dates';
import { LyricsStudio } from './LyricsStudio';
import { ProjectAlbumModal } from './ProjectAlbumModal';
import { TrackCard } from './TrackCard';
import { TrackContextMenu, type TrackContextMenuState } from './TrackContextMenu';
import { TrackDetailModal } from './TrackDetailModal';
import { LinkVersionModal, type LinkVersionModalState } from './LinkVersionModal';
import { ProjectCoverArtwork } from './ProjectCoverArtwork';
import {
  findLinkedLyricsForTrack,
  getProjectTrackIndividualCovers,
  resolveTrackRatings,
} from '../../lib/trackCover';
import { PROJECT_GRADIENTS } from './MiniAudioPlayer';

export type MusicSubTab = 'dashboard' | 'library' | 'projects' | 'lyrics';

interface MusicViewProps {
  subTab: MusicSubTab;
  onSubTabChange: (next: MusicSubTab) => void;
  navResetNonce?: number;
}
type LibraryFilter = 'all' | 'favorites' | 'todo';
type LibrarySort = 'recent' | 'name' | 'versions' | 'rating' | 'potential' | 'gap';

export function MusicView({ subTab, onSubTabChange, navResetNonce = 0 }: MusicViewProps) {
  const {
    state,
    lastCloudSyncAt,
    autoSyncingDrive,
    syncMusicTracksBatch,
    updateMusicTrack,
    setTrackGroupFavorite,
    addMusicProject,
    setProjectTrackVersion,
    addLyricsDoc,
    updateLastSession,
    notify,
  } = useApp();

  const player = useAudioPlayer();
  const musicCloudSyncedRef = useRef(false);

  const setSubTab = (next: MusicSubTab) => {
    if (next !== 'lyrics') {
      setLyricsReturnContext(null);
      setLyricsOpenRequest(null);
    }
    onSubTabChange(next);
  };

  const [lyricsOpenRequest, setLyricsOpenRequest] = useState<{
    docId: string;
    nonce: number;
  } | null>(null);
  const [lyricsReturnContext, setLyricsReturnContext] = useState<{
    prevSubTab: MusicSubTab;
    detailTarget: { groupKey: string; trackId: string } | null;
    openProjectId: string | null;
  } | null>(null);
  const [showAllFavoritesMobile, setShowAllFavoritesMobile] = useState(false);

  // Clear any pending lyrics open request when navigating away from the Textes tab
  useEffect(() => {
    if (subTab !== 'lyrics') {
      setLyricsOpenRequest(null);
      setLyricsReturnContext(null);
    }
  }, [subTab]);

  // Close open Project / Song Page / Text overlays whenever the user explicitly taps a bottom/sidebar nav tab
  useEffect(() => {
    if (navResetNonce === 0) return;
    setOpenProjectId(null);
    setDetailTarget(null);
    setContextMenu(null);
    setLyricsOpenRequest(null);
    setLyricsReturnContext(null);
  }, [navResetNonce]);

  // Selected version override per groupKey (defaults to latest version)
  const [selectedVersionByGroup, setSelectedVersionByGroup] = useState<Record<string, string>>({});

  // Context Menu, Track Detail Modal & Manual Version Link Modal
  const [contextMenu, setContextMenu] = useState<TrackContextMenuState | null>(null);
  const [detailTarget, setDetailTarget] = useState<{ groupKey: string; trackId: string } | null>(
    null
  );
  const [linkModal, setLinkModal] = useState<LinkVersionModalState | null>(null);

  // Google Drive Full Sync & Permanent Zero-Popup Setup state
  const [syncingDrive, setSyncingDrive] = useState(false);
  const [syncProgressText, setSyncProgressText] = useState('');
  const [permanentDriveEmail, setPermanentDriveEmail] = useState<string | null>(null);
  const [permanentDriveReady, setPermanentDriveReady] = useState(false);
  const [permanentSetupOpen, setPermanentSetupOpen] = useState(false);

  // Silently check permanent Drive access on mount (zero popups!)
  useEffect(() => {
    let active = true;
    void fetchPermanentDriveSession(state.preferences.firebaseConfig).then((res) => {
      if (!active || !res.configured) return;
      setPermanentDriveEmail(res.serviceAccountEmail);
      setPermanentDriveReady(res.hasSharedFiles);
    });
    return () => {
      active = false;
    };
  }, [state.preferences.firebaseConfig]);

  // Library search / filter / sort / grouping / year filter
  const [libSearch, setLibSearch] = useState('');
  const [libFilter, setLibFilter] = useState<LibraryFilter>('all');
  const [libSort, setLibSort] = useState<LibrarySort>('recent');
  const [groupVersions, setGroupVersions] = useState(true);
  const [yearFilter, setYearFilter] = useState<string>('all');

  // New project quick modal inline
  const [showNewProj, setShowNewProj] = useState(false);
  const [newProjTitle, setNewProjTitle] = useState('');
  const [newProjKind, setNewProjKind] = useState<ProjectKind>('ep');
  const [newProjDate, setNewProjDate] = useState('');
  const [openProjectId, setOpenProjectIdState] = useState<string | null>(
    () => state.preferences.lastSession?.openMusicProjectId || null
  );

  const setOpenProjectId = (id: string | null) => {
    setOpenProjectIdState(id);
    updateLastSession({ openMusicProjectId: id || undefined });
  };

  // Adopt remote lastSession sub-tab / open project / open lyrics on initial cloud hydration
  useEffect(() => {
    if (!lastCloudSyncAt || musicCloudSyncedRef.current) return;
    musicCloudSyncedRef.current = true;
    const ls = state.preferences.lastSession;
    if (!ls) return;
    if (ls.musicSubTab) onSubTabChange(ls.musicSubTab);
    if (ls.openMusicProjectId) setOpenProjectIdState(ls.openMusicProjectId);
  }, [lastCloudSyncAt]);

  // Grouped tracks (deduplicated by project/base name, latest version promoted to front!)
  const trackGroups = useMemo(() => groupMusicTracks(state.musicTracks), [state.musicTracks]);

  // Available Drive year/season folders (e.g. 2026/2027, 2025/2026, 2024/2025, 2023/2024) sorted newest first
  const availableYears = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of trackGroups) {
      if (g.yearFolder) {
        counts.set(g.yearFolder, (counts.get(g.yearFolder) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[0].localeCompare(a[0], 'fr', { numeric: true }))
      .map(([year, count]) => ({ year, count }));
  }, [trackGroups]);

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
          baseTitle: t.manualGroupTitle || t.title,
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
          prodTrack: parsed.isProd ? t : null,
          prodTracks: [],
          allTrackIds: [t.id],
          yearFolder: t.driveYearFolder,
          isFavorite: Boolean(t.isFavorite),
          latestTimestampMs: ts,
          hasMultipleVersions: false,
          todoDone: todos.filter((x) => x.done).length,
          todoTotal: todos.length,
          description: t.description?.trim() || undefined,
        };
      });
  }, [state.musicTracks]);

  const yearFilteredGroups = useMemo(
    () =>
      yearFilter === 'all'
        ? trackGroups
        : trackGroups.filter((g) => g.yearFolder === yearFilter),
    [trackGroups, yearFilter]
  );

  const favoriteGroups = useMemo(
    () => yearFilteredGroups.filter((g) => g.isFavorite),
    [yearFilteredGroups]
  );

  const recentGroups = useMemo(() => yearFilteredGroups.slice(0, 12), [yearFilteredGroups]);

  const filteredLibraryGroups = useMemo(() => {
    const baseList = groupVersions ? trackGroups : flatTrackGroups;
    const q = libSearch.trim().toLowerCase();

    const filtered = baseList.filter((g) => {
      if (yearFilter !== 'all' && g.yearFolder !== yearFilter) return false;
      if (libFilter === 'favorites' && !g.isFavorite) return false;
      if (libFilter === 'todo' && g.todoTotal === 0) return false;
      if (!q) return true;
      return (
        g.baseTitle.toLowerCase().includes(q) ||
        (g.yearFolder && g.yearFolder.toLowerCase().includes(q)) ||
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
      if (libSort === 'rating') {
        const ra = resolveTrackRatings(a.latestTrack, a.versions.map((v) => v.track)).current ?? -1;
        const rb = resolveTrackRatings(b.latestTrack, b.versions.map((v) => v.track)).current ?? -1;
        if (rb !== ra) return rb - ra;
        return b.latestTimestampMs - a.latestTimestampMs;
      }
      if (libSort === 'potential') {
        const pa = resolveTrackRatings(a.latestTrack, a.versions.map((v) => v.track)).potential ?? -1;
        const pb = resolveTrackRatings(b.latestTrack, b.versions.map((v) => v.track)).potential ?? -1;
        if (pb !== pa) return pb - pa;
        return b.latestTimestampMs - a.latestTimestampMs;
      }
      if (libSort === 'gap') {
        const ra = resolveTrackRatings(a.latestTrack, a.versions.map((v) => v.track));
        const rb = resolveTrackRatings(b.latestTrack, b.versions.map((v) => v.track));
        const gapA = ra.potential !== null && ra.current !== null ? ra.potential - ra.current : -99;
        const gapB = rb.potential !== null && rb.current !== null ? rb.potential - rb.current : -99;
        if (gapB !== gapA) return gapB - gapA;
        if ((rb.potential ?? -1) !== (ra.potential ?? -1)) return (rb.potential ?? -1) - (ra.potential ?? -1);
        return b.latestTimestampMs - a.latestTimestampMs;
      }
      return b.latestTimestampMs - a.latestTimestampMs;
    });
  }, [groupVersions, trackGroups, flatTrackGroups, libSearch, libFilter, libSort, yearFilter]);

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

  // 1-Click Full Google Drive MP3 Sync (permanent zero-popup token first, excludes drumkit!)
  const handleSyncAllDrive = async (forceRefresh = false) => {
    if (syncingDrive) return;
    setSyncingDrive(true);
    setSyncProgressText('Connexion Drive…');
    try {
      const token = await ensureGoogleDriveToken(state.preferences.firebaseConfig, forceRefresh);
      setPermanentDriveReady(true);
      setPermanentSetupOpen(false);
      setSyncProgressText('Analyse des MP3 (hors drumkit)…');
      const { files: allFiles, excludedFileIds } = await listAllGoogleDriveAudioFilesWithExclusions(
        token,
        '',
        (count) => {
          setSyncProgressText(`${count} MP3 trouvés…`);
        }
      );

      if (allFiles.length === 0 && excludedFileIds.length === 0) {
        notify('Aucun fichier MP3 trouvé dans le dossier partagé.');
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
          driveYearFolder: f.yearFolder,
          modifiedAt: f.modifiedTime || nowIso,
          coverGradient: getDeterministicGradientId(parsed.groupKey),
          status: 'maquette' as const,
          tags: ['Google Drive'],
          markers: [],
          addedAt: f.modifiedTime || nowIso,
        };
      });

      const { added, updated, removed } = syncMusicTracksBatch(payload, excludedFileIds, true);
      const uniqueProjects = new Set(
        allFiles.map((f) => parseTrackVersion({ title: f.name, sourceFilename: f.name }).groupKey)
      ).size;

      const drumkitNote =
        removed > 0
          ? ` · ${removed} prod${removed > 1 ? 's' : ''}/sample${removed > 1 ? 's' : ''} retiré${removed > 1 ? 's' : ''}`
          : excludedFileIds.length > 0
          ? ` · prods & drumkit exclus`
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
      if (err instanceof DrivePermanentSetupRequiredError) {
        setPermanentDriveEmail(err.serviceAccountEmail);
        setPermanentDriveReady(false);
        setPermanentSetupOpen(true);
      } else {
        notify(`Google Drive : ${(err as Error).message}`);
      }
    } finally {
      setSyncingDrive(false);
      setSyncProgressText('');
    }
  };

  // Open Song Page automatically when user taps cover art inside the maximized audio player
  useEffect(() => {
    if (!player.pendingOpenTrackId) return;
    const targetId = player.pendingOpenTrackId;
    const grp = trackGroups.find((g) => g.allTrackIds.includes(targetId));
    if (grp) {
      setOpenProjectId(null);
      setDetailTarget({ groupKey: grp.groupKey, trackId: targetId });
      if (subTab === 'lyrics') setSubTab('dashboard');
    }
    player.clearPendingOpenTrackPage();
  }, [player.pendingOpenTrackId, trackGroups]);

  const openLinkedLyrics = (track: MusicTrack) => {
    // Remember exact place the user came from so "Retour" in Textes brings them right back!
    setLyricsReturnContext({
      prevSubTab: subTab,
      detailTarget,
      openProjectId,
    });

    // Always close Song Page AND Project Page so the Text opens immediately on top!
    setDetailTarget(null);
    setOpenProjectId(null);

    const grp = trackGroups.find((g) => g.allTrackIds.includes(track.id));
    const existingDoc = findLinkedLyricsForTrack(
      track,
      state.lyricsDocs,
      grp?.allTrackIds,
      grp?.versions.map((v) => v.track)
    );

    if (existingDoc) {
      setLyricsOpenRequest({ docId: existingDoc.id, nonce: Date.now() });
      setSubTab('lyrics');
      return;
    }

    const newDocId = addLyricsDoc({
      title: grp?.baseTitle || track.manualGroupTitle || track.title,
      linkedTrackId: track.id,
      linkedProjectId: track.linkedProjectId,
    });
    updateMusicTrack(track.id, { linkedLyricsId: newDocId });
    setLyricsOpenRequest({ docId: newDocId, nonce: Date.now() });
    setSubTab('lyrics');
  };

  const handleToggleFavorite = (group: TrackGroup) => {
    const allIds =
      group.allTrackIds.length > 0 ? group.allTrackIds : group.versions.map((v) => v.track.id);
    const nextFav = !group.isFavorite;
    setTrackGroupFavorite(allIds, nextFav);
    notify(
      nextFav
        ? `« ${group.baseTitle} » ajouté aux favoris ★`
        : `« ${group.baseTitle} » retiré des favoris`
    );
  };

  const handlePlayProd = (prodTrack: MusicTrack, parentTrack: MusicTrack) => {
    if (player.currentTrack?.id === prodTrack.id) {
      player.togglePlay();
    } else {
      void player.playTrack(prodTrack, 0, [parentTrack, prodTrack]);
    }
  };

  const handleSelectVersion = (groupKey: string, trackId: string, autoPlay = false) => {
    setSelectedVersionByGroup((prev) => ({ ...prev, [groupKey]: trackId }));
    if (detailTarget?.groupKey === groupKey) {
      setDetailTarget({ groupKey, trackId });
    }

    // Persist the chosen version inside any project / backlog / sprint that references this song group
    // (automatically clears pin if selecting latest version, or pins older version so refresh/sync never reverts it!)
    const grp = trackGroups.find((g) => g.groupKey === groupKey);
    const groupIds = grp && grp.allTrackIds.length > 0 ? grp.allTrackIds : [trackId];
    const groupIdSet = new Set(groupIds);

    for (const proj of state.musicProjects) {
      const hasInProj =
        proj.trackIds.some((id) => groupIdSet.has(id)) ||
        (proj.benchTrackIds || []).some((id) => groupIdSet.has(id)) ||
        (proj.sprints || []).some((s) => s.trackIds.some((id) => groupIdSet.has(id)));
      if (hasInProj) {
        setProjectTrackVersion(proj.id, groupKey, trackId);
      }
    }

    if (autoPlay) {
      const targetTrack = state.musicTracks.find((t) => t.id === trackId);
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

  const handleConfirmManualLink = (
    movingTrackIds: string[],
    targetGroupKey: string,
    targetGroupTitle: string,
    customVersionLabel?: string
  ) => {
    for (const id of movingTrackIds) {
      updateMusicTrack(id, {
        manualGroupKey: targetGroupKey,
        manualGroupTitle: targetGroupTitle,
        ...(customVersionLabel ? { manualVersionLabel: customVersionLabel } : {}),
      });
    }
    notify(`Associé comme version de « ${targetGroupTitle} » ✓`);
  };

  const handleDetachVersion = (trackId: string) => {
    const target = state.musicTracks.find((t) => t.id === trackId);
    if (!target) return;
    updateMusicTrack(trackId, {
      manualGroupKey: `solo_${trackId}`,
      manualGroupTitle: target.title,
      manualVersionLabel: 'Original',
    });
    notify(`« ${target.title} » détaché en son indépendant ✓`);
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
        { id: uid('ps'), label: 'Écriture des textes', done: false },
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

  const renderProjectsSection = (compact: boolean) => {
    const list = compact ? state.musicProjects.slice(0, 4) : state.musicProjects;
    return (
          <section className="space-y-3.5 pt-1">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
                {compact ? 'Projets' : 'Albums, EP, Singles & Mixtapes'}
              </h2>
              {compact ? (
                state.musicProjects.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSubTab('projects')}
                    className="text-xs font-medium text-fuchsia-600 dark:text-fuchsia-400 hover:underline cursor-pointer"
                  >
                    Tout voir ({state.musicProjects.length}) →
                  </button>
                )
              ) : (
                <button
                  type="button"
                  onClick={() => setShowNewProj((v) => !v)}
                  className="inline-flex items-center gap-1 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-3 py-1.5 text-xs font-semibold cursor-pointer"
                >
                  <Plus size={13} /> Nouveau projet
                </button>
              )}
            </div>

            {!compact && showNewProj && (
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
                  onClick={() => {
                    setSubTab('projects');
                    setShowNewProj(true);
                  }}
                  className="inline-flex items-center gap-1 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-3.5 py-2 text-xs font-semibold cursor-pointer"
                >
                  <Plus size={13} /> Créer un projet
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5">
                {list.map((proj) => {
                  const done = proj.steps.filter((s) => s.done).length;
                  const total = proj.steps.length;
                  const linkedTracks = state.musicTracks.filter(
                    (t) => t.linkedProjectId === proj.id || proj.trackIds.includes(t.id)
                  );
                  const isPlayingProj =
                    player.isPlaying &&
                    linkedTracks.some((t) => t.id === player.currentTrack?.id);

                  return (
                    <div
                      key={proj.id}
                      onClick={() => setOpenProjectId(proj.id)}
                      className="group cursor-pointer space-y-2.5"
                    >
                      <div className="relative aspect-square w-full rounded-[26px] overflow-hidden shadow-md border border-slate-200/70 dark:border-zinc-800/80 transition group-hover:scale-[1.015] group-active:scale-[0.985]">
                        <ProjectCoverArtwork
                          title={proj.title}
                          projectCoverUrl={proj.coverDataUrl}
                          trackCoverUrls={getProjectTrackIndividualCovers(linkedTracks)}
                          gradientId={proj.coverGradient}
                        />

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
    );
  };

  return (
    <div className="space-y-5 pb-14">
      {/* Section Header + Compact Drive Sync */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-zinc-50">
          {({ dashboard: 'Accueil', library: 'Sons', projects: 'Projets', lyrics: 'Textes' } as Record<MusicSubTab, string>)[subTab]}
        </h1>
          {/* Ultra-compact Sync & Drive Setup Controls */}
          <div className="flex items-center gap-1.5">
            {permanentDriveEmail && !permanentDriveReady && (
              <button
                type="button"
                onClick={() => setPermanentSetupOpen(true)}
                className="inline-flex items-center gap-1 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer"
              >
                Configurer Drive
              </button>
            )}
            <button
              type="button"
              disabled={syncingDrive}
              onClick={() => void handleSyncAllDrive()}
              title="Synchroniser avec Google Drive"
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/90 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-slate-300 dark:hover:border-zinc-700 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:text-zinc-300 hover:text-slate-900 dark:hover:text-zinc-100 disabled:opacity-50 transition cursor-pointer"
            >
              <RefreshCw
                size={11}
                className={syncingDrive || autoSyncingDrive ? 'animate-spin text-fuchsia-500' : ''}
              />
              <span>
                {syncingDrive
                  ? syncProgressText || 'Sync…'
                  : autoSyncingDrive
                  ? 'Maj…'
                  : 'Sync'}
              </span>
              {permanentDriveReady && !syncingDrive && !autoSyncingDrive && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              )}
            </button>
          </div>
      </div>

      {/* ================= TAB 1: DASHBOARD MUSIC (MISE EN AVANT) ================= */}
      {subTab === 'dashboard' && (
        <div className="space-y-6">

          {/* Year / Saison Filter Bar (automatically detected from Drive folders 23/24, 24/25, 25/26, 26/27!) */}
          {availableYears.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 mr-1 shrink-0">
                <Calendar size={12} /> Année :
              </span>
              <button
                type="button"
                onClick={() => setYearFilter('all')}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition cursor-pointer shrink-0 ${
                  yearFilter === 'all'
                    ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                    : 'bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 text-slate-600 dark:text-zinc-300 hover:border-slate-400'
                }`}
              >
                Toutes ({trackGroups.length})
              </button>
              {availableYears.map(({ year, count }) => (
                <button
                  key={year}
                  type="button"
                  onClick={() => setYearFilter((cur) => (cur === year ? 'all' : year))}
                  className={`rounded-full px-3 py-1 font-mono text-xs font-semibold transition cursor-pointer shrink-0 ${
                    yearFilter === year
                      ? 'bg-fuchsia-600 text-white shadow-xs'
                      : 'bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 text-slate-600 dark:text-zinc-300 hover:border-fuchsia-400'
                  }`}
                >
                  {year} <span className="opacity-65">({count})</span>
                </button>
              ))}
            </div>
          )}

          {/* Compact Minimalist Stats Strip */}
          <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px] text-slate-400 dark:text-zinc-500 px-0.5">
            <span>
              <strong className="font-mono font-semibold text-slate-700 dark:text-zinc-200 tabular-nums">
                {trackGroups.length}
              </strong>{' '}
              sons
            </span>
            <span className="opacity-40">·</span>
            <span className="inline-flex items-center gap-1">
              <Star size={10} className="text-amber-400" fill="currentColor" />
              <strong className="font-mono font-semibold text-slate-700 dark:text-zinc-200 tabular-nums">
                {favoriteGroups.length}
              </strong>{' '}
              favoris
            </span>
            <span className="opacity-40">·</span>
            <span>
              <strong className="font-mono font-semibold text-slate-700 dark:text-zinc-200 tabular-nums">
                {state.lyricsDocs.filter((d) => !d.deletedAt).length}
              </strong>{' '}
              textes
            </span>
            <span className="opacity-40">·</span>
            <span>
              <strong className="font-mono font-semibold text-slate-700 dark:text-zinc-200 tabular-nums">
                {state.musicProjects.length}
              </strong>{' '}
              projets
            </span>
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
                    if (favQueue.length > 0) void player.playShuffled(favQueue);
                  }}
                  title="Lecture aléatoire des favoris (sans répétition)"
                  aria-label="Lecture aléatoire des favoris"
                  className="h-8 w-8 rounded-full inline-flex items-center justify-center text-slate-500 dark:text-zinc-400 hover:text-slate-950 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-zinc-800 transition cursor-pointer"
                >
                  <Shuffle size={15} />
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
              <div className="space-y-2.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {favoriteGroups.map((group, idx) => {
                    const activeTrack = getActiveTrackForGroup(group);
                    const isCurrent = player.currentTrack?.id === activeTrack.id;
                    const isPlayingProd = Boolean(
                      group.prodTrack &&
                        player.currentTrack?.id === group.prodTrack.id &&
                        player.isPlaying
                    );
                    const favQueue = favoriteGroups.map(getActiveTrackForGroup);
                    const hideOnMobile = !showAllFavoritesMobile && idx >= 3;
                    return (
                      <div key={group.groupKey} className={hideOnMobile ? 'hidden sm:block' : ''}>
                        <TrackCard
                          group={group}
                          selectedTrackId={activeTrack.id}
                          isCurrentTrack={isCurrent}
                          isPlaying={isCurrent && player.isPlaying}
                          isPlayingProd={isPlayingProd}
                          onPlay={(trk) =>
                            player.currentTrack?.id === trk.id
                              ? player.togglePlay()
                              : void player.playTrack(trk, 0, favQueue)
                          }
                          onPlayProd={(pt) => handlePlayProd(pt, activeTrack)}
                          onToggleFavorite={handleToggleFavorite}
                          onOpenDetails={(g, tid) =>
                            setDetailTarget({ groupKey: g.groupKey, trackId: tid })
                          }
                          onOpenContextMenu={handleOpenContextMenu}
                        />
                      </div>
                    );
                  })}
                </div>
                {favoriteGroups.length > 3 && (
                  <button
                    type="button"
                    onClick={() => setShowAllFavoritesMobile((v) => !v)}
                    className="sm:hidden w-full py-2 rounded-xl border border-slate-200/80 dark:border-zinc-800 text-xs font-medium text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100 transition cursor-pointer"
                  >
                    {showAllFavoritesMobile
                      ? 'Réduire les favoris'
                      : `Voir tous les favoris (${favoriteGroups.length})`}
                  </button>
                )}
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
                  Clic sur ▶ pour écouter · Clic sur la carte pour ouvrir la page du morceau · Clic droit (ou ⋯) pour options
                </p>
              </div>
              <div className="flex items-center gap-2">
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
                  <RefreshCw size={13} className={syncingDrive ? 'animate-spin' : ''} />
                  Synchroniser Google Drive
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {recentGroups.map((group, idx) => {
                  const activeTrack = getActiveTrackForGroup(group);
                  const isCurrent = player.currentTrack?.id === activeTrack.id;
                  const isPlayingProd = Boolean(
                    group.prodTrack &&
                      player.currentTrack?.id === group.prodTrack.id &&
                      player.isPlaying
                  );
                  const recentQueue = recentGroups.map(getActiveTrackForGroup);
                  return (
                    <div key={group.groupKey} className={idx >= 4 ? 'hidden sm:block' : ''}>
                      <TrackCard
                        group={group}
                        selectedTrackId={activeTrack.id}
                        isCurrentTrack={isCurrent}
                        isPlaying={isCurrent && player.isPlaying}
                        isPlayingProd={isPlayingProd}
                        onPlay={(trk) =>
                          player.currentTrack?.id === trk.id
                            ? player.togglePlay()
                            : void player.playTrack(trk, 0, recentQueue)
                        }
                        onPlayProd={(pt) => handlePlayProd(pt, activeTrack)}
                        onToggleFavorite={handleToggleFavorite}
                        onOpenDetails={(g, tid) =>
                          setDetailTarget({ groupKey: g.groupKey, trackId: tid })
                        }
                        onOpenContextMenu={handleOpenContextMenu}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {renderProjectsSection(true)}
        </div>
      )}

      {/* ================= TAB: PROJETS (ALBUMS, EP, SINGLES, MIXTAPES) ================= */}
      {subTab === 'projects' && <div className="space-y-6">{renderProjectsSection(false)}</div>}

      {/* ================= TAB 2: BIBLIOTHÈQUE COMPLÈTE (CARTES CLIQUABLES + VERSIONS) ================= */}
      {subTab === 'library' && (
        <div className="space-y-4">
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

              {/* Group vs All Versions Toggle + Shuffle Button */}
              <div className="flex items-center gap-1.5 shrink-0">
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
                {filteredLibraryGroups.length > 0 && (
                  <button
                    type="button"
                    title="Lecture aléatoire (sans répétition)"
                    aria-label="Lecture aléatoire"
                    onClick={() => {
                      const q = filteredLibraryGroups.map(getActiveTrackForGroup);
                      if (q.length > 0) void player.playShuffled(q);
                    }}
                    className="h-9 w-9 inline-flex items-center justify-center rounded-xl border border-slate-200 dark:border-zinc-800 text-slate-600 dark:text-zinc-300 hover:text-slate-950 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-zinc-800 transition cursor-pointer shrink-0"
                  >
                    <Shuffle size={14} />
                  </button>
                )}
              </div>
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
                <button
                  type="button"
                  onClick={() => setLibSort('rating')}
                  className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition cursor-pointer ${
                    libSort === 'rating'
                      ? 'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400'
                      : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  Note
                </button>
                <button
                  type="button"
                  onClick={() => setLibSort('potential')}
                  className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition cursor-pointer ${
                    libSort === 'potential'
                      ? 'bg-violet-500/15 text-violet-600 dark:text-violet-400'
                      : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  ↗ Potentiel
                </button>
                <button
                  type="button"
                  onClick={() => setLibSort('gap')}
                  title="Trier par écart Potentiel − Note actuelle (titres prioritaires)"
                  className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition cursor-pointer ${
                    libSort === 'gap'
                      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                      : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  Δ Écart
                </button>
              </div>
            </div>
            {/* Year / Saison Filter Strip inside Library */}
            {availableYears.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-slate-100 dark:border-zinc-800/70">
                <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 mr-0.5">
                  <Calendar size={11} /> Année :
                </span>
                <button
                  type="button"
                  onClick={() => setYearFilter('all')}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition cursor-pointer ${
                    yearFilter === 'all'
                      ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                      : 'bg-slate-100 dark:bg-zinc-800/80 text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100'
                  }`}
                >
                  Toutes
                </button>
                {availableYears.map(({ year, count }) => (
                  <button
                    key={year}
                    type="button"
                    onClick={() => setYearFilter((cur) => (cur === year ? 'all' : year))}
                    className={`rounded-lg px-2.5 py-1 font-mono text-[11px] font-semibold transition cursor-pointer ${
                      yearFilter === year
                        ? 'bg-fuchsia-600 text-white'
                        : 'bg-slate-100 dark:bg-zinc-800/80 text-slate-600 dark:text-zinc-300 hover:bg-fuchsia-500/15'
                    }`}
                  >
                    {year} <span className="opacity-65">({count})</span>
                  </button>
                ))}
              </div>
            )}
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
                const isPlayingProd = Boolean(
                  group.prodTrack &&
                    player.currentTrack?.id === group.prodTrack.id &&
                    player.isPlaying
                );
                return (
                  <TrackCard
                    key={group.groupKey}
                    group={group}
                    selectedTrackId={activeTrack.id}
                    isCurrentTrack={isCurrent}
                    isPlaying={isCurrent && player.isPlaying}
                    isPlayingProd={isPlayingProd}
                    onPlay={(trk) =>
                      player.currentTrack?.id === trk.id
                        ? player.togglePlay()
                        : void player.playTrack(trk, 0, activeQueueTracks)
                    }
                    onPlayProd={(pt) => handlePlayProd(pt, activeTrack)}
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

      {/* ================= TAB 3: TEXTES STUDIO ÉCRITURE ================= */}
      {subTab === 'lyrics' && (
        <LyricsStudio
          initialDocId={null}
          openRequest={lyricsOpenRequest}
          resetNonce={navResetNonce}
          backLabel={lyricsReturnContext ? 'Retour' : 'Textes'}
          onCloseDoc={() => {
            setLyricsOpenRequest(null);
            updateLastSession({ selectedLyricsId: undefined });
            if (lyricsReturnContext) {
              const ctx = lyricsReturnContext;
              setLyricsReturnContext(null);
              onSubTabChange(ctx.prevSubTab);
              setOpenProjectId(ctx.openProjectId);
              setDetailTarget(ctx.detailTarget);
            }
          }}
        />
      )}

      {/* ================= MODALS & RIGHT-CLICK CONTEXT MENU ================= */}
      <ProjectAlbumModal
        projectId={openProjectId}
        onClose={() => setOpenProjectId(null)}
        onOpenTrackDetails={(trackId) => {
          const grp = trackGroups.find((g) => g.allTrackIds.includes(trackId));
          if (grp) setDetailTarget({ groupKey: grp.groupKey, trackId });
        }}
      />

      <TrackDetailModal
        group={detailGroup}
        selectedTrackId={detailTarget?.trackId || null}
        activeProjectId={openProjectId}
        onSelectVersion={(trackId) => {
          if (detailGroup) handleSelectVersion(detailGroup.groupKey, trackId, false);
        }}
        onOpenLyrics={openLinkedLyrics}
        onRequestPullVersion={(g, tid) =>
          setLinkModal({ mode: 'pull-into-group', sourceGroup: g, sourceTrackId: tid })
        }
        onRequestAttachToOther={(g, tid) =>
          setLinkModal({ mode: 'attach-to-target', sourceGroup: g, sourceTrackId: tid })
        }
        onDetachVersion={handleDetachVersion}
        onClose={() => setDetailTarget(null)}
      />

      <TrackContextMenu
        menu={contextMenu}
        queueTracks={activeQueueTracks}
        onClose={() => setContextMenu(null)}
        onSelectVersion={handleSelectVersion}
        onOpenDetails={(groupKey, trackId) => setDetailTarget({ groupKey, trackId })}
        onOpenLyrics={openLinkedLyrics}
        onRequestLinkVersion={(g, tid) =>
          setLinkModal({ mode: 'attach-to-target', sourceGroup: g, sourceTrackId: tid })
        }
        onDetachVersion={handleDetachVersion}
      />

      <LinkVersionModal
        modal={linkModal}
        allGroups={trackGroups}
        onClose={() => setLinkModal(null)}
        onConfirmLink={handleConfirmManualLink}
      />

      <DrivePermanentSetupModal
        open={permanentSetupOpen}
        serviceAccountEmail={permanentDriveEmail}
        syncing={syncingDrive}
        onVerifyAndSync={() => handleSyncAllDrive(true)}
        onClose={() => setPermanentSetupOpen(false)}
      />
    </div>
  );
}
