import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Check,
  ChevronLeft,
  Heart,
  ListMusic,
  Music2,
  Pause,
  Play,
  Plus,
  Search,
  Shuffle,
  Star,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAudioPlayer } from '../../context/AudioPlayerContext';
import {
  COVER_GRADIENTS,
  getCoverGradientStyle,
  groupMusicTracks,
} from '../../lib/musicVersioning';
import { socialTrackToMusicTrack } from '../../lib/socialApi';
import { compressCoverImage, resolveEffectiveTrackCover, resolveTrackRatings } from '../../lib/trackCover';
import type { MusicTrack, SocialTrackItem } from '../../types';
import { AppleConfirmDialog } from '../ui/AppleConfirmDialog';
import { PROJECT_GRADIENTS } from './MiniAudioPlayer';
import { ProjectCoverArtwork } from './ProjectCoverArtwork';

function formatDuration(sec?: number): string {
  if (!sec || !Number.isFinite(sec) || sec <= 0) return '—:—';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface PlaylistPageProps {
  playlistId: string;
  onClose: () => void;
  onOpenOwnTrack?: (trackId: string) => void;
  onOpenSocialTrack?: (track: SocialTrackItem) => void;
  onOpenArtistProfile?: (artistUid: string) => void;
}

export function PlaylistPage({
  playlistId,
  onClose,
  onOpenOwnTrack,
  onOpenSocialTrack,
  onOpenArtistProfile,
}: PlaylistPageProps) {
  const {
    state,
    playlists,
    likedSocialTracks,
    updatePlaylist,
    deletePlaylist,
    toggleTrackInPlaylist,
    notify,
  } = useApp();
  const player = useAudioPlayer();

  const playlist = useMemo(
    () => playlists.find((p) => p.id === playlistId) || null,
    [playlists, playlistId]
  );

  const [titleDraft, setTitleDraft] = useState(playlist?.title || '');
  const [descDraft, setDescDraft] = useState(playlist?.description || '');
  const [showAddTracksSheet, setShowAddTracksSheet] = useState(false);
  const [addTab, setAddTab] = useState<'own' | 'social'>('own');
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const coverInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (playlist) {
      setTitleDraft(playlist.title);
      setDescDraft(playlist.description || '');
    }
  }, [playlist?.id, playlist?.title, playlist?.description]);

  const trackGroups = useMemo(() => groupMusicTracks(state.musicTracks), [state.musicTracks]);

  // Build unified playable items for this playlist
  const playlistItems = useMemo(() => {
    if (!playlist) return [];
    const items: Array<{
      key: string;
      kind: 'own' | 'social';
      id: string;
      title: string;
      artist: string;
      ownerUid?: string;
      coverUrl?: string;
      coverGradient?: string;
      durationSec?: number;
      versionLabel?: string;
      rating?: number | null;
      playableTrack: MusicTrack;
      socialItem?: SocialTrackItem;
    }> = [];

    for (const ownId of playlist.ownTrackIds) {
      const trk = state.musicTracks.find((t) => t.id === ownId);
      if (!trk) continue;
      const grp = trackGroups.find((g) => g.allTrackIds.includes(trk.id));
      const cover = resolveEffectiveTrackCover(
        trk,
        state.musicProjects,
        grp?.groupKey,
        grp?.versions.map((v) => v.track)
      );
      const ratings = resolveTrackRatings(trk, grp?.versions.map((v) => v.track));
      items.push({
        key: `own_${trk.id}`,
        kind: 'own',
        id: trk.id,
        title: grp?.baseTitle || trk.manualGroupTitle || trk.title,
        artist: trk.artist || state.preferences.name || 'Moi',
        coverUrl: cover.coverDataUrl || cover.cloudCoverUrl || undefined,
        coverGradient: cover.gradientId,
        durationSec: trk.durationSec,
        versionLabel: grp?.latestVersionLabel,
        rating: ratings.current,
        playableTrack: trk,
      });
    }

    for (const socId of playlist.socialTrackIds) {
      const soc = likedSocialTracks.find((s) => s.id === socId);
      if (!soc) continue;
      items.push({
        key: `soc_${soc.id}`,
        kind: 'social',
        id: soc.id,
        title: soc.title,
        artist: soc.artist || soc.ownerName,
        ownerUid: soc.ownerUid,
        coverUrl: soc.coverUrl,
        coverGradient: soc.coverGradient,
        durationSec: soc.durationSec,
        versionLabel: soc.versionLabel,
        rating: soc.myRating || soc.ratingAvg || null,
        playableTrack: socialTrackToMusicTrack(soc),
        socialItem: soc,
      });
    }

    return items;
  }, [
    playlist,
    state.musicTracks,
    state.musicProjects,
    state.preferences.name,
    trackGroups,
    likedSocialTracks,
  ]);

  const playableQueue = useMemo(
    () => playlistItems.map((it) => it.playableTrack),
    [playlistItems]
  );

  if (!playlist) {
    return (
      <div className="w-full tempo-card rounded-3xl p-8 text-center space-y-3">
        <p className="text-xs text-slate-400">Playlist introuvable.</p>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 rounded-full bg-[#8C271E] text-white px-4 py-2 text-xs font-semibold cursor-pointer"
        >
          <ChevronLeft size={14} /> Retour
        </button>
      </div>
    );
  }

  const isPlayingPlaylist =
    player.isPlaying && playableQueue.some((t) => t.id === player.currentTrack?.id);

  const totalDurationSec = playlistItems.reduce((acc, it) => acc + (it.durationSec || 150), 0);
  const totalMin = Math.max(1, Math.round(totalDurationSec / 60));

  const individualCovers = playlistItems
    .map((it) => it.coverUrl)
    .filter((u): u is string => Boolean(u))
    .slice(0, 4);

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressCoverImage(file, 420, 0.84);
      updatePlaylist(playlist.id, { coverDataUrl: compressed });
      notify('Pochette de la playlist mise à jour ✓');
    } catch {
      notify('Impossible de charger cette image');
    }
  };

  const filteredOwnGroups = trackGroups.filter((g) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return g.baseTitle.toLowerCase().includes(q);
  });

  const filteredSocialTracks = likedSocialTracks.filter((s) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      s.title.toLowerCase().includes(q) ||
      s.artist.toLowerCase().includes(q) ||
      s.ownerName.toLowerCase().includes(q)
    );
  });

  return (
    <div className="w-full tempo-card rounded-3xl text-slate-900 dark:text-zinc-100 overflow-hidden">
      {/* Minimalist In-App Studio Top Bar (identical to TrackDetailModal / Song Page) */}
      <header className="px-4 sm:px-6 py-3.5 border-b border-slate-100 dark:border-zinc-800/80">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={onClose}
              aria-label="Retour"
              className="h-9 px-3 rounded-full bg-slate-100 dark:bg-zinc-900 text-slate-800 dark:text-zinc-100 inline-flex items-center gap-1 text-xs font-semibold hover:bg-slate-200/80 dark:hover:bg-zinc-800 transition cursor-pointer shrink-0"
            >
              <ChevronLeft size={16} /> Retour
            </button>
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-zinc-900 px-2.5 py-1 font-mono text-[11px] font-semibold text-slate-700 dark:text-zinc-200 truncate">
              <ListMusic size={11} className="text-[#8C271E] shrink-0" />
              Playlist · {playlistItems.length} son{playlistItems.length > 1 ? 's' : ''}
            </span>
            <span className="hidden sm:inline-flex rounded-full bg-slate-100 dark:bg-zinc-900 text-slate-600 dark:text-zinc-300 px-2.5 py-1 font-mono text-[10px] font-semibold shrink-0">
              {playlist.ownTrackIds.length} perso · {playlist.socialTrackIds.length} likés
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setConfirmDeleteOpen(true)}
              title="Supprimer cette playlist"
              className="h-9 w-9 rounded-full bg-slate-100 dark:bg-zinc-900 text-slate-500 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center justify-center transition cursor-pointer"
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>
      </header>

      {/* Studio Body (same structure & rhythm as TrackDetailModal) */}
      <div className="px-4 sm:px-7 py-6 space-y-6">
        {/* Horizontal Studio Hero: Cover + Inline Title/Meta + Gradient Swatches + Action Pills */}
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
          {/* Square Rounded Cover with Camera button */}
          <div className="relative group shrink-0">
            <div className="h-40 w-40 sm:h-36 sm:w-36 rounded-[24px] overflow-hidden shadow-xl border border-slate-200/70 dark:border-zinc-800">
              <ProjectCoverArtwork
                title={playlist.title}
                projectCoverUrl={playlist.coverDataUrl}
                trackCoverUrls={individualCovers}
                gradientId={playlist.coverGradient}
              />
            </div>
            <button
              type="button"
              onClick={() => coverInputRef.current?.click()}
              title="Changer la pochette de la playlist"
              className="absolute inset-0 rounded-[22px] bg-black/45 opacity-0 group-hover:opacity-100 text-white flex flex-col items-center justify-center gap-1 text-[10px] font-semibold transition cursor-pointer"
            >
              <Camera size={16} />
              Pochette
            </button>
            <button
              type="button"
              onClick={() => coverInputRef.current?.click()}
              aria-label="Changer la pochette"
              className="absolute bottom-1.5 right-1.5 h-7 w-7 rounded-full bg-black/65 text-white flex items-center justify-center shadow-md backdrop-blur-xs cursor-pointer sm:opacity-85 hover:scale-105 transition"
            >
              <Camera size={13} />
            </button>
            <input
              ref={coverInputRef}
              type="file"
              accept="image/*"
              onChange={handleCoverUpload}
              className="hidden"
            />
          </div>

          {/* Right Column: Editable Title, Description, Meta, Swatches & Action Pills */}
          <div className="flex-1 min-w-0 w-full space-y-2.5 text-center sm:text-left">
            <div>
              <input
                type="text"
                value={titleDraft}
                onChange={(e) => {
                  const val = e.target.value;
                  setTitleDraft(val);
                  updatePlaylist(playlist.id, { title: val.trim() || playlist.title });
                }}
                placeholder="Nom de la playlist…"
                className="w-full bg-transparent text-lg font-bold tracking-tight text-slate-900 dark:text-zinc-50 outline-none border-b border-transparent focus:border-slate-300 dark:focus:border-zinc-700 pb-0.5 text-center sm:text-left"
              />
              <input
                type="text"
                value={descDraft}
                onChange={(e) => {
                  const val = e.target.value;
                  setDescDraft(val);
                  updatePlaylist(playlist.id, { description: val.trim() || undefined });
                }}
                placeholder="Ajouter une note ou description…"
                className="w-full bg-transparent text-xs text-slate-500 dark:text-zinc-400 outline-none border-b border-transparent focus:border-slate-200 dark:focus:border-zinc-800 py-0.5 text-center sm:text-left"
              />
              <p className="text-xs text-slate-400 dark:text-zinc-500 mt-1 flex flex-wrap items-center justify-center sm:justify-start gap-x-1.5 gap-y-0.5">
                <span className="font-semibold text-slate-700 dark:text-zinc-200">
                  {state.preferences.name || 'Moi'}
                </span>
                <span>·</span>
                <span className="font-mono">{playlistItems.length} titres</span>
                <span>·</span>
                <span className="font-mono">~{totalMin} min</span>
              </p>
            </div>

            {/* Quick Gradient Swatches (identical to TrackDetailModal) */}
            <div className="flex items-center justify-center sm:justify-start gap-1.5 flex-wrap">
              {PROJECT_GRADIENTS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() =>
                    updatePlaylist(playlist.id, {
                      coverGradient: g.id,
                      coverDataUrl: undefined,
                    })
                  }
                  title={g.label}
                  className={`h-4 w-4 rounded-full bg-gradient-to-br ${g.css} transition cursor-pointer ${
                    (playlist.coverGradient || 'pink') === g.id && !playlist.coverDataUrl
                      ? 'ring-2 ring-offset-2 ring-[#8C271E] dark:ring-offset-zinc-950 scale-110'
                      : 'opacity-70 hover:opacity-100'
                  }`}
                />
              ))}
            </div>

            {/* Horizontal Studio Action Pills (identical style to TrackDetailModal) */}
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
              <button
                type="button"
                disabled={playableQueue.length === 0}
                onClick={() => {
                  if (playableQueue.length === 0) return;
                  if (isPlayingPlaylist) {
                    player.togglePlay();
                  } else {
                    void player.playTrack(playableQueue[0], 0, playableQueue);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#8C271E] hover:bg-[#A32E24] text-white px-4 py-2 text-xs font-semibold shadow-xs shadow-[#8C271E]/25 active:scale-95 disabled:opacity-40 transition cursor-pointer"
              >
                {isPlayingPlaylist ? (
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
                disabled={playableQueue.length === 0}
                onClick={() => {
                  if (playableQueue.length > 0) void player.playShuffled(playableQueue);
                }}
                className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-zinc-900 hover:bg-slate-200/80 dark:hover:bg-zinc-800 text-slate-800 dark:text-zinc-100 px-3.5 py-2 text-xs font-semibold disabled:opacity-40 transition cursor-pointer"
              >
                <Shuffle size={13} /> Aléatoire
              </button>

              <button
                type="button"
                onClick={() => setShowAddTracksSheet(true)}
                className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-zinc-900 hover:bg-slate-200/80 dark:hover:bg-zinc-800 text-slate-800 dark:text-zinc-100 px-3.5 py-2 text-xs font-semibold transition cursor-pointer"
              >
                <Plus size={13} /> Ajouter des sons
              </button>
            </div>
          </div>
        </div>

        {/* Studio Tracklist Card */}
        <div className="space-y-2.5 pt-2 border-t border-slate-100 dark:border-zinc-800/80">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-500 dark:text-zinc-400">
              Morceaux de la playlist ({playlistItems.length})
            </p>
            <p className="text-[11px] text-slate-400">
              Clic sur ▶ pour lire · Clic sur un morceau pour ouvrir sa fiche son
            </p>
          </div>

          {playlistItems.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 dark:border-zinc-800 p-8 text-center space-y-3">
              <p className="text-xs text-slate-400">
                Cette playlist est vide. Ajoute tes propres morceaux ou les sons que tu as likés dans la communauté !
              </p>
              <button
                type="button"
                onClick={() => setShowAddTracksSheet(true)}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#8C271E] text-white px-4 py-2 text-xs font-semibold cursor-pointer"
              >
                <Plus size={14} /> Choisir des sons
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {playlistItems.map((item) => {
                const isCurrent = player.currentTrack?.id === item.playableTrack.id;
                const isPlayingThis = isCurrent && player.isPlaying;
                return (
                  <div
                    key={item.key}
                    onClick={() => {
                      if (item.kind === 'own' && onOpenOwnTrack) {
                        onOpenOwnTrack(item.id);
                      } else if (item.kind === 'social' && item.socialItem && onOpenSocialTrack) {
                        onOpenSocialTrack(item.socialItem);
                      } else if (isCurrent) {
                        player.togglePlay();
                      } else {
                        void player.playTrack(item.playableTrack, 0, playableQueue);
                      }
                    }}
                    className={`group flex items-center justify-between gap-3 rounded-2xl border p-3 transition cursor-pointer ${
                      isCurrent
                        ? 'border-[#8C271E]/65 bg-[#8C271E]/[0.05] dark:bg-[#8C271E]/[0.12]'
                        : 'border-slate-200/75 dark:border-zinc-800/80 bg-slate-50/40 dark:bg-zinc-900/40 hover:border-[#8C271E]/35'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {/* Square Playable Cover (like TrackCard) */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isCurrent) {
                            player.togglePlay();
                          } else {
                            void player.playTrack(item.playableTrack, 0, playableQueue);
                          }
                        }}
                        title={isPlayingThis ? 'Pause' : 'Lire ce son'}
                        className="relative h-11 w-11 rounded-xl overflow-hidden shrink-0 flex items-center justify-center text-white font-bold text-xs shadow-xs cursor-pointer"
                        style={getCoverGradientStyle(item.coverGradient)}
                      >
                        {item.coverUrl ? (
                          <img
                            src={item.coverUrl}
                            alt={item.title}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          item.title.slice(0, 2).toUpperCase()
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
                              isCurrent
                                ? 'text-[#8C271E] dark:text-[#E56B5F]'
                                : 'text-slate-900 dark:text-zinc-100'
                            }`}
                          >
                            {item.title}
                          </p>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider shrink-0 ${
                              item.kind === 'social'
                                ? 'bg-[#8C271E]/12 text-[#8C271E] dark:text-[#E56B5F]'
                                : 'bg-slate-200/70 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300'
                            }`}
                          >
                            {item.kind === 'social' ? '♥ Liké' : 'Mon son'}
                          </span>
                          {item.versionLabel && (
                            <span className="rounded-full bg-slate-100 dark:bg-zinc-800 px-2 py-0.5 font-mono text-[10px] text-slate-500 dark:text-zinc-400">
                              {item.versionLabel}
                            </span>
                          )}
                          {item.rating && (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 dark:bg-zinc-800 px-2 py-0.5 font-mono text-[10px] font-semibold text-[#8C271E] dark:text-[#E56B5F]">
                              <Star size={9} fill="currentColor" /> {item.rating}/10
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-zinc-500 truncate mt-0.5">
                          {item.kind === 'social' && item.ownerUid && onOpenArtistProfile ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenArtistProfile(item.ownerUid!);
                              }}
                              className="hover:text-[#8C271E] dark:hover:text-[#E56B5F] hover:underline cursor-pointer"
                            >
                              {item.artist}
                            </button>
                          ) : (
                            <span>{item.artist}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono text-xs text-slate-400 dark:text-zinc-500 tabular-nums">
                        {formatDuration(item.durationSec)}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleTrackInPlaylist(playlist.id, item.id, item.kind);
                        }}
                        title="Retirer de la playlist"
                        className="h-7 w-7 rounded-lg inline-flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition cursor-pointer"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Sheet to Add Own Tracks or Liked Social Tracks */}
      {showAddTracksSheet && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
          onClick={() => setShowAddTracksSheet(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-3xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#141010] shadow-2xl overflow-hidden flex flex-col max-h-[82vh]"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-zinc-800">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100">
                  Ajouter à « {playlist.title} »
                </h3>
                <p className="text-[11px] text-slate-400">
                  Combine tes propres morceaux et les sons que tu as likés
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddTracksSheet(false)}
                className="h-8 w-8 rounded-full bg-slate-100 dark:bg-zinc-800 inline-flex items-center justify-center text-slate-500 cursor-pointer"
              >
                <X size={15} />
              </button>
            </div>

            {/* Segmented Tab Control: Mes sons vs Sons likés */}
            <div className="px-5 pt-3 space-y-2.5">
              <div className="grid grid-cols-2 rounded-xl bg-slate-100 dark:bg-zinc-900 p-1">
                <button
                  type="button"
                  onClick={() => setAddTab('own')}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition cursor-pointer ${
                    addTab === 'own'
                      ? 'bg-[#8C271E] text-white shadow-xs'
                      : 'text-slate-500 dark:text-zinc-400'
                  }`}
                >
                  <Music2 size={13} /> Mes sons ({trackGroups.length})
                </button>
                <button
                  type="button"
                  onClick={() => setAddTab('social')}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition cursor-pointer ${
                    addTab === 'social'
                      ? 'bg-[#8C271E] text-white shadow-xs'
                      : 'text-slate-500 dark:text-zinc-400'
                  }`}
                >
                  <Heart size={13} /> Sons likés ({likedSocialTracks.length})
                </button>
              </div>

              <div className="relative">
                <Search
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filtrer les titres…"
                  className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 pl-8 pr-3 py-2 text-xs outline-none"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 divide-y divide-slate-100 dark:divide-zinc-800/60">
              {addTab === 'own' ? (
                filteredOwnGroups.length === 0 ? (
                  <p className="py-8 text-center text-xs text-slate-400">
                    Aucun son personnel trouvé.
                  </p>
                ) : (
                  filteredOwnGroups.map((g) => {
                    const trk = g.latestTrack;
                    const checked = playlist.ownTrackIds.includes(trk.id);
                    return (
                      <button
                        key={g.groupKey}
                        type="button"
                        onClick={() => toggleTrackInPlaylist(playlist.id, trk.id, 'own')}
                        className="w-full flex items-center justify-between gap-3 py-2.5 px-2 hover:bg-slate-50 dark:hover:bg-zinc-900/60 rounded-xl transition cursor-pointer text-left"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-900 dark:text-zinc-100 truncate">
                            {g.baseTitle}
                          </p>
                          <p className="text-[11px] text-slate-400 font-mono">
                            {g.latestVersionLabel} · {g.yearFolder || 'Studio'}
                          </p>
                        </div>
                        <span
                          className={`h-6 w-6 rounded-full inline-flex items-center justify-center shrink-0 transition ${
                            checked
                              ? 'bg-[#8C271E] text-white'
                              : 'border border-slate-300 dark:border-zinc-700 text-transparent'
                          }`}
                        >
                          <Check size={13} />
                        </span>
                      </button>
                    );
                  })
                )
              ) : filteredSocialTracks.length === 0 ? (
                <div className="py-8 text-center space-y-2">
                  <p className="text-xs text-slate-400">
                    Tu n’as pas encore liké de son dans la communauté Rowav Social.
                  </p>
                </div>
              ) : (
                filteredSocialTracks.map((soc) => {
                  const checked = playlist.socialTrackIds.includes(soc.id);
                  return (
                    <button
                      key={soc.id}
                      type="button"
                      onClick={() => toggleTrackInPlaylist(playlist.id, soc.id, 'social')}
                      className="w-full flex items-center justify-between gap-3 py-2.5 px-2 hover:bg-slate-50 dark:hover:bg-zinc-900/60 rounded-xl transition cursor-pointer text-left"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900 dark:text-zinc-100 truncate">
                          {soc.title}
                        </p>
                        <p className="text-[11px] text-slate-400 truncate">
                          {soc.artist} · {soc.projectTitle || 'Rowav Social'}
                        </p>
                      </div>
                      <span
                        className={`h-6 w-6 rounded-full inline-flex items-center justify-center shrink-0 transition ${
                          checked
                            ? 'bg-[#8C271E] text-white'
                            : 'border border-slate-300 dark:border-zinc-700 text-transparent'
                        }`}
                      >
                        <Check size={13} />
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <div className="px-5 py-3.5 border-t border-slate-100 dark:border-zinc-800 flex justify-end">
              <button
                type="button"
                onClick={() => setShowAddTracksSheet(false)}
                className="rounded-full bg-[#8C271E] text-white px-5 py-1.5 text-xs font-semibold cursor-pointer"
              >
                Terminé
              </button>
            </div>
          </div>
        </div>
      )}

      <AppleConfirmDialog
        open={confirmDeleteOpen}
        title={`Supprimer « ${playlist.title} » ?`}
        description="La playlist sera supprimée, mais tes morceaux et tes sons likés seront conservés."
        confirmLabel="Supprimer"
        destructive
        onCancel={() => setConfirmDeleteOpen(false)}
        onConfirm={() => {
          setConfirmDeleteOpen(false);
          deletePlaylist(playlist.id);
          onClose();
        }}
      />
    </div>
  );
}

interface CreatePlaylistModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (playlistId: string) => void;
}

export function CreatePlaylistModal({ open, onClose, onCreated }: CreatePlaylistModalProps) {
  const { state, likedSocialTracks, createPlaylist } = useApp();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [coverGradient, setCoverGradient] = useState<string>('sunset');
  const [selectedOwnIds, setSelectedOwnIds] = useState<string[]>([]);
  const [selectedSocialIds, setSelectedSocialIds] = useState<string[]>([]);
  const [tab, setTab] = useState<'own' | 'social'>('own');

  const trackGroups = useMemo(() => groupMusicTracks(state.musicTracks), [state.musicTracks]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newId = createPlaylist({
      title: title.trim() || 'Ma Playlist Rowav',
      description: description.trim() || undefined,
      coverGradient,
      ownTrackIds: selectedOwnIds,
      socialTrackIds: selectedSocialIds,
    });
    setTitle('');
    setDescription('');
    setSelectedOwnIds([]);
    setSelectedSocialIds([]);
    onCreated(newId);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-3xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#141010] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-zinc-800">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100">
              Nouvelle Playlist Hybride
            </h3>
            <p className="text-[11px] text-slate-400">
              Mélange tes sons personnels et tes sons likés de la communauté
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded-full bg-slate-100 dark:bg-zinc-800 inline-flex items-center justify-center text-slate-500 cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="space-y-2.5">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Nom de la playlist (ex. Rotation Nuit, Sélection Studio…)"
              className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3.5 py-2.5 text-xs font-semibold text-slate-900 dark:text-zinc-100 outline-none focus:border-slate-400"
              autoFocus
            />
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description courte (optionnelle)"
              className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3.5 py-2 text-xs text-slate-600 dark:text-zinc-300 outline-none"
            />
          </div>

          {/* Gradient Picker */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-slate-400">Couleur :</span>
            <div className="flex items-center gap-1.5">
              {COVER_GRADIENTS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setCoverGradient(g.id)}
                  className={`h-5 w-5 rounded-full transition cursor-pointer ${
                    coverGradient === g.id ? 'ring-2 ring-offset-2 ring-[#8C271E] scale-110' : ''
                  }`}
                  style={{ background: `linear-gradient(135deg, ${g.from}, ${g.to})` }}
                />
              ))}
            </div>
          </div>

          {/* Track Picker Tabs */}
          <div className="space-y-2">
            <div className="grid grid-cols-2 rounded-xl bg-slate-100 dark:bg-zinc-900 p-1">
              <button
                type="button"
                onClick={() => setTab('own')}
                className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition cursor-pointer ${
                  tab === 'own'
                    ? 'bg-[#8C271E] text-white shadow-xs'
                    : 'text-slate-500 dark:text-zinc-400'
                }`}
              >
                <Music2 size={13} /> Mes sons ({selectedOwnIds.length})
              </button>
              <button
                type="button"
                onClick={() => setTab('social')}
                className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition cursor-pointer ${
                  tab === 'social'
                    ? 'bg-[#8C271E] text-white shadow-xs'
                    : 'text-slate-500 dark:text-zinc-400'
                }`}
              >
                <Users size={13} /> Sons likés ({selectedSocialIds.length})
              </button>
            </div>

            <div className="max-h-52 overflow-y-auto rounded-2xl border border-slate-200/70 dark:border-zinc-800 divide-y divide-slate-100 dark:divide-zinc-800/60 p-1.5">
              {tab === 'own' ? (
                trackGroups.length === 0 ? (
                  <p className="py-6 text-center text-xs text-slate-400">
                    Aucun son personnel dans ta bibliothèque.
                  </p>
                ) : (
                  trackGroups.slice(0, 40).map((g) => {
                    const id = g.latestTrack.id;
                    const active = selectedOwnIds.includes(id);
                    return (
                      <button
                        key={g.groupKey}
                        type="button"
                        onClick={() =>
                          setSelectedOwnIds((prev) =>
                            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
                          )
                        }
                        className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl hover:bg-slate-50 dark:hover:bg-zinc-900/60 text-left cursor-pointer"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-900 dark:text-zinc-100 truncate">
                            {g.baseTitle}
                          </p>
                          <p className="text-[10px] text-slate-400 font-mono">
                            {g.latestVersionLabel}
                          </p>
                        </div>
                        <span
                          className={`h-5 w-5 rounded-full inline-flex items-center justify-center shrink-0 ${
                            active
                              ? 'bg-[#8C271E] text-white'
                              : 'border border-slate-300 dark:border-zinc-700 text-transparent'
                          }`}
                        >
                          <Check size={11} />
                        </span>
                      </button>
                    );
                  })
                )
              ) : likedSocialTracks.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-400">
                  Like des sons dans l’onglet Social pour les ajouter ici !
                </p>
              ) : (
                likedSocialTracks.map((soc) => {
                  const active = selectedSocialIds.includes(soc.id);
                  return (
                    <button
                      key={soc.id}
                      type="button"
                      onClick={() =>
                        setSelectedSocialIds((prev) =>
                          prev.includes(soc.id)
                            ? prev.filter((x) => x !== soc.id)
                            : [...prev, soc.id]
                        )
                      }
                      className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl hover:bg-slate-50 dark:hover:bg-zinc-900/60 text-left cursor-pointer"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900 dark:text-zinc-100 truncate">
                          {soc.title}
                        </p>
                        <p className="text-[10px] text-slate-400 truncate">
                          {soc.artist}
                        </p>
                      </div>
                      <span
                        className={`h-5 w-5 rounded-full inline-flex items-center justify-center shrink-0 ${
                          active
                            ? 'bg-[#8C271E] text-white'
                            : 'border border-slate-300 dark:border-zinc-700 text-transparent'
                        }`}
                      >
                        <Check size={11} />
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-slate-100 dark:border-zinc-800 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 dark:border-zinc-800 px-4 py-1.5 text-xs font-medium text-slate-500 cursor-pointer"
          >
            Annuler
          </button>
          <button
            type="submit"
            className="rounded-full bg-[#8C271E] text-white px-5 py-1.5 text-xs font-semibold hover:opacity-95 transition cursor-pointer"
          >
            Créer la playlist
          </button>
        </div>
      </form>
    </div>
  );
}
