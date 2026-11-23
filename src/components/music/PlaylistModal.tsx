import React, { useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronLeft,
  Heart,
  ImagePlus,
  ListMusic,
  Music2,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Shuffle,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAudioPlayer } from '../../context/AudioPlayerContext';
import { COVER_GRADIENTS, getCoverGradientStyle, groupMusicTracks } from '../../lib/musicVersioning';
import { socialTrackToMusicTrack } from '../../lib/socialApi';
import { compressCoverImage, resolveEffectiveTrackCover } from '../../lib/trackCover';
import type { MusicTrack, SocialTrackItem } from '../../types';
import { AppleConfirmDialog } from '../ui/AppleConfirmDialog';
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
  onOpenArtistProfile?: (artistUid: string) => void;
}

export function PlaylistPage({
  playlistId,
  onClose,
  onOpenOwnTrack,
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

  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [showAddTracksSheet, setShowAddTracksSheet] = useState(false);
  const [addTab, setAddTab] = useState<'own' | 'social'>('own');
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const coverInputRef = useRef<HTMLInputElement | null>(null);

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
        playableTrack: socialTrackToMusicTrack(soc),
        socialItem: soc,
      });
    }

    return items;
  }, [playlist, state.musicTracks, state.musicProjects, state.preferences.name, trackGroups, likedSocialTracks]);

  const playableQueue = useMemo(
    () => playlistItems.map((it) => it.playableTrack),
    [playlistItems]
  );

  if (!playlist) {
    return (
      <div className="tempo-card rounded-3xl p-8 text-center space-y-3">
        <p className="text-xs text-slate-400">Playlist introuvable.</p>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-4 py-2 text-xs font-semibold cursor-pointer"
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

  const startEditing = () => {
    setEditTitle(playlist.title);
    setEditDesc(playlist.description || '');
    setIsEditing(true);
  };

  const saveEditing = () => {
    updatePlaylist(playlist.id, {
      title: editTitle.trim() || playlist.title,
      description: editDesc.trim() || undefined,
    });
    setIsEditing(false);
    notify('Playlist mise à jour ✓');
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
    <div className="space-y-6 pb-12">
      {/* Top Bar */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md px-3.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 transition cursor-pointer"
        >
          <ChevronLeft size={14} /> Retour
        </button>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={startEditing}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-zinc-300 hover:text-slate-900 dark:hover:text-zinc-100 transition cursor-pointer"
          >
            <Pencil size={12} /> Modifier
          </button>
          <button
            type="button"
            onClick={() => setConfirmDeleteOpen(true)}
            className="h-8 w-8 rounded-full border border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900 inline-flex items-center justify-center text-slate-400 hover:text-rose-500 transition cursor-pointer"
            title="Supprimer la playlist"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Spotify-style Playlist Hero */}
      <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 dark:border-zinc-800/90 bg-white dark:bg-[#111114] p-6 sm:p-8">
        <div
          className="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full opacity-20 blur-3xl"
          style={getCoverGradientStyle(playlist.coverGradient)}
        />

        <div className="relative flex flex-col sm:flex-row items-center sm:items-end gap-6">
          {/* Square Cover with upload */}
          <div className="relative group h-40 w-40 sm:h-48 sm:w-48 rounded-2xl overflow-hidden shadow-xl border border-black/10 dark:border-white/10 shrink-0">
            <ProjectCoverArtwork
              title={playlist.title}
              projectCoverUrl={playlist.coverDataUrl}
              trackCoverUrls={individualCovers}
              gradientId={playlist.coverGradient}
            />
            <button
              type="button"
              onClick={() => coverInputRef.current?.click()}
              className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 transition flex flex-col items-center justify-center gap-1 text-white text-xs font-semibold cursor-pointer"
            >
              <ImagePlus size={18} />
              <span>Changer pochette</span>
            </button>
            <input
              ref={coverInputRef}
              type="file"
              accept="image/*"
              onChange={handleCoverUpload}
              className="hidden"
            />
          </div>

          {/* Playlist Info */}
          <div className="flex-1 text-center sm:text-left space-y-2 min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FF5500]/10 text-[#FF5500] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
              <ListMusic size={11} /> Playlist Hybride · Mes sons & Likes
            </span>

            {isEditing ? (
              <div className="space-y-2 max-w-md">
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3 py-1.5 text-base font-bold text-slate-900 dark:text-zinc-100 outline-none"
                  placeholder="Titre de la playlist"
                />
                <input
                  type="text"
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3 py-1.5 text-xs text-slate-600 dark:text-zinc-300 outline-none"
                  placeholder="Description (optionnelle)"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={saveEditing}
                    className="rounded-full bg-[#FF5500] text-white px-3.5 py-1 text-xs font-semibold cursor-pointer"
                  >
                    Enregistrer
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsEditing(false)}
                    className="rounded-full border border-slate-200 dark:border-zinc-700 px-3 py-1 text-xs text-slate-500 cursor-pointer"
                  >
                    Annuler
                  </button>
                </div>
              </div>
            ) : (
              <>
                <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-zinc-50 truncate">
                  {playlist.title}
                </h1>
                {playlist.description && (
                  <p className="text-xs text-slate-500 dark:text-zinc-400 max-w-xl">
                    {playlist.description}
                  </p>
                )}
              </>
            )}

            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 text-xs text-slate-500 dark:text-zinc-400 pt-1">
              <span className="font-semibold text-slate-900 dark:text-zinc-100">
                {state.preferences.name || 'Moi'}
              </span>
              <span>·</span>
              <span className="font-mono">{playlistItems.length} titres</span>
              <span>·</span>
              <span className="font-mono">
                {playlist.ownTrackIds.length} perso / {playlist.socialTrackIds.length} likés
              </span>
              <span>·</span>
              <span className="font-mono">~{totalMin} min</span>
            </div>
          </div>
        </div>

        {/* Spotify Action Bar */}
        <div className="relative mt-6 pt-5 border-t border-slate-100 dark:border-zinc-800/80 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAddTracksSheet(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-4 py-2 text-xs font-semibold hover:opacity-90 transition cursor-pointer"
            >
              <Plus size={14} /> Ajouter des sons
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={playableQueue.length === 0}
              onClick={() => {
                if (playableQueue.length > 0) void player.playShuffled(playableQueue);
              }}
              title="Lecture aléatoire"
              className="h-10 w-10 rounded-full border border-slate-200 dark:border-zinc-800 inline-flex items-center justify-center text-slate-600 dark:text-zinc-300 hover:text-slate-900 dark:hover:text-white disabled:opacity-40 transition cursor-pointer"
            >
              <Shuffle size={16} />
            </button>
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
              className="h-12 w-12 rounded-full bg-[#FF5500] text-white shadow-lg shadow-[#FF5500]/25 inline-flex items-center justify-center hover:scale-105 active:scale-95 disabled:opacity-40 transition cursor-pointer"
            >
              {isPlayingPlaylist ? (
                <Pause size={20} fill="currentColor" />
              ) : (
                <Play size={20} fill="currentColor" className="ml-0.5" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Tracklist */}
      <div className="tempo-card rounded-3xl overflow-hidden">
        {playlistItems.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <p className="text-xs text-slate-400">
              Cette playlist est vide. Ajoute tes propres morceaux ou les sons que tu as likés dans la communauté !
            </p>
            <button
              type="button"
              onClick={() => setShowAddTracksSheet(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#FF5500] text-white px-4 py-2 text-xs font-semibold cursor-pointer"
            >
              <Plus size={14} /> Choisir des sons
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-zinc-800/70">
            {playlistItems.map((item, idx) => {
              const isCurrent = player.currentTrack?.id === item.playableTrack.id;
              const isPlayingThis = isCurrent && player.isPlaying;
              return (
                <div
                  key={item.key}
                  onClick={() => {
                    if (isCurrent) {
                      player.togglePlay();
                    } else {
                      void player.playTrack(item.playableTrack, 0, playableQueue);
                    }
                  }}
                  className={`group flex items-center justify-between gap-3 px-4 py-3 transition cursor-pointer ${
                    isCurrent
                      ? 'bg-[#FF5500]/6 dark:bg-[#FF5500]/10'
                      : 'hover:bg-slate-50/90 dark:hover:bg-zinc-900/60'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`w-5 text-center font-mono text-xs ${
                        isCurrent
                          ? 'text-[#FF5500] font-bold'
                          : 'text-slate-400 dark:text-zinc-500'
                      }`}
                    >
                      {isPlayingThis ? '▶' : idx + 1}
                    </span>

                    <div
                      className="h-10 w-10 rounded-xl overflow-hidden shrink-0 flex items-center justify-center text-white font-bold text-xs shadow-xs"
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
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p
                          className={`text-xs sm:text-sm font-semibold truncate ${
                            isCurrent
                              ? 'text-[#FF5500]'
                              : 'text-slate-900 dark:text-zinc-100'
                          }`}
                        >
                          {item.title}
                        </p>
                        <span
                          className={`rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider shrink-0 ${
                            item.kind === 'social'
                              ? 'bg-[#FF5500]/12 text-[#FF5500]'
                              : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300'
                          }`}
                        >
                          {item.kind === 'social' ? '♥ Liké' : 'Mon son'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-zinc-500 truncate">
                        {item.kind === 'social' && item.ownerUid && onOpenArtistProfile ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenArtistProfile(item.ownerUid!);
                            }}
                            className="hover:text-[#FF5500] hover:underline cursor-pointer"
                          >
                            {item.artist}
                          </button>
                        ) : (
                          <span>{item.artist}</span>
                        )}
                        {item.versionLabel && (
                          <>
                            <span>·</span>
                            <span className="font-mono">{item.versionLabel}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {item.kind === 'own' && onOpenOwnTrack && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenOwnTrack(item.id);
                        }}
                        className="hidden sm:inline-flex rounded-lg px-2 py-1 text-[11px] text-slate-400 hover:text-slate-800 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 transition cursor-pointer"
                      >
                        Fiche
                      </button>
                    )}
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

      {/* Sheet to Add Own Tracks or Liked Social Tracks */}
      {showAddTracksSheet && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
          onClick={() => setShowAddTracksSheet(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-3xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111114] shadow-2xl overflow-hidden flex flex-col max-h-[82vh]"
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
                      ? 'bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 shadow-xs'
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
                      ? 'bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 shadow-xs'
                      : 'text-slate-500 dark:text-zinc-400'
                  }`}
                >
                  <Heart size={13} className="text-[#FF5500]" /> Sons likés ({likedSocialTracks.length})
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
                              ? 'bg-[#FF5500] text-white'
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
                    Tu n’as pas encore liké de son dans la communauté Kora Social.
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
                          {soc.artist} · {soc.projectTitle || 'Kora Social'}
                        </p>
                      </div>
                      <span
                        className={`h-6 w-6 rounded-full inline-flex items-center justify-center shrink-0 transition ${
                          checked
                            ? 'bg-[#FF5500] text-white'
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
                className="rounded-full bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-5 py-1.5 text-xs font-semibold cursor-pointer"
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
      title: title.trim() || 'Ma Playlist Kora',
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
        className="w-full max-w-lg rounded-3xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111114] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
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
                    coverGradient === g.id ? 'ring-2 ring-offset-2 ring-[#FF5500] scale-110' : ''
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
                    ? 'bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 shadow-xs'
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
                    ? 'bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 shadow-xs'
                    : 'text-slate-500 dark:text-zinc-400'
                }`}
              >
                <Users size={13} className="text-[#FF5500]" /> Sons likés ({selectedSocialIds.length})
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
                              ? 'bg-[#FF5500] text-white'
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
                            ? 'bg-[#FF5500] text-white'
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
            className="rounded-full bg-[#FF5500] text-white px-5 py-1.5 text-xs font-semibold hover:opacity-95 transition cursor-pointer"
          >
            Créer la playlist
          </button>
        </div>
      </form>
    </div>
  );
}
