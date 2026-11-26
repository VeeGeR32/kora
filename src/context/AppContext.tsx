import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import type {
  AcademicProfile,
  ActiveFocusSession,
  ActiveWorkoutDraft,
  AppState,
  AudioMarker,
  CourseDocument,
  CourseSubject,
  DriveSource,
  EnergyCheckin,
  ExamItem,
  FitnessProfile,
  FocusSession,
  GradeEntry,
  HomeworkItem,
  LastSessionState,
  LivePlaybackCommand,
  LivePlaybackState,
  LyricsDoc,
  LyricsFolder,
  MealEntry,
  MealPreset,
  MusicPlaylist,
  MusicProject,
  MusicTrack,
  ScheduleEvent,
  SocialTrackItem,
  TaskItem,
  UserPreferences,
  WeightEntry,
  WorkoutExercise,
  WorkoutRoutine,
  WorkoutSession,
} from '../types';
import {
  extractDriveFolderId,
  fetchPermanentDriveSession,
  isExcludedProdName,
  isGenericProjectFilename,
  listAllGoogleDriveAudioFilesWithExclusions,
  verifyDriveFolderAccess,
} from '../lib/googleDrive';
import {
  getDeterministicGradientId,
  groupMusicTracks,
  normalizeGroupKey,
  parseTrackVersion,
  reconcileProjectTrackVersions,
} from '../lib/musicVersioning';
import { createEmptyState, createSeedState } from '../data/seed';
import { postSocialAction } from '../lib/socialApi';
import { uid } from '../utils/dates';
import {
  completeGoogleRedirectIfPending,
  fetchCloudStateOnce,
  formatFirebaseSyncError,
  getEnvFirebaseConfig,
  listenAuthState,
  pushAvatarDelta,
  pushLiveCommandDelta,
  pushLivePlaybackDelta,
  pushStateToCloud,
  requestGoogleDriveWriteAccessToken,
  signInWithEmail,
  signInWithGoogle,
  signOutFirebase,
  signUpWithEmail,
  subscribeCloudState,
  updateFirebaseDisplayName,
  uploadCloudMedia,
} from '../lib/firebase';
import { deleteMediaBlob, saveMediaBlob } from '../lib/mediaDb';
import {
  setCachedPrimaryDriveFolderId,
  setCachedUserDriveWriteToken,
  syncStudioBackupToUserDrive,
} from '../lib/driveStorage';

const STORAGE_KEY = 'kora_app_state_v2';
const LEGACY_KEY = 'tempo_app_state_v1';

export interface ToastMessage {
  id: string;
  text: string;
  undo?: () => void;
}

interface AppContextValue {
  state: AppState;
  toast: ToastMessage | null;
  dismissToast: () => void;
  notify: (text: string, undo?: () => void) => void;

  // Firebase Cloud Sync
  cloudUser: User | null;
  authReady: boolean;
  authError: string | null;
  clearAuthError: () => void;
  cloudConfigured: boolean;
  cloudSyncing: boolean;
  cloudError: string | null;
  lastCloudSyncAt: number | null;
  connectGoogleCloud: () => Promise<void>;
  connectEmailCloud: (email: string, password: string) => Promise<void>;
  registerEmailCloud: (email: string, password: string, displayName?: string) => Promise<void>;
  forceSaveCloud: (overridePreferences?: Partial<UserPreferences>) => Promise<void>;
  disconnectGoogleCloud: () => Promise<void>;
  saveAndOptionallySyncMedia: (mediaId: string, blob: Blob, name: string) => Promise<{ mediaId: string; cloudUrl?: string }>;

  // Events
  addEvent: (event: Omit<ScheduleEvent, 'id'>) => void;
  addManyEvents: (events: Omit<ScheduleEvent, 'id'>[]) => void;
  syncGoogleCalendarEvents: (events: Omit<ScheduleEvent, 'id'>[]) => { added: number; updated: number };
  updateEvent: (id: string, patch: Partial<ScheduleEvent>) => void;
  deleteEvent: (id: string) => void;

  // Homework
  addHomework: (item: Omit<HomeworkItem, 'id'>) => void;
  toggleHomework: (id: string) => void;
  updateHomework: (id: string, patch: Partial<HomeworkItem>) => void;
  deleteHomework: (id: string) => void;

  // Exams
  addExam: (exam: Omit<ExamItem, 'id'>) => void;
  updateExam: (id: string, patch: Partial<ExamItem>) => void;
  toggleExamTopic: (examId: string, topicId: string) => void;
  addExamTopic: (examId: string, label: string) => void;
  deleteExamTopic: (examId: string, topicId: string) => void;
  deleteExam: (id: string) => void;

  // Academic Profile, Subjects, Grades, Docs
  updateAcademicProfile: (patch: Partial<AcademicProfile>) => void;
  addSubject: (sub: Omit<CourseSubject, 'id'>) => void;
  updateSubject: (id: string, patch: Partial<CourseSubject>) => void;
  deleteSubject: (id: string) => void;
  addGrade: (grade: Omit<GradeEntry, 'id'>) => void;
  addManyGrades: (grades: Omit<GradeEntry, 'id'>[]) => void;
  deleteGrade: (id: string) => void;
  addCourseDoc: (doc: Omit<CourseDocument, 'id'>) => void;
  deleteCourseDoc: (id: string) => void;

  // Tasks
  addTask: (task: Omit<TaskItem, 'id'>) => void;
  toggleTask: (id: string) => void;
  updateTask: (id: string, patch: Partial<TaskItem>) => void;
  deleteTask: (id: string) => void;

  // Workouts & Hevy Routines
  addWorkout: (workout: Omit<WorkoutSession, 'id'>) => string;
  updateWorkout: (id: string, patch: Partial<WorkoutSession>) => void;
  toggleWorkoutSet: (workoutId: string, exerciseId: string, setId: string) => void;
  updateWorkoutSet: (
    workoutId: string,
    exerciseId: string,
    setId: string,
    patch: { reps?: number; weightKg?: number; type?: 'warmup' | 'normal' | 'failure' }
  ) => void;
  addWorkoutSet: (workoutId: string, exerciseId: string) => void;
  deleteWorkoutSet: (workoutId: string, exerciseId: string, setId: string) => void;
  addWorkoutExercise: (workoutId: string, exercise: Omit<WorkoutExercise, 'id'>) => void;
  deleteWorkoutExercise: (workoutId: string, exerciseId: string) => void;
  deleteWorkout: (id: string) => void;
  addRoutine: (routine: Omit<WorkoutRoutine, 'id'>) => void;
  updateRoutine: (id: string, patch: Partial<WorkoutRoutine>) => void;
  deleteRoutine: (id: string) => void;
  updateFitnessProfile: (patch: Partial<FitnessProfile>) => void;

  // Nutrition & Water
  addMeal: (meal: Omit<MealEntry, 'id'>) => void;
  deleteMeal: (id: string) => void;
  addMealPreset: (preset: Omit<MealPreset, 'id'>) => void;
  deleteMealPreset: (id: string) => void;
  addWater: (dateISO: string, deltaMl: number) => void;

  // Weight
  addWeight: (entry: Omit<WeightEntry, 'id'>) => void;
  deleteWeight: (id: string) => void;

  // Music Studio & LexCore
  autoSyncingDrive: boolean;
  driveSources: DriveSource[];
  serviceAccountEmail: string | null;
  driveStorageStatus: 'idle' | 'syncing' | 'synced' | 'readonly' | 'needs_oauth';
  driveLastBackupAt: string | null;
  syncStudioDataToDriveNow: (silent?: boolean, explicitUserDriveToken?: string | null) => Promise<boolean>;
  authorizeDriveWriteAndSync: () => Promise<boolean>;
  connectDriveSource: (
    folderInput: string,
    customName?: string
  ) => Promise<{ ok: boolean; error?: string; source?: DriveSource }>;
  updateDriveSource: (
    sourceId: string,
    patch: { name?: string; folderInput?: string }
  ) => Promise<{ ok: boolean; error?: string }>;
  toggleDriveSource: (sourceId: string) => Promise<void>;
  removeDriveSource: (sourceId: string) => Promise<void>;
  syncAllConnectedDrives: (options?: {
    overrideSources?: DriveSource[];
    silent?: boolean;
    forceRefresh?: boolean;
    onProgress?: (text: string) => void;
  }) => Promise<{ added: number; updated: number; removed: number }>;
  playlists: MusicPlaylist[];
  likedSocialTracks: SocialTrackItem[];
  createPlaylist: (data: {
    title: string;
    description?: string;
    coverDataUrl?: string;
    coverGradient?: string;
    ownTrackIds?: string[];
    socialTrackIds?: string[];
  }) => string;
  updatePlaylist: (id: string, patch: Partial<MusicPlaylist>) => void;
  deletePlaylist: (id: string) => void;
  toggleTrackInPlaylist: (playlistId: string, trackId: string, kind: 'own' | 'social') => void;
  toggleLikeSocialTrack: (track: SocialTrackItem, forceLiked?: boolean) => boolean;
  updateLikedSocialTrackMeta: (trackId: string, patch: Partial<SocialTrackItem>) => void;
  addMusicTrack: (track: Omit<MusicTrack, 'id'>) => string;
  syncMusicTracksBatch: (
    incoming: Omit<MusicTrack, 'id'>[],
    excludedDriveIds?: string[],
    pruneMissingDriveIds?: boolean,
    allowEmptyPrune?: boolean,
    preservedDriveSourceIds?: string[]
  ) => { added: number; updated: number; removed: number };
  updateMusicTrack: (id: string, patch: Partial<MusicTrack>) => void;
  renameTrackGroup: (trackIds: string[], newTitle: string) => void;
  setTrackGroupCover: (
    trackIds: string[],
    cover: { coverDataUrl?: string | null; coverGradient?: string }
  ) => void;
  setTrackGroupFavorite: (trackIds: string[], isFavorite: boolean) => void;
  setTrackGroupRatings: (
    trackIds: string[],
    ratings: { ratingCurrent?: number | null; ratingPotential?: number | null }
  ) => void;
  setTrackGroupWorkflow: (
    trackIds: string[],
    patch: { status?: import('../types').TrackStatus; mood?: import('../types').TrackMood | null }
  ) => void;
  selectGroupPreferredVersion: (targetTrackId: string, kind: 'song' | 'prod') => void;
  addMusicTrackTodo: (trackId: string, label: string) => void;
  toggleMusicTrackTodo: (trackId: string, todoId: string) => void;
  deleteMusicTrackTodo: (trackId: string, todoId: string) => void;
  addTrackMarker: (trackId: string, marker: Omit<AudioMarker, 'id'>) => void;
  deleteTrackMarker: (trackId: string, markerId: string) => void;
  deleteMusicTrack: (id: string) => void;

  addLyricsFolder: (name: string, parentId: string | null) => string;
  renameLyricsFolder: (id: string, name: string) => void;
  moveLyricsFolder: (id: string, parentId: string | null) => void;
  deleteLyricsFolder: (id: string) => void;

  addLyricsDoc: (doc: Partial<Omit<LyricsDoc, 'id'>>) => string;
  updateLyricsDoc: (id: string, patch: Partial<LyricsDoc>) => void;
  softDeleteLyricsDoc: (id: string) => void;
  restoreLyricsDoc: (id: string) => void;
  permanentDeleteLyricsDoc: (id: string) => void;
  emptyLyricsTrash: () => void;
  importLexCoreBackup: (
    folders: LyricsFolder[],
    docs: LyricsDoc[]
  ) => { foldersAdded: number; docsAdded: number; skipped: number };

  addMusicProject: (project: Omit<MusicProject, 'id'>) => string;
  updateMusicProject: (id: string, patch: Partial<MusicProject>) => void;
  setProjectTrackVersion: (
    projectId: string,
    groupKey: string,
    trackId: string,
    mode?: 'auto' | 'pin'
  ) => void;
  toggleMusicProjectStep: (projectId: string, stepId: string) => void;
  addMusicProjectStep: (projectId: string, label: string, dueDate?: string) => void;
  deleteMusicProjectStep: (projectId: string, stepId: string) => void;
  deleteMusicProject: (id: string) => void;

  // Energy & Focus + Persistent Live Sessions
  setEnergyCheckin: (checkin: EnergyCheckin) => void;
  addFocusSession: (session: Omit<FocusSession, 'id'>) => void;
  workoutModalOpen: boolean;
  setWorkoutModalOpen: (open: boolean) => void;
  startActiveWorkout: (session: WorkoutSession) => void;
  updateActiveWorkout: (draft: ActiveWorkoutDraft | null) => void;
  finishActiveWorkout: (completed: WorkoutSession) => void;
  discardActiveWorkout: () => void;
  startActiveFocus: (focus: ActiveFocusSession) => void;
  stopActiveFocus: () => void;
  completeActiveFocus: () => void;

  // Preferences & Data
  updatePreferences: (patch: Partial<UserPreferences>) => void;
  updateUserAvatar: (avatarUrl: string | null, avatarColor?: string) => Promise<void>;
  updateLastSession: (patch: Partial<Omit<LastSessionState, 'savedAt'>>) => void;
  livePlayback: LivePlaybackState | null;
  liveCommand: LivePlaybackCommand | null;
  publishLivePlayback: (live: LivePlaybackState | null) => Promise<void>;
  publishLiveCommand: (cmd: LivePlaybackCommand | null) => Promise<void>;
  toggleTheme: () => void;
  resetToDemo: () => void;
  clearAllData: () => void;
  importStateJSON: (json: string) => boolean;
  exportStateJSON: () => string;
}

const AppContext = createContext<AppContextValue | null>(null);

function formatAuthError(err: unknown): string {
  const e = err as { code?: string; message?: string } | null;
  const code = e?.code || '';
  if (code === 'auth/popup-closed-by-user') {
    return 'Fenêtre Google fermée avant la fin. Réessaie en cliquant sur Continuer avec Google.';
  }
  if (code === 'auth/popup-blocked') {
    return 'Fenêtre Google bloquée par ton navigateur : autorise les popups pour ce site (ou connecte-toi par email).';
  }
  if (code === 'auth/unauthorized-domain') {
    return `Domaine non autorisé (${window.location.hostname}) dans Firebase Auth → Domaines autorisés.`;
  }
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
    return 'Email ou mot de passe incorrect.';
  }
  if (code === 'auth/email-already-in-use') {
    return 'Un compte existe déjà avec cet email.';
  }
  if (code === 'auth/network-request-failed') {
    return 'Erreur réseau (vérifie ta connexion ou un bloqueur de pub/cookies tiers).';
  }
  return e?.message || 'Erreur de connexion';
}

function normalizeEvents(events: ScheduleEvent[]): ScheduleEvent[] {
  return events.map((ev) => ({
    ...ev,
    type: (ev.type as string) === 'studio' ? 'music' : ev.type,
  }));
}

