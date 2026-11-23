import crypto from 'node:crypto';

let cachedDriveRwToken = null;
let cachedDriveRwExpiryMs = 0;

function parseServiceAccount() {
  const rawJson = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
  if (rawJson && rawJson.trim()) {
    try {
      const parsed = JSON.parse(rawJson.trim());
      if (parsed.client_email && parsed.private_key) {
        return {
          client_email: parsed.client_email,
          private_key: String(parsed.private_key).replace(/\\n/g, '\n'),
          project_id: parsed.project_id || process.env.VITE_FIREBASE_PROJECT_ID || 'kora-4859d',
        };
      }
    } catch {
      // Fallback
    }
  }
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (email && key) {
    return {
      client_email: email.trim(),
      private_key: key.replace(/\\n/g, '\n'),
      project_id: process.env.VITE_FIREBASE_PROJECT_ID || 'kora-4859d',
    };
  }
  return null;
}

async function verifyFirebaseIdToken(idToken, expectedProjectId) {
  if (!idToken || typeof idToken !== 'string') return null;
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const nowSec = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < nowSec - 30) return null;
    if (expectedProjectId && payload.aud !== expectedProjectId) return null;
    if (!payload.sub) return null;

    const certsRes = await fetch(
      'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
    );
    if (!certsRes.ok) return null;
    const certs = await certsRes.json();
    const certPem = certs[header.kid];
    if (!certPem) return null;

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${parts[0]}.${parts[1]}`);
    verifier.end();
    const valid = verifier.verify(certPem, Buffer.from(parts[2], 'base64url'));
    return valid ? payload : null;
  } catch {
    return null;
  }
}

async function getDriveRwToken(sa) {
  const now = Date.now();
  if (cachedDriveRwToken && now < cachedDriveRwExpiryMs - 60_000) {
    return cachedDriveRwToken;
  }
  const iat = Math.floor(now / 1000);
  const exp = iat + 3600;
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claim = Buffer.from(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/drive',
      aud: 'https://oauth2.googleapis.com/token',
      iat,
      exp,
    })
  ).toString('base64url');

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  signer.end();
  const signature = signer.sign(sa.private_key).toString('base64url');
  const assertion = `${header}.${claim}.${signature}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });
  if (!tokenRes.ok) {
    const errText = await tokenRes.text().catch(() => '');
    throw new Error(`Drive OAuth error (${tokenRes.status}): ${errText.slice(0, 200)}`);
  }
  const data = await tokenRes.json();
  cachedDriveRwToken = data.access_token;
  cachedDriveRwExpiryMs = now + (Number(data.expires_in) || 3600) * 1000;
  return cachedDriveRwToken;
}

async function resolveTargetRootFolderId(token, folderId) {
  if (folderId && folderId !== 'root') return folderId;
  // Find the first writable shared folder visible to the service account
  const q = encodeURIComponent(
    "mimeType='application/vnd.google-apps.folder' and trashed=false"
  );
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,capabilities(canAddChildren))&pageSize=20&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const writable = (data.files || []).find((f) => f.capabilities?.canAddChildren);
  return writable?.id || data.files?.[0]?.id || null;
}

