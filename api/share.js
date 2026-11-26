import crypto from 'node:crypto';

let cachedCerts = { certs: null, expiresAt: 0 };
const cachedTokens = new Map(); // scope -> { token, expiresAt, email }

const MAX_CHUNK_BYTES = 2 * 1024 * 1024; // 2 MB chunks (well below Vercel 4.5 MB limit & silky smooth on iOS Safari)

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function decodeBase64urlJson(segment) {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return JSON.parse(Buffer.from(padded + '='.repeat(padLen), 'base64').toString('utf8'));
}

function parseServiceAccount(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON manquant sur Vercel');
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  return JSON.parse(Buffer.from(trimmed, 'base64').toString('utf8'));
}

async function getFirebasePublicCerts() {
  if (cachedCerts.certs && Date.now() < cachedCerts.expiresAt) {
    return cachedCerts.certs;
  }
  const res = await fetch(
    'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
  );
  if (!res.ok) throw new Error('Certificats Firebase Auth indisponibles');
  const certs = await res.json();
  const cc = res.headers.get('cache-control') || '';
  const maxAgeMatch = cc.match(/max-age=(\d+)/i);
  const ttlMs = (maxAgeMatch ? Number(maxAgeMatch[1]) : 3600) * 1000;
  cachedCerts = { certs, expiresAt: Date.now() + Math.min(ttlMs, 6 * 3600 * 1000) };
  return certs;
}

async function verifyFirebaseIdToken(idToken, expectedProjectId) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('Token Firebase invalide');
  const [headerB64, payloadB64, sigB64] = parts;
  const header = decodeBase64urlJson(headerB64);
  const payload = decodeBase64urlJson(payloadB64);
  if (header.alg !== 'RS256' || !header.kid) throw new Error('JWT invalide');

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) throw new Error('Session expirée');
  if (payload.aud !== expectedProjectId) throw new Error('Projet non autorisé');
  if (payload.iss !== `https://securetoken.google.com/${expectedProjectId}`) {
    throw new Error('Émetteur JWT invalide');
  }
  if (!payload.sub || typeof payload.sub !== 'string') throw new Error('UID manquant');

  let certs = await getFirebasePublicCerts();
  if (!certs[header.kid]) {
    cachedCerts = { certs: null, expiresAt: 0 };
    certs = await getFirebasePublicCerts();
  }
  const certPem = certs[header.kid];
  if (!certPem) throw new Error('Clé Firebase inconnue');

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  const paddedSig = sigB64.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (paddedSig.length % 4)) % 4;
  const ok = verifier.verify(certPem, Buffer.from(paddedSig + '='.repeat(padLen), 'base64'));
  if (!ok) throw new Error('Signature invalide');
  return payload;
}

async function getServiceAccountToken(sa, scope) {
  const key = `${sa.client_email}:${scope}`;
  const cached = cachedTokens.get(key);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.token;
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope,
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
    throw new Error(`OAuth SA error: ${JSON.stringify(data).slice(0, 160)}`);
  }
  const ttlSec = Math.max(300, (Number(data.expires_in) || 3600) - 300);
  cachedTokens.set(key, { token: data.access_token, expiresAt: Date.now() + ttlSec * 1000 });
  return data.access_token;
}

function getSigningSecret(sa) {
  return crypto
    .createHash('sha256')
    .update(`${sa.private_key}|${process.env.FIREBASE_PUSH_UID || ''}|kora-public-share-v1`)
    .digest();
}

function signShareToken(sa, uid, kind, id) {
  const prefix = kind === 'project' ? 'p' : 't';
  const payload = `${prefix}.${uid}.${id}`;
  const sig = crypto
    .createHmac('sha256', getSigningSecret(sa))
    .update(payload)
    .digest('hex')
    .slice(0, 24);
  return `${payload}.${sig}`;
}

