export type EventType = 'cours' | 'eval' | 'sport' | 'rdv' | 'music';

export type Priority = 'low' | 'medium' | 'high';

export type MealSlot = 'petit-dej' | 'dejeuner' | 'collation' | 'diner';

export type WorkoutFocus = 'Push' | 'Pull' | 'Legs' | 'Upper' | 'Lower' | 'Full Body' | 'Cardio' | 'Autre';

export type ActiveTab = 'today' | 'planning' | 'studies' | 'sport' | 'music';

export type AIDomain = 'general' | 'cours' | 'sport' | 'music';

export type QuickAddMode =
  | 'cours'
  | 'devoir'
  | 'eval'
  | 'sport'
  | 'repas'
  | 'poids'
  | 'rdv'
  | 'tache'
  | 'music';

export type SetType = 'warmup' | 'normal' | 'failure';

export type TrackStatus = 'idee' | 'demo' | 'ecriture' | 'enregistrement' | 'mix' | 'sorti';

export type ProjectKind = 'single' | 'ep' | 'album' | 'mixtape';

export type FitnessGoal = 'prise-de-masse' | 'seche' | 'force' | 'recomposition' | 'endurance';

export interface ScheduleEvent {
  id: string;
  type: EventType;
  title: string;
  subject?: string;
  location?: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  recurringWeekly?: boolean;
  recurringDays?: number[]; // 1=Lun .. 7=Dim
  notes?: string;
  geminiNotebookUrl?: string;
  completed?: boolean;
  linkedExamId?: string;
  linkedWorkoutId?: string;
  linkedProjectId?: string;
  linkedTrackId?: string;
  googleCalendarEventId?: string;
}

export interface HomeworkItem {
  id: string;
  title: string;
  subject: string;
  dueDate: string; // YYYY-MM-DD
  dueTime?: string;
  priority: Priority;
  done: boolean;
  notes?: string;
}

export interface RevisionTopic {
  id: string;
  label: string;
  done: boolean;
}

export interface ExamItem {
  id: string;
  title: string;
  subject: string;
  date: string; // YYYY-MM-DD
  startTime?: string;
  endTime?: string;
  room?: string;
  coefficient?: number;
  geminiNotebookUrl?: string;
  geminiNotebookTitle?: string;
  topics: RevisionTopic[];
  notes?: string;
  done: boolean;
}

export interface AcademicProfile {
  program: string; // Ex. Licence Informatique / Prépa MPSI / Terminale Spé Maths-Physique
  level: string; // Ex. L2 · Semestre 3
  school: string;
  careerGoal: string; // Ex. Ingénieur IA / Développeur Full-Stack
  targetSkills: string[];
  studyPlanSummary: string;
}

export interface CourseSubject {
  id: string;
  name: string;
  coefficient: number;
  teacher?: string;
  targetGrade?: number;
  geminiNotebookUrl?: string;
}

export interface GradeEntry {
  id: string;
  subject: string;
  title: string;
  score: number;
  outOf: number;
  coefficient: number;
  date: string; // YYYY-MM-DD
  source?: 'manual' | 'pronote';
}

export interface CourseDocument {
  id: string;
  subject: string;
  title: string;
  kind: 'programme-pdf' | 'cours-pdf' | 'photo';
  mimeType: string;
  sizeBytes: number;
  mediaId: string; // IndexedDB blob key
  cloudUrl?: string;
  addedAt: string; // ISO string
  notes?: string;
}

export interface TaskItem {
  id: string;
  title: string;
  dueDate?: string; // YYYY-MM-DD
  category: 'perso' | 'rdv' | 'cours' | 'sport' | 'musique';
  priority: Priority;
  done: boolean;
  notes?: string;
  linkedProjectId?: string;
}

export interface WorkoutSet {
  id: string;
  reps: number;
  weightKg: number;
  done: boolean;
  type?: SetType;
}

export interface WorkoutExercise {
  id: string;
  name: string;
  muscleGroup?: string;
  restSeconds?: number;
  notes?: string;
  sets: WorkoutSet[];
}

export interface WorkoutSession {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  startTime?: string; // HH:mm
  durationMin: number;
  focus: WorkoutFocus;
  completed: boolean;
  exercises: WorkoutExercise[];
  notes?: string;
  routineId?: string;
  linkedTrackId?: string;
  totalVolumeKg?: number;
  prCount?: number;
}

