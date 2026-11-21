import crypto from 'node:crypto';
import webpush from 'web-push';

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

async function getGoogleAccessTokenFromServiceAccount(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/datastore',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })
  );
  const unsigned = `${header}.${claim}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  const signature = base64url(signer.sign(sa.private_key));

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`OAuth token error: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

function fromFirestoreValue(val) {
  if (!val || typeof val !== 'object') return null;
  if ('stringValue' in val) return val.stringValue;
  if ('booleanValue' in val) return val.booleanValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('nullValue' in val) return null;
  if ('arrayValue' in val) {
    return (val.arrayValue.values || []).map(fromFirestoreValue);
  }
  if ('mapValue' in val) {
    const out = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) {
      out[k] = fromFirestoreValue(v);
    }
    return out;
  }
  return null;
}

function parisNowParts() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const dateISO = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  return { dateISO, nowMin: hour * 60 + minute };
}

function timeToMinutes(hhmm = '00:00') {
  const [h, m] = String(hhmm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function addDaysISO(dateISO, delta) {
  const [y, m, d] = dateISO.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.authorization || '';
    const querySecret = req.query?.secret || '';
    if (authHeader !== `Bearer ${cronSecret}` && querySecret !== cronSecret) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
  }

  const publicKey =
    process.env.VAPID_PUBLIC_KEY ||
    process.env.VITE_VAPID_PUBLIC_KEY ||
    'BEF3EQDd5Hvm-3NmLYmA0hZtJ1Jw9v0ikEmvfzOABSDRqKdI40jeV-zK50Q0dB9IzGTaF1BLOPy_lq4MEZZMObM';
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:dialloalioune32@gmail.com';
  const saRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const targetUid = process.env.FIREBASE_PUSH_UID;

  if (!publicKey || !privateKey || !saRaw || !targetUid) {
    return res.status(503).json({
      ok: false,
      error:
        'Variables manquantes sur Vercel (VITE_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, FIREBASE_SERVICE_ACCOUNT_JSON, FIREBASE_PUSH_UID).',
    });
  }

  try {
    const sa = JSON.parse(saRaw);
    const accessToken = await getGoogleAccessTokenFromServiceAccount(sa);
    const docUrl = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents/users/${encodeURIComponent(
      targetUid
    )}/appState/main`;

    const docRes = await fetch(docUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!docRes.ok) {
      return res.status(docRes.status).json({ ok: false, error: await docRes.text() });
    }

    const rawDoc = await docRes.json();
    const state = fromFirestoreValue({ mapValue: { fields: rawDoc.fields || {} } }) || {};
    const cfg = state.preferences?.notifications;
    if (!cfg?.enabled || !cfg?.pushSubscription?.endpoint) {
      return res.status(200).json({ ok: true, sent: 0, reason: 'Notifications disabled or no subscription' });
    }

    const { dateISO: today, nowMin } = parisNowParts();
    const tomorrow = addDaysISO(today, 1);
    const toSend = [];

    // 1. Upcoming events within the next 15..10 min window (assuming 5-min cron cadence)
    if (cfg.eventsBeforeMin > 0 && Array.isArray(state.events)) {
      const targetMin = cfg.eventsBeforeMin;
      for (const ev of state.events) {
        if (ev.completed || ev.date !== today) continue;
        const diff = timeToMinutes(ev.startTime) - nowMin;
        if (diff > Math.max(0, targetMin - 5) && diff <= targetMin) {
          const where = ev.location ? ` · ${ev.location}` : '';
          toSend.push({
            title: `Dans ${diff} min : ${ev.title}`,
            body: `${ev.startTime}–${ev.endTime}${where}`,
            tag: `ev-${ev.id}-${today}`,
          });
        }
      }
    }

    // 2. Morning briefing (5-min window)
    if (cfg.dailyBriefing) {
      const morningMin = timeToMinutes(cfg.morningHour || '07:45');
      if (nowMin >= morningMin && nowMin < morningMin + 5) {
        const todayEvents = (state.events || []).filter((e) => e.date === today);
        const hwToday = (state.homework || []).filter((h) => !h.done && h.dueDate <= today).length;
        toSend.push({
          title: 'Briefing Kora du jour',
          body: `${todayEvents.length} créneau${todayEvents.length > 1 ? 'x' : ''} aujourd’hui${
            hwToday ? ` · ${hwToday} devoir${hwToday > 1 ? 's' : ''}` : ''
          }.`,
          tag: `morning-${today}`,
        });
      }
    }

    // 3. Homework & Exams at 18:00..18:04
    if (cfg.homeworkAndExams && nowMin >= 18 * 60 && nowMin < 18 * 60 + 5) {
      const examsSoon = (state.exams || []).filter(
        (e) => !e.done && (e.date === today || e.date === tomorrow)
      );
      const hwSoon = (state.homework || []).filter((h) => !h.done && h.dueDate <= tomorrow);
      if (examsSoon.length > 0) {
        toSend.push({
          title: `Éval proche : ${examsSoon[0].title}`,
          body: `${examsSoon[0].subject} · prévue le ${examsSoon[0].date}`,
          tag: `exam-${examsSoon[0].id}-${today}`,
        });
      } else if (hwSoon.length > 0) {
        toSend.push({
          title: `${hwSoon.length} devoir${hwSoon.length > 1 ? 's' : ''} à rendre`,
          body: hwSoon
            .slice(0, 2)
            .map((h) => `${h.subject} : ${h.title}`)
            .join(' · '),
          tag: `hw-${today}`,
        });
      }
    }

    // 4. Hydration nudge at 16:30..16:34
    if (cfg.hydrationAndMacros && nowMin >= 16 * 60 + 30 && nowMin < 16 * 60 + 35) {
      const water = state.waterMlByDate?.[today] || 0;
      const goal = state.preferences?.nutritionGoals?.waterMl || 2500;
      if (water < goal * 0.55) {
        toSend.push({
          title: 'Rappel hydratation',
          body: `${(water / 1000).toFixed(1)} L / ${(goal / 1000).toFixed(1)} L aujourd’hui — bois un grand verre d’eau.`,
          tag: `water-${today}`,
        });
      }
    }

    // 5. Evening recap at 21:00..21:04
    if (cfg.dailyBriefing && nowMin >= 21 * 60 && nowMin < 21 * 60 + 5) {
      const tasksLeft = (state.tasks || []).filter((t) => !t.done && (!t.dueDate || t.dueDate <= today)).length;
      const hwLeft = (state.homework || []).filter((h) => !h.done && h.dueDate <= today).length;
      if (tasksLeft + hwLeft > 0) {
        toSend.push({
          title: 'Bilan du soir · Kora',
          body: `${tasksLeft} tâche${tasksLeft > 1 ? 's' : ''} et ${hwLeft} devoir${hwLeft > 1 ? 's' : ''} restants.`,
          tag: `evening-${today}`,
        });
      }
    }

    webpush.setVapidDetails(subject, publicKey, privateKey);
    for (const notif of toSend) {
      await webpush.sendNotification(
        cfg.pushSubscription,
        JSON.stringify({ ...notif, url: '/' })
      );
    }

    return res.status(200).json({ ok: true, sent: toSend.length, timeParis: `${today} ${nowMin}m` });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}
