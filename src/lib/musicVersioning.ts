import type { MusicProject, MusicTrack } from '../types';

export interface ParsedTrackVersion {
  groupKey: string;
  baseTitle: string;
  versionLabel: string;
  /** Numeric version tuple when applicable (e.g. [3, 2] for v3.2) */
  numericParts: number[] | null;
  /** True when the track has no suffix at all */
  isBaseOriginal: boolean;
  /** True when this file is the song's instrumental/prod (e.g. "Project_306_prod.mp3") */
  isProd: boolean;
  /** Composite version score used when timestamps are close (same upload batch) */
  versionScore: number;
}

export interface TrackVersionEntry {
  track: MusicTrack;
  parsed: ParsedTrackVersion;
  versionLabel: string;
  isLatest: boolean;
  timestampMs: number;
}

export interface TrackGroup {
  groupKey: string;
  baseTitle: string;
  latestTrack: MusicTrack;
  latestVersionLabel: string;
  versions: TrackVersionEntry[];
  /** Dedicated linked prod/instrumental track (e.g. "Project_306_prod.mp3") when available */
  prodTrack: MusicTrack | null;
  prodTracks: TrackVersionEntry[];
  /** Every track ID in this group (vocal versions + prod tracks) */
  allTrackIds: string[];
  /** Detected Google Drive year/season folder e.g. "2024/2025" */
  yearFolder?: string;
  isFavorite: boolean;
  latestTimestampMs: number;
  hasMultipleVersions: boolean;
  todoDone: number;
  todoTotal: number;
  description?: string;
}

const STUDIO_STAGE_SCORES: Record<string, number> = {
  master: 95,
  mastered: 95,
  final: 85,
  fin: 85,
  mix: 70,
  mixed: 70,
  mixdown: 70,
  edit: 62,
  remix: 62,
  extended: 60,
  clean: 58,
  dirty: 58,
  radio: 58,
  vocals: 55,
  vox: 55,
  acapella: 52,
  prod: 50,
  beat: 45,
  instru: 45,
  instrumental: 45,
  demo: 40,
  rough: 35,
  draft: 30,
  idee: 25,
  idea: 25,
  test: 22,
  new: 64,
  old: 15,
  bis: 63,
  alt: 56,
  copy: 5,
  copie: 5,
};

const STUDIO_KEYWORDS_RE =
  /[\s_-]+(master|mastered|final|fin|mix|mixed|mixdown|prod|beat|instru|instrumental|demo|rough|draft|vox|vocals|acapella|edit|remix|clean|dirty|radio|extended|bis|test|new|old|alt|copie|copy)$/i;

const PAREN_SUFFIX_RE =
  /\s*[\(\[]\s*((?:[+-]?\d+(?:\.\d+)?|v\d+(?:\.\d+)*|copy|copie|final|mix|mixed|master|mastered|demo|bis|new|old|alt|edit|remix|prod|instru|clean|dirty|version|ver|pitch)(?:[\s._-]+[+-]?\w+(?:\.\d+)?){0,2})\s*[\)\]]$/i;

const EXPLICIT_VERSION_RE = /[\s_-]+(?:v|ver|version|rev)[\s._-]*(\d+(?:\.\d+)*)$/i;

const SEPARATED_NUM_RE = /[\s_-]+(\d{1,2}(?:\.\d+)*)$/;

const ATTACHED_NUM_RE = /^(.+?[a-zA-ZÀ-ÿ]{2,})(\d{1,2}(?:\.\d+)?)$/;

const ATTACHED_NUM_IGNORE = /(?:mp3|mp4|wav|m4a|3d|4k|808|909)$/i;

const SONG_PROD_SUFFIX_RE =
  /(?:^|[\s_-])(?:prod|instru|instrumental)(?:[\s._-]*(?:v?\d+(?:\.\d+)?))?$|[\(\[]\s*(?:prod|instru|instrumental)\s*[\)\]]$/i;

