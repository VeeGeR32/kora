import type { FirebaseUserConfig } from '../types';
import { getCurrentFirebaseIdToken } from './firebase';

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
}

export async function createPublicShareLink(options: {
  kind: 'track' | 'project';
  id: string;
  firebaseConfig?: FirebaseUserConfig | null;
}): Promise<string> {
  const idToken = await getCurrentFirebaseIdToken(options.firebaseConfig);
  if (!idToken) {
    throw new Error('Connecte-toi à Kora pour générer un lien de partage.');
  }

  const res = await fetch('/api/share', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ kind: options.kind, id: options.id }),
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

export async function fetchPublicShare(token: string): Promise<PublicSharePayload> {
  const res = await fetch(`/api/share?token=${encodeURIComponent(token)}`);
  const data = (await res.json().catch(() => ({}))) as Partial<PublicSharePayload> & {
    ok?: boolean;
    error?: string;
  };
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Lien de partage introuvable ou invalide.');
  }
  return {
    kind: data.kind === 'project' ? 'project' : 'track',
    artist: data.artist || 'Artiste',
    project: data.project || null,
    tracks: Array.isArray(data.tracks) ? data.tracks : [],
  };
}
