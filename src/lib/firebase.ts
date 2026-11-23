import { initializeApp, getApps, deleteApp, type FirebaseApp } from 'firebase/app';
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  createUserWithEmailAndPassword,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  initializeAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  initializeFirestore,
  getFirestore,
  onSnapshot,
  persistentLocalCache,
  persistentMultipleTabManager,
  setDoc,
  updateDoc,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import { getDownloadURL, getStorage, ref, uploadBytes, type FirebaseStorage } from 'firebase/storage';
import type { AppState, FirebaseUserConfig, MusicProject, MusicTrack } from '../types';
import { groupMusicTracks } from './musicVersioning';
import { recompressDataUrl } from './trackCover';

export interface FirebaseBundle {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  storage: FirebaseStorage;
}

let activeBundle: FirebaseBundle | null = null;
let activeConfigKey = '';

export function getEnvFirebaseConfig(): FirebaseUserConfig | null {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY as string | undefined;
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined;
  if (!apiKey || !projectId) return null;
  return {
    apiKey,
    authDomain: (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string) || `${projectId}.firebaseapp.com`,
    projectId,
    storageBucket:
      (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string) || `${projectId}.firebasestorage.app`,
    messagingSenderId: (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string) || '',
    appId: (import.meta.env.VITE_FIREBASE_APP_ID as string) || '',
  };
}

/**
 * Parses either strict JSON or raw JS snippet copied from Firebase Console:
 * e.g. `const firebaseConfig = { apiKey: "...", projectId: "..." };`
 */
export function parseFirebaseConfigSnippet(raw: string): FirebaseUserConfig | null {
  const extract = (key: string): string => {
    const re = new RegExp(`["']?${key}["']?\\s*:\\s*["']([^"']+)["']`);
    return raw.match(re)?.[1]?.trim() || '';
  };
  const apiKey = extract('apiKey');
  const projectId = extract('projectId');
  if (!apiKey || !projectId) return null;
  return {
    apiKey,
    projectId,
    authDomain: extract('authDomain') || `${projectId}.firebaseapp.com`,
    storageBucket: extract('storageBucket') || `${projectId}.firebasestorage.app`,
    messagingSenderId: extract('messagingSenderId'),
    appId: extract('appId'),
  };
}

export function initFirebaseClient(config?: FirebaseUserConfig | null): FirebaseBundle | null {
  const resolved = config?.apiKey && config?.projectId ? config : getEnvFirebaseConfig();
  if (!resolved) return null;

  const key = `${resolved.projectId}:${resolved.apiKey}`;
  if (activeBundle && activeConfigKey === key) return activeBundle;

  try {
    const existing = getApps()[0];
    let app: FirebaseApp;
    if (existing && activeConfigKey === key) {
      app = existing;
    } else {
      if (existing) {
        void deleteApp(existing);
      }
      app = initializeApp(resolved);
    }

    let db: Firestore;
    try {
      db = initializeFirestore(app, {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      });
    } catch {
      db = getFirestore(app);
    }

    let auth: Auth;
    try {
      auth = initializeAuth(app, {
        persistence: [indexedDBLocalPersistence, browserLocalPersistence],
        popupRedirectResolver: browserPopupRedirectResolver,
      });
    } catch {
      auth = getAuth(app);
    }
    const storage = getStorage(app);

    activeBundle = { app, auth, db, storage };
    activeConfigKey = key;
    return activeBundle;
  } catch (err) {
    console.error('[Kora Firebase] Init error:', err);
    return null;
  }
}

export async function signInWithGoogle(
  config?: FirebaseUserConfig | null
): Promise<User | null> {
  const bundle = initFirebaseClient(config);
  if (!bundle) throw new Error('Configuration Firebase manquante');
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  // MUST call signInWithPopup synchronously with ZERO awaits before it,
  // otherwise Safari / Chrome / iOS PWA drop the user-gesture token and block the popup.
  // Avoid cross-origin signInWithRedirect which fails under modern third-party cookie partitioning.
  const res = await signInWithPopup(bundle.auth, provider, browserPopupRedirectResolver);
  return res.user;
}

export async function completeGoogleRedirectIfPending(
  config?: FirebaseUserConfig | null
): Promise<User | null> {
  const bundle = initFirebaseClient(config);
  if (!bundle) return null;
  try {
    const res = await getRedirectResult(bundle.auth, browserPopupRedirectResolver);
    return res?.user || null;
  } catch {
    return null;
  }
}