export function isProdSuffixText(text: string): boolean {
  return SONG_PROD_SUFFIX_RE.test((text || '').trim());
}

function stripAudioExtension(raw: string): string {
  return raw.replace(/\.(mp3|wav|m4a|flac|aac|ogg)$/i, '').trim();
}

function normalizeDisplayTitle(raw: string): string {
  return raw
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeGroupKey(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseNumericTuple(raw: string): number[] | null {
  const cleaned = raw.replace(/^[+-]/, '').replace(/^v(?:er(?:sion)?)?[._ -]?/i, '').trim();
  if (!/^\d+(?:\.\d+)*$/.test(cleaned)) return null;
  return cleaned.split('.').map((n) => parseInt(n, 10));
}

function tupleToFloat(parts: number[]): number {
  let score = 0;
  for (let i = 0; i < parts.length; i++) {
    score += parts[i] / Math.pow(100, i);
  }
  return score;
}

/**
 * Intelligently parses any track filename or title into a project/song group + version metadata.
 * Handles:
 * - "Copie de Project_90.mp3"       -> Project 90 (Copie)
 * - "Project_306_3.2.mp3"           -> Project 306 (v3.2)
 * - "Project_273_tequila brune 5"   -> Project 273 (tequila brune 5)
 * - "FOLIE", "FOLIE MIX", "FOLIE MIX FINAL", "FOLIE MIX FINAL (+1)", "FOLIE MIX FINAL (+2)"
 *                                   -> ALL grouped under "FOLIE"
 * - "JUSTE UN SOIR2", "JUSTE UN SOIR4"
 *                                   -> ALL grouped under "JUSTE UN SOIR" (v2, v4)
 * - Manual overrides (`manualGroupKey`, `manualGroupTitle`, `manualVersionLabel`)
 */
export function parseTrackVersion(
  track: Pick<
    MusicTrack,
    'title' | 'sourceFilename' | 'manualGroupKey' | 'manualGroupTitle' | 'manualVersionLabel'
  >
): ParsedTrackVersion {
  const rawOriginal = stripAudioExtension(track.sourceFilename || track.title || 'Sans titre');

  // 0. Strip Google Drive copy prefix ("Copie de ...", "Copy of ...") BEFORE pattern matching!
  let working = rawOriginal;
  let isCopy = false;
  const copyPrefixRe = /^(?:copie\s+de\s+|copy\s+of\s+)/i;
  while (copyPrefixRe.test(working)) {
    working = working.replace(copyPrefixRe, '').trim();
    isCopy = true;
  }

  // 1. Primary pattern: Project_XXX or Projet XXX (with optional suffix)
  const projectMatch = working.match(/^(project|projet)[\s_-]*(\d{1,4})(?:[\s_-]+(.+))?$/i);
  if (projectMatch) {
    const num = projectMatch[2];
    const suffix = projectMatch[3]?.trim();
    const autoBaseTitle = `Project ${num}`;
    const autoGroupKey = `project_${num}`;

    let versionLabel = isCopy ? 'Copie' : 'Original';
    let numericParts: number[] | null = [0];
    let versionScore = isCopy ? 5 : 10;
    let isProd = false;

    if (suffix) {
      const cleanedSuffix = normalizeDisplayTitle(suffix);
      isProd = isProdSuffixText(cleanedSuffix);
      const exactNum = parseNumericTuple(cleanedSuffix);
      if (exactNum) {
        versionLabel = `v${exactNum.join('.')}${isCopy ? ' (copie)' : ''}`;
        numericParts = exactNum;
        versionScore = 65 + tupleToFloat(exactNum);
      } else {
        versionLabel = `${cleanedSuffix}${isCopy ? ' (copie)' : ''}`;
        const trailingNum = cleanedSuffix.match(/(\d+(?:\.\d+)*)$/);
        if (trailingNum) {
          numericParts = trailingNum[1].split('.').map((n) => parseInt(n, 10));
          versionScore = 65 + tupleToFloat(numericParts);
        } else {
          numericParts = null;
          const lowerSuf = cleanedSuffix.toLowerCase();
          versionScore = STUDIO_STAGE_SCORES[lowerSuf] ?? 55;
        }
      }
    }

    return applyManualOverrides(track, {
      groupKey: autoGroupKey,
      baseTitle: autoBaseTitle,
      versionLabel,
      numericParts,
      isBaseOriginal: !suffix && !isCopy,
      isProd,
      versionScore,
    });
  }

  // 2. Iterative right-to-left peeling for general song titles
  //    Handles stacked suffixes like "FOLIE MIX FINAL (+2)" and attached digits like "JUSTE UN SOIR4"
  const peeledTokens: string[] = [];
  let numericParts: number[] | null = null;
  let scoreAcc = 0;

  for (let iter = 0; iter < 6; iter++) {
    let matched = false;

    // 2a. Parenthetical/bracketed tag e.g. (+2), (+1), (2), (final), (copy)
    const parenMatch = working.match(PAREN_SUFFIX_RE);
    if (parenMatch) {
      const rest = working.slice(0, parenMatch.index).trim();
      if (rest.replace(/[^a-zA-ZÀ-ÿ0-9]/g, '').length >= 2) {
        const inner = parenMatch[1].trim();
        const parenNum = parseNumericTuple(inner);
        if (parenNum) {
          const isNeg = inner.startsWith('-');
          const val = tupleToFloat(parenNum) * (isNeg ? -1 : 1);
          scoreAcc += 10 + val;
          if (!numericParts) numericParts = parenNum;
          peeledTokens.unshift(`(${inner})`);
        } else {
          const k = inner.toLowerCase();
          scoreAcc += STUDIO_STAGE_SCORES[k] ?? 20;
          peeledTokens.unshift(`(${inner})`);
        }
        working = rest;
        matched = true;
        continue;
      }
    }

    // 2b. Explicit version e.g. "v2", "_v3.1", "version 2"
    const verMatch = working.match(EXPLICIT_VERSION_RE);
    if (verMatch) {
      const rest = working.slice(0, verMatch.index).trim();
      if (rest.replace(/[^a-zA-ZÀ-ÿ0-9]/g, '').length >= 2) {
        const tuple = verMatch[1].split('.').map((n) => parseInt(n, 10));
        if (!numericParts) numericParts = tuple;
        scoreAcc += 65 + tupleToFloat(tuple);
        peeledTokens.unshift(`v${tuple.join('.')}`);
        working = rest;
        matched = true;
        continue;
      }
    }

    // 2c. Known studio stage keyword e.g. FINAL, MIX, MASTER, PROD, DEMO
    const kwMatch = working.match(STUDIO_KEYWORDS_RE);
    if (kwMatch) {
      const rest = working.slice(0, kwMatch.index).trim();
      if (rest.replace(/[^a-zA-ZÀ-ÿ0-9]/g, '').length >= 2) {
        const kw = kwMatch[1];
        scoreAcc += STUDIO_STAGE_SCORES[kw.toLowerCase()] ?? 40;
        peeledTokens.unshift(kw);
        working = rest;
        matched = true;
        continue;
      }
    }

    // 2d. Separated trailing version number e.g. "Song_2", "Song 3.1"
    const sepNumMatch = working.match(SEPARATED_NUM_RE);
    if (sepNumMatch) {
      const rest = working.slice(0, sepNumMatch.index).trim();
      if (rest.replace(/[^a-zA-ZÀ-ÿ]/g, '').length >= 2) {
        const tuple = sepNumMatch[1].split('.').map((n) => parseInt(n, 10));
        if (!numericParts) numericParts = tuple;
        scoreAcc += 65 + tupleToFloat(tuple);
        peeledTokens.unshift(`v${tuple.join('.')}`);
        working = rest;
        matched = true;
        continue;
      }
    }

    // 2e. Attached trailing version digit e.g. "JUSTE UN SOIR2", "JUSTE UN SOIR4"
    if (!ATTACHED_NUM_IGNORE.test(working)) {
      const attMatch = working.match(ATTACHED_NUM_RE);
      if (attMatch) {
        const rest = attMatch[1].trim();
        if (rest.replace(/[^a-zA-ZÀ-ÿ]/g, '').length >= 3) {
          const tuple = attMatch[2].split('.').map((n) => parseInt(n, 10));
          if (!numericParts) numericParts = tuple;
          scoreAcc += 65 + tupleToFloat(tuple);
          peeledTokens.unshift(`v${tuple.join('.')}`);
          working = rest;
          matched = true;
          continue;
        }
      }
    }

    if (!matched) break;
  }

  const baseTitle = normalizeDisplayTitle(working) || normalizeDisplayTitle(rawOriginal) || 'Sans titre';
  const groupKey = normalizeGroupKey(baseTitle) || normalizeGroupKey(rawOriginal) || 'track';

  const isBaseOriginal = peeledTokens.length === 0 && !isCopy;
  let versionLabel = peeledTokens.join(' ');
  if (!versionLabel) {
    versionLabel = isCopy ? 'Copie' : 'Original';
  } else if (isCopy) {
    versionLabel = `${versionLabel} (copie)`;
  }

  const isProd = peeledTokens.some((tok) =>
    /^\(?\s*(?:prod|instru|instrumental)\s*\)?$/i.test(tok.trim())
  );

  const versionScore = isBaseOriginal
    ? 10
    : isCopy && peeledTokens.length === 0
    ? 5
    : scoreAcc || 50;

  return applyManualOverrides(track, {
    groupKey,
    baseTitle,
    versionLabel,
    numericParts: isBaseOriginal ? [0] : numericParts,
    isBaseOriginal,
    isProd,
    versionScore,
  });
}

function applyManualOverrides(
  track: Pick<MusicTrack, 'title' | 'manualGroupKey' | 'manualGroupTitle' | 'manualVersionLabel'>,
  parsed: ParsedTrackVersion
): ParsedTrackVersion {
  if (!track.manualGroupKey && !track.manualVersionLabel && !track.manualGroupTitle) {
    return parsed;
  }
  const overriddenKey = track.manualGroupKey || parsed.groupKey;
  const overriddenTitle = track.manualGroupTitle || parsed.baseTitle;
  // When user manually links a track with a different name into another group,
  // show its own title (or custom version label) if its parsed label was just "Original"
  const fallbackLabel =
    track.manualGroupKey && track.manualGroupKey !== parsed.groupKey && parsed.isBaseOriginal
      ? track.title
      : parsed.versionLabel;

  return {
    ...parsed,
    groupKey: overriddenKey,
    baseTitle: overriddenTitle,
    versionLabel: track.manualVersionLabel?.trim() || fallbackLabel,
  };
}

function getTrackTimestampMs(track: MusicTrack): number {
  const iso = track.modifiedAt || track.addedAt;
  if (!iso) return 0;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function compareNumericTuples(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}

/**
 * Sorts versions inside a group so the CURRENT / LATEST version is ALWAYS index 0:
 * 1. If timestamps differ by more than 60s -> strictly MOST RECENT modified file wins!
 * 2. If uploaded in the same batch (<= 60s apart) -> higher version score / numeric version wins
 *    (e.g. FOLIE MIX FINAL (+2) > (+1) > FINAL > MIX > Original, v3.2 > v3.1 > v2 > Original).
 */
function compareVersionsDesc(a: TrackVersionEntry, b: TrackVersionEntry): number {
  if (Math.abs(a.timestampMs - b.timestampMs) > 60_000) {
    return b.timestampMs - a.timestampMs;
  }

  if (a.parsed.versionScore !== b.parsed.versionScore) {
    return b.parsed.versionScore - a.parsed.versionScore;
  }

  if (a.parsed.numericParts && b.parsed.numericParts) {
    const cmp = compareNumericTuples(b.parsed.numericParts, a.parsed.numericParts);
    if (cmp !== 0) return cmp;
  }

  if (a.timestampMs !== b.timestampMs) {
    return b.timestampMs - a.timestampMs;
  }

  return b.track.title.localeCompare(a.track.title, 'fr', { numeric: true });
}

/**
 * Groups all tracks into deduplicated song/project groups, promoting each group's most recent version.
 */
export function groupMusicTracks(tracks: MusicTrack[]): TrackGroup[] {
  const buckets = new Map<string, TrackVersionEntry[]>();

  for (const track of tracks) {
    const parsed = parseTrackVersion(track);
    const entry: TrackVersionEntry = {
      track,
      parsed,
      versionLabel: parsed.versionLabel,
      isLatest: false,
      timestampMs: getTrackTimestampMs(track),
    };
    const list = buckets.get(parsed.groupKey);
    if (list) list.push(entry);
    else buckets.set(parsed.groupKey, [entry]);
  }

  const groups: TrackGroup[] = [];

  for (const [groupKey, entries] of buckets.entries()) {
    entries.sort(compareVersionsDesc);

    const songEntries = entries.filter((e) => !e.parsed.isProd);
    const prodEntries = entries.filter((e) => e.parsed.isProd);
    const activeVersions = songEntries.length > 0 ? songEntries : prodEntries;

    if (activeVersions.length > 0) {
      activeVersions[0].isLatest = true;
    }

    const latest = activeVersions[0];
    const prodTrack = prodEntries[0]?.track || null;
    const allTrackIds = entries.map((e) => e.track.id);

    // Pick the cleanest display title for the group:
    // 1) explicit manualGroupTitle if set on any track in the group
    // 2) auto-parsed baseTitle of a track whose natural groupKey matches this bucket
    // 3) latest entry's parsed baseTitle
    const manualTitle =
      latest.track.manualGroupTitle?.trim() ||
      entries.find((e) => Boolean(e.track.manualGroupTitle?.trim()))?.track.manualGroupTitle?.trim();
    const nativeOwner = entries.find(
      (e) => !e.track.manualGroupKey || e.track.manualGroupKey === groupKey
    );
    const baseTitle =
      manualTitle ||
      nativeOwner?.parsed.baseTitle ||
      latest.parsed.baseTitle;

    const yearFolder =
      latest.track.driveYearFolder ||
      entries.find((e) => Boolean(e.track.driveYearFolder))?.track.driveYearFolder ||
      undefined;

    const isFavorite = entries.some((e) => Boolean(e.track.isFavorite));
    const latestTimestampMs = entries.reduce((max, e) => Math.max(max, e.timestampMs), 0);

    const activeTodos = latest.track.todos || [];
    const todoTotal = activeTodos.length;
    const todoDone = activeTodos.filter((td) => td.done).length;
    const description =
      latest.track.description?.trim() ||
      entries.find((e) => e.track.description?.trim())?.track.description?.trim() ||
      undefined;

    groups.push({
      groupKey,
      baseTitle,
      latestTrack: latest.track,
      latestVersionLabel: latest.versionLabel,
      versions: activeVersions,
      prodTrack,
      prodTracks: prodEntries,
      allTrackIds,
      yearFolder,
      isFavorite,
      latestTimestampMs,
      hasMultipleVersions: activeVersions.length > 1,
      todoDone,
      todoTotal,
      description,
    });
  }

  // Sort groups by most recently modified/added track first
  groups.sort((a, b) => b.latestTimestampMs - a.latestTimestampMs);
  return groups;
}

/** Deterministic nice studio gradient per track group */
const GROUP_GRADIENT_IDS = ['pink', 'violet', 'emerald', 'amber', 'sky', 'midnight'] as const;

export function getDeterministicGradientId(groupKey: string): string {
  let hash = 0;
  for (let i = 0; i < groupKey.length; i++) {
    hash = (hash * 31 + groupKey.charCodeAt(i)) >>> 0;
  }
  return GROUP_GRADIENT_IDS[hash % GROUP_GRADIENT_IDS.length];
}

export interface ReconcileProjectVersionsResult {
  musicProjects: MusicProject[];
  musicTracks: MusicTrack[];
  changed: boolean;
}

function sameStringArray(a: string[] | undefined, b: string[] | undefined): boolean {
  const la = a || [];
  const lb = b || [];
  if (la.length !== lb.length) return false;
  for (let i = 0; i < la.length; i++) {
    if (la[i] !== lb[i]) return false;
  }
  return true;
}

function sameStringRecord(
  a: Record<string, string> | undefined,
  b: Record<string, string> | undefined
): boolean {
  const ka = a ? Object.keys(a) : [];
  const kb = b ? Object.keys(b) : [];
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!b || a![k] !== b[k]) return false;
  }
  return true;
}

/**
 * Automatically updates every project's track references (trackIds, benchTrackIds, sprints)
 * to the latest version of each song group, UNLESS the user explicitly pinned a specific
 * version for that song in `project.pinnedVersionByGroup[groupKey]`.
 *
 * Also keeps `linkedProjectId` and explicit `manualGroupTitle` cleanly in sync on the resolved
 * tracks, deduplicates sibling versions inside a project, and prunes stale pins.
 */
export function reconcileProjectTrackVersions(
  musicProjects: MusicProject[],
  musicTracks: MusicTrack[]
): ReconcileProjectVersionsResult {
  if (musicProjects.length === 0 || musicTracks.length === 0) {
    return { musicProjects, musicTracks, changed: false };
  }

  const groups = groupMusicTracks(musicTracks);
  const trackById = new Map<string, MusicTrack>(musicTracks.map((t) => [t.id, t]));
  const groupByTrackId = new Map<string, TrackGroup>();
  const groupByKey = new Map<string, TrackGroup>();
  const explicitGroupTitleByKey = new Map<string, string>();

  for (const g of groups) {
    groupByKey.set(g.groupKey, g);
    for (const id of g.allTrackIds) {
      groupByTrackId.set(id, g);
    }
    const explicitTitle =
      g.latestTrack.manualGroupTitle?.trim() ||
      g.versions.find((v) => Boolean(v.track.manualGroupTitle?.trim()))?.track.manualGroupTitle?.trim();
    if (explicitTitle) {
      explicitGroupTitleByKey.set(g.groupKey, explicitTitle);
    }
  }

  let anyProjectChanged = false;
  // Track patches we need to apply to musicTracks (linkedProjectId & manualGroupTitle)
  const linkedProjectPatch = new Map<string, string | undefined>();
  const manualTitlePatch = new Map<string, string>();

  const nextProjects = musicProjects.map((project) => {
    const pins = project.pinnedVersionByGroup || {};

    const resolveId = (tid: string): { id: string; groupKey: string | null } => {
      const grp = groupByTrackId.get(tid);
      if (!grp) return { id: tid, groupKey: null };
      const pinnedId = pins[grp.groupKey];
      if (pinnedId && trackById.has(pinnedId) && grp.allTrackIds.includes(pinnedId)) {
        return { id: pinnedId, groupKey: grp.groupKey };
      }
      return { id: grp.latestTrack.id, groupKey: grp.groupKey };
    };

    const activeGroupKeys = new Set<string>();
    const nextTrackIds: string[] = [];
    const seenTrackIds = new Set<string>();

    const pushActiveId = (rawTid: string) => {
      const { id, groupKey } = resolveId(rawTid);
      if (groupKey && activeGroupKeys.has(groupKey)) return;
      if (seenTrackIds.has(id)) return;
      if (groupKey) activeGroupKeys.add(groupKey);
      seenTrackIds.add(id);
      nextTrackIds.push(id);
    };

    for (const tid of project.trackIds || []) {
      pushActiveId(tid);
    }

    // Also pick up any track linked via linkedProjectId === project.id that isn't benched
    const rawBenchSet = new Set(project.benchTrackIds || []);
    for (const t of musicTracks) {
      if (t.linkedProjectId === project.id && !rawBenchSet.has(t.id)) {
        const grp = groupByTrackId.get(t.id);
        // Only add if this song group isn't already in trackIds or bench
        const benchedGroup = grp && (project.benchTrackIds || []).some((bid) => grp.allTrackIds.includes(bid));
        if (!benchedGroup) {
          pushActiveId(t.id);
        }
      }
    }

    // Resolve benchTrackIds (excluding any song group already active in trackIds)
    const benchGroupKeys = new Set<string>();
    const nextBenchTrackIds: string[] = [];
    const seenBenchIds = new Set<string>();
    for (const bid of project.benchTrackIds || []) {
      const { id, groupKey } = resolveId(bid);
      if (groupKey && (activeGroupKeys.has(groupKey) || benchGroupKeys.has(groupKey))) continue;
      if (seenTrackIds.has(id) || seenBenchIds.has(id)) continue;
      if (groupKey) benchGroupKeys.add(groupKey);
      seenBenchIds.add(id);
      nextBenchTrackIds.push(id);
    }

    // Resolve sprints[].trackIds
    let sprintsChanged = false;
    const nextSprints = project.sprints
      ? project.sprints.map((spr) => {
          const nextSprIds: string[] = [];
          const seenSpr = new Set<string>();
          for (const sid of spr.trackIds) {
            const { id } = resolveId(sid);
            if (!seenSpr.has(id)) {
              seenSpr.add(id);
              nextSprIds.push(id);
            }
          }
          if (!sameStringArray(spr.trackIds, nextSprIds)) {
            sprintsChanged = true;
            return { ...spr, trackIds: nextSprIds };
          }
          return spr;
        })
      : undefined;

    // Prune stale pins (deleted track, wrong group, or song removed from project)
    const nextPinsObj: Record<string, string> = {};
    for (const [gKey, pinnedId] of Object.entries(pins)) {
      const grp = groupByKey.get(gKey);
      if (
        grp &&
        (activeGroupKeys.has(gKey) || benchGroupKeys.has(gKey)) &&
        trackById.has(pinnedId) &&
        grp.allTrackIds.includes(pinnedId)
      ) {
        nextPinsObj[gKey] = pinnedId;
      }
    }
    const nextPinnedVersionByGroup =
      Object.keys(nextPinsObj).length > 0 ? nextPinsObj : undefined;

    // Sync linkedProjectId & manualGroupTitle on resolved tracks vs old siblings
    for (const resolvedId of nextTrackIds) {
      const grp = groupByTrackId.get(resolvedId);
      const trk = trackById.get(resolvedId);
      if (trk && !linkedProjectPatch.has(resolvedId)) {
        // Keep existing linkedProjectId if it already points to a valid project containing this track
        const existingLinkedProj = trk.linkedProjectId
          ? musicProjects.find((p) => p.id === trk.linkedProjectId)
          : null;
        const alreadyLinkedToValidProj =
          existingLinkedProj &&
          (existingLinkedProj.id === project.id ||
            existingLinkedProj.trackIds.includes(resolvedId) ||
            (grp ? grp.allTrackIds.some((id) => existingLinkedProj.trackIds.includes(id)) : false));
        if (!alreadyLinkedToValidProj) {
          linkedProjectPatch.set(resolvedId, project.id);
        }
      }
      if (grp) {
        const expTitle = explicitGroupTitleByKey.get(grp.groupKey);
        if (expTitle && trk && !trk.manualGroupTitle?.trim()) {
          manualTitlePatch.set(resolvedId, expTitle);
        }
        // Clear stale linkedProjectId on other siblings that pointed to this project
        for (const sibId of grp.allTrackIds) {
          if (sibId === resolvedId) continue;
          const sib = trackById.get(sibId);
          if (sib && sib.linkedProjectId === project.id && !linkedProjectPatch.has(sibId)) {
            linkedProjectPatch.set(sibId, undefined);
          }
        }
      }
    }

    // Also propagate manualGroupTitle on benched resolved tracks
    for (const resolvedBenchId of nextBenchTrackIds) {
      const grp = groupByTrackId.get(resolvedBenchId);
      const trk = trackById.get(resolvedBenchId);
      if (grp) {
        const expTitle = explicitGroupTitleByKey.get(grp.groupKey);
        if (expTitle && trk && !trk.manualGroupTitle?.trim()) {
          manualTitlePatch.set(resolvedBenchId, expTitle);
        }
      }
    }

    const trackIdsChanged = !sameStringArray(project.trackIds, nextTrackIds);
    const benchChanged = !sameStringArray(project.benchTrackIds, nextBenchTrackIds);
    const pinsChanged = !sameStringRecord(project.pinnedVersionByGroup, nextPinnedVersionByGroup);

    if (trackIdsChanged || benchChanged || sprintsChanged || pinsChanged) {
      anyProjectChanged = true;
      return {
        ...project,
        trackIds: nextTrackIds,
        ...(project.benchTrackIds !== undefined || nextBenchTrackIds.length > 0
          ? { benchTrackIds: nextBenchTrackIds }
          : {}),
        ...(nextSprints !== undefined ? { sprints: nextSprints } : {}),
        pinnedVersionByGroup: nextPinnedVersionByGroup,
      };
    }

    return project;
  });

  let anyTrackChanged = false;
  const nextTracks =
    linkedProjectPatch.size > 0 || manualTitlePatch.size > 0
      ? musicTracks.map((t) => {
          const hasProjPatch = linkedProjectPatch.has(t.id);
          const hasTitlePatch = manualTitlePatch.has(t.id);
          if (!hasProjPatch && !hasTitlePatch) return t;
          const nextLinked = hasProjPatch ? linkedProjectPatch.get(t.id) : t.linkedProjectId;
          const nextTitle = hasTitlePatch ? manualTitlePatch.get(t.id) : t.manualGroupTitle;
          if (nextLinked === t.linkedProjectId && nextTitle === t.manualGroupTitle) return t;
          anyTrackChanged = true;
          return {
            ...t,
            linkedProjectId: nextLinked,
            ...(hasTitlePatch ? { manualGroupTitle: nextTitle } : {}),
          };
        })
      : musicTracks;

  if (!anyProjectChanged && !anyTrackChanged) {
    return { musicProjects, musicTracks, changed: false };
  }

  return {
    musicProjects: nextProjects,
    musicTracks: nextTracks,
    changed: true,
  };
}

export const COVER_GRADIENTS: Array<{ id: string; label: string; from: string; to: string }> = [
  { id: 'sunset', label: 'Rowav Crimson', from: '#8C271E', to: '#4A120D' },
  { id: 'violet', label: 'Studio Dark', from: '#27272A', to: '#09090B' },
  { id: 'ocean', label: 'Ocean Slate', from: '#334155', to: '#0F172A' },
  { id: 'emerald', label: 'Emerald Mix', from: '#059669', to: '#064E3B' },
  { id: 'amber', label: 'Warm Amber', from: '#D97706', to: '#78350F' },
  { id: 'rose', label: 'Velvet Rose', from: '#B91C1C', to: '#450A0A' },
];

export function getCoverGradientStyle(gradientId?: string): { background: string } {
  const found =
    COVER_GRADIENTS.find((g) => g.id === gradientId) || COVER_GRADIENTS[0];
  return {
    background: `linear-gradient(135deg, ${found.from}, ${found.to})`,
  };
}