function verifyShareToken(sa, token, legacyDefaultUid) {
  const parts = String(token || '').trim().split('.');
  if (parts.length === 4) {
    const [prefix, uid, id, sig] = parts;
    if ((prefix !== 't' && prefix !== 'p') || !uid || !id || !/^[a-f0-9]{24}$/i.test(sig)) {
      return null;
    }
    const expected = crypto
      .createHmac('sha256', getSigningSecret(sa))
      .update(`${prefix}.${uid}.${id}`)
      .digest('hex')
      .slice(0, 24);
    const a = Buffer.from(sig.toLowerCase(), 'utf8');
    const b = Buffer.from(expected.toLowerCase(), 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return { kind: prefix === 'p' ? 'project' : 'track', uid, id };
  }
  if (parts.length === 3 && legacyDefaultUid) {
    const [prefix, id, sig] = parts;
    if ((prefix !== 't' && prefix !== 'p') || !id || !/^[a-f0-9]{24}$/i.test(sig)) {
      return null;
    }
    const expected = crypto
      .createHmac('sha256', getSigningSecret(sa))
      .update(`${prefix}.${id}`)
      .digest('hex')
      .slice(0, 24);
    const a = Buffer.from(sig.toLowerCase(), 'utf8');
    const b = Buffer.from(expected.toLowerCase(), 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return { kind: prefix === 'p' ? 'project' : 'track', uid: legacyDefaultUid, id };
  }
  return null;
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

function toFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return { integerValue: String(val) };
    return { doubleValue: val };
  }
  if (typeof val === 'string') return { stringValue: val };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(toFirestoreValue) } };
  }
  if (typeof val === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) fields[k] = toFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function getShareDocId(parsed) {
  return `${parsed.kind}_${parsed.uid}_${parsed.id}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}

function hashSharePasscode(sa, shareDocId, rawCode) {
  const clean = String(rawCode || '').trim();
  if (!clean) return null;
  return crypto
    .createHmac('sha256', getSigningSecret(sa))
    .update(`passcode|${shareDocId}|${clean}`)
    .digest('hex');
}

function verifySharePasscode(sa, shareDocId, expectedHash, providedCode) {
  if (!expectedHash) return true;
  const candidate = hashSharePasscode(sa, shareDocId, providedCode);
  if (!candidate) return false;
  const a = Buffer.from(candidate, 'utf8');
  const b = Buffer.from(String(expectedHash), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function loadShareMeta(sa, shareDocId) {
  try {
    const token = await getServiceAccountToken(sa, 'https://www.googleapis.com/auth/datastore');
    const docUrl = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents/public_shares/${encodeURIComponent(
      shareDocId
    )}`;
    const res = await fetch(docUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 404) {
      return { passcodeHash: null, allowComments: true, comments: [] };
    }
    if (!res.ok) return { passcodeHash: null, allowComments: true, comments: [] };
    const rawDoc = await res.json();
    const parsed = fromFirestoreValue({ mapValue: { fields: rawDoc.fields || {} } }) || {};
    return {
      passcodeHash: typeof parsed.passcodeHash === 'string' && parsed.passcodeHash ? parsed.passcodeHash : null,
      allowComments: parsed.allowComments !== false,
      comments: Array.isArray(parsed.comments) ? parsed.comments : [],
    };
  } catch {
    return { passcodeHash: null, allowComments: true, comments: [] };
  }
}

async function saveShareMeta(sa, shareDocId, meta) {
  const token = await getServiceAccountToken(sa, 'https://www.googleapis.com/auth/datastore');
  const docUrl = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents/public_shares/${encodeURIComponent(
    shareDocId
  )}`;
  const body = {
    fields: {
      passcodeHash: toFirestoreValue(meta.passcodeHash || null),
      allowComments: toFirestoreValue(meta.allowComments !== false),
      comments: toFirestoreValue(Array.isArray(meta.comments) ? meta.comments.slice(-100) : []),
      updatedAt: toFirestoreValue(Date.now()),
    },
  };
  const res = await fetch(docUrl, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Impossible de sauvegarder les métadonnées de partage (${res.status})`);
  }
}

async function fetchOwnerAppState(sa, targetUid) {
  const token = await getServiceAccountToken(sa, 'https://www.googleapis.com/auth/datastore');
  const docUrl = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents/users/${encodeURIComponent(
    targetUid
  )}/appState/main`;
  const res = await fetch(docUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Firestore read failed (${res.status})`);
  const rawDoc = await res.json();
  return fromFirestoreValue({ mapValue: { fields: rawDoc.fields || {} } }) || {};
}