function mergeWithSeed(parsed: Partial<AppState> | null): AppState {
  const seed = createSeedState();
  if (!parsed || typeof parsed !== 'object') return seed;
  return {
    events: Array.isArray(parsed.events) ? normalizeEvents(parsed.events) : seed.events,
    homework: Array.isArray(parsed.homework) ? parsed.homework : seed.homework,
    exams: Array.isArray(parsed.exams) ? parsed.exams : seed.exams,
    academicProfile: {
      ...seed.academicProfile,
      ...(parsed.academicProfile || {}),
      targetSkills: Array.isArray(parsed.academicProfile?.targetSkills)
        ? parsed.academicProfile.targetSkills
        : seed.academicProfile.targetSkills,
    },
    subjects: Array.isArray(parsed.subjects) ? parsed.subjects : seed.subjects,
    grades: Array.isArray(parsed.grades) ? parsed.grades : seed.grades,
    courseDocs: Array.isArray(parsed.courseDocs) ? parsed.courseDocs : seed.courseDocs,
    tasks: Array.isArray(parsed.tasks) ? parsed.tasks : seed.tasks,
    workouts: Array.isArray(parsed.workouts) ? parsed.workouts : seed.workouts,
    workoutRoutines: Array.isArray(parsed.workoutRoutines) ? parsed.workoutRoutines : seed.workoutRoutines,
    fitnessProfile: { ...seed.fitnessProfile, ...(parsed.fitnessProfile || {}) },
    meals: Array.isArray(parsed.meals) ? parsed.meals : seed.meals,
    mealPresets: Array.isArray(parsed.mealPresets) ? parsed.mealPresets : seed.mealPresets,
    weights: Array.isArray(parsed.weights) ? parsed.weights : seed.weights,
    waterMlByDate: parsed.waterMlByDate && typeof parsed.waterMlByDate === 'object' ? parsed.waterMlByDate : seed.waterMlByDate,
    musicTracks: Array.isArray(parsed.musicTracks) ? parsed.musicTracks : seed.musicTracks,
    lyricsFolders: Array.isArray(parsed.lyricsFolders) ? parsed.lyricsFolders : seed.lyricsFolders,
    lyricsDocs: Array.isArray(parsed.lyricsDocs) ? parsed.lyricsDocs : seed.lyricsDocs,
    musicProjects: Array.isArray(parsed.musicProjects) ? parsed.musicProjects : seed.musicProjects,
    energyCheckins:
      parsed.energyCheckins && typeof parsed.energyCheckins === 'object'
        ? parsed.energyCheckins
        : seed.energyCheckins,
    focusSessions: Array.isArray(parsed.focusSessions) ? parsed.focusSessions : seed.focusSessions,
    preferences: {
      ...seed.preferences,
      ...(parsed.preferences || {}),
      nutritionGoals: {
        ...seed.preferences.nutritionGoals,
        ...(parsed.preferences?.nutritionGoals || {}),
      },
    },
    updatedAt: parsed.updatedAt || Date.now(),
  };
}

