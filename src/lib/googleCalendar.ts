import type { EventType, FirebaseUserConfig, ScheduleEvent } from '../types';
import { requestGoogleCalendarAccessToken } from './firebase';

export interface GoogleCalendarSummary {
  id: string;
  summary: string;
  primary?: boolean;
  backgroundColor?: string;
}

let cachedCalendarToken: { token: string; expiresAt: number } | null = null;

export function getCachedCalendarToken(): string | null {
  if (!cachedCalendarToken) return null;
  if (Date.now() >= cachedCalendarToken.expiresAt) {
    cachedCalendarToken = null;
    return null;
  }
  return cachedCalendarToken.token;
}

export function clearCachedCalendarToken(): void {
  cachedCalendarToken = null;
}

export async function ensureGoogleCalendarToken(
  config?: FirebaseUserConfig | null,
  forceRefresh = false
): Promise<string> {
  if (!forceRefresh) {
    const existing = getCachedCalendarToken();
    if (existing) return existing;
  }
  const token = await requestGoogleCalendarAccessToken(config);
  cachedCalendarToken = {
    token,
    expiresAt: Date.now() + 50 * 60 * 1000,
  };
  return token;
}

function handleCalendarApiError(status: number, errText: string): never {
  if (status === 401) {
    clearCachedCalendarToken();
    throw new Error('Session Google Agenda expirée — reconnecte Google Agenda.');
  }
  if (status === 403 && /Calendar API has not been used|accessNotConfigured/i.test(errText)) {
    throw new Error(
      'Active Google Calendar API gratuitement dans Google Cloud Console (projet kora-d6019 → Bibliothèque → Google Calendar API → Activer).'
    );
  }
  throw new Error(`Erreur Google Agenda (HTTP ${status}) : ${errText.slice(0, 160)}`);
}

export async function listGoogleCalendars(token: string): Promise<GoogleCalendarSummary[]> {
  const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    handleCalendarApiError(res.status, await res.text().catch(() => ''));
  }
  const data = (await res.json()) as {
    items?: { id: string; summary?: string; primary?: boolean; backgroundColor?: string }[];
  };
  return (data.items || []).map((c) => ({
    id: c.id,
    summary: c.primary ? `${c.summary || 'Principal'} (Principal)` : c.summary || c.id,
    primary: c.primary,
    backgroundColor: c.backgroundColor,
  }));
}

function inferEventType(title: string, calName = ''): EventType {
  const text = `${title} ${calName}`.toLowerCase();
  if (/\b(ds|partiel|exam|examen|contrôle|controle|interro|bac|oral)\b/.test(text)) return 'eval';
  if (/\b(gym|sport|muscu|push|pull|legs|upper|lower|cardio|run|foot|boxe|training|salle|workout)\b/.test(text)) {
    return 'sport';
  }
  if (/\b(studio|music|musique|mix|master|prod|beat|son|enregistrement|clip|rap|ep|album)\b/.test(text)) {
    return 'music';
  }
  if (/\b(cours|amphi|td|tp|cm|maths|physique|info|anglais|philo|histoire|univ|fac|lycée|classe|révision|revision)\b/.test(text)) {
    return 'cours';
  }
  return 'rdv';
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toLocalDateISO(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function toLocalHHMM(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

interface RawGCalEvent {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

export async function fetchGoogleCalendarEvents(
  token: string,
  calendars: GoogleCalendarSummary[],
  daysBack = 7,
  daysForward = 60
): Promise<Omit<ScheduleEvent, 'id'>[]> {
  const now = new Date();
  const timeMin = new Date(now.getTime() - daysBack * 86400_000).toISOString();
  const timeMax = new Date(now.getTime() + daysForward * 86400_000).toISOString();

  const results: Omit<ScheduleEvent, 'id'>[] = [];

  for (const cal of calendars) {
    const params = new URLSearchParams({
      singleEvents: 'true',
      orderBy: 'startTime',
      timeMin,
      timeMax,
      maxResults: '250',
    });

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${params.toString()}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      handleCalendarApiError(res.status, await res.text().catch(() => ''));
    }

    const data = (await res.json()) as { items?: RawGCalEvent[] };
    for (const item of data.items || []) {
      if (item.status === 'cancelled') continue;
      const title = (item.summary || 'Événement Google').trim();
      let date = '';
      let startTime = '09:00';
      let endTime = '10:00';
      let allDayNote = '';

      if (item.start?.dateTime) {
        const startDt = new Date(item.start.dateTime);
        const endDt = item.end?.dateTime
          ? new Date(item.end.dateTime)
          : new Date(startDt.getTime() + 60 * 60_000);
        date = toLocalDateISO(startDt);
        startTime = toLocalHHMM(startDt);
        const sameDay = toLocalDateISO(endDt) === date;
        endTime = sameDay ? toLocalHHMM(endDt) : '23:30';
        if (endTime <= startTime) {
          const fallbackEnd = new Date(startDt.getTime() + 45 * 60_000);
          endTime = toLocalHHMM(fallbackEnd);
        }
      } else if (item.start?.date) {
        date = item.start.date;
        allDayNote = 'Journée entière · Google Agenda';
      } else {
        continue;
      }

      const rawDesc = item.description ? item.description.replace(/<[^>]+>/g, '').trim().slice(0, 280) : '';
      const notes = [allDayNote, rawDesc].filter(Boolean).join('\n');

      results.push({
        type: inferEventType(title, cal.summary),
        title,
        location: item.location?.trim() || undefined,
        date,
        startTime,
        endTime,
        recurringWeekly: false,
        notes: notes || undefined,
        googleCalendarEventId: `${cal.id}::${item.id}`,
      });
    }
  }

  return results;
}
