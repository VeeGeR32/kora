/**
 * Bridge Pronote pour Kora (compatible PC local OU PC Linux TV 24/7 via Tailscale).
 *
 * Installation rapide :
 *   npm install -D pawnote
 *   KORA_BRIDGE_TOKEN="mon_secret_fort" node server/pronote-bridge.mjs
 *
 * Exposition HTTPS privée sur Tailscale (recommandé sur PC Linux TV) :
 *   tailscale serve --bg 4789
 */

import http from 'node:http';

const PORT = Number(process.env.PRONOTE_BRIDGE_PORT || 4789);
const HOST = process.env.PRONOTE_BRIDGE_HOST || '127.0.0.1';
const SECRET_TOKEN = (process.env.KORA_BRIDGE_TOKEN || '').trim();

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Kora-Token',
  });
  res.end(JSON.stringify(payload));
}

function isAuthorized(req) {
  if (!SECRET_TOKEN) return true;
  const provided = String(req.headers['x-kora-token'] || '').trim();
  return provided === SECRET_TOKEN;
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });

  if (req.url === '/health' && req.method === 'GET') {
    if (!isAuthorized(req)) {
      return sendJson(res, 401, { ok: false, error: 'Token X-Kora-Token invalide ou manquant.' });
    }
    return sendJson(res, 200, {
      ok: true,
      service: 'kora-pronote-bridge',
      port: PORT,
      authProtected: Boolean(SECRET_TOKEN),
      uptimeSec: Math.round(process.uptime()),
    });
  }

  if (req.url === '/sync' && req.method === 'POST') {
    if (!isAuthorized(req)) {
      return sendJson(res, 401, { ok: false, error: 'Token X-Kora-Token invalide ou manquant.' });
    }

    try {
      const body = await readBody(req);
      let pawnote;
      try {
        pawnote = await import('pawnote');
      } catch {
        return sendJson(res, 501, {
          error: 'Le package "pawnote" n\'est pas installé. Lance : npm install pawnote',
        });
      }

      const session = pawnote.createSessionHandle();

      if (body.qrCode && body.pin) {
        await pawnote.loginQrCode(session, {
          deviceUUID: body.deviceUUID || 'kora-pronote-bridge',
          pin: String(body.pin),
          qr: typeof body.qrCode === 'string' ? JSON.parse(body.qrCode) : body.qrCode,
        });
      } else if (body.url && body.username && body.password) {
        await pawnote.loginCredentials(session, {
          url: body.url,
          kind: pawnote.AccountKind.STUDENT,
          username: body.username,
          password: body.password,
          deviceUUID: body.deviceUUID || 'kora-pronote-bridge',
        });
      } else {
        return sendJson(res, 400, {
          error: 'Fournis soit (qrCode + pin), soit (url + username + password).',
        });
      }

      const tab = session.user.resources[0];
      const now = new Date();
      const in14Days = new Date(now.getTime() + 14 * 86400_000);

      const [timetable, assignments, gradesOverview] = await Promise.all([
        pawnote.timetableFromIntervals(session, now, in14Days).catch(() => ({ classes: [] })),
        pawnote.assignmentsFromIntervals(session, now, in14Days).catch(() => []),
        pawnote.gradesOverview(session, tab?.periods?.[0]).catch(() => ({ grades: [] })),
      ]);

      const pad = (n) => String(n).padStart(2, '0');
      const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const toHHMM = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

      const events = (timetable.classes || [])
        .filter((c) => !c.canceled && c.startDate && c.endDate)
        .map((c) => ({
          type: 'cours',
          title: c.subject?.name || c.notes || 'Cours',
          subject: c.subject?.name || 'Cours',
          location: (c.classrooms || []).join(', ') || undefined,
          date: toISO(new Date(c.startDate)),
          startTime: toHHMM(new Date(c.startDate)),
          endTime: toHHMM(new Date(c.endDate)),
          recurringWeekly: false,
          notes: (c.teacherNames || []).join(', ') || undefined,
        }));

      const homework = (assignments || []).map((a) => ({
        title: a.description?.replace(/<[^>]+>/g, '').trim().slice(0, 140) || 'Devoir Pronote',
        subject: a.subject?.name || 'Général',
        dueDate: a.deadline ? toISO(new Date(a.deadline)) : toISO(now),
        priority: 'medium',
        done: Boolean(a.done),
      }));

      const grades = (gradesOverview.grades || [])
        .filter((g) => g.value && typeof g.value.points === 'number')
        .map((g) => ({
          subject: g.subject?.name || 'Matière',
          title: g.comment || 'Évaluation',
          score: g.value.points,
          outOf: g.outOf?.points || 20,
          coefficient: g.coefficient || 1,
          date: g.date ? toISO(new Date(g.date)) : toISO(now),
          source: 'pronote',
        }));

      return sendJson(res, 200, { ok: true, events, homework, grades });
    } catch (err) {
      return sendJson(res, 500, { error: String(err?.message || err) });
    }
  }

  sendJson(res, 404, { error: 'Route inconnue' });
});

server.listen(PORT, HOST, () => {
  console.log(
    `[Kora Pronote Bridge] En écoute sur http://${HOST}:${PORT} (auth: ${
      SECRET_TOKEN ? 'X-Kora-Token activé' : 'aucun token'
    })`
  );
});
