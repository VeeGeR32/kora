import type { AppState, NotificationSettings } from '../types';
import { addDays, getOccurrencesForDate, timeToMinutes, todayISO } from '../utils/dates';

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: false,
  eventsBeforeMin: 15,
  homeworkAndExams: true,
  timers: true,
  hydrationAndMacros: true,
  dailyBriefing: true,
  morningHour: '07:45',
};

const FIRED_LOG_KEY = 'kora_notif_fired_v1';

export interface NotificationEnv {
  supported: boolean;
  permission: NotificationPermission | 'unsupported';
  isIOS: boolean;
  isStandalonePWA: boolean;
  needsHomeScreenInstall: boolean;
}

export function getNotificationEnvironment(): NotificationEnv {
  if (typeof window === 'undefined') {
    return {
      supported: false,
      permission: 'unsupported',
      isIOS: false,
      isStandalonePWA: false,
      needsHomeScreenInstall: false,
    };
  }
  const ua = window.navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document);
  const nav = window.navigator as Navigator & { standalone?: boolean };
  const isStandalonePWA =
    nav.standalone === true ||
    window.matchMedia?.('(display-mode: standalone)')?.matches === true;

  const supported = 'Notification' in window && 'serviceWorker' in navigator;
  const permission: NotificationPermission | 'unsupported' = supported
    ? Notification.permission
    : 'unsupported';

  return {
    supported,
    permission,
    isIOS,
    isStandalonePWA,
    needsHomeScreenInstall: isIOS && !isStandalonePWA,
  };
}

let swRegPromise: Promise<ServiceWorkerRegistration | null> | null = null;

export function registerKoraServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return Promise.resolve(null);
  }
  if (!swRegPromise) {
    swRegPromise = navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => reg)
      .catch(() => null);
  }
  return swRegPromise;
}

export async function requestKoraNotificationPermission(): Promise<{
  ok: boolean;
  message: string;
}> {
  const env = getNotificationEnvironment();
  if (env.needsHomeScreenInstall) {
    return {
      ok: false,
      message:
        'Sur iPhone, ajoute d’abord Kora à l’écran d’accueil (Partager → Sur l’écran d’accueil), puis ouvre l’app depuis ton écran d’accueil pour activer les notifications.',
    };
  }
  if (!env.supported) {
    return {
      ok: false,
      message: 'Notifications non supportées par ce navigateur.',
    };
  }

  await registerKoraServiceWorker();
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    return {
      ok: false,
      message:
        perm === 'denied'
          ? 'Notifications bloquées. Autorise-les dans Réglages iPhone → Notifications → Kora (ou paramètres du navigateur).'
          : 'Autorisation non accordée.',
    };
  }
  return { ok: true, message: 'Notifications activées ✓' };
}

export async function sendKoraNotification(payload: {
  title: string;
  body: string;
  tag?: string;
  url?: string;
}): Promise<boolean> {
  const env = getNotificationEnvironment();
  if (!env.supported || env.permission !== 'granted') return false;

  try {
    const reg = (await registerKoraServiceWorker()) || (await navigator.serviceWorker.ready);
    if (reg && 'showNotification' in reg) {
      await reg.showNotification(payload.title, {
        body: payload.body,
        icon: '/kora-icon.svg',
        badge: '/kora-icon.svg',
        tag: payload.tag || 'kora-notif',
        data: { url: payload.url || '/' },
      });
      return true;
    }
  } catch {
    // Fallback below
  }

  try {
    new Notification(payload.title, {
      body: payload.body,
      icon: '/kora-icon.svg',
      tag: payload.tag || 'kora-notif',
    });
    return true;
  } catch {
    return false;
  }
}

