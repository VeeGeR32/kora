import type { FirebaseUserConfig } from '../types';
import { getCurrentFirebaseIdToken } from './firebase';

export interface PublicShareComment {
  id: string;
  trackId: string;
  timeSec: number;
  authorName: string;
  text: string;
  createdAt: string;
}

export interface PublicSharedTrack {
  id: string;
  title: string;
  artist: string;
  durationSec: number;
  coverDataUrl: string | null;
  coverGradient: string;
  addedAt: string;
  streamable: boolean;
  audioUrl: string | null;
}

export interface PublicSharedProject {
  id: string;
  title: string;
  kind: string;
  coverDataUrl: string | null;
  coverGradient: string;
}

export interface PublicSharePayload {
  kind: 'track' | 'project';
  artist: string;
  project: PublicSharedProject | null;
  tracks: PublicSharedTrack[];
  hasPasscode: boolean;
  allowComments: boolean;
  comments: PublicShareComment[];
}

export interface OwnerShareMeta {
  url: string;
  token: string;
  hasPasscode: boolean;
  allowComments: boolean;
  comments: PublicShareComment[];
}

export class PublicShareLockedError extends Error {
  requiresPasscode = true;
  title: string;
  artist: string;
  kind: 'track' | 'project';

  constructor(message: string, meta: { title: string; artist: string; kind: 'track' | 'project' }) {
    super(message);
    this.name = 'PublicShareLockedError';
    this.title = meta.title;
    this.artist = meta.artist;
    this.kind = meta.kind;
  }
}

export async function fetchOwnerShareMeta(options: {
  kind: 'track' | 'project';
  id: string;
  firebaseConfig?: FirebaseUserConfig | null;
}): Promise<OwnerShareMeta> {
  const idToken = await getCurrentFirebaseIdToken(options.firebaseConfig);
  if (!idToken) {
    throw new Error('Connecte-toi à Rowav pour gérer le partage.');
  }

  const res = await fetch('/api/share', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      action: 'get_owner_meta',
      kind: options.kind,
      id: options.id,
    }),
  });

  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    token?: string;
    hasPasscode?: boolean;
    allowComments?: boolean;
    comments?: PublicShareComment[];
    error?: string;
  };
  if (!res.ok || !data.ok || !data.token) {
    throw new Error(data.error || `Impossible de charger les options de partage (HTTP ${res.status})`);
  }

  return {
    url: `${window.location.origin}/?share=${encodeURIComponent(data.token)}`,
    token: data.token,
    hasPasscode: Boolean(data.hasPasscode),
    allowComments: data.allowComments !== false,
    comments: Array.isArray(data.comments) ? data.comments : [],
  };
}

export async function createPublicShareLink(options: {
  kind: 'track' | 'project';
  id: string;
  passcode?: string;
  clearPasscode?: boolean;
  allowComments?: boolean;
  firebaseConfig?: FirebaseUserConfig | null;
}): Promise<string> {
  const idToken = await getCurrentFirebaseIdToken(options.firebaseConfig);
  if (!idToken) {
    throw new Error('Connecte-toi à Rowav pour générer un lien de partage.');
  }

  const res = await fetch('/api/share', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      kind: options.kind,
      id: options.id,
      ...(options.passcode ? { passcode: options.passcode } : {}),
      ...(options.clearPasscode ? { clearPasscode: true } : {}),
      ...(typeof options.allowComments === 'boolean' ? { allowComments: options.allowComments } : {}),
    }),
  });

  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    token?: string;
    error?: string;
  };
  if (!res.ok || !data.ok || !data.token) {
    throw new Error(data.error || `Impossible de créer le lien (HTTP ${res.status})`);
  }

  return `${window.location.origin}/?share=${encodeURIComponent(data.token)}`;
}

export async function shareOrCopyPublicLink(options: {
  kind: 'track' | 'project';
  id: string;
  title: string;
  passcode?: string;
  clearPasscode?: boolean;
  allowComments?: boolean;
  firebaseConfig?: FirebaseUserConfig | null;
}): Promise<{ url: string; method: 'native' | 'clipboard' | 'manual' }> {
  const url = await createPublicShareLink(options);

  let copied = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      copied = true;
    }
  } catch {
    copied = false;
  }

  // On mobile devices supporting Web Share API, also open the native iOS/Android share sheet
  const isTouchDevice =
    typeof window !== 'undefined' &&
    ('ontouchstart' in window || navigator.maxTouchPoints > 0) &&
    typeof navigator.share === 'function';

  if (isTouchDevice) {
    try {
      await navigator.share({
        title: options.title,
        text: `Écoute « ${options.title} »`,
        url,
      });
      return { url, method: 'native' };
    } catch {
      // User cancelled share sheet; clipboard copy still succeeded
    }
  }

  if (copied) return { url, method: 'clipboard' };
  window.prompt('Copie ce lien de partage public :', url);
  return { url, method: 'manual' };
}

export async function fetchPublicShare(
  token: string,
  passcode?: string
): Promise<PublicSharePayload> {
  const headers: Record<string, string> = {};
  if (passcode && passcode.trim()) {
    headers['X-Share-Passcode'] = passcode.trim();
  }
  const res = await fetch(`/api/share?token=${encodeURIComponent(token)}`, { headers });
  const data = (await res.json().catch(() => ({}))) as Partial<PublicSharePayload> & {
    ok?: boolean;
    requiresPasscode?: boolean;
    title?: string;
    error?: string;
  };
  if (res.status === 401 && data.requiresPasscode) {
    throw new PublicShareLockedError(
      data.error || 'Ce lien est protégé par un code d’accès.',
      {
        title: data.title || 'Partage protégé',
        artist: data.artist || 'Artiste',
        kind: data.kind === 'project' ? 'project' : 'track',
      }
    );
  }
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Lien de partage introuvable ou invalide.');
  }
  return {
    kind: data.kind === 'project' ? 'project' : 'track',
    artist: data.artist || 'Artiste',
    project: data.project || null,
    tracks: Array.isArray(data.tracks) ? data.tracks : [],
    hasPasscode: Boolean(data.hasPasscode),
    allowComments: data.allowComments !== false,
    comments: Array.isArray(data.comments) ? data.comments : [],
  };
}

export async function postPublicShareComment(options: {
  token: string;
  passcode?: string;
  trackId: string;
  timeSec: number;
  authorName: string;
  text: string;
}): Promise<PublicShareComment[]> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.passcode && options.passcode.trim()) {
    headers['X-Share-Passcode'] = options.passcode.trim();
  }
  const res = await fetch('/api/share', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'add_comment',
      token: options.token,
      passcode: options.passcode,
      trackId: options.trackId,
      timeSec: options.timeSec,
      authorName: options.authorName,
      text: options.text,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    comments?: PublicShareComment[];
    error?: string;
  };
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Impossible d’envoyer ce commentaire.');
  }
  return Array.isArray(data.comments) ? data.comments : [];
}
