import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Disc3,
  FileText,
  FolderOpen,
  Music2,
  Play,
  Search,
  X,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useAudioPlayer } from '../context/AudioPlayerContext';
import { groupMusicTracks } from '../lib/musicVersioning';
import { parseLyricLines } from './music/LyricLinesEditor';
import type { MusicTrack } from '../types';

interface GlobalSearchModalProps {
  open: boolean;
  onClose: () => void;
}

type SearchResultItem =
  | {
      kind: 'track';
      id: string;
      title: string;
      subtitle: string;
      track: MusicTrack;
      score: number;
    }
  | {
      kind: 'project';
      id: string;
      title: string;
      subtitle: string;
      projectId: string;
      score: number;
    }
  | {
      kind: 'pack';
      id: string;
      title: string;
      subtitle: string;
      projectId: string;
      score: number;
    }
  | {
      kind: 'lyrics';
      id: string;
      title: string;
      subtitle: string;
      matchedLine?: string;
      docId: string;
      score: number;
    };

function norm(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function GlobalSearchModal({ open, onClose }: GlobalSearchModalProps) {
  const { state } = useApp();
  const {
    playTrack,
    requestOpenTrackPage,
    requestOpenProjectPage,
    requestOpenLyricsDoc,
  } = useAudioPlayer();

  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelectedIdx(0);
    const id = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(id);
  }, [open]);

  const groups = useMemo(() => groupMusicTracks(state.musicTracks), [state.musicTracks]);

  const results = useMemo<SearchResultItem[]>(() => {
    const q = norm(query.trim());
    const out: SearchResultItem[] = [];

    // 1. Tracks
    for (const g of groups) {
      const t = g.latestTrack;
      const haystack = norm(
        [
          g.baseTitle,
          t.title,
          t.description || '',
          t.tags.join(' '),
          t.bpm ? `${t.bpm} bpm` : '',
          t.musicalKey || '',
        ].join(' ')
      );
      if (!q) {
        if (out.length < 5) {
          out.push({
            kind: 'track',
            id: `trk_${t.id}`,
            title: g.baseTitle,
            subtitle: [
              g.latestVersionLabel !== 'Original' ? g.latestVersionLabel : null,
              t.bpm ? `${t.bpm} BPM` : null,
              t.musicalKey || null,
            ]
              .filter(Boolean)
              .join(' · ') || 'Morceau',
            track: t,
            score: 1,
          });
        }
        continue;
      }
      if (haystack.includes(q)) {
        const titleNorm = norm(g.baseTitle);
        const score = titleNorm.startsWith(q) ? 100 : titleNorm.includes(q) ? 80 : 45;
        out.push({
          kind: 'track',
          id: `trk_${t.id}`,
          title: g.baseTitle,
          subtitle: [
            g.latestVersionLabel !== 'Original' ? g.latestVersionLabel : null,
            t.bpm ? `${t.bpm} BPM` : null,
            t.musicalKey || null,
          ]
            .filter(Boolean)
            .join(' · ') || 'Morceau',
          track: t,
          score,
        });
      }
    }

    // 2. Projects & Packs
    for (const p of state.musicProjects) {
      const pHay = norm([p.title, p.notes || '', p.kind].join(' '));
      if (!q) {
        if (out.filter((x) => x.kind === 'project').length < 3) {
          out.push({
            kind: 'project',
            id: `proj_${p.id}`,
            title: p.title,
            subtitle: `${p.kind.toUpperCase()} · ${p.trackIds.length} titre${p.trackIds.length > 1 ? 's' : ''}`,
            projectId: p.id,
            score: 0.9,
          });
        }
      } else if (pHay.includes(q)) {
        const titleNorm = norm(p.title);
        out.push({
          kind: 'project',
          id: `proj_${p.id}`,
          title: p.title,
          subtitle: `${p.kind.toUpperCase()} · ${p.trackIds.length} titre${p.trackIds.length > 1 ? 's' : ''}`,
          projectId: p.id,
          score: titleNorm.startsWith(q) ? 95 : titleNorm.includes(q) ? 75 : 40,
        });
      }

      if (q && Array.isArray(p.packs)) {
        for (const pack of p.packs) {
          const packHay = norm([pack.title, pack.description || ''].join(' '));
          if (packHay.includes(q)) {
            out.push({
              kind: 'pack',
              id: `pack_${p.id}_${pack.id}`,
              title: pack.title,
              subtitle: `Pack dans ${p.title} · ${pack.trackIds.length} son${pack.trackIds.length > 1 ? 's' : ''}`,
              projectId: p.id,
              score: norm(pack.title).startsWith(q) ? 85 : 60,
            });
          }
        }
      }
    }

    // 3. Lyrics Docs + Deep Line Search!
    for (const doc of state.lyricsDocs) {
      if (doc.deletedAt) continue;
      if (!q) {
        if (out.filter((x) => x.kind === 'lyrics').length < 3) {
          out.push({
            kind: 'lyrics',
            id: `lyr_${doc.id}`,
            title: doc.title || 'Sans titre',
            subtitle: 'Texte / Paroles',
            docId: doc.id,
            score: 0.8,
          });
        }
        continue;
      }
      const titleNorm = norm(doc.title || '');
      const lines = parseLyricLines(doc.content || '');
      const matchingLine = lines.find((ln) => norm(ln.text).includes(q));
      if (titleNorm.includes(q) || matchingLine) {
        out.push({
          kind: 'lyrics',
          id: `lyr_${doc.id}`,
          title: doc.title || 'Sans titre',
          subtitle: 'Paroles',
          matchedLine: matchingLine?.text.trim(),
          docId: doc.id,
          score: titleNorm.startsWith(q) ? 90 : titleNorm.includes(q) ? 70 : 65,
        });
      }
    }

    out.sort((a, b) => b.score - a.score);
    return out.slice(0, 24);
  }, [query, groups, state.musicProjects, state.lyricsDocs]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  const handleOpenItem = (item: SearchResultItem) => {
    onClose();
    if (item.kind === 'track') {
      requestOpenTrackPage(item.track.id);
    } else if (item.kind === 'project' || item.kind === 'pack') {
      requestOpenProjectPage(item.projectId);
    } else if (item.kind === 'lyrics') {
      requestOpenLyricsDoc(item.docId);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => (results.length > 0 ? (i + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => (results.length > 0 ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === 'Enter' && results[selectedIdx]) {
      e.preventDefault();
      handleOpenItem(results[selectedIdx]);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onClick={onClose}
          className="fixed inset-0 z-[75] bg-black/50 backdrop-blur-xs flex items-start justify-center p-3 sm:p-6 pt-[min(12vh,88px)]"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -8 }}
            transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={handleKeyDown}
            className="w-full max-w-xl rounded-2xl bg-white dark:bg-[#141010] border border-slate-200/90 dark:border-zinc-800 shadow-2xl overflow-hidden flex flex-col max-h-[75dvh]"
          >
            {/* Search Input */}
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-100 dark:border-zinc-800/80">
              <Search size={17} className="text-[#8C271E] shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher un son, projet, pack ou une phrase de parole…"
                className="flex-1 bg-transparent text-sm text-slate-900 dark:text-zinc-100 placeholder:text-slate-400 outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="p-1 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer"
                >
                  <X size={14} />
                </button>
              )}
              <kbd className="hidden sm:inline-flex items-center rounded-md border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                ESC
              </kbd>
            </div>

            {/* Results List */}
            <div className="overflow-y-auto overscroll-contain p-2 space-y-0.5">
              {!query.trim() && results.length > 0 && (
                <p className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Accès rapide · Sons, Projets & Textes
                </p>
              )}

              {results.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-400">
                  Aucun résultat pour « {query} »
                </div>
              ) : (
                results.map((item, idx) => {
                  const active = idx === selectedIdx;
                  return (
                    <div
                      key={item.id}
                      onMouseEnter={() => setSelectedIdx(idx)}
                      className={`group flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition cursor-pointer ${
                        active
                          ? 'bg-[#8C271E]/10 dark:bg-[#8C271E]/22'
                          : 'hover:bg-slate-100/70 dark:hover:bg-zinc-900/70'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleOpenItem(item)}
                        className="flex-1 min-w-0 flex items-center gap-3 text-left cursor-pointer"
                      >
                        <span
                          className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${
                            item.kind === 'track'
                              ? 'bg-[#8C271E]/12 text-[#8C271E] dark:text-[#E56B5F]'
                              : item.kind === 'project'
                              ? 'bg-sky-500/12 text-sky-600 dark:text-sky-400'
                              : item.kind === 'pack'
                              ? 'bg-amber-500/14 text-amber-600 dark:text-amber-400'
                              : 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400'
                          }`}
                        >
                          {item.kind === 'track' ? (
                            <Music2 size={14} />
                          ) : item.kind === 'project' ? (
                            <Disc3 size={14} />
                          ) : item.kind === 'pack' ? (
                            <FolderOpen size={14} />
                          ) : (
                            <FileText size={14} />
                          )}
                        </span>

                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-slate-900 dark:text-zinc-100 truncate">
                            {item.title}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-zinc-400 truncate">
                            {item.subtitle}
                          </p>
                          {item.kind === 'lyrics' && item.matchedLine && (
                            <p className="text-[11px] text-[#8C271E] dark:text-[#F08B82] italic truncate mt-0.5">
                              « {item.matchedLine} »
                            </p>
                          )}
                        </div>
                      </button>

                      {item.kind === 'track' && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void playTrack(item.track, 0);
                            onClose();
                          }}
                          title="Lire directement"
                          className="h-7 w-7 rounded-full bg-[#8C271E] text-white flex items-center justify-center opacity-85 hover:opacity-100 active:scale-95 transition cursor-pointer shrink-0"
                        >
                          <Play size={11} fill="currentColor" className="ml-0.5" />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer Hints */}
            <div className="px-4 py-2 border-t border-slate-100 dark:border-zinc-800/80 flex items-center justify-between text-[10px] text-slate-400">
              <span>Sons · Projets · Packs · Lignes de paroles</span>
              <span className="hidden sm:inline font-mono">↑↓ Naviguer · ↵ Ouvrir</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
