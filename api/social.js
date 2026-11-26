import crypto from 'node:crypto';

let cachedDatastoreToken = null;
let cachedDatastoreExpiryMs = 0;

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

async function getDatastoreToken(sa) {
  const now = Date.now();
  if (cachedDatastoreToken && now < cachedDatastoreExpiryMs - 60_000) {
    return cachedDatastoreToken;
  }
  const iat = Math.floor(now / 1000);
  const exp = iat + 3600;
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claim = Buffer.from(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/datastore',
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
    throw new Error(`OAuth token error (${tokenRes.status}): ${errText.slice(0, 200)}`);
  }
  const data = await tokenRes.json();
  cachedDatastoreToken = data.access_token;
  cachedDatastoreExpiryMs = now + (Number(data.expires_in) || 3600) * 1000;
  return cachedDatastoreToken;
}

function signShareToken(sa, ownerUid, kind, itemId) {
  const payload = Buffer.from(
    JSON.stringify({ u: ownerUid, k: kind, i: itemId })
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', sa.private_key)
    .update(payload)
    .digest('base64url')
    .slice(0, 28);
  return `${payload}.${sig}`;
}

function fromFirestoreValue(val) {
  if (!val || typeof val !== 'object') return undefined;
  if ('nullValue' in val) return null;
  if ('booleanValue' in val) return Boolean(val.booleanValue);
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('stringValue' in val) return String(val.stringValue);
  if ('timestampValue' in val) return String(val.timestampValue);
  if ('arrayValue' in val) {
    const values = val.arrayValue?.values;
    return Array.isArray(values) ? values.map(fromFirestoreValue) : [];
  }
  if ('mapValue' in val) {
    const fields = val.mapValue?.fields || {};
    const out = {};
    for (const [k, v] of Object.entries(fields)) {
      out[k] = fromFirestoreValue(v);
    }
    return out;
  }
  return undefined;
}

function toFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return { integerValue: '0' };
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (typeof val === 'string') return { stringValue: val };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map((item) => toFirestoreValue(item)) } };
  }
  if (typeof val === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) {
        fields[k] = toFirestoreValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

const DEMO_ARTIST_UIDS = new Set(['artist_nox', 'artist_sora', 'artist_leo', 'artist_kairo']);

function createEmptyHub() {
  return {
    profiles: {},
    projects: [],
    messages: [],
    updatedAt: Date.now(),
  };
}

function stripLegacyDemoData(hub) {
  const rawProfiles = hub.profiles && typeof hub.profiles === 'object' ? hub.profiles : {};
  const cleanProfiles = {};
  for (const [uid, prof] of Object.entries(rawProfiles)) {
    if (DEMO_ARTIST_UIDS.has(uid)) continue;
    cleanProfiles[uid] = {
      ...prof,
      followersIds: Array.isArray(prof?.followersIds)
        ? prof.followersIds.filter((id) => !DEMO_ARTIST_UIDS.has(id))
        : [],
      followingIds: Array.isArray(prof?.followingIds)
        ? prof.followingIds.filter((id) => !DEMO_ARTIST_UIDS.has(id))
        : [],
    };
  }
  const cleanProjects = (Array.isArray(hub.projects) ? hub.projects : []).filter(
    (p) =>
      p &&
      !DEMO_ARTIST_UIDS.has(p.ownerUid) &&
      !(typeof p.sourceProjectId === 'string' && p.sourceProjectId.startsWith('demo_'))
  );
  const cleanMessages = (Array.isArray(hub.messages) ? hub.messages : []).filter(
    (m) => m && !DEMO_ARTIST_UIDS.has(m.fromUid) && !DEMO_ARTIST_UIDS.has(m.toUid)
  );
  return {
    profiles: cleanProfiles,
    projects: cleanProjects,
    messages: cleanMessages,
    updatedAt: hub.updatedAt || Date.now(),
  };
}

async function loadHubDoc(projectId, dsToken) {
  const docUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/(default)/documents/social_hub/global_v1`;
  const res = await fetch(docUrl, {
    headers: { Authorization: `Bearer ${dsToken}` },
  });
  if (res.status === 404) {
    const initial = createEmptyHub();
    await saveHubDoc(projectId, dsToken, initial);
    return initial;
  }
  if (!res.ok) {
    return createEmptyHub();
  }
  const docJson = await res.json();
  const parsed = fromFirestoreValue({ mapValue: { fields: docJson.fields || {} } }) || {};
  return stripLegacyDemoData(parsed);
}

async function saveHubDoc(projectId, dsToken, hubData) {
  const docUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/(default)/documents/social_hub/global_v1`;
  const fields = toFirestoreValue({
    ...hubData,
    updatedAt: Date.now(),
  }).mapValue.fields;
  await fetch(docUrl, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${dsToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
}

function formatHubForViewer(hub, viewerUid) {
  const rawProfiles = hub.profiles || {};
  const rawProjects = Array.isArray(hub.projects) ? hub.projects : [];
  const rawMessages = Array.isArray(hub.messages) ? hub.messages : [];

  const formattedProjects = rawProjects.map((proj) => {
    const likedByUids = Array.isArray(proj.likedByUids) ? proj.likedByUids : [];
    const tracks = (Array.isArray(proj.tracks) ? proj.tracks : []).map((trk) => {
      const tLikes = Array.isArray(trk.likedByUids) ? trk.likedByUids : [];
      const ratingsMap = trk.ratingsByUid && typeof trk.ratingsByUid === 'object' ? trk.ratingsByUid : {};
      const ratingVals = Object.values(ratingsMap).filter((v) => typeof v === 'number' && v >= 1 && v <= 10);
      const ratingAvg =
        ratingVals.length > 0
          ? Math.round((ratingVals.reduce((a, b) => a + b, 0) / ratingVals.length) * 10) / 10
          : 0;
      const myRating =
        viewerUid && typeof ratingsMap[viewerUid] === 'number' ? ratingsMap[viewerUid] : undefined;

      return {
        id: trk.id,
        ownerUid: trk.ownerUid || proj.ownerUid,
        ownerName: trk.ownerName || proj.ownerName,
        ownerAvatarUrl: trk.ownerAvatarUrl || proj.ownerAvatarUrl,
        projectId: proj.id,
        projectTitle: proj.title,
        title: trk.title,
        artist: trk.artist || proj.ownerName,
        versionLabel: trk.versionLabel,
        coverUrl: trk.coverUrl || proj.coverUrl,
        coverGradient: trk.coverGradient || proj.coverGradient || 'sunset',
        audioUrl: trk.audioUrl,
        durationSec: trk.durationSec || 160,
        bpm: trk.bpm,
        mood: trk.mood,
        likesCount: tLikes.length,
        likedByMe: Boolean(viewerUid && tLikes.includes(viewerUid)),
        ratingAvg,
        ratingCount: ratingVals.length,
        myRating,
        publishedAt: trk.publishedAt || proj.publishedAt,
      };
    });

    return {
      id: proj.id,
      sourceProjectId: proj.sourceProjectId,
      ownerUid: proj.ownerUid,
      ownerName: proj.ownerName,
      ownerAvatarUrl: proj.ownerAvatarUrl,
      title: proj.title,
      kind: proj.kind || 'ep',
      description: proj.description,
      coverUrl: proj.coverUrl,
      coverGradient: proj.coverGradient || 'sunset',
      releaseDate: proj.releaseDate,
      tracks,
      likesCount: likedByUids.length,
      likedByMe: Boolean(viewerUid && likedByUids.includes(viewerUid)),
      publishedAt: proj.publishedAt,
    };
  });

  // Compute live artist stats from projects & tracks
  const formattedProfiles = Object.values(rawProfiles).map((p) => {
    const artistProjects = formattedProjects.filter((pr) => pr.ownerUid === p.uid);
    const artistTracks = artistProjects.flatMap((pr) => pr.tracks);
    const totalTrackLikes = artistTracks.reduce((acc, t) => acc + (t.likesCount || 0), 0);
    const totalProjLikes = artistProjects.reduce((acc, pr) => acc + (pr.likesCount || 0), 0);
    const ratedTracks = artistTracks.filter((t) => (t.ratingCount || 0) > 0);
    const totalRatingPoints = ratedTracks.reduce(
      (acc, t) => acc + (t.ratingAvg || 0) * (t.ratingCount || 0),
      0
    );
    const totalRatingsCount = ratedTracks.reduce((acc, t) => acc + (t.ratingCount || 0), 0);
    const averageRating =
      totalRatingsCount > 0 ? Math.round((totalRatingPoints / totalRatingsCount) * 10) / 10 : 0;

    const followersIds = Array.isArray(p.followersIds) ? p.followersIds : [];
    const followingIds = Array.isArray(p.followingIds) ? p.followingIds : [];

    return {
      uid: p.uid,
      name: p.name || 'Artiste Rowav',
      handle: p.handle || `@${String(p.name || 'artiste').toLowerCase().replace(/[^a-z0-9]/g, '')}`,
      bio: p.bio || 'Producteur & Artiste sur Rowav Studio.',
      avatarUrl: p.avatarUrl,
      coverGradient: p.coverGradient || 'sunset',
      location: p.location || 'Studio',
      genres: Array.isArray(p.genres) ? p.genres : ['Music Studio'],
      followersCount: followersIds.length,
      followingCount: followingIds.length,
      isFollowedByMe: Boolean(viewerUid && followersIds.includes(viewerUid)),
      totalLikes: totalTrackLikes + totalProjLikes,
      averageRating,
      ratingsCount: totalRatingsCount,
      projectsCount: artistProjects.length,
      tracksCount: artistTracks.length,
      updatedAt: p.updatedAt || new Date().toISOString(),
    };
  });

  const myMessages = viewerUid
    ? rawMessages.filter((m) => m.fromUid === viewerUid || m.toUid === viewerUid)
    : [];

  return {
    profiles: formattedProfiles,
    projects: formattedProjects,
    messages: myMessages,
  };
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
    return res.status(503).json({ ok: false, error: 'Service Account non configuré.' });
  }

  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const verified = idToken ? await verifyFirebaseIdToken(idToken, sa.project_id) : null;
  const viewerUid = verified?.sub || null;

  try {
    const dsToken = await getDatastoreToken(sa);
    const hub = await loadHubDoc(sa.project_id, dsToken);

    if (req.method === 'GET') {
      return res.status(200).json({
        ok: true,
        ...formatHubForViewer(hub, viewerUid),
      });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    if (!viewerUid) {
      return res.status(401).json({ ok: false, error: 'Authentification requise.' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const action = body.action;
    const nowIso = new Date().toISOString();

    // Ensure caller's profile exists in hub.profiles
    const callerName =
      String(body.userName || verified?.name || verified?.email?.split('@')[0] || 'Artiste').trim();
    if (!hub.profiles[viewerUid]) {
      hub.profiles[viewerUid] = {
        uid: viewerUid,
        name: callerName,
        handle: `@${callerName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'artiste'}`,
        bio: String(body.userBio || 'Artiste & Producteur sur Rowav Music Studio.').trim(),
        avatarUrl: body.userAvatarUrl || verified?.picture || undefined,
        coverGradient: body.coverGradient || 'sunset',
        location: body.location || 'Rowav Studio',
        genres: Array.isArray(body.genres) ? body.genres : ['Studio', 'Production'],
        followersIds: [],
        followingIds: [],
        updatedAt: nowIso,
      };
    }

    if (action === 'sync_profile') {
      const existing = hub.profiles[viewerUid];
      hub.profiles[viewerUid] = {
        ...existing,
        name: String(body.name || existing.name).trim().slice(0, 80),
        handle: String(
          body.handle ||
            existing.handle ||
            `@${String(body.name || existing.name).toLowerCase().replace(/[^a-z0-9]/g, '')}`
        )
          .trim()
          .slice(0, 60),
        bio:
          body.bio !== undefined
            ? String(body.bio).trim().slice(0, 400)
            : existing.bio,
        location:
          body.location !== undefined
            ? String(body.location).trim().slice(0, 80)
            : existing.location,
        avatarUrl: body.avatarUrl !== undefined ? body.avatarUrl : existing.avatarUrl,
        coverGradient: body.coverGradient || existing.coverGradient || 'sunset',
        genres: Array.isArray(body.genres) ? body.genres.slice(0, 6) : existing.genres,
        updatedAt: nowIso,
      };
      // Mirror updated avatar & artist name onto all existing published projects/tracks of this user!
      if (body.avatarUrl !== undefined || body.name) {
        const nextAvatar = hub.profiles[viewerUid].avatarUrl;
        const nextOwnerName = hub.profiles[viewerUid].name;
        hub.projects = (hub.projects || []).map((proj) => {
          if (proj.ownerUid !== viewerUid) return proj;
          return {
            ...proj,
            ownerName: nextOwnerName,
            ownerAvatarUrl: nextAvatar,
            tracks: (proj.tracks || []).map((t) => ({
              ...t,
              ownerName: nextOwnerName,
              ownerAvatarUrl: nextAvatar,
            })),
          };
        });
      }
      await saveHubDoc(sa.project_id, dsToken, hub);
      return res.status(200).json({
        ok: true,
        ...formatHubForViewer(hub, viewerUid),
      });
    }

    if (action === 'publish_project') {
      const proj = body.project;
      if (!proj || !proj.title) {
        return res.status(400).json({ ok: false, error: 'Données du projet manquantes.' });
      }
      const socialProjId = `sproj_${viewerUid.slice(0, 10)}_${proj.id}`;
      const existingIdx = hub.projects.findIndex(
        (p) => p.id === socialProjId || (p.ownerUid === viewerUid && p.sourceProjectId === proj.id)
      );
      const existingProj = existingIdx >= 0 ? hub.projects[existingIdx] : null;
      const existingTracksById = new Map(
        (existingProj?.tracks || []).map((t) => [t.id, t])
      );

      const tracks = (Array.isArray(proj.tracks) ? proj.tracks : []).map((t) => {
        const socialTrackId = `strk_${viewerUid.slice(0, 8)}_${t.id}`;
        const prevTrack = existingTracksById.get(socialTrackId);
        // Generate signed /api/share stream token for this track so any user can play it!
        const shareToken = signShareToken(sa, viewerUid, 'track', t.id);
        const signedAudioUrl = `/api/share?token=${encodeURIComponent(shareToken)}&stream=${encodeURIComponent(t.id)}`;

        return {
          id: socialTrackId,
          sourceTrackId: t.id,
          ownerUid: viewerUid,
          ownerName: hub.profiles[viewerUid].name,
          ownerAvatarUrl: hub.profiles[viewerUid].avatarUrl,
          projectId: socialProjId,
          projectTitle: String(proj.title).trim().slice(0, 120),
          title: String(t.title || 'Sans titre').trim().slice(0, 120),
          artist: String(t.artist || hub.profiles[viewerUid].name).trim().slice(0, 100),
          versionLabel: t.versionLabel ? String(t.versionLabel).slice(0, 40) : undefined,
          coverUrl:
            t.coverUrl && !String(t.coverUrl).startsWith('data:')
              ? t.coverUrl
              : `/api/cover?uid=${encodeURIComponent(viewerUid)}&key=${encodeURIComponent(`track_${t.id}`)}`,
          coverGradient: t.coverGradient || proj.coverGradient || 'sunset',
          audioUrl: signedAudioUrl,
          durationSec: Number(t.durationSec) || 150,
          bpm: t.bpm ? Number(t.bpm) : undefined,
          mood: t.mood || undefined,
          likedByUids: prevTrack?.likedByUids || [],
          ratingsByUid: prevTrack?.ratingsByUid || {},
          publishedAt: prevTrack?.publishedAt || nowIso,
        };
      });

      const nextSocialProject = {
        id: socialProjId,
        sourceProjectId: proj.id,
        ownerUid: viewerUid,
        ownerName: hub.profiles[viewerUid].name,
        ownerAvatarUrl: hub.profiles[viewerUid].avatarUrl,
        title: String(proj.title).trim().slice(0, 120),
        kind: proj.kind || 'ep',
        description: proj.description ? String(proj.description).trim().slice(0, 500) : '',
        coverUrl:
          proj.coverUrl && !String(proj.coverUrl).startsWith('data:')
            ? proj.coverUrl
            : `/api/cover?uid=${encodeURIComponent(viewerUid)}&key=${encodeURIComponent(`proj_${proj.id}`)}`,
        coverGradient: proj.coverGradient || 'sunset',
        releaseDate: proj.releaseDate || nowIso.slice(0, 10),
        tracks,
        likedByUids: existingProj?.likedByUids || [],
        publishedAt: existingProj?.publishedAt || nowIso,
      };

      if (existingIdx >= 0) {
        hub.projects[existingIdx] = nextSocialProject;
      } else {
        hub.projects.unshift(nextSocialProject);
      }

      await saveHubDoc(sa.project_id, dsToken, hub);
      return res.status(200).json({
        ok: true,
        publishedProjectId: socialProjId,
        ...formatHubForViewer(hub, viewerUid),
      });
    }

    if (action === 'unpublish_project') {
      const targetId = String(body.projectId || '');
      hub.projects = hub.projects.filter(
        (p) =>
          !(
            p.ownerUid === viewerUid &&
            (p.id === targetId || p.sourceProjectId === targetId)
          )
      );
      await saveHubDoc(sa.project_id, dsToken, hub);
      return res.status(200).json({
        ok: true,
        ...formatHubForViewer(hub, viewerUid),
      });
    }

    if (action === 'toggle_like_track') {
      const trackId = String(body.trackId || '');
      let toggledTrack = null;
      let isNowLiked = false;

      for (const proj of hub.projects) {
        if (!Array.isArray(proj.tracks)) continue;
        for (const trk of proj.tracks) {
          if (trk.id === trackId) {
            const likes = Array.isArray(trk.likedByUids) ? trk.likedByUids : [];
            if (likes.includes(viewerUid)) {
              trk.likedByUids = likes.filter((u) => u !== viewerUid);
              isNowLiked = false;
            } else {
              trk.likedByUids = [...likes, viewerUid];
              isNowLiked = true;
            }
            toggledTrack = trk;
            break;
          }
        }
      }

      if (toggledTrack) {
        await saveHubDoc(sa.project_id, dsToken, hub);
      }
      return res.status(200).json({
        ok: true,
        liked: isNowLiked,
        ...formatHubForViewer(hub, viewerUid),
      });
    }

    if (action === 'toggle_like_project') {
      const projectId = String(body.projectId || '');
      for (const proj of hub.projects) {
        if (proj.id === projectId) {
          const likes = Array.isArray(proj.likedByUids) ? proj.likedByUids : [];
          proj.likedByUids = likes.includes(viewerUid)
            ? likes.filter((u) => u !== viewerUid)
            : [...likes, viewerUid];
          break;
        }
      }
      await saveHubDoc(sa.project_id, dsToken, hub);
      return res.status(200).json({
        ok: true,
        ...formatHubForViewer(hub, viewerUid),
      });
    }

    if (action === 'rate_track') {
      const trackId = String(body.trackId || '');
      const rating = Math.max(1, Math.min(10, Math.round(Number(body.rating) || 8)));
      for (const proj of hub.projects) {
        if (!Array.isArray(proj.tracks)) continue;
        for (const trk of proj.tracks) {
          if (trk.id === trackId) {
            const map =
              trk.ratingsByUid && typeof trk.ratingsByUid === 'object' ? trk.ratingsByUid : {};
            map[viewerUid] = rating;
            trk.ratingsByUid = map;
            break;
          }
        }
      }
      await saveHubDoc(sa.project_id, dsToken, hub);
      return res.status(200).json({
        ok: true,
        ...formatHubForViewer(hub, viewerUid),
      });
    }

    if (action === 'toggle_follow') {
      const targetUid = String(body.targetUid || '');
      if (!targetUid || targetUid === viewerUid || !hub.profiles[targetUid]) {
        return res.status(400).json({ ok: false, error: 'Profil cible invalide.' });
      }
      const targetProfile = hub.profiles[targetUid];
      const myProfile = hub.profiles[viewerUid];
      const followers = Array.isArray(targetProfile.followersIds) ? targetProfile.followersIds : [];
      const following = Array.isArray(myProfile.followingIds) ? myProfile.followingIds : [];

      const alreadyFollowing = followers.includes(viewerUid);
      targetProfile.followersIds = alreadyFollowing
        ? followers.filter((u) => u !== viewerUid)
        : [...followers, viewerUid];
      myProfile.followingIds = alreadyFollowing
        ? following.filter((u) => u !== targetUid)
        : [...new Set([...following, targetUid])];

      await saveHubDoc(sa.project_id, dsToken, hub);
      return res.status(200).json({
        ok: true,
        followed: !alreadyFollowing,
        ...formatHubForViewer(hub, viewerUid),
      });
    }

    if (action === 'send_message') {
      const toUid = String(body.toUid || '');
      const text = String(body.text || '').trim().slice(0, 1000);
      if (!toUid || !text) {
        return res.status(400).json({ ok: false, error: 'Destinataire et message requis.' });
      }
      const targetProfile = hub.profiles[toUid] || { uid: toUid, name: 'Artiste' };
      const myProfile = hub.profiles[viewerUid];
      const msg = {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        fromUid: viewerUid,
        fromName: myProfile.name,
        fromAvatarUrl: myProfile.avatarUrl,
        toUid,
        toName: targetProfile.name,
        text,
        createdAt: nowIso,
      };
      hub.messages = [...(Array.isArray(hub.messages) ? hub.messages : []), msg].slice(-400);

      await saveHubDoc(sa.project_id, dsToken, hub);
      return res.status(200).json({
        ok: true,
        ...formatHubForViewer(hub, viewerUid),
      });
    }

    return res.status(400).json({ ok: false, error: `Action inconnue : ${action}` });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || 'Erreur serveur Rowav Social',
    });
  }
}
