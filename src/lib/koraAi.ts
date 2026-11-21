import { GoogleGenAI, Type, type FunctionDeclaration } from '@google/genai';
import type { AIDomain, AppState, EventType, MealSlot, Priority, WorkoutFocus } from '../types';
import { addDays, getOccurrencesForDate, todayISO } from '../utils/dates';

export type KoraAIAction =
  | {
      kind: 'add_schedule_event';
      summary: string;
      payload: {
        type: EventType;
        title: string;
        subject?: string;
        location?: string;
        date: string;
        startTime: string;
        endTime: string;
        notes?: string;
      };
    }
  | {
      kind: 'add_homework';
      summary: string;
      payload: {
        title: string;
        subject: string;
        dueDate: string;
        priority: Priority;
      };
    }
  | {
      kind: 'add_exam_topics';
      summary: string;
      payload: {
        examTitle: string;
        topics: string[];
      };
    }
  | {
      kind: 'create_workout_routine';
      summary: string;
      payload: {
        title: string;
        focus: WorkoutFocus;
        exercises: {
          name: string;
          muscleGroup: string;
          defaultSets: number;
          targetReps: string;
          restSeconds: number;
        }[];
      };
    }
  | {
      kind: 'log_meal';
      summary: string;
      payload: {
        date: string;
        slot: MealSlot;
        name: string;
        calories: number;
        protein: number;
        carbs: number;
        fat: number;
      };
    }
  | {
      kind: 'update_nutrition_goals';
      summary: string;
      payload: {
        calories: number;
        protein: number;
        carbs: number;
        fat: number;
      };
    }
  | {
      kind: 'add_task';
      summary: string;
      payload: {
        title: string;
        dueDate?: string;
        category: 'perso' | 'rdv' | 'cours' | 'sport' | 'musique';
        priority: Priority;
      };
    };

export interface KoraAIResponse {
  text: string;
  actions: KoraAIAction[];
}

const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'add_schedule_event',
    description:
      'Planifie un créneau (cours, révision, sport, music, rdv) dans le Planning Kora.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        type: { type: Type.STRING, description: 'cours | eval | sport | rdv | music' },
        title: { type: Type.STRING },
        subject: { type: Type.STRING },
        location: { type: Type.STRING },
        date: { type: Type.STRING, description: 'YYYY-MM-DD' },
        startTime: { type: Type.STRING, description: 'HH:mm' },
        endTime: { type: Type.STRING, description: 'HH:mm' },
        notes: { type: Type.STRING },
      },
      required: ['type', 'title', 'date', 'startTime', 'endTime'],
    },
  },
  {
    name: 'add_homework',
    description: 'Ajoute un devoir dans la section Cours.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        subject: { type: Type.STRING },
        dueDate: { type: Type.STRING, description: 'YYYY-MM-DD' },
        priority: { type: Type.STRING, description: 'low | medium | high' },
      },
      required: ['title', 'subject', 'dueDate'],
    },
  },
  {
    name: 'add_exam_topics',
    description: 'Ajoute des chapitres / étapes de révision à une évaluation existante.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        examTitle: { type: Type.STRING },
        topics: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ['examTitle', 'topics'],
    },
  },
  {
    name: 'create_workout_routine',
    description:
      'Crée une routine de musculation / gym complète (façon Hevy) avec exercices, séries, reps et repos.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        focus: {
          type: Type.STRING,
          description: 'Push | Pull | Legs | Upper | Lower | Full Body | Cardio | Autre',
        },
        exercises: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              muscleGroup: { type: Type.STRING },
              defaultSets: { type: Type.NUMBER },
              targetReps: { type: Type.STRING },
              restSeconds: { type: Type.NUMBER },
            },
            required: ['name', 'defaultSets', 'targetReps'],
          },
        },
      },
      required: ['title', 'focus', 'exercises'],
    },
  },
  {
    name: 'log_meal',
    description: 'Enregistre un repas avec estimation précise des calories et macros.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        date: { type: Type.STRING, description: 'YYYY-MM-DD' },
        slot: { type: Type.STRING, description: 'petit-dej | dejeuner | collation | diner' },
        name: { type: Type.STRING },
        calories: { type: Type.NUMBER },
        protein: { type: Type.NUMBER },
        carbs: { type: Type.NUMBER },
        fat: { type: Type.NUMBER },
      },
      required: ['date', 'slot', 'name', 'calories', 'protein', 'carbs', 'fat'],
    },
  },
  {
    name: 'update_nutrition_goals',
    description: 'Ajuste les objectifs nutritionnels journaliers.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        calories: { type: Type.NUMBER },
        protein: { type: Type.NUMBER },
        carbs: { type: Type.NUMBER },
        fat: { type: Type.NUMBER },
      },
      required: ['calories', 'protein', 'carbs', 'fat'],
    },
  },
  {
    name: 'add_task',
    description: 'Ajoute une tâche dans Aujourd’hui.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        dueDate: { type: Type.STRING, description: 'YYYY-MM-DD' },
        category: { type: Type.STRING, description: 'perso | rdv | cours | sport | musique' },
        priority: { type: Type.STRING, description: 'low | medium | high' },
      },
      required: ['title', 'category'],
    },
  },
];