export interface WorkoutRoutineExercise {
  id: string;
  name: string;
  muscleGroup?: string;
  defaultSets: number;
  targetReps: string; // e.g. "8-10"
  targetWeightKg?: number;
  restSeconds?: number;
}

export interface WorkoutRoutine {
  id: string;
  title: string;
  focus: WorkoutFocus;
  targetDays?: number[]; // 1..7
  exercises: WorkoutRoutineExercise[];
  notes?: string;
  linkedTrackId?: string;
}

export type ProgressPhotoAngle = 'face' | 'profil' | 'dos';

export interface ProgressPhoto {
  id: string;
  date: string; // YYYY-MM-DD
  label: string; // e.g. "Photo initiale · Jour 1" or "Semaine 3"
  angle: ProgressPhotoAngle;
  weightKg?: number;
  note?: string;
  thumbDataUrl: string; // Compact JPEG synced across devices via Firestore
  mediaId?: string; // Full-res local IndexedDB key
  isBaseline?: boolean;
  createdAt: string;
}

export interface FitnessProfile {
  goal: FitnessGoal;
  level: 'debutant' | 'intermediaire' | 'avance';
  daysPerWeek: number;
  equipment: string;
  heightCm?: number;
  notes?: string;
  progressPhotos?: ProgressPhoto[];
}

export interface MealEntry {
  id: string;
  date: string; // YYYY-MM-DD
  slot: MealSlot;
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface MealPreset {
  id: string;
  name: string;
  slot: MealSlot;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface WeightEntry {
  id: string;
  date: string; // YYYY-MM-DD
  weightKg: number;
  note?: string;
}

export interface NutritionGoals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  waterMl: number;
}

// ===== STUDIO MUSIQUE & LEXCORE =====

export interface AudioMarker {
  id: string;
  timeSec: number;
  label: string;
}

export interface MusicTrackTodo {
  id: string;
  label: string;
  done: boolean;
}

export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  feat?: string;
  mediaId?: string; // IndexedDB audio blob key
  coverMediaId?: string; // IndexedDB cover image blob key
  coverDataUrl?: string; // Optional compressed inline cover image
  coverGradient?: string; // Optional gradient id
  cloudAudioUrl?: string;
  cloudCoverUrl?: string;
  googleDriveFileId?: string; // Google Drive file ID for cross-device MP3 sync
  sourceFilename?: string; // Raw filename e.g. "Project_306_3.2.mp3" for version grouping
  driveYearFolder?: string; // Detected Google Drive year/season folder e.g. "2024/2025"
  manualGroupKey?: string; // User-assigned version group override (e.g. attach track as version of another song)
  manualGroupTitle?: string; // Optional custom display title for the manual group
  manualVersionLabel?: string; // Optional custom version label (e.g. "Mix final", "Acoustique")
  modifiedAt?: string; // Drive modifiedTime or last file edit ISO
  durationSec?: number;
  bpm?: number;
  musicalKey?: string;
  status: TrackStatus;
  tags: string[];
  markers: AudioMarker[];
  isFavorite?: boolean;
  ratingCurrent?: number; // 1..10 note actuelle du morceau
  ratingPotential?: number; // 1..10 note potentiel du morceau
  description?: string;
  todos?: MusicTrackTodo[];
  linkedLyricsId?: string;
  linkedProjectId?: string;
  addedAt: string;
  notes?: string;
}

export interface LyricsFolder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
}

export interface LyricsDoc {
  id: string;
  title: string;
  content: string;
  folderId: string | null;
  status: 1 | 2 | 3; // 1=Brouillon, 2=En cours, 3=Terminé (LexCore)
  mediaUrl: string; // YouTube beat URL (LexCore)
  linkedTrackId?: string; // Link to local/cloud MP3 in Kora
  linkedProjectId?: string;
  loop?: boolean;
  markers?: { start: number | null; end: number | null };
  deletedAt: string | null;
  lastModified: string;
}

export interface MusicProjectStep {
  id: string;
  label: string;
  done: boolean;
  dueDate?: string;
}

