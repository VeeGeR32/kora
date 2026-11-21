import type { MusicTrack } from '../types';

export interface ParsedTrackVersion {
  groupKey: string;
  baseTitle: string;
  versionLabel: string;
  /** Numeric version tuple, e.g. [3, 2] for "3.2", [0] for bare base, null for named suffix like "prod" */
  numericParts: number[] | null;
  /** True when the track has no suffix at all (e.g. "Project_306.mp3") */
  isBaseOriginal: boolean;
  /** Semantic priority for named variants when timestamps tie */
  namedRank: number;
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
  isFavorite: boolean;
  latestTimestampMs: number;
  hasMultipleVersions: boolean;
  todoDone: number;
  todoTotal: number;
  description?: string;
}

const NAMED_SUFFIX_RANKS: Record<string, number> = {
  master: 90,
  mastered: 90,
  final: 85,
  fin: 85,
  mix: 70,
  mixed: 70,
  mixdown: 70,
  vocals: 60,
  vox: 60,
  prod: 50,
  beat: 45,
  instru: 45,
  instrumental: 45,
  demo: 40,
  rough: 35,
  draft: 30,
  idee: 25,
  idea: 25,
};

function stripAudioExtension(raw: string): string {
  return raw.replace(/\.(mp3|wav|m4a|flac|aac|ogg)$/i, '').trim();
}

