import * as wp from 'web-push';
import { waitUntil } from '@vercel/functions';

const webpush = wp.default || wp;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const publicKey =
    process.env.VAPID_PUBLIC_KEY ||
    process.env.VITE_VAPID_PUBLIC_KEY ||
    'BEF3EQDd5Hvm-3NmLYmA0hZtJ1Jw9v0ikEmvfzOABSDRqKdI40jeV-zK50Q0dB9IzGTaF1BLOPy_lq4MEZZMObM';
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:dialloalioune32@gmail.com';

  if (!publicKey || !privateKey) {
    return res.status(503).json({
      ok: false,
      error:
        'Clé VAPID_PRIVATE_KEY non configurée sur Vercel (Vercel → Settings → Environment Variables → Redeploy).',
    });
  }

  const { subscription, title, body, tag, delaySec = 0 } = req.body || {};
  if (!subscription || !subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    return res.status(400).json({
      ok: false,
      error: 'Abonnement Push manquant — clique d’abord sur Activer depuis l’icône Kora sur ton écran d’accueil.',
    });
  }

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: `Clé VAPID invalide : ${err?.message || String(err)}`,
    });
  }

  const payload = JSON.stringify({
    title: title || 'Kora · Push reçu (app fermée) ✓',
    body: body || 'Top ! Ton iPhone reçoit bien les notifications push même quand Kora est fermé.',
    tag: tag || `kora-push-${Date.now()}`,
    url: '/',
  });

  const waitSec = Math.max(0, Math.min(45, Number(delaySec) || 0));

  // If delayed (e.g. 10s closed-app test), return 200 IMMEDIATELY so the user can kill the iOS PWA
  // while Vercel keeps the background task alive via waitUntil and delivers to Apple Push!
  if (waitSec > 0) {
    waitUntil(
      sleep(waitSec * 1000)
        .then(() => webpush.sendNotification(subscription, payload))
        .catch((err) => {
          console.error('[Kora Push Test] Delayed send error:', err?.statusCode, err?.body || err?.message);
        })
    );
    return res.status(200).json({
      ok: true,
      scheduled: true,
      delayedSec: waitSec,
    });
  }

  try {
    await webpush.sendNotification(subscription, payload);
    return res.status(200).json({ ok: true, delayedSec: 0 });
  } catch (err) {
    const statusCode = err?.statusCode || 500;
    return res.status(statusCode >= 400 && statusCode < 600 ? statusCode : 500).json({
      ok: false,
      error: err?.body || err?.message || 'Échec de l’envoi Web Push',
    });
  }
}