export async function getCurrentFirebaseIdToken(
  config?: FirebaseUserConfig | null
): Promise<string | null> {
  const bundle = initFirebaseClient(config);
  const user = bundle?.auth.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken();
  } catch {
    return null;
  }
}

/** Requests a read-only Google Drive OAuth access token via Google Sign-In popup */
export async function requestGoogleDriveAccessToken(
  config?: FirebaseUserConfig | null
): Promise<string> {
  const bundle = initFirebaseClient(config);
  if (!bundle) throw new Error('Configuration Firebase manquante');
  const provider = new GoogleAuthProvider();
  provider.addScope('https://www.googleapis.com/auth/drive.readonly');
  provider.setCustomParameters({ prompt: 'consent' });
  const res = await signInWithPopup(bundle.auth, provider, browserPopupRedirectResolver);
  const credential = GoogleAuthProvider.credentialFromResult(res);
  if (!credential?.accessToken) {
    throw new Error('Aucun token Google Drive retourné par Google. Réessaie en autorisant l’accès Drive.');
  }
  return credential.accessToken;
}

/**
 * Requests a read/write Google Drive OAuth access token directly from the user's Google account.
 * Used to create `_Rowav_Data/` files owned by the user (using their personal Google Drive quota,
 * e.g. 15 Go / 5 To) so personal "My Drive" folders bypass Google's 0-byte Service Account quota limit.
 */
export async function requestGoogleDriveWriteAccessToken(
  config?: FirebaseUserConfig | null
): Promise<string> {
  const bundle = initFirebaseClient(config);
  if (!bundle) throw new Error('Configuration Firebase manquante');
  const provider = new GoogleAuthProvider();
  provider.addScope('https://www.googleapis.com/auth/drive');
  provider.setCustomParameters({ prompt: 'consent' });
  const res = await signInWithPopup(bundle.auth, provider, browserPopupRedirectResolver);
  const credential = GoogleAuthProvider.credentialFromResult(res);
  if (!credential?.accessToken) {
    throw new Error('Aucun token Google Drive retourné par Google. Réessaie en autorisant l’accès Drive.');
  }
  return credential.accessToken;
}

/** Requests a read-only Google Calendar OAuth access token via Google Sign-In popup */
export async function requestGoogleCalendarAccessToken(
  config?: FirebaseUserConfig | null
): Promise<string> {
  const bundle = initFirebaseClient(config);
  if (!bundle) throw new Error('Configuration Firebase manquante');
  const provider = new GoogleAuthProvider();
  provider.addScope('https://www.googleapis.com/auth/calendar.readonly');
  provider.setCustomParameters({ prompt: 'consent' });
  const res = await signInWithPopup(bundle.auth, provider, browserPopupRedirectResolver);
  const credential = GoogleAuthProvider.credentialFromResult(res);
  if (!credential?.accessToken) {
    throw new Error(
      'Aucun token Google Agenda retourné par Google. Réessaie en autorisant l’accès Agenda.'
    );
  }
  return credential.accessToken;
}

export async function updateFirebaseDisplayName(
  config: FirebaseUserConfig | null | undefined,
  displayName: string
): Promise<void> {
  const bundle = initFirebaseClient(config);
  if (!bundle?.auth.currentUser) return;
  try {
    await updateProfile(bundle.auth.currentUser, { displayName });
  } catch {
    // Non-blocking
  }
}

export async function signInWithEmail(
  config: FirebaseUserConfig | null | undefined,
  email: string,
  password: string
): Promise<User> {
  const bundle = initFirebaseClient(config);
  if (!bundle) throw new Error('Configuration Firebase manquante');
  const res = await signInWithEmailAndPassword(bundle.auth, email.trim(), password);
  return res.user;
}

export async function signUpWithEmail(
  config: FirebaseUserConfig | null | undefined,
  email: string,
  password: string
): Promise<User> {
  const bundle = initFirebaseClient(config);
  if (!bundle) throw new Error('Configuration Firebase manquante');
  const res = await createUserWithEmailAndPassword(bundle.auth, email.trim(), password);
  return res.user;
}

export async function signOutFirebase(config?: FirebaseUserConfig | null): Promise<void> {
  const bundle = initFirebaseClient(config);
  if (!bundle) return;
  await signOut(bundle.auth);
}

