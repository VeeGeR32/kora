import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Flame,
  Headphones,
  Lock,
  Mic2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Sliders,
  Trash2,
  Unlock,
  X,
} from 'lucide-react';
import type { MusicProject, MusicProjectSprint, MusicTrack, TrackStatus } from '../../types';
import { useApp } from '../../context/AppContext';
import { useAudioPlayer } from '../../context/AudioPlayerContext';
import { AppleConfirmDialog } from '../ui/AppleConfirmDialog';
import type { TrackGroup } from '../../lib/musicVersioning';
import {
  countLyricsFixTags,
  findLinkedLyricsForTrack,
  resolveTrackWorkflow,
} from '../../lib/trackCover';
import {
  isAtLeastMaquette,
  isAtLeastRecFinal,
  isMasteredTrack,
  TRACK_MOOD_META,
  TRACK_PIPELINE_ORDER,
  TRACK_STATUS_META,
} from '../../utils/theme';
import { uid } from '../../utils/dates';
import { ProjectHarmonizationView } from './ProjectHarmonizationView';

interface ProjectSprintViewProps {
  project: MusicProject;
  projectTracks: MusicTrack[];
  allGroups: TrackGroup[];
  onOpenTrackDetails?: (trackId: string) => void;
  onOpenContextMenu?: (
    e: React.MouseEvent,
    group: TrackGroup,
    trackId: string,
    initialSection?: 'versions' | 'projects' | null
  ) => void;
}

type StudioPhase = 1 | 2 | 3 | 4 | 5;

const MAX_SPRINT_TRACKS = 3;
const PHASE1_STAGES: TrackStatus[] = ['brouillon', 'squelette', 'maquette'];
const PHASE3_STAGES: TrackStatus[] = ['maquette', 'rec-final'];

function fmtTargetDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

/**
 * Splits leftover track IDs cleanly into 2–3 track batches (e.g. 4 -> 2+2, 5 -> 3+2, 6 -> 3+3).
 */
function chunkIntoTwoOrThree(ids: string[]): string[][] {
  if (ids.length === 0) return [];
  const chunks: string[][] = [];
  let i = 0;
  while (i < ids.length) {
    const remaining = ids.length - i;
    if (remaining === 4) {
      chunks.push(ids.slice(i, i + 2));
      chunks.push(ids.slice(i + 2, i + 4));
      break;
    }
    const size = Math.min(MAX_SPRINT_TRACKS, remaining);
    chunks.push(ids.slice(i, i + size));
    i += size;
  }
  return chunks;
}

/**
 * Builds Phase 3 Rec Final sprints using the EXACT same 2–3 track divisions created in Phase 1.
 * Any track in the project not present in a Phase 1 sprint is neatly batched in groups of 2–3 at the end.
 */
function buildRecSprintsFromPhase1(
  phase1Sprints: MusicProjectSprint[],
  projectTracks: MusicTrack[],
  isTrackAlreadyRec: (trackId: string) => boolean
): MusicProjectSprint[] {
  const validIds = new Set(projectTracks.map((t) => t.id));
  const used = new Set<string>();
  const nowIso = new Date().toISOString();
  const recBatches: MusicProjectSprint[] = [];

  phase1Sprints.forEach((spr, idx) => {
    const ids = spr.trackIds.filter((id) => validIds.has(id) && !used.has(id));
    if (ids.length === 0) return;
    ids.forEach((id) => used.add(id));
    const allRec = ids.every(isTrackAlreadyRec);
    recBatches.push({
      id: uid('rspr'),
      title: spr.title.toLowerCase().includes('rec')
        ? spr.title
        : `Rec final · ${spr.title || `Sprint #${idx + 1}`}`,
      trackIds: ids,
      phase: 'rec',
      createdAt: nowIso,
      ...(allRec ? { completedAt: nowIso } : {}),
    });
  });

  const leftoverIds = projectTracks.map((t) => t.id).filter((id) => !used.has(id));
  const extraChunks = chunkIntoTwoOrThree(leftoverIds);
  extraChunks.forEach((ids, i) => {
    const allRec = ids.every(isTrackAlreadyRec);
    recBatches.push({
      id: uid('rspr'),
      title: `Rec final · Lot #${recBatches.length + i + 1}`,
      trackIds: ids,
      phase: 'rec',
      createdAt: nowIso,
      ...(allRec ? { completedAt: nowIso } : {}),
    });
  });

  return recBatches;
}

