import crypto from 'node:crypto';

let cachedCerts = { certs: null, expiresAt: 0 };
let cachedFsToken = { token: null, expiresAt: 0, email: '' };

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
  if (!res.ok) throw new Error('Impossible de récupérer les certificats Firebase Auth');
  const certs = await res.json();
  const cc = res.headers.get('cache-control') || '';
  const maxAgeMatch = cc.match(/max-age=(\d+)/i);
  const ttlMs = (maxAgeMatch ? Number(maxAgeMatch[1]) : 3600) * 1000;
  cachedCerts = { certs, expiresAt: Date.now() + Math.min(ttlMs, 6 * 3600 * 1000) };
  return certs;
}

function verifySignatureAndReturn(headerB64, payloadB64, sigB64, certPem, payload) {
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  const paddedSig = sigB64.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (paddedSig.length % 4)) % 4;
  const sigBuf = Buffer.from(paddedSig + '='.repeat(padLen), 'base64');
  const ok = verifier.verify(certPem, sigBuf);
  if (!ok) throw new Error('Signature du token Firebase invalide');
  return payload;
}

async function verifyFirebaseIdToken(idToken, expectedProjectId) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('Token Firebase malformé');
  const [headerB64, payloadB64, sigB64] = parts;
  const header = decodeBase64urlJson(headerB64);
  const payload = decodeBase64urlJson(payloadB64);

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Algorithme JWT invalide');
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) {
    throw new Error('Session expirée — recharge la page');
  }
  if (payload.aud !== expectedProjectId) {
    throw new Error('Projet Firebase non autorisé');
  }
  if (payload.iss !== `https://securetoken.google.com/${expectedProjectId}`) {
    throw new Error('Émetteur JWT invalide');
  }
  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('UID manquant dans le token');
  }

  const certs = await getFirebasePublicCerts();
  const cert = certs[header.kid];
  if (!cert) {
    cachedCerts = { certs: null, expiresAt: 0 };
    const refreshed = await getFirebasePublicCerts();
    if (!refreshed[header.kid]) throw new Error('Clé de signature Firebase inconnue');
    return verifySignatureAndReturn(headerB64, payloadB64, sigB64, refreshed[header.kid], payload);
  }
  return verifySignatureAndReturn(headerB64, payloadB64, sigB64, cert, payload);
}

async function getFirestoreAccessToken(sa) {
  if (
    cachedFsToken.token &&
    cachedFsToken.email === sa.client_email &&
    Date.now() < cachedFsToken.expiresAt
  ) {
    return cachedFsToken.token;
  }

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
    throw new Error(`Impossible d'obtenir un token Firestore : ${JSON.stringify(data).slice(0, 160)}`);
  }

  const ttlSec = Math.max(300, (Number(data.expires_in) || 3600) - 300);
  cachedFsToken = {
    token: data.access_token,
    expiresAt: Date.now() + ttlSec * 1000,
    email: sa.client_email,
  };
  return data.access_token;
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export default async function handler(req, res) {
  try {
    const rawSa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const ownerUid = (process.env.FIREBASE_PUSH_UID || '').trim();
    if (!rawSa || !ownerUid) {
      return res.status(503).json({ ok: false, error: 'Stockage pochettes HD non configuré' });
    }

    const sa = parseServiceAccount(rawSa);
    const projectId = sa.project_id;
    const fsToken = await getFirestoreAccessToken(sa);

    // ===== GET /api/cover?id=cov_... -> Serve HD Cover Binary (1-Year Immutable CDN Cache) =====
    if (req.method === 'GET') {
      const id = String(req.query?.id || '').trim();
      if (!/^cov_[a-f0-9]{16,32}$/.test(id)) {
        return res.status(400).send('Invalid cover id');
      }

      const docUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
        projectId
      )}/databases/(default)/documents/users/${encodeURIComponent(ownerUid)}/covers/${encodeURIComponent(id)}`;

      const fsRes = await fetch(docUrl, {
        headers: { Authorization: `Bearer ${fsToken}` },
      });
      if (fsRes.status === 404) {
        return res.status(404).send('Cover not found');
      }
      if (!fsRes.ok) {
        return res.status(502).send('Failed to load cover');
      }

      const docJson = await fsRes.json();
      const mimeType = docJson?.fields?.mimeType?.stringValue || 'image/jpeg';
      const b64 = docJson?.fields?.base64?.stringValue || '';
      if (!b64) {
        return res.status(404).send('Empty cover');
      }

      const buf = Buffer.from(b64, 'base64');
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Content-Length', String(buf.length));
      return res.status(200).send(buf);
    }

    // ===== POST /api/cover -> Upload HD Cover (Authenticated Owner Only) =====
    if (req.method === 'POST') {
      const authHeader = String(req.headers.authorization || '');
      const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      if (!idToken) {
        return res.status(401).json({ ok: false, error: 'Authentification requise' });
      }

      const claims = await verifyFirebaseIdToken(idToken, projectId);
      if (claims.sub !== ownerUid) {
        return res.status(403).json({ ok: false, error: 'Accès refusé' });
      }

      const body = await readJsonBody(req);
      const dataUrl = String(body?.dataUrl || '').trim();
      const match = dataUrl.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
      if (!match) {
        return res.status(400).json({ ok: false, error: 'Format image invalide' });
      }

      const mimeType = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
      const base64Data = match[2];
      if (base64Data.length > 780_000) {
        return res.status(413).json({ ok: false, error: 'Image trop volumineuse' });
      }

      const coverId = `cov_${crypto.randomBytes(12).toString('hex')}`;
      const writeUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
        projectId
      )}/databases/(default)/documents/users/${encodeURIComponent(ownerUid)}/covers/${encodeURIComponent(
        coverId
      )}`;

      const writeRes = await fetch(writeUrl, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${fsToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fields: {
            mimeType: { stringValue: mimeType },
            base64: { stringValue: base64Data },
            createdAt: { integerValue: String(Date.now()) },
          },
        }),
      });

      if (!writeRes.ok) {
        const errTxt = await writeRes.text().catch(() => '');
        return res.status(502).json({
          ok: false,
          error: `Erreur sauvegarde pochette HD (${writeRes.status}) : ${errTxt.slice(0, 140)}`,
        });
      }

      return res.status(200).json({
        ok: true,
        id: coverId,
        url: `/api/cover?id=${coverId}`,
      });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || 'Erreur serveur pochette',
    });
  }
}