function resolveSharedTracks(state, parsed) {
  const allTracks = Array.isArray(state.musicTracks) ? state.musicTracks : [];
  const allProjects = Array.isArray(state.musicProjects) ? state.musicProjects : [];

  if (parsed.kind === 'track') {
    const track = allTracks.find((t) => t.id === parsed.id);
    if (!track) return null;
    const linkedProject =
      allProjects.find(
        (p) => p.id === track.linkedProjectId || (Array.isArray(p.trackIds) && p.trackIds.includes(track.id))
      ) || null;
    return {
      kind: 'track',
      project: linkedProject
        ? {
            id: linkedProject.id,
            title: linkedProject.title,
            kind: linkedProject.kind || 'single',
            coverDataUrl: linkedProject.coverDataUrl || null,
            coverGradient: linkedProject.coverGradient || 'pink',
          }
        : null,
      tracks: [track],
    };
  }

  const project = allProjects.find((p) => p.id === parsed.id);
  if (!project) return null;

  const byId = new Map(allTracks.map((t) => [t.id, t]));
  const ordered = [];
  const seen = new Set();

  if (Array.isArray(project.trackIds)) {
    for (const tid of project.trackIds) {
      const found = byId.get(tid);
      if (found && !seen.has(found.id)) {
        ordered.push(found);
        seen.add(found.id);
      }
    }
  }
  for (const t of allTracks) {
    if (t.linkedProjectId === project.id && !seen.has(t.id)) {
      ordered.push(t);
      seen.add(t.id);
    }
  }

  return {
    kind: 'project',
    project: {
      id: project.id,
      title: project.title,
      kind: project.kind || 'ep',
      coverDataUrl: project.coverDataUrl || null,
      coverGradient: project.coverGradient || 'pink',
    },
    tracks: ordered,
  };
}