const DOMAIN_ROLE_HINTS: Record<AIDomain, string> = {
  general: 'Tu as une vision globale transversale (Planning, Cours, Sport, Music, Tâches).',
  cours:
    'Tu es focalisé sur le domaine COURS : révisions, emploi du temps scolaire, devoirs, notes, cursus et objectifs de carrière.',
  sport:
    'Tu es focalisé sur le domaine SPORT : programmes musculation façon Hevy, surcharge progressive, nutrition, macros et suivi du poids.',
  music:
    'Tu es focalisé sur le domaine MUSIC : création musicale, écriture de textes LexCore, structure de morceaux, planning d’EP/Single.',
};

function buildContextSummary(state: AppState): string {
  const today = todayISO();
  const nextDays = Array.from({ length: 5 }, (_, i) => {
    const d = addDays(today, i);
    const occs = getOccurrencesForDate(state, d).map(
      (o) => `${o.startTime}-${o.endTime} ${o.title} (${o.type})`
    );
    return `${d}: ${occs.length ? occs.join(', ') : 'Libre'}`;
  }).join('\n');

  const latestWeight = [...state.weights].sort((a, b) => a.date.localeCompare(b.date)).pop();

  return [
    `Date d'aujourd'hui: ${today}.`,
    `Cursus: ${state.academicProfile.program} (${state.academicProfile.level}) · Carrière: ${state.academicProfile.careerGoal}.`,
    `Évals à venir: ${state.exams.filter((e) => !e.done).map((e) => `${e.title} (${e.subject}) le ${e.date}`).join(' ; ') || 'aucune'}.`,
    `Devoirs à faire: ${state.homework.filter((h) => !h.done).map((h) => `${h.title} (${h.subject}, pour ${h.dueDate})`).join(' ; ') || 'aucun'}.`,
    `Profil Sport: objectif=${state.fitnessProfile.goal}, ${state.fitnessProfile.daysPerWeek}j/sem, matériel=${state.fitnessProfile.equipment}, poids=${latestWeight ? `${latestWeight.weightKg}kg` : '?'}, cible=${state.preferences.weightGoalKg}kg.`,
    `Objectifs Nutrition: ${state.preferences.nutritionGoals.calories} kcal, ${state.preferences.nutritionGoals.protein}g prot.`,
    `Projets Music: ${state.musicProjects.map((p) => `${p.title} (${p.steps.filter((s) => s.done).length}/${p.steps.length} étapes)`).join(' ; ') || 'aucun'}.`,
    `Planning 5 prochains jours:\n${nextDays}`,
  ].join('\n');
}

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
const FALLBACK_MODELS = ['gemini-3.8-flash', 'gemini-3.0-flash', 'gemini-2.5-flash'];

/** Cleans accidental whitespace/quotes while supporting BOTH legacy AIza... and new AQ.... keys */
export function sanitizeGeminiApiKey(raw: string): string {
  return raw.trim().replace(/^["']|["']$/g, '').replace(/\s+/g, '');
}

async function generateWithAutoRouting(
  apiKey: string,
  params: Omit<Parameters<GoogleGenAI['models']['generateContent']>[0], 'model'>
) {
  const cleanKey = sanitizeGeminiApiKey(apiKey);
  const attempts: { vertexai: boolean; model: string }[] = [];

  if (cleanKey.startsWith('AQ.')) {
    // New AQ. keys can belong to Vertex Express Mode OR Gemini Developer API
    for (const model of FALLBACK_MODELS) {
      attempts.push({ vertexai: false, model });
      attempts.push({ vertexai: true, model });
    }
  } else {
    for (const model of FALLBACK_MODELS) {
      attempts.push({ vertexai: false, model });
    }
  }

  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      const ai = attempt.vertexai
        ? new GoogleGenAI({ vertexai: true, apiKey: cleanKey })
        : new GoogleGenAI({ apiKey: cleanKey });
      const res = await ai.models.generateContent({
        model: attempt.model,
        ...params,
      });
      return { res, model: attempt.model, vertexai: attempt.vertexai };
    } catch (err) {
      lastError = err;
      const msg = String((err as Error)?.message || err);
      const isRetryable =
        msg.includes('API_KEY_INVALID') ||
        msg.includes('NOT_FOUND') ||
        msg.includes('404') ||
        msg.includes('UNAUTHENTICATED') ||
        msg.includes('not available');
      if (!isRetryable) throw err;
    }
  }
  throw lastError || new Error('Impossible de joindre Gemini');
}