export function listenAuthState(
  config: FirebaseUserConfig | null | undefined,
  cb: (user: User | null) => void
): () => void {
  const bundle = initFirebaseClient(config);
  if (!bundle) {
    cb(null);
    return () => {};
  }
  return onAuthStateChanged(bundle.auth, cb);
}

/**
 * Strictly sanitizes AppState before writing to Firestore:
 * - Strips all `undefined` and `NaN` values
 * - Whitelists nested keys (preferences, nutritionGoals, academicProfile, fitnessProfile, firebaseConfig)
 *   so no legacy/unknown localStorage field can ever trigger Firestore `hasOnly` rejection
 * - Normalizes URLs, clamps numbers, and guarantees a valid integer `updatedAt`
 */
function sanitizeStateForFirestore(state: AppState): Record<string, unknown> {
  const raw = JSON.parse(JSON.stringify(state)) as AppState;
  const numOr = (v: unknown, fallback: number, min: number, max: number): number => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
    return Math.min(max, Math.max(min, v));
  };
  const strOr = (v: unknown, fallback: string, maxLen: number): string => {
    if (typeof v !== 'string') return fallback;
    return v.slice(0, maxLen);
  };
  const optStr = (v: unknown, maxLen: number): string | undefined => {
    if (typeof v !== 'string') return undefined;
    const trimmed = v.slice(0, maxLen);
    return trimmed.length > 0 ? trimmed : undefined;
  };

  const p = raw.preferences || ({} as AppState['preferences']);
  const ng = p.nutritionGoals || ({} as AppState['preferences']['nutritionGoals']);

  let cleanPronoteUrl = optStr(p.pronoteBridgeUrl?.trim(), 2048);
  if (cleanPronoteUrl && !/^https?:\/\//i.test(cleanPronoteUrl)) {
    cleanPronoteUrl = /^(127\.0\.0\.1|localhost)/i.test(cleanPronoteUrl)
      ? `http://${cleanPronoteUrl}`
      : `https://${cleanPronoteUrl}`;
  }

  let cleanAvatarUrl = optStr(p.avatarUrl, 118000);
  if (
    cleanAvatarUrl &&
    !/^https?:\/\//i.test(cleanAvatarUrl) &&
    !/^data:image\/(png|jpeg|jpg|webp|gif|avif);base64,/i.test(cleanAvatarUrl)
  ) {
    cleanAvatarUrl = undefined;
  }

  const cleanPreferences: Record<string, unknown> = {
    name: strOr(p.name, '', 100),
    theme: p.theme === 'dark' ? 'dark' : 'light',
    weightGoalKg: numOr(p.weightGoalKg, 72, 20, 400),
    nutritionGoals: {
      calories: numOr(ng.calories, 2450, 0, 20000),
      protein: numOr(ng.protein, 165, 0, 1000),
      carbs: numOr(ng.carbs, 270, 0, 2000),
      fat: numOr(ng.fat, 75, 0, 1000),
      waterMl: numOr(ng.waterMl, 2500, 0, 20000),
    },
  };
  const cleanBio = optStr(p.bio, 160);
  if (cleanBio) cleanPreferences.bio = cleanBio;
  const cleanAvatarColor = optStr(p.avatarColor, 40);
  if (cleanAvatarColor) cleanPreferences.avatarColor = cleanAvatarColor;
  if (cleanAvatarUrl) cleanPreferences.avatarUrl = cleanAvatarUrl;
  const cleanGemini = optStr(p.geminiApiKey?.trim(), 256);
  if (cleanGemini) cleanPreferences.geminiApiKey = cleanGemini;
  if (cleanPronoteUrl) cleanPreferences.pronoteBridgeUrl = cleanPronoteUrl;
  const cleanPronoteToken = optStr(p.pronoteBridgeToken?.trim(), 256);
  if (cleanPronoteToken) cleanPreferences.pronoteBridgeToken = cleanPronoteToken;
  if (p.firebaseConfig && typeof p.firebaseConfig === 'object' && p.firebaseConfig.apiKey && p.firebaseConfig.projectId) {
    cleanPreferences.firebaseConfig = {
      apiKey: strOr(p.firebaseConfig.apiKey, '', 256),
      authDomain: strOr(p.firebaseConfig.authDomain, '', 256),
      projectId: strOr(p.firebaseConfig.projectId, '', 256),
      storageBucket: strOr(p.firebaseConfig.storageBucket, '', 256),
      messagingSenderId: strOr(p.firebaseConfig.messagingSenderId, '', 256),
      appId: strOr(p.firebaseConfig.appId, '', 256),
    };
  }
  if (p.notifications && typeof p.notifications === 'object') {
    const cleanNotif: Record<string, unknown> = {
      enabled: Boolean(p.notifications.enabled),
      eventsBeforeMin: numOr(p.notifications.eventsBeforeMin, 15, 0, 120),
      homeworkAndExams: Boolean(p.notifications.homeworkAndExams),
      timers: Boolean(p.notifications.timers),
      hydrationAndMacros: Boolean(p.notifications.hydrationAndMacros),
      dailyBriefing: Boolean(p.notifications.dailyBriefing),
      morningHour: strOr(p.notifications.morningHour, '07:45', 10),
    };
    const sub = p.notifications.pushSubscription;
    if (sub && typeof sub.endpoint === 'string' && sub.keys?.p256dh && sub.keys?.auth) {
      cleanNotif.pushSubscription = {
        endpoint: strOr(sub.endpoint, '', 2048),
        keys: {
          p256dh: strOr(sub.keys.p256dh, '', 512),
          auth: strOr(sub.keys.auth, '', 512),
        },
      };
    }
    cleanPreferences.notifications = cleanNotif;
  }
  if (p.activeWorkout && typeof p.activeWorkout === 'object' && p.activeWorkout.session) {
    cleanPreferences.activeWorkout = {
      session: p.activeWorkout.session,
      elapsedSec: numOr(p.activeWorkout.elapsedSec, 0, 0, 86400),
      paused: Boolean(p.activeWorkout.paused),
      lastTickAt: numOr(p.activeWorkout.lastTickAt, Date.now(), 0, 4102444800000),
    };
  }
  if (p.activeFocus && typeof p.activeFocus === 'object' && typeof p.activeFocus.endsAt === 'number') {
    const cleanFocus: Record<string, unknown> = {
      id: strOr(p.activeFocus.id, 'foc', 80),
      label: strOr(p.activeFocus.label, 'Session Focus', 160),
      category: ['cours', 'musique', 'perso'].includes(p.activeFocus.category)
        ? p.activeFocus.category
        : 'cours',
      presetMin: numOr(p.activeFocus.presetMin, 25, 1, 240),
      startedAt: numOr(p.activeFocus.startedAt, Date.now(), 0, 4102444800000),
      endsAt: numOr(p.activeFocus.endsAt, Date.now(), 0, 4102444800000),
    };
    const cleanTrack = optStr(p.activeFocus.linkedTrackId, 120);
    if (cleanTrack) cleanFocus.linkedTrackId = cleanTrack;
    cleanPreferences.activeFocus = cleanFocus;
  }
  if (p.lastSession && typeof p.lastSession === 'object' && p.lastSession.activeTab) {
    const validTabs = ['today', 'planning', 'studies', 'sport', 'music'] as const;
    const validMusicSub = ['dashboard', 'library', 'projects', 'lyrics', 'social', 'profile'] as const;
    const validSportSub = ['gym', 'nutrition', 'poids'] as const;
    const validStudiesSub = ['exams', 'cursus', 'docs', 'pronote'] as const;
    const ls = p.lastSession;
    const cleanSession: Record<string, unknown> = {
      activeTab: (validTabs as readonly string[]).includes(ls.activeTab) ? ls.activeTab : 'today',
      savedAt: numOr(ls.savedAt, Date.now(), 0, 4102444800000),
    };
    if (ls.musicSubTab && (validMusicSub as readonly string[]).includes(ls.musicSubTab)) {
      cleanSession.musicSubTab = ls.musicSubTab;
    }
    if (ls.sportSubTab && (validSportSub as readonly string[]).includes(ls.sportSubTab)) {
      cleanSession.sportSubTab = ls.sportSubTab;
    }
    if (ls.studiesSubTab && (validStudiesSub as readonly string[]).includes(ls.studiesSubTab)) {
      cleanSession.studiesSubTab = ls.studiesSubTab;
    }
    const cleanProjId = optStr(ls.openMusicProjectId, 120);
    if (cleanProjId) cleanSession.openMusicProjectId = cleanProjId;
    const cleanLyrId = optStr(ls.selectedLyricsId, 120);
    if (cleanLyrId) cleanSession.selectedLyricsId = cleanLyrId;
    const cleanAudioId = optStr(ls.audioTrackId, 120);
    if (cleanAudioId) cleanSession.audioTrackId = cleanAudioId;
    if (typeof ls.audioTimeSec === 'number' && Number.isFinite(ls.audioTimeSec) && ls.audioTimeSec >= 0) {
      cleanSession.audioTimeSec = Math.round(Math.min(86400, ls.audioTimeSec));
    }
    if (typeof ls.audioExpanded === 'boolean') {
      cleanSession.audioExpanded = ls.audioExpanded;
    }
    if (typeof ls.scrollY === 'number' && Number.isFinite(ls.scrollY) && ls.scrollY >= 0) {
      cleanSession.scrollY = Math.round(Math.min(100000, ls.scrollY));
    }
    if (ls.livePlayback && typeof ls.livePlayback === 'object' && ls.livePlayback.activeDeviceId) {
      cleanSession.livePlayback = ls.livePlayback;
    }
    if (Array.isArray(ls.driveSources)) {
      cleanSession.driveSources = ls.driveSources.slice(0, 25);
    }
    if (Array.isArray(ls.playlists)) {
      cleanSession.playlists = ls.playlists.slice(0, 80);
    }
    if (Array.isArray(ls.likedSocialTracks)) {
      cleanSession.likedSocialTracks = ls.likedSocialTracks.slice(0, 300);
    }
    cleanPreferences.lastSession = cleanSession;
  }

  const ap = raw.academicProfile || ({} as AppState['academicProfile']);
  const cleanAcademicProfile = {
    program: strOr(ap.program, '', 200),
    level: strOr(ap.level, '', 100),
    school: strOr(ap.school, '', 200),
    careerGoal: strOr(ap.careerGoal, '', 300),
    targetSkills: Array.isArray(ap.targetSkills)
      ? ap.targetSkills.filter((s): s is string => typeof s === 'string').slice(0, 50).map((s) => s.slice(0, 100))
      : [],
    studyPlanSummary: strOr(ap.studyPlanSummary, '', 4000),
  };

  const fp = raw.fitnessProfile || ({} as AppState['fitnessProfile']);
  const validGoals = ['prise-de-masse', 'seche', 'force', 'recomposition', 'endurance'] as const;
  const validLevels = ['debutant', 'intermediaire', 'avance'] as const;
  const cleanFitnessProfile: Record<string, unknown> = {
    goal: (validGoals as readonly string[]).includes(fp.goal) ? fp.goal : 'recomposition',
    level: (validLevels as readonly string[]).includes(fp.level) ? fp.level : 'intermediaire',
    daysPerWeek: numOr(fp.daysPerWeek, 4, 0, 14),
    equipment: strOr(fp.equipment, '', 500),
  };
  if (typeof fp.heightCm === 'number' && Number.isFinite(fp.heightCm) && fp.heightCm >= 80 && fp.heightCm <= 260) {
    cleanFitnessProfile.heightCm = fp.heightCm;
  }
  const cleanFpNotes = optStr(fp.notes, 2000);
  if (cleanFpNotes) cleanFitnessProfile.notes = cleanFpNotes;
  if (Array.isArray(fp.progressPhotos) && fp.progressPhotos.length > 0) {
    const validAngles = ['face', 'profil', 'dos'] as const;
    const cleanPhotos = fp.progressPhotos
      .filter(
        (ph) =>
          ph &&
          typeof ph === 'object' &&
          typeof ph.id === 'string' &&
          typeof ph.date === 'string' &&
          typeof ph.thumbDataUrl === 'string' &&
          /^data:image\/(jpeg|jpg|png|webp);base64,/i.test(ph.thumbDataUrl) &&
          ph.thumbDataUrl.length <= 55_000
      )
      .slice(-36)
      .map((ph) => {
        const entry: Record<string, unknown> = {
          id: strOr(ph.id, 'ph', 80),
          date: strOr(ph.date, '', 20),
          label: strOr(ph.label, 'Check-in', 80),
          angle: (validAngles as readonly string[]).includes(ph.angle) ? ph.angle : 'face',
          thumbDataUrl: ph.thumbDataUrl,
          createdAt: strOr(ph.createdAt, new Date().toISOString(), 40),
        };
        if (typeof ph.weightKg === 'number' && Number.isFinite(ph.weightKg) && ph.weightKg >= 20 && ph.weightKg <= 350) {
          entry.weightKg = Math.round(ph.weightKg * 10) / 10;
        }
        const n = optStr(ph.note, 200);
        if (n) entry.note = n;
        const m = optStr(ph.mediaId, 100);
        if (m) entry.mediaId = m;
        if (ph.isBaseline) entry.isBaseline = true;
        return entry;
      });
    if (cleanPhotos.length > 0) {
      cleanFitnessProfile.progressPhotos = cleanPhotos;
    }
  }

  const ts =
    typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) && raw.updatedAt >= 1577836800000
      ? Math.floor(raw.updatedAt)
      : Date.now();

  // Deduplicate coverDataUrl across sibling versions of each song group so
  // base64 covers are stored only ONCE per song (prevents Firestore 1 MiB limit errors!)
  const rawTracks: MusicTrack[] = Array.isArray(raw.musicTracks)
    ? raw.musicTracks.slice(0, 500)
    : [];
  const dedupedTracks = rawTracks.map((t) => ({ ...t }));
  if (dedupedTracks.length > 0) {
    const groups = groupMusicTracks(dedupedTracks);
    const trackById = new Map(dedupedTracks.map((t) => [t.id, t]));
    for (const grp of groups) {
      const ids = grp.allTrackIds;
      let keptCover: string | undefined;
      for (const id of ids) {
        const trk = trackById.get(id);
        if (trk?.coverDataUrl) {
          keptCover = trk.coverDataUrl;
          break;
        }
      }
      if (keptCover) {
        const ownerId = grp.latestTrack?.id || ids[0];
        for (const id of ids) {
          const trk = trackById.get(id);
          if (!trk) continue;
          if (id === ownerId) trk.coverDataUrl = keptCover;
          else delete trk.coverDataUrl;
        }
      }
    }
  }

  return {
    events: Array.isArray(raw.events) ? raw.events.slice(0, 1000) : [],
    homework: Array.isArray(raw.homework) ? raw.homework.slice(0, 1000) : [],
    exams: Array.isArray(raw.exams) ? raw.exams.slice(0, 500) : [],
    academicProfile: cleanAcademicProfile,
    subjects: Array.isArray(raw.subjects) ? raw.subjects.slice(0, 200) : [],
    grades: Array.isArray(raw.grades) ? raw.grades.slice(0, 1000) : [],
    courseDocs: Array.isArray(raw.courseDocs) ? raw.courseDocs.slice(0, 500) : [],
    tasks: Array.isArray(raw.tasks) ? raw.tasks.slice(0, 1500) : [],
    workouts: Array.isArray(raw.workouts) ? raw.workouts.slice(0, 1000) : [],
    workoutRoutines: Array.isArray(raw.workoutRoutines) ? raw.workoutRoutines.slice(0, 200) : [],
    fitnessProfile: cleanFitnessProfile,
    meals: Array.isArray(raw.meals) ? raw.meals.slice(0, 2000) : [],
    mealPresets: Array.isArray(raw.mealPresets) ? raw.mealPresets.slice(0, 200) : [],
    weights: Array.isArray(raw.weights) ? raw.weights.slice(0, 1500) : [],
    waterMlByDate: raw.waterMlByDate && typeof raw.waterMlByDate === 'object' ? raw.waterMlByDate : {},
    musicTracks: dedupedTracks,
    lyricsFolders: Array.isArray(raw.lyricsFolders) ? raw.lyricsFolders.slice(0, 200) : [],
    lyricsDocs: Array.isArray(raw.lyricsDocs) ? raw.lyricsDocs.slice(0, 500) : [],
    musicProjects: Array.isArray(raw.musicProjects) ? raw.musicProjects.slice(0, 200) : [],
    energyCheckins: raw.energyCheckins && typeof raw.energyCheckins === 'object' ? raw.energyCheckins : {},
    focusSessions: Array.isArray(raw.focusSessions) ? raw.focusSessions.slice(0, 2000) : [],
    preferences: cleanPreferences,
    updatedAt: ts,
  };
}