async function streamDriveAudio(req, res, sa, fileId) {
  const driveToken = await getServiceAccountToken(
    sa,
    'https://www.googleapis.com/auth/drive.readonly'
  );

  // 1. Read exact file size & mimeType from Drive metadata
  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=size,mimeType,name`,
    { headers: { Authorization: `Bearer ${driveToken}` } }
  );
  if (!metaRes.ok) {
    return res.status(metaRes.status === 404 ? 404 : 502).json({
      ok: false,
      error: 'Fichier audio introuvable sur Google Drive (vérifie le partage permanent).',
    });
  }
  const meta = await metaRes.json();
  const totalSize = Number(meta.size) || 0;
  const contentType = meta.mimeType && meta.mimeType.startsWith('audio/') ? meta.mimeType : 'audio/mpeg';

  const rangeHeader = String(req.headers.range || '');
  let start = 0;
  let end = totalSize > 0 ? totalSize - 1 : MAX_CHUNK_BYTES - 1;
  let isRange = false;

  if (rangeHeader.startsWith('bytes=')) {
    isRange = true;
    const [rawStart, rawEnd] = rangeHeader.slice(6).split('-');
    if (rawStart) start = Math.max(0, parseInt(rawStart, 10) || 0);
    if (rawEnd) {
      end = Math.min(totalSize > 0 ? totalSize - 1 : parseInt(rawEnd, 10), parseInt(rawEnd, 10));
    } else if (totalSize > 0) {
      end = totalSize - 1;
    }
  } else if (totalSize > 3.6 * 1024 * 1024) {
    // Force byte-range chunking for larger MP3s so Vercel never hits payload limit
    isRange = true;
    start = 0;
    end = MAX_CHUNK_BYTES - 1;
  }

  if (totalSize > 0 && start >= totalSize) {
    res.setHeader('Content-Range', `bytes */${totalSize}`);
    return res.status(416).end();
  }

  // Clamp chunk to <= 2 MB per request (browsers automatically fetch subsequent ranges seamlessly!)
  if (end - start + 1 > MAX_CHUNK_BYTES) {
    end = start + MAX_CHUNK_BYTES - 1;
    if (totalSize > 0) end = Math.min(end, totalSize - 1);
    isRange = true;
  }

  const fetchHeaders = { Authorization: `Bearer ${driveToken}` };
  if (isRange || totalSize > 0) {
    fetchHeaders.Range = `bytes=${start}-${end}`;
  }

  const audioRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    { headers: fetchHeaders }
  );

  if (!audioRes.ok && audioRes.status !== 206) {
    return res.status(502).json({ ok: false, error: `Erreur stream Drive (${audioRes.status})` });
  }

  const buf = Buffer.from(await audioRes.arrayBuffer());
  const actualEnd = start + buf.length - 1;

  res.setHeader('Content-Type', contentType);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Length', String(buf.length));
  res.setHeader('Cache-Control', 'public, max-age=3600');

  if (isRange && totalSize > 0) {
    res.setHeader('Content-Range', `bytes ${start}-${actualEnd}/${totalSize}`);
    return res.status(206).send(buf);
  }

  return res.status(200).send(buf);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Range, X-Share-Passcode');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const saRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const legacyDefaultUid = (process.env.FIREBASE_PUSH_UID || '').trim();
  if (!saRaw) {
    return res.status(503).json({
      ok: false,
      error: 'Partage public non configuré sur le serveur.',
    });
  }

  try {
    const sa = parseServiceAccount(saRaw);

    // ===== POST /api/share =====
    if (req.method === 'POST') {
      const body = req.body || {};

      // Public listener action: add a timestamped feedback comment
      if (body.action === 'add_comment') {
        const token = String(body.token || '');
        const parsed = verifyShareToken(sa, token, legacyDefaultUid);
        if (!parsed || !parsed.uid) {
          return res.status(403).json({ ok: false, error: 'Lien de partage invalide.' });
        }
        const shareDocId = getShareDocId(parsed);
        const meta = await loadShareMeta(sa, shareDocId);
        const providedPasscode = String(
          req.headers['x-share-passcode'] || body.passcode || ''
        ).trim();
        if (!verifySharePasscode(sa, shareDocId, meta.passcodeHash, providedPasscode)) {
          return res.status(401).json({ ok: false, requiresPasscode: true, error: 'Code d’accès requis.' });
        }
        if (meta.allowComments === false) {
          return res.status(403).json({ ok: false, error: 'Les commentaires sont désactivés sur ce lien.' });
        }

        const text = String(body.text || '').trim().slice(0, 500);
        if (!text) {
          return res.status(400).json({ ok: false, error: 'Commentaire vide.' });
        }
        const authorName = String(body.authorName || 'Auditeur').trim().slice(0, 40) || 'Auditeur';
        const trackId = String(body.trackId || parsed.id).trim().slice(0, 120);
        const rawSec = Number(body.timeSec);
        const timeSec = Number.isFinite(rawSec) ? Math.max(0, Math.min(7200, Math.round(rawSec))) : 0;

        const comment = {
          id: `cmt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
          trackId,
          timeSec,
          authorName,
          text,
          createdAt: new Date().toISOString(),
        };
        const nextComments = [...(meta.comments || []), comment].slice(-100);
        await saveShareMeta(sa, shareDocId, {
          ...meta,
          comments: nextComments,
        });
        return res.status(200).json({ ok: true, comment, comments: nextComments });
      }

      // Authenticated owner actions (create/update share link, read feedback comments)
      const authHeader = String(req.headers.authorization || '');
      const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      if (!idToken) {
        return res.status(401).json({ ok: false, error: 'Authentification requise.' });
      }
      const verified = await verifyFirebaseIdToken(idToken, sa.project_id);

      const { kind, id } = body;
      if ((kind !== 'track' && kind !== 'project') || typeof id !== 'string' || !id.trim()) {
        return res.status(400).json({ ok: false, error: 'Paramètres kind/id invalides.' });
      }

      const cleanId = id.trim();
      const token = signShareToken(sa, verified.sub, kind, cleanId);
      const shareDocId = getShareDocId({ kind, uid: verified.sub, id: cleanId });
      const existingMeta = await loadShareMeta(sa, shareDocId);

      if (body.action === 'get_owner_meta') {
        return res.status(200).json({
          ok: true,
          token,
          hasPasscode: Boolean(existingMeta.passcodeHash),
          allowComments: existingMeta.allowComments !== false,
          comments: existingMeta.comments || [],
        });
      }

      let nextPasscodeHash = existingMeta.passcodeHash;
      let shouldSave = false;
      if (body.clearPasscode === true) {
        nextPasscodeHash = null;
        shouldSave = true;
      } else if (typeof body.passcode === 'string' && body.passcode.trim()) {
        nextPasscodeHash = hashSharePasscode(sa, shareDocId, body.passcode.trim());
        shouldSave = true;
      }
      let nextAllowComments = existingMeta.allowComments !== false;
      if (typeof body.allowComments === 'boolean') {
        nextAllowComments = body.allowComments;
        shouldSave = true;
      }

      if (shouldSave) {
        await saveShareMeta(sa, shareDocId, {
          passcodeHash: nextPasscodeHash,
          allowComments: nextAllowComments,
          comments: existingMeta.comments || [],
        });
      }

      return res.status(200).json({
        ok: true,
        token,
        hasPasscode: Boolean(nextPasscodeHash),
        allowComments: nextAllowComments,
        comments: existingMeta.comments || [],
      });
    }

    // ===== GET /api/share?token=... (&stream=trackId) — Public Listener =====
    if (req.method === 'GET') {
      const token = String(req.query?.token || '');
      const parsed = verifyShareToken(sa, token, legacyDefaultUid);
      if (!parsed || !parsed.uid) {
        return res.status(403).json({ ok: false, error: 'Lien de partage invalide ou expiré.' });
      }

      const shareDocId = getShareDocId(parsed);
      const [state, shareMeta] = await Promise.all([
        fetchOwnerAppState(sa, parsed.uid),
        loadShareMeta(sa, shareDocId),
      ]);
      const resolved = resolveSharedTracks(state, parsed);
      if (!resolved) {
        return res.status(404).json({ ok: false, error: 'Ce son ou projet n’existe plus.' });
      }

      const ownerName = (state.preferences?.name || '').trim() || 'Artiste';
      const providedPasscode = String(
        req.headers['x-share-passcode'] || req.query?.passcode || ''
      ).trim();

      if (!verifySharePasscode(sa, shareDocId, shareMeta.passcodeHash, providedPasscode)) {
        return res.status(401).json({
          ok: false,
          requiresPasscode: true,
          kind: resolved.kind,
          artist: ownerName,
          title:
            resolved.kind === 'project'
              ? resolved.project?.title || 'Projet protégé'
              : resolved.tracks[0]?.manualGroupTitle || resolved.tracks[0]?.title || 'Son protégé',
          error: providedPasscode ? 'Code d’accès incorrect.' : 'Ce lien est protégé par un code d’accès.',
        });
      }

      const streamTrackId = req.query?.stream ? String(req.query.stream) : null;
      if (streamTrackId) {
        const targetTrack = resolved.tracks.find((t) => t.id === streamTrackId);
        if (!targetTrack) {
          return res.status(403).json({ ok: false, error: 'Accès non autorisé à ce morceau.' });
        }
        if (targetTrack.googleDriveFileId) {
          return await streamDriveAudio(req, res, sa, targetTrack.googleDriveFileId);
        }
        if (targetTrack.cloudAudioUrl) {
          return res.redirect(302, targetTrack.cloudAudioUrl);
        }
        return res.status(404).json({
          ok: false,
          error: 'Ce morceau est stocké uniquement en local et n’est pas encore sur Google Drive.',
        });
      }

      const projectCover = resolved.project?.coverDataUrl || null;
      const passcodeQuery =
        shareMeta.passcodeHash && providedPasscode
          ? `&passcode=${encodeURIComponent(providedPasscode)}`
          : '';
      const publicTracks = resolved.tracks.map((t) => ({
        id: t.id,
        title: t.manualGroupTitle || t.title,
        artist: ownerName || t.artist || 'Artiste',
        durationSec: t.durationSec || 0,
        // Rule: if the project has a cover, apply it to all its tracks; otherwise keep each track's individual cover
        coverDataUrl: projectCover || t.coverDataUrl || t.cloudCoverUrl || null,
        coverGradient: t.coverGradient || resolved.project?.coverGradient || 'pink',
        addedAt: t.modifiedAt || t.addedAt || '',
        streamable: Boolean(t.googleDriveFileId || t.cloudAudioUrl),
        audioUrl:
          t.googleDriveFileId || t.cloudAudioUrl
            ? `/api/share?token=${encodeURIComponent(token)}&stream=${encodeURIComponent(t.id)}${passcodeQuery}`
            : null,
      }));

      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({
        ok: true,
        kind: resolved.kind,
        artist: ownerName,
        project: resolved.project,
        tracks: publicTracks,
        hasPasscode: Boolean(shareMeta.passcodeHash),
        allowComments: shareMeta.allowComments !== false,
        comments: shareMeta.comments || [],
      });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}