export async function testGeminiApiKey(apiKey: string): Promise<{ ok: boolean; message: string }> {
  const clean = sanitizeGeminiApiKey(apiKey);
  if (!clean) return { ok: false, message: 'Clé API vide' };
  try {
    const { res, model, vertexai } = await generateWithAutoRouting(clean, {
      contents: 'Réponds simplement OK.',
    });
    if (res.text) {
      return {
        ok: true,
        message: `Clé Gemini valide ✓ (${model}${vertexai ? ' · Express' : ''})`,
      };
    }
    return { ok: false, message: 'Réponse vide de Gemini' };
  } catch (err) {
    const rawMsg = (err as Error).message || 'Erreur Gemini';
    if (rawMsg.includes('API_KEY_INVALID') || rawMsg.includes('API key not valid')) {
      return {
        ok: false,
        message:
          'Clé rejetée par Google (API_KEY_INVALID). Vérifie que la clé copiée est bien active dans Google AI Studio.',
      };
    }
    return { ok: false, message: rawMsg };
  }
}

export async function runKoraAssistant(
  prompt: string,
  state: AppState,
  options: {
    apiKey?: string;
    domain: AIDomain;
    history?: { role: 'user' | 'assistant'; text: string }[];
  }
): Promise<KoraAIResponse> {
  const resolvedRaw =
    options.apiKey?.trim() || (import.meta.env.VITE_GEMINI_API_KEY as string | undefined) || '';
  const resolvedKey = resolvedRaw ? sanitizeGeminiApiKey(resolvedRaw) : '';

  if (!resolvedKey) {
    return buildLocalSmartFallback(prompt, state, options.domain);
  }

  const systemInstruction = `Tu es Kora AI, l'assistant personnel intégré dans Kora.
${DOMAIN_ROLE_HINTS[options.domain]}
Réponds en français, en Markdown propre et concis (listes, gras, titres courts).
Dès que l'utilisateur demande une modification concrète (planifier, créer un programme gym, réviser un DS, logger un repas, organiser des devoirs/tâches), APPELLE les outils (function calls) en évitant les chevauchements avec son Planning.

CONTEXTE UTILISATEUR :
${buildContextSummary(state)}`;

  const contents = [
    ...(options.history || []).slice(-8).map((m) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.text }],
    })),
    { role: 'user', parts: [{ text: prompt }] },
  ];

  const { res: response } = await generateWithAutoRouting(resolvedKey, {
    contents,
    config: {
      systemInstruction,
      tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
      temperature: 0.4,
    },
  });

  const actions: KoraAIAction[] = [];
  const calls = response.functionCalls || [];

  for (const call of calls) {
    const args = (call.args || {}) as Record<string, unknown>;
    if (call.name === 'add_schedule_event') {
      const rawType = String(args.type || 'cours');
      const normalizedType: EventType =
        rawType === 'studio'
          ? 'music'
          : (['cours', 'eval', 'sport', 'rdv', 'music'].includes(rawType)
              ? rawType
              : 'cours') as EventType;
      actions.push({
        kind: 'add_schedule_event',
        summary: `Planning · ${args.date} ${args.startTime}–${args.endTime} : ${args.title}`,
        payload: {
          type: normalizedType,
          title: String(args.title || 'Créneau'),
          subject: args.subject ? String(args.subject) : undefined,
          location: args.location ? String(args.location) : undefined,
          date: String(args.date || todayISO()),
          startTime: String(args.startTime || '18:00'),
          endTime: String(args.endTime || '19:00'),
          notes: args.notes ? String(args.notes) : undefined,
        },
      });
    } else if (call.name === 'add_homework') {
      actions.push({
        kind: 'add_homework',
        summary: `Devoir (${args.subject}) · ${args.title} pour le ${args.dueDate}`,
        payload: {
          title: String(args.title || 'Devoir'),
          subject: String(args.subject || 'Général'),
          dueDate: String(args.dueDate || todayISO()),
          priority: (['low', 'medium', 'high'].includes(String(args.priority))
            ? args.priority
            : 'medium') as Priority,
        },
      });
    } else if (call.name === 'add_exam_topics' && Array.isArray(args.topics)) {
      actions.push({
        kind: 'add_exam_topics',
        summary: `Révisions · +${args.topics.length} chapitres sur ${args.examTitle}`,
        payload: {
          examTitle: String(args.examTitle || ''),
          topics: args.topics.map(String),
        },
      });
    } else if (call.name === 'create_workout_routine' && Array.isArray(args.exercises)) {
      actions.push({
        kind: 'create_workout_routine',
        summary: `Routine Gym · ${args.title} (${args.exercises.length} exos)`,
        payload: {
          title: String(args.title || 'Routine IA'),
          focus: (args.focus as WorkoutFocus) || 'Full Body',
          exercises: (args.exercises as Record<string, unknown>[]).map((e) => ({
            name: String(e.name || 'Exercice'),
            muscleGroup: String(e.muscleGroup || 'Autre'),
            defaultSets: Number(e.defaultSets) || 3,
            targetReps: String(e.targetReps || '8-10'),
            restSeconds: Number(e.restSeconds) || 90,
          })),
        },
      });
    } else if (call.name === 'log_meal') {
      actions.push({
        kind: 'log_meal',
        summary: `Nutrition · ${args.name} (${args.calories} kcal, ${args.protein}g P)`,
        payload: {
          date: String(args.date || todayISO()),
          slot: (['petit-dej', 'dejeuner', 'collation', 'diner'].includes(String(args.slot))
            ? args.slot
            : 'dejeuner') as MealSlot,
          name: String(args.name || 'Repas'),
          calories: Number(args.calories) || 0,
          protein: Number(args.protein) || 0,
          carbs: Number(args.carbs) || 0,
          fat: Number(args.fat) || 0,
        },
      });
    } else if (call.name === 'update_nutrition_goals') {
      actions.push({
        kind: 'update_nutrition_goals',
        summary: `Objectifs · ${args.calories} kcal · P ${args.protein}g / G ${args.carbs}g / L ${args.fat}g`,
        payload: {
          calories: Number(args.calories) || 2400,
          protein: Number(args.protein) || 160,
          carbs: Number(args.carbs) || 260,
          fat: Number(args.fat) || 70,
        },
      });
    } else if (call.name === 'add_task') {
      actions.push({
        kind: 'add_task',
        summary: `Tâche (${args.category}) · ${args.title}`,
        payload: {
          title: String(args.title || 'Tâche'),
          dueDate: args.dueDate ? String(args.dueDate) : todayISO(),
          category: (args.category as 'perso' | 'rdv' | 'cours' | 'sport' | 'musique') || 'perso',
          priority: (args.priority as Priority) || 'medium',
        },
      });
    }
  }

  return {
    text:
      response.text?.trim() ||
      (actions.length > 0
        ? `J'ai préparé **${actions.length} modification${actions.length > 1 ? 's' : ''}** — elles apparaissent déjà en **aperçu** sur ton app !`
        : 'Je suis prêt — dis-moi ce que tu veux organiser !'),
    actions,
  };
}