async function ensureSubFolder(token, parentId, name) {
  const safeName = name.replace(/'/g, "\\'");
  const q = encodeURIComponent(
    `'${parentId}' in parents and name='${safeName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=5&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (searchRes.ok) {
    const searchData = await searchRes.json();
    if (Array.isArray(searchData.files) && searchData.files.length > 0) {
      return { ok: true, id: searchData.files[0].id };
    }
  }

  const createRes = await fetch(
    'https://www.googleapis.com/drive/v3/files?fields=id&supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      }),
    }
  );
  if (createRes.status === 403) {
    return { ok: false, readonly: true };
  }
  if (!createRes.ok) {
    const txt = await createRes.text().catch(() => '');
    return { ok: false, error: `Impossible de créer ${name} (${createRes.status}): ${txt.slice(0, 120)}` };
  }
  const created = await createRes.json();
  return { ok: true, id: created.id };
}

async function upsertMultipartFile(token, parentId, fileName, mimeType, buffer) {
  const safeName = fileName.replace(/'/g, "\\'");
  const q = encodeURIComponent(
    `'${parentId}' in parents and name='${safeName}' and trashed=false`
  );
  let existingId = null;
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&pageSize=2&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (searchRes.ok) {
    const searchData = await searchRes.json();
    existingId = searchData.files?.[0]?.id || null;
  }

  const boundary = `rowav_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const metadata = existingId
    ? { name: fileName, mimeType }
    : { name: fileName, mimeType, parents: [parentId] };

  const headerPart = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
      metadata
    )}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    'utf8'
  );
  const footerPart = Buffer.from(`\r\n--${boundary}--`, 'utf8');
  const bodyBuf = Buffer.concat([headerPart, buffer, footerPart]);

  const uploadUrl = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(
        existingId
      )}?uploadType=multipart&fields=id&supportsAllDrives=true`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id&supportsAllDrives=true';

  const res = await fetch(uploadUrl, {
    method: existingId ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
      'Content-Length': String(bodyBuf.length),
    },
    body: bodyBuf,
  });

  if (res.status === 403) {
    return { ok: false, readonly: true };
  }
  if (!res.ok) {
    const errTxt = await res.text().catch(() => '');
    return { ok: false, error: `Upload Drive échoué (${res.status}): ${errTxt.slice(0, 150)}` };
  }
  const uploaded = await res.json();
  return { ok: true, fileId: uploaded.id };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const sa = parseServiceAccount();
  if (!sa) {
    return res.status(503).json({ ok: false, error: 'Google Drive Service Account non configuré.' });
  }

  try {
    const token = await getDriveRwToken(sa);

    // GET /api/drive-storage?fileId=<driveFileId> -> Stream cover image directly from user's Google Drive!
    if (req.method === 'GET') {
      const fileId = typeof req.query?.fileId === 'string' ? req.query.fileId.trim() : '';
      if (!fileId || !/^[a-zA-Z0-9_-]{8,120}$/.test(fileId)) {
        return res.status(400).json({ ok: false, error: 'fileId invalide' });
      }
      const mediaRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          fileId
        )}?alt=media&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!mediaRes.ok) {
        return res.status(mediaRes.status).end();
      }
      const contentType = mediaRes.headers.get('content-type') || 'image/webp';
      const arrBuf = await mediaRes.arrayBuffer();
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.status(200).send(Buffer.from(arrBuf));
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const verified = idToken ? await verifyFirebaseIdToken(idToken, sa.project_id) : null;
    if (!verified?.sub) {
      return res.status(401).json({ ok: false, error: 'Authentification requise.' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const action = body.action;
    const rootFolderId = await resolveTargetRootFolderId(token, body.folderId);
    if (!rootFolderId) {
      return res.status(200).json({
        ok: false,
        readonly: true,
        error: 'Aucun dossier Google Drive connecté.',
      });
    }

    if (action === 'upload_cover') {
      const dataUrl = typeof body.dataUrl === 'string' ? body.dataUrl : '';
      const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
      if (!match) {
        return res.status(400).json({ ok: false, error: 'Image invalide.' });
      }
      const mimeType = match[1];
      const ext = mimeType.includes('webp') ? 'webp' : mimeType.includes('png') ? 'png' : 'jpg';
      const imgBuf = Buffer.from(match[2], 'base64');

      const dataFolder = await ensureSubFolder(token, rootFolderId, '_Rowav_Data');
      if (!dataFolder.ok) return res.status(200).json(dataFolder);

      const coversFolder = await ensureSubFolder(token, dataFolder.id, 'covers');
      if (!coversFolder.ok) return res.status(200).json(coversFolder);

      const safeName = `${String(body.name || `cover_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_')}.${ext}`;
      const up = await upsertMultipartFile(token, coversFolder.id, safeName, mimeType, imgBuf);
      if (!up.ok) return res.status(200).json(up);

      return res.status(200).json({
        ok: true,
        fileId: up.fileId,
        url: `/api/drive-storage?fileId=${encodeURIComponent(up.fileId)}`,
      });
    }

    if (action === 'sync_studio_data') {
      const dataFolder = await ensureSubFolder(token, rootFolderId, '_Rowav_Data');
      if (!dataFolder.ok) return res.status(200).json(dataFolder);

      const backupPayload = {
        version: 1,
        app: 'Rowav Music Studio',
        syncedAt: new Date().toISOString(),
        uid: verified.sub,
        profile: body.profile || {},
        musicProjects: Array.isArray(body.musicProjects) ? body.musicProjects : [],
        playlists: Array.isArray(body.playlists) ? body.playlists : [],
        lyricsFolders: Array.isArray(body.lyricsFolders) ? body.lyricsFolders : [],
        lyricsDocs: Array.isArray(body.lyricsDocs) ? body.lyricsDocs : [],
      };
      const jsonBuf = Buffer.from(JSON.stringify(backupPayload, null, 2), 'utf8');
      const upJson = await upsertMultipartFile(
        token,
        dataFolder.id,
        'rowav_studio_backup.json',
        'application/json',
        jsonBuf
      );
      if (!upJson.ok) return res.status(200).json(upJson);

      return res.status(200).json({
        ok: true,
        fileId: upJson.fileId,
        syncedAt: backupPayload.syncedAt,
      });
    }

    if (action === 'load_studio_data') {
      const dataFolder = await ensureSubFolder(token, rootFolderId, '_Rowav_Data');
      if (!dataFolder.ok) return res.status(200).json(dataFolder);

      const q = encodeURIComponent(
        `'${dataFolder.id}' in parents and name='rowav_studio_backup.json' and trashed=false`
      );
      const searchRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!searchRes.ok) return res.status(200).json({ ok: false, found: false });
      const searchData = await searchRes.json();
      const fileId = searchData.files?.[0]?.id;
      if (!fileId) return res.status(200).json({ ok: true, found: false });

      const mediaRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          fileId
        )}?alt=media&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!mediaRes.ok) return res.status(200).json({ ok: false, found: false });
      const parsed = await mediaRes.json();
      return res.status(200).json({ ok: true, found: true, data: parsed });
    }

    return res.status(400).json({ ok: false, error: `Action inconnue : ${action}` });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || 'Erreur Drive Storage',
    });
  }
}
