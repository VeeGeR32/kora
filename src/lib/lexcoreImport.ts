import type { LyricsDoc, LyricsFolder } from '../types';
import { uid } from '../utils/dates';

export interface ParsedLexCoreBackup {
  folders: LyricsFolder[];
  docs: LyricsDoc[];
}

/** Recursively unwraps MongoDB Extended JSON ($oid, $date, $numberInt, $numberLong, $numberDouble) */
function unwrapMongoValue(val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (Array.isArray(val)) return val.map(unwrapMongoValue);
  if (typeof val !== 'object') return val;

  const obj = val as Record<string, unknown>;
  const keys = Object.keys(obj);

  if (keys.length === 1) {
    if ('$oid' in obj && typeof obj.$oid === 'string') return obj.$oid;
    if ('$numberInt' in obj) return Number(obj.$numberInt);
    if ('$numberDouble' in obj) return Number(obj.$numberDouble);
    if ('$numberLong' in obj) return Number(obj.$numberLong);
    if ('$date' in obj) {
      const d = obj.$date;
      if (typeof d === 'string') return d;
      if (typeof d === 'number') return new Date(d).toISOString();
      if (d && typeof d === 'object' && '$numberLong' in (d as Record<string, unknown>)) {
        return new Date(Number((d as Record<string, unknown>).$numberLong)).toISOString();
      }
    }
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = unwrapMongoValue(v);
  }
  return out;
}

function parseRawJsonOrNdjson(rawText: string): unknown {
  const trimmed = rawText.trim();
  if (!trimmed) return [];
  try {
    return JSON.parse(trimmed);
  } catch {
    // Support NDJSON (newline-delimited JSON from `mongoexport`)
    const lines = trimmed
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const parsed: unknown[] = [];
    for (const line of lines) {
      try {
        parsed.push(JSON.parse(line));
      } catch {
        // ignore invalid line
      }
    }
    if (parsed.length > 0) return parsed;
    throw new Error('Format JSON invalide — vérifie que le fichier exporté depuis MongoDB est complet.');
  }
}

