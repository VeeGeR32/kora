import crypto from 'node:crypto';

let cachedDriveRwToken = null;
let cachedDriveRwExpiryMs = 0;

function parseServiceAccount() {
  const rawJson =
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
  if (rawJson && rawJson.trim()) {
    try {
      const trimmed = rawJson.trim();
      const parsed = trimmed.startsWith('{')
        ? JSON.parse(trimmed)
        : JSON.parse(Buffer.from(trimmed, 'base64').toString('utf8'));
      if (parsed.client_email && parsed.private_key) {
        return {
          client_email: parsed.client_email,
          private_key: String(parsed.private_key).replace(/\\n/g, '\n'),
          project_id: parsed.project_id || process.env.VITE_FIREBASE_PROJECT_ID || 'kora-d6019',
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
      project_id: process.env.VITE_FIREBASE_PROJECT_ID || 'kora-d6019',
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

function classifyDriveError(status, rawText) {
  const txt = String(rawText || '');
  const lower = txt.toLowerCase();
  if (
    lower.includes('storagequotaexceeded') ||
    lower.includes('do not have storage quota') ||
    lower.includes('storage quota')
  ) {
    return {
      ok: false,
      needsUserOAuth: true,
      error:
        'Autorise ton compte Google 1 seule fois pour créer le dossier _Rowav_Data à la racine de ton Google Drive (sur ton propre quota).',
    };
  }
  if (status === 401) {
    return {
      ok: false,
      tokenExpired: true,
      needsUserOAuth: true,
      error: 'Session Google Drive expirée. Clique pour réautoriser.',
    };
  }
  if (status === 403) {
    return {
      ok: false,
      readonly: true,
      error: 'Accès en écriture refusé sur Google Drive.',
    };
  }
  return {
    ok: false,
    error: `Erreur Google Drive (${status}): ${txt.slice(0, 160)}`,
  };
}

/**
 * Safely trashes accidental nested empty `_Rowav_Data` folders that were owned by the Service Account
 * (from an earlier bug where `root` resolved to the most recently modified subfolder).
 * NEVER touches user-owned folders or any folder containing audio files.
 */
async function cleanupAccidentalSaRowavFolders(saToken) {
  try {
    const q = encodeURIComponent(
      "'me' in owners and name='_Rowav_Data' and mimeType='application/vnd.google-apps.folder' and trashed=false"
    );
    const listRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`,
      { headers: { Authorization: `Bearer ${saToken}` } }
    );
    if (!listRes.ok) return 0;
    const data = await listRes.json();
    const folders = Array.isArray(data.files) ? data.files : [];
    if (folders.length === 0) return 0;

    let trashed = 0;
    for (const f of folders) {
      // Safety check: ensure no audio file lives inside this folder before trashing
      const audioQ = encodeURIComponent(
        `'${f.id}' in parents and (mimeType contains 'audio/' or name contains '.mp3' or name contains '.wav') and trashed=false`
      );
      const checkRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${audioQ}&fields=files(id)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true`,
        { headers: { Authorization: `Bearer ${saToken}` } }
      );
      if (checkRes.ok) {
        const checkData = await checkRes.json();
        if (Array.isArray(checkData.files) && checkData.files.length > 0) {
          continue;
        }
      }
      const delRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(f.id)}?supportsAllDrives=true`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${saToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ trashed: true }),
        }
      );
      if (delRes.ok) trashed++;
    }
    if (trashed > 0) {
      console.log(`[drive-storage] Cleaned up ${trashed} accidental Service-Account _Rowav_Data folder(s).`);
    }
    return trashed;
  } catch {
    return 0;
  }
}

/**
 * Resolves the TRUE top-level shared music folder owned by the current user (e.g. "Mon Drive > musique"),
 * NEVER a nested subfolder (like "25/26/vers le ciel"), NEVER "_Rowav_Data", and NEVER another user's
 * shared folder (e.g. "Partagés avec moi > musique").
 */
async function resolveTrueSharedMusicFolderId(saToken, requestedFolderId, userEmail) {
  if (requestedFolderId && requestedFolderId !== 'root') {
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        requestedFolderId
      )}?fields=id,name,trashed&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${saToken}` } }
    );
    if (metaRes.ok) {
      const meta = await metaRes.json();
      if (meta?.id && !meta.trashed && meta.name !== '_Rowav_Data' && meta.name !== 'covers') {
        return meta.id;
      }
    }
  }

  const q = encodeURIComponent(
    "sharedWithMe=true and mimeType='application/vnd.google-apps.folder' and trashed=false and name != '_Rowav_Data' and name != 'covers'"
  );
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,owners(emailAddress),capabilities(canAddChildren))&pageSize=50&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${saToken}` } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const files = Array.isArray(data.files) ? data.files : [];
  const normalizedEmail = typeof userEmail === 'string' ? userEmail.trim().toLowerCase() : '';

  // 1. Strongly prefer folders OWNED by the authenticated user (prevents picking someone else's "Partagés avec moi > musique"!)
  if (normalizedEmail) {
    const ownedByUser = files.filter(
      (f) =>
        Array.isArray(f.owners) &&
        f.owners.some((o) => String(o?.emailAddress || '').toLowerCase() === normalizedEmail)
    );
    if (ownedByUser.length > 0) {
      const exactMusic = ownedByUser.find(
        (f) => f.capabilities?.canAddChildren && String(f.name || '').trim().toLowerCase() === 'musique'
      );
      const ownedWritable = ownedByUser.find((f) => f.capabilities?.canAddChildren);
      return exactMusic?.id || ownedWritable?.id || ownedByUser[0].id;
    }
  }

  const writable = files.find((f) => f.capabilities?.canAddChildren);
  return writable?.id || files[0]?.id || null;
}

/**
 * Ensures ONE single `_Rowav_Data` folder directly at the root of the user's shared music folder
 * (e.g. `Mon Drive > musique > _Rowav_Data`), owned by the user (using their personal 15 Go / 5 To quota).
 * NEVER creates `_Rowav_Data` in a subfolder or inside another `_Rowav_Data`.
 */
async function ensureUserRowavDataFolder(userToken, saToken, saEmail, requestedFolderId, userEmail) {
  const musicRootId = await resolveTrueSharedMusicFolderId(saToken, requestedFolderId, userEmail);
  const targetParentId = musicRootId || 'root';

  // 1. Search ONLY directly inside `targetParentId` (e.g. `musique/`)
  let folderId = null;
  const q = encodeURIComponent(
    `'${targetParentId}' in parents and name='_Rowav_Data' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&orderBy=createdTime%20asc&pageSize=5&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${userToken}` } }
  );
  if (searchRes.status === 401) {
    const txt = await searchRes.text().catch(() => '');
    return classifyDriveError(401, txt);
  }
  if (searchRes.ok) {
    const searchData = await searchRes.json();
    folderId = searchData.files?.[0]?.id || null;
  }

  // 2. Create ONE `_Rowav_Data` directly inside `musique/` if not found
  if (!folderId) {
    const createRes = await fetch(
      'https://www.googleapis.com/drive/v3/files?fields=id&supportsAllDrives=true',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: '_Rowav_Data',
          mimeType: 'application/vnd.google-apps.folder',
          parents: [targetParentId],
        }),
      }
    );
    if (!createRes.ok) {
      const txt = await createRes.text().catch(() => '');
      console.error(
        `[drive-storage] create _Rowav_Data inside ${targetParentId} failed (${createRes.status}):`,
        txt.slice(0, 300)
      );
      return classifyDriveError(createRes.status, txt);
    }
    const created = await createRes.json();
    folderId = created.id;
  }

  // 3. Ensure Service Account has Editor permission on `_Rowav_Data` for permanent silent PATCHes & cover GETs
  if (folderId && saEmail) {
    await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        folderId
      )}/permissions?sendNotificationEmail=false&supportsAllDrives=true`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          role: 'writer',
          type: 'user',
          emailAddress: saEmail,
        }),
      }
    ).catch(() => {
      // Non-fatal if permission already inherited/present
    });
  }

  return { ok: true, id: folderId };
}

