import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArrowDownAZ,
  Calendar,
  GitBranch,
  HardDrive,
  Heart,
  Layers,
  ListChecks,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Shuffle,
  Star,
  Users,
} from 'lucide-react';
import type { MusicTrack, SocialTrackItem } from '../../types';
import { useApp } from '../../context/AppContext';
import { useAudioPlayer } from '../../context/AudioPlayerContext';
import { DrivePermanentSetupModal, DriveSourcesManager } from './DrivePermanentSetupModal';
import {
  getCoverGradientStyle,
  groupMusicTracks,
  parseTrackVersion,
  type TrackGroup,
} from '../../lib/musicVersioning';
import { socialTrackToMusicTrack } from '../../lib/socialApi';
import {
  StudioGlobalContextMenu,
  type StudioContextMenuTarget,
} from './StudioGlobalContextMenu';
import { TrackCard } from './TrackCard';
import { TrackContextMenu, type TrackContextMenuState } from './TrackContextMenu';
import { LinkVersionModal, type LinkVersionModalState } from './LinkVersionModal';
import { ProjectCoverArtwork } from './ProjectCoverArtwork';
import { TrackCardSkeletonGrid } from '../ui/Skeleton';

const LyricsStudio = lazy(() =>
  import('./LyricsStudio').then((m) => ({ default: m.LyricsStudio }))
);
const PlaylistPage = lazy(() =>
  import('./PlaylistModal').then((m) => ({ default: m.PlaylistPage }))
);
const ProjectAlbumModal = lazy(() =>
  import('./ProjectAlbumModal').then((m) => ({ default: m.ProjectAlbumModal }))
);
const ProjectCreationModal = lazy(() =>
  import('./ProjectCreationModal').then((m) => ({ default: m.ProjectCreationModal }))
);
const SocialHubView = lazy(() =>
  import('./SocialHubView').then((m) => ({ default: m.SocialHubView }))
);
const TrackDetailModal = lazy(() =>
  import('./TrackDetailModal').then((m) => ({ default: m.TrackDetailModal }))
);
const SettingsPage = lazy(() =>
  import('../SettingsModal').then((m) => ({ default: m.SettingsPage }))
);
const DocumentationPage = lazy(() =>
  import('../DocumentationPage').then((m) => ({ default: m.DocumentationPage }))
);

function LazyViewFallback() {
  return (
    <div className="py-16 flex items-center justify-center">
      <div className="h-6 w-6 rounded-full border-2 border-[#8C271E] border-t-transparent animate-spin" />
    </div>
  );
}
import {
  findLinkedLyricsForTrack,
  getProjectTrackIndividualCovers,
  resolveTrackRatings,
} from '../../lib/trackCover';

export type MusicSubTab = 'dashboard' | 'library' | 'projects' | 'lyrics' | 'social' | 'profile';

interface MusicViewProps {
  subTab: MusicSubTab;
  onSubTabChange: (next: MusicSubTab) => void;
  navResetNonce?: number;
  isSettingsOpen?: boolean;
  onOpenSettings?: () => void;
  isDocsOpen?: boolean;
  onOpenDocs?: () => void;
}
type LibraryFilter = 'all' | 'favorites' | 'todo' | 'archived';
type LibrarySort = 'recent' | 'name' | 'versions' | 'rating' | 'potential' | 'gap';

