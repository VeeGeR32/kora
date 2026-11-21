import webpush from 'web-push';

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
        'Clés VAPID non configurées sur Vercel (ajoute VITE_VAPID_PUBLIC_KEY et VAPID_PRIVATE_KEY dans Vercel → Settings → Environment Variables).',
    });
  }

  const { subscription, title, body, tag, delaySec = 0 } = req.body || {};
  if (!subscription || !subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    return res.status(400).json({
      ok: false,
      error: 'Abonnement Push manquant — clique d’abord sur Activer sur ton iPhone.',
    });
  }

  const waitSec = Math.max(0, Math.min(45, Number(delaySec) || 0));
  if (waitSec > 0) {
    await sleep(waitSec * 1000);
  }

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    await webpush.sendNotification(
      subscription,
      JSON.stringify({
        title: title || 'Kora · Test Push (app fermée)',
        body: body || 'Parfait ! Les notifications push arrivent même quand Kora est fermé.',
        tag: tag || `kora-push-${Date.now()}`,
        url: '/',
      })
    );
    return res.status(200).json({ ok: true, delayedSec: waitSec });
  } catch (err) {
    const statusCode = err?.statusCode || 500;
    return res.status(statusCode >= 400 && statusCode < 600 ? statusCode : 500).json({
      ok: false,
      error: err?.body || err?.message || 'Échec de l’envoi Web Push',
    });
  }
}
