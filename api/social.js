import crypto from 'node:crypto';

let cachedDatastoreToken = null;
let cachedDatastoreExpiryMs = 0;

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

/**
 * Generates a warm, studio-quality 16-second stereo lo-fi synth & drum loop WAV
 * so seeded community tracks play immediately in MiniAudioPlayer with real waveform animation.
 */
function buildStudioDemoWavBuffer(seedStr) {
  const sampleRate = 22050;
  const durationSec = 14;
  const numSamples = sampleRate * durationSec;
  const numChannels = 1;
  const bytesPerSample = 2;
  const dataSize = numSamples * numChannels * bytesPerSample;
  const buf = Buffer.alloc(44 + dataSize);

  // WAV header
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28);
  buf.writeUInt16LE(numChannels * bytesPerSample, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) {
    hash = (hash * 31 + seedStr.charCodeAt(i)) >>> 0;
  }

  const progressions = [
    [220.0, 261.63, 196.0, 174.61], // Am - C - G - F
    [196.0, 233.08, 174.61, 146.83], // Gm - Bb - F - Dm
    [246.94, 293.66, 220.0, 196.0], // Bm - D - A - G
    [164.81, 196.0, 220.0, 146.83], // Em - G - Am - Dm
  ];
  const chords = progressions[hash % progressions.length];
  const bpm = 86 + (hash % 24);
  const beatDur = 60 / bpm;

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const barIdx = Math.floor(t / (beatDur * 2)) % chords.length;
    const root = chords[barIdx];
    const fifth = root * 1.4983;
    const third = root * 1.1892;

    // Warm electric piano / synth pad
    const env = 0.65 + 0.35 * Math.sin(2 * Math.PI * (0.5 / beatDur) * t);
    const pad =
      (Math.sin(2 * Math.PI * root * t) * 0.45 +
        Math.sin(2 * Math.PI * third * t) * 0.3 +
        Math.sin(2 * Math.PI * fifth * t) * 0.25) *
      env;

    // Subtle sub bass + kick pulse every beat
    const beatPhase = (t % beatDur) / beatDur;
    const kickFreq = 55 + 95 * Math.exp(-beatPhase * 18);
    const kickEnv = Math.exp(-beatPhase * 9);
    const kick = Math.sin(2 * Math.PI * kickFreq * beatPhase * beatDur) * kickEnv * 0.55;

    // Gentle hi-hat tick on half-beats
    const halfPhase = (t % (beatDur / 2)) / (beatDur / 2);
    const hatEnv = Math.exp(-halfPhase * 38);
    const noise = (((i * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 2;
    const hat = noise * hatEnv * 0.12;

    const sample = Math.max(-0.92, Math.min(0.92, (pad * 0.48 + kick + hat) * 0.78));
    buf.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
  }

  return buf;
}

function createInitialSeedHub() {
  const now = new Date().toISOString();
  const profiles = {
    artist_nox: {
      uid: 'artist_nox',
      name: 'Nox Studio',
      handle: '@nox.studio',
      bio: 'Producteur & Ingé son · Paris / Belleville · Synthés analogiques, boîtes à rythmes & textures nocturnes.',
      coverGradient: 'sunset',
      location: 'Paris, FR',
      genres: ['Cloud Rap', 'Synthwave', 'Alternative'],
      followersIds: ['artist_sora', 'artist_leo'],
      followingIds: ['artist_sora'],
      updatedAt: now,
    },
    artist_sora: {
      uid: 'artist_sora',
      name: 'Sora',
      handle: '@sora.wav',
      bio: 'Auteure-compositrice · R&B minimaliste,toplines nocturnes et harmonies vocales.',
      coverGradient: 'violet',
      location: 'Lyon, FR',
      genres: ['R&B', 'Neo-Soul', 'Lo-Fi'],
      followersIds: ['artist_nox', 'artist_leo', 'artist_kairo'],
      followingIds: ['artist_nox', 'artist_leo'],
      updatedAt: now,
    },
    artist_leo: {
      uid: 'artist_leo',
      name: 'Léo Vance',
      handle: '@leovance',
      bio: 'Beatmaker & Réalisateur artistique · 808 saturées, pianos feutrés et prises live.',
      coverGradient: 'ocean',
      location: 'Bruxelles, BE',
      genres: ['Rap FR', 'Melodic Trap', 'Boom Bap'],
      followersIds: ['artist_sora'],
      followingIds: ['artist_nox', 'artist_sora'],
      updatedAt: now,
    },
  };

  const projects = [
    {
      id: 'sproj_nox_1',
      sourceProjectId: 'demo_nox_1',
      ownerUid: 'artist_nox',
      ownerName: 'Nox Studio',
      title: 'LUMIÈRE NOIRE VOL. 2',
      kind: 'ep',
      description: '5 maquettes enregistrées de nuit entre janvier et mars. Mix analogique & basse Moog.',
      coverGradient: 'sunset',
      releaseDate: '2026-03-14',
      likedByUids: ['artist_sora', 'artist_leo'],
      publishedAt: '2026-03-14T21:30:00.000Z',
      tracks: [
        {
          id: 'strk_nox_1',
          ownerUid: 'artist_nox',
          ownerName: 'Nox Studio',
          projectId: 'sproj_nox_1',
          projectTitle: 'LUMIÈRE NOIRE VOL. 2',
          title: 'Périphérique 4h',
          artist: 'Nox Studio',
          versionLabel: 'v4 · Master',
          coverGradient: 'sunset',
          audioUrl: '/api/social?demoAudio=strk_nox_1',
          durationSec: 164,
          bpm: 128,
          mood: 'Sombre',
          likedByUids: ['artist_sora', 'artist_leo'],
          ratingsByUid: { artist_sora: 9, artist_leo: 9 },
          publishedAt: '2026-03-14T21:30:00.000Z',
        },
        {
          id: 'strk_nox_2',
          ownerUid: 'artist_nox',
          ownerName: 'Nox Studio',
          projectId: 'sproj_nox_1',
          projectTitle: 'LUMIÈRE NOIRE VOL. 2',
          title: 'Pluie sur Belleville',
          artist: 'Nox Studio feat. Sora',
          versionLabel: 'v3 · Mix',
          coverGradient: 'sunset',
          audioUrl: '/api/social?demoAudio=strk_nox_2',
          durationSec: 192,
          bpm: 94,
          mood: 'Mélancolique',
          likedByUids: ['artist_sora', 'artist_leo', 'artist_kairo'],
          ratingsByUid: { artist_sora: 10, artist_leo: 9 },
          publishedAt: '2026-03-14T21:30:00.000Z',
        },
        {
          id: 'strk_nox_3',
          ownerUid: 'artist_nox',
          ownerName: 'Nox Studio',
          projectId: 'sproj_nox_1',
          projectTitle: 'LUMIÈRE NOIRE VOL. 2',
          title: 'Cassette Fantôme',
          artist: 'Nox Studio',
          versionLabel: 'v2',
          coverGradient: 'amber',
          audioUrl: '/api/social?demoAudio=strk_nox_3',
          durationSec: 148,
          bpm: 118,
          mood: 'Planant',
          likedByUids: ['artist_sora'],
          ratingsByUid: { artist_sora: 8 },
          publishedAt: '2026-03-14T21:30:00.000Z',
        },
      ],
    },
    {
      id: 'sproj_sora_1',
      sourceProjectId: 'demo_sora_1',
      ownerUid: 'artist_sora',
      ownerName: 'Sora',
      title: 'HEURES BLEUES',
      kind: 'mixtape',
      description: 'Textures R&B intimistes, voix doublées au Neumann et Rhodes vintage.',
      coverGradient: 'violet',
      releaseDate: '2026-02-28',
      likedByUids: ['artist_nox', 'artist_leo'],
      publishedAt: '2026-02-28T19:00:00.000Z',
      tracks: [
        {
          id: 'strk_sora_1',
          ownerUid: 'artist_sora',
          ownerName: 'Sora',
          projectId: 'sproj_sora_1',
          projectTitle: 'HEURES BLEUES',
          title: 'Velours Minuit',
          artist: 'Sora',
          versionLabel: 'v5 · Final',
          coverGradient: 'violet',
          audioUrl: '/api/social?demoAudio=strk_sora_1',
          durationSec: 178,
          bpm: 88,
          mood: 'Planant',
          likedByUids: ['artist_nox', 'artist_leo'],
          ratingsByUid: { artist_nox: 9, artist_leo: 10 },
          publishedAt: '2026-02-28T19:00:00.000Z',
        },
        {
          id: 'strk_sora_2',
          ownerUid: 'artist_sora',
          ownerName: 'Sora',
          projectId: 'sproj_sora_1',
          projectTitle: 'HEURES BLEUES',
          title: 'Laisser Passer l’Orage',
          artist: 'Sora',
          versionLabel: 'v3',
          coverGradient: 'rose',
          audioUrl: '/api/social?demoAudio=strk_sora_2',
          durationSec: 204,
          bpm: 82,
          mood: 'Mélancolique',
          likedByUids: ['artist_nox'],
          ratingsByUid: { artist_nox: 9 },
          publishedAt: '2026-02-28T19:00:00.000Z',
        },
      ],
    },
    {
      id: 'sproj_leo_1',
      sourceProjectId: 'demo_leo_1',
      ownerUid: 'artist_leo',
      ownerName: 'Léo Vance',
      title: 'BÉTON & VELOURS',
      kind: 'album',
      description: 'Sélection de prods et morceaux enregistrés en session studio fermée.',
      coverGradient: 'ocean',
      releaseDate: '2026-01-20',
      likedByUids: ['artist_nox', 'artist_sora'],
      publishedAt: '2026-01-20T18:15:00.000Z',
      tracks: [
        {
          id: 'strk_leo_1',
          ownerUid: 'artist_leo',
          ownerName: 'Léo Vance',
          projectId: 'sproj_leo_1',
          projectTitle: 'BÉTON & VELOURS',
          title: 'Sans Retour',
          artist: 'Léo Vance',
          versionLabel: 'v6 · Master',
          coverGradient: 'ocean',
          audioUrl: '/api/social?demoAudio=strk_leo_1',
          durationSec: 156,
          bpm: 142,
          mood: 'Banger',
          likedByUids: ['artist_nox', 'artist_sora'],
          ratingsByUid: { artist_nox: 9, artist_sora: 8 },
          publishedAt: '2026-01-20T18:15:00.000Z',
        },
        {
          id: 'strk_leo_2',
          ownerUid: 'artist_leo',
          ownerName: 'Léo Vance',
          projectId: 'sproj_leo_1',
          projectTitle: 'BÉTON & VELOURS',
          title: 'Dernier Étage',
          artist: 'Léo Vance',
          versionLabel: 'v2 · Maquette',
          coverGradient: 'emerald',
          audioUrl: '/api/social?demoAudio=strk_leo_2',
          durationSec: 171,
          bpm: 136,
          mood: 'Énergique',
          likedByUids: ['artist_sora'],
          ratingsByUid: { artist_sora: 8 },
          publishedAt: '2026-01-20T18:15:00.000Z',
        },
      ],
    },
  ];

  return {
    profiles,
    projects,
    messages: [],
    updatedAt: Date.now(),
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
    const initial = createInitialSeedHub();
    await saveHubDoc(projectId, dsToken, initial);
    return initial;
  }
  if (!res.ok) {
    return createInitialSeedHub();
  }
  const docJson = await res.json();
  const parsed = fromFirestoreValue({ mapValue: { fields: docJson.fields || {} } }) || {};
  if (!parsed.profiles || !Array.isArray(parsed.projects) || parsed.projects.length === 0) {
    const initial = createInitialSeedHub();
    await saveHubDoc(projectId, dsToken, initial);
    return initial;
  }
  return {
    profiles: parsed.profiles || {},
    projects: Array.isArray(parsed.projects) ? parsed.projects : [],
    messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    updatedAt: parsed.updatedAt || Date.now(),
  };
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
      name: p.name || 'Artiste Kora',
      handle: p.handle || `@${String(p.name || 'artiste').toLowerCase().replace(/[^a-z0-9]/g, '')}`,
      bio: p.bio || 'Producteur & Artiste sur Kora Studio.',
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

  // Built-in studio demo audio synthesizer for seeded community tracks
  const demoAudioSeed = typeof req.query?.demoAudio === 'string' ? req.query.demoAudio : '';
  if (req.method === 'GET' && demoAudioSeed) {
    const wavBuf = buildStudioDemoWavBuffer(demoAudioSeed);
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Length', String(wavBuf.length));
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.status(200).send(wavBuf);
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
        bio: String(body.userBio || 'Artiste & Producteur sur Kora Music Studio.').trim(),
        avatarUrl: body.userAvatarUrl || verified?.picture || undefined,
        coverGradient: body.coverGradient || 'sunset',
        location: body.location || 'Kora Studio',
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

      // If messaging one of the seeded studio artists for the first time in this thread, send a realistic studio reply
      if (['artist_nox', 'artist_sora', 'artist_leo'].includes(toUid)) {
        const existingReplies = hub.messages.filter(
          (m) => m.fromUid === toUid && m.toUid === viewerUid
        );
        if (existingReplies.length < 2) {
          const autoReplies = {
            artist_nox:
              'Merci pour le message ! Je viens d’écouter tes dernières maquettes sur Kora, le mix est super propre. Partant pour bosser sur une prod ensemble quand tu veux.',
            artist_sora:
              'Hey ! Trop cool de connecter sur Kora Studio. Si tu cherches une topline ou des harmonies sur un de tes projets, fais-moi signe !',
            artist_leo:
              'Salut ! Bien reçu, l’ambiance de tes sons est grave lourde. Hésite pas à partager ton prochain projet sur le hub !',
          };
          hub.messages.push({
            id: `msg_${Date.now() + 1}_reply`,
            fromUid: toUid,
            fromName: targetProfile.name,
            fromAvatarUrl: targetProfile.avatarUrl,
            toUid: viewerUid,
            toName: myProfile.name,
            text: autoReplies[toUid] || 'Merci pour ton message !',
            createdAt: new Date(Date.now() + 500).toISOString(),
          });
        }
      }

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
      error: err?.message || 'Erreur serveur Kora Social',
    });
  }
}