function toIsoDate(val: unknown): string {
  if (typeof val === 'string' && val.trim()) {
    const d = new Date(val);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (typeof val === 'number' && Number.isFinite(val)) {
    const ms = val < 1e12 ? val * 1000 : val;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

function toStatus(val: unknown): 1 | 2 | 3 {
  if (val === 3 || val === '3' || val === 'done' || val === 'termine' || val === 'terminé') return 3;
  if (val === 2 || val === '2' || val === 'wip' || val === 'en-cours' || val === 'in_progress') return 2;
  return 1;
}

function asId(val: unknown): string | null {
  if (typeof val === 'string' && val.trim()) return val.trim();
  if (typeof val === 'number' && Number.isFinite(val)) return String(val);
  return null;
}

function isFolderLike(item: Record<string, unknown>): boolean {
  if (item.type === 'folder' || item.kind === 'folder') return true;
  if (typeof item.content === 'string' || typeof item.text === 'string' || typeof item.body === 'string' || typeof item.lyrics === 'string') {
    return false;
  }
  return typeof item.name === 'string' && ('parentId' in item || 'parent' in item || 'createdAt' in item || !('title' in item));
}

function isDocLike(item: Record<string, unknown>): boolean {
  if (item.type === 'folder' || item.kind === 'folder') return false;
  const hasTitle = typeof item.title === 'string' || typeof item.name === 'string';
  const hasContent =
    typeof item.content === 'string' ||
    typeof item.text === 'string' ||
    typeof item.body === 'string' ||
    typeof item.lyrics === 'string' ||
    typeof item.mediaUrl === 'string';
  return hasTitle && hasContent;
}

function collectRawItems(
  node: unknown,
  rawFolders: Record<string, unknown>[],
  rawDocs: Record<string, unknown>[],
  depth = 0
) {
  if (!node || depth > 6) return;

  if (Array.isArray(node)) {
    for (const el of node) {
      collectRawItems(el, rawFolders, rawDocs, depth + 1);
    }
    return;
  }

  if (typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;

  // Check for explicit container keys first (e.g. LexCore backup object or MongoDB user snapshot)
  const folderKeys = ['lyricsFolders', 'folders', 'directories'];
  const docKeys = ['lyricsDocs', 'documents', 'docs', 'files', 'texts', 'notes', 'songs', 'lyrics'];
  const wrapperKeys = ['data', 'backup', 'state', 'payload', 'workspace'];

  let foundContainer = false;

  for (const fk of folderKeys) {
    if (Array.isArray(obj[fk])) {
      foundContainer = true;
      for (const f of obj[fk] as unknown[]) {
        if (f && typeof f === 'object') rawFolders.push(f as Record<string, unknown>);
      }
    }
  }

  for (const dk of docKeys) {
    if (Array.isArray(obj[dk])) {
      foundContainer = true;
      for (const d of obj[dk] as unknown[]) {
        if (d && typeof d === 'object') rawDocs.push(d as Record<string, unknown>);
      }
    }
  }

  for (const wk of wrapperKeys) {
    if (obj[wk] && typeof obj[wk] === 'object') {
      foundContainer = true;
      collectRawItems(obj[wk], rawFolders, rawDocs, depth + 1);
    }
  }

  if (foundContainer) return;

  // Otherwise inspect the object itself as a standalone folder or document record
  if (isDocLike(obj)) {
    rawDocs.push(obj);
  } else if (isFolderLike(obj)) {
    rawFolders.push(obj);
  }
}

/**
 * Parses one or more JSON/NDJSON exports from MongoDB / LexCore into clean Kora LyricsFolders & LyricsDocs.
 */
export function parseLexCoreBackupPayloads(rawTexts: string[]): ParsedLexCoreBackup {
  const rawFolders: Record<string, unknown>[] = [];
  const rawDocs: Record<string, unknown>[] = [];

  for (const text of rawTexts) {
    const parsed = unwrapMongoValue(parseRawJsonOrNdjson(text));
    collectRawItems(parsed, rawFolders, rawDocs, 0);
  }

  // Pass 1: Assign fresh Kora IDs to folders while keeping an oldId -> newId map for parent/doc links
  const folderIdMap = new Map<string, string>();
  const pendingFolders: { oldId: string | null; oldParentId: string | null; name: string; createdAt: string }[] = [];
  const seenFolderKeys = new Set<string>();

  for (const rf of rawFolders) {
    const name = String(rf.name || rf.title || 'Dossier').trim();
    if (!name) continue;
    const oldId = asId(rf.id) || asId(rf._id);
    const oldParentId = asId(rf.parentId) || asId(rf.parent) || null;
    const dedupKey = oldId ? `id:${oldId}` : `np:${oldParentId || 'root'}:${name.toLowerCase()}`;
    if (seenFolderKeys.has(dedupKey)) continue;
    seenFolderKeys.add(dedupKey);

    const newId = uid('fld');
    if (oldId) folderIdMap.set(oldId, newId);
    pendingFolders.push({
      oldId,
      oldParentId,
      name,
      createdAt: toIsoDate(rf.createdAt || rf.created_at),
    });
  }

  const folders: LyricsFolder[] = pendingFolders.map((pf) => {
    const id = (pf.oldId && folderIdMap.get(pf.oldId)) || uid('fld');
    const mappedParent = pf.oldParentId ? folderIdMap.get(pf.oldParentId) || null : null;
    return {
      id,
      name: pf.name,
      parentId: mappedParent === id ? null : mappedParent,
      createdAt: pf.createdAt,
    };
  });

  // Pass 2: Normalize docs & link to mapped folderId
  const docs: LyricsDoc[] = [];
  const seenDocs = new Set<string>();

  for (const rd of rawDocs) {
    const title = String(rd.title || rd.name || 'Sans titre').trim() || 'Sans titre';
    const rawContent =
      typeof rd.content === 'string'
        ? rd.content
        : typeof rd.lyrics === 'string'
        ? rd.lyrics
        : typeof rd.text === 'string'
        ? rd.text
        : typeof rd.body === 'string'
        ? rd.body
        : '';

    const oldId = asId(rd.id) || asId(rd._id);
    const dedupKey = oldId ? `id:${oldId}` : `tc:${title.toLowerCase()}::${rawContent.slice(0, 120)}`;
    if (seenDocs.has(dedupKey)) continue;
    seenDocs.add(dedupKey);

    const oldFolderId = asId(rd.folderId) || asId(rd.folder) || asId(rd.parentId);
    const folderId = oldFolderId ? folderIdMap.get(oldFolderId) || null : null;

    const rawMarkers = rd.markers as { start?: unknown; end?: unknown } | undefined;
    const markers =
      rawMarkers && typeof rawMarkers === 'object'
        ? {
            start: typeof rawMarkers.start === 'number' ? rawMarkers.start : null,
            end: typeof rawMarkers.end === 'number' ? rawMarkers.end : null,
          }
        : { start: null, end: null };

    const deletedRaw = rd.deletedAt ?? rd.deleted_at;
    const deletedAt = deletedRaw ? toIsoDate(deletedRaw) : null;

    docs.push({
      id: uid('lyr'),
      title,
      content: rawContent,
      folderId,
      status: toStatus(rd.status),
      mediaUrl: typeof rd.mediaUrl === 'string' ? rd.mediaUrl : typeof rd.beatUrl === 'string' ? rd.beatUrl : '',
      loop: Boolean(rd.loop),
      markers,
      deletedAt,
      lastModified: toIsoDate(rd.lastModified || rd.updatedAt || rd.updated_at || rd.createdAt),
    });
  }

  return { folders, docs };
}