function getFiredSet(today: string): Set<string> {
  try {
    const raw = localStorage.getItem(FIRED_LOG_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as { date?: string; keys?: string[] };
    if (parsed.date !== today) return new Set();
    return new Set(Array.isArray(parsed.keys) ? parsed.keys : []);
  } catch {
    return new Set();
  }
}

function saveFiredSet(today: string, set: Set<string>): void {
  try {
    localStorage.setItem(FIRED_LOG_KEY, JSON.stringify({ date: today, keys: Array.from(set) }));
  } catch {
    // ignore
  }
}

/**
 * Evaluates smart, useful real-world notifications for Kora:
 * 1) Upcoming event reminder (X min before start)
 * 2) Morning briefing at configured hour
 * 3) Urgent homework & upcoming exams
 * 4) Afternoon hydration & protein nudge
 * 5) Evening recap if tasks/homework remain
 */
export async function evaluateScheduledNotifications(state: AppState): Promise<void> {
  const cfg = state.preferences.notifications;
  if (!cfg?.enabled) return;
  const env = getNotificationEnvironment();
  if (!env.supported || env.permission !== 'granted') return;

  const today = todayISO();
  const tomorrow = addDays(today, 1);
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const fired = getFiredSet(today);
  let dirty = false;

  const fireOnce = async (key: string, title: string, body: string) => {
    if (fired.has(key)) return;
    fired.add(key);
    dirty = true;
    await sendKoraNotification({ title, body, tag: key });
  };

  // 1. Upcoming Schedule Events (e.g. 15 min before)
  if (cfg.eventsBeforeMin > 0) {
    const occs = getOccurrencesForDate(state, today);
    for (const occ of occs) {
      if (occ.completed) continue;
      const startMin = timeToMinutes(occ.startTime);
      const diff = startMin - nowMin;
      if (diff > 0 && diff <= cfg.eventsBeforeMin) {
        const where = occ.location ? ` · ${occ.location}` : '';
        await fireOnce(
          `ev-${occ.occurrenceKey}`,
          `Dans ${diff} min : ${occ.title}`,
          `${occ.startTime}–${occ.endTime}${where}`
        );
      }
    }
  }

  // 2. Morning Briefing (within 15 min window of configured morningHour)
  if (cfg.dailyBriefing) {
    const targetMin = timeToMinutes(cfg.morningHour || '07:45');
    if (nowMin >= targetMin && nowMin <= targetMin + 15) {
      const todayOccs = getOccurrencesForDate(state, today);
      const hwToday = state.homework.filter((h) => !h.done && h.dueDate <= today).length;
      const firstEv = todayOccs[0];
      const summary = firstEv
        ? `${todayOccs.length} créneau${todayOccs.length > 1 ? 'x' : ''} (1er à ${firstEv.startTime} : ${firstEv.title})${hwToday ? ` · ${hwToday} devoir${hwToday > 1 ? 's' : ''}` : ''}`
        : hwToday
        ? `Journée libre · ${hwToday} devoir${hwToday > 1 ? 's' : ''} à boucler`
        : 'Journée calme — aucun créneau planifié pour le moment.';
      await fireOnce('morning-briefing', 'Briefing Kora du jour', summary);
    }
  }

  // 3. Urgent Homework & Exams (18:00 check for tomorrow's deadlines & upcoming DS)
  if (cfg.homeworkAndExams && nowMin >= 18 * 60 && nowMin <= 18 * 60 + 20) {
    const dueSoon = state.homework.filter((h) => !h.done && h.dueDate <= tomorrow);
    const examSoon = state.exams.filter(
      (e) => !e.done && (e.date === today || e.date === tomorrow || e.date === addDays(today, 2))
    );
    if (examSoon.length > 0) {
      const ex = examSoon[0];
      const leftTopics = ex.topics.filter((t) => !t.done).length;
      await fireOnce(
        `exam-soon-${ex.id}`,
        `Éval proche : ${ex.title} (${ex.subject})`,
        `Prévue le ${ex.date}${leftTopics > 0 ? ` · ${leftTopics} chapitre${leftTopics > 1 ? 's' : ''} à revoir` : ''}.`
      );
    } else if (dueSoon.length > 0) {
      await fireOnce(
        'hw-due-soon',
        `${dueSoon.length} devoir${dueSoon.length > 1 ? 's' : ''} à rendre bientôt`,
        dueSoon
          .slice(0, 2)
          .map((h) => `${h.subject} : ${h.title}`)
          .join(' · ')
      );
    }
  }

  // 4. Hydration & Protein Nudge (16:30 if behind target)
  if (cfg.hydrationAndMacros && nowMin >= 16 * 60 + 30 && nowMin <= 16 * 60 + 50) {
    const water = state.waterMlByDate[today] || 0;
    const waterGoal = state.preferences.nutritionGoals.waterMl || 2500;
    const protein = state.meals
      .filter((m) => m.date === today)
      .reduce((acc, m) => acc + (m.protein || 0), 0);
    const proteinGoal = state.preferences.nutritionGoals.protein || 150;

    if (water < waterGoal * 0.55) {
      await fireOnce(
        'hydration-nudge',
        'Rappel hydratation',
        `Tu es à ${(water / 1000).toFixed(1)} L sur ${(waterGoal / 1000).toFixed(1)} L aujourd’hui — pense à boire un grand verre d’eau.`
      );
    } else if (protein > 0 && protein < proteinGoal * 0.55) {
      await fireOnce(
        'protein-nudge',
        'Objectif protéines',
        `${Math.round(protein)}g / ${proteinGoal}g aujourd’hui — pense à une collation protéinée.`
      );
    }
  }

  // 5. Evening Recap (21:00 if unfinished tasks/homework remain)
  if (cfg.dailyBriefing && nowMin >= 21 * 60 && nowMin <= 21 * 60 + 15) {
    const remainingTasks = state.tasks.filter((t) => !t.done && (!t.dueDate || t.dueDate <= today)).length;
    const remainingHw = state.homework.filter((h) => !h.done && h.dueDate <= today).length;
    if (remainingTasks + remainingHw > 0) {
      await fireOnce(
        'evening-recap',
        'Bilan du soir · Kora',
        `Il te reste ${remainingTasks} tâche${remainingTasks > 1 ? 's' : ''} et ${remainingHw} devoir${remainingHw > 1 ? 's' : ''} pour aujourd’hui.`
      );
    }
  }

  if (dirty) saveFiredSet(today, fired);
}