export function formatFirebaseSyncError(err: unknown): string {
  const e = err as { code?: string; message?: string } | null;
  const code = e?.code || '';
  const msg = e?.message || String(err || 'Erreur inconnue');
  if (code === 'permission-denied' || /permission|insufficient/i.test(msg)) {
    const project = activeBundle?.app.options.projectId || 'inconnu';
    const uid = activeBundle?.auth.currentUser?.uid || 'non-connecté';
    return `Accès Firestore refusé (permission-denied · projet=${project} · uid=${uid.slice(0, 6)}…). Vérifie que les dernières firestore.rules sont publiées dans Firebase Console → Firestore Database → Règles.`;
  }
  if (code === 'unavailable' || /offline|network/i.test(msg)) {
    return 'Hors ligne : les modifications seront synchronisées dès le retour du réseau.';
  }
  return msg;
}

export async function fetchCloudStateOnce(
  config: FirebaseUserConfig | null | undefined,
  uid: string
): Promise<AppState | null> {
  const bundle = initFirebaseClient(config);
  if (!bundle) return null;
  const refDoc = doc(bundle.db, 'users', uid, 'appState', 'main');
  const snap = await getDoc(refDoc);
  if (!snap.exists()) return null;
  return snap.data() as AppState;
}

export async function pushStateToCloud(
  config: FirebaseUserConfig | null | undefined,
  uid: string,
  state: AppState
): Promise<number> {
  const bundle = initFirebaseClient(config);
  if (!bundle) return state.updatedAt || Date.now();
  const refDoc = doc(bundle.db, 'users', uid, 'appState', 'main');
  const cleanPayload = sanitizeStateForFirestore(state);

  // Safety guard against Firestore's 1,048,576 byte document limit:
  // If inline cover images push the payload near the limit, auto-recompress them cleanly.
  const estimateBytes = (obj: Record<string, unknown>) =>
    new TextEncoder().encode(JSON.stringify(obj)).length;

  const passes: Array<[number, number]> = [
    [200, 0.62],
    [150, 0.52],
  ];
  for (const [maxPx, q] of passes) {
    if (estimateBytes(cleanPayload) <= 920_000) break;
    const tracks = cleanPayload.musicTracks as MusicTrack[];
    for (const t of tracks) {
      if (t.coverDataUrl && t.coverDataUrl.length > 10_000) {
        t.coverDataUrl = await recompressDataUrl(t.coverDataUrl, maxPx, q);
      }
    }
    const projects = cleanPayload.musicProjects as MusicProject[];
    for (const p of projects) {
      if (p.coverDataUrl && p.coverDataUrl.length > 16_000) {
        p.coverDataUrl = await recompressDataUrl(p.coverDataUrl, maxPx + 40, q);
      }
    }
  }

  await setDoc(refDoc, cleanPayload);
  return cleanPayload.updatedAt as number;
}

