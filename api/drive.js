import crypto from 'node:crypto';

let cachedCerts = { certs: null, expiresAt: 0 };
let cachedDriveToken = { token: null, expiresAt: 0, email: '' };

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

/**
 * Cryptographically verifies a Firebase Auth ID token using Google's official RS256 x509 certs.
 */
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
    // Bust cache once in case Google rotated keys
    cachedCerts = { certs: null, expiresAt: 0 };
    const refreshed = await getFirebasePublicCerts();
    if (!refreshed[header.kid]) throw new Error('Clé de signature Firebase inconnue');
    return verifySignatureAndReturn(headerB64, payloadB64, sigB64, refreshed[header.kid], payload);
  }
  return verifySignatureAndReturn(headerB64, payloadB64, sigB64, cert, payload);
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

/**
 * Mints a strictly read-only Google Drive access token from the configured Service Account.
 * Zero user popups, zero OAuth consent screen, never expires!
 */
async function getDriveReadOnlyAccessToken(sa) {
  if (
    cachedDriveToken.token &&
    cachedDriveToken.email === sa.client_email &&
    Date.now() < cachedDriveToken.expiresAt
  ) {
    return {
      accessToken: cachedDriveToken.token,
      expiresIn: Math.max(60, Math.floor((cachedDriveToken.expiresAt - Date.now()) / 1000)),
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/drive.readonly',
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
    throw new Error(`Impossible d’obtenir un token Drive : ${JSON.stringify(data).slice(0, 180)}`);
  }

  const ttlSec = Math.max(300, (Number(data.expires_in) || 3600) - 300);
  cachedDriveToken = {
    token: data.access_token,
    expiresAt: Date.now() + ttlSec * 1000,
    email: sa.client_email,
  };
  return { accessToken: data.access_token, expiresIn: ttlSec };
}

async function checkHasSharedAudioFiles(accessToken) {
  const params = new URLSearchParams({
    q: "(mimeType = 'audio/mpeg' or mimeType = 'audio/mp3' or name contains '.mp3') and trashed = false",
    fields: 'files(id)',
    pageSize: '1',
  });
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    if (res.status === 403 && /Drive API has not been used|accessNotConfigured/i.test(errText)) {
      throw new Error(
        'Active Google Drive API dans Google Cloud Console (projet kora-d6019 → Bibliothèque → Google Drive API → Activer).'
      );
    }
    return false;
  }
  const data = await res.json();
  return Array.isArray(data.files) && data.files.length > 0;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const saRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const targetUid = process.env.FIREBASE_PUSH_UID;
  if (!saRaw || !targetUid) {
    return res.status(503).json({
      ok: false,
      configured: false,
      error: 'Connexion permanente Drive non configurée sur le serveur.',
    });
  }

  const authHeader = String(req.headers.authorization || '');
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!idToken) {
    return res.status(401).json({ ok: false, error: 'Authentification Kora requise.' });
  }

  try {
    const sa = parseServiceAccount(saRaw);
    const verified = await verifyFirebaseIdToken(idToken, sa.project_id);
    if (verified.sub !== targetUid) {
      return res.status(403).json({ ok: false, error: 'Compte non autorisé pour ce Google Drive.' });
    }

    const { accessToken, expiresIn } = await getDriveReadOnlyAccessToken(sa);
    const hasSharedFiles = await checkHasSharedAudioFiles(accessToken);

    return res.status(200).json({
      ok: true,
      configured: true,
      serviceAccountEmail: sa.client_email,
      hasSharedFiles,
      accessToken,
      expiresIn,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || String(err),
    });
  }
}