export function MusicView({
  subTab,
  onSubTabChange,
  navResetNonce = 0,
  isSettingsOpen = false,
  onOpenSettings,
  isDocsOpen = false,
  onOpenDocs,
}: MusicViewProps) {
  const {
    state,
    cloudUser,
    lastCloudSyncAt,
    autoSyncingDrive,
    driveSources,
    playlists,
    likedSocialTracks,
    toggleLikeSocialTrack,
    syncAllConnectedDrives,
    updateMusicTrack,
    setTrackGroupFavorite,
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
    setShowNewProj(false);
    setOpenProjectId(null);
    setOpenPlaylistId(null);
    setDetailTarget(null);
    setContextMenu(null);
    setStudioContextMenu(null);
    setLyricsOpenRequest(null);
    setLyricsReturnContext(null);
  }, [navResetNonce]);

  // Selected version override per groupKey (defaults to latest version)
  const [selectedVersionByGroup, setSelectedVersionByGroup] = useState<Record<string, string>>({});

  // Context Menu, Studio Global Context Menu, Track Detail Modal & Manual Version Link Modal
  const [contextMenu, setContextMenu] = useState<TrackContextMenuState | null>(null);
  const [studioContextMenu, setStudioContextMenu] = useState<StudioContextMenuTarget | null>(null);
  const [detailTarget, setDetailTarget] = useState<{ groupKey: string; trackId: string } | null>(
    null
  );
  const [linkModal, setLinkModal] = useState<LinkVersionModalState | null>(null);

  // Global right-click anywhere on the page (background, sidebar, header, settings, etc.)
  useEffect(() => {
    const onGlobalContextMenu = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      setContextMenu(null);
      setStudioContextMenu({ kind: 'page', x: e.clientX, y: e.clientY });
    };
    window.addEventListener('contextmenu', onGlobalContextMenu);
    return () => window.removeEventListener('contextmenu', onGlobalContextMenu);
  }, []);

  // Google Drive modal state
  const [syncingDrive, setSyncingDrive] = useState(false);
  const [permanentSetupOpen, setPermanentSetupOpen] = useState(false);

  // Library search / filter / sort / grouping / project filter
  const [libSearch, setLibSearch] = useState('');
  const [libFilter, setLibFilter] = useState<LibraryFilter>('all');
  const [libSort, setLibSort] = useState<LibrarySort>('recent');
  const [groupVersions, setGroupVersions] = useState(true);
  const [projectStatusFilter, setProjectStatusFilter] = useState<
    'all' | 'active' | 'playlists' | 'archived'
  >('all');

  // Full-page Apple Studio project/playlist creation & open states
  const [showNewProj, setShowNewProj] = useState(false);
  const [openPlaylistId, setOpenPlaylistId] = useState<string | null>(null);
  const [socialTargetArtistUid, setSocialTargetArtistUid] = useState<string | null>(null);
  const [socialTargetTrack, setSocialTargetTrack] = useState<SocialTrackItem | null>(null);
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
      if (libFilter === 'archived') {
        const isArchivedTrack =
          g.latestTrack.status === 'masterise' ||
          Boolean(
            g.latestTrack.linkedProjectId &&
              state.musicProjects.some(
                (p) => p.id === g.latestTrack.linkedProjectId && p.status === 'sorti'
              )
          );
        if (!isArchivedTrack) return false;
      }
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
  }, [groupVersions, trackGroups, flatTrackGroups, libSearch, libFilter, libSort]);

  const getActiveTrackForGroup = (group: TrackGroup): MusicTrack => group.latestTrack;

  const detailGroup = useMemo(() => {
    if (!detailTarget) return null;
    return (
      trackGroups.find((g) => g.groupKey === detailTarget.groupKey) ||
      flatTrackGroups.find((g) => g.groupKey === detailTarget.groupKey) ||
      trackGroups.find((g) => g.versions.some((v) => v.track.id === detailTarget.trackId)) ||
      null
    );
  }, [detailTarget, trackGroups, flatTrackGroups]);

  // 1-Click Full Google Drive MP3 Sync across all connected Drives
  const handleSyncAllDrive = async (forceRefresh = false) => {
    if (syncingDrive || autoSyncingDrive) return;
    if (driveSources.length === 0) {
      setPermanentSetupOpen(true);
      return;
    }
    setSyncingDrive(true);
    try {
      await syncAllConnectedDrives({ forceRefresh });
    } finally {
      setSyncingDrive(false);
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

  // Open Lyrics Editor automatically when user taps "Éditer" from the player's Lyrics sheet
  useEffect(() => {
    if (!player.pendingOpenLyricsDocId) return;
    const docId = player.pendingOpenLyricsDocId;
    setDetailTarget(null);
    setOpenProjectId(null);
    setLyricsOpenRequest({ docId, nonce: Date.now() });
    setSubTab('lyrics');
    player.clearPendingOpenLyricsDoc();
  }, [player.pendingOpenLyricsDocId]);

  // Open Project Page automatically when user taps project name inside the player
  useEffect(() => {
    if (!player.pendingOpenProjectId) return;
    const projId = player.pendingOpenProjectId;
    setDetailTarget(null);
    setOpenPlaylistId(null);
    setShowNewProj(false);
    setOpenProjectId(projId);
    if (subTab === 'lyrics' || subTab === 'profile' || subTab === 'social') {
      setSubTab('projects');
    }
    player.clearPendingOpenProjectPage();
  }, [player.pendingOpenProjectId]);

  // Open Artist Profile automatically when user taps author name inside the player
  useEffect(() => {
    if (!player.pendingOpenProfileUid) return;
    const targetUid = player.pendingOpenProfileUid;
    setDetailTarget(null);
    setOpenProjectId(null);
    setOpenPlaylistId(null);
    setShowNewProj(false);
    if (targetUid === 'me' || targetUid === cloudUser?.uid) {
      setSocialTargetArtistUid(null);
      setSubTab('profile');
    } else {
      setSocialTargetArtistUid(targetUid);
      setSubTab('social');
    }
    player.clearPendingOpenProfile();
  }, [player.pendingOpenProfileUid, cloudUser?.uid]);

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
    const grp = trackGroups.find((g) => g.allTrackIds.includes(prodTrack.id));
    const currentIsOneOfProds = Boolean(
      grp && player.currentTrack && grp.prodTracks.some((p) => p.track.id === player.currentTrack!.id)
    );
    if (player.currentTrack?.id === prodTrack.id || currentIsOneOfProds) {
      player.togglePlay();
    } else {
      const q = grp ? [parentTrack, ...grp.prodTracks.map((p) => p.track)] : [parentTrack, prodTrack];
      void player.playTrack(prodTrack, 0, q);
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
        void player.playTrack(targetTrack, 0);
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
    setStudioContextMenu(null);
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
    customVersionLabel?: string,
    asProd?: boolean
  ) => {
    for (const id of movingTrackIds) {
      updateMusicTrack(id, {
        manualGroupKey: targetGroupKey,
        manualGroupTitle: targetGroupTitle,
        ...(customVersionLabel ? { manualVersionLabel: customVersionLabel } : {}),
        ...(asProd ? { isProdOverride: true } : {}),
      });
    }
    notify(
      asProd
        ? `Ajouté comme prod de « ${targetGroupTitle} » ✓`
        : `Associé comme version de « ${targetGroupTitle} » ✓`
    );
  };

  const handleDetachVersion = (trackId: string) => {
    const target = state.musicTracks.find((t) => t.id === trackId);
    if (!target) return;
    updateMusicTrack(trackId, {
      manualGroupKey: `solo_${trackId}`,
      manualGroupTitle: target.title,
      manualVersionLabel: 'Original',
      isProdOverride: undefined,
    });
    notify(`« ${target.title} » détaché en son indépendant ✓`);
  };

  const activeQueueTracks = useMemo(
    () => (subTab === 'library' ? filteredLibraryGroups : trackGroups).map(getActiveTrackForGroup),
    [subTab, filteredLibraryGroups, trackGroups, selectedVersionByGroup]
  );

  const renderProjectsSection = (compact: boolean) => {
    const showProjects = compact || projectStatusFilter !== 'playlists';
    const showPlaylists = compact || projectStatusFilter === 'all' || projectStatusFilter === 'playlists';

    const filteredProjects = showProjects
      ? compact
        ? state.musicProjects
        : state.musicProjects.filter((p) => {
            if (projectStatusFilter === 'active') return p.status !== 'sorti';
            if (projectStatusFilter === 'archived') return p.status === 'sorti';
            return true;
          })
      : [];

    const filteredPlaylists = showPlaylists ? playlists : [];
    const totalAllCount = state.musicProjects.length + playlists.length;
    const archivedProjCount = state.musicProjects.filter((p) => p.status === 'sorti').length;
    const activeProjCount = state.musicProjects.length - archivedProjCount;

    const projectList = compact ? filteredProjects.slice(0, 4) : filteredProjects;
    const playlistList = compact
      ? filteredPlaylists.slice(0, Math.max(0, 4 - projectList.length))
      : filteredPlaylists;

    return (
          <section className="space-y-3.5 pt-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
                  {compact ? 'Projets & Playlists' : 'Albums, EP, Mixtapes & Playlists'}
                </h2>
                {!compact && totalAllCount > 0 && (
                  <div className="inline-flex items-center flex-wrap rounded-xl bg-slate-100 dark:bg-zinc-900 p-0.5">
                    {(
                      [
                        ['all', `Tous (${totalAllCount})`],
                        ['active', `En cours (${activeProjCount})`],
                        ['playlists', `Playlists (${playlists.length})`],
                        ['archived', `Archives / Sortis (${archivedProjCount})`],
                      ] as const
                    ).map(([id, lbl]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setProjectStatusFilter(id)}
                        className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer ${
                          projectStatusFilter === id
                            ? 'bg-[#8C271E] text-white shadow-2xs'
                            : 'text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100'
                        }`}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {compact ? (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setShowNewProj(true)}
                    className="inline-flex items-center gap-1 rounded-full bg-[#8C271E] hover:bg-[#A32E24] text-white px-3 py-1 text-[11px] font-semibold shadow-xs shadow-[#8C271E]/25 transition cursor-pointer"
                  >
                    <Plus size={12} /> Nouveau
                  </button>
                  {totalAllCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setSubTab('projects')}
                      className="text-xs font-medium text-[#8C271E] dark:text-[#E56B5F] hover:underline cursor-pointer"
                    >
                      Tout voir ({totalAllCount}) →
                    </button>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowNewProj(true)}
                  className="inline-flex items-center gap-1 rounded-xl bg-[#8C271E] hover:bg-[#A32E24] text-white px-3.5 py-2 text-xs font-semibold shadow-xs shadow-[#8C271E]/25 transition cursor-pointer"
                >
                  <Plus size={13} /> Nouveau projet / playlist
                </button>
              )}
            </div>

            {projectList.length === 0 && playlistList.length === 0 ? (
              <div className="tempo-card rounded-3xl p-7 text-center space-y-2.5">
                <p className="text-xs text-slate-400">
                  {totalAllCount === 0
                    ? 'Crée un projet (Single, EP, Album, Mixtape) ou une Playlist (tes sons + sons likés) avec sa pochette et sa tracklist.'
                    : 'Aucun élément dans ce filtre.'}
                </p>
                <button
                  type="button"
                  onClick={() => setShowNewProj(true)}
                  className="inline-flex items-center gap-1 rounded-xl bg-[#8C271E] hover:bg-[#A32E24] text-white px-3.5 py-2 text-xs font-semibold shadow-xs shadow-[#8C271E]/25 cursor-pointer"
                >
                  <Plus size={13} /> Créer un projet ou une playlist
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5">
                {projectList.map((proj) => {
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
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setContextMenu(null);
                        setStudioContextMenu({
                          kind: 'project',
                          project: proj,
                          x: e.clientX,
                          y: e.clientY,
                        });
                      }}
                      className="group cursor-pointer space-y-2.5"
                    >
                      <div className="relative aspect-square w-full rounded-[26px] overflow-hidden shadow-md border border-slate-200/70 dark:border-zinc-800/80 transition group-hover:scale-[1.015] group-active:scale-[0.985]">
                        <ProjectCoverArtwork
                          title={proj.title}
                          projectCoverUrl={proj.coverDataUrl}
                          trackCoverUrls={getProjectTrackIndividualCovers(linkedTracks)}
                          gradientId={proj.coverGradient}
                        />

                        <span className="absolute top-2.5 left-2.5 rounded-full bg-black/40 backdrop-blur-md px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white">
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
                          className="absolute bottom-2.5 right-2.5 h-10 w-10 rounded-2xl bg-[#8C271E]/90 hover:bg-[#8C271E] text-white flex items-center justify-center hover:scale-105 active:scale-95 transition shadow-lg backdrop-blur-xs cursor-pointer"
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
                            <span className="font-mono text-[10px] font-semibold text-slate-500 dark:text-zinc-400 shrink-0">
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

                {playlistList.map((pl) => {
                  const ownQueue = pl.ownTrackIds
                    .map((id) => state.musicTracks.find((t) => t.id === id))
                    .filter((t): t is MusicTrack => Boolean(t));
                  const socialQueue = pl.socialTrackIds
                    .map((id) => likedSocialTracks.find((s) => s.id === id))
                    .filter((s): s is SocialTrackItem => Boolean(s))
                    .map(socialTrackToMusicTrack);
                  const fullQueue = [...ownQueue, ...socialQueue];
                  const totalTracks = pl.ownTrackIds.length + pl.socialTrackIds.length;
                  const isPlayingPl =
                    player.isPlaying &&
                    fullQueue.some((t) => t.id === player.currentTrack?.id);

                  return (
                    <div
                      key={pl.id}
                      onClick={() => setOpenPlaylistId(pl.id)}
                      className="group cursor-pointer space-y-2.5"
                    >
                      <div className="relative aspect-square w-full rounded-[26px] overflow-hidden shadow-md border border-slate-200/70 dark:border-zinc-800/80 transition group-hover:scale-[1.015] group-active:scale-[0.985]">
                        <ProjectCoverArtwork
                          title={pl.title}
                          projectCoverUrl={pl.coverDataUrl}
                          trackCoverUrls={getProjectTrackIndividualCovers(ownQueue)}
                          gradientId={pl.coverGradient}
                        />

                        <span className="absolute top-2.5 left-2.5 rounded-full bg-[#8C271E]/85 backdrop-blur-md px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white">
                          Playlist
                        </span>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (fullQueue.length === 0) {
                              setOpenPlaylistId(pl.id);
                              return;
                            }
                            if (isPlayingPl) {
                              player.togglePlay();
                            } else {
                              void player.playTrack(fullQueue[0], 0, fullQueue);
                            }
                          }}
                          aria-label={`Lire ${pl.title}`}
                          className="absolute bottom-2.5 right-2.5 h-10 w-10 rounded-2xl bg-[#8C271E]/90 hover:bg-[#8C271E] text-white flex items-center justify-center hover:scale-105 active:scale-95 transition shadow-lg backdrop-blur-xs cursor-pointer"
                        >
                          {isPlayingPl ? (
                            <Pause size={16} fill="currentColor" />
                          ) : (
                            <Play size={16} fill="currentColor" className="ml-0.5" />
                          )}
                        </button>
                      </div>

                      <div className="px-0.5 space-y-0.5">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-zinc-100 truncate">
                          {pl.title}
                        </h3>
                        <p className="text-xs text-slate-400 dark:text-zinc-500 truncate">
                          Playlist · {totalTracks} son{totalTracks > 1 ? 's' : ''}
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

  const hasActiveSubPage = Boolean(
    isSettingsOpen || isDocsOpen || showNewProj || detailGroup || openProjectId || openPlaylistId
  );

  const headerTitle = isSettingsOpen
    ? 'Paramètres'
    : isDocsOpen
      ? 'Guide & Documentation'
      : showNewProj
        ? 'Nouveau projet'
        : openPlaylistId
          ? 'Playlist'
          : openProjectId
            ? 'Projets'
            : detailGroup
              ? 'Sons'
              : (
                  {
                    dashboard: 'Accueil',
                    library: 'Sons',
                    projects: 'Projets',
                    lyrics: 'Textes',
                    social: 'Communauté & Social',
                    profile: 'Mon Profil & Portfolio',
                  } as Record<MusicSubTab, string>
                )[subTab];

  return (
    <div className="space-y-5 pb-14">
      {/* Persistent Top Section Header + Compact Drive Sync (ALWAYS visible across every page & sub-page!) */}
      <div className="flex items-center justify-between gap-3 pb-1 border-b border-[#8C271E]/15 dark:border-[#8C271E]/25">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            aria-hidden="true"
            className="h-6 sm:h-7 w-1.5 rounded-full bg-[#8C271E] shrink-0 shadow-xs shadow-[#8C271E]/40"
          />
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-zinc-50 truncate">
            {headerTitle}
          </h1>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setPermanentSetupOpen(true)}
            title="Gérer les dossiers Google Drive connectés"
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium transition cursor-pointer ${
              driveSources.length === 0
                ? 'bg-[#8C271E] text-white font-semibold hover:bg-[#A32E24] shadow-xs shadow-[#8C271E]/25'
                : 'border border-[#8C271E]/25 dark:border-[#8C271E]/40 bg-white dark:bg-[#191111] text-slate-700 dark:text-zinc-200 hover:bg-[#8C271E]/8 hover:border-[#8C271E]/55'
            }`}
          >
            <HardDrive size={11} className={driveSources.length > 0 ? 'text-[#8C271E] dark:text-[#E56B5F]' : ''} />
            <span>
              {driveSources.length === 0
                ? 'Connecter un Drive'
                : `Drives (${driveSources.length})`}
            </span>
          </button>
          <button
            type="button"
            disabled={syncingDrive || autoSyncingDrive}
            onClick={() => void handleSyncAllDrive(true)}
            title="Synchroniser tous les Google Drives connectés"
            className="inline-flex items-center gap-1.5 rounded-full border border-[#8C271E]/25 dark:border-[#8C271E]/40 bg-white dark:bg-[#191111] hover:bg-[#8C271E]/8 hover:border-[#8C271E]/55 px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-zinc-200 disabled:opacity-50 transition cursor-pointer"
          >
            <RefreshCw
              size={11}
              className={
                syncingDrive || autoSyncingDrive
                  ? 'animate-spin text-[#8C271E] dark:text-[#E56B5F]'
                  : 'text-[#8C271E] dark:text-[#E56B5F]'
              }
            />
            <span>{syncingDrive || autoSyncingDrive ? 'Sync…' : 'Sync'}</span>
            {driveSources.length > 0 && !syncingDrive && !autoSyncingDrive && (
              <span className="h-1.5 w-1.5 rounded-full bg-[#8C271E]" />
            )}
          </button>
        </div>
      </div>

      {/* ================= IN-APP SUB-PAGES (full-width directly under top header!) ================= */}
      <Suspense fallback={<LazyViewFallback />}>
      {isSettingsOpen ? (
        <SettingsPage onOpenProfile={() => setSubTab('profile')} />
      ) : isDocsOpen ? (
        <DocumentationPage
          onNavigateTab={(tab) => {
            setShowNewProj(false);
            setDetailTarget(null);
            setOpenProjectId(null);
            setSubTab(tab);
          }}
          onOpenDriveManager={() => setPermanentSetupOpen(true)}
          onCreateProject={() => {
            setDetailTarget(null);
            setOpenProjectId(null);
            setSubTab('projects');
            setShowNewProj(true);
          }}
          onCreateLyrics={() => {
            const newDocId = addLyricsDoc({ title: 'Nouveau texte' });
            setShowNewProj(false);
            setDetailTarget(null);
            setOpenProjectId(null);
            setLyricsOpenRequest({ docId: newDocId, nonce: Date.now() });
            setSubTab('lyrics');
          }}
        />
      ) : showNewProj ? (
        <ProjectCreationModal
          open={showNewProj}
          onClose={() => setShowNewProj(false)}
          onCreated={(newProjectId) => {
            setShowNewProj(false);
            setOpenProjectId(newProjectId);
          }}
          onCreatedPlaylist={(newPlaylistId) => {
            setShowNewProj(false);
            setOpenPlaylistId(newPlaylistId);
          }}
        />
      ) : detailGroup ? (
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
          onRequestPullProd={(g, tid) =>
            setLinkModal({
              mode: 'pull-into-group',
              sourceGroup: g,
              sourceTrackId: tid,
              defaultAsProd: true,
            })
          }
          onRequestAttachToOther={(g, tid) =>
            setLinkModal({ mode: 'attach-to-target', sourceGroup: g, sourceTrackId: tid })
          }
          onDetachVersion={handleDetachVersion}
          onOpenContextMenu={handleOpenContextMenu}
          onClose={() => setDetailTarget(null)}
        />
      ) : openProjectId ? (
        <ProjectAlbumModal
          projectId={openProjectId}
          onClose={() => setOpenProjectId(null)}
          onOpenProfile={() => {
            setOpenProjectId(null);
            setDetailTarget(null);
            setSocialTargetArtistUid(null);
            setSubTab('profile');
          }}
          onOpenTrackDetails={(trackId) => {
            const grp = trackGroups.find((g) => g.allTrackIds.includes(trackId));
            if (grp) setDetailTarget({ groupKey: grp.groupKey, trackId });
          }}
          onOpenContextMenu={handleOpenContextMenu}
          onOpenProjectContextMenu={(e, proj) => {
            setContextMenu(null);
            setStudioContextMenu({
              kind: 'project',
              project: proj,
              x: e.clientX,
              y: e.clientY,
            });
          }}
        />
      ) : openPlaylistId ? (
        <PlaylistPage
          playlistId={openPlaylistId}
          onClose={() => setOpenPlaylistId(null)}
          onOpenOwnTrack={(trackId) => {
            const grp = trackGroups.find((g) => g.allTrackIds.includes(trackId));
            if (grp) {
              setOpenPlaylistId(null);
              setDetailTarget({ groupKey: grp.groupKey, trackId });
            }
          }}
          onOpenSocialTrack={(soc) => {
            setOpenPlaylistId(null);
            setSocialTargetTrack(soc);
            setSubTab('social');
          }}
          onOpenArtistProfile={(artistUid) => {
            setOpenPlaylistId(null);
            setSocialTargetArtistUid(artistUid);
            setSubTab('social');
          }}
        />
      ) : null}
      </Suspense>

      {!hasActiveSubPage && (
        <>
      {/* Zero-Drive / Empty Account Instant Onboarding Card */}
      {driveSources.length === 0 && state.musicTracks.length === 0 && (subTab === 'dashboard' || subTab === 'library') && (
        <section className="tempo-card rounded-2xl p-5 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
              Bienvenue sur Rowav Studio
            </h2>
            <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
              Connecte un ou plusieurs dossiers Google Drive pour synchroniser tous tes MP3, versions et projets en quelques secondes.
            </p>
          </div>
          <DriveSourcesManager />
        </section>
      )}

      {/* ================= TAB 1: DASHBOARD MUSIC (MISE EN AVANT) ================= */}
      {subTab === 'dashboard' && (
        <div className="space-y-6">

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
                      group.prodTracks.some((p) => p.track.id === player.currentTrack?.id) &&
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
                  className="text-xs font-medium text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100 hover:underline cursor-pointer"
                >
                  Tout voir ({trackGroups.length}) →
                </button>
              </div>
            </div>

            {recentGroups.length === 0 ? (
              syncingDrive || autoSyncingDrive ? (
                <TrackCardSkeletonGrid count={6} />
              ) : (
                <div className="tempo-card rounded-2xl p-7 text-center space-y-3">
                  <p className="text-xs text-slate-400">
                    {driveSources.length === 0
                      ? 'Connecte ton premier dossier Google Drive ci-dessus pour charger tes MP3.'
                      : 'Aucun MP3 trouvé dans tes dossiers connectés.'}
                  </p>
                  <button
                    type="button"
                    disabled={syncingDrive || autoSyncingDrive}
                    onClick={() =>
                      driveSources.length === 0
                        ? setPermanentSetupOpen(true)
                        : void handleSyncAllDrive(true)
                    }
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25 px-4 py-2 text-xs font-semibold cursor-pointer"
                  >
                    <RefreshCw size={13} className={syncingDrive || autoSyncingDrive ? 'animate-spin' : ''} />
                    {driveSources.length === 0 ? 'Connecter un Google Drive' : 'Synchroniser Google Drive'}
                  </button>
                </div>
              )
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {recentGroups.map((group, idx) => {
                  const activeTrack = getActiveTrackForGroup(group);
                  const isCurrent = player.currentTrack?.id === activeTrack.id;
                  const isPlayingProd = Boolean(
                    group.prodTracks.some((p) => p.track.id === player.currentTrack?.id) &&
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

          {/* ===== FEATURED SECTION 4: SONS LIKÉS (COMMUNAUTÉ KORA SOCIAL) ===== */}
          <section className="space-y-3 pt-1">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Heart size={15} className="text-rose-500" fill="currentColor" />
                <h2 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
                  Sons likés · Communauté
                </h2>
                {likedSocialTracks.length > 0 && (
                  <span className="font-mono text-[11px] text-slate-400">
                    ({likedSocialTracks.length})
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {likedSocialTracks.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const q = likedSocialTracks.map(socialTrackToMusicTrack);
                      if (q.length > 0) void player.playShuffled(q);
                    }}
                    title="Lecture aléatoire des sons likés"
                    className="h-8 w-8 rounded-full inline-flex items-center justify-center text-slate-500 dark:text-zinc-400 hover:text-slate-950 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-zinc-800 transition cursor-pointer"
                  >
                    <Shuffle size={14} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSubTab('social')}
                  className="text-xs font-medium text-[#8C271E] dark:text-[#E56B5F] hover:underline cursor-pointer"
                >
                  Explorer la communauté →
                </button>
              </div>
            </div>

            {likedSocialTracks.length === 0 ? (
              <div className="tempo-card rounded-2xl px-4 py-5 flex flex-col sm:flex-row items-center justify-between gap-3">
                <p className="text-xs text-slate-400">
                  Découvre les projets des autres artistes sur <strong>Rowav Social</strong> — tous les sons que tu likes (<span className="text-rose-500 font-semibold">♥</span>) apparaissent ici et peuvent être ajoutés à tes playlists.
                </p>
                <button
                  type="button"
                  onClick={() => setSubTab('social')}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#8C271E] hover:bg-[#A32E24] text-white px-3.5 py-1.5 text-xs font-semibold shadow-xs shadow-[#8C271E]/25 shrink-0 cursor-pointer"
                >
                  <Users size={12} /> Découvrir les sons
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {likedSocialTracks.slice(0, 6).map((soc) => {
                  const playable = socialTrackToMusicTrack(soc);
                  const isCurrent = player.currentTrack?.id === playable.id;
                  const isPlayingThis = isCurrent && player.isPlaying;
                  const queue = likedSocialTracks.map(socialTrackToMusicTrack);

                  return (
                    <div
                      key={soc.id}
                      onClick={() => {
                        setSocialTargetTrack(soc);
                        setSubTab('social');
                      }}
                      title="Clic sur la carte pour ouvrir la fiche du son · Clic sur ▶ pour écouter"
                      className={`tempo-card rounded-2xl p-3.5 flex items-center justify-between gap-3 transition cursor-pointer ${
                        isCurrent
                          ? 'ring-1 ring-[#8C271E] bg-[#8C271E]/8'
                          : 'hover:border-[#8C271E]/40'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isCurrent) {
                              player.togglePlay();
                            } else {
                              void player.playTrack(playable, 0, queue);
                            }
                          }}
                          title={isPlayingThis ? 'Pause' : 'Écouter ce son'}
                          className="relative h-12 w-12 rounded-xl overflow-hidden shrink-0 flex items-center justify-center text-white font-bold text-xs shadow-xs cursor-pointer"
                          style={getCoverGradientStyle(soc.coverGradient)}
                        >
                          {soc.coverUrl ? (
                            <img
                              src={soc.coverUrl}
                              alt={soc.title}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            soc.title.slice(0, 2).toUpperCase()
                          )}
                          <span className="absolute inset-0 bg-black/35 flex items-center justify-center text-white">
                            {isPlayingThis ? (
                              <Pause size={15} fill="currentColor" />
                            ) : (
                              <Play size={15} fill="currentColor" className="ml-0.5" />
                            )}
                          </span>
                        </button>

                        <div className="min-w-0">
                          <p
                            className={`text-xs font-bold truncate ${
                              isCurrent ? 'text-[#8C271E] dark:text-[#E56B5F]' : 'text-slate-900 dark:text-zinc-100'
                            }`}
                          >
                            {soc.title}
                          </p>
                          <div className="flex items-center gap-1.5 text-[11px] text-slate-400 truncate">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSocialTargetArtistUid(soc.ownerUid);
                                setSubTab('social');
                              }}
                              className="hover:text-[#8C271E] dark:hover:text-[#E56B5F] hover:underline truncate cursor-pointer"
                            >
                              {soc.artist}
                            </button>
                            {soc.myRating && (
                              <>
                                <span>·</span>
                                <span className="font-mono text-[#8C271E] dark:text-[#E56B5F] font-semibold">
                                  ★ {soc.myRating}/10
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleLikeSocialTrack(soc, false);
                          notify(`« ${soc.title} » retiré des sons likés`);
                        }}
                        title="Retirer des sons likés"
                        className="h-8 w-8 rounded-full bg-rose-500/10 text-rose-500 inline-flex items-center justify-center shrink-0 hover:bg-rose-500/20 transition cursor-pointer"
                      >
                        <Heart size={13} fill="currentColor" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {/* ================= TAB: PROJETS (ALBUMS, EP, SINGLES, MIXTAPES, PLAYLISTS) ================= */}
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
                      ? 'bg-[#8C271E] text-white border-[#8C271E] shadow-xs shadow-[#8C271E]/25'
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
                    ['archived', 'Archives & Masters', Archive],
                  ] as const
                ).map(([id, label, Icon]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setLibFilter(id)}
                    className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium transition cursor-pointer ${
                      libFilter === id
                        ? 'bg-[#8C271E] text-white shadow-2xs'
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
                      ? 'bg-[#8C271E] text-white'
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
                      ? 'bg-[#8C271E] text-white'
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
                        ? 'bg-[#8C271E] text-white'
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
                      ? 'bg-[#8C271E] text-white'
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
                      ? 'bg-[#8C271E] text-white'
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
                      ? 'bg-[#8C271E] text-white'
                      : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  Δ Écart
                </button>
              </div>
            </div>
          </div>

          {/* Clickable Cards Grid (with shimmer skeleton while syncing Drive!) */}
          {filteredLibraryGroups.length === 0 ? (
            syncingDrive || autoSyncingDrive ? (
              <TrackCardSkeletonGrid count={6} />
            ) : (
              <div className="tempo-card rounded-3xl p-10 text-center space-y-2">
                <p className="text-xs text-slate-400">
                  {state.musicTracks.length === 0
                    ? 'Aucun MP3 dans ta bibliothèque. Clique sur « Sync » ci-dessus.'
                    : 'Aucun morceau ne correspond à ce filtre.'}
                </p>
              </div>
            )
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
        <Suspense fallback={<LazyViewFallback />}>
          <LyricsStudio
            initialDocId={null}
            openRequest={lyricsOpenRequest}
            resetNonce={navResetNonce}
            backLabel={lyricsReturnContext ? 'Retour' : 'Textes'}
            onOpenDocContextMenu={(e, doc) => {
              setContextMenu(null);
              setStudioContextMenu({
                kind: 'lyrics',
                doc,
                x: e.clientX,
                y: e.clientY,
              });
            }}
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
        </Suspense>
      )}

      {/* ================= TAB 4 & 5: ROWAV SOCIAL & PROFIL ARTISTE PORTFOLIO ================= */}
      {(subTab === 'social' || subTab === 'profile') && (
        <Suspense fallback={<LazyViewFallback />}>
          <SocialHubView
            initialMode={subTab === 'profile' ? 'profile' : 'discover'}
            initialArtistUid={
              subTab === 'profile' ? null : socialTargetArtistUid
            }
            initialSocialTrack={subTab === 'profile' ? null : socialTargetTrack}
            onClearInitialSocialTrack={() => setSocialTargetTrack(null)}
            onOpenOwnProject={(projId) => setOpenProjectId(projId)}
            onOpenPlaylist={(plId) => setOpenPlaylistId(plId)}
          />
        </Suspense>
      )}
        </>
      )}

      {/* ================= CONTEXT MENU & UTILITY MODALS ================= */}
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
        onRequestPullProd={(g, tid) =>
          setLinkModal({
            mode: 'pull-into-group',
            sourceGroup: g,
            sourceTrackId: tid,
            defaultAsProd: true,
          })
        }
        onDetachVersion={handleDetachVersion}
      />

      <StudioGlobalContextMenu
        menu={studioContextMenu}
        onClose={() => setStudioContextMenu(null)}
        onNavigateTab={(tab) => {
          setShowNewProj(false);
          setDetailTarget(null);
          setOpenProjectId(null);
          setSubTab(tab);
        }}
        onOpenSettings={onOpenSettings}
        onOpenDocs={onOpenDocs}
        onOpenProject={(projId) => {
          setShowNewProj(false);
          setDetailTarget(null);
          setOpenProjectId(projId);
        }}
        onCreateProject={() => {
          setDetailTarget(null);
          setOpenProjectId(null);
          setShowNewProj(true);
        }}
        onOpenLyricsDoc={(docId) => {
          setShowNewProj(false);
          setDetailTarget(null);
          setOpenProjectId(null);
          setLyricsOpenRequest({ docId, nonce: Date.now() });
          setSubTab('lyrics');
        }}
        onCreateLyricsDoc={() => {
          const newDocId = addLyricsDoc({ title: 'Nouveau texte' });
          setShowNewProj(false);
          setDetailTarget(null);
          setOpenProjectId(null);
          setLyricsOpenRequest({ docId: newDocId, nonce: Date.now() });
          setSubTab('lyrics');
        }}
        onOpenDriveManager={() => setPermanentSetupOpen(true)}
        onSyncDrives={() => void handleSyncAllDrive(true)}
      />

      <LinkVersionModal
        modal={linkModal}
        allGroups={trackGroups}
        onClose={() => setLinkModal(null)}
        onConfirmLink={handleConfirmManualLink}
      />

      <DrivePermanentSetupModal
        open={permanentSetupOpen}
        onClose={() => setPermanentSetupOpen(false)}
      />
    </div>
  );
}