/** Ultra-lightweight Firestore delta write (~350 bytes) for real-time Spotify Connect playback sync */
export async function pushLivePlaybackDelta(
  config: FirebaseUserConfig | null | undefined,
  uid: string,
  livePlayback: AppState['preferences']['lastSession'] extends { livePlayback?: infer T } ? T : unknown
): Promise<number> {
  const bundle = initFirebaseClient(config);
  const ts = Date.now();
  if (!bundle) return ts;
  const refDoc = doc(bundle.db, 'users', uid, 'appState', 'main');
  const sanitized = livePlayback ? JSON.parse(JSON.stringify(livePlayback)) : null;
  await updateDoc(refDoc, {
    'preferences.lastSession.livePlayback': sanitized,
    updatedAt: ts,
  });
  return ts;
}

export function subscribeCloudState(
  config: FirebaseUserConfig | null | undefined,
  uid: string,
  onRemoteState: (remote: AppState, meta: { fromCache: boolean }) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const bundle = initFirebaseClient(config);
  if (!bundle) return () => {};
  const refDoc = doc(bundle.db, 'users', uid, 'appState', 'main');
  return onSnapshot(
    refDoc,
    (snap) => {
      if (!snap.exists()) return;
      if (snap.metadata.hasPendingWrites) return;
      const data = snap.data() as AppState;
      if (data && typeof data === 'object') {
        onRemoteState(data, { fromCache: snap.metadata.fromCache });
      }
    },
    (err) => {
      console.error('[Kora Sync] Snapshot error:', err);
      onError?.(err);
    }
  );
}

export async function uploadCloudMedia(
  config: FirebaseUserConfig | null | undefined,
  uid: string,
  mediaId: string,
  blob: Blob
): Promise<string | null> {
  const bundle = initFirebaseClient(config);
  if (!bundle) return null;
  const storageRef = ref(bundle.storage, `users/${uid}/media/${mediaId}`);
  await uploadBytes(storageRef, blob, { contentType: blob.type || 'application/octet-stream' });
  return await getDownloadURL(storageRef);
}
