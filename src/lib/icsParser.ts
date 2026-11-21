import type { ScheduleEvent } from '../types';
import { uid } from '../utils/dates';

/**
 * Lightweight client-side iCalendar (.ics) parser for Pronote / Google Calendar exports.
 */
export function parseICSFile(content: string): Omit<ScheduleEvent, 'id'>[] {
  const unfolded = content.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const blocks = unfolded.split('BEGIN:VEVENT').slice(1);
  const events: Omit<ScheduleEvent, 'id'>[] = [];

  const parseICSDate = (raw: string): { date: string; time: string } | null => {
    const clean = raw.trim().replace(/^.*:/, '');
    const m = clean.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
    if (!m) return null;
    const [, y, mo, d, hh = '09', mm = '00'] = m;
    // Handle UTC 'Z' conversion to local time
    if (clean.endsWith('Z')) {
      const utc = new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mm));
      const ly = utc.getFullYear();
      const lmo = String(utc.getMonth() + 1).padStart(2, '0');
      const ld = String(utc.getDate()).padStart(2, '0');
      const lhh = String(utc.getHours()).padStart(2, '0');
      const lmm = String(utc.getMinutes()).padStart(2, '0');
      return { date: `${ly}-${lmo}-${ld}`, time: `${lhh}:${lmm}` };
    }
    return { date: `${y}-${mo}-${d}`, time: `${hh}:${mm}` };
  };

  for (const block of blocks) {
    const endIdx = block.indexOf('END:VEVENT');
    const body = endIdx >= 0 ? block.slice(0, endIdx) : block;
    const lines = body.split(/\r?\n/);

    let summary = '';
    let location = '';
    let description = '';
    let dtStartRaw = '';
    let dtEndRaw = '';

    for (const line of lines) {
      if (line.startsWith('SUMMARY')) summary = line.replace(/^SUMMARY[^:]*:/, '').replace(/\\,/g, ',').replace(/\\n/g, ' ').trim();
      else if (line.startsWith('LOCATION')) location = line.replace(/^LOCATION[^:]*:/, '').replace(/\\,/g, ',').trim();
      else if (line.startsWith('DESCRIPTION')) description = line.replace(/^DESCRIPTION[^:]*:/, '').replace(/\\n/g, ' ').trim();
      else if (line.startsWith('DTSTART')) dtStartRaw = line;
      else if (line.startsWith('DTEND')) dtEndRaw = line;
    }

    const start = parseICSDate(dtStartRaw);
    const end = parseICSDate(dtEndRaw);
    if (!summary || !start) continue;

    const subject = summary.split('-')[0].split('/')[0].trim();
    const lower = summary.toLowerCase();
    const isEval = lower.includes('ds') || lower.includes('contrôle') || lower.includes('exam') || lower.includes('partiel');

    events.push({
      type: isEval ? 'eval' : 'cours',
      title: summary,
      subject,
      location: location || undefined,
      date: start.date,
      startTime: start.time,
      endTime: end?.time || start.time,
      recurringWeekly: false,
      notes: description ? description.slice(0, 220) : undefined,
    });
  }

  // Deduplicate by date+startTime+title
  const seen = new Set<string>();
  return events.filter((ev) => {
    const k = `${ev.date}|${ev.startTime}|${ev.title}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function extractPronoteSummaryFromEvents(events: Omit<ScheduleEvent, 'id'>[]) {
  const subjects = Array.from(new Set(events.map((e) => e.subject).filter(Boolean) as string[]));
  return {
    count: events.length,
    subjects: subjects.map((name) => ({ id: uid('sub'), name, coefficient: 1 })),
  };
}