function loadInitialState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_KEY);
    if (!raw) return { ...createEmptyState(), updatedAt: 0 };
    const merged = mergeWithSeed(JSON.parse(raw) as Partial<AppState>);
    // Always restore any in-progress workout in PAUSED mode after app close/reopen
    if (merged.preferences.activeWorkout) {
      merged.preferences = {
        ...merged.preferences,
        activeWorkout: {
          ...merged.preferences.activeWorkout,
          paused: true,
        },
      };
    }
    return merged;
  } catch {
    return { ...createEmptyState(), updatedAt: 0 };
  }
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(loadInitialState);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [cloudUser, setCloudUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [lastCloudSyncAt, setLastCloudSyncAt] = useState<number | null>(null);
  const [workoutModalOpen, setWorkoutModalOpen] = useState(false);
  const [autoSyncingDrive, setAutoSyncingDrive] = useState(false);
  const [serviceAccountEmail, setServiceAccountEmail] = useState<string | null>(null);
  const [livePlayback, setLivePlayback] = useState<LivePlaybackState | null>(null);
  const [liveCommand, setLiveCommand] = useState<LivePlaybackCommand | null>(null);
  const lastLiveSigRef = useRef<string>('');
  const lastCmdIdRef = useRef<string>('');
  const connectChannelRef = useRef<BroadcastChannel | null>(null);
  const isLocalActiveConnectRef = useRef<boolean>(false);

  const buildLiveSig = (rLive: LivePlaybackState | null) =>
    rLive
      ? `${rLive.activeDeviceId}:${rLive.claimSeq ?? 0}:${rLive.updatedAt}:${rLive.trackId}:${rLive.isPlaying}:${Math.round(rLive.positionSec)}:${rLive.repeatMode || ''}:${String(rLive.shuffle)}:${rLive.ackCommandId || ''}`
      : 'null';

  // Instant (<1ms) same-browser multi-tab Connect bridge via BroadcastChannel
  useEffect(() => {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel('rowav_connect_v1');
    connectChannelRef.current = ch;
    ch.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as
        | { kind: 'livePlayback'; payload: LivePlaybackState | null }
        | { kind: 'liveCommand'; payload: LivePlaybackCommand | null }
        | { kind: 'hello' }
        | null;
      if (!msg || typeof msg !== 'object') return;
      if (msg.kind === 'hello') {
        // A newly opened tab is asking if any tab in this browser is currently active!
        if (isLocalActiveConnectRef.current) {
          const activeLive = latestStateRef.current.preferences?.lastSession?.livePlayback ?? null;
          if (activeLive) {
            try {
              ch.postMessage({ kind: 'livePlayback', payload: activeLive });
            } catch {
              // ignore
            }
          }
        }
        return;
      }
      if (msg.kind === 'livePlayback') {
        const rLive = msg.payload ?? null;
        isLocalActiveConnectRef.current = false;
        const sig = buildLiveSig(rLive);
        if (sig !== lastLiveSigRef.current) {
          lastLiveSigRef.current = sig;
          setLivePlayback(rLive);
        }
      } else if (msg.kind === 'liveCommand') {
        const rCmd = msg.payload ?? null;
        const cid = rCmd?.id || '';
        if (cid && cid !== lastCmdIdRef.current) {
          lastCmdIdRef.current = cid;
          setLiveCommand(rCmd);
        }
      }
    };
    // Ask already-open tabs in this browser for any active playback right away (<2ms sync!)
    try {
      ch.postMessage({ kind: 'hello' });
    } catch {
      // ignore
    }
    return () => {
      ch.close();
      if (connectChannelRef.current === ch) connectChannelRef.current = null;
    };
  }, []);

  const lastDriveAutoSyncAtRef = useRef<number>(0);
  const driveSyncInFlightRef = useRef<boolean>(false);

  const clearAuthError = useCallback(() => setAuthError(null), []);

  const toastTimer = useRef<number | null>(null);
  const cloudPushTimer = useRef<number | null>(null);
  const ignoreNextPushRef = useRef(false);
  const cloudHydratedRef = useRef(false);
  const lastPushedUpdatedAtRef = useRef<number>(0);
  const latestStateRef = useRef(state);
  latestStateRef.current = state;

  const resolvedFbConfig = state.preferences.firebaseConfig?.apiKey
    ? state.preferences.firebaseConfig
    : getEnvFirebaseConfig();
  const cloudConfigured = Boolean(resolvedFbConfig?.apiKey && resolvedFbConfig?.projectId);

  // Persist to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore quota errors
    }
  }, [state]);

  // Dark mode + dynamic mobile status-bar theme-color sync
  useEffect(() => {
    const isDark = state.preferences.theme === 'dark';
    document.documentElement.classList.toggle('dark', isDark);
    const color = isDark ? '#0e0e11' : '#ffffff';
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = color;
  }, [state.preferences.theme]);

  // Listen to Firebase Auth state & resolve any pending Google redirect sign-in
  useEffect(() => {
    if (!cloudConfigured) {
      setCloudUser(null);
      setAuthReady(true);
      return;
    }
    void completeGoogleRedirectIfPending(resolvedFbConfig).catch((err) => {
      const code = (err as { code?: string })?.code || '';
      if (code && code !== 'auth/no-current-user') {
        setAuthError(formatAuthError(err));
      }
    });
    return listenAuthState(resolvedFbConfig, (user) => {
      setCloudUser(user);
      if (user) setAuthError(null);
      setAuthReady(true);
    });
  }, [cloudConfigured, resolvedFbConfig?.apiKey, resolvedFbConfig?.projectId]);

  // Hydrate from Firestore FIRST on sign-in, then subscribe to live remote updates
  useEffect(() => {
    cloudHydratedRef.current = false;
    setCloudError(null);
    if (!cloudUser || !cloudConfigured) return;

    let cancelled = false;
    let unsub: (() => void) | null = null;

    const hydrateAndSubscribe = async () => {
      try {
        setCloudSyncing(true);
        const remote = await fetchCloudStateOnce(resolvedFbConfig, cloudUser.uid);
        if (cancelled) return;

        if (remote) {
          // Always trust existing cloud studio data on sign-in, while preserving THIS device's own local UI navigation!
          ignoreNextPushRef.current = true;
          lastPushedUpdatedAtRef.current = remote.updatedAt || 0;
          const localLs = latestStateRef.current.preferences?.lastSession;
          const merged = mergeWithSeed(remote);
          if (localLs) {
            merged.preferences = {
              ...merged.preferences,
              lastSession: {
                ...(merged.preferences.lastSession || { activeTab: 'music', savedAt: Date.now() }),
                activeTab: localLs.activeTab,
                musicSubTab: localLs.musicSubTab,
                sportSubTab: localLs.sportSubTab,
                studiesSubTab: localLs.studiesSubTab,
                openMusicProjectId: localLs.openMusicProjectId,
                selectedLyricsId: localLs.selectedLyricsId,
                audioTrackId: localLs.audioTrackId,
                audioTimeSec: localLs.audioTimeSec,
                audioExpanded: localLs.audioExpanded,
                scrollY: localLs.scrollY,
              },
            };
          }
          setState(merged);
          const initLive = remote.preferences?.lastSession?.livePlayback ?? null;
          const initCmd = remote.preferences?.lastSession?.liveCommand ?? null;
          // Only adopt Firestore's initial livePlayback if a same-browser tab didn't already give us a fresher one via BroadcastChannel!
          if (!lastLiveSigRef.current) {
            lastLiveSigRef.current = buildLiveSig(initLive);
            setLivePlayback(initLive);
          }
          if (!lastCmdIdRef.current) {
            lastCmdIdRef.current = initCmd?.id || '';
            setLiveCommand(initCmd);
          }
          setLastCloudSyncAt(Date.now());
          setCloudError(null);
        } else {
          // Brand new account in Firestore: start with a clean empty studio state!
          const defaultName =
            cloudUser.displayName?.trim() || cloudUser.email?.split('@')[0] || '';
          const freshEmpty = createEmptyState();
          const newAccountState: AppState = {
            ...freshEmpty,
            preferences: {
              ...freshEmpty.preferences,
              name: defaultName,
              theme: latestStateRef.current.preferences.theme || 'dark',
            },
            updatedAt: Date.now(),
          };
          ignoreNextPushRef.current = true;
          latestStateRef.current = newAccountState;
          setState(newAccountState);
          const ts = await pushStateToCloud(resolvedFbConfig, cloudUser.uid, newAccountState);
          lastPushedUpdatedAtRef.current = ts;
          setLastCloudSyncAt(Date.now());
          setCloudError(null);
        }
      } catch (err) {
        console.error('[Kora Sync] Hydrate error:', err);
        if (!cancelled) {
          setCloudError(formatFirebaseSyncError(err));
        }
      } finally {
        if (!cancelled) {
          cloudHydratedRef.current = true;
          setCloudSyncing(false);
          unsub = subscribeCloudState(
            resolvedFbConfig,
            cloudUser.uid,
            (remote, meta) => {
              // 1. ALWAYS propagate Connect livePlayback & liveCommand immediately from server snapshots
              const rLive = remote.preferences?.lastSession?.livePlayback ?? null;
              const rCmd = remote.preferences?.lastSession?.liveCommand ?? null;
              if (!meta.fromCache) {
                const nextLiveSig = buildLiveSig(rLive);
                if (nextLiveSig !== lastLiveSigRef.current) {
                  lastLiveSigRef.current = nextLiveSig;
                  setLivePlayback(rLive);
                }
                const nextCmdId = rCmd?.id || '';
                if (nextCmdId && nextCmdId !== lastCmdIdRef.current) {
                  lastCmdIdRef.current = nextCmdId;
                  setLiveCommand(rCmd);
                }
              }

              // 2. Merge ONLY real studio data updates (Connect deltas do NOT change `updatedAt`, so they never re-render the app!)
              const remoteTs = remote.updatedAt || 0;
              const localTs = latestStateRef.current.updatedAt || 0;
              if (remoteTs === lastPushedUpdatedAtRef.current || remoteTs === localTs) return;
              if (!meta.fromCache || remoteTs > localTs) {
                ignoreNextPushRef.current = true;
                lastPushedUpdatedAtRef.current = remoteTs;
                const localLs = latestStateRef.current.preferences?.lastSession;
                const merged = mergeWithSeed(remote);
                if (localLs) {
                  merged.preferences = {
                    ...merged.preferences,
                    lastSession: {
                      ...(merged.preferences.lastSession || { activeTab: 'music', savedAt: Date.now() }),
                      activeTab: localLs.activeTab,
                      musicSubTab: localLs.musicSubTab,
                      sportSubTab: localLs.sportSubTab,
                      studiesSubTab: localLs.studiesSubTab,
                      openMusicProjectId: localLs.openMusicProjectId,
                      selectedLyricsId: localLs.selectedLyricsId,
                      audioTrackId: localLs.audioTrackId,
                      audioTimeSec: localLs.audioTimeSec,
                      audioExpanded: localLs.audioExpanded,
                      scrollY: localLs.scrollY,
                    },
                  };
                }
                setState(merged);
                setLastCloudSyncAt(Date.now());
                setCloudError(null);
              }
            },
            (err) => {
              setCloudError(formatFirebaseSyncError(err));
            }
          );
        }
      }
    };

    void hydrateAndSubscribe();

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [cloudUser?.uid, cloudConfigured]);

  // Debounced push to Firestore ONLY after cloud hydration finished
  useEffect(() => {
    if (!cloudUser || !cloudConfigured || !cloudHydratedRef.current) return;
    if (ignoreNextPushRef.current) {
      ignoreNextPushRef.current = false;
      return;
    }
    if (cloudPushTimer.current) window.clearTimeout(cloudPushTimer.current);
    cloudPushTimer.current = window.setTimeout(async () => {
      try {
        setCloudSyncing(true);
        const ts = await pushStateToCloud(resolvedFbConfig, cloudUser.uid, state);
        lastPushedUpdatedAtRef.current = ts;
        setLastCloudSyncAt(Date.now());
        setCloudError(null);
      } catch (err) {
        console.error('[Kora Sync] Push error:', err);
        const friendly = formatFirebaseSyncError(err);
        setCloudError(friendly);
        setToast({ id: uid('toast'), text: `Sync Cloud bloquée : ${friendly}` });
      } finally {
        setCloudSyncing(false);
      }
    }, 350);
    return () => {
      if (cloudPushTimer.current) window.clearTimeout(cloudPushTimer.current);
    };
  }, [state, cloudUser?.uid, cloudConfigured]);

  const dismissToast = useCallback(() => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast(null);
  }, []);

  const notify = useCallback((text: string, undo?: () => void) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ id: uid('toast'), text, undo });
    toastTimer.current = window.setTimeout(() => setToast(null), 3600);
  }, []);

  const touch = (updater: (prev: AppState) => AppState) => {
    setState((prev) => ({
      ...updater(prev),
      updatedAt: Math.max(Date.now(), (prev.updatedAt || 0) + 1),
    }));
  };

  const connectGoogleCloud = useCallback(async () => {
    setAuthError(null);
    if (!resolvedFbConfig) {
      const msg = 'Configuration Cloud manquante';
      setAuthError(msg);
      notify(msg);
      return;
    }
    try {
      const user = await signInWithGoogle(resolvedFbConfig);
      if (user) {
        setAuthError(null);
        notify(`Connecté en tant que ${user.displayName || user.email}`);
      }
    } catch (err) {
      const msg = formatAuthError(err);
      setAuthError(msg);
      notify(msg);
    }
  }, [resolvedFbConfig, notify]);

  const connectEmailCloud = useCallback(
    async (email: string, password: string) => {
      setAuthError(null);
      if (!resolvedFbConfig) {
        setAuthError('Configuration Cloud manquante');
        return;
      }
      try {
        const user = await signInWithEmail(resolvedFbConfig, email, password);
        setAuthError(null);
        notify(`Connecté (${user.email})`);
      } catch (err) {
        const msg = formatAuthError(err);
        setAuthError(msg);
        notify(msg);
      }
    },
    [resolvedFbConfig, notify]
  );

  const registerEmailCloud = useCallback(
    async (email: string, password: string, displayName?: string) => {
      setAuthError(null);
      if (!resolvedFbConfig) {
        setAuthError('Configuration Cloud manquante');
        return;
      }
      try {
        const user = await signUpWithEmail(resolvedFbConfig, email, password);
        if (displayName?.trim()) {
          void updateFirebaseDisplayName(resolvedFbConfig, displayName.trim());
          touch((prev) => ({
            ...prev,
            preferences: { ...prev.preferences, name: displayName.trim() },
          }));
        }
        setAuthError(null);
        notify(`Compte créé (${user.email})`);
      } catch (err) {
        const msg = formatAuthError(err);
        setAuthError(msg);
        notify(msg);
      }
    },
    [resolvedFbConfig, notify]
  );

  const forceSaveCloud = useCallback(
    async (overridePreferences?: Partial<UserPreferences>) => {
      if (!cloudUser || !resolvedFbConfig) {
        notify('Connecte-toi d’abord à ton compte');
        return;
      }
      try {
        setCloudSyncing(true);
        const nextTs = Math.max(Date.now(), (latestStateRef.current.updatedAt || 0) + 1);
        const nextState: AppState = overridePreferences
          ? {
              ...latestStateRef.current,
              preferences: {
                ...latestStateRef.current.preferences,
                ...overridePreferences,
                nutritionGoals: overridePreferences.nutritionGoals
                  ? {
                      ...latestStateRef.current.preferences.nutritionGoals,
                      ...overridePreferences.nutritionGoals,
                    }
                  : latestStateRef.current.preferences.nutritionGoals,
              },
              updatedAt: nextTs,
            }
          : {
              ...latestStateRef.current,
              updatedAt: nextTs,
            };

        if (overridePreferences) {
          ignoreNextPushRef.current = true;
          latestStateRef.current = nextState;
          setState(nextState);
          if (typeof overridePreferences.name === 'string' && overridePreferences.name.trim()) {
            void updateFirebaseDisplayName(resolvedFbConfig, overridePreferences.name.trim());
          }
        }

        const ts = await pushStateToCloud(resolvedFbConfig, cloudUser.uid, nextState);
        lastPushedUpdatedAtRef.current = ts;
        setLastCloudSyncAt(Date.now());
        setCloudError(null);
        notify('Sauvegardé ✓');
      } catch (err) {
        const friendly = formatFirebaseSyncError(err);
        setCloudError(friendly);
        notify(`Erreur sauvegarde : ${friendly}`);
      } finally {
        setCloudSyncing(false);
      }
    },
    [cloudUser, resolvedFbConfig, notify]
  );

  /**
   * Instant (0ms UI + localStorage) + dedicated lightweight Firestore delta + Social Hub sync
   * for profile picture updates so changing your PFP applies immediately and NEVER reverts!
   */
  const updateUserAvatar = useCallback(
    async (avatarUrl: string | null, avatarColor?: string) => {
      const cleanUrl = avatarUrl && avatarUrl.trim() ? avatarUrl.trim() : undefined;
      const nextTs = Math.max(Date.now(), (latestStateRef.current.updatedAt || 0) + 1);
      const nextPrefs: UserPreferences = {
        ...latestStateRef.current.preferences,
        ...(avatarColor ? { avatarColor } : {}),
        avatarUrl: cleanUrl,
      };
      if (!cleanUrl) {
        delete nextPrefs.avatarUrl;
      }
      const nextState: AppState = {
        ...latestStateRef.current,
        preferences: nextPrefs,
        updatedAt: nextTs,
      };

      // 1. 0ms instant update in React state + localStorage (never lost on refresh!)
      ignoreNextPushRef.current = true;
      latestStateRef.current = nextState;
      lastPushedUpdatedAtRef.current = nextTs;
      setState(nextState);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
      } catch {
        // ignore quota errors
      }

      // 2. Fast dedicated Firestore delta write (~20 KB instead of full appState doc!)
      if (cloudUser && resolvedFbConfig) {
        try {
          await pushAvatarDelta(
            resolvedFbConfig,
            cloudUser.uid,
            cleanUrl || null,
            avatarColor,
            nextTs
          );
          setLastCloudSyncAt(Date.now());
          setCloudError(null);
        } catch (err) {
          const code = (err as { code?: string })?.code || '';
          if (code === 'not-found') {
            try {
              const ts = await pushStateToCloud(resolvedFbConfig, cloudUser.uid, nextState);
              lastPushedUpdatedAtRef.current = ts;
              setLastCloudSyncAt(Date.now());
              setCloudError(null);
            } catch (err2) {
              console.warn('[Rowav Avatar] Fallback push error:', err2);
            }
          } else {
            console.warn('[Rowav Avatar] Delta push error:', err);
          }
        }

        // 3. Mirror PFP onto Social Hub profile & published tracks/projects in the background
        void postSocialAction(
          {
            action: 'sync_profile',
            avatarUrl: cleanUrl || '',
          },
          resolvedFbConfig
        ).catch(() => {});
      }

      notify(cleanUrl ? 'Photo de profil mise à jour ✓' : 'Photo de profil retirée');
    },
    [cloudUser, resolvedFbConfig, notify]
  );

  const disconnectGoogleCloud = useCallback(async () => {
    await signOutFirebase(resolvedFbConfig);
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_KEY);
    } catch {
      // ignore
    }
    const clean = { ...createEmptyState(), updatedAt: 0 };
    latestStateRef.current = clean;
    setState(clean);
    setLastCloudSyncAt(null);
    lastDriveAutoSyncAtRef.current = 0;
    notify('Déconnecté');
  }, [resolvedFbConfig, notify]);

  const saveAndOptionallySyncMedia = useCallback(
    async (mediaId: string, blob: Blob, name: string) => {
      await saveMediaBlob(mediaId, blob, name);
      let cloudUrl: string | undefined;
      if (cloudUser && resolvedFbConfig) {
        try {
          const uploaded = await uploadCloudMedia(resolvedFbConfig, cloudUser.uid, mediaId, blob);
          if (uploaded) cloudUrl = uploaded;
        } catch {
          // Keep local copy even if offline
        }
      }
      return { mediaId, cloudUrl };
    },
    [cloudUser, resolvedFbConfig]
  );

  // ===== EVENTS =====
  const addEvent = useCallback(
    (event: Omit<ScheduleEvent, 'id'>) => {
      touch((prev) => ({ ...prev, events: [...prev.events, { ...event, id: uid('ev') }] }));
      notify('Ajouté au planning');
    },
    [notify]
  );

  const addManyEvents = useCallback(
    (events: Omit<ScheduleEvent, 'id'>[]) => {
      if (events.length === 0) return;
      touch((prev) => ({
        ...prev,
        events: [...prev.events, ...events.map((e) => ({ ...e, id: uid('ev') }))],
      }));
      notify(`${events.length} créneaux importés dans le planning`);
    },
    [notify]
  );

  const syncGoogleCalendarEvents = useCallback(
    (incoming: Omit<ScheduleEvent, 'id'>[]) => {
      let added = 0;
      let updated = 0;
      touch((prev) => {
        const byGCalId = new Map<string, ScheduleEvent>();
        for (const ev of prev.events) {
          if (ev.googleCalendarEventId) byGCalId.set(ev.googleCalendarEventId, ev);
        }

        const updatedIds = new Set<string>();
        const nextEvents = prev.events.map((ev) => {
          if (!ev.googleCalendarEventId) return ev;
          const match = incoming.find((inc) => inc.googleCalendarEventId === ev.googleCalendarEventId);
          if (!match) return ev;
          updatedIds.add(ev.googleCalendarEventId);
          updated++;
          return { ...ev, ...match, id: ev.id };
        });

        for (const inc of incoming) {
          if (inc.googleCalendarEventId && updatedIds.has(inc.googleCalendarEventId)) continue;
          added++;
          nextEvents.push({ ...inc, id: uid('ev') });
        }

        return { ...prev, events: nextEvents };
      });
      notify(
        `Google Agenda synchronisé (${added} ajouté${added > 1 ? 's' : ''}${updated ? ` · ${updated} mis à jour` : ''}) ✓`
      );
      return { added, updated };
    },
    [notify]
  );

  const updateEvent = useCallback((id: string, patch: Partial<ScheduleEvent>) => {
    touch((prev) => ({
      ...prev,
      events: prev.events.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));
  }, []);

  const deleteEvent = useCallback(
    (id: string) => {
      setState((prev) => {
        const removed = prev.events.find((e) => e.id === id);
        if (removed) {
          notify(`« ${removed.title} » supprimé`, () => {
            touch((curr) => ({ ...curr, events: [...curr.events, removed] }));
          });
        }
        return { ...prev, events: prev.events.filter((e) => e.id !== id), updatedAt: Date.now() };
      });
    },
    [notify]
  );

  // ===== HOMEWORK =====
  const addHomework = useCallback(
    (item: Omit<HomeworkItem, 'id'>) => {
      touch((prev) => ({ ...prev, homework: [{ ...item, id: uid('hw') }, ...prev.homework] }));
      notify('Devoir ajouté');
    },
    [notify]
  );

  const toggleHomework = useCallback((id: string) => {
    touch((prev) => ({
      ...prev,
      homework: prev.homework.map((h) => (h.id === id ? { ...h, done: !h.done } : h)),
    }));
  }, []);

  const updateHomework = useCallback((id: string, patch: Partial<HomeworkItem>) => {
    touch((prev) => ({
      ...prev,
      homework: prev.homework.map((h) => (h.id === id ? { ...h, ...patch } : h)),
    }));
  }, []);

  const deleteHomework = useCallback(
    (id: string) => {
      setState((prev) => {
        const removed = prev.homework.find((h) => h.id === id);
        if (removed) {
          notify('Devoir supprimé', () => {
            touch((curr) => ({ ...curr, homework: [removed, ...curr.homework] }));
          });
        }
        return { ...prev, homework: prev.homework.filter((h) => h.id !== id), updatedAt: Date.now() };
      });
    },
    [notify]
  );

  // ===== EXAMS =====
  const addExam = useCallback(
    (exam: Omit<ExamItem, 'id'>) => {
      touch((prev) => ({ ...prev, exams: [...prev.exams, { ...exam, id: uid('exam') }] }));
      notify('Évaluation ajoutée');
    },
    [notify]
  );

  const updateExam = useCallback((id: string, patch: Partial<ExamItem>) => {
    touch((prev) => ({
      ...prev,
      exams: prev.exams.map((ex) => (ex.id === id ? { ...ex, ...patch } : ex)),
    }));
  }, []);

  const toggleExamTopic = useCallback((examId: string, topicId: string) => {
    touch((prev) => ({
      ...prev,
      exams: prev.exams.map((ex) =>
        ex.id === examId
          ? {
              ...ex,
              topics: ex.topics.map((t) => (t.id === topicId ? { ...t, done: !t.done } : t)),
            }
          : ex
      ),
    }));
  }, []);

  const addExamTopic = useCallback((examId: string, label: string) => {
    const clean = label.trim();
    if (!clean) return;
    touch((prev) => ({
      ...prev,
      exams: prev.exams.map((ex) =>
        ex.id === examId
          ? { ...ex, topics: [...ex.topics, { id: uid('top'), label: clean, done: false }] }
          : ex
      ),
    }));
  }, []);

  const deleteExamTopic = useCallback((examId: string, topicId: string) => {
    touch((prev) => ({
      ...prev,
      exams: prev.exams.map((ex) =>
        ex.id === examId ? { ...ex, topics: ex.topics.filter((t) => t.id !== topicId) } : ex
      ),
    }));
  }, []);

  const deleteExam = useCallback(
    (id: string) => {
      setState((prev) => {
        const removed = prev.exams.find((e) => e.id === id);
        if (removed) {
          notify(`Éval « ${removed.title} » supprimée`, () => {
            touch((curr) => ({ ...curr, exams: [...curr.exams, removed] }));
          });
        }
        return { ...prev, exams: prev.exams.filter((e) => e.id !== id), updatedAt: Date.now() };
      });
    },
    [notify]
  );

  // ===== ACADEMIC PROFILE, SUBJECTS, GRADES, DOCS =====
  const updateAcademicProfile = useCallback(
    (patch: Partial<AcademicProfile>) => {
      touch((prev) => ({ ...prev, academicProfile: { ...prev.academicProfile, ...patch } }));
      notify('Profil cursus mis à jour');
    },
    [notify]
  );

  const addSubject = useCallback(
    (sub: Omit<CourseSubject, 'id'>) => {
      touch((prev) => ({ ...prev, subjects: [...prev.subjects, { ...sub, id: uid('sub') }] }));
      notify(`Matière « ${sub.name} » ajoutée`);
    },
    [notify]
  );

  const updateSubject = useCallback((id: string, patch: Partial<CourseSubject>) => {
    touch((prev) => ({
      ...prev,
      subjects: prev.subjects.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));
  }, []);

  const deleteSubject = useCallback((id: string) => {
    touch((prev) => ({ ...prev, subjects: prev.subjects.filter((s) => s.id !== id) }));
  }, []);

  const addGrade = useCallback(
    (grade: Omit<GradeEntry, 'id'>) => {
      touch((prev) => ({ ...prev, grades: [{ ...grade, id: uid('gr') }, ...prev.grades] }));
      notify(`Note ajoutée (${grade.score}/${grade.outOf})`);
    },
    [notify]
  );

  const addManyGrades = useCallback(
    (grades: Omit<GradeEntry, 'id'>[]) => {
      if (grades.length === 0) return;
      touch((prev) => ({
        ...prev,
        grades: [...grades.map((g) => ({ ...g, id: uid('gr') })), ...prev.grades],
      }));
      notify(`${grades.length} notes importées`);
    },
    [notify]
  );

  const deleteGrade = useCallback((id: string) => {
    touch((prev) => ({ ...prev, grades: prev.grades.filter((g) => g.id !== id) }));
  }, []);

  const addCourseDoc = useCallback(
    (doc: Omit<CourseDocument, 'id'>) => {
      touch((prev) => ({ ...prev, courseDocs: [{ ...doc, id: uid('cdoc') }, ...prev.courseDocs] }));
      notify('Document ajouté au coffre de cours');
    },
    [notify]
  );

  const deleteCourseDoc = useCallback(
    (id: string) => {
      setState((prev) => {
        const target = prev.courseDocs.find((d) => d.id === id);
        if (target?.mediaId) void deleteMediaBlob(target.mediaId);
        return {
          ...prev,
          courseDocs: prev.courseDocs.filter((d) => d.id !== id),
          updatedAt: Date.now(),
        };
      });
      notify('Document supprimé');
    },
    [notify]
  );

  // ===== TASKS =====
  const addTask = useCallback(
    (task: Omit<TaskItem, 'id'>) => {
      touch((prev) => ({ ...prev, tasks: [{ ...task, id: uid('task') }, ...prev.tasks] }));
      notify('Tâche ajoutée');
    },
    [notify]
  );

  const toggleTask = useCallback((id: string) => {
    touch((prev) => ({
      ...prev,
      tasks: prev.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
    }));
  }, []);

  const updateTask = useCallback((id: string, patch: Partial<TaskItem>) => {
    touch((prev) => ({
      ...prev,
      tasks: prev.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
  }, []);

  const deleteTask = useCallback(
    (id: string) => {
      setState((prev) => {
        const removed = prev.tasks.find((t) => t.id === id);
        if (removed) {
          notify('Tâche supprimée', () => {
            touch((curr) => ({ ...curr, tasks: [removed, ...curr.tasks] }));
          });
        }
        return { ...prev, tasks: prev.tasks.filter((t) => t.id !== id), updatedAt: Date.now() };
      });
    },
    [notify]
  );

  // ===== WORKOUTS & ROUTINES (HEVY STYLE) =====
  const addWorkout = useCallback(
    (workout: Omit<WorkoutSession, 'id'>) => {
      const id = uid('wk');
      touch((prev) => ({ ...prev, workouts: [{ ...workout, id }, ...prev.workouts] }));
      notify('Séance enregistrée');
      return id;
    },
    [notify]
  );

  const updateWorkout = useCallback((id: string, patch: Partial<WorkoutSession>) => {
    touch((prev) => ({
      ...prev,
      workouts: prev.workouts.map((w) => (w.id === id ? { ...w, ...patch } : w)),
    }));
  }, []);

  const toggleWorkoutSet = useCallback((workoutId: string, exerciseId: string, setId: string) => {
    touch((prev) => ({
      ...prev,
      workouts: prev.workouts.map((w) => {
        if (w.id !== workoutId) return w;
        const exercises = w.exercises.map((ex) =>
          ex.id === exerciseId
            ? { ...ex, sets: ex.sets.map((s) => (s.id === setId ? { ...s, done: !s.done } : s)) }
            : ex
        );
        return { ...w, exercises };
      }),
    }));
  }, []);

  const updateWorkoutSet = useCallback(
    (
      workoutId: string,
      exerciseId: string,
      setId: string,
      patch: { reps?: number; weightKg?: number; type?: 'warmup' | 'normal' | 'failure' }
    ) => {
      touch((prev) => ({
        ...prev,
        workouts: prev.workouts.map((w) =>
          w.id === workoutId
            ? {
                ...w,
                exercises: w.exercises.map((ex) =>
                  ex.id === exerciseId
                    ? { ...ex, sets: ex.sets.map((s) => (s.id === setId ? { ...s, ...patch } : s)) }
                    : ex
                ),
              }
            : w
        ),
      }));
    },
    []
  );

  const addWorkoutSet = useCallback((workoutId: string, exerciseId: string) => {
    touch((prev) => ({
      ...prev,
      workouts: prev.workouts.map((w) =>
        w.id === workoutId
          ? {
              ...w,
              exercises: w.exercises.map((ex) => {
                if (ex.id !== exerciseId) return ex;
                const last = ex.sets[ex.sets.length - 1];
                return {
                  ...ex,
                  sets: [
                    ...ex.sets,
                    {
                      id: uid('set'),
                      reps: last ? last.reps : 10,
                      weightKg: last ? last.weightKg : 20,
                      done: false,
                      type: 'normal',
                    },
                  ],
                };
              }),
            }
          : w
      ),
    }));
  }, []);

  const deleteWorkoutSet = useCallback((workoutId: string, exerciseId: string, setId: string) => {
    touch((prev) => ({
      ...prev,
      workouts: prev.workouts.map((w) =>
        w.id === workoutId
          ? {
              ...w,
              exercises: w.exercises.map((ex) =>
                ex.id === exerciseId ? { ...ex, sets: ex.sets.filter((s) => s.id !== setId) } : ex
              ),
            }
          : w
      ),
    }));
  }, []);

  const addWorkoutExercise = useCallback(
    (workoutId: string, exercise: Omit<WorkoutExercise, 'id'>) => {
      touch((prev) => ({
        ...prev,
        workouts: prev.workouts.map((w) =>
          w.id === workoutId
            ? { ...w, exercises: [...w.exercises, { ...exercise, id: uid('ex') }] }
            : w
        ),
      }));
    },
    []
  );

  const deleteWorkoutExercise = useCallback((workoutId: string, exerciseId: string) => {
    touch((prev) => ({
      ...prev,
      workouts: prev.workouts.map((w) =>
        w.id === workoutId
          ? { ...w, exercises: w.exercises.filter((ex) => ex.id !== exerciseId) }
          : w
      ),
    }));
  }, []);

  const deleteWorkout = useCallback(
    (id: string) => {
      setState((prev) => {
        const removed = prev.workouts.find((w) => w.id === id);
        if (removed) {
          notify('Séance supprimée', () => {
            touch((curr) => ({ ...curr, workouts: [removed, ...curr.workouts] }));
          });
        }
        return { ...prev, workouts: prev.workouts.filter((w) => w.id !== id), updatedAt: Date.now() };
      });
    },
    [notify]
  );

  const addRoutine = useCallback(
    (routine: Omit<WorkoutRoutine, 'id'>) => {
      touch((prev) => ({
        ...prev,
        workoutRoutines: [...prev.workoutRoutines, { ...routine, id: uid('rt') }],
      }));
      notify(`Routine « ${routine.title} » créée`);
    },
    [notify]
  );

  const updateRoutine = useCallback((id: string, patch: Partial<WorkoutRoutine>) => {
    touch((prev) => ({
      ...prev,
      workoutRoutines: prev.workoutRoutines.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
  }, []);

  const deleteRoutine = useCallback(
    (id: string) => {
      touch((prev) => ({
        ...prev,
        workoutRoutines: prev.workoutRoutines.filter((r) => r.id !== id),
      }));
      notify('Routine supprimée');
    },
    [notify]
  );

  const updateFitnessProfile = useCallback(
    (patch: Partial<FitnessProfile>) => {
      touch((prev) => ({ ...prev, fitnessProfile: { ...prev.fitnessProfile, ...patch } }));
      notify('Profil sportif mis à jour');
    },
    [notify]
  );

  // ===== MEALS & WATER =====
  const addMeal = useCallback(
    (meal: Omit<MealEntry, 'id'>) => {
      touch((prev) => ({ ...prev, meals: [...prev.meals, { ...meal, id: uid('meal') }] }));
      notify(`+${meal.calories} kcal ajoutés`);
    },
    [notify]
  );

  const deleteMeal = useCallback(
    (id: string) => {
      setState((prev) => {
        const removed = prev.meals.find((m) => m.id === id);
        if (removed) {
          notify('Repas retiré', () => {
            touch((curr) => ({ ...curr, meals: [...curr.meals, removed] }));
          });
        }
        return { ...prev, meals: prev.meals.filter((m) => m.id !== id), updatedAt: Date.now() };
      });
    },
    [notify]
  );

  const addMealPreset = useCallback(
    (preset: Omit<MealPreset, 'id'>) => {
      touch((prev) => ({ ...prev, mealPresets: [...prev.mealPresets, { ...preset, id: uid('mp') }] }));
      notify('Favori nutrition enregistré');
    },
    [notify]
  );

  const deleteMealPreset = useCallback((id: string) => {
    touch((prev) => ({ ...prev, mealPresets: prev.mealPresets.filter((p) => p.id !== id) }));
  }, []);

  const addWater = useCallback((dateISO: string, deltaMl: number) => {
    touch((prev) => {
      const current = prev.waterMlByDate[dateISO] || 0;
      return {
        ...prev,
        waterMlByDate: { ...prev.waterMlByDate, [dateISO]: Math.max(0, Math.min(8000, current + deltaMl)) },
      };
    });
  }, []);

  // ===== WEIGHT =====
  const addWeight = useCallback(
    (entry: Omit<WeightEntry, 'id'>) => {
      touch((prev) => {
        const filtered = prev.weights.filter((w) => w.date !== entry.date);
        const updated = [...filtered, { ...entry, id: uid('w') }].sort((a, b) =>
          a.date.localeCompare(b.date)
        );
        return { ...prev, weights: updated };
      });
      notify(`Pesée enregistrée (${entry.weightKg.toFixed(1)} kg)`);
    },
    [notify]
  );

  const deleteWeight = useCallback((id: string) => {
    touch((prev) => ({ ...prev, weights: prev.weights.filter((w) => w.id !== id) }));
  }, []);

  // ===== MUSIC STUDIO & LEXCORE =====
  const addMusicTrack = useCallback(
    (track: Omit<MusicTrack, 'id'>) => {
      const id = uid('trk');
      touch((prev) => ({ ...prev, musicTracks: [{ ...track, id }, ...prev.musicTracks] }));
      notify(`Morceau « ${track.title} » ajouté`);
      return id;
    },
    [notify]
  );

  const syncMusicTracksBatch = useCallback(
    (
      incoming: Omit<MusicTrack, 'id'>[],
      excludedDriveIds?: string[],
      pruneMissingDriveIds = false,
      allowEmptyPrune = false,
      preservedDriveSourceIds?: string[]
    ) => {
      const excludedSet = new Set(excludedDriveIds || []);
      const preservedSourceSet = new Set(preservedDriveSourceIds || []);
      const incomingDriveIdSet = new Set(
        incoming.map((it) => it.googleDriveFileId).filter((id): id is string => Boolean(id))
      );
      const shouldPruneMissing =
        pruneMissingDriveIds && (incomingDriveIdSet.size > 0 || allowEmptyPrune);

      const isRemovedExisting = (t: MusicTrack) => {
        if (!t.googleDriveFileId) return false;
        if (t.driveSourceId && preservedSourceSet.has(t.driveSourceId)) return false;
        if (excludedSet.has(t.googleDriveFileId)) return true;
        if (isExcludedProdName(t.sourceFilename || '') || isExcludedProdName(t.title || '')) {
          return true;
        }
        if (shouldPruneMissing && !incomingDriveIdSet.has(t.googleDriveFileId)) {
          return true;
        }
        return false;
      };

      const currentTracks = latestStateRef.current.musicTracks;
      const keptTracks = currentTracks.filter((t) => !isRemovedExisting(t));
      const removed = currentTracks.length - keptTracks.length;

      const byDriveId = new Map<string, number>();
      keptTracks.forEach((t, idx) => {
        if (t.googleDriveFileId) byDriveId.set(t.googleDriveFileId, idx);
      });

      let added = 0;
      let updated = 0;
      const nextTracks = [...keptTracks];

      for (const item of incoming) {
        const driveId = item.googleDriveFileId;
        if (driveId && excludedSet.has(driveId)) continue;
        if (driveId && byDriveId.has(driveId)) {
          const idx = byDriveId.get(driveId)!;
          if (idx >= 0) {
            const existing = nextTracks[idx];
            const shouldApplyFolderTitle = Boolean(
              item.manualGroupTitle && !existing.manualGroupTitle
            );
            const needsMetaUpdate =
              (item.sourceFilename && existing.sourceFilename !== item.sourceFilename) ||
              (item.modifiedAt && existing.modifiedAt !== item.modifiedAt) ||
              (item.driveYearFolder && existing.driveYearFolder !== item.driveYearFolder) ||
              (item.driveSourceId && existing.driveSourceId !== item.driveSourceId) ||
              shouldApplyFolderTitle;
            if (needsMetaUpdate) {
              const oldAutoTitle = (existing.sourceFilename || '')
                .replace(/\.[^/.]+$/, '')
                .replace(/[_-]+/g, ' ')
                .trim();
              const shouldUpdateTitle =
                Boolean(item.sourceFilename && existing.sourceFilename !== item.sourceFilename) &&
                (!existing.sourceFilename || existing.title === oldAutoTitle);
              nextTracks[idx] = {
                ...existing,
                ...(shouldUpdateTitle ? { title: item.title } : {}),
                ...(shouldApplyFolderTitle
                  ? {
                      manualGroupTitle: item.manualGroupTitle,
                      manualGroupKey: existing.manualGroupKey || item.manualGroupKey,
                    }
                  : {}),
                sourceFilename: item.sourceFilename || existing.sourceFilename,
                driveYearFolder: item.driveYearFolder || existing.driveYearFolder,
                driveSourceId: item.driveSourceId || existing.driveSourceId,
                modifiedAt: item.modifiedAt || existing.modifiedAt,
              };
              updated++;
            }
          }
        } else {
          if (driveId) byDriveId.set(driveId, -1);
          added++;
        }
      }

      if (added > 0 || updated > 0 || removed > 0) {
        touch((prev) => {
          const merged = prev.musicTracks.filter((t) => !isRemovedExisting(t));
          const prevMap = new Map<string, number>();
          merged.forEach((t, i) => {
            if (t.googleDriveFileId) prevMap.set(t.googleDriveFileId, i);
          });
          const freshNew: MusicTrack[] = [];
          for (const item of incoming) {
            const driveId = item.googleDriveFileId;
            if (driveId && excludedSet.has(driveId)) continue;
            if (driveId && prevMap.has(driveId)) {
              const i = prevMap.get(driveId)!;
              if (i >= 0) {
                const ex = merged[i];
                const shouldApplyFolderTitle = Boolean(
                  item.manualGroupTitle && !ex.manualGroupTitle
                );
                const oldAutoTitle = (ex.sourceFilename || '')
                  .replace(/\.[^/.]+$/, '')
                  .replace(/[_-]+/g, ' ')
                  .trim();
                const shouldUpdateTitle =
                  Boolean(item.sourceFilename && ex.sourceFilename !== item.sourceFilename) &&
                  (!ex.sourceFilename || ex.title === oldAutoTitle);
                merged[i] = {
                  ...ex,
                  ...(shouldUpdateTitle ? { title: item.title } : {}),
                  ...(shouldApplyFolderTitle
                    ? {
                        manualGroupTitle: item.manualGroupTitle,
                        manualGroupKey: ex.manualGroupKey || item.manualGroupKey,
                      }
                    : {}),
                  sourceFilename: item.sourceFilename || ex.sourceFilename,
                  driveYearFolder: item.driveYearFolder || ex.driveYearFolder,
                  driveSourceId: item.driveSourceId || ex.driveSourceId,
                  modifiedAt: item.modifiedAt || ex.modifiedAt,
                };
              }
            } else {
              freshNew.push({ ...item, id: uid('trk') });
              if (driveId) prevMap.set(driveId, -1);
            }
          }
          const combinedTracks = [...freshNew, ...merged];
          const reconciled = reconcileProjectTrackVersions(prev.musicProjects, combinedTracks);
          return {
            ...prev,
            musicTracks: reconciled.musicTracks,
            musicProjects: reconciled.musicProjects,
          };
        });
      }

      return { added, updated, removed };
    },
    []
  );

  const driveSources = useMemo<DriveSource[]>(
    () => state.preferences.lastSession?.driveSources || [],
    [state.preferences.lastSession?.driveSources]
  );

  const saveDriveSources = useCallback((nextSources: DriveSource[]) => {
    setState((prev) => {
      const curSession: LastSessionState = prev.preferences.lastSession || {
        activeTab: 'music',
        savedAt: Date.now(),
      };
      return {
        ...prev,
        updatedAt: Math.max(Date.now(), (prev.updatedAt || 0) + 1),
        preferences: {
          ...prev.preferences,
          lastSession: {
            ...curSession,
            driveSources: nextSources,
            savedAt: Date.now(),
          },
        },
      };
    });
  }, []);

  const syncAllConnectedDrives = useCallback(
    async (options?: {
      overrideSources?: DriveSource[];
      silent?: boolean;
      forceRefresh?: boolean;
      onProgress?: (text: string) => void;
    }): Promise<{ added: number; updated: number; removed: number }> => {
      if (driveSyncInFlightRef.current) return { added: 0, updated: 0, removed: 0 };
      driveSyncInFlightRef.current = true;
      setAutoSyncingDrive(true);
      try {
        const perm = await fetchPermanentDriveSession(resolvedFbConfig);
        if (perm.serviceAccountEmail) setServiceAccountEmail(perm.serviceAccountEmail);

        let sources =
          options?.overrideSources ??
          latestStateRef.current.preferences.lastSession?.driveSources ??
          [];

        // Seamless legacy auto-adoption for primary owner who already has Drive tracks synced
        if (
          sources.length === 0 &&
          !options?.overrideSources &&
          perm.isLegacyOwner &&
          perm.hasSharedFiles
        ) {
          const nowIso = new Date().toISOString();
          const defaultSource: DriveSource = {
            id: 'drv_main',
            folderId: 'root',
            name: 'Google Drive Principal',
            addedAt: nowIso,
          };
          sources = [defaultSource];
        }

        // If user has 0 connected Drives (e.g. removed all Drives), prune all Drive tracks cleanly!
        if (sources.length === 0) {
          const res = syncMusicTracksBatch([], [], true, true);
          saveDriveSources([]);
          if (!options?.silent) {
            notify(
              res.removed > 0
                ? `Drive déconnecté (${res.removed} son${res.removed > 1 ? 's' : ''} retiré${res.removed > 1 ? 's' : ''}) ✓`
                : 'Aucun Google Drive connecté.'
            );
          }
          return res;
        }

        const activeSources = sources.filter((s) => s.enabled !== false);
        const disabledSourceIds = sources.filter((s) => s.enabled === false).map((s) => s.id);

        // If all connected Drives are temporarily disabled, keep them saved and skip network scan
        if (activeSources.length === 0) {
          saveDriveSources(sources);
          if (!options?.silent) {
            notify('Tous les Drives sont actuellement désactivés.');
          }
          return { added: 0, updated: 0, removed: 0 };
        }

        if (!perm.configured || !perm.accessToken) {
          if (!options?.silent) {
            notify(perm.error || 'Connexion Google Drive indisponible.');
          }
          return { added: 0, updated: 0, removed: 0 };
        }

        options?.onProgress?.('Analyse des dossiers Drive…');
        const { files, excludedFileIds } = await listAllGoogleDriveAudioFilesWithExclusions(
          perm.accessToken,
          '',
          (count) => options?.onProgress?.(`${count} MP3 détectés…`),
          12,
          activeSources
        );
        lastDriveAutoSyncAtRef.current = Date.now();

        const artist = latestStateRef.current.preferences.name || 'Moi';
        const nowIso = new Date().toISOString();
        const countBySource = new Map<string, number>();

        // Detect dedicated single-song Drive folders (e.g. folder "Minuit/" containing "projet 12.mp3", "projet 12 v2.mp3")
        // so generic "projetXX.mp3" files automatically inherit the folder's song title while keeping sourceFilename intact!
        const folderStats = new Map<
          string,
          { folderName: string; genericKeys: Set<string>; unrelatedNamedKeys: Set<string> }
        >();
        for (const f of files) {
          if (!f.parentFolderId || !f.parentFolderName) continue;
          let st = folderStats.get(f.parentFolderId);
          if (!st) {
            st = {
              folderName: f.parentFolderName,
              genericKeys: new Set<string>(),
              unrelatedNamedKeys: new Set<string>(),
            };
            folderStats.set(f.parentFolderId, st);
          }
          const cleanTitle = f.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ').trim();
          const p = parseTrackVersion({ title: cleanTitle, sourceFilename: f.name });
          if (isGenericProjectFilename(f.name)) {
            st.genericKeys.add(p.groupKey);
          } else {
            const folderKey = normalizeGroupKey(f.parentFolderName);
            if (p.groupKey !== folderKey) {
              st.unrelatedNamedKeys.add(p.groupKey);
            }
          }
        }
        const songFolderNameById = new Map<string, string>();
        for (const [fid, st] of folderStats.entries()) {
          // A folder is treated as a dedicated song folder when it has NO unrelated named tracks
          // and at most 2 distinct generic project IDs (e.g. projet12 + projet13 exports of the same song).
          if (st.unrelatedNamedKeys.size === 0 && st.genericKeys.size > 0 && st.genericKeys.size <= 2) {
            const cleanFolderTitle = st.folderName.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
            if (cleanFolderTitle) {
              songFolderNameById.set(fid, cleanFolderTitle);
            }
          }
        }

        const payload = files.map((f) => {
          const cleanTitle = f.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ').trim();
          const folderSongTitle =
            f.parentFolderId && isGenericProjectFilename(f.name)
              ? songFolderNameById.get(f.parentFolderId)
              : undefined;
          const folderSongKey = folderSongTitle ? normalizeGroupKey(folderSongTitle) : undefined;
          const parsed = parseTrackVersion({
            title: cleanTitle,
            sourceFilename: f.name,
            ...(folderSongTitle ? { manualGroupTitle: folderSongTitle, manualGroupKey: folderSongKey } : {}),
          });
          if (f.driveSourceId) {
            countBySource.set(f.driveSourceId, (countBySource.get(f.driveSourceId) || 0) + 1);
          }
          return {
            title: cleanTitle || f.name,
            ...(folderSongTitle
              ? { manualGroupTitle: folderSongTitle, manualGroupKey: folderSongKey }
              : {}),
            artist,
            googleDriveFileId: f.id,
            driveSourceId: f.driveSourceId,
            sourceFilename: f.name,
            driveYearFolder: f.yearFolder,
            modifiedAt: f.modifiedTime || nowIso,
            coverGradient: getDeterministicGradientId(parsed.groupKey),
            status: 'brouillon' as const,
            tags: ['Google Drive'],
            markers: [],
            addedAt: f.modifiedTime || nowIso,
          };
        });

        // Update per-Drive track count & lastSyncedAt for active sources, preserving disabled ones
        const updatedSources = sources.map((s) => {
          if (s.enabled === false) return s;
          return {
            ...s,
            trackCount:
              s.folderId === 'root' && activeSources.length === 1
                ? files.length
                : countBySource.get(s.id) ?? 0,
            lastSyncedAt: nowIso,
          };
        });
        saveDriveSources(updatedSources);

        const res = syncMusicTracksBatch(
          payload,
          excludedFileIds,
          true,
          Boolean(options?.overrideSources),
          disabledSourceIds
        );

        if (!options?.silent) {
          if (res.added === 0 && res.updated === 0 && res.removed === 0) {
            notify(`Synchronisé (${files.length} MP3 sur ${activeSources.length} Drive actif${activeSources.length > 1 ? 's' : ''}) ✓`);
          } else {
            const parts: string[] = [];
            if (res.added > 0) parts.push(`+${res.added} ajouté${res.added > 1 ? 's' : ''}`);
            if (res.updated > 0) parts.push(`${res.updated} mis à jour`);
            if (res.removed > 0) parts.push(`-${res.removed} retiré${res.removed > 1 ? 's' : ''}`);
            notify(`Drive synchronisé : ${parts.join(' · ')} ✓`);
          }
        } else if (res.added > 0 || res.removed > 0) {
          const parts: string[] = [];
          if (res.added > 0) parts.push(`+${res.added} nouveau${res.added > 1 ? 'x' : ''} MP3`);
          if (res.removed > 0) parts.push(`-${res.removed} retiré${res.removed > 1 ? 's' : ''}`);
          notify(`Drive synchronisé : ${parts.join(' · ')} ✓`);
        }

        return res;
      } catch (err) {
        if (!options?.silent) {
          notify(`Drive : ${(err as Error)?.message || 'Erreur de synchronisation'}`);
        }
        return { added: 0, updated: 0, removed: 0 };
      } finally {
        driveSyncInFlightRef.current = false;
        setAutoSyncingDrive(false);
      }
    },
    [resolvedFbConfig, syncMusicTracksBatch, saveDriveSources, notify]
  );

  const connectDriveSource = useCallback(
    async (
      folderInput: string,
      customName?: string
    ): Promise<{ ok: boolean; error?: string; source?: DriveSource }> => {
      const check = await verifyDriveFolderAccess(folderInput, resolvedFbConfig);
      if (check.serviceAccountEmail) setServiceAccountEmail(check.serviceAccountEmail);
      if (!check.ok || !check.folderId) {
        return { ok: false, error: check.error || 'Dossier Google Drive invalide ou non partagé.' };
      }
      const curSources = latestStateRef.current.preferences.lastSession?.driveSources || [];
      if (curSources.some((s) => s.folderId === check.folderId)) {
        return { ok: false, error: 'Ce dossier Google Drive est déjà connecté.' };
      }
      const nowIso = new Date().toISOString();
      const newSource: DriveSource = {
        id: uid('drv'),
        folderId: check.folderId,
        name: customName?.trim() || check.folderName || 'Google Drive',
        url: folderInput.trim(),
        addedAt: nowIso,
      };
      const nextSources = [...curSources, newSource];
      saveDriveSources(nextSources);
      await syncAllConnectedDrives({ overrideSources: nextSources, silent: false });
      return { ok: true, source: newSource };
    },
    [resolvedFbConfig, saveDriveSources, syncAllConnectedDrives]
  );

  const updateDriveSource = useCallback(
    async (
      sourceId: string,
      patch: { name?: string; folderInput?: string }
    ): Promise<{ ok: boolean; error?: string }> => {
      const curSources = latestStateRef.current.preferences.lastSession?.driveSources || [];
      const target = curSources.find((s) => s.id === sourceId);
      if (!target) return { ok: false, error: 'Drive introuvable.' };

      let nextFolderId = target.folderId;
      let nextName = patch.name !== undefined ? patch.name.trim() || target.name : target.name;
      let nextUrl = target.url;
      let folderChanged = false;

      if (patch.folderInput && patch.folderInput.trim()) {
        const parsedId = extractDriveFolderId(patch.folderInput);
        if (parsedId && parsedId !== target.folderId) {
          const check = await verifyDriveFolderAccess(patch.folderInput, resolvedFbConfig);
          if (!check.ok || !check.folderId) {
            return { ok: false, error: check.error || 'Nouveau dossier Drive inaccessible.' };
          }
          nextFolderId = check.folderId;
          nextUrl = patch.folderInput.trim();
          if (!patch.name?.trim() && check.folderName) {
            nextName = check.folderName;
          }
          folderChanged = true;
        }
      }

      const nextSources = curSources.map((s) =>
        s.id === sourceId
          ? {
              ...s,
              name: nextName,
              folderId: nextFolderId,
              url: nextUrl,
            }
          : s
      );
      saveDriveSources(nextSources);
      if (folderChanged) {
        await syncAllConnectedDrives({ overrideSources: nextSources, silent: false });
      } else {
        notify(`Drive « ${nextName} » mis à jour ✓`);
      }
      return { ok: true };
    },
    [resolvedFbConfig, saveDriveSources, syncAllConnectedDrives, notify]
  );

  const toggleDriveSource = useCallback(
    async (sourceId: string): Promise<void> => {
      const curSources = latestStateRef.current.preferences.lastSession?.driveSources || [];
      const target = curSources.find((s) => s.id === sourceId);
      if (!target) return;
      const nextEnabled = target.enabled === false ? true : false;
      const nextSources = curSources.map((s) =>
        s.id === sourceId ? { ...s, enabled: nextEnabled } : s
      );
      saveDriveSources(nextSources);
      if (nextEnabled) {
        notify(`Drive « ${target.name} » activé — synchronisation…`);
        await syncAllConnectedDrives({ overrideSources: nextSources, silent: true });
      } else {
        notify(`Drive « ${target.name} » désactivé (conservé dans tes Drives)`);
      }
    },
    [saveDriveSources, syncAllConnectedDrives, notify]
  );

  const removeDriveSource = useCallback(
    async (sourceId: string): Promise<void> => {
      const curSources = latestStateRef.current.preferences.lastSession?.driveSources || [];
      const nextSources = curSources.filter((s) => s.id !== sourceId);
      saveDriveSources(nextSources);
      await syncAllConnectedDrives({ overrideSources: nextSources, silent: false });
    },
    [saveDriveSources, syncAllConnectedDrives]
  );

  // ===== GOOGLE DRIVE-FIRST STORAGE (_Rowav_Data/ covers + studio backups) =====
  const [driveStorageStatus, setDriveStorageStatus] = useState<
    'idle' | 'syncing' | 'synced' | 'readonly' | 'needs_oauth'
  >('idle');
  const [driveLastBackupAt, setDriveLastBackupAt] = useState<string | null>(null);

  const primaryDriveFolderId = useMemo(() => {
    const enabled = driveSources.find((s) => s.enabled !== false && Boolean(s.folderId));
    return enabled?.folderId || driveSources[0]?.folderId || null;
  }, [driveSources]);

  useEffect(() => {
    setCachedPrimaryDriveFolderId(primaryDriveFolderId);
  }, [primaryDriveFolderId]);

  const syncStudioDataToDriveNow = useCallback(
    async (silent = false, explicitUserDriveToken?: string | null): Promise<boolean> => {
      if (!primaryDriveFolderId) {
        if (!silent) notify('Connecte d’abord un dossier Google Drive.');
        return false;
      }
      setDriveStorageStatus('syncing');
      try {
        const cur = latestStateRef.current;
        const res = await syncStudioBackupToUserDrive(
          primaryDriveFolderId,
          {
            profile: {
              name: cur.preferences.name,
              avatarUrl: cur.preferences.avatarUrl,
            },
            musicProjects: cur.musicProjects || [],
            playlists: cur.preferences.lastSession?.playlists || [],
            lyricsFolders: cur.lyricsFolders || [],
            lyricsDocs: cur.lyricsDocs || [],
          },
          resolvedFbConfig,
          explicitUserDriveToken
        );
        if (res.ok) {
          setDriveStorageStatus('synced');
          setDriveLastBackupAt(res.syncedAt || new Date().toISOString());
          if (!silent) {
            notify('Textes, projets et playlists sauvegardés sur ton Google Drive (_Rowav_Data) ✓');
          }
          return true;
        }
        if (res.needsUserOAuth) {
          setDriveStorageStatus('needs_oauth');
          if (!silent) {
            notify(
              'Autorisation Google requise 1 fois pour créer _Rowav_Data sur ton espace Drive — clique sur « Autoriser Google & Sauvegarder ».'
            );
          }
          return false;
        }
        if (res.readonly) {
          setDriveStorageStatus('readonly');
          if (!silent) {
            notify(
              'Dossier Drive en lecture seule — partage-le en mode Éditeur pour activer le stockage Drive automatique.'
            );
          }
          return false;
        }
        setDriveStorageStatus('idle');
        if (!silent) notify(res.error || 'Sauvegarde Google Drive impossible');
        return false;
      } catch {
        setDriveStorageStatus('idle');
        if (!silent) notify('Erreur réseau lors de la sauvegarde Google Drive');
        return false;
      }
    },
    [primaryDriveFolderId, resolvedFbConfig, notify]
  );

  /**
   * Opens the Google OAuth Drive popup synchronously (so browsers never block it),
   * caches the user's Drive write token, and immediately creates/updates `_Rowav_Data/`
   * owned by the user using their personal Google Drive quota (15 Go / 5 To).
   */
  const authorizeDriveWriteAndSync = useCallback(async (): Promise<boolean> => {
    if (!primaryDriveFolderId) {
      notify('Connecte d’abord un dossier Google Drive.');
      return false;
    }
    try {
      const token = await requestGoogleDriveWriteAccessToken(resolvedFbConfig);
      setCachedUserDriveWriteToken(token);
      return await syncStudioDataToDriveNow(false, token);
    } catch (err) {
      notify(formatAuthError(err));
      return false;
    }
  }, [primaryDriveFolderId, resolvedFbConfig, syncStudioDataToDriveNow, notify]);

  // Automatic debounced background backup of texts, projects & playlists to _Rowav_Data on user's Drive
  const driveBackupTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!cloudUser || !lastCloudSyncAt || !primaryDriveFolderId) return;
    if (driveStorageStatus === 'readonly' || driveStorageStatus === 'needs_oauth') return;
    if (driveBackupTimerRef.current) window.clearTimeout(driveBackupTimerRef.current);
    driveBackupTimerRef.current = window.setTimeout(() => {
      void syncStudioDataToDriveNow(true);
    }, 6000);
    return () => {
      if (driveBackupTimerRef.current) window.clearTimeout(driveBackupTimerRef.current);
    };
  }, [
    cloudUser,
    lastCloudSyncAt,
    primaryDriveFolderId,
    state.lyricsDocs,
    state.lyricsFolders,
    state.musicProjects,
    state.preferences.lastSession?.playlists,
  ]);

  const playlists = useMemo<MusicPlaylist[]>(
    () => state.preferences.lastSession?.playlists || [],
    [state.preferences.lastSession?.playlists]
  );

  const likedSocialTracks = useMemo<SocialTrackItem[]>(
    () => state.preferences.lastSession?.likedSocialTracks || [],
    [state.preferences.lastSession?.likedSocialTracks]
  );

  const createPlaylist = useCallback(
    (data: {
      title: string;
      description?: string;
      coverDataUrl?: string;
      coverGradient?: string;
      ownTrackIds?: string[];
      socialTrackIds?: string[];
    }) => {
      const id = uid('pl');
      const nowIso = new Date().toISOString();
      const newPl: MusicPlaylist = {
        id,
        title: data.title.trim() || 'Nouvelle Playlist',
        description: data.description?.trim() || undefined,
        coverDataUrl: data.coverDataUrl || undefined,
        coverGradient: data.coverGradient || getDeterministicGradientId(data.title || id),
        ownTrackIds: data.ownTrackIds || [],
        socialTrackIds: data.socialTrackIds || [],
        isPublic: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      setState((prev) => {
        const curSession: LastSessionState = prev.preferences.lastSession || {
          activeTab: 'music',
          savedAt: Date.now(),
        };
        const curPlaylists = curSession.playlists || [];
        return {
          ...prev,
          updatedAt: Math.max(Date.now(), (prev.updatedAt || 0) + 1),
          preferences: {
            ...prev.preferences,
            lastSession: {
              ...curSession,
              playlists: [newPl, ...curPlaylists],
              savedAt: Date.now(),
            },
          },
        };
      });
      notify(`Playlist « ${newPl.title} » créée`);
      return id;
    },
    [notify]
  );

  const updatePlaylist = useCallback((id: string, patch: Partial<MusicPlaylist>) => {
    setState((prev) => {
      const curSession: LastSessionState = prev.preferences.lastSession || {
        activeTab: 'music',
        savedAt: Date.now(),
      };
      const curPlaylists = curSession.playlists || [];
      return {
        ...prev,
        updatedAt: Math.max(Date.now(), (prev.updatedAt || 0) + 1),
        preferences: {
          ...prev.preferences,
          lastSession: {
            ...curSession,
            playlists: curPlaylists.map((pl) =>
              pl.id === id ? { ...pl, ...patch, updatedAt: new Date().toISOString() } : pl
            ),
            savedAt: Date.now(),
          },
        },
      };
    });
  }, []);

  const deletePlaylist = useCallback(
    (id: string) => {
      setState((prev) => {
        const curSession: LastSessionState = prev.preferences.lastSession || {
          activeTab: 'music',
          savedAt: Date.now(),
        };
        const curPlaylists = curSession.playlists || [];
        return {
          ...prev,
          updatedAt: Math.max(Date.now(), (prev.updatedAt || 0) + 1),
          preferences: {
            ...prev.preferences,
            lastSession: {
              ...curSession,
              playlists: curPlaylists.filter((pl) => pl.id !== id),
              savedAt: Date.now(),
            },
          },
        };
      });
      notify('Playlist supprimée');
    },
    [notify]
  );

  const toggleTrackInPlaylist = useCallback(
    (playlistId: string, trackId: string, kind: 'own' | 'social') => {
      setState((prev) => {
        const curSession: LastSessionState = prev.preferences.lastSession || {
          activeTab: 'music',
          savedAt: Date.now(),
        };
        const curPlaylists = curSession.playlists || [];
        return {
          ...prev,
          updatedAt: Math.max(Date.now(), (prev.updatedAt || 0) + 1),
          preferences: {
            ...prev.preferences,
            lastSession: {
              ...curSession,
              playlists: curPlaylists.map((pl) => {
                if (pl.id !== playlistId) return pl;
                if (kind === 'own') {
                  const exists = pl.ownTrackIds.includes(trackId);
                  return {
                    ...pl,
                    ownTrackIds: exists
                      ? pl.ownTrackIds.filter((id) => id !== trackId)
                      : [...pl.ownTrackIds, trackId],
                    updatedAt: new Date().toISOString(),
                  };
                } else {
                  const exists = pl.socialTrackIds.includes(trackId);
                  return {
                    ...pl,
                    socialTrackIds: exists
                      ? pl.socialTrackIds.filter((id) => id !== trackId)
                      : [...pl.socialTrackIds, trackId],
                    updatedAt: new Date().toISOString(),
                  };
                }
              }),
              savedAt: Date.now(),
            },
          },
        };
      });
    },
    []
  );

  const toggleLikeSocialTrack = useCallback(
    (track: SocialTrackItem, forceLiked?: boolean): boolean => {
      const curList = latestStateRef.current.preferences.lastSession?.likedSocialTracks || [];
      const alreadyLiked = curList.some((t) => t.id === track.id);
      const nextLiked = forceLiked !== undefined ? forceLiked : !alreadyLiked;

      setState((prev) => {
        const curSession: LastSessionState = prev.preferences.lastSession || {
          activeTab: 'music',
          savedAt: Date.now(),
        };
        const existing = curSession.likedSocialTracks || [];
        const filtered = existing.filter((t) => t.id !== track.id);
        const nextList = nextLiked
          ? [{ ...track, likedByMe: true }, ...filtered]
          : filtered;
        return {
          ...prev,
          updatedAt: Math.max(Date.now(), (prev.updatedAt || 0) + 1),
          preferences: {
            ...prev.preferences,
            lastSession: {
              ...curSession,
              likedSocialTracks: nextList,
              savedAt: Date.now(),
            },
          },
        };
      });
      return nextLiked;
    },
    []
  );

  const updateLikedSocialTrackMeta = useCallback(
    (trackId: string, patch: Partial<SocialTrackItem>) => {
      setState((prev) => {
        const curSession: LastSessionState = prev.preferences.lastSession || {
          activeTab: 'music',
          savedAt: Date.now(),
        };
        const existing = curSession.likedSocialTracks || [];
        if (!existing.some((t) => t.id === trackId)) return prev;
        return {
          ...prev,
          updatedAt: Math.max(Date.now(), (prev.updatedAt || 0) + 1),
          preferences: {
            ...prev.preferences,
            lastSession: {
              ...curSession,
              likedSocialTracks: existing.map((t) =>
                t.id === trackId ? { ...t, ...patch } : t
              ),
              savedAt: Date.now(),
            },
          },
        };
      });
    },
    []
  );

  // Automatic silent Google Drive MP3 sync on every page load / refresh (after cloud hydration)
  // and whenever returning to the app after >= 2 min! Never opens any popup.
  useEffect(() => {
    if (!cloudUser || !lastCloudSyncAt) return;

    void fetchPermanentDriveSession(resolvedFbConfig).then((res) => {
      if (res.serviceAccountEmail) setServiceAccountEmail(res.serviceAccountEmail);
    });

    if (lastDriveAutoSyncAtRef.current === 0) {
      void syncAllConnectedDrives({ silent: true });
    }

    const onVisible = () => {
      if (
        document.visibilityState === 'visible' &&
        Date.now() - lastDriveAutoSyncAtRef.current >= 120_000
      ) {
        void syncAllConnectedDrives({ silent: true });
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [cloudUser?.uid, Boolean(lastCloudSyncAt), resolvedFbConfig, syncAllConnectedDrives]);

  const updateMusicTrack = useCallback((id: string, patch: Partial<MusicTrack>) => {
    touch((prev) => ({
      ...prev,
      musicTracks: prev.musicTracks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
  }, []);

  const renameTrackGroup = useCallback((trackIds: string[], newTitle: string) => {
    const idSet = new Set(trackIds);
    const clean = newTitle.trim();
    touch((prev) => ({
      ...prev,
      musicTracks: prev.musicTracks.map((t) =>
        idSet.has(t.id) ? { ...t, manualGroupTitle: clean || undefined } : t
      ),
    }));
  }, []);

  const setTrackGroupCover = useCallback(
    (trackIds: string[], cover: { coverDataUrl?: string | null; coverGradient?: string }) => {
      if (trackIds.length === 0) return;
      const idSet = new Set(trackIds);
      // Store inline coverDataUrl on ONLY ONE representative track in the group to avoid
      // duplicating base64 image data across 5-15 versions (keeps Firestore well under 1 MiB!).
      // resolveEffectiveTrackCover automatically shares it across all sibling versions.
      const primaryId = trackIds[0];
      touch((prev) => ({
        ...prev,
        musicTracks: prev.musicTracks.map((t) => {
          if (!idSet.has(t.id)) return t;
          const next = { ...t };
          if ('coverDataUrl' in cover) {
            if (cover.coverDataUrl) {
              next.coverDataUrl = t.id === primaryId ? cover.coverDataUrl : undefined;
            } else {
              next.coverDataUrl = undefined;
              next.coverMediaId = undefined;
              next.cloudCoverUrl = undefined;
            }
          }
          if (cover.coverGradient !== undefined) {
            next.coverGradient = cover.coverGradient;
          }
          return next;
        }),
      }));
    },
    []
  );

  const setTrackGroupFavorite = useCallback((trackIds: string[], isFavorite: boolean) => {
    const idSet = new Set(trackIds);
    touch((prev) => ({
      ...prev,
      musicTracks: prev.musicTracks.map((t) =>
        idSet.has(t.id) ? { ...t, isFavorite } : t
      ),
    }));
  }, []);

  const setTrackGroupRatings = useCallback(
    (
      trackIds: string[],
      ratings: { ratingCurrent?: number | null; ratingPotential?: number | null }
    ) => {
      const idSet = new Set(trackIds);
      touch((prev) => ({
        ...prev,
        musicTracks: prev.musicTracks.map((t) => {
          if (!idSet.has(t.id)) return t;
          const next = { ...t };
          if ('ratingCurrent' in ratings) {
            next.ratingCurrent =
              typeof ratings.ratingCurrent === 'number'
                ? Math.max(1, Math.min(10, Math.round(ratings.ratingCurrent)))
                : undefined;
          }
          if ('ratingPotential' in ratings) {
            next.ratingPotential =
              typeof ratings.ratingPotential === 'number'
                ? Math.max(1, Math.min(10, Math.round(ratings.ratingPotential)))
                : undefined;
          }
          return next;
        }),
      }));
    },
    []
  );

  const setTrackGroupWorkflow = useCallback(
    (
      trackIds: string[],
      patch: { status?: import('../types').TrackStatus; mood?: import('../types').TrackMood | null }
    ) => {
      const idSet = new Set(trackIds);
      touch((prev) => ({
        ...prev,
        musicTracks: prev.musicTracks.map((t) => {
          if (!idSet.has(t.id)) return t;
          const next = { ...t };
          if (patch.status !== undefined) {
            next.status = patch.status;
          }
          if ('mood' in patch) {
            next.mood = patch.mood || undefined;
          }
          return next;
        }),
      }));
    },
    []
  );

  const addMusicTrackTodo = useCallback((trackId: string, label: string) => {
    const clean = label.trim();
    if (!clean) return;
    touch((prev) => ({
      ...prev,
      musicTracks: prev.musicTracks.map((t) =>
        t.id === trackId
          ? { ...t, todos: [...(t.todos || []), { id: uid('ttd'), label: clean, done: false }] }
          : t
      ),
    }));
  }, []);

  const toggleMusicTrackTodo = useCallback((trackId: string, todoId: string) => {
    touch((prev) => ({
      ...prev,
      musicTracks: prev.musicTracks.map((t) =>
        t.id === trackId
          ? {
              ...t,
              todos: (t.todos || []).map((td) =>
                td.id === todoId ? { ...td, done: !td.done } : td
              ),
            }
          : t
      ),
    }));
  }, []);

  const deleteMusicTrackTodo = useCallback((trackId: string, todoId: string) => {
    touch((prev) => ({
      ...prev,
      musicTracks: prev.musicTracks.map((t) =>
        t.id === trackId
          ? { ...t, todos: (t.todos || []).filter((td) => td.id !== todoId) }
          : t
      ),
    }));
  }, []);

  const addTrackMarker = useCallback((trackId: string, marker: Omit<AudioMarker, 'id'>) => {
    touch((prev) => ({
      ...prev,
      musicTracks: prev.musicTracks.map((t) =>
        t.id === trackId
          ? {
              ...t,
              markers: [...t.markers, { ...marker, id: uid('mk') }].sort(
                (a, b) => a.timeSec - b.timeSec
              ),
            }
          : t
      ),
    }));
  }, []);

  const deleteTrackMarker = useCallback((trackId: string, markerId: string) => {
    touch((prev) => ({
      ...prev,
      musicTracks: prev.musicTracks.map((t) =>
        t.id === trackId ? { ...t, markers: t.markers.filter((m) => m.id !== markerId) } : t
      ),
    }));
  }, []);

  const deleteMusicTrack = useCallback(
    (id: string) => {
      setState((prev) => {
        const target = prev.musicTracks.find((t) => t.id === id);
        if (target?.mediaId) void deleteMediaBlob(target.mediaId);
        if (target?.coverMediaId) void deleteMediaBlob(target.coverMediaId);
        return {
          ...prev,
          musicTracks: prev.musicTracks.filter((t) => t.id !== id),
          updatedAt: Date.now(),
        };
      });
      notify('Morceau supprimé');
    },
    [notify]
  );

  // LexCore Folders & Lyrics
  const addLyricsFolder = useCallback((name: string, parentId: string | null) => {
    const id = uid('fld');
    touch((prev) => ({
      ...prev,
      lyricsFolders: [
        ...prev.lyricsFolders,
        { id, name: name.trim() || 'Nouveau dossier', parentId, createdAt: new Date().toISOString() },
      ],
    }));
    return id;
  }, []);

  const renameLyricsFolder = useCallback((id: string, name: string) => {
    touch((prev) => ({
      ...prev,
      lyricsFolders: prev.lyricsFolders.map((f) => (f.id === id ? { ...f, name: name.trim() || f.name } : f)),
    }));
  }, []);

  const moveLyricsFolder = useCallback((id: string, parentId: string | null) => {
    if (id === parentId) return;
    touch((prev) => ({
      ...prev,
      lyricsFolders: prev.lyricsFolders.map((f) => (f.id === id ? { ...f, parentId } : f)),
    }));
  }, []);

  const deleteLyricsFolder = useCallback((id: string) => {
    touch((prev) => ({
      ...prev,
      lyricsFolders: prev.lyricsFolders.filter((f) => f.id !== id),
      lyricsDocs: prev.lyricsDocs.map((d) => (d.folderId === id ? { ...d, folderId: null } : d)),
    }));
  }, []);

  const addLyricsDoc = useCallback((partial: Partial<Omit<LyricsDoc, 'id'>>) => {
    const id = uid('lyr');
    touch((prev) => {
      const baseTitle = partial.title || 'Nouveau Texte';
      let title = baseTitle;
      let i = 2;
      const existing = new Set(prev.lyricsDocs.map((d) => d.title));
      while (existing.has(title)) {
        title = `${baseTitle} ${i++}`;
      }
      const nextDoc: LyricsDoc = {
        id,
        title,
        content: partial.content || '',
        folderId: partial.folderId ?? null,
        status: partial.status || 1,
        mediaUrl: partial.mediaUrl || '',
        linkedTrackId: partial.linkedTrackId,
        linkedProjectId: partial.linkedProjectId,
        loop: partial.loop ?? false,
        markers: partial.markers || { start: null, end: null },
        deletedAt: null,
        lastModified: new Date().toISOString(),
      };
      return { ...prev, lyricsDocs: [nextDoc, ...prev.lyricsDocs] };
    });
    return id;
  }, []);

  const updateLyricsDoc = useCallback((id: string, patch: Partial<LyricsDoc>) => {
    touch((prev) => ({
      ...prev,
      lyricsDocs: prev.lyricsDocs.map((d) =>
        d.id === id ? { ...d, ...patch, lastModified: new Date().toISOString() } : d
      ),
    }));
  }, []);

  const softDeleteLyricsDoc = useCallback(
    (id: string) => {
      touch((prev) => ({
        ...prev,
        lyricsDocs: prev.lyricsDocs.map((d) =>
          d.id === id ? { ...d, deletedAt: new Date().toISOString() } : d
        ),
      }));
      notify('Texte déplacé dans la corbeille');
    },
    [notify]
  );

  const restoreLyricsDoc = useCallback(
    (id: string) => {
      touch((prev) => ({
        ...prev,
        lyricsDocs: prev.lyricsDocs.map((d) => (d.id === id ? { ...d, deletedAt: null } : d)),
      }));
      notify('Texte restauré');
    },
    [notify]
  );

  const permanentDeleteLyricsDoc = useCallback((id: string) => {
    touch((prev) => ({ ...prev, lyricsDocs: prev.lyricsDocs.filter((d) => d.id !== id) }));
  }, []);

  const emptyLyricsTrash = useCallback(() => {
    touch((prev) => ({ ...prev, lyricsDocs: prev.lyricsDocs.filter((d) => !d.deletedAt) }));
    notify('Corbeille vidée');
  }, [notify]);

  const importLexCoreBackup = useCallback(
    (incomingFolders: LyricsFolder[], incomingDocs: LyricsDoc[]) => {
      const existingFolders = latestStateRef.current.lyricsFolders;
      const existingDocs = latestStateRef.current.lyricsDocs;

      // Map duplicate folder names under same parent to existing folder ID
      const folderRemap = new Map<string, string>();
      const foldersToAdd: LyricsFolder[] = [];

      for (const f of incomingFolders) {
        const mappedParent = f.parentId ? folderRemap.get(f.parentId) || f.parentId : null;
        const match = existingFolders.find(
          (ef) =>
            ef.parentId === mappedParent &&
            ef.name.trim().toLowerCase() === f.name.trim().toLowerCase()
        );
        if (match) {
          folderRemap.set(f.id, match.id);
        } else {
          foldersToAdd.push({ ...f, parentId: mappedParent });
        }
      }

      const existingDocSig = new Set(
        existingDocs.map(
          (d) => `${d.title.trim().toLowerCase()}::${(d.content || '').trim().slice(0, 160)}`
        )
      );

      const docsToAdd: LyricsDoc[] = [];
      let skipped = 0;

      for (const d of incomingDocs) {
        const sig = `${d.title.trim().toLowerCase()}::${(d.content || '').trim().slice(0, 160)}`;
        if (existingDocSig.has(sig)) {
          skipped++;
          continue;
        }
        existingDocSig.add(sig);
        const mappedFolder = d.folderId ? folderRemap.get(d.folderId) || d.folderId : null;
        docsToAdd.push({ ...d, folderId: mappedFolder });
      }

      if (foldersToAdd.length > 0 || docsToAdd.length > 0) {
        touch((prev) => ({
          ...prev,
          lyricsFolders: [...prev.lyricsFolders, ...foldersToAdd],
          lyricsDocs: [...docsToAdd, ...prev.lyricsDocs],
        }));
      }

      return {
        foldersAdded: foldersToAdd.length,
        docsAdded: docsToAdd.length,
        skipped,
      };
    },
    []
  );

  // Music Projects
  const addMusicProject = useCallback(
    (project: Omit<MusicProject, 'id'>) => {
      const id = uid('proj');
      touch((prev) => ({ ...prev, musicProjects: [{ ...project, id }, ...prev.musicProjects] }));
      notify(`Projet « ${project.title} » créé`);
      return id;
    },
    [notify]
  );

  const updateMusicProject = useCallback((id: string, patch: Partial<MusicProject>) => {
    touch((prev) => ({
      ...prev,
      musicProjects: prev.musicProjects.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
  }, []);

  /**
   * Switches which version of a song group is used inside a specific project.
   * - If `mode === 'auto'` OR `trackId` is the group's latest version (and `mode !== 'pin'`),
   *   the pin is cleared so future Drive versions auto-update this song in the project.
   * - Otherwise, pins `trackId` in `project.pinnedVersionByGroup[groupKey]` so auto-sync
   *   preserves the user's explicit version choice for this project.
   */
  const setProjectTrackVersion = useCallback(
    (projectId: string, groupKey: string, trackId: string, mode?: 'auto' | 'pin') => {
      touch((prev) => {
        const project = prev.musicProjects.find((p) => p.id === projectId);
        if (!project) return prev;

        const groups = groupMusicTracks(prev.musicTracks);
        const group =
          groups.find((g) => g.groupKey === groupKey) ||
          groups.find((g) => g.allTrackIds.includes(trackId));
        if (!group) return prev;

        const targetExists = group.allTrackIds.includes(trackId);
        const useAuto =
          mode === 'auto' ||
          (!targetExists && mode !== 'pin') ||
          (mode !== 'pin' && trackId === group.latestTrack.id);
        const resolvedId = useAuto ? group.latestTrack.id : trackId;
        const groupIdSet = new Set(group.allTrackIds);

        const replaceList = (ids: string[] | undefined): string[] | undefined => {
          if (!ids) return ids;
          const out: string[] = [];
          let replaced = false;
          for (const id of ids) {
            if (groupIdSet.has(id)) {
              if (!replaced) {
                out.push(resolvedId);
                replaced = true;
              }
            } else if (!out.includes(id)) {
              out.push(id);
            }
          }
          return out;
        };

        const nextTrackIds = replaceList(project.trackIds) || [];
        const nextBenchTrackIds = replaceList(project.benchTrackIds);
        const nextSprints = project.sprints?.map((spr) => ({
          ...spr,
          trackIds: replaceList(spr.trackIds) || [],
        }));

        const nextPins = { ...(project.pinnedVersionByGroup || {}) };
        if (useAuto) {
          delete nextPins[group.groupKey];
        } else {
          nextPins[group.groupKey] = resolvedId;
        }
        const pinnedVersionByGroup = Object.keys(nextPins).length > 0 ? nextPins : undefined;

        const explicitTitle =
          group.latestTrack.manualGroupTitle?.trim() ||
          group.versions
            .find((v) => Boolean(v.track.manualGroupTitle?.trim()))
            ?.track.manualGroupTitle?.trim();
        const isInActiveTracklist = nextTrackIds.includes(resolvedId);

        const nextProjects = prev.musicProjects.map((p) =>
          p.id === projectId
            ? {
                ...p,
                trackIds: nextTrackIds,
                ...(nextBenchTrackIds !== undefined ? { benchTrackIds: nextBenchTrackIds } : {}),
                ...(nextSprints !== undefined ? { sprints: nextSprints } : {}),
                pinnedVersionByGroup,
              }
            : p
        );

        const nextTracks = prev.musicTracks.map((t) => {
          if (!groupIdSet.has(t.id)) return t;
          if (t.id === resolvedId) {
            return {
              ...t,
              ...(isInActiveTracklist ? { linkedProjectId: projectId } : {}),
              ...(explicitTitle && !t.manualGroupTitle?.trim()
                ? { manualGroupTitle: explicitTitle }
                : {}),
            };
          }
          if (t.linkedProjectId === projectId) {
            return { ...t, linkedProjectId: undefined };
          }
          return t;
        });

        return {
          ...prev,
          musicProjects: nextProjects,
          musicTracks: nextTracks,
        };
      });
    },
    []
  );

  /**
   * Globally sets the selected active version (song or prod) for a track group.
   * Once changed on the Song Page, every tab (Accueil, Sons, Projets, Packs, Playlists, Textes, Lecteur)
   * automatically plays and displays that exact chosen version!
   */
  const selectGroupPreferredVersion = useCallback(
    (targetTrackId: string, kind: 'song' | 'prod') => {
      touch((prev) => {
        const groups = groupMusicTracks(prev.musicTracks);
        const group = groups.find((g) => g.allTrackIds.includes(targetTrackId));
        if (!group) return prev;

        const scopeIds = new Set(
          kind === 'prod'
            ? group.prodTracks.map((p) => p.track.id)
            : group.versions.map((v) => v.track.id)
        );
        if (!scopeIds.has(targetTrackId)) return prev;

        const allGroupIds = new Set(group.allTrackIds);
        const targetTrack = prev.musicTracks.find((t) => t.id === targetTrackId);
        const linkedProjectId =
          targetTrack?.linkedProjectId ||
          group.versions.find((v) => Boolean(v.track.linkedProjectId))?.track.linkedProjectId;
        const linkedLyricsId =
          targetTrack?.linkedLyricsId ||
          group.versions.find((v) => Boolean(v.track.linkedLyricsId))?.track.linkedLyricsId;

        const nextTracks = prev.musicTracks.map((t) => {
          if (!scopeIds.has(t.id)) return t;
          if (t.id === targetTrackId) {
            return {
              ...t,
              isPreferredVersion: true,
              ...(kind === 'song' && linkedProjectId && !t.linkedProjectId
                ? { linkedProjectId }
                : {}),
              ...(kind === 'song' && linkedLyricsId && !t.linkedLyricsId
                ? { linkedLyricsId }
                : {}),
            };
          }
          if (t.isPreferredVersion) {
            const copy = { ...t };
            delete copy.isPreferredVersion;
            return copy;
          }
          return t;
        });

        if (kind === 'prod') {
          return { ...prev, musicTracks: nextTracks };
        }

        const replaceIds = (ids: string[] | undefined): string[] | undefined => {
          if (!ids) return ids;
          const out: string[] = [];
          let placed = false;
          for (const id of ids) {
            if (allGroupIds.has(id)) {
              if (!placed) {
                out.push(targetTrackId);
                placed = true;
              }
            } else if (!out.includes(id)) {
              out.push(id);
            }
          }
          return out;
        };

        const nextProjects = prev.musicProjects.map((p) => {
          const touches =
            p.trackIds.some((id) => allGroupIds.has(id)) ||
            (p.benchTrackIds || []).some((id) => allGroupIds.has(id)) ||
            (p.packs || []).some((pk) => pk.trackIds.some((id) => allGroupIds.has(id))) ||
            Boolean(p.pinnedVersionByGroup?.[group.groupKey]);
          if (!touches) return p;

          const nextPins = { ...(p.pinnedVersionByGroup || {}) };
          delete nextPins[group.groupKey];

          return {
            ...p,
            trackIds: replaceIds(p.trackIds) || p.trackIds,
            ...(p.benchTrackIds ? { benchTrackIds: replaceIds(p.benchTrackIds) } : {}),
            ...(p.packs
              ? {
                  packs: p.packs.map((pk) => ({
                    ...pk,
                    trackIds: replaceIds(pk.trackIds) || pk.trackIds,
                    ...(pk.doneTrackIds ? { doneTrackIds: replaceIds(pk.doneTrackIds) } : {}),
                  })),
                }
              : {}),
            ...(p.sprints
              ? {
                  sprints: p.sprints.map((s) => ({
                    ...s,
                    trackIds: replaceIds(s.trackIds) || s.trackIds,
                  })),
                }
              : {}),
            pinnedVersionByGroup: Object.keys(nextPins).length > 0 ? nextPins : undefined,
          };
        });

        const nextLyricsDocs = prev.lyricsDocs.map((doc) =>
          doc.linkedTrackId && allGroupIds.has(doc.linkedTrackId)
            ? { ...doc, linkedTrackId: targetTrackId }
            : doc
        );

        const prevPlaylists = prev.preferences.lastSession?.playlists;
        const nextPlaylists = prevPlaylists
          ? prevPlaylists.map((pl) =>
              pl.ownTrackIds.some((id) => allGroupIds.has(id))
                ? { ...pl, ownTrackIds: replaceIds(pl.ownTrackIds) || pl.ownTrackIds }
                : pl
            )
          : undefined;

        return {
          ...prev,
          musicTracks: nextTracks,
          musicProjects: nextProjects,
          lyricsDocs: nextLyricsDocs,
          ...(nextPlaylists && prev.preferences.lastSession
            ? {
                preferences: {
                  ...prev.preferences,
                  lastSession: {
                    ...prev.preferences.lastSession,
                    playlists: nextPlaylists,
                  },
                },
              }
            : {}),
        };
      });
    },
    []
  );

  // Automatically reconcile project track versions whenever tracks or projects change
  // (e.g., on cloud hydration, after Drive sync, or after manual version linking/detaching).
  useEffect(() => {
    if (cloudConfigured && cloudUser && !cloudHydratedRef.current) return;
    const res = reconcileProjectTrackVersions(state.musicProjects, state.musicTracks);
    if (!res.changed) return;
    touch((prev) => {
      const latest = reconcileProjectTrackVersions(prev.musicProjects, prev.musicTracks);
      if (!latest.changed) return prev;
      return {
        ...prev,
        musicProjects: latest.musicProjects,
        musicTracks: latest.musicTracks,
      };
    });
  }, [state.musicTracks, state.musicProjects, lastCloudSyncAt, cloudConfigured, cloudUser?.uid]);

  const toggleMusicProjectStep = useCallback((projectId: string, stepId: string) => {
    touch((prev) => ({
      ...prev,
      musicProjects: prev.musicProjects.map((p) =>
        p.id === projectId
          ? { ...p, steps: p.steps.map((s) => (s.id === stepId ? { ...s, done: !s.done } : s)) }
          : p
      ),
    }));
  }, []);

  const addMusicProjectStep = useCallback((projectId: string, label: string, dueDate?: string) => {
    const clean = label.trim();
    if (!clean) return;
    touch((prev) => ({
      ...prev,
      musicProjects: prev.musicProjects.map((p) =>
        p.id === projectId
          ? { ...p, steps: [...p.steps, { id: uid('ps'), label: clean, done: false, dueDate }] }
          : p
      ),
    }));
  }, []);

  const deleteMusicProjectStep = useCallback((projectId: string, stepId: string) => {
    touch((prev) => ({
      ...prev,
      musicProjects: prev.musicProjects.map((p) =>
        p.id === projectId ? { ...p, steps: p.steps.filter((s) => s.id !== stepId) } : p
      ),
    }));
  }, []);

  const deleteMusicProject = useCallback(
    (id: string) => {
      touch((prev) => ({ ...prev, musicProjects: prev.musicProjects.filter((p) => p.id !== id) }));
      notify('Projet supprimé');
    },
    [notify]
  );

  // ===== ENERGY & FOCUS =====
  const setEnergyCheckin = useCallback(
    (checkin: EnergyCheckin) => {
      touch((prev) => ({
        ...prev,
        energyCheckins: { ...prev.energyCheckins, [checkin.date]: checkin },
      }));
      notify(`Énergie du jour : ${checkin.level}/5`);
    },
    [notify]
  );

  const addFocusSession = useCallback(
    (session: Omit<FocusSession, 'id'>) => {
      touch((prev) => ({
        ...prev,
        focusSessions: [{ ...session, id: uid('foc') }, ...prev.focusSessions],
      }));
      notify(`Session Focus (${session.durationMin} min) enregistrée`);
    },
    [notify]
  );

  // ===== PERSISTENT LIVE WORKOUT & LIVE FOCUS =====
  const startActiveWorkout = useCallback((session: WorkoutSession) => {
    const draft: ActiveWorkoutDraft = {
      session,
      elapsedSec: 0,
      paused: false,
      lastTickAt: Date.now(),
    };
    touch((prev) => ({
      ...prev,
      preferences: { ...prev.preferences, activeWorkout: draft },
    }));
    setWorkoutModalOpen(true);
  }, []);

  const updateActiveWorkout = useCallback((draft: ActiveWorkoutDraft | null) => {
    touch((prev) => ({
      ...prev,
      preferences: { ...prev.preferences, activeWorkout: draft || undefined },
    }));
  }, []);

  const finishActiveWorkout = useCallback(
    (completed: WorkoutSession) => {
      touch((prev) => {
        const exists = completed.id && prev.workouts.some((w) => w.id === completed.id);
        const nextWorkouts = exists
          ? prev.workouts.map((w) => (w.id === completed.id ? { ...w, ...completed } : w))
          : [{ ...completed, id: completed.id || uid('wk') }, ...prev.workouts];
        return {
          ...prev,
          workouts: nextWorkouts,
          preferences: { ...prev.preferences, activeWorkout: undefined },
        };
      });
      setWorkoutModalOpen(false);
      notify(
        completed.prCount
          ? `Séance terminée · ${completed.totalVolumeKg} kg · ${completed.prCount} PR 🏆`
          : `Séance terminée · ${completed.totalVolumeKg || 0} kg`
      );
    },
    [notify]
  );

  const discardActiveWorkout = useCallback(() => {
    touch((prev) => ({
      ...prev,
      preferences: { ...prev.preferences, activeWorkout: undefined },
    }));
    setWorkoutModalOpen(false);
    notify('Séance en cours abandonnée');
  }, [notify]);

  const startActiveFocus = useCallback((focus: ActiveFocusSession) => {
    touch((prev) => ({
      ...prev,
      preferences: { ...prev.preferences, activeFocus: focus },
    }));
  }, []);

  const stopActiveFocus = useCallback(() => {
    touch((prev) => ({
      ...prev,
      preferences: { ...prev.preferences, activeFocus: undefined },
    }));
  }, []);

  const completeActiveFocus = useCallback(() => {
    const active = latestStateRef.current.preferences.activeFocus;
    if (!active) return;
    touch((prev) => {
      const curr = prev.preferences.activeFocus;
      if (!curr) return prev;
      const alreadyLogged = prev.focusSessions.some((f) => f.id === curr.id);
      const nextSessions = alreadyLogged
        ? prev.focusSessions
        : [
            {
              id: curr.id,
              date: new Date(curr.endsAt).toISOString().slice(0, 10),
              durationMin: curr.presetMin,
              label: curr.label || 'Session Focus',
              category: curr.category,
              linkedTrackId: curr.linkedTrackId,
              completedAt: new Date(curr.endsAt).toISOString(),
            },
            ...prev.focusSessions,
          ];
      return {
        ...prev,
        focusSessions: nextSessions,
        preferences: { ...prev.preferences, activeFocus: undefined },
      };
    });
    notify(`Session Focus (${active.presetMin} min) terminée ✓`);
  }, [notify]);

  // ===== PREFERENCES =====
  const updatePreferences = useCallback((patch: Partial<UserPreferences>) => {
    touch((prev) => {
      const prevName = (prev.preferences.name || '').trim();
      const nextName =
        typeof patch.name === 'string' ? patch.name.trim() : prevName;
      const renamedArtist =
        typeof patch.name === 'string' && nextName.length > 0 && nextName !== prevName;

      return {
        ...prev,
        musicTracks: renamedArtist
          ? prev.musicTracks.map((t) => {
              const curArtist = (t.artist || '').trim();
              if (
                !curArtist ||
                curArtist === prevName ||
                curArtist.toLowerCase() === 'moi' ||
                curArtist.toLowerCase() === 'artiste'
              ) {
                return { ...t, artist: nextName };
              }
              return t;
            })
          : prev.musicTracks,
        preferences: {
          ...prev.preferences,
          ...patch,
          nutritionGoals: patch.nutritionGoals
            ? { ...prev.preferences.nutritionGoals, ...patch.nutritionGoals }
            : prev.preferences.nutritionGoals,
        },
      };
    });
  }, []);

  const updateLastSession = useCallback((patch: Partial<Omit<LastSessionState, 'savedAt'>>) => {
    const keys = Object.keys(patch) as (keyof Omit<LastSessionState, 'savedAt'>)[];
    const hasSharedStudioChange = keys.some(
      (k) => k === 'driveSources' || k === 'playlists' || k === 'likedSocialTracks'
    );

    setState((prev) => {
      const cur: LastSessionState = prev.preferences.lastSession || {
        activeTab: 'today',
        savedAt: 0,
      };
      const next: LastSessionState = {
        ...cur,
        ...patch,
        savedAt: Date.now(),
      };
      const changed = keys.some((k) => cur[k] !== next[k]);
      if (!changed) return prev;
      // Local-only UI navigation changes (tab, scroll, audioExpanded, audioTimeSec…) stay in localStorage
      // and NEVER trigger a heavy Firestore push to other devices!
      if (!hasSharedStudioChange) {
        ignoreNextPushRef.current = true;
      }
      return {
        ...prev,
        preferences: {
          ...prev.preferences,
          lastSession: next,
        },
        ...(hasSharedStudioChange ? { updatedAt: Date.now() } : {}),
      };
    });
  }, []);

  const publishLivePlayback = useCallback(
    async (live: LivePlaybackState | null) => {
      const cur = latestStateRef.current;
      const prevSession: LastSessionState = cur.preferences.lastSession || {
        activeTab: 'music',
        savedAt: Date.now(),
      };
      latestStateRef.current = {
        ...cur,
        preferences: {
          ...cur.preferences,
          lastSession: {
            ...prevSession,
            livePlayback: live,
          },
        },
      };
      lastLiveSigRef.current = buildLiveSig(live);
      isLocalActiveConnectRef.current = Boolean(live);
      setLivePlayback(live);
      // 1. Instant (<1ms) broadcast to all other tabs in this browser!
      try {
        connectChannelRef.current?.postMessage({ kind: 'livePlayback', payload: live });
      } catch {
        // ignore channel closed
      }
      // 2. Cloud delta to Firestore for cross-device control (PC <-> iPhone)
      if (!cloudUser) return;
      try {
        await pushLivePlaybackDelta(resolvedFbConfig, cloudUser.uid, live);
      } catch (err) {
        console.warn('[Rowav Connect] publishLivePlayback error:', err);
      }
    },
    [cloudUser, resolvedFbConfig]
  );

  const publishLiveCommand = useCallback(
    async (cmd: LivePlaybackCommand | null) => {
      const cur = latestStateRef.current;
      const prevSession: LastSessionState = cur.preferences.lastSession || {
        activeTab: 'music',
        savedAt: Date.now(),
      };
      latestStateRef.current = {
        ...cur,
        preferences: {
          ...cur.preferences,
          lastSession: {
            ...prevSession,
            liveCommand: cmd,
          },
        },
      };
      lastCmdIdRef.current = cmd?.id || '';
      // 1. Instant (<1ms) command delivery to any other tab in this browser!
      try {
        connectChannelRef.current?.postMessage({ kind: 'liveCommand', payload: cmd });
      } catch {
        // ignore channel closed
      }
      // 2. Cloud delta to Firestore for cross-device control (PC <-> iPhone)
      if (!cloudUser) return;
      try {
        await pushLiveCommandDelta(resolvedFbConfig, cloudUser.uid, cmd);
      } catch (err) {
        console.warn('[Rowav Connect] publishLiveCommand error:', err);
      }
    },
    [cloudUser, resolvedFbConfig]
  );

  const toggleTheme = useCallback(() => {
    touch((prev) => ({
      ...prev,
      preferences: {
        ...prev.preferences,
        theme: prev.preferences.theme === 'dark' ? 'light' : 'dark',
      },
    }));
  }, []);

  const resetToDemo = useCallback(() => {
    setState((prev) => ({
      ...createSeedState(),
      preferences: prev.preferences,
      updatedAt: Math.max(Date.now(), (prev.updatedAt || 0) + 1),
    }));
    notify('Données démo Kora chargées');
  }, [notify]);

  const clearAllData = useCallback(() => {
    setState((prev) => ({
      ...createEmptyState(),
      preferences: prev.preferences,
      updatedAt: Math.max(Date.now(), (prev.updatedAt || 0) + 1),
    }));
    notify('Espace vidé — prêt pour ton programme');
  }, [notify]);

  const exportStateJSON = useCallback(() => JSON.stringify(state, null, 2), [state]);

  const importStateJSON = useCallback(
    (json: string) => {
      try {
        const parsed = JSON.parse(json) as Partial<AppState>;
        if (!parsed || typeof parsed !== 'object') return false;
        setState((prev) => ({
          ...mergeWithSeed(parsed),
          updatedAt: Math.max(Date.now(), (prev.updatedAt || 0) + 1),
        }));
        notify('Sauvegarde importée');
        return true;
      } catch {
        return false;
      }
    },
    [notify]
  );

  const exposedState = useMemo<AppState>(() => {
    const disabledIds = new Set(
      driveSources.filter((s) => s.enabled === false).map((s) => s.id)
    );
    if (disabledIds.size === 0) return state;
    const allDisabled =
      driveSources.length > 0 && driveSources.every((s) => s.enabled === false);
    const singleDisabledId =
      driveSources.length === 1 && driveSources[0].enabled === false
        ? driveSources[0].id
        : null;
    return {
      ...state,
      musicTracks: state.musicTracks.filter((t) => {
        if (!t.googleDriveFileId) return true;
        if (allDisabled) return false;
        if (t.driveSourceId && disabledIds.has(t.driveSourceId)) return false;
        if (!t.driveSourceId && singleDisabledId) return false;
        return true;
      }),
    };
  }, [state, driveSources]);

  return (
    <AppContext.Provider
      value={{
        state: exposedState,
        toast,
        dismissToast,
        notify,
        cloudUser,
        authReady,
        authError,
        clearAuthError,
        cloudConfigured,
        cloudSyncing,
        cloudError,
        lastCloudSyncAt,
        connectGoogleCloud,
        connectEmailCloud,
        registerEmailCloud,
        forceSaveCloud,
        disconnectGoogleCloud,
        saveAndOptionallySyncMedia,
        addEvent,
        addManyEvents,
        syncGoogleCalendarEvents,
        updateEvent,
        deleteEvent,
        addHomework,
        toggleHomework,
        updateHomework,
        deleteHomework,
        addExam,
        updateExam,
        toggleExamTopic,
        addExamTopic,
        deleteExamTopic,
        deleteExam,
        updateAcademicProfile,
        addSubject,
        updateSubject,
        deleteSubject,
        addGrade,
        addManyGrades,
        deleteGrade,
        addCourseDoc,
        deleteCourseDoc,
        addTask,
        toggleTask,
        updateTask,
        deleteTask,
        addWorkout,
        updateWorkout,
        toggleWorkoutSet,
        updateWorkoutSet,
        addWorkoutSet,
        deleteWorkoutSet,
        addWorkoutExercise,
        deleteWorkoutExercise,
        deleteWorkout,
        addRoutine,
        updateRoutine,
        deleteRoutine,
        updateFitnessProfile,
        addMeal,
        deleteMeal,
        addMealPreset,
        deleteMealPreset,
        addWater,
        addWeight,
        deleteWeight,
        autoSyncingDrive,
        driveSources,
        serviceAccountEmail,
        driveStorageStatus,
        driveLastBackupAt,
        syncStudioDataToDriveNow,
        authorizeDriveWriteAndSync,
        connectDriveSource,
        updateDriveSource,
        toggleDriveSource,
        removeDriveSource,
        syncAllConnectedDrives,
        playlists,
        likedSocialTracks,
        createPlaylist,
        updatePlaylist,
        deletePlaylist,
        toggleTrackInPlaylist,
        toggleLikeSocialTrack,
        updateLikedSocialTrackMeta,
        addMusicTrack,
        syncMusicTracksBatch,
        updateMusicTrack,
        renameTrackGroup,
        setTrackGroupCover,
        setTrackGroupFavorite,
        setTrackGroupRatings,
        setTrackGroupWorkflow,
        selectGroupPreferredVersion,
        addMusicTrackTodo,
        toggleMusicTrackTodo,
        deleteMusicTrackTodo,
        addTrackMarker,
        deleteTrackMarker,
        deleteMusicTrack,
        addLyricsFolder,
        renameLyricsFolder,
        moveLyricsFolder,
        deleteLyricsFolder,
        addLyricsDoc,
        updateLyricsDoc,
        softDeleteLyricsDoc,
        restoreLyricsDoc,
        permanentDeleteLyricsDoc,
        emptyLyricsTrash,
        importLexCoreBackup,
        addMusicProject,
        updateMusicProject,
        setProjectTrackVersion,
        toggleMusicProjectStep,
        addMusicProjectStep,
        deleteMusicProjectStep,
        deleteMusicProject,
        setEnergyCheckin,
        addFocusSession,
        workoutModalOpen,
        setWorkoutModalOpen,
        startActiveWorkout,
        updateActiveWorkout,
        finishActiveWorkout,
        discardActiveWorkout,
        startActiveFocus,
        stopActiveFocus,
        completeActiveFocus,
        updatePreferences,
        updateUserAvatar,
        updateLastSession,
        livePlayback,
        liveCommand,
        publishLivePlayback,
        publishLiveCommand,
        toggleTheme,
        resetToDemo,
        clearAllData,
        importStateJSON,
        exportStateJSON,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