export interface MusicProject {
  id: string;
  title: string;
  kind: ProjectKind;
  coverMediaId?: string;
  coverDataUrl?: string;
  coverGradient?: string;
  targetReleaseDate?: string;
  status: 'en-cours' | 'mix' | 'pret' | 'sorti';
  steps: MusicProjectStep[];
  trackIds: string[];
  benchTrackIds?: string[]; // Sons mis de côté / en réflexion (non lus dans la mixtape principale)
  notes?: string;
}

// ===== BONUS: ÉNERGIE & FOCUS =====

export interface EnergyCheckin {
  date: string; // YYYY-MM-DD
  level: 1 | 2 | 3 | 4 | 5;
  sleepHours?: number;
  note?: string;
}

export interface FocusSession {
  id: string;
  date: string;
  durationMin: number;
  label: string;
  category: 'cours' | 'musique' | 'perso';
  linkedTrackId?: string;
  completedAt: string;
}

// ===== PREFERENCES & FIREBASE =====

export interface FirebaseUserConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export interface StoredPushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface NotificationSettings {
  enabled: boolean;
  eventsBeforeMin: number; // 0 = off, default 15
  homeworkAndExams: boolean;
  timers: boolean;
  hydrationAndMacros: boolean;
  dailyBriefing: boolean;
  morningHour: string; // HH:mm e.g. "07:45"
  pushSubscription?: StoredPushSubscription;
}

export interface ActiveWorkoutDraft {
  session: WorkoutSession;
  elapsedSec: number;
  paused: boolean;
  lastTickAt: number;
}

export interface ActiveFocusSession {
  id: string;
  label: string;
  category: 'cours' | 'musique' | 'perso';
  presetMin: number;
  startedAt: number; // epoch ms
  endsAt: number; // epoch ms — never pauses across app close or devices
  linkedTrackId?: string;
}

export interface LastSessionState {
  activeTab: ActiveTab;
  musicSubTab?: 'dashboard' | 'library' | 'lyrics';
  sportSubTab?: 'gym' | 'nutrition' | 'poids';
  studiesSubTab?: 'exams' | 'cursus' | 'docs' | 'pronote';
  openMusicProjectId?: string;
  selectedLyricsId?: string;
  audioTrackId?: string;
  audioTimeSec?: number;
  audioExpanded?: boolean;
  scrollY?: number;
  savedAt: number; // epoch ms
}

export interface UserPreferences {
  name: string;
  bio?: string;
  avatarColor?: string;
  avatarUrl?: string;
  theme: 'light' | 'dark';
  nutritionGoals: NutritionGoals;
  weightGoalKg: number;
  geminiApiKey?: string;
  pronoteBridgeUrl?: string;
  pronoteBridgeToken?: string;
  firebaseConfig?: FirebaseUserConfig;
  notifications?: NotificationSettings;
  activeWorkout?: ActiveWorkoutDraft;
  activeFocus?: ActiveFocusSession;
  lastSession?: LastSessionState;
}

export interface AppState {
  events: ScheduleEvent[];
  homework: HomeworkItem[];
  exams: ExamItem[];
  academicProfile: AcademicProfile;
  subjects: CourseSubject[];
  grades: GradeEntry[];
  courseDocs: CourseDocument[];
  tasks: TaskItem[];
  workouts: WorkoutSession[];
  workoutRoutines: WorkoutRoutine[];
  fitnessProfile: FitnessProfile;
  meals: MealEntry[];
  mealPresets: MealPreset[];
  weights: WeightEntry[];
  waterMlByDate: Record<string, number>;
  musicTracks: MusicTrack[];
  lyricsFolders: LyricsFolder[];
  lyricsDocs: LyricsDoc[];
  musicProjects: MusicProject[];
  energyCheckins: Record<string, EnergyCheckin>;
  focusSessions: FocusSession[];
  preferences: UserPreferences;
  updatedAt?: number;
}

export interface CalendarOccurrence {
  occurrenceKey: string;
  id: string;
  source: 'event' | 'exam' | 'workout';
  type: EventType;
  title: string;
  subject?: string;
  location?: string;
  date: string;
  startTime: string;
  endTime: string;
  recurringWeekly?: boolean;
  notes?: string;
  geminiNotebookUrl?: string;
  completed?: boolean;
  exam?: ExamItem;
  workout?: WorkoutSession;
  event?: ScheduleEvent;
}
