import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import type {
  AcademicProfile,
  AppState,
  AudioMarker,
  CourseDocument,
  CourseSubject,
  EnergyCheckin,
  ExamItem,
  FitnessProfile,
  FocusSession,
  GradeEntry,
  HomeworkItem,
  LyricsDoc,
  MealEntry,
  MealPreset,
  MusicProject,
  MusicTrack,
  ScheduleEvent,
  TaskItem,
  UserPreferences,
  WeightEntry,
  WorkoutExercise,
  WorkoutRoutine,
  WorkoutSession,
} from '../types';
import { createEmptyState, createSeedState } from '../data/seed';
import { uid } from '../utils/dates';
import {
  completeGoogleRedirectIfPending,
  fetchCloudStateOnce,
  formatFirebaseSyncError,
  getEnvFirebaseConfig,
  listenAuthState,
  pushStateToCloud,
  signInWithEmail,
  signInWithGoogle,
  signOutFirebase,
  signUpWithEmail,
  subscribeCloudState,
  updateFirebaseDisplayName,
  uploadCloudMedia,
} from '../lib/firebase';
import { deleteMediaBlob, saveMediaBlob } from '../lib/mediaDb';

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
  addMusicTrack: (track: Omit<MusicTrack, 'id'>) => string;
  updateMusicTrack: (id: string, patch: Partial<MusicTrack>) => void;
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

  addMusicProject: (project: Omit<MusicProject, 'id'>) => string;
  updateMusicProject: (id: string, patch: Partial<MusicProject>) => void;
  toggleMusicProjectStep: (projectId: string, stepId: string) => void;
  addMusicProjectStep: (projectId: string, label: string, dueDate?: string) => void;
  deleteMusicProjectStep: (projectId: string, stepId: string) => void;
  deleteMusicProject: (id: string) => void;

  // Energy & Focus
  setEnergyCheckin: (checkin: EnergyCheckin) => void;
  addFocusSession: (session: Omit<FocusSession, 'id'>) => void;

  // Preferences & Data
  updatePreferences: (patch: Partial<UserPreferences>) => void;
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
    return mergeWithSeed(JSON.parse(raw) as Partial<AppState>);
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
          // Always trust existing cloud data when signing in on a device!
          ignoreNextPushRef.current = true;
          lastPushedUpdatedAtRef.current = remote.updatedAt || 0;
          setState(mergeWithSeed(remote));
          setLastCloudSyncAt(Date.now());
          setCloudError(null);
        } else {
          // Brand new account in Firestore: seed initial state to cloud
          const ts = await pushStateToCloud(resolvedFbConfig, cloudUser.uid, {
            ...latestStateRef.current,
            updatedAt: Date.now(),
          });
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
              // Ignore local cache echoes of our own writes; accept any server snapshot that differs
              const remoteTs = remote.updatedAt || 0;
              const localTs = latestStateRef.current.updatedAt || 0;
              if (remoteTs === lastPushedUpdatedAtRef.current || remoteTs === localTs) return;
              if (!meta.fromCache || remoteTs > localTs) {
                ignoreNextPushRef.current = true;
                lastPushedUpdatedAtRef.current = remoteTs;
                setState(mergeWithSeed(remote));
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

  const disconnectGoogleCloud = useCallback(async () => {
    await signOutFirebase(resolvedFbConfig);
    setLastCloudSyncAt(null);
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

  const updateMusicTrack = useCallback((id: string, patch: Partial<MusicTrack>) => {
    touch((prev) => ({
      ...prev,
      musicTracks: prev.musicTracks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
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

  // ===== PREFERENCES =====
  const updatePreferences = useCallback((patch: Partial<UserPreferences>) => {
    touch((prev) => ({
      ...prev,
      preferences: {
        ...prev.preferences,
        ...patch,
        nutritionGoals: patch.nutritionGoals
          ? { ...prev.preferences.nutritionGoals, ...patch.nutritionGoals }
          : prev.preferences.nutritionGoals,
      },
    }));
  }, []);

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

  return (
    <AppContext.Provider
      value={{
        state,
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
        addMusicTrack,
        updateMusicTrack,
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
        addMusicProject,
        updateMusicProject,
        toggleMusicProjectStep,
        addMusicProjectStep,
        deleteMusicProjectStep,
        deleteMusicProject,
        setEnergyCheckin,
        addFocusSession,
        updatePreferences,
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