function buildLocalSmartFallback(
  prompt: string,
  state: AppState,
  domain: AIDomain
): KoraAIResponse {
  const lower = prompt.toLowerCase();
  const today = todayISO();

  if (domain === 'sport' || lower.includes('programme') || lower.includes('musculation') || lower.includes('gym')) {
    return {
      text: `### Proposition de programme **Upper Hypertrophie**\n\n- Adapté à ton profil (**${state.fitnessProfile.goal}**, ${state.fitnessProfile.daysPerWeek}j/sem)\n- Les modifications s'affichent en **aperçu en direct** dans *Sport* et *Planning*.\n\n*Ajoute ta clé API Gemini dans **Paramètres → APIs** pour des réponses IA complètes.*`,
      actions: [
        {
          kind: 'create_workout_routine',
          summary: 'Routine Gym · Upper Hypertrophie IA (4 exos)',
          payload: {
            title: 'Upper Hypertrophie IA',
            focus: 'Upper',
            exercises: [
              { name: 'Développé incliné haltères', muscleGroup: 'Pectoraux', defaultSets: 4, targetReps: '8-10', restSeconds: 90 },
              { name: 'Tractions lestées', muscleGroup: 'Dos', defaultSets: 4, targetReps: '6-8', restSeconds: 120 },
              { name: 'Élévations latérales poulie', muscleGroup: 'Épaules', defaultSets: 4, targetReps: '12-15', restSeconds: 60 },
              { name: 'Curl barre EZ', muscleGroup: 'Biceps', defaultSets: 3, targetReps: '10-12', restSeconds: 75 },
            ],
          },
        },
        {
          kind: 'add_schedule_event',
          summary: `Planning · ${addDays(today, 1)} 18:00–19:05 : Upper Hypertrophie IA`,
          payload: {
            type: 'sport',
            title: 'Upper Hypertrophie IA',
            location: 'Salle de sport',
            date: addDays(today, 1),
            startTime: '18:00',
            endTime: '19:05',
          },
        },
      ],
    };
  }

  if (domain === 'music' || lower.includes('music') || lower.includes('son') || lower.includes('texte') || lower.includes('ep')) {
    return {
      text: `### Session **Music** proposée\n\n- Créneau dédié d'écriture & test instru ajouté en **aperçu** sur ton Planning.\n- Tâche d'avancement ajoutée dans **Aujourd'hui**.\n\n*Ajoute ta clé API Gemini dans **Paramètres → APIs** pour un vrai coaching créatif.*`,
      actions: [
        {
          kind: 'add_schedule_event',
          summary: `Planning · ${today} 21:00–22:00 : Session écriture Music`,
          payload: {
            type: 'music',
            title: 'Session écriture Music',
            subject: 'Music',
            location: 'Home Studio',
            date: today,
            startTime: '21:00',
            endTime: '22:00',
          },
        },
        {
          kind: 'add_task',
          summary: 'Tâche (musique) · Enregistrer maquette voix',
          payload: {
            title: 'Enregistrer maquette voix sur la boucle A-B',
            dueDate: addDays(today, 1),
            category: 'musique',
            priority: 'medium',
          },
        },
      ],
    };
  }

  if (domain === 'cours' || lower.includes('révision') || lower.includes('ds') || lower.includes('devoir') || lower.includes('eval') || lower.includes('semaine') || lower.includes('journée')) {
    const nextExam = state.exams.find((e) => !e.done);
    const targetTitle = nextExam ? `Révision · ${nextExam.title}` : 'Session Révisions & Devoirs';
    return {
      text: `### Plan de révision proposé\n\n- **2 créneaux** placés en **aperçu en direct** dans *Aujourd'hui* et *Planning* (${nextExam ? `focus **${nextExam.title}**` : 'cette semaine'}).\n- Vérifie l'aperçu directement sur ton emploi du temps avant d'appliquer !\n\n*Configure ta clé API Gemini dans **Paramètres → APIs** pour des plans 100% personnalisés.*`,
      actions: [
        {
          kind: 'add_schedule_event',
          summary: `Planning · ${today} 19:00–20:00 : ${targetTitle}`,
          payload: {
            type: 'cours',
            title: targetTitle,
            subject: nextExam?.subject || 'Cours',
            date: today,
            startTime: '19:00',
            endTime: '20:00',
            notes: 'Revoir le Notebook Gemini + exercices clés.',
          },
        },
        {
          kind: 'add_schedule_event',
          summary: `Planning · ${addDays(today, 1)} 17:00–18:00 : ${targetTitle} (Annales)`,
          payload: {
            type: 'cours',
            title: `${targetTitle} (Annales)`,
            subject: nextExam?.subject || 'Cours',
            date: addDays(today, 1),
            startTime: '17:00',
            endTime: '18:00',
          },
        },
      ],
    };
  }

  return {
    text: `**Mode local actif** — ajoute ta clé API Gemini (gratuite sur [Google AI Studio](https://aistudio.google.com/apikey)) dans **Paramètres → APIs & Services** pour discuter librement et laisser Kora AI piloter ton app.\n\nEn attendant, essaie un raccourci ci-dessous ou change de domaine (**Cours**, **Sport**, **Music**).`,
    actions: [],
  };
}
