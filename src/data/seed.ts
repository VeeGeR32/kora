import type { AppState } from '../types';

/**
 * Clean Rowav Studio initial state.
 * Legacy Kora Life-OS top-level keys are kept as empty arrays/objects
 * solely to remain 100% compatible with Firestore schema rules.
 */
export function createEmptyState(): AppState {
  return {
    events: [],
    homework: [],
    exams: [],
    academicProfile: {
      program: '',
      level: '',
      school: '',
      careerGoal: '',
      targetSkills: [],
      studyPlanSummary: '',
    },
    subjects: [],
    grades: [],
    courseDocs: [],
    tasks: [],
    workouts: [],
    workoutRoutines: [],
    fitnessProfile: {
      goal: 'recomposition',
      level: 'intermediaire',
      daysPerWeek: 4,
      equipment: '',
    },
    meals: [],
    mealPresets: [],
    weights: [],
    waterMlByDate: {},
    musicTracks: [],
    lyricsFolders: [],
    lyricsDocs: [],
    musicProjects: [],
    energyCheckins: {},
    focusSessions: [],
    preferences: {
      name: '',
      theme: 'light',
      nutritionGoals: {
        calories: 2450,
        protein: 165,
        carbs: 270,
        fat: 75,
        waterMl: 2500,
      },
      weightGoalKg: 72.0,
      pronoteBridgeUrl: 'http://127.0.0.1:4789',
    },
    updatedAt: Date.now(),
  };
}

export function createSeedState(): AppState {
  return {
    ...createEmptyState(),
    updatedAt: 0,
  };
}