export function ProjectSprintView({
  project,
  projectTracks,
  allGroups,
  onOpenTrackDetails,
  onOpenContextMenu,
}: ProjectSprintViewProps) {
  const { state, updateMusicProject, setTrackGroupWorkflow, notify } = useApp();
  const player = useAudioPlayer();

  const byId = useMemo(() => new Map(projectTracks.map((t) => [t.id, t])), [projectTracks]);

  const getTrackContext = (trk: MusicTrack) => {
    const grp = allGroups.find((g) => g.allTrackIds.includes(trk.id));
    const siblings = grp?.versions.map((v) => v.track);
    const workflow = resolveTrackWorkflow(trk, siblings);
    const lyrics = findLinkedLyricsForTrack(trk, state.lyricsDocs, grp?.allTrackIds, siblings);
    const fixCount = lyrics ? countLyricsFixTags(lyrics.content) : 0;
    const allIds = grp && grp.allTrackIds.length > 0 ? grp.allTrackIds : [trk.id];
    const thumb =
      project.coverDataUrl ||
      trk.coverDataUrl ||
      trk.cloudCoverUrl ||
      siblings?.find((s) => Boolean(s.coverDataUrl))?.coverDataUrl ||
      null;
    return { grp, workflow, fixCount, allIds, thumb };
  };

  // ==================== GLOBAL 5-PHASE STATE CALCULATION ====================
  const phaseStats = useMemo(() => {
    let v2Count = 0;
    let v3Count = 0;
    let v5Count = 0;
    let totalFixTags = 0;
    for (const trk of projectTracks) {
      const { workflow, fixCount } = getTrackContext(trk);
      if (isAtLeastMaquette(workflow.status)) v2Count++;
      if (isAtLeastRecFinal(workflow.status)) v3Count++;
      if (isMasteredTrack(workflow.status)) v5Count++;
      totalFixTags += fixCount;
    }
    const total = projectTracks.length;
    return {
      total,
      v2Count,
      v3Count,
      v5Count,
      totalFixTags,
      allV2: total > 0 && v2Count === total,
      allV3: total > 0 && v3Count === total,
      allV5: total > 0 && v5Count === total,
    };
  }, [projectTracks, allGroups, state.lyricsDocs]);

  const maquettesLocked = Boolean(project.maquettesLockedAt) && phaseStats.allV2;
  const globalMixDone = Boolean(project.globalMixDoneAt) && maquettesLocked && phaseStats.allV3;
  const finalSequenceDone = Boolean(project.finalSequenceDoneAt) && globalMixDone;

  // Highest unlocked phase (strict sequential 1 -> 2 -> 3 -> 4 -> 5!)
  const maxUnlockedPhase: StudioPhase = useMemo(() => {
    if (globalMixDone) return 5;
    if (maquettesLocked && phaseStats.allV3) return 4;
    if (maquettesLocked) return 3;
    if (phaseStats.allV2) return 2;
    return 1;
  }, [globalMixDone, maquettesLocked, phaseStats.allV3, phaseStats.allV2]);

  const [viewedPhase, setViewedPhase] = useState<StudioPhase>(maxUnlockedPhase);

  // Automatically advance viewedPhase when a new phase unlocks (or clamp if reverted)
  useEffect(() => {
    setViewedPhase(maxUnlockedPhase);
  }, [maxUnlockedPhase, project.id]);

  // ==================== PHASE 1: SPRINTS MAQUETTES (v0 -> v2) ====================
  const maquetteSprints = project.sprints || [];
  const pendingMaquetteSprints = useMemo(
    () => maquetteSprints.filter((s) => !s.completedAt),
    [maquetteSprints]
  );
  const activeMaquetteSprint = pendingMaquetteSprints[0] || null;
  const completedMaquetteSprints = useMemo(
    () => maquetteSprints.filter((s) => Boolean(s.completedAt)),
    [maquetteSprints]
  );

  const activeMaquetteTracks = useMemo(() => {
    if (!activeMaquetteSprint) return [];
    return activeMaquetteSprint.trackIds
      .map((id) => byId.get(id))
      .filter((t): t is MusicTrack => Boolean(t));
  }, [activeMaquetteSprint, byId]);

  const activeMaquetteV2Count = useMemo(
    () =>
      activeMaquetteTracks.filter((trk) => isAtLeastMaquette(getTrackContext(trk).workflow.status))
        .length,
    [activeMaquetteTracks, allGroups]
  );

  const activeMaquetteAllV2 =
    activeMaquetteSprint !== null &&
    activeMaquetteTracks.length > 0 &&
    activeMaquetteV2Count === activeMaquetteTracks.length;

  // STRICT LOCK: Cannot launch another Phase 1 sprint while active sprint still has tracks < v2!
  const canLaunchNewMaquetteSprint =
    activeMaquetteSprint === null && !phaseStats.allV2 && projectTracks.length > 0;

  // Auto-close lingering active Phase 1 sprint if all its tracks are already >= v2 (e.g. updated from Song Page)
  useEffect(() => {
    if (!activeMaquetteSprint || !activeMaquetteAllV2) return;
    const nowIso = new Date().toISOString();
    const nextSprints = maquetteSprints.map((s) =>
      s.id === activeMaquetteSprint.id ? { ...s, completedAt: nowIso } : s
    );
    updateMusicProject(project.id, { sprints: nextSprints });
  }, [activeMaquetteSprint?.id, activeMaquetteAllV2]);

  // ==================== PHASE 3: SPRINTS REC FINAL (v2 -> v3, SAME DIVISIONS!) ====================
  const recSprints = project.recSprints || [];
  const pendingRecSprints = useMemo(() => recSprints.filter((s) => !s.completedAt), [recSprints]);
  const activeRecSprint = pendingRecSprints[0] || null;
  const upcomingRecSprints = useMemo(() => pendingRecSprints.slice(1), [pendingRecSprints]);
  const completedRecSprints = useMemo(
    () => recSprints.filter((s) => Boolean(s.completedAt)),
    [recSprints]
  );

  const activeRecTracks = useMemo(() => {
    if (!activeRecSprint) return [];
    return activeRecSprint.trackIds
      .map((id) => byId.get(id))
      .filter((t): t is MusicTrack => Boolean(t));
  }, [activeRecSprint, byId]);

  const activeRecV3Count = useMemo(
    () =>
      activeRecTracks.filter((trk) => isAtLeastRecFinal(getTrackContext(trk).workflow.status))
        .length,
    [activeRecTracks, allGroups]
  );

  const activeRecAllV3 =
    activeRecSprint !== null &&
    activeRecTracks.length > 0 &&
    activeRecV3Count === activeRecTracks.length;

  // Auto-complete active Rec sprint immediately when all its tracks reach v3 - Rec!
  useEffect(() => {
    if (!activeRecSprint || !activeRecAllV3) return;
    const nowIso = new Date().toISOString();
    const nextRec = recSprints.map((s) =>
      s.id === activeRecSprint.id ? { ...s, completedAt: nowIso } : s
    );
    updateMusicProject(project.id, { recSprints: nextRec });
  }, [activeRecSprint?.id, activeRecAllV3]);

  // ==================== COMPOSER STATE (PHASE 1 ONLY — STRICTLY LOCKED WHILE SPRINT ACTIVE!) ====================
  const [creating, setCreating] = useState(false);
  const [sprintTitle, setSprintTitle] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [confirmDeleteSprintId, setConfirmDeleteSprintId] = useState<string | null>(null);

  const alreadyBatchedIds = useMemo(() => {
    const set = new Set<string>();
    for (const s of maquetteSprints) {
      for (const tid of s.trackIds) set.add(tid);
    }
    return set;
  }, [maquetteSprints]);

  const sprintCandidates = useMemo(() => {
    return [...projectTracks]
      .filter((t) => !isAtLeastMaquette(getTrackContext(t).workflow.status))
      .sort((a, b) => {
        const aBatched = alreadyBatchedIds.has(a.id) ? 1 : 0;
        const bBatched = alreadyBatchedIds.has(b.id) ? 1 : 0;
        return aBatched - bBatched;
      });
  }, [projectTracks, allGroups, alreadyBatchedIds]);

  const selectedMoods = useMemo(() => {
    return selectedIds
      .map((id) => {
        const trk = byId.get(id);
        return trk ? getTrackContext(trk).workflow.mood : null;
      })
      .filter(Boolean);
  }, [selectedIds, byId, allGroups]);

  const sameMoodWarning =
    selectedIds.length === MAX_SPRINT_TRACKS &&
    selectedMoods.length === MAX_SPRINT_TRACKS &&
    new Set(selectedMoods).size === 1;

  const openPhase1Composer = () => {
    if (!canLaunchNewMaquetteSprint) {
      notify('Termine d’abord toutes les v2 - Maquette du sprint actif avant d’en lancer un autre 🔒');
      return;
    }
    const seedList = sprintCandidates;
    setSelectedIds(seedList.slice(0, Math.min(MAX_SPRINT_TRACKS, seedList.length)).map((t) => t.id));
    setSprintTitle('');
    setTargetDate('');
    setCreating(true);
  };

  const toggleSelectForSprint = (trackId: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(trackId)) return prev.filter((x) => x !== trackId);
      if (prev.length >= MAX_SPRINT_TRACKS) {
        notify(`Maximum ${MAX_SPRINT_TRACKS} titres par sprint (2 à 3 sons conseillés)`);
        return prev;
      }
      return [...prev, trackId];
    });
  };

  const handleCreateMaquetteSprint = () => {
    if (!canLaunchNewMaquetteSprint) {
      notify('Impossible de lancer un autre sprint avant d’avoir terminé toutes les v2 du sprint actif.');
      return;
    }
    if (selectedIds.length === 0) {
      notify('Sélectionne 1 à 3 titres pour ce sprint');
      return;
    }
    const nextNum = maquetteSprints.length + 1;
    const newSprint: MusicProjectSprint = {
      id: uid('spr'),
      title: sprintTitle.trim() || `Sprint #${nextNum}`,
      trackIds: selectedIds.slice(0, MAX_SPRINT_TRACKS),
      phase: 'maquette',
      targetDate: targetDate || undefined,
      createdAt: new Date().toISOString(),
    };
    updateMusicProject(project.id, { sprints: [...maquetteSprints, newSprint] });
    setCreating(false);
    setSprintTitle('');
    setTargetDate('');
    setSelectedIds([]);
    notify(`${newSprint.title} lancé (${newSprint.trackIds.length} titres → objectif v2) ✓`);
  };

  const handlePhase1StatusClick = (trk: MusicTrack, targetStatus: TrackStatus) => {
    const { allIds } = getTrackContext(trk);
    setTrackGroupWorkflow(allIds, { status: targetStatus });

    // Check immediately if this completes the active Phase 1 sprint!
    if (activeMaquetteSprint && isAtLeastMaquette(targetStatus)) {
      const allNowV2 = activeMaquetteTracks.every((item) =>
        item.id === trk.id ? true : isAtLeastMaquette(getTrackContext(item).workflow.status)
      );
      if (allNowV2) {
        const nowIso = new Date().toISOString();
        const nextSprints = maquetteSprints.map((s) =>
          s.id === activeMaquetteSprint.id ? { ...s, completedAt: nowIso } : s
        );
        updateMusicProject(project.id, { sprints: nextSprints });

        const allProjectNowV2 = projectTracks.every((item) =>
          item.id === trk.id ? true : isAtLeastMaquette(getTrackContext(item).workflow.status)
        );
        if (allProjectNowV2) {
          notify('Toutes les maquettes (v2) du projet sont terminées ✓ Passage à l’écoute globale !');
          setViewedPhase(2);
        } else {
          notify(`${activeMaquetteSprint.title} terminé (toutes les v2 atteintes) ✓ Lance le sprint suivant !`);
        }
      }
    }
  };

  const handleReopenMaquetteSprint = (sprintId: string) => {
    if (activeMaquetteSprint) {
      notify('Termine d’abord le sprint actif avant d’en rouvrir un autre.');
      return;
    }
    updateMusicProject(project.id, {
      sprints: maquetteSprints.map((s) =>
        s.id === sprintId ? { ...s, completedAt: undefined } : s
      ),
    });
    notify('Sprint rouvert');
  };

  const handleDeleteMaquetteSprint = (sprintId: string) => {
    updateMusicProject(project.id, {
      sprints: maquetteSprints.filter((s) => s.id !== sprintId),
    });
    notify('Sprint supprimé');
  };

  const handleRemoveTrackFromActiveMaquette = (trackId: string) => {
    if (!activeMaquetteSprint) return;
    const nextIds = activeMaquetteSprint.trackIds.filter((id) => id !== trackId);
    if (nextIds.length === 0) {
      handleDeleteMaquetteSprint(activeMaquetteSprint.id);
      return;
    }
    updateMusicProject(project.id, {
      sprints: maquetteSprints.map((s) =>
        s.id === activeMaquetteSprint.id ? { ...s, trackIds: nextIds } : s
      ),
    });
  };

  // ==================== PHASE 2 ACTION: LOCK MAQUETTES & AUTO-BUILD PHASE 3 REC SPRINTS ====================
  const handleLockMaquettesAndStartRecs = () => {
    if (!phaseStats.allV2) return;
    const nowIso = new Date().toISOString();
    const isTrackRec = (tid: string) => {
      const trk = byId.get(tid);
      return trk ? isAtLeastRecFinal(getTrackContext(trk).workflow.status) : false;
    };
    const generatedRecSprints =
      recSprints.length > 0
        ? recSprints
        : buildRecSprintsFromPhase1(maquetteSprints, projectTracks, isTrackRec);

    updateMusicProject(project.id, {
      maquettesLockedAt: nowIso,
      recSprints: generatedRecSprints,
    });
    notify('Maquettes v2 verrouillées 🔒 — Sprints Rec final prêts avec tes mêmes divisions !');
    setViewedPhase(3);
  };

  const handleUnlockMaquettes = () => {
    updateMusicProject(project.id, {
      maquettesLockedAt: undefined,
      globalMixDoneAt: undefined,
      finalSequenceDoneAt: undefined,
    });
    notify('Maquettes déverrouillées pour peaufinage');
    setViewedPhase(2);
  };

  // ==================== PHASE 3 ACTION: REC FINAL PROGRESSION (SAME 2–3 TRACK DIVISIONS!) ====================
  const handlePhase3StatusClick = (trk: MusicTrack, targetStatus: TrackStatus) => {
    const { allIds, fixCount } = getTrackContext(trk);
    if (targetStatus === 'rec-final' && fixCount > 0) {
      notify(`Attention : encore ${fixCount} balise${fixCount > 1 ? 's' : ''} [FIX] dans le texte !`);
    }
    setTrackGroupWorkflow(allIds, { status: targetStatus });

    if (activeRecSprint && isAtLeastRecFinal(targetStatus)) {
      const allBatchRec = activeRecTracks.every((item) =>
        item.id === trk.id ? true : isAtLeastRecFinal(getTrackContext(item).workflow.status)
      );
      if (allBatchRec) {
        const nowIso = new Date().toISOString();
        const nextRecSprints = recSprints.map((s) =>
          s.id === activeRecSprint.id ? { ...s, completedAt: nowIso } : s
        );
        updateMusicProject(project.id, { recSprints: nextRecSprints });

        const allProjectRec = projectTracks.every((item) =>
          item.id === trk.id ? true : isAtLeastRecFinal(getTrackContext(item).workflow.status)
        );
        if (allProjectRec) {
          notify('Tous les Recs finaux (v3) sont terminés ✓ Passage au Sprint Global Pré-mix + Master !');
          setViewedPhase(4);
        } else {
          notify(`${activeRecSprint.title} terminé ✓ Passage au lot Rec suivant !`);
        }
      }
    }
  };

  const handleRebuildRecBatchesFromPhase1 = () => {
    const isTrackRec = (tid: string) => {
      const trk = byId.get(tid);
      return trk ? isAtLeastRecFinal(getTrackContext(trk).workflow.status) : false;
    };
    const rebuilt = buildRecSprintsFromPhase1(maquetteSprints, projectTracks, isTrackRec);
    updateMusicProject(project.id, { recSprints: rebuilt });
    notify('Lots Rec final synchronisés sur tes divisions de Phase 1 ✓');
  };

  // ==================== PHASE 4 & 5 COMPLETION HANDLERS ====================
  const handleCompleteGlobalMix = () => {
    if (!phaseStats.allV5) {
      notify('Passe tous les titres en v5 - Master avant de passer à l’écoute finale.');
      return;
    }
    updateMusicProject(project.id, {
      globalMixDoneAt: new Date().toISOString(),
      status: 'mix',
    });
    notify('Pré-mix + Master validés ✓ Passage à l’écoute finale & choix de l’ordre !');
    setViewedPhase(5);
  };

  const handleCompleteFinalSequence = () => {
    updateMusicProject(project.id, {
      finalSequenceDoneAt: new Date().toISOString(),
      isTracklistLocked: true,
      status: 'pret',
    });
    notify(`Ordre définitif de « ${project.title} » validé · Projet prêt ✓`);
  };

  // ==================== 5-PHASE STEPPER METADATA ====================
  const PHASES: {
    num: StudioPhase;
    short: string;
    sub: string;
    done: boolean;
    unlocked: boolean;
  }[] = [
    {
      num: 1,
      short: '1. Sprints v2',
      sub: `${phaseStats.v2Count}/${phaseStats.total} v2`,
      done: phaseStats.allV2 && activeMaquetteSprint === null,
      unlocked: true,
    },
    {
      num: 2,
      short: '2. Écoute & Lock',
      sub: maquettesLocked ? 'Verrouillé' : 'Maquettes',
      done: maquettesLocked,
      unlocked: phaseStats.allV2,
    },
    {
      num: 3,
      short: '3. Sprints Rec',
      sub: `${phaseStats.v3Count}/${phaseStats.total} v3`,
      done: maquettesLocked && phaseStats.allV3 && activeRecSprint === null,
      unlocked: maquettesLocked,
    },
    {
      num: 4,
      short: '4. Mix & Master',
      sub: `${phaseStats.v5Count}/${phaseStats.total} v5`,
      done: globalMixDone,
      unlocked: maquettesLocked && phaseStats.allV3,
    },
    {
      num: 5,
      short: '5. Ordre final',
      sub: finalSequenceDone ? 'Prêt ✓' : 'Mixtape',
      done: finalSequenceDone,
      unlocked: globalMixDone,
    },
  ];

  const isPlayingProject =
    player.isPlaying && projectTracks.some((t) => t.id === player.currentTrack?.id);

  if (projectTracks.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 dark:border-zinc-800 p-8 text-center space-y-2">
        <p className="text-sm font-semibold text-slate-800 dark:text-zinc-100">
          Aucun son dans ce projet pour démarrer le Studio
        </p>
        <p className="text-xs text-slate-400">
          Passe en mode <strong>Production</strong> en haut à droite pour ajouter tes titres au projet, puis reviens en mode <strong>Studio</strong> pour lancer tes sprints.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ================= 5-PHASE STRICT SEQUENTIAL STUDIO STEPPER ================= */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
        {PHASES.map((ph) => {
          const active = viewedPhase === ph.num;
          return (
            <button
              key={ph.num}
              type="button"
              disabled={!ph.unlocked}
              onClick={() => {
                if (ph.unlocked) setViewedPhase(ph.num);
              }}
              className={`rounded-2xl border px-3 py-2.5 text-left transition flex flex-col justify-between gap-1 ${
                active
                  ? 'border-[#8C271E] bg-[#8C271E] text-white shadow-sm shadow-[#8C271E]/25 cursor-pointer'
                  : ph.done
                  ? 'border-emerald-500/35 bg-emerald-500/8 dark:bg-emerald-950/25 text-emerald-800 dark:text-emerald-300 hover:border-emerald-500/60 cursor-pointer'
                  : ph.unlocked
                  ? 'border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-[#141010] text-slate-800 dark:text-zinc-100 hover:border-[#8C271E]/40 cursor-pointer'
                  : 'border-slate-200/60 dark:border-zinc-800/70 bg-slate-50/70 dark:bg-zinc-900/40 text-slate-400 dark:text-zinc-600 cursor-not-allowed opacity-70'
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-[11px] font-bold truncate">{ph.short}</span>
                {ph.done ? (
                  <CheckCircle2
                    size={13}
                    className={active ? 'text-white shrink-0' : 'text-emerald-500 shrink-0'}
                  />
                ) : !ph.unlocked ? (
                  <Lock size={11} className="shrink-0 opacity-70" />
                ) : null}
              </div>
              <span
                className={`font-mono text-[10px] truncate ${
                  active ? 'text-white/80' : ph.done ? 'opacity-80' : 'text-slate-400 dark:text-zinc-500'
                }`}
              >
                {ph.sub}
              </span>
            </button>
          );
        })}
      </div>

      {/* ================= PHASE 1: SPRINTS MAQUETTES (v0 -> v2, STRICT LOCK) ================= */}
      {viewedPhase === 1 && (
        <div className="space-y-4">
          {/* Global Phase 1 Progress Strip */}
          <div className="rounded-2xl border border-[#8C271E]/20 bg-[#8C271E]/[0.035] dark:bg-[#8C271E]/[0.08] px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-0.5">
              <p className="text-xs font-bold text-slate-900 dark:text-zinc-100">
                Phase 1 · Sprints Maquettes (objectif : v2 - Maquette)
              </p>
              <p className="text-[11px] text-slate-500 dark:text-zinc-400">
                2 à 3 sons par sprint · dès que toutes les <strong>v2</strong> du sprint actif sont atteintes, le sprint se termine automatiquement.
              </p>
            </div>
            <span className="font-mono text-xs font-bold text-[#8C271E] dark:text-[#E56B5F] shrink-0">
              {phaseStats.v2Count}/{phaseStats.total} en v2
            </span>
          </div>

          {/* ACTIVE PHASE 1 SPRINT */}
          {activeMaquetteSprint ? (
            <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/45 p-4 space-y-3">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25 px-2.5 py-0.5 text-[10px] font-semibold">
                      <Flame size={10} /> Sprint actif (v2)
                    </span>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100">
                      {activeMaquetteSprint.title}
                    </h3>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-1">
                    {activeMaquetteV2Count}/{activeMaquetteTracks.length} titre
                    {activeMaquetteTracks.length > 1 ? 's' : ''} en <strong>v2 - Maquette</strong>
                    {activeMaquetteSprint.targetDate
                      ? ` · échéance ${fmtTargetDate(activeMaquetteSprint.targetDate)}`
                      : ''}
                  </p>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/12 text-amber-700 dark:text-amber-300 px-2.5 py-1 text-[10px] font-semibold">
                    <Lock size={10} /> Autres sprints verrouillés jusqu’à v2
                  </span>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteSprintId(activeMaquetteSprint.id)}
                    title="Supprimer ce sprint"
                    className="p-1.5 rounded-full text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition cursor-pointer"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              <div className="h-1.5 rounded-full bg-slate-200/80 dark:bg-zinc-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#8C271E] transition-all duration-300"
                  style={{
                    width: `${
                      activeMaquetteTracks.length > 0
                        ? Math.round((activeMaquetteV2Count / activeMaquetteTracks.length) * 100)
                        : 0
                    }%`,
                  }}
                />
              </div>

              {/* Active Sprint Track Cards (ONLY v0 -> v1 -> v2!) */}
              <div className="space-y-2 pt-1">
                {activeMaquetteTracks.map((trk) => {
                  const { grp, workflow, fixCount, thumb } = getTrackContext(trk);
                  const stepIdx = TRACK_PIPELINE_ORDER.indexOf(workflow.status);
                  const statusMeta = TRACK_STATUS_META[workflow.status];
                  const moodMeta = workflow.mood ? TRACK_MOOD_META[workflow.mood] : null;
                  const reachedV2 = isAtLeastMaquette(workflow.status);
                  const isCur = player.currentTrack?.id === trk.id;
                  const playing = isCur && player.isPlaying;
                  const openTodos = (trk.todos || []).filter((t) => !t.done).length;

                  return (
                    <div
                      key={trk.id}
                      onContextMenu={(e) => {
                        if (!grp || !onOpenContextMenu) return;
                        e.preventDefault();
                        e.stopPropagation();
                        onOpenContextMenu(e, grp, trk.id, null);
                      }}
                      className={`rounded-2xl border p-3 transition space-y-2.5 ${
                        reachedV2
                          ? 'border-emerald-500/35 bg-emerald-500/5 dark:bg-emerald-950/20'
                          : 'border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-[#141010]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2.5">
                        <button
                          type="button"
                          onClick={() =>
                            isCur
                              ? player.togglePlay()
                              : void player.playTrack(trk, 0, activeMaquetteTracks)
                          }
                          className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer"
                        >
                          <div className="relative h-10 w-10 rounded-xl overflow-hidden bg-slate-200 dark:bg-zinc-800 shrink-0 flex items-center justify-center">
                            {thumb ? (
                              <img src={thumb} alt={trk.title} className="h-full w-full object-cover" />
                            ) : null}
                            <span
                              className={`absolute inset-0 text-white flex items-center justify-center ${
                                playing ? 'bg-[#8C271E]/80' : 'bg-black/35'
                              }`}
                            >
                              {playing ? (
                                <Pause size={13} fill="currentColor" />
                              ) : (
                                <Play size={13} fill="currentColor" className="ml-0.5" />
                              )}
                            </span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm font-semibold text-slate-900 dark:text-zinc-100 truncate">
                                {grp?.baseTitle || trk.manualGroupTitle || trk.title}
                              </p>
                              {reachedV2 && (
                                <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 flex-nowrap overflow-hidden whitespace-nowrap mt-0.5 min-w-0">
                              <span
                                className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${statusMeta.badge}`}
                              >
                                {statusMeta.shortLabel}
                              </span>
                              {moodMeta && (
                                <span
                                  className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${moodMeta.badge}`}
                                >
                                  {moodMeta.emoji}
                                </span>
                              )}
                              {fixCount > 0 && (
                                <span className="shrink-0 rounded-full bg-rose-500/12 text-rose-600 dark:text-rose-400 px-1.5 py-0.5 font-mono text-[10px] font-semibold">
                                  [FIX] ×{fixCount}
                                </span>
                              )}
                              {openTodos > 0 && (
                                <span className="shrink-0 font-mono text-[10px] text-slate-400">
                                  {openTodos} tâche{openTodos > 1 ? 's' : ''}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>

                        <div className="flex items-center gap-1 shrink-0">
                          {onOpenTrackDetails && (
                            <button
                              type="button"
                              onClick={() => onOpenTrackDetails(trk.id)}
                              title="Ouvrir la page du son"
                              className="p-1.5 rounded-full text-slate-400 hover:text-slate-900 dark:hover:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer"
                            >
                              <ChevronRight size={15} />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleRemoveTrackFromActiveMaquette(trk.id)}
                            title="Retirer du sprint"
                            className="p-1.5 rounded-full text-slate-400 hover:text-rose-500 cursor-pointer"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>

                      {/* Focused Phase 1 Pipeline Bar: v0 - Brouillon -> v1 - Squelette -> v2 - Maquette */}
                      <div className="grid grid-cols-3 gap-1.5">
                        {PHASE1_STAGES.map((st, idx) => {
                          const meta = TRACK_STATUS_META[st];
                          const active = stepIdx === idx;
                          const done = stepIdx > idx;
                          const clickable = stepIdx <= 2 ? Math.abs(idx - stepIdx) <= 1 : false;
                          return (
                            <button
                              key={st}
                              type="button"
                              disabled={!clickable}
                              onClick={() => {
                                if (!clickable || active) return;
                                handlePhase1StatusClick(trk, st);
                              }}
                              className={`rounded-xl py-1.5 text-[11px] font-semibold text-center transition ${
                                active
                                  ? st === 'maquette'
                                    ? 'bg-emerald-600 text-white shadow-xs'
                                    : 'bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25'
                                  : done
                                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                  : 'bg-slate-100 dark:bg-zinc-900 text-slate-400'
                              } ${clickable && !active ? 'cursor-pointer hover:opacity-90' : 'cursor-default opacity-80'}`}
                            >
                              {meta.shortLabel}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : phaseStats.allV2 ? (
            <div className="rounded-2xl border border-emerald-500/35 bg-emerald-500/8 dark:bg-emerald-950/25 p-5 text-center space-y-3">
              <CheckCircle2 size={24} className="mx-auto text-emerald-500" />
              <div className="space-y-1">
                <p className="text-sm font-bold text-slate-900 dark:text-zinc-100">
                  Tous les sons du projet sont en v2 - Maquette ✓
                </p>
                <p className="text-xs text-slate-500 dark:text-zinc-400">
                  La Phase 1 est terminée. Passe maintenant à l’écoute globale & peaufinage pour verrouiller tes maquettes.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewedPhase(2)}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#8C271E] hover:bg-[#A32E24] text-white px-4 py-2 text-xs font-semibold shadow-xs shadow-[#8C271E]/25 transition cursor-pointer"
              >
                <Headphones size={13} /> Aller à l’écoute globale (Phase 2) →
              </button>
            </div>
          ) : !creating ? (
            <div className="rounded-2xl border border-dashed border-[#8C271E]/30 bg-[#8C271E]/[0.02] p-6 text-center space-y-3">
              <p className="text-xs font-semibold text-slate-800 dark:text-zinc-100">
                Prêt pour le prochain sprint Maquette ({sprintCandidates.length} son
                {sprintCandidates.length > 1 ? 's' : ''} restant
                {sprintCandidates.length > 1 ? 's' : ''} à passer en v2)
              </p>
              <p className="text-[11px] text-slate-400 max-w-md mx-auto">
                Choisis <strong>2 à 3 titres</strong> pour ce sprint. Ces mêmes divisions seront réutilisées automatiquement lors des sprints Rec final (Phase 3).
              </p>
              <button
                type="button"
                disabled={!canLaunchNewMaquetteSprint}
                onClick={openPhase1Composer}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#8C271E] hover:bg-[#A32E24] text-white shadow-xs shadow-[#8C271E]/25 px-4 py-2 text-xs font-semibold disabled:opacity-35 transition cursor-pointer"
              >
                <Plus size={13} /> Lancer un sprint (2 à 3 titres → v2)
              </button>
            </div>
          ) : null}

          {/* PHASE 1 SPRINT COMPOSER (ONLY accessible when NO active sprint is running!) */}
          {creating && canLaunchNewMaquetteSprint && (
            <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/50 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-bold text-slate-900 dark:text-zinc-100">
                  Composer le Sprint #{maquetteSprints.length + 1} ({selectedIds.length}/
                  {MAX_SPRINT_TRACKS} titres · objectif v2)
                </h3>
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  className="text-[11px] text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  value={sprintTitle}
                  onChange={(e) => setSprintTitle(e.target.value)}
                  placeholder={`Sprint #${maquetteSprints.length + 1} (optionnel)`}
                  className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-xs outline-none focus:border-[#8C271E]/50"
                />
                <div className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-1.5">
                  <Calendar size={12} className="text-slate-400 shrink-0" />
                  <input
                    type="date"
                    value={targetDate}
                    onChange={(e) => setTargetDate(e.target.value)}
                    className="flex-1 bg-transparent font-mono text-[11px] outline-none"
                  />
                </div>
              </div>

              {sameMoodWarning && (
                <p className="rounded-xl bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
                  Conseil : tes 3 titres ont tous la même ambiance. Alterner les ambiances garde l’oreille fraîche.
                </p>
              )}

              <div className="max-h-60 overflow-y-auto space-y-1 pr-0.5">
                {sprintCandidates.map((trk) => {
                  const { grp, workflow } = getTrackContext(trk);
                  const selected = selectedIds.includes(trk.id);
                  const stMeta = TRACK_STATUS_META[workflow.status];
                  const moodMeta = workflow.mood ? TRACK_MOOD_META[workflow.mood] : null;
                  return (
                    <button
                      key={trk.id}
                      type="button"
                      onClick={() => toggleSelectForSprint(trk.id)}
                      className={`w-full flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-xs transition cursor-pointer ${
                        selected
                          ? 'bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25'
                          : 'bg-white dark:bg-zinc-900 border border-slate-200/70 dark:border-zinc-800 text-slate-800 dark:text-zinc-100 hover:border-[#8C271E]/40'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span
                          className={`h-4 w-4 rounded-full border flex items-center justify-center shrink-0 ${
                            selected
                              ? 'border-white/50 bg-white/20'
                              : 'border-slate-300 dark:border-zinc-700'
                          }`}
                        >
                          {selected && <Check size={10} />}
                        </span>
                        <span className="font-medium truncate">
                          {grp?.baseTitle || trk.manualGroupTitle || trk.title}
                        </span>
                        {moodMeta && <span className="text-[11px] shrink-0">{moodMeta.emoji}</span>}
                      </div>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium shrink-0 ${
                          selected ? 'bg-white/20 text-white' : stMeta.badge
                        }`}
                      >
                        {stMeta.shortLabel}
                      </span>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                disabled={selectedIds.length === 0}
                onClick={handleCreateMaquetteSprint}
                className="w-full rounded-xl bg-[#8C271E] hover:bg-[#A32E24] text-white shadow-xs shadow-[#8C271E]/25 py-2.5 text-xs font-semibold disabled:opacity-35 transition cursor-pointer"
              >
                Lancer ce sprint ({selectedIds.length} titre{selectedIds.length > 1 ? 's' : ''} → v2)
              </button>
            </div>
          )}

          {/* COMPLETED PHASE 1 SPRINTS (SAVED DIVISIONS FOR PHASE 3!) */}
          {completedMaquetteSprints.length > 0 && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowHistory((v) => !v)}
                className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 transition cursor-pointer"
              >
                <CheckCircle2 size={12} className="text-emerald-500" />
                <span>
                  Sprints v2 terminés ({completedMaquetteSprints.length} · divisions conservées pour Phase 3)
                </span>
                {showHistory ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>

              {showHistory && (
                <div className="mt-2 space-y-1.5">
                  {completedMaquetteSprints.map((spr) => (
                    <div
                      key={spr.id}
                      className="rounded-xl border border-slate-200/70 dark:border-zinc-800/80 px-3 py-2 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-700 dark:text-zinc-200 truncate">
                          {spr.title}{' '}
                          <span className="font-normal text-slate-400">
                            · {spr.trackIds.length} titre{spr.trackIds.length > 1 ? 's' : ''}
                          </span>
                        </p>
                        <p className="text-[10px] text-slate-400 truncate">
                          {spr.trackIds
                            .map((tid) => {
                              const t = byId.get(tid);
                              return t ? getTrackContext(t).grp?.baseTitle || t.title : null;
                            })
                            .filter(Boolean)
                            .join(', ')}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {!activeMaquetteSprint && !maquettesLocked && (
                          <button
                            type="button"
                            onClick={() => handleReopenMaquetteSprint(spr.id)}
                            title="Rouvrir ce sprint"
                            className="p-1 text-slate-400 hover:text-[#8C271E] cursor-pointer"
                          >
                            <RotateCcw size={12} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDeleteMaquetteSprint(spr.id)}
                          title="Supprimer"
                          className="p-1 text-slate-400 hover:text-rose-500 cursor-pointer"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ================= PHASE 2: ÉCOUTE GLOBALE & PEAUFINAGE (VERROUILLAGE MAQUETTES v2) ================= */}
      {viewedPhase === 2 && (
        <div className="space-y-4">
          <div
            className={`rounded-2xl border p-4 space-y-3 ${
              maquettesLocked
                ? 'border-emerald-500/40 bg-emerald-500/8 dark:bg-emerald-950/25'
                : 'border-[#8C271E]/25 bg-[#8C271E]/[0.04] dark:bg-[#8C271E]/[0.09]'
            }`}
          >
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#8C271E] text-white px-2.5 py-0.5 text-[10px] font-semibold">
                    <Headphones size={10} /> Phase 2 · Écoute globale & Peaufinage
                  </span>
                  {maquettesLocked && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 text-[10px] font-semibold">
                      <Lock size={10} /> Maquettes verrouillées
                    </span>
                  )}
                </div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100">
                  Écoute complète des {projectTracks.length} maquettes (v2) avant verrouillage
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-zinc-400">
                  Réécoute tout le projet d’une traite, règle les derniers détails d’écriture ([FIX]) et de placement, puis verrouille tes maquettes pour lancer les Sprints Rec final.
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    if (isPlayingProject) player.togglePlay();
                    else if (projectTracks.length > 0) void player.playTrack(projectTracks[0], 0, projectTracks);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#8C271E] hover:bg-[#A32E24] text-white px-4 py-2 text-xs font-semibold shadow-xs shadow-[#8C271E]/25 transition cursor-pointer"
                >
                  {isPlayingProject ? (
                    <Pause size={13} fill="currentColor" />
                  ) : (
                    <Play size={13} fill="currentColor" className="ml-0.5" />
                  )}
                  <span>{isPlayingProject ? 'Pause' : 'Écouter toutes les maquettes'}</span>
                </button>

                {maquettesLocked ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setViewedPhase(3)}
                      className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 text-xs font-semibold transition cursor-pointer"
                    >
                      <Mic2 size={13} /> Aller aux Recs finaux →
                    </button>
                    <button
                      type="button"
                      onClick={handleUnlockMaquettes}
                      title="Déverrouiller les maquettes pour continuer à peaufiner"
                      className="inline-flex items-center gap-1 rounded-full border border-slate-200 dark:border-zinc-700 px-3 py-2 text-xs font-medium text-slate-600 dark:text-zinc-300 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                    >
                      <Unlock size={12} /> Déverrouiller
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={!phaseStats.allV2}
                    onClick={handleLockMaquettesAndStartRecs}
                    className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 text-xs font-semibold shadow-xs disabled:opacity-40 transition cursor-pointer"
                  >
                    <Lock size={13} /> Verrouiller les maquettes (v2) → Sprints Rec
                  </button>
                )}
              </div>
            </div>

            {phaseStats.totalFixTags > 0 && (
              <div className="rounded-xl bg-amber-500/12 border border-amber-500/25 px-3 py-2 flex items-center gap-2 text-xs text-amber-800 dark:text-amber-200">
                <AlertTriangle size={14} className="shrink-0" />
                <span>
                  Il reste <strong>{phaseStats.totalFixTags} balise{phaseStats.totalFixTags > 1 ? 's' : ''} [FIX]</strong> dans tes textes — profites-en pour les peaufiner avant de verrouiller les maquettes !
                </span>
              </div>
            )}
          </div>

          {/* Review list of maquettes (NOT a tracklist reorder view — focused on audition & [FIX] audit!) */}
          <div className="space-y-1.5">
            {projectTracks.map((trk) => {
              const { grp, workflow, fixCount } = getTrackContext(trk);
              const isCur = player.currentTrack?.id === trk.id;
              const playing = isCur && player.isPlaying;
              const stMeta = TRACK_STATUS_META[workflow.status];
              return (
                <div
                  key={trk.id}
                  className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-[#141010] px-3.5 py-2.5 flex items-center justify-between gap-2.5"
                >
                  <button
                    type="button"
                    onClick={() =>
                      isCur ? player.togglePlay() : void player.playTrack(trk, 0, projectTracks)
                    }
                    className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer"
                  >
                    <span
                      className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 transition ${
                        playing
                          ? 'bg-[#8C271E] text-white'
                          : 'bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 hover:bg-[#8C271E]/15 hover:text-[#8C271E]'
                      }`}
                    >
                      {playing ? (
                        <Pause size={12} fill="currentColor" />
                      ) : (
                        <Play size={12} fill="currentColor" className="ml-0.5" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-sm font-semibold truncate ${
                          isCur
                            ? 'text-[#8C271E] dark:text-[#E56B5F]'
                            : 'text-slate-900 dark:text-zinc-100'
                        }`}
                      >
                        {grp?.baseTitle || trk.manualGroupTitle || trk.title}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${stMeta.badge}`}>
                          {stMeta.shortLabel}
                        </span>
                        {fixCount > 0 ? (
                          <span className="rounded-full bg-rose-500/12 text-rose-600 dark:text-rose-400 px-1.5 py-0.5 font-mono text-[10px] font-semibold">
                            [FIX] ×{fixCount} à régler
                          </span>
                        ) : (
                          <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                            Texte clean ✓
                          </span>
                        )}
                      </div>
                    </div>
                  </button>

                  {onOpenTrackDetails && (
                    <button
                      type="button"
                      onClick={() => onOpenTrackDetails(trk.id)}
                      className="rounded-full border border-slate-200 dark:border-zinc-800 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:text-zinc-300 hover:border-[#8C271E]/50 hover:text-[#8C271E] transition cursor-pointer shrink-0"
                    >
                      Peaufiner
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ================= PHASE 3: SPRINTS REC FINAL (v2 -> v3, MÊMES DIVISIONS 2-3 SONS!) ================= */}
      {viewedPhase === 3 && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-[#8C271E]/20 bg-[#8C271E]/[0.035] dark:bg-[#8C271E]/[0.08] px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-0.5">
              <p className="text-xs font-bold text-slate-900 dark:text-zinc-100">
                Phase 3 · Sprints Rec final (objectif : v3 - Rec · mêmes divisions 2–3 sons)
              </p>
              <p className="text-[11px] text-slate-500 dark:text-zinc-400">
                Enregistre lot par lot avec exactement les mêmes groupes que tes sprints de maquettes. Passage automatique au lot suivant dès que tous les sons sont en <strong>v3 - Rec</strong>.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="font-mono text-xs font-bold text-[#8C271E] dark:text-[#E56B5F]">
                {phaseStats.v3Count}/{phaseStats.total} en v3
              </span>
              <button
                type="button"
                onClick={handleRebuildRecBatchesFromPhase1}
                title="Resynchroniser les lots Rec final sur les divisions de Phase 1"
                className="rounded-full border border-slate-200 dark:border-zinc-700 px-2.5 py-1 text-[10px] font-medium text-slate-500 hover:text-[#8C271E] cursor-pointer"
              >
                Sync divisions
              </button>
            </div>
          </div>

          {activeRecSprint ? (
            <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/45 p-4 space-y-3">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25 px-2.5 py-0.5 text-[10px] font-semibold">
                      <Mic2 size={10} /> Sprint Rec actif
                    </span>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100">
                      {activeRecSprint.title}
                    </h3>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-1">
                    {activeRecV3Count}/{activeRecTracks.length} titre
                    {activeRecTracks.length > 1 ? 's' : ''} enregistré
                    {activeRecTracks.length > 1 ? 's' : ''} en <strong>v3 - Rec</strong>
                  </p>
                </div>

                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/12 text-amber-700 dark:text-amber-300 px-2.5 py-1 text-[10px] font-semibold">
                  <Lock size={10} /> Lot suivant verrouillé jusqu’à v3
                </span>
              </div>

              <div className="h-1.5 rounded-full bg-slate-200/80 dark:bg-zinc-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#8C271E] transition-all duration-300"
                  style={{
                    width: `${
                      activeRecTracks.length > 0
                        ? Math.round((activeRecV3Count / activeRecTracks.length) * 100)
                        : 0
                    }%`,
                  }}
                />
              </div>

              <div className="space-y-2 pt-1">
                {activeRecTracks.map((trk) => {
                  const { grp, workflow, fixCount, thumb } = getTrackContext(trk);
                  const stepIdx = TRACK_PIPELINE_ORDER.indexOf(workflow.status);
                  const reachedV3 = isAtLeastRecFinal(workflow.status);
                  const isCur = player.currentTrack?.id === trk.id;
                  const playing = isCur && player.isPlaying;
                  const moodMeta = workflow.mood ? TRACK_MOOD_META[workflow.mood] : null;

                  return (
                    <div
                      key={trk.id}
                      className={`rounded-2xl border p-3 transition space-y-2.5 ${
                        reachedV3
                          ? 'border-emerald-500/35 bg-emerald-500/5 dark:bg-emerald-950/20'
                          : 'border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-[#141010]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2.5">
                        <button
                          type="button"
                          onClick={() =>
                            isCur
                              ? player.togglePlay()
                              : void player.playTrack(trk, 0, activeRecTracks)
                          }
                          className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer"
                        >
                          <div className="relative h-10 w-10 rounded-xl overflow-hidden bg-slate-200 dark:bg-zinc-800 shrink-0 flex items-center justify-center">
                            {thumb ? (
                              <img src={thumb} alt={trk.title} className="h-full w-full object-cover" />
                            ) : null}
                            <span
                              className={`absolute inset-0 text-white flex items-center justify-center ${
                                playing ? 'bg-[#8C271E]/80' : 'bg-black/35'
                              }`}
                            >
                              {playing ? (
                                <Pause size={13} fill="currentColor" />
                              ) : (
                                <Play size={13} fill="currentColor" className="ml-0.5" />
                              )}
                            </span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm font-semibold text-slate-900 dark:text-zinc-100 truncate">
                                {grp?.baseTitle || trk.manualGroupTitle || trk.title}
                              </p>
                              {reachedV3 && (
                                <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span
                                className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${TRACK_STATUS_META[workflow.status].badge}`}
                              >
                                {TRACK_STATUS_META[workflow.status].shortLabel}
                              </span>
                              {moodMeta && (
                                <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${moodMeta.badge}`}>
                                  {moodMeta.emoji}
                                </span>
                              )}
                              {fixCount > 0 && (
                                <span className="rounded-full bg-rose-500/12 text-rose-600 dark:text-rose-400 px-1.5 py-0.5 font-mono text-[10px] font-semibold">
                                  [FIX] ×{fixCount}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>

                        {onOpenTrackDetails && (
                          <button
                            type="button"
                            onClick={() => onOpenTrackDetails(trk.id)}
                            title="Ouvrir la page du son"
                            className="p-1.5 rounded-full text-slate-400 hover:text-slate-900 dark:hover:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer shrink-0"
                          >
                            <ChevronRight size={15} />
                          </button>
                        )}
                      </div>

                      {/* Focused Phase 3 Bar: v2 - Maquette -> v3 - Rec */}
                      <div className="grid grid-cols-2 gap-1.5">
                        {PHASE3_STAGES.map((st) => {
                          const meta = TRACK_STATUS_META[st];
                          const targetIdx = TRACK_PIPELINE_ORDER.indexOf(st);
                          const active = stepIdx === targetIdx;
                          const done = stepIdx > targetIdx;
                          return (
                            <button
                              key={st}
                              type="button"
                              onClick={() => {
                                if (!active) handlePhase3StatusClick(trk, st);
                              }}
                              className={`rounded-xl py-1.5 text-[11px] font-semibold text-center transition cursor-pointer ${
                                active
                                  ? st === 'rec-final'
                                    ? 'bg-emerald-600 text-white shadow-xs'
                                    : 'bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25'
                                  : done
                                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                  : 'bg-slate-100 dark:bg-zinc-900 text-slate-500 hover:border-[#8C271E]/40'
                              }`}
                            >
                              {meta.shortLabel}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : phaseStats.allV3 ? (
            <div className="rounded-2xl border border-emerald-500/35 bg-emerald-500/8 dark:bg-emerald-950/25 p-5 text-center space-y-3">
              <CheckCircle2 size={24} className="mx-auto text-emerald-500" />
              <div className="space-y-1">
                <p className="text-sm font-bold text-slate-900 dark:text-zinc-100">
                  Tous les Recs finaux (v3) sont terminés ✓
                </p>
                <p className="text-xs text-slate-500 dark:text-zinc-400">
                  Tu peux maintenant passer au Sprint Global Pré-mix + Master de tous les sons en même temps pour garantir l’homogénéité.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewedPhase(4)}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#8C271E] hover:bg-[#A32E24] text-white px-4 py-2 text-xs font-semibold shadow-xs shadow-[#8C271E]/25 transition cursor-pointer"
              >
                <Sliders size={13} /> Lancer le Sprint Global Pré-mix + Master →
              </button>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 dark:border-zinc-800 p-6 text-center space-y-3">
              <p className="text-xs text-slate-500 dark:text-zinc-400">
                Génère automatiquement les lots Rec final à partir de tes divisions de Phase 1.
              </p>
              <button
                type="button"
                onClick={handleRebuildRecBatchesFromPhase1}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#8C271E] text-white px-4 py-2 text-xs font-semibold cursor-pointer"
              >
                <Mic2 size={13} /> Initialiser les sprints Rec final
              </button>
            </div>
          )}

          {/* Locked Queue of Remaining Rec Sprints (same Phase 1 divisions!) */}
          {upcomingRecSprints.length > 0 && (
            <div className="space-y-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Lots Rec suivants ({upcomingRecSprints.length} · verrouillés jusqu’à fin du lot actif)
              </span>
              <div className="space-y-1.5">
                {upcomingRecSprints.map((spr) => (
                  <div
                    key={spr.id}
                    className="rounded-2xl border border-slate-200/70 dark:border-zinc-800/80 bg-slate-50/50 dark:bg-zinc-900/30 p-3 flex items-center justify-between gap-2 opacity-75"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Lock size={11} className="text-slate-400 shrink-0" />
                        <p className="text-xs font-semibold text-slate-700 dark:text-zinc-200 truncate">
                          {spr.title}
                        </p>
                      </div>
                      <p className="text-[11px] text-slate-400 truncate mt-0.5">
                        {spr.trackIds
                          .map((tid) => {
                            const t = byId.get(tid);
                            return t ? getTrackContext(t).grp?.baseTitle || t.title : null;
                          })
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    <span className="font-mono text-[10px] text-slate-400 shrink-0">
                      {spr.trackIds.length} titres
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {completedRecSprints.length > 0 && (
            <p className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
              <CheckCircle2 size={12} />
              {completedRecSprints.length} lot{completedRecSprints.length > 1 ? 's' : ''} Rec final terminé
              {completedRecSprints.length > 1 ? 's' : ''}
            </p>
          )}
        </div>
      )}

      {/* ================= PHASE 4: SPRINT GLOBAL PRÉ-MIX + MASTER (TOUS LES SONS ENSEMBLE) ================= */}
      {viewedPhase === 4 && (
        <ProjectHarmonizationView
          project={project}
          projectTracks={projectTracks}
          allGroups={allGroups}
          mode="global-mix"
          onCompleteGlobalMix={handleCompleteGlobalMix}
          onOpenTrackDetails={onOpenTrackDetails}
          onOpenContextMenu={onOpenContextMenu}
        />
      )}

      {/* ================= PHASE 5: ÉCOUTE FINALE & CHOIX DE L'ORDRE DE LA MIXTAPE ================= */}
      {viewedPhase === 5 && (
        <ProjectHarmonizationView
          project={project}
          projectTracks={projectTracks}
          allGroups={allGroups}
          mode="final-sequence"
          onCompleteFinalSequence={handleCompleteFinalSequence}
          onOpenTrackDetails={onOpenTrackDetails}
          onOpenContextMenu={onOpenContextMenu}
        />
      )}

      <AppleConfirmDialog
        open={Boolean(confirmDeleteSprintId)}
        title="Supprimer ce sprint ?"
        description="Les morceaux restent dans le projet, seul ce lot de sprint sera retiré."
        confirmLabel="Supprimer"
        destructive
        onConfirm={() => {
          if (confirmDeleteSprintId) handleDeleteMaquetteSprint(confirmDeleteSprintId);
          setConfirmDeleteSprintId(null);
        }}
        onCancel={() => setConfirmDeleteSprintId(null)}
      />
    </div>
  );
}
