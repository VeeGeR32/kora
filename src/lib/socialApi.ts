import type {
  FirebaseUserConfig,
  MusicTrack,
  ProjectKind,
  SocialArtistProfile,
  SocialDirectMessage,
  SocialProjectItem,
  SocialTrackItem,
  TrackMood,
} from '../types';
import { getCurrentFirebaseIdToken, getEnvFirebaseConfig } from './firebase';

export interface SocialHubSnapshot {
  ok: boolean;
  error?: string;
  profiles: SocialArtistProfile[];
  projects: SocialProjectItem[];
  messages: SocialDirectMessage[];
}

async function getAuthHeaders(fbConfig?: FirebaseUserConfig): Promise<Record<string, string>> {
  const resolved = fbConfig?.apiKey ? fbConfig : getEnvFirebaseConfig();
  const idToken = await getCurrentFirebaseIdToken(resolved);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (idToken) {
    headers.Authorization = `Bearer ${idToken}`;
  }
  return headers;
}

export async function fetchSocialHub(fbConfig?: FirebaseUserConfig): Promise<SocialHubSnapshot> {
  try {
    const headers = await getAuthHeaders(fbConfig);
    const res = await fetch('/api/social', {
      method: 'GET',
      headers,
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) {
      return {
        ok: false,
        error: data?.error || `Erreur réseau (${res.status})`,
        profiles: [],
        projects: [],
        messages: [],
      };
    }
    return {
      ok: true,
      profiles: Array.isArray(data.profiles) ? data.profiles : [],
      projects: Array.isArray(data.projects) ? data.projects : [],
      messages: Array.isArray(data.messages) ? data.messages : [],
    };
  } catch (err) {
    return {
      ok: false,
      error: (err as Error)?.message || 'Impossible de charger Rowav Social',
      profiles: [],
      projects: [],
      messages: [],
    };
  }
}

export async function postSocialAction(
  payload: Record<string, unknown>,
  fbConfig?: FirebaseUserConfig
): Promise<SocialHubSnapshot & { liked?: boolean; followed?: boolean; publishedProjectId?: string }> {
  try {
    const headers = await getAuthHeaders(fbConfig);
    const res = await fetch('/api/social', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) {
      return {
        ok: false,
        error: data?.error || `Erreur serveur (${res.status})`,
        profiles: [],
        projects: [],
        messages: [],
      };
    }
    return {
      ok: true,
      liked: data.liked,
      followed: data.followed,
      publishedProjectId: data.publishedProjectId,
      profiles: Array.isArray(data.profiles) ? data.profiles : [],
      projects: Array.isArray(data.projects) ? data.projects : [],
      messages: Array.isArray(data.messages) ? data.messages : [],
    };
  } catch (err) {
    return {
      ok: false,
      error: (err as Error)?.message || 'Erreur réseau Rowav Social',
      profiles: [],
      projects: [],
      messages: [],
    };
  }
}

export function socialTrackToMusicTrack(item: SocialTrackItem): MusicTrack {
  return {
    id: item.id,
    title: item.title,
    artist: item.artist || item.ownerName,
    cloudAudioUrl: item.audioUrl,
    cloudCoverUrl: item.coverUrl && !item.coverUrl.startsWith('data:') ? item.coverUrl : undefined,
    coverDataUrl: item.coverUrl && item.coverUrl.startsWith('data:') ? item.coverUrl : undefined,
    coverGradient: item.coverGradient || 'sunset',
    durationSec: item.durationSec || 160,
    bpm: item.bpm,
    mood: item.mood as TrackMood | undefined,
    ratingCurrent: item.myRating || (item.ratingAvg ? Math.round(item.ratingAvg) : undefined),
    status: 'masterise',
    tags: ['Rowav Social', item.ownerName],
    markers: [],
    addedAt: item.publishedAt || new Date().toISOString(),
  };
}

export interface PublishableProjectPayload {
  id: string;
  title: string;
  kind: ProjectKind;
  description?: string;
  coverUrl?: string;
  coverGradient?: string;
  releaseDate?: string;
  tracks: Array<{
    id: string;
    title: string;
    artist: string;
    versionLabel?: string;
    coverUrl?: string;
    coverGradient?: string;
    durationSec?: number;
    bpm?: number;
    mood?: TrackMood;
  }>;
}