function normalizeDisplayTitle(raw: string): string {
  return raw
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeGroupKey(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseNumericTuple(raw: string): number[] | null {
  const cleaned = raw.replace(/^v(?:er(?:sion)?)?[._ -]?/i, '').trim();
  if (!/^\d+(?:\.\d+)*$/.test(cleaned)) return null;
  return cleaned.split('.').map((n) => parseInt(n, 10));
}

function formatVersionSuffix(suffix: string): {
  label: string;
  numericParts: number[] | null;
  namedRank: number;
} {
  const trimmed = suffix.trim();
  const numeric = parseNumericTuple(trimmed);
  if (numeric) {
    return {
      label: `v${numeric.join('.')}`,
      numericParts: numeric,
      namedRank: 65,
    };
  }
  const cleanLabel = trimmed.replace(/[_-]+/g, ' ').trim();
  const key = cleanLabel.toLowerCase();
  const rank = NAMED_SUFFIX_RANKS[key] ?? 55;
  return {
    label: cleanLabel,
    numericParts: null,
    namedRank: rank,
  };
}

/**
 * Parses a track filename or title into a project group + version metadata.
 * Tailored for patterns like:
 * - Project_306_3.2.mp3  -> Project 306 (v3.2)
 * - Project_306_prod.mp3 -> Project 306 (prod)
 * - Project_306.mp3      -> Project 306 (Original)
 * - Project 300 8        -> Project 300 (v8)
 * - MySong_v2.1.mp3      -> MySong (v2.1)
 */
export function parseTrackVersion(track: Pick<MusicTrack, 'title' | 'sourceFilename'>): ParsedTrackVersion {
  const rawSource = stripAudioExtension(track.sourceFilename || track.title || 'Sans titre');

  // 1. Primary pattern: Project_XXX or Project XXX (with optional version/variant suffix)
  const projectMatch = rawSource.match(
    /^(project|projet)[\s_-]*(\d+)(?:[\s_-]+(.+))?$/i
  );
  if (projectMatch) {
    const num = projectMatch[2];
    const suffix = projectMatch[3]?.trim();
    const baseTitle = `Project ${num}`;
    const groupKey = `project_${num}`;

    if (!suffix) {
      return {
        groupKey,
        baseTitle,
        versionLabel: 'Original',
        numericParts: [0],
        isBaseOriginal: true,
        namedRank: 10,
      };
    }

    const parsedSuffix = formatVersionSuffix(suffix);
    return {
      groupKey,
      baseTitle,
      versionLabel: parsedSuffix.label,
      numericParts: parsedSuffix.numericParts,
      isBaseOriginal: false,
      namedRank: parsedSuffix.namedRank,
    };
  }

  // 2. Explicit version suffix on any track name: "Track Name v2", "Track_Name_v3.1", "Track_Name_2.1"
  const explicitVersionMatch = rawSource.match(
    /^(.+?)[\s_-]+(?:v|ver|version|rev)[\s._-]*(\d+(?:\.\d+)*)$/i
  );
  if (explicitVersionMatch && explicitVersionMatch[1].trim().length >= 2) {
    const baseTitle = normalizeDisplayTitle(explicitVersionMatch[1]);
    const numeric = explicitVersionMatch[2].split('.').map((n) => parseInt(n, 10));
    return {
      groupKey: normalizeGroupKey(baseTitle) || normalizeGroupKey(rawSource),
      baseTitle,
      versionLabel: `v${numeric.join('.')}`,
      numericParts: numeric,
      isBaseOriginal: false,
      namedRank: 65,
    };
  }

  // 3. Trailing decimal or underscore number: "Beat_Alpha_3.2" or "Beat_Alpha_4"
  const trailingNumMatch = rawSource.match(/^(.+?)[_-](\d+(?:\.\d+)*)$/);
  if (trailingNumMatch && trailingNumMatch[1].trim().length >= 2) {
    const baseTitle = normalizeDisplayTitle(trailingNumMatch[1]);
    const numeric = trailingNumMatch[2].split('.').map((n) => parseInt(n, 10));
    return {
      groupKey: normalizeGroupKey(baseTitle) || normalizeGroupKey(rawSource),
      baseTitle,
      versionLabel: `v${numeric.join('.')}`,
      numericParts: numeric,
      isBaseOriginal: false,
      namedRank: 65,
    };
  }

  // 4. Trailing known studio suffix: "Track_prod", "Track_mix", "Track_master", "Track_final"
  const namedMatch = rawSource.match(
    /^(.+?)[\s_-]+(master|mastered|final|mix|mixed|prod|beat|instru|instrumental|demo|rough|draft|vox|vocals)$/i
  );
  if (namedMatch && namedMatch[1].trim().length >= 2) {
    const baseTitle = normalizeDisplayTitle(namedMatch[1]);
    const parsedSuffix = formatVersionSuffix(namedMatch[2]);
    return {
      groupKey: normalizeGroupKey(baseTitle) || normalizeGroupKey(rawSource),
      baseTitle,
      versionLabel: parsedSuffix.label,
      numericParts: null,
      isBaseOriginal: false,
      namedRank: parsedSuffix.namedRank,
    };
  }

  // 5. Standalone track (no version suffix)
  const baseTitle = normalizeDisplayTitle(rawSource) || 'Sans titre';
  return {
    groupKey: normalizeGroupKey(baseTitle) || track.title.toLowerCase(),
    baseTitle,
    versionLabel: 'Original',
    numericParts: [0],
    isBaseOriginal: true,
    namedRank: 10,
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
 * Sorts versions inside a group from LATEST (index 0) to OLDEST.
 */
function compareVersionsDesc(a: TrackVersionEntry, b: TrackVersionEntry): number {
  const aNum = a.parsed.numericParts;
  const bNum = b.parsed.numericParts;

  // Both numeric (including [0] Original vs [1], [3,2] vs [3,1]): higher version wins
  if (aNum && bNum) {
    const cmp = compareNumericTuples(bNum, aNum);
    if (cmp !== 0) return cmp;
    return b.timestampMs - a.timestampMs;
  }

  // Comparing numeric vs named variant (e.g. v3.2 vs prod) or two named variants:
  // If timestamps clearly differ (> 5s), the more recently modified file on Drive wins
  if (Math.abs(a.timestampMs - b.timestampMs) > 5000) {
    return b.timestampMs - a.timestampMs;
  }

  // Fallback when timestamps match or are missing: use semantic rank (final/master > numeric > prod > original)
  if (a.parsed.namedRank !== b.parsed.namedRank) {
    return b.parsed.namedRank - a.parsed.namedRank;
  }

  return b.track.title.localeCompare(a.track.title, 'fr', { numeric: true });
}

/**
 * Groups all tracks into deduplicated project/song groups, promoting each group's latest version.
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
    if (entries.length > 0) {
      entries[0].isLatest = true;
    }

    const latest = entries[0];
    const isFavorite = entries.some((e) => Boolean(e.track.isFavorite));
    const latestTimestampMs = entries.reduce((max, e) => Math.max(max, e.timestampMs), 0);

    // Aggregate TODO counts & pick description from latest track (or most recent version that has one)
    const activeTodos = latest.track.todos || [];
    const todoTotal = activeTodos.length;
    const todoDone = activeTodos.filter((td) => td.done).length;
    const description =
      latest.track.description?.trim() ||
      entries.find((e) => e.track.description?.trim())?.track.description?.trim() ||
      undefined;

    groups.push({
      groupKey,
      baseTitle: latest.parsed.baseTitle,
      latestTrack: latest.track,
      latestVersionLabel: latest.versionLabel,
      versions: entries,
      isFavorite,
      latestTimestampMs,
      hasMultipleVersions: entries.length > 1,
      todoDone,
      todoTotal,
      description,
    });
  }

  // Default order: most recently updated project first
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