/**
 * Finds an EXISTING user-owned `_Rowav_Data` folder directly inside the user's shared music folder
 * (e.g. `Mon Drive > musique > _Rowav_Data`). NEVER creates a Service-Account-owned `_Rowav_Data` folder.
 */
async function findExistingSharedUserRowavFolder(saToken, requestedFolderId, userEmail) {
  const musicRootId = await resolveTrueSharedMusicFolderId(saToken, requestedFolderId, userEmail);
  if (!musicRootId) return null;

  const inMusicQ = encodeURIComponent(
    `'${musicRootId}' in parents and name='_Rowav_Data' and mimeType='application/vnd.google-apps.folder' and trashed=false and not 'me' in owners`
  );
  const inMusicRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${inMusicQ}&fields=files(id,name)&orderBy=createdTime%20asc&pageSize=5&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${saToken}` } }
  );
  if (!inMusicRes.ok) return null;
  const inMusicData = await inMusicRes.json();
  return inMusicData.files?.[0]?.id || null;
}

async function ensureSubFolder(token, parentId, name) {
  // Hard anti-recursion guard: never create `_Rowav_Data` inside `_Rowav_Data`!
  if (name === '_Rowav_Data') {
    const parentRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(parentId)}?fields=id,name&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (parentRes.ok) {
      const p = await parentRes.json();
      if (p?.name === '_Rowav_Data') {
        return { ok: true, id: p.id };
      }
    }
  }

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
  } else if (searchRes.status === 401) {
    const txt = await searchRes.text().catch(() => '');
    return classifyDriveError(401, txt);
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
  if (!createRes.ok) {
    const txt = await createRes.text().catch(() => '');
    console.error(`[drive-storage] ensureSubFolder(${name}) failed (${createRes.status}):`, txt.slice(0, 300));
    return classifyDriveError(createRes.status, txt);
  }
  const created = await createRes.json();
  return { ok: true, id: created.id };
}

async function upsertMultipartFile(token, parentId, fileName, mimeType, buffer, allowCreate = true) {
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
  } else if (searchRes.status === 401) {
    const txt = await searchRes.text().catch(() => '');
    return classifyDriveError(401, txt);
  }

  if (!existingId && !allowCreate) {
    return {
      ok: false,
      needsUserOAuth: true,
      error:
        'Autorise ton compte Google 1 seule fois pour initialiser _Rowav_Data à la racine de ton Google Drive.',
    };
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

  if (!res.ok) {
    const errTxt = await res.text().catch(() => '');
    console.error(`[drive-storage] upsertMultipartFile(${fileName}) failed (${res.status}):`, errTxt.slice(0, 300));
    return classifyDriveError(res.status, errTxt);
  }
  const uploaded = await res.json();
  return { ok: true, fileId: uploaded.id };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Google-Drive-Token');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const sa = parseServiceAccount();
  if (!sa) {
    return res.status(503).json({ ok: false, error: 'Google Drive Service Account non configuré.' });
  }

  try {
    const saToken = await getDriveRwToken(sa);

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
        { headers: { Authorization: `Bearer ${saToken}` } }
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
    const rawUserDriveToken =
      (typeof body.userDriveToken === 'string' && body.userDriveToken.trim()) ||
      (typeof req.headers['x-google-drive-token'] === 'string' &&
        req.headers['x-google-drive-token'].trim()) ||
      '';

    // Always clean up any accidental empty Service-Account `_Rowav_Data` folders first!
    const cleanedCount = await cleanupAccidentalSaRowavFolders(saToken);

    if (action === 'upload_cover') {
      const dataUrl = typeof body.dataUrl === 'string' ? body.dataUrl : '';
      const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
      if (!match) {
        return res.status(400).json({ ok: false, error: 'Image invalide.' });
      }
      if (!rawUserDriveToken) {
        return res.status(200).json({
          ok: false,
          needsUserOAuth: true,
          error: 'Autorisation Google Drive requise pour créer une nouvelle pochette sur ton Drive.',
        });
      }
      const mimeType = match[1];
      const ext = mimeType.includes('webp') ? 'webp' : mimeType.includes('png') ? 'png' : 'jpg';
      const imgBuf = Buffer.from(match[2], 'base64');

      const dataFolder = await ensureUserRowavDataFolder(
        rawUserDriveToken,
        saToken,
        sa.client_email,
        body.folderId,
        verified.email
      );
      if (!dataFolder.ok) return res.status(200).json(dataFolder);

      const coversFolder = await ensureSubFolder(rawUserDriveToken, dataFolder.id, 'covers');
      if (!coversFolder.ok) return res.status(200).json(coversFolder);

      const safeName = `${String(body.name || `cover_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_')}.${ext}`;
      const up = await upsertMultipartFile(rawUserDriveToken, coversFolder.id, safeName, mimeType, imgBuf, true);
      if (!up.ok) return res.status(200).json(up);

      return res.status(200).json({
        ok: true,
        fileId: up.fileId,
        url: `/api/drive-storage?fileId=${encodeURIComponent(up.fileId)}`,
      });
    }

    if (action === 'sync_studio_data') {
      let dataFolderId = null;
      let activeToken = saToken;
      let allowCreate = false;

      if (rawUserDriveToken) {
        const ensured = await ensureUserRowavDataFolder(
          rawUserDriveToken,
          saToken,
          sa.client_email,
          body.folderId,
          verified.email
        );
        if (!ensured.ok) return res.status(200).json(ensured);
        dataFolderId = ensured.id;
        activeToken = rawUserDriveToken;
        allowCreate = true;
      } else {
        dataFolderId = await findExistingSharedUserRowavFolder(
          saToken,
          body.folderId,
          verified.email
        );
        if (!dataFolderId) {
          return res.status(200).json({
            ok: false,
            needsUserOAuth: true,
            cleanedCount,
            error:
              'Autorise ton compte Google 1 seule fois pour créer _Rowav_Data (ensuite les sauvegardes sont automatiques).',
          });
        }
      }

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
        activeToken,
        dataFolderId,
        'rowav_studio_backup.json',
        'application/json',
        jsonBuf,
        allowCreate
      );
      if (!upJson.ok) return res.status(200).json({ ...upJson, cleanedCount });

      return res.status(200).json({
        ok: true,
        fileId: upJson.fileId,
        syncedAt: backupPayload.syncedAt,
        cleanedCount,
      });
    }

    if (action === 'load_studio_data') {
      const dataFolderId = await findExistingSharedUserRowavFolder(
        saToken,
        body.folderId,
        verified.email
      );
      if (!dataFolderId) return res.status(200).json({ ok: true, found: false });

      const q = encodeURIComponent(
        `'${dataFolderId}' in parents and name='rowav_studio_backup.json' and trashed=false`
      );
      const searchRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true`,
        { headers: { Authorization: `Bearer ${saToken}` } }
      );
      if (!searchRes.ok) return res.status(200).json({ ok: false, found: false });
      const searchData = await searchRes.json();
      const fileId = searchData.files?.[0]?.id;
      if (!fileId) return res.status(200).json({ ok: true, found: false });

      const mediaRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          fileId
        )}?alt=media&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${saToken}` } }
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
