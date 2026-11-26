import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Check,
  ChevronLeft,
  Compass,
  Disc3,
  GitBranch,
  Globe,
  Heart,
  ListMusic,
  Loader2,
  MapPin,
  MessageCircle,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Send,
  Share2,
  Shuffle,
  Sparkles,
  Star,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAudioPlayer } from '../../context/AudioPlayerContext';
import {
  COVER_GRADIENTS,
  getCoverGradientStyle,
  groupMusicTracks,
  parseTrackVersion,
} from '../../lib/musicVersioning';
import {
  fetchSocialHub,
  postSocialAction,
  socialTrackToMusicTrack,
} from '../../lib/socialApi';
import { prepareAvatarDataUrl, resolveEffectiveTrackCover } from '../../lib/trackCover';
import type {
  MusicProject,
  SocialArtistProfile,
  SocialDirectMessage,
  SocialProjectItem,
  SocialTrackItem,
} from '../../types';
import { ProjectCoverArtwork } from './ProjectCoverArtwork';
import { SocialFeedSkeleton } from '../ui/Skeleton';

function formatDuration(sec?: number): string {
  if (!sec || !Number.isFinite(sec) || sec <= 0) return '2:35';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const BAR_COUNT = 110;
const BAR_STEP_PX = 4.5;
const TOTAL_TAPE_PX = BAR_COUNT * BAR_STEP_PX;

export type SocialViewMode = 'discover' | 'profile' | 'messages';

interface SocialHubViewProps {
  initialMode?: SocialViewMode;
  initialArtistUid?: string | null;
  initialSocialTrack?: SocialTrackItem | null;
  onClearInitialSocialTrack?: () => void;
  onOpenOwnProject?: (projectId: string) => void;
  onOpenPlaylist?: (playlistId: string) => void;
}

export function SocialHubView({
  initialMode = 'discover',
  initialArtistUid = null,
  initialSocialTrack = null,
  onClearInitialSocialTrack,
  onOpenOwnProject,
  onOpenPlaylist,
}: SocialHubViewProps) {
  const {
    state,
    cloudUser,
    playlists,
    likedSocialTracks,
    toggleLikeSocialTrack,
    updateLikedSocialTrackMeta,
    toggleTrackInPlaylist,
    createPlaylist,
    updatePreferences,
    updateUserAvatar,
    notify,
  } = useApp();
  const player = useAudioPlayer();
  const profileAvatarInputRef = useRef<HTMLInputElement>(null);

  const myUid = cloudUser?.uid || 'local_me';
  const myName =
    state.preferences.name?.trim() ||
    cloudUser?.displayName?.trim() ||
    cloudUser?.email?.split('@')[0] ||
    'Artiste Rowav';

  const [mode, setMode] = useState<SocialViewMode>(initialMode);
  const [viewingArtistUid, setViewingArtistUid] = useState<string | null>(initialArtistUid);
  const [viewingSocialProjectId, setViewingSocialProjectId] = useState<string | null>(null);
  const [viewingSocialTrackId, setViewingSocialTrackId] = useState<string | null>(
    initialSocialTrack?.id || null
  );
  const [fallbackSocialTrack, setFallbackSocialTrack] = useState<SocialTrackItem | null>(
    initialSocialTrack
  );
  const [feedFilter, setFeedFilter] = useState<'trending' | 'following' | 'recent'>('trending');

  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<SocialArtistProfile[]>([]);
  const [socialProjects, setSocialProjects] = useState<SocialProjectItem[]>([]);
  const [messages, setMessages] = useState<SocialDirectMessage[]>([]);

  // Rating popover state
  const [ratingTargetTrack, setRatingTargetTrack] = useState<SocialTrackItem | null>(null);
  // Add to Playlist popover state
  const [playlistTargetTrack, setPlaylistTargetTrack] = useState<SocialTrackItem | null>(null);
  const [quickPlaylistTitle, setQuickPlaylistTitle] = useState('');

  // Publish project sheet state
  const [showPublishSheet, setShowPublishSheet] = useState(false);
  const [publishingProjId, setPublishingProjId] = useState<string | null>(null);

  // Edit My Profile sheet state
  const [editingProfile, setEditingProfile] = useState(false);
  const [editName, setEditName] = useState(myName);
  const [editBio, setEditBio] = useState(
    state.preferences.bio || 'Producteur & Artiste sur Rowav Music Studio.'
  );
  const [editLocation, setEditLocation] = useState('Paris, FR');
  const [editGenres, setEditGenres] = useState('Rap FR, Cloud, Melodic');
  const [editGradient, setEditGradient] = useState('sunset');

  // Direct Messaging state
  const [activeChatUid, setActiveChatUid] = useState<string>('');
  const [messageDraft, setMessageDraft] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    if (initialArtistUid) {
      setViewingArtistUid(initialArtistUid);
      setViewingSocialTrackId(null);
      setViewingSocialProjectId(null);
      setMode('profile');
    }
  }, [initialArtistUid]);

  useEffect(() => {
    if (initialSocialTrack) {
      setFallbackSocialTrack(initialSocialTrack);
      setViewingSocialTrackId(initialSocialTrack.id);
    }
  }, [initialSocialTrack]);

  const trackGroups = useMemo(() => groupMusicTracks(state.musicTracks), [state.musicTracks]);

  const loadSocialData = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await fetchSocialHub(state.preferences.firebaseConfig);
        if (res.ok) {
          setProfiles(res.profiles);
          setSocialProjects(res.projects);
          setMessages(res.messages);
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [state.preferences.firebaseConfig]
  );

  useEffect(() => {
    void loadSocialData(false);
  }, [loadSocialData]);

  const likedIdSet = useMemo(
    () => new Set(likedSocialTracks.map((t) => t.id)),
    [likedSocialTracks]
  );

  const myProfile = useMemo<SocialArtistProfile>(() => {
    const found = profiles.find((p) => p.uid === myUid);
    const myPublishedProjects = socialProjects.filter((p) => p.ownerUid === myUid);
    const myPublishedTracks = myPublishedProjects.flatMap((p) => p.tracks);
    const totalLikes =
      myPublishedTracks.reduce((a, t) => a + (t.likesCount || 0), 0) +
      myPublishedProjects.reduce((a, p) => a + (p.likesCount || 0), 0);
    const rated = myPublishedTracks.filter((t) => (t.ratingCount || 0) > 0);
    const avg =
      rated.length > 0
        ? Math.round(
            (rated.reduce((a, t) => a + (t.ratingAvg || 0), 0) / rated.length) * 10
          ) / 10
        : 0;

    const effectiveMyAvatar =
      state.preferences.avatarUrl || found?.avatarUrl || cloudUser?.photoURL || undefined;

    if (found) {
      return {
        ...found,
        name: myName || found.name,
        avatarUrl: effectiveMyAvatar,
      };
    }

    return {
      uid: myUid,
      name: myName,
      handle: `@${myName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'artiste'}`,
      bio: state.preferences.bio || 'Producteur & Artiste sur Rowav Music Studio.',
      avatarUrl: effectiveMyAvatar,
      coverGradient: 'sunset',
      location: 'Paris, FR',
      genres: ['Studio', 'Production'],
      followersCount: 0,
      followingCount: profiles.filter((p) => p.isFollowedByMe).length,
      totalLikes,
      averageRating: avg,
      ratingsCount: rated.length,
      projectsCount: myPublishedProjects.length,
      tracksCount: myPublishedTracks.length,
      updatedAt: new Date().toISOString(),
    };
  }, [profiles, socialProjects, myUid, myName, state.preferences, cloudUser]);

  const activeArtistProfile = useMemo<SocialArtistProfile>(() => {
    const targetUid = viewingArtistUid || myUid;
    if (targetUid === myUid) return myProfile;
    return (
      profiles.find((p) => p.uid === targetUid) || {
        uid: targetUid,
        name: 'Artiste Rowav',
        handle: '@artiste',
        bio: 'Artiste Rowav Studio',
        coverGradient: 'sunset',
        followersCount: 0,
        followingCount: 0,
        totalLikes: 0,
        averageRating: 0,
        ratingsCount: 0,
        projectsCount: 0,
        tracksCount: 0,
        updatedAt: new Date().toISOString(),
      }
    );
  }, [viewingArtistUid, myUid, myProfile, profiles]);

  const isViewingOwnProfile = activeArtistProfile.uid === myUid;

  const activeSocialProject = useMemo(
    () => socialProjects.find((p) => p.id === viewingSocialProjectId) || null,
    [socialProjects, viewingSocialProjectId]
  );

  const activeSocialTrack = useMemo<SocialTrackItem | null>(() => {
    if (!viewingSocialTrackId) return null;
    for (const p of socialProjects) {
      const found = p.tracks.find((t) => t.id === viewingSocialTrackId);
      if (found) return found;
    }
    const fromLiked = likedSocialTracks.find((t) => t.id === viewingSocialTrackId);
    if (fromLiked) return fromLiked;
    if (fallbackSocialTrack?.id === viewingSocialTrackId) return fallbackSocialTrack;
    return null;
  }, [viewingSocialTrackId, socialProjects, likedSocialTracks, fallbackSocialTrack]);

  // Deterministic 110-bar waveform for the active community track (matches TrackDetailModal!)
  const activeTrackWaveformBars = useMemo(() => {
    const id = activeSocialTrack?.id || 'rowav';
    let seed = id.split('').reduce((a, c) => a + c.charCodeAt(0), 31);
    return Array.from({ length: BAR_COUNT }, (_, idx) => {
      seed = (seed * 9301 + 49297) % 233280;
      const rnd = seed / 233280;
      const env = Math.sin((idx / BAR_COUNT) * Math.PI) * 0.55 + 0.45;
      return Math.max(0.18, Math.min(1, (0.25 + rnd * 0.75) * env));
    });
  }, [activeSocialTrack?.id]);

  const filteredProjects = useMemo(() => {
    const list = [...socialProjects];
    if (feedFilter === 'following') {
      const followedUids = new Set(
        profiles.filter((p) => p.isFollowedByMe).map((p) => p.uid)
      );
      followedUids.add(myUid);
      const followedProjects = list.filter((p) => followedUids.has(p.ownerUid));
      return followedProjects.length > 0 ? followedProjects : list;
    }
    if (feedFilter === 'recent') {
      return list.sort(
        (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
      );
    }
    return list.sort((a, b) => {
      const scoreA =
        (a.likesCount || 0) * 2 +
        a.tracks.reduce((acc, t) => acc + (t.likesCount || 0) + (t.ratingAvg || 0), 0);
      const scoreB =
        (b.likesCount || 0) * 2 +
        b.tracks.reduce((acc, t) => acc + (t.likesCount || 0) + (t.ratingAvg || 0), 0);
      return scoreB - scoreA;
    });
  }, [socialProjects, feedFilter, profiles, myUid]);

  const handlePlaySocialTrack = (track: SocialTrackItem, queueItems?: SocialTrackItem[]) => {
    const playable = socialTrackToMusicTrack(track);
    if (player.currentTrack?.id === playable.id) {
      player.togglePlay();
      return;
    }
    const queue = (queueItems && queueItems.length > 0 ? queueItems : [track]).map(
      socialTrackToMusicTrack
    );
    void player.playTrack(playable, 0, queue);
  };

  const handleToggleLikeTrack = async (track: SocialTrackItem) => {
    const currentlyLiked = likedIdSet.has(track.id) || Boolean(track.likedByMe);
    const nextLiked = !currentlyLiked;
    const updatedTrack: SocialTrackItem = {
      ...track,
      likedByMe: nextLiked,
      likesCount: Math.max(0, (track.likesCount || 0) + (nextLiked ? 1 : -1)),
    };
    toggleLikeSocialTrack(updatedTrack, nextLiked);
    if (fallbackSocialTrack?.id === track.id) {
      setFallbackSocialTrack(updatedTrack);
    }

    setSocialProjects((prev) =>
      prev.map((proj) => ({
        ...proj,
        tracks: proj.tracks.map((t) => (t.id === track.id ? updatedTrack : t)),
      }))
    );

    notify(
      nextLiked
        ? `« ${track.title} » ajouté à tes Sons likés ♥`
        : `« ${track.title} » retiré de tes Sons likés`
    );

    const res = await postSocialAction(
      {
        action: 'toggle_like_track',
        trackId: track.id,
        userName: myName,
      },
      state.preferences.firebaseConfig
    );
    if (res.ok) {
      setProfiles(res.profiles);
      setSocialProjects(res.projects);
    }
  };

  const handleToggleLikeProject = async (proj: SocialProjectItem) => {
    const nextLiked = !proj.likedByMe;
    setSocialProjects((prev) =>
      prev.map((p) =>
        p.id === proj.id
          ? {
              ...p,
              likedByMe: nextLiked,
              likesCount: Math.max(0, (p.likesCount || 0) + (nextLiked ? 1 : -1)),
            }
          : p
      )
    );
    const res = await postSocialAction(
      {
        action: 'toggle_like_project',
        projectId: proj.id,
        userName: myName,
      },
      state.preferences.firebaseConfig
    );
    if (res.ok) {
      setProfiles(res.profiles);
      setSocialProjects(res.projects);
    }
  };

  const handleRateTrack = async (track: SocialTrackItem, rating: number) => {
    setRatingTargetTrack(null);
    updateLikedSocialTrackMeta(track.id, { myRating: rating });
    if (fallbackSocialTrack?.id === track.id) {
      setFallbackSocialTrack({ ...fallbackSocialTrack, myRating: rating });
    }
    setSocialProjects((prev) =>
      prev.map((proj) => ({
        ...proj,
        tracks: proj.tracks.map((t) =>
          t.id === track.id
            ? {
                ...t,
                myRating: rating,
                ratingAvg:
                  t.ratingCount && t.ratingAvg
                    ? Math.round(
                        ((t.ratingAvg * t.ratingCount + rating) / (t.ratingCount + 1)) * 10
                      ) / 10
                    : rating,
                ratingCount: (t.ratingCount || 0) + 1,
              }
            : t
        ),
      }))
    );
    notify(`Note ${rating}/10 attribuée à « ${track.title} » ★`);

    const res = await postSocialAction(
      {
        action: 'rate_track',
        trackId: track.id,
        rating,
        userName: myName,
      },
      state.preferences.firebaseConfig
    );
    if (res.ok) {
      setProfiles(res.profiles);
      setSocialProjects(res.projects);
    }
  };

  const handleToggleFollow = async (targetProfile: SocialArtistProfile) => {
    if (targetProfile.uid === myUid) return;
    const nextFollowed = !targetProfile.isFollowedByMe;
    setProfiles((prev) =>
      prev.map((p) =>
        p.uid === targetProfile.uid
          ? {
              ...p,
              isFollowedByMe: nextFollowed,
              followersCount: Math.max(0, p.followersCount + (nextFollowed ? 1 : -1)),
            }
          : p
      )
    );
    notify(
      nextFollowed
        ? `Abonné à ${targetProfile.name} ✓`
        : `Désabonné de ${targetProfile.name}`
    );

    const res = await postSocialAction(
      {
        action: 'toggle_follow',
        targetUid: targetProfile.uid,
        userName: myName,
      },
      state.preferences.firebaseConfig
    );
    if (res.ok) {
      setProfiles(res.profiles);
    }
  };

  const handlePublishProject = async (proj: MusicProject) => {
    setPublishingProjId(proj.id);
    try {
      const linkedTracks = proj.trackIds
        .map((id) => state.musicTracks.find((t) => t.id === id))
        .filter((t): t is NonNullable<typeof t> => Boolean(t));

      const tracksPayload = linkedTracks.map((trk) => {
        const grp = trackGroups.find((g) => g.allTrackIds.includes(trk.id));
        const parsed = parseTrackVersion(trk);
        const effCover = resolveEffectiveTrackCover(
          trk,
          state.musicProjects,
          grp?.groupKey,
          grp?.versions.map((v) => v.track)
        );
        return {
          id: trk.id,
          title: grp?.baseTitle || trk.manualGroupTitle || trk.title,
          artist: trk.artist || myName,
          versionLabel: parsed.versionLabel,
          coverUrl: effCover.cloudCoverUrl || undefined,
          coverGradient: effCover.gradientId || proj.coverGradient || 'sunset',
          durationSec: trk.durationSec || 155,
          bpm: trk.bpm,
          mood: trk.mood,
        };
      });

      const res = await postSocialAction(
        {
          action: 'publish_project',
          userName: myName,
          userBio: state.preferences.bio,
          project: {
            id: proj.id,
            title: proj.title,
            kind: proj.kind,
            description: proj.notes || '',
            coverGradient: proj.coverGradient || 'sunset',
            releaseDate: proj.targetReleaseDate || new Date().toISOString().slice(0, 10),
            tracks: tracksPayload,
          },
        },
        state.preferences.firebaseConfig
      );

      if (res.ok) {
        setProfiles(res.profiles);
        setSocialProjects(res.projects);
        setShowPublishSheet(false);
        notify(`Projet « ${proj.title} » publié sur Rowav Social & ton Portfolio ✓`);
      } else {
        notify(res.error || 'Impossible de publier ce projet');
      }
    } finally {
      setPublishingProjId(null);
    }
  };

  const handleUnpublishProject = async (projectId: string, title: string) => {
    const res = await postSocialAction(
      {
        action: 'unpublish_project',
        projectId,
        userName: myName,
      },
      state.preferences.firebaseConfig
    );
    if (res.ok) {
      setProfiles(res.profiles);
      setSocialProjects(res.projects);
      if (viewingSocialProjectId === projectId) {
        setViewingSocialProjectId(null);
      }
      notify(`« ${title} » retiré de Rowav Social`);
    }
  };

  const handleSaveMyProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = editName.trim() || myName;
    const cleanBio = editBio.trim();
    updatePreferences({ name: cleanName, bio: cleanBio });
    setEditingProfile(false);

    const res = await postSocialAction(
      {
        action: 'sync_profile',
        name: cleanName,
        bio: cleanBio,
        avatarUrl: state.preferences.avatarUrl || '',
        location: editLocation.trim(),
        coverGradient: editGradient,
        genres: editGenres
          .split(',')
          .map((g) => g.trim())
          .filter(Boolean),
      },
      state.preferences.firebaseConfig
    );
    if (res.ok) {
      setProfiles(res.profiles);
      notify('Profil artiste & portfolio mis à jour ✓');
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = messageDraft.trim();
    if (!text || !activeChatUid || sendingMsg) return;
    setSendingMsg(true);
    setMessageDraft('');
    try {
      const res = await postSocialAction(
        {
          action: 'send_message',
          toUid: activeChatUid,
          text,
          userName: myName,
        },
        state.preferences.firebaseConfig
      );
      if (res.ok) {
        setMessages(res.messages);
        setProfiles(res.profiles);
      }
    } finally {
      setSendingMsg(false);
    }
  };

  const openArtistPortfolio = (uid: string) => {
    setViewingSocialTrackId(null);
    setViewingSocialProjectId(null);
    onClearInitialSocialTrack?.();
    setViewingArtistUid(uid);
    setMode('profile');
  };

  const openDirectMessageWith = (uid: string) => {
    setViewingSocialTrackId(null);
    setViewingSocialProjectId(null);
    onClearInitialSocialTrack?.();
    setActiveChatUid(uid);
    setMode('messages');
  };

  const openSocialTrackPage = (trk: SocialTrackItem) => {
    setFallbackSocialTrack(trk);
    setViewingSocialTrackId(trk.id);
  };

  // Studio Track Row (Clicking ▶ plays; clicking the row opens the Community Song Page, identical to TrackCard!)
  const renderSocialTrackRow = (
    trk: SocialTrackItem,
    _idx: number,
    queueList: SocialTrackItem[],
    showProjectBadge = false
  ) => {
    const isCurrent = player.currentTrack?.id === trk.id;
    const isPlayingThis = isCurrent && player.isPlaying;
    const isLiked = likedIdSet.has(trk.id) || Boolean(trk.likedByMe);

    return (
      <div
        key={trk.id}
        onClick={() => openSocialTrackPage(trk)}
        title="Clic sur la ligne pour ouvrir la fiche du son · Clic sur ▶ pour écouter"
        className={`group flex items-center justify-between gap-3 rounded-2xl border p-3 transition cursor-pointer ${
          isCurrent
            ? 'border-[#8C271E]/65 bg-[#8C271E]/[0.05] dark:bg-[#8C271E]/[0.12]'
            : 'border-slate-200/75 dark:border-zinc-800/80 bg-slate-50/40 dark:bg-zinc-900/40 hover:border-[#8C271E]/35'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          {/* Playable Cover Thumbnail (identical to TrackCard) */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handlePlaySocialTrack(trk, queueList);
            }}
            title={isPlayingThis ? 'Pause' : 'Écouter ce son'}
            className="relative h-11 w-11 rounded-xl overflow-hidden shrink-0 flex items-center justify-center text-white font-bold text-xs shadow-xs cursor-pointer"
            style={getCoverGradientStyle(trk.coverGradient)}
          >
            {trk.coverUrl ? (
              <img
                src={trk.coverUrl}
                alt={trk.title}
                className="h-full w-full object-cover"
              />
            ) : (
              trk.title.slice(0, 2).toUpperCase()
            )}
            <span
              className={`absolute inset-0 bg-black/45 text-white flex items-center justify-center transition ${
                isCurrent ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
            >
              {isPlayingThis ? (
                <Pause size={15} fill="currentColor" />
              ) : (
                <Play size={15} fill="currentColor" className="ml-0.5" />
              )}
            </span>
          </button>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p
                className={`text-xs sm:text-sm font-semibold truncate ${
                  isCurrent ? 'text-[#8C271E] dark:text-[#E56B5F]' : 'text-slate-900 dark:text-zinc-100'
                }`}
              >
                {trk.title}
              </p>
              {trk.versionLabel && (
                <span className="rounded-full bg-slate-100 dark:bg-zinc-800 px-2 py-0.5 font-mono text-[10px] text-slate-500 dark:text-zinc-400 shrink-0">
                  {trk.versionLabel}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-zinc-500 truncate mt-0.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openArtistPortfolio(trk.ownerUid);
                }}
                className="hover:text-[#8C271E] dark:hover:text-[#E56B5F] hover:underline truncate cursor-pointer"
              >
                {trk.artist}
              </button>
              {showProjectBadge && trk.projectTitle && (
                <>
                  <span>·</span>
                  <span className="truncate">{trk.projectTitle}</span>
                </>
              )}
              {trk.bpm && (
                <>
                  <span>·</span>
                  <span className="font-mono">{trk.bpm} BPM</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right Actions: Rating /10, Like ♥, Add to Playlist +, Duration */}
        <div
          className="flex items-center gap-1.5 sm:gap-2 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => setRatingTargetTrack(trk)}
            title="Noter ce morceau sur 10"
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold transition cursor-pointer ${
              trk.myRating
                ? 'bg-[#8C271E]/15 text-[#8C271E] dark:text-[#E56B5F]'
                : (trk.ratingAvg || 0) > 0
                  ? 'bg-slate-100 dark:bg-zinc-800/90 text-slate-700 dark:text-zinc-200 hover:bg-slate-200 dark:hover:bg-zinc-700'
                  : 'border border-slate-200/80 dark:border-zinc-800 text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200'
            }`}
          >
            <Star
              size={11}
              className={
                trk.myRating || (trk.ratingAvg || 0) > 0
                  ? 'text-[#8C271E] dark:text-[#E56B5F]'
                  : 'text-slate-400'
              }
              fill={trk.myRating || (trk.ratingAvg || 0) > 0 ? 'currentColor' : 'none'}
            />
            <span>
              {trk.myRating
                ? `${trk.myRating}/10`
                : (trk.ratingAvg || 0) > 0
                  ? `${trk.ratingAvg}/10`
                  : 'Noter'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => void handleToggleLikeTrack(trk)}
            title={isLiked ? 'Retirer des sons likés' : 'Liker ce son'}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer ${
              isLiked
                ? 'bg-rose-500/12 text-rose-500'
                : 'border border-slate-200/80 dark:border-zinc-800 text-slate-500 dark:text-zinc-400 hover:text-rose-500'
            }`}
          >
            <Heart size={12} fill={isLiked ? 'currentColor' : 'none'} />
            <span className="font-mono">{trk.likesCount || 0}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (!likedIdSet.has(trk.id)) {
                toggleLikeSocialTrack(trk, true);
              }
              setPlaylistTargetTrack(trk);
            }}
            title="Ajouter à une playlist"
            className="h-7 w-7 rounded-full border border-slate-200/80 dark:border-zinc-800 inline-flex items-center justify-center text-slate-400 hover:text-slate-900 dark:hover:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-800 transition cursor-pointer"
          >
            <Plus size={13} />
          </button>

          <span className="hidden sm:inline font-mono text-xs text-slate-400 dark:text-zinc-500 w-9 text-right tabular-nums">
            {formatDuration(trk.durationSec)}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Sub-Navigation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-[#141010] p-1">
          <button
            type="button"
            onClick={() => {
              setViewingSocialTrackId(null);
              setViewingSocialProjectId(null);
              onClearInitialSocialTrack?.();
              setMode('discover');
            }}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
              mode === 'discover' && !activeSocialTrack && !activeSocialProject
                ? 'bg-[#8C271E] text-white shadow-xs'
                : 'text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100'
            }`}
          >
            <Compass size={13} /> Découvrir
          </button>

          <button
            type="button"
            onClick={() => {
              setViewingSocialTrackId(null);
              setViewingSocialProjectId(null);
              onClearInitialSocialTrack?.();
              setViewingArtistUid(myUid);
              setMode('profile');
            }}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
              mode === 'profile' && isViewingOwnProfile && !activeSocialTrack && !activeSocialProject
                ? 'bg-[#8C271E] text-white shadow-xs'
                : 'text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100'
            }`}
          >
            <Disc3 size={13} /> Mon Profil & Portfolio
          </button>

          <button
            type="button"
            onClick={() => {
              setViewingSocialTrackId(null);
              setViewingSocialProjectId(null);
              onClearInitialSocialTrack?.();
              setMode('messages');
            }}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
              mode === 'messages' && !activeSocialTrack && !activeSocialProject
                ? 'bg-[#8C271E] text-white shadow-xs'
                : 'text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100'
            }`}
          >
            <MessageCircle size={13} /> Messages
            {messages.length > 0 && (
              <span className="rounded-full bg-[#8C271E] text-white px-1.5 py-0.2 font-mono text-[10px]">
                {messages.length}
              </span>
            )}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowPublishSheet(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#8C271E] text-white px-4 py-1.5 text-xs font-semibold shadow-sm hover:opacity-95 transition cursor-pointer"
          >
            <Share2 size={13} /> Partager un projet
          </button>
          <button
            type="button"
            onClick={() => void loadSocialData(false)}
            title="Actualiser le flux communautaire"
            className="h-8 w-8 rounded-full border border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900 inline-flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-zinc-100 transition cursor-pointer"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ================= SUB-VIEW A: UNIFIED COMMUNITY SONG PAGE (identical layout to TrackDetailModal!) ================= */}
      {activeSocialTrack ? (
        (() => {
          const isCurrent = player.currentTrack?.id === activeSocialTrack.id;
          const isPlayingThis = isCurrent && player.isPlaying;
          const isLiked = likedIdSet.has(activeSocialTrack.id) || Boolean(activeSocialTrack.likedByMe);
          const dur =
            (isCurrent && player.duration > 0
              ? player.duration
              : activeSocialTrack.durationSec) || 160;
          const curTime = isCurrent ? player.currentTime : 0;
          const progress = dur > 0 ? Math.max(0, Math.min(1, curTime / dur)) : 0;
          const translatePx = progress * TOTAL_TAPE_PX;
          const parentProject = socialProjects.find((p) => p.id === activeSocialTrack.projectId);

          return (
            <div className="w-full tempo-card rounded-3xl text-slate-900 dark:text-zinc-100 overflow-hidden">
              {/* Minimalist In-App Top Bar (identical to TrackDetailModal) */}
              <header className="px-4 sm:px-6 py-3.5 border-b border-slate-100 dark:border-zinc-800/80">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      type="button"
                      onClick={() => {
                        setViewingSocialTrackId(null);
                        onClearInitialSocialTrack?.();
                      }}
                      aria-label="Retour"
                      className="h-9 px-3 rounded-full bg-slate-100 dark:bg-zinc-900 text-slate-800 dark:text-zinc-100 inline-flex items-center gap-1 text-xs font-semibold hover:bg-slate-200/80 dark:hover:bg-zinc-800 transition cursor-pointer shrink-0"
                    >
                      <ChevronLeft size={16} /> Retour
                    </button>
                    {activeSocialTrack.versionLabel && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-zinc-900 px-2.5 py-1 font-mono text-[11px] font-semibold text-slate-700 dark:text-zinc-200 truncate">
                        <GitBranch size={11} className="text-[#8C271E] shrink-0" />
                        {activeSocialTrack.versionLabel}
                      </span>
                    )}
                    {activeSocialTrack.projectTitle && (
                      <button
                        type="button"
                        onClick={() => {
                          if (parentProject) {
                            setViewingSocialTrackId(null);
                            setViewingSocialProjectId(parentProject.id);
                          }
                        }}
                        className="hidden sm:inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-zinc-900 text-slate-600 dark:text-zinc-300 px-2.5 py-1 text-[10px] font-semibold hover:text-[#8C271E] transition cursor-pointer shrink-0"
                      >
                        <Disc3 size={11} /> {activeSocialTrack.projectTitle}
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleToggleLikeTrack(activeSocialTrack)}
                      title={isLiked ? 'Retirer des sons likés' : 'Liker ce son'}
                      className={`h-9 px-3 rounded-full inline-flex items-center gap-1.5 text-xs font-semibold transition cursor-pointer ${
                        isLiked
                          ? 'bg-rose-500/14 text-rose-500'
                          : 'bg-slate-100 dark:bg-zinc-900 text-slate-500 hover:text-rose-500'
                      }`}
                    >
                      <Heart size={15} fill={isLiked ? 'currentColor' : 'none'} />
                      <span className="font-mono">{activeSocialTrack.likesCount || 0}</span>
                    </button>
                  </div>
                </div>
              </header>

              {/* In-App Song Page Body (identical structure to TrackDetailModal) */}
              <div className="px-4 sm:px-7 py-6 space-y-6">
                {/* Horizontal Studio Hero */}
                <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
                  <div
                    className="h-40 w-40 sm:h-36 sm:w-36 rounded-[24px] overflow-hidden shadow-xl border border-slate-200/70 dark:border-zinc-800 shrink-0 flex items-center justify-center text-white font-extrabold text-2xl"
                    style={getCoverGradientStyle(activeSocialTrack.coverGradient)}
                  >
                    {activeSocialTrack.coverUrl ? (
                      <img
                        src={activeSocialTrack.coverUrl}
                        alt={activeSocialTrack.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Disc3 size={34} className="text-white/85" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0 w-full space-y-2.5 text-center sm:text-left">
                    <div>
                      <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-zinc-50">
                        {activeSocialTrack.title}
                      </h1>
                      <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5 flex flex-wrap items-center justify-center sm:justify-start gap-x-1.5 gap-y-0.5">
                        <button
                          type="button"
                          onClick={() => openArtistPortfolio(activeSocialTrack.ownerUid)}
                          className="font-semibold text-[#8C271E] dark:text-[#E56B5F] hover:underline cursor-pointer"
                        >
                          {activeSocialTrack.artist}
                        </button>
                        {activeSocialTrack.versionLabel && (
                          <span className="font-mono">· {activeSocialTrack.versionLabel}</span>
                        )}
                        {activeSocialTrack.bpm && (
                          <span className="font-mono">· {activeSocialTrack.bpm} BPM</span>
                        )}
                        <span>· {formatDuration(activeSocialTrack.durationSec)}</span>
                      </p>
                    </div>

                    {/* Action Pills (identical to TrackDetailModal) */}
                    <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() =>
                          handlePlaySocialTrack(
                            activeSocialTrack,
                            parentProject?.tracks || [activeSocialTrack]
                          )
                        }
                        className="inline-flex items-center gap-1.5 rounded-full bg-[#8C271E] hover:bg-[#A32E24] text-white px-4 py-2 text-xs font-semibold shadow-xs shadow-[#8C271E]/25 active:scale-95 transition cursor-pointer"
                      >
                        {isPlayingThis ? (
                          <>
                            <Pause size={13} fill="currentColor" /> Pause
                          </>
                        ) : (
                          <>
                            <Play size={13} fill="currentColor" className="ml-0.5" /> Écouter
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          if (!likedIdSet.has(activeSocialTrack.id)) {
                            toggleLikeSocialTrack(activeSocialTrack, true);
                          }
                          setPlaylistTargetTrack(activeSocialTrack);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-zinc-900 hover:bg-slate-200/80 dark:hover:bg-zinc-800 text-slate-800 dark:text-zinc-100 px-3.5 py-2 text-xs font-semibold transition cursor-pointer"
                      >
                        <Plus size={13} /> Ajouter à une playlist
                      </button>

                      <button
                        type="button"
                        onClick={() => openArtistPortfolio(activeSocialTrack.ownerUid)}
                        className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-zinc-900 hover:bg-slate-200/80 dark:hover:bg-zinc-800 text-slate-800 dark:text-zinc-100 px-3.5 py-2 text-xs font-semibold transition cursor-pointer"
                      >
                        Profil de {activeSocialTrack.ownerName}
                      </button>

                      {activeSocialTrack.ownerUid !== myUid && (
                        <button
                          type="button"
                          onClick={() => openDirectMessageWith(activeSocialTrack.ownerUid)}
                          className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-zinc-900 hover:bg-slate-200/80 dark:hover:bg-zinc-800 text-slate-800 dark:text-zinc-100 px-3.5 py-2 text-xs font-semibold transition cursor-pointer"
                        >
                          <MessageCircle size={13} /> Message
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Studio Tape Waveform with #8C271E Playhead Needle (identical to TrackDetailModal!) */}
                <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800/80 bg-slate-50/70 dark:bg-zinc-900/50 p-4 space-y-2">
                  <div
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const ratio = Math.max(
                        0,
                        Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width))
                      );
                      if (!isCurrent) {
                        const playable = socialTrackToMusicTrack(activeSocialTrack);
                        void player.playTrack(playable, ratio * dur, [playable]);
                      } else {
                        player.seek(ratio * dur);
                      }
                    }}
                    className="relative h-14 w-full overflow-hidden select-none cursor-pointer"
                    title="Cliquer pour naviguer dans le morceau"
                  >
                    {/* Playhead Needle at 28% */}
                    <div
                      className="pointer-events-none absolute top-1 bottom-1 w-[2.5px] -translate-x-1/2 rounded-full bg-[#8C271E] z-20 shadow-[0_0_8px_rgba(140,39,30,0.45)]"
                      style={{ left: '28%' }}
                    />
                    <div
                      className="absolute inset-y-0 flex items-center"
                      style={{
                        left: '28%',
                        transform: `translate3d(${-translatePx}px, 0, 0)`,
                        transition: isPlayingThis ? 'transform 180ms linear' : 'transform 120ms ease-out',
                      }}
                    >
                      {activeTrackWaveformBars.map((amp, i) => {
                        const barPosRatio = i / BAR_COUNT;
                        const played = barPosRatio <= progress;
                        const hPct = Math.round(amp * 82);
                        return (
                          <div
                            key={i}
                            style={{
                              width: '2.2px',
                              marginRight: `${BAR_STEP_PX - 2.2}px`,
                              height: `${Math.max(16, hPct)}%`,
                            }}
                            className={`rounded-full shrink-0 transition-colors ${
                              played
                                ? 'bg-[#8C271E]'
                                : 'bg-slate-300 dark:bg-zinc-700'
                            }`}
                          />
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex items-center justify-between font-mono text-[11px] text-slate-400">
                    <span>{formatDuration(curTime)}</span>
                    <span>{formatDuration(dur)}</span>
                  </div>
                </div>

                {/* Studio Rating Card (/10) — identical interaction to TrackDetailModal's rating section */}
                <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800/80 bg-slate-50/40 dark:bg-zinc-900/40 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Star size={14} className="text-[#8C271E]" fill="currentColor" />
                      <span className="text-xs font-bold text-slate-900 dark:text-zinc-100">
                        Noter ce morceau sur 10
                      </span>
                    </div>
                    <div className="flex items-center gap-2 font-mono text-xs">
                      {activeSocialTrack.myRating && (
                        <span className="rounded-full bg-[#8C271E]/15 text-[#8C271E] dark:text-[#E56B5F] px-2.5 py-0.5 font-bold">
                          Ma note : {activeSocialTrack.myRating}/10
                        </span>
                      )}
                      <span className="text-slate-400">
                        Moyenne :{' '}
                        <strong className="text-slate-800 dark:text-zinc-200">
                          {(activeSocialTrack.ratingAvg || 0) > 0
                            ? `★ ${activeSocialTrack.ratingAvg}/10 (${activeSocialTrack.ratingCount || 1})`
                            : '—/10'}
                        </strong>
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-5 sm:grid-cols-10 gap-1.5">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => {
                      const active = activeSocialTrack.myRating === num;
                      return (
                        <button
                          key={num}
                          type="button"
                          onClick={() => void handleRateTrack(activeSocialTrack, num)}
                          className={`py-2 rounded-xl font-mono text-xs font-bold transition cursor-pointer ${
                            active
                              ? 'bg-[#8C271E] text-white shadow-sm'
                              : 'bg-white dark:bg-zinc-900 border border-slate-200/70 dark:border-zinc-800 text-slate-700 dark:text-zinc-300 hover:border-[#8C271E]'
                          }`}
                        >
                          {num}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          );
        })()
      ) : activeSocialProject ? (
        /* ================= SUB-VIEW B: UNIFIED COMMUNITY PROJECT PAGE (coherent with TrackDetailModal & ProjectAlbumModal) ================= */
        <div className="w-full tempo-card rounded-3xl text-slate-900 dark:text-zinc-100 overflow-hidden">
          <header className="px-4 sm:px-6 py-3.5 border-b border-slate-100 dark:border-zinc-800/80">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <button
                  type="button"
                  onClick={() => setViewingSocialProjectId(null)}
                  className="h-9 px-3 rounded-full bg-slate-100 dark:bg-zinc-900 text-slate-800 dark:text-zinc-100 inline-flex items-center gap-1 text-xs font-semibold hover:bg-slate-200/80 dark:hover:bg-zinc-800 transition cursor-pointer shrink-0"
                >
                  <ChevronLeft size={16} /> Retour
                </button>
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-zinc-900 px-2.5 py-1 font-mono text-[11px] font-semibold uppercase text-slate-700 dark:text-zinc-200">
                  <Disc3 size={11} className="text-[#8C271E]" />
                  {activeSocialProject.kind} · {activeSocialProject.tracks.length} titres
                </span>
              </div>

              <button
                type="button"
                onClick={() => void handleToggleLikeProject(activeSocialProject)}
                className={`h-9 px-3 rounded-full inline-flex items-center gap-1.5 text-xs font-semibold transition cursor-pointer ${
                  activeSocialProject.likedByMe
                    ? 'bg-rose-500/14 text-rose-500'
                    : 'bg-slate-100 dark:bg-zinc-900 text-slate-500 hover:text-rose-500'
                }`}
              >
                <Heart
                  size={15}
                  fill={activeSocialProject.likedByMe ? 'currentColor' : 'none'}
                />
                <span className="font-mono">{activeSocialProject.likesCount || 0}</span>
              </button>
            </div>
          </header>

          <div className="px-4 sm:px-7 py-6 space-y-6">
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
              <div className="h-40 w-40 sm:h-36 sm:w-36 rounded-[24px] overflow-hidden shadow-xl border border-slate-200/70 dark:border-zinc-800 shrink-0">
                <ProjectCoverArtwork
                  title={activeSocialProject.title}
                  projectCoverUrl={activeSocialProject.coverUrl}
                  gradientId={activeSocialProject.coverGradient}
                />
              </div>

              <div className="flex-1 min-w-0 w-full space-y-2.5 text-center sm:text-left">
                <div>
                  <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-zinc-50">
                    {activeSocialProject.title}
                  </h1>
                  {activeSocialProject.description && (
                    <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5 max-w-xl">
                      {activeSocialProject.description}
                    </p>
                  )}
                  <p className="text-xs text-slate-400 dark:text-zinc-500 mt-1 flex flex-wrap items-center justify-center sm:justify-start gap-x-1.5 gap-y-0.5">
                    <button
                      type="button"
                      onClick={() => openArtistPortfolio(activeSocialProject.ownerUid)}
                      className="font-semibold text-[#8C271E] dark:text-[#E56B5F] hover:underline cursor-pointer"
                    >
                      {activeSocialProject.ownerName}
                    </button>
                    <span>·</span>
                    <span className="font-mono">{activeSocialProject.tracks.length} titres</span>
                    {activeSocialProject.releaseDate && (
                      <>
                        <span>·</span>
                        <span className="font-mono">{activeSocialProject.releaseDate}</span>
                      </>
                    )}
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
                  <button
                    type="button"
                    disabled={activeSocialProject.tracks.length === 0}
                    onClick={() => {
                      if (activeSocialProject.tracks.length > 0) {
                        handlePlaySocialTrack(
                          activeSocialProject.tracks[0],
                          activeSocialProject.tracks
                        );
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[#8C271E] hover:bg-[#A32E24] text-white px-4 py-2 text-xs font-semibold shadow-xs shadow-[#8C271E]/25 transition cursor-pointer"
                  >
                    <Play size={13} fill="currentColor" className="ml-0.5" /> Écouter
                  </button>

                  <button
                    type="button"
                    disabled={activeSocialProject.tracks.length === 0}
                    onClick={() => {
                      const q = activeSocialProject.tracks.map(socialTrackToMusicTrack);
                      if (q.length > 0) void player.playShuffled(q);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-zinc-900 hover:bg-slate-200/80 dark:hover:bg-zinc-800 text-slate-800 dark:text-zinc-100 px-3.5 py-2 text-xs font-semibold transition cursor-pointer"
                  >
                    <Shuffle size={13} /> Aléatoire
                  </button>

                  <button
                    type="button"
                    onClick={() => openArtistPortfolio(activeSocialProject.ownerUid)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-zinc-900 hover:bg-slate-200/80 dark:hover:bg-zinc-800 text-slate-800 dark:text-zinc-100 px-3.5 py-2 text-xs font-semibold transition cursor-pointer"
                  >
                    Profil de {activeSocialProject.ownerName}
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-zinc-800/80">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-500 dark:text-zinc-400">
                  Tracklist du projet ({activeSocialProject.tracks.length})
                </p>
                <p className="text-[11px] text-slate-400">
                  Clic sur ▶ pour lire · Clic sur un morceau pour ouvrir sa fiche son
                </p>
              </div>
              {activeSocialProject.tracks.map((trk, idx) =>
                renderSocialTrackRow(trk, idx, activeSocialProject.tracks)
              )}
            </div>
          </div>
        </div>
      ) : mode === 'discover' ? (
        /* ================= SUB-VIEW 1: DÉCOUVRIR (FEED COMMUNAUTÉ) ================= */
        <div className="space-y-6">
          {/* Featured Artists Strip */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
                Artistes & Studios sur Rowav
              </h2>
              <span className="text-[11px] text-slate-400">
                Clique sur un profil pour voir son portfolio, t’abonner ou envoyer un message
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                myProfile,
                ...profiles.filter((p) => p.uid !== myUid),
              ].map((artist) => {
                const isMe = artist.uid === myUid;
                return (
                  <div
                    key={artist.uid}
                    onClick={() => openArtistPortfolio(artist.uid)}
                    className="tempo-card rounded-2xl p-4 flex flex-col justify-between gap-3 hover:border-[#8C271E]/40 transition cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="h-11 w-11 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0 shadow-sm overflow-hidden"
                        style={getCoverGradientStyle(artist.coverGradient)}
                      >
                        {artist.avatarUrl ? (
                          <img
                            src={artist.avatarUrl}
                            alt={artist.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          artist.name.slice(0, 2).toUpperCase()
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs font-bold text-slate-900 dark:text-zinc-100 truncate">
                            {artist.name}
                          </p>
                          {isMe && (
                            <span className="rounded-md bg-[#8C271E]/12 text-[#8C271E] dark:text-[#E56B5F] px-1.5 py-0.5 text-[9px] font-semibold">
                              Moi
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-400 truncate">{artist.handle}</p>
                      </div>
                    </div>

                    <p className="text-[11px] text-slate-500 dark:text-zinc-400 line-clamp-2">
                      {artist.bio}
                    </p>

                    <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-zinc-800/70">
                      <div className="flex items-center gap-2 font-mono text-[10px] text-slate-400">
                        <span>{artist.followersCount} abonnés</span>
                        <span>·</span>
                        <span>
                          {artist.averageRating > 0
                            ? `★ ${artist.averageRating}/10`
                            : `${artist.projectsCount} proj.`}
                        </span>
                      </div>

                      {!isMe && (
                        <div
                          className="flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => openDirectMessageWith(artist.uid)}
                            title="Envoyer un message"
                            className="h-7 w-7 rounded-full border border-slate-200 dark:border-zinc-800 inline-flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-zinc-100 transition cursor-pointer"
                          >
                            <MessageCircle size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleToggleFollow(artist)}
                            className={`rounded-full px-2.5 py-1 text-[10px] font-semibold transition cursor-pointer ${
                              artist.isFollowedByMe
                                ? 'bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-200'
                                : 'bg-[#8C271E] text-white'
                            }`}
                          >
                            {artist.isFollowedByMe ? 'Abonné ✓' : 'S’abonner'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Feed Filter Bar */}
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
              Projets & Sons partagés
            </h2>
            <div className="inline-flex items-center rounded-xl bg-slate-100 dark:bg-zinc-900 p-0.5">
              {(
                [
                  ['trending', 'Tendances'],
                  ['following', 'Abonnements'],
                  ['recent', 'Récents'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFeedFilter(id)}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer ${
                    feedFilter === id
                      ? 'bg-[#8C271E] text-white shadow-2xs'
                      : 'text-slate-500 dark:text-zinc-400'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Projects Feed */}
          {loading ? (
            <SocialFeedSkeleton />
          ) : (
            <div className="space-y-4">
              {filteredProjects.map((proj) => {
                const isPlayingProj =
                  player.isPlaying &&
                  proj.tracks.some((t) => t.id === player.currentTrack?.id);

                return (
                  <div
                    key={proj.id}
                    className="tempo-card rounded-3xl p-5 space-y-4 border border-slate-200/80 dark:border-zinc-800/90"
                  >
                    {/* Project Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-4 min-w-0">
                        <div
                          onClick={() => setViewingSocialProjectId(proj.id)}
                          className="relative h-20 w-20 sm:h-24 sm:w-24 rounded-2xl overflow-hidden shadow-md shrink-0 cursor-pointer group"
                        >
                          <ProjectCoverArtwork
                            title={proj.title}
                            projectCoverUrl={proj.coverUrl}
                            gradientId={proj.coverGradient}
                          />
                          <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white">
                            <Play size={20} fill="currentColor" />
                          </div>
                        </div>

                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="rounded-full bg-slate-100 dark:bg-zinc-800 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-slate-600 dark:text-zinc-300">
                              {proj.kind}
                            </span>
                            <button
                              type="button"
                              onClick={() => openArtistPortfolio(proj.ownerUid)}
                              className="text-xs font-semibold text-[#8C271E] dark:text-[#E56B5F] hover:underline cursor-pointer"
                            >
                              {proj.ownerName}
                            </button>
                            <span className="text-[11px] text-slate-400 font-mono">
                              · {proj.tracks.length} titres
                            </span>
                          </div>

                          <h3
                            onClick={() => setViewingSocialProjectId(proj.id)}
                            className="text-base sm:text-lg font-bold text-slate-900 dark:text-zinc-100 hover:text-[#8C271E] dark:hover:text-[#E56B5F] transition cursor-pointer truncate"
                          >
                            {proj.title}
                          </h3>

                          {proj.description && (
                            <p className="text-xs text-slate-500 dark:text-zinc-400 line-clamp-2 max-w-2xl">
                              {proj.description}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                        <button
                          type="button"
                          onClick={() => void handleToggleLikeProject(proj)}
                          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                            proj.likedByMe
                              ? 'bg-rose-500/12 text-rose-500'
                              : 'border border-slate-200 dark:border-zinc-800 text-slate-600 dark:text-zinc-300'
                          }`}
                        >
                          <Heart size={13} fill={proj.likedByMe ? 'currentColor' : 'none'} />
                          <span className="font-mono">{proj.likesCount || 0}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setViewingSocialProjectId(proj.id)}
                          className="rounded-full bg-slate-100 dark:bg-zinc-900 hover:bg-slate-200/80 dark:hover:bg-zinc-800 px-3.5 py-1.5 text-xs font-semibold text-slate-800 dark:text-zinc-100 transition cursor-pointer"
                        >
                          Fiche projet
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            if (proj.tracks.length > 0) {
                              handlePlaySocialTrack(proj.tracks[0], proj.tracks);
                            }
                          }}
                          className="inline-flex items-center gap-1.5 rounded-full bg-[#8C271E] hover:bg-[#A32E24] text-white px-3.5 py-1.5 text-xs font-semibold shadow-xs shadow-[#8C271E]/25 transition cursor-pointer"
                        >
                          {isPlayingProj ? (
                            <>
                              <Pause size={13} fill="currentColor" /> Pause
                            </>
                          ) : (
                            <>
                              <Play size={13} fill="currentColor" className="ml-0.5" /> Écouter
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Tracklist inside Project Card */}
                    <div className="space-y-2 pt-3 border-t border-slate-100 dark:border-zinc-800/80">
                      {proj.tracks.map((trk, idx) =>
                        renderSocialTrackRow(trk, idx, proj.tracks)
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : mode === 'profile' ? (
        /* ================= SUB-VIEW 2: ARTIST PROFILE & PORTFOLIO (ROWAV STUDIO COHERENT) ================= */
        <div className="space-y-6">
          {!isViewingOwnProfile && (
            <button
              type="button"
              onClick={() => {
                setViewingArtistUid(null);
                setMode('discover');
              }}
              className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-zinc-900 px-3.5 py-1.5 text-xs font-semibold text-slate-800 dark:text-zinc-100 cursor-pointer"
            >
              <ChevronLeft size={14} /> Tous les artistes
            </button>
          )}

          {/* Spotify-Style Artist Profile Hero (PUBLIC VIEW) */}
          {(() => {
            const artistPublishedProjects = socialProjects.filter(
              (p) => p.ownerUid === activeArtistProfile.uid
            );
            const artistTracks = artistPublishedProjects.flatMap((p) => p.tracks);
            const publicPlaylists = isViewingOwnProfile
              ? playlists.filter((pl) => Boolean(pl.isPublic))
              : [];

            return (
              <>
                <div className="tempo-card rounded-3xl overflow-hidden">
                  {/* Gradient Spotify-like Header Banner */}
                  <div
                    className="relative px-6 pt-8 pb-6 sm:px-8 sm:pt-10 sm:pb-7"
                    style={getCoverGradientStyle(activeArtistProfile.coverGradient)}
                  >
                    <div className="absolute inset-0 bg-gradient-to-b from-black/15 via-black/35 to-black/75" />
                    <div className="relative z-10 flex flex-col sm:flex-row items-center sm:items-end gap-5 sm:gap-6 text-center sm:text-left">
                      {/* Large Circular Spotify PFP */}
                      <div className="relative group shrink-0">
                        <div
                          className="h-32 w-32 sm:h-40 sm:w-40 rounded-full flex items-center justify-center text-white font-extrabold text-4xl shadow-2xl border-2 border-white/25 overflow-hidden bg-black/30"
                        >
                          {activeArtistProfile.avatarUrl ? (
                            <img
                              src={activeArtistProfile.avatarUrl}
                              alt={activeArtistProfile.name}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            activeArtistProfile.name.slice(0, 2).toUpperCase()
                          )}
                        </div>
                        {isViewingOwnProfile && (
                          <>
                            <button
                              type="button"
                              onClick={() => profileAvatarInputRef.current?.click()}
                              title="Changer ma photo de profil"
                              aria-label="Changer ma photo de profil"
                              className="absolute inset-0 rounded-full bg-black/45 opacity-0 group-hover:opacity-100 text-white flex items-center justify-center transition cursor-pointer"
                            >
                              <Camera size={24} />
                            </button>
                            <button
                              type="button"
                              onClick={() => profileAvatarInputRef.current?.click()}
                              title="Changer ma photo de profil"
                              aria-label="Changer ma photo de profil"
                              className="absolute bottom-1 right-1 h-9 w-9 rounded-full bg-[#8C271E] text-white border-2 border-white flex items-center justify-center shadow-lg cursor-pointer"
                            >
                              <Camera size={15} />
                            </button>
                            <input
                              ref={profileAvatarInputRef}
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                e.target.value = '';
                                if (!file) return;
                                try {
                                  const dataUrl = await prepareAvatarDataUrl(file);
                                  await updateUserAvatar(dataUrl);
                                  setProfiles((prev) =>
                                    prev.map((p) =>
                                      p.uid === myUid ? { ...p, avatarUrl: dataUrl } : p
                                    )
                                  );
                                } catch {
                                  notify('Impossible de lire cette image');
                                }
                              }}
                            />
                          </>
                        )}
                      </div>

                      <div className="min-w-0 flex-1 space-y-2 pb-1">
                        <div className="inline-flex items-center gap-1.5 rounded-full bg-white/15 backdrop-blur-md text-white px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                          <Sparkles size={11} /> Profil Public
                        </div>
                        <h1 className="text-3xl sm:text-5xl font-black tracking-tight text-white drop-shadow-xs truncate">
                          {activeArtistProfile.name}
                        </h1>
                        {activeArtistProfile.bio && (
                          <p className="text-xs sm:text-sm text-white/85 max-w-xl leading-relaxed">
                            {activeArtistProfile.bio}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 text-[11px] text-white/75 pt-0.5">
                          <span className="font-mono">{activeArtistProfile.handle}</span>
                          {activeArtistProfile.location && (
                            <>
                              <span>·</span>
                              <span className="inline-flex items-center gap-1">
                                <MapPin size={11} /> {activeArtistProfile.location}
                              </span>
                            </>
                          )}
                          <span>·</span>
                          <span className="font-semibold text-white">
                            {activeArtistProfile.followersCount} abonné{activeArtistProfile.followersCount > 1 ? 's' : ''}
                          </span>
                          <span>·</span>
                          <span>
                            {artistTracks.length} son{artistTracks.length > 1 ? 's' : ''} · {artistPublishedProjects.length} projet{artistPublishedProjects.length > 1 ? 's' : ''}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Spotify-Style Action Bar */}
                  <div className="px-6 py-4 sm:px-8 flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-[#131317]">
                    <div className="flex flex-wrap items-center gap-2.5">
                      {artistTracks.length > 0 && (
                        <button
                          type="button"
                          onClick={() => handlePlaySocialTrack(artistTracks[0], artistTracks)}
                          className="h-11 px-5 rounded-full bg-[#8C271E] hover:bg-[#A32E24] text-white inline-flex items-center gap-2 text-xs font-bold shadow-md shadow-[#8C271E]/25 active:scale-95 transition cursor-pointer"
                        >
                          <Play size={15} fill="currentColor" className="ml-0.5" />
                          <span>Écouter</span>
                        </button>
                      )}

                      {isViewingOwnProfile ? (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setEditName(myProfile.name);
                              setEditBio(myProfile.bio);
                              setEditLocation(myProfile.location || 'Paris, FR');
                              setEditGenres((myProfile.genres || ['Studio']).join(', '));
                              setEditGradient(myProfile.coverGradient || 'sunset');
                              setEditingProfile(true);
                            }}
                            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 dark:border-zinc-700 hover:border-slate-400 dark:hover:border-zinc-500 px-4 py-2 text-xs font-semibold text-slate-800 dark:text-zinc-100 transition cursor-pointer"
                          >
                            <Pencil size={12} /> Modifier le profil
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowPublishSheet(true)}
                            className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 px-4 py-2 text-xs font-semibold text-slate-800 dark:text-zinc-100 transition cursor-pointer"
                          >
                            <Plus size={13} /> Publier un projet
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleToggleFollow(activeArtistProfile)}
                            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold transition cursor-pointer ${
                              activeArtistProfile.isFollowedByMe
                                ? 'border border-slate-200 dark:border-zinc-700 text-slate-900 dark:text-zinc-100'
                                : 'bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25'
                            }`}
                          >
                            {activeArtistProfile.isFollowedByMe ? (
                              <>
                                <UserCheck size={14} /> Abonné
                              </>
                            ) : (
                              <>
                                <UserPlus size={14} /> S’abonner
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => openDirectMessageWith(activeArtistProfile.uid)}
                            className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-800 dark:text-zinc-100 px-4 py-2 text-xs font-semibold transition cursor-pointer"
                          >
                            <MessageCircle size={14} /> Message
                          </button>
                        </>
                      )}
                    </div>

                    {(activeArtistProfile.genres || []).length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {(activeArtistProfile.genres || []).map((g) => (
                          <span
                            key={g}
                            className="rounded-full bg-slate-100 dark:bg-zinc-800/90 px-2.5 py-0.5 text-[10px] font-medium text-slate-600 dark:text-zinc-300"
                          >
                            {g}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Popular Public Tracks (Spotify-style numbered list) */}
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-bold text-slate-900 dark:text-zinc-100">
                      Populaires
                    </h2>
                  </div>

                  {artistTracks.length === 0 ? (
                    <div className="tempo-card rounded-3xl p-8 text-center space-y-2.5">
                      <p className="text-xs text-slate-400">
                        {isViewingOwnProfile
                          ? 'Seuls tes morceaux publiés s’affichent ici. Publie un projet pour le rendre visible sur ton profil.'
                          : 'Cet artiste n’a pas encore publié de morceaux.'}
                      </p>
                      {isViewingOwnProfile && (
                        <button
                          type="button"
                          onClick={() => setShowPublishSheet(true)}
                          className="inline-flex items-center gap-1.5 rounded-full bg-[#8C271E] text-white px-4 py-2 text-xs font-semibold cursor-pointer"
                        >
                          <Share2 size={13} /> Publier un projet
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {artistTracks.map((trk, idx) =>
                        renderSocialTrackRow(trk, idx, artistTracks, true)
                      )}
                    </div>
                  )}
                </section>

                {/* Public Discography (Albums / EP / Singles) */}
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-bold text-slate-900 dark:text-zinc-100">
                      Discographie ({artistPublishedProjects.length})
                    </h2>
                    {isViewingOwnProfile && (
                      <button
                        type="button"
                        onClick={() => setShowPublishSheet(true)}
                        className="text-xs font-semibold text-[#8C271E] dark:text-[#E56B5F] hover:underline cursor-pointer"
                      >
                        + Publier
                      </button>
                    )}
                  </div>

                  {artistPublishedProjects.length === 0 ? (
                    <div className="tempo-card rounded-3xl p-8 text-center">
                      <p className="text-xs text-slate-400">
                        Aucun projet public pour l’instant.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                      {artistPublishedProjects.map((proj) => (
                        <div
                          key={proj.id}
                          onClick={() => setViewingSocialProjectId(proj.id)}
                          className="group cursor-pointer space-y-2"
                        >
                          <div className="relative aspect-square w-full rounded-[24px] overflow-hidden shadow-md border border-slate-200/70 dark:border-zinc-800/80 transition group-hover:scale-[1.015]">
                            <ProjectCoverArtwork
                              title={proj.title}
                              projectCoverUrl={proj.coverUrl}
                              gradientId={proj.coverGradient}
                            />
                            <span className="absolute top-2.5 left-2.5 rounded-full bg-black/45 backdrop-blur-md px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white">
                              {proj.kind}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (proj.tracks.length > 0) {
                                  handlePlaySocialTrack(proj.tracks[0], proj.tracks);
                                }
                              }}
                              className="absolute bottom-2.5 right-2.5 h-10 w-10 rounded-full bg-[#8C271E] text-white flex items-center justify-center shadow-lg hover:scale-105 transition cursor-pointer"
                            >
                              <Play size={16} fill="currentColor" className="ml-0.5" />
                            </button>
                          </div>

                          <div className="px-0.5">
                            <div className="flex items-center justify-between gap-1">
                              <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100 truncate">
                                {proj.title}
                              </h3>
                              <span className="font-mono text-[10px] text-rose-500 shrink-0">
                                ♥ {proj.likesCount || 0}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-[11px] text-slate-400">
                              <span>{proj.tracks.length} titres</span>
                              {isViewingOwnProfile && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleUnpublishProject(proj.id, proj.title);
                                  }}
                                  className="text-[10px] text-slate-400 hover:text-rose-500 underline cursor-pointer"
                                >
                                  Retirer
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* Public Playlists ONLY */}
                {publicPlaylists.length > 0 && (
                  <section className="space-y-3">
                    <h2 className="text-base font-bold text-slate-900 dark:text-zinc-100">
                      Playlists publiques ({publicPlaylists.length})
                    </h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                      {publicPlaylists.map((pl) => (
                        <div
                          key={pl.id}
                          onClick={() => onOpenPlaylist?.(pl.id)}
                          className="tempo-card rounded-2xl p-3.5 flex items-center gap-3 hover:border-[#8C271E]/40 transition cursor-pointer"
                        >
                          <div
                            className="h-12 w-12 rounded-xl flex items-center justify-center text-white font-bold text-xs shrink-0 overflow-hidden"
                            style={getCoverGradientStyle(pl.coverGradient)}
                          >
                            {pl.coverDataUrl ? (
                              <img
                                src={pl.coverDataUrl}
                                alt={pl.title}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <ListMusic size={18} />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-slate-900 dark:text-zinc-100 truncate">
                              {pl.title}
                            </p>
                            <p className="text-[11px] text-slate-400 font-mono">
                              {pl.ownTrackIds.length + pl.socialTrackIds.length} sons
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </>
            );
          })()}
        </div>
      ) : (
        /* ================= SUB-VIEW 3: MESSAGES DIRECTS (DM) ================= */
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 min-h-[480px]">
          <div className="tempo-card rounded-3xl p-3 space-y-2">
            <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Conversations Studio
            </p>
            <div className="space-y-1">
              {profiles
                .filter((p) => p.uid !== myUid)
                .map((artist) => {
                  const isSelected = activeChatUid === artist.uid;
                  const threadMsgs = messages.filter(
                    (m) => m.fromUid === artist.uid || m.toUid === artist.uid
                  );
                  const lastMsg = threadMsgs[threadMsgs.length - 1];
                  return (
                    <button
                      key={artist.uid}
                      type="button"
                      onClick={() => setActiveChatUid(artist.uid)}
                      className={`w-full flex items-center gap-3 p-2.5 rounded-2xl text-left transition cursor-pointer ${
                        isSelected
                          ? 'bg-[#8C271E] text-white'
                          : 'hover:bg-slate-100 dark:hover:bg-zinc-900 text-slate-900 dark:text-zinc-100'
                      }`}
                    >
                      <div
                        className="h-10 w-10 rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0"
                        style={getCoverGradientStyle(artist.coverGradient)}
                      >
                        {artist.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <p className="text-xs font-bold truncate">{artist.name}</p>
                          <span className="text-[10px] opacity-60">{artist.handle}</span>
                        </div>
                        <p className="text-[11px] opacity-70 truncate">
                          {lastMsg ? lastMsg.text : artist.bio}
                        </p>
                      </div>
                    </button>
                  );
                })}
            </div>
          </div>

          <div className="md:col-span-2 tempo-card rounded-3xl flex flex-col justify-between overflow-hidden">
            {(() => {
              const partner =
                profiles.find((p) => p.uid === activeChatUid) ||
                profiles.find((p) => p.uid !== myUid);
              if (!partner) {
                return (
                  <div className="p-10 text-center text-xs text-slate-400">
                    Sélectionne un artiste pour démarrer une conversation.
                  </div>
                );
              }
              const thread = messages.filter(
                (m) => m.fromUid === partner.uid || m.toUid === partner.uid
              );

              return (
                <>
                  <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-100 dark:border-zinc-800">
                    <div
                      onClick={() => openArtistPortfolio(partner.uid)}
                      className="flex items-center gap-3 cursor-pointer"
                    >
                      <div
                        className="h-9 w-9 rounded-full flex items-center justify-center text-white font-bold text-xs"
                        style={getCoverGradientStyle(partner.coverGradient)}
                      >
                        {partner.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-900 dark:text-zinc-100 hover:text-[#8C271E]">
                          {partner.name}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {partner.handle} · Voir le portfolio →
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleToggleFollow(partner)}
                      className={`rounded-full px-3 py-1 text-[11px] font-semibold transition cursor-pointer ${
                        partner.isFollowedByMe
                          ? 'bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-200'
                          : 'bg-[#8C271E] text-white'
                      }`}
                    >
                      {partner.isFollowedByMe ? 'Abonné ✓' : 'S’abonner'}
                    </button>
                  </div>

                  <div className="flex-1 p-5 space-y-3 overflow-y-auto max-h-[340px]">
                    {thread.length === 0 ? (
                      <div className="py-12 text-center space-y-1.5">
                        <p className="text-xs font-semibold text-slate-700 dark:text-zinc-300">
                          Démarre la discussion avec {partner.name}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          Partage un avis sur ses sons, propose une collab ou échange des prods.
                        </p>
                      </div>
                    ) : (
                      thread.map((m) => {
                        const isMine = m.fromUid === myUid;
                        return (
                          <div
                            key={m.id}
                            className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}
                          >
                            <div
                              className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 text-xs space-y-1 ${
                                isMine
                                  ? 'bg-[#8C271E] text-white rounded-br-xs'
                                  : 'bg-slate-100 dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 rounded-bl-xs'
                              }`}
                            >
                              <p className="leading-relaxed">{m.text}</p>
                              <p
                                className={`text-[9px] font-mono ${
                                  isMine ? 'text-white/75' : 'text-slate-400'
                                }`}
                              >
                                {new Date(m.createdAt).toLocaleTimeString('fr-FR', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </p>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  <form
                    onSubmit={handleSendMessage}
                    className="p-3.5 border-t border-slate-100 dark:border-zinc-800 flex items-center gap-2"
                  >
                    <input
                      type="text"
                      value={messageDraft}
                      onChange={(e) => setMessageDraft(e.target.value)}
                      placeholder={`Écrire un message à ${partner.name}…`}
                      className="flex-1 rounded-full border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-4 py-2 text-xs text-slate-900 dark:text-zinc-100 outline-none focus:border-slate-400"
                    />
                    <button
                      type="submit"
                      disabled={!messageDraft.trim() || sendingMsg}
                      className="h-9 px-4 rounded-full bg-[#8C271E] text-white inline-flex items-center gap-1.5 text-xs font-semibold disabled:opacity-40 transition cursor-pointer"
                    >
                      <Send size={12} /> Envoyer
                    </button>
                  </form>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* ================= MODAL: RATE TRACK /10 ================= */}
      {ratingTargetTrack && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
          onClick={() => setRatingTargetTrack(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-3xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#141010] p-5 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100">
                  Noter « {ratingTargetTrack.title} »
                </h3>
                <p className="text-[11px] text-slate-400">
                  Par {ratingTargetTrack.artist} · Note sur 10
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRatingTargetTrack(null)}
                className="h-7 w-7 rounded-full bg-slate-100 dark:bg-zinc-800 inline-flex items-center justify-center text-slate-500 cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>

            <div className="grid grid-cols-5 gap-2">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => {
                const active = ratingTargetTrack.myRating === num;
                return (
                  <button
                    key={num}
                    type="button"
                    onClick={() => void handleRateTrack(ratingTargetTrack, num)}
                    className={`py-2.5 rounded-xl font-mono text-xs font-bold transition cursor-pointer ${
                      active
                        ? 'bg-[#8C271E] text-white shadow-md'
                        : 'bg-slate-100 dark:bg-zinc-900 text-slate-800 dark:text-zinc-200 hover:bg-[#8C271E]/15 hover:text-[#8C271E]'
                    }`}
                  >
                    {num}/10
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: ADD LIKED TRACK TO PLAYLIST ================= */}
      {playlistTargetTrack && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
          onClick={() => setPlaylistTargetTrack(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-3xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#141010] p-5 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100">
                  Ajouter « {playlistTargetTrack.title} » à une playlist
                </h3>
                <p className="text-[11px] text-slate-400">
                  Combine ce son avec tes propres morceaux
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPlaylistTargetTrack(null)}
                className="h-7 w-7 rounded-full bg-slate-100 dark:bg-zinc-800 inline-flex items-center justify-center text-slate-500 cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>

            {playlists.length > 0 && (
              <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 dark:divide-zinc-800/70 rounded-2xl border border-slate-200/70 dark:border-zinc-800 p-1.5">
                {playlists.map((pl) => {
                  const inPl = pl.socialTrackIds.includes(playlistTargetTrack.id);
                  return (
                    <button
                      key={pl.id}
                      type="button"
                      onClick={() => {
                        toggleTrackInPlaylist(pl.id, playlistTargetTrack.id, 'social');
                        notify(
                          inPl
                            ? `Retiré de « ${pl.title} »`
                            : `Ajouté à « ${pl.title} » ✓`
                        );
                      }}
                      className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl hover:bg-slate-50 dark:hover:bg-zinc-900 text-left cursor-pointer"
                    >
                      <div>
                        <p className="text-xs font-semibold text-slate-900 dark:text-zinc-100">
                          {pl.title}
                        </p>
                        <p className="text-[10px] text-slate-400 font-mono">
                          {pl.ownTrackIds.length + pl.socialTrackIds.length} titres
                        </p>
                      </div>
                      <span
                        className={`h-6 w-6 rounded-full inline-flex items-center justify-center ${
                          inPl
                            ? 'bg-[#8C271E] text-white'
                            : 'border border-slate-300 dark:border-zinc-700 text-transparent'
                        }`}
                      >
                        <Check size={12} />
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const name = quickPlaylistTitle.trim() || `Playlist ${playlistTargetTrack.title}`;
                createPlaylist({
                  title: name,
                  socialTrackIds: [playlistTargetTrack.id],
                });
                setQuickPlaylistTitle('');
                setPlaylistTargetTrack(null);
              }}
              className="flex items-center gap-2 pt-1"
            >
              <input
                type="text"
                value={quickPlaylistTitle}
                onChange={(e) => setQuickPlaylistTitle(e.target.value)}
                placeholder="Ou créer une nouvelle playlist…"
                className="flex-1 rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs outline-none"
              />
              <button
                type="submit"
                className="rounded-xl bg-[#8C271E] text-white px-3.5 py-2 text-xs font-semibold shrink-0 cursor-pointer"
              >
                + Créer
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL: PUBLISH A PROJECT TO ROWAV SOCIAL ================= */}
      {showPublishSheet && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
          onClick={() => setShowPublishSheet(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-3xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#141010] p-5 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100">
                  Publier un projet sur Rowav Social & mon Portfolio
                </h3>
                <p className="text-[11px] text-slate-400">
                  Les autres utilisateurs pourront écouter, liker et noter les sons de ce projet
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPublishSheet(false)}
                className="h-7 w-7 rounded-full bg-slate-100 dark:bg-zinc-800 inline-flex items-center justify-center text-slate-500 cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>

            {state.musicProjects.length === 0 ? (
              <div className="py-8 text-center space-y-2">
                <p className="text-xs text-slate-400">
                  Tu n’as pas encore créé de projet dans ton studio.
                </p>
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-zinc-800/70">
                {state.musicProjects.map((proj) => {
                  const alreadyPublished = socialProjects.some(
                    (sp) => sp.ownerUid === myUid && sp.sourceProjectId === proj.id
                  );
                  const isBusy = publishingProjId === proj.id;

                  return (
                    <div
                      key={proj.id}
                      className="flex items-center justify-between gap-3 py-3 px-1"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-11 w-11 rounded-xl overflow-hidden shrink-0">
                          <ProjectCoverArtwork
                            title={proj.title}
                            projectCoverUrl={proj.coverDataUrl}
                            gradientId={proj.coverGradient}
                          />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-900 dark:text-zinc-100 truncate">
                            {proj.title}
                          </p>
                          <p className="text-[11px] text-slate-400 font-mono">
                            {proj.kind.toUpperCase()} · {proj.trackIds.length} titres
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {onOpenOwnProject && (
                          <button
                            type="button"
                            onClick={() => {
                              setShowPublishSheet(false);
                              onOpenOwnProject(proj.id);
                            }}
                            className="rounded-full border border-slate-200 dark:border-zinc-800 px-3 py-1.5 text-[11px] font-medium text-slate-500 cursor-pointer"
                          >
                            Éditer
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handlePublishProject(proj)}
                          className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
                            alreadyPublished
                              ? 'bg-slate-100 dark:bg-zinc-800 text-slate-800 dark:text-zinc-200'
                              : 'bg-[#8C271E] text-white'
                          }`}
                        >
                          {isBusy ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Globe size={12} />
                          )}
                          <span>{alreadyPublished ? 'Mettre à jour' : 'Publier'}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================= MODAL: EDIT MY ARTIST PROFILE ================= */}
      {editingProfile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
          onClick={() => setEditingProfile(false)}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSaveMyProfile}
            className="w-full max-w-md rounded-3xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#141010] p-5 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100">
                Personnaliser mon Profil Artiste
              </h3>
              <button
                type="button"
                onClick={() => setEditingProfile(false)}
                className="h-7 w-7 rounded-full bg-slate-100 dark:bg-zinc-800 inline-flex items-center justify-center text-slate-500 cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>

            <div className="space-y-3">
              {/* Instant Avatar Picker inside Edit Profile Modal */}
              <div className="flex items-center gap-3 pb-1">
                <button
                  type="button"
                  onClick={() => profileAvatarInputRef.current?.click()}
                  className="relative h-14 w-14 rounded-2xl overflow-hidden border border-slate-200 dark:border-zinc-700 shrink-0 cursor-pointer group"
                  style={getCoverGradientStyle(editGradient)}
                >
                  {myProfile.avatarUrl ? (
                    <img
                      src={myProfile.avatarUrl}
                      alt={myProfile.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="h-full w-full flex items-center justify-center text-white font-bold text-base">
                      {myProfile.name.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  <span className="absolute inset-0 bg-black/45 flex items-center justify-center text-white opacity-80 group-hover:opacity-100 transition">
                    <Camera size={15} />
                  </span>
                </button>
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => profileAvatarInputRef.current?.click()}
                    className="text-xs font-semibold text-[#8C271E] dark:text-[#E56B5F] hover:underline cursor-pointer"
                  >
                    Changer la photo de profil
                  </button>
                  <p className="text-[11px] text-slate-400">
                    Mise à jour instantanée partout dans Rowav
                  </p>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-400">Nom d’artiste</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs font-semibold text-slate-900 dark:text-zinc-100 outline-none"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-400">Bio / Signature</label>
                <textarea
                  rows={2}
                  value={editBio}
                  onChange={(e) => setEditBio(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs text-slate-700 dark:text-zinc-200 outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-semibold text-slate-400">Ville / Studio</label>
                  <input
                    type="text"
                    value={editLocation}
                    onChange={(e) => setEditLocation(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs text-slate-700 dark:text-zinc-200 outline-none"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-400">
                    Styles (séparés par virgule)
                  </label>
                  <input
                    type="text"
                    value={editGenres}
                    onChange={(e) => setEditGenres(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs text-slate-700 dark:text-zinc-200 outline-none"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <span className="text-[11px] font-semibold text-slate-400">Bannière :</span>
                <div className="flex items-center gap-1.5">
                  {COVER_GRADIENTS.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setEditGradient(g.id)}
                      className={`h-5 w-5 rounded-full transition cursor-pointer ${
                        editGradient === g.id ? 'ring-2 ring-offset-2 ring-[#8C271E] scale-110' : ''
                      }`}
                      style={{ background: `linear-gradient(135deg, ${g.from}, ${g.to})` }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingProfile(false)}
                className="rounded-full border border-slate-200 dark:border-zinc-800 px-4 py-1.5 text-xs text-slate-500 cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                className="rounded-full bg-[#8C271E] text-white px-5 py-1.5 text-xs font-semibold cursor-pointer"
              >
                Enregistrer
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
