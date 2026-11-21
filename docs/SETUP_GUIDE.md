# Guide complet de configuration — Kora (APIs, Firebase DB & Bridge Pronote sur Linux TV + Tailscale)

**Kora** est conçue comme un **template personnel BYOK / BYODB** (*Bring Your Own Keys & Database*) : chaque utilisateur connecte ses propres services et reste 100 % propriétaire de ses données.

---

## 1. Connecter l'API Gemini (pour Kora AI)

L'API Gemini dispose d'un niveau gratuit largement suffisant pour un usage quotidien personnel.

1. Va sur **[Google AI Studio — API Keys](https://aistudio.google.com/apikey)** et connecte-toi avec ton compte Google.
2. Clique sur **« Create API key »** (Créer une clé API), puis copie la clé (`AIzaSy...`).
3. Ouvre **Kora → Paramètres (icône engrenage) → APIs & Bridge**.
4. Colle ta clé dans **Clé API Gemini**, clique sur **« Tester la clé »** (tu dois voir `Clé Gemini valide ✓`), puis clique sur **« Sauvegarder les APIs »**.

> **Astuce développeur :** Tu peux aussi définir `VITE_GEMINI_API_KEY=AIzaSy...` dans un fichier `.env` à la racine du projet pour pré-remplir la clé automatiquement.

---

## 2. Connecter ta Base de Données & ton Compte (Firebase)

Cela te permet de **te connecter** (Google ou Email/Mot de passe) et de **synchroniser automatiquement tes données et médias entre ton PC et ton téléphone**.

### Étape A — Créer le projet Firebase (gratuit, plan Spark)
1. Va sur **[console.firebase.google.com](https://console.firebase.google.com/)** → **Ajouter un projet** (ex. `kora-perso`).
2. Dans le menu de gauche, active les 3 services :
   - **Authentication** → *Commencer* → Onglet *Sign-in method* → active **Google** et **Adresse e-mail/Mot de passe**.
   - **Firestore Database** → *Créer une base de données* → choisis une région Europe (`eur3` ou `europe-west1`) → mode production.
   - **Storage** *(optionnel, pour synchroniser MP3 / pochettes / PDF entre appareils)* → *Commencer*.

### Étape B — Déployer les règles de sécurité (strictement privées)
Dans la console Firebase :
- **Firestore → Règles** : copie-colle le contenu de [`firestore.rules`](../firestore.rules) puis clique sur **Publier**.
- **Storage → Règles** : copie-colle le contenu de [`storage.rules`](../storage.rules) puis clique sur **Publier**.

*(Ces règles garantissent que **seul ton compte connecté** `request.auth.uid == userId` peut lire ou écrire tes données.)*

### Étape C — Récupérer `firebaseConfig` et connecter Kora
1. Dans Firebase → **Paramètres du projet (icône engrenage)** → section **Vos applications** → clique sur l'icône Web **`</>`** → donne un nom (`kora-web`) → **Enregistrer l'application**.
2. Copie tout le bloc `const firebaseConfig = { ... };`.
3. Ouvre **Kora → Paramètres → Compte & DB**.
4. Colle directement le bloc dans **« Configuration rapide Firebase »** → clique sur **Importer** → puis **Enregistrer profil & Firebase**.
5. Clique sur **« Continuer avec Google »** (ou crée un compte Email/Mot de passe) : tes données sont désormais sauvegardées et synchronisées en temps réel !

> **Domaine autorisé sur mobile :** Si tu héberges Kora sur un domaine personnalisé ou Vercel/Firebase Hosting, pense à ajouter ce domaine dans Firebase → *Authentication → Settings → Authorized domains*.

---

## 3. Installer le Bridge Pronote 24/7 sur ton PC Linux TV + Tailscale

Héberger [`server/pronote-bridge.mjs`](../server/pronote-bridge.mjs) sur ton **PC Linux TV toujours allumé** derrière **Tailscale** est la meilleure configuration possible :
- Accessible depuis ton PC **et** ton téléphone (même en 4G/5G hors Wi-Fi) sans jamais ouvrir de port sur ta box internet.
- **HTTPS gratuit et automatique** grâce à `tailscale serve` (indispensable pour que le navigateur mobile autorise les requêtes).

### Étape 1 — Préparer le dossier sur ton PC Linux TV (via SSH ou terminal)
```bash
# Vérifie que Node.js (>= 18) est installé
node -v

# Crée le dossier dédié au bridge
mkdir -p ~/kora-pronote && cd ~/kora-pronote
npm init -y
npm install pawnote
```

Copie ensuite le fichier `server/pronote-bridge.mjs` de ton projet Kora vers `~/kora-pronote/pronote-bridge.mjs` (via `scp`, clé USB ou copier-coller `nano ~/kora-pronote/pronote-bridge.mjs`).

### Étape 2 — Générer un token secret
```bash
openssl rand -hex 24
```
Garde la chaîne générée (ex. `9f4a2c...`), elle empêchera toute personne non autorisée d'appeler ton bridge.

### Étape 3 — Créer un service `systemd` (démarrage automatique au boot)
Crée le fichier `/etc/systemd/system/kora-pronote.service` :
```bash
sudo nano /etc/systemd/system/kora-pronote.service
```
Colle ce contenu (en remplaçant `<TON_USER>` par ton utilisateur Linux et `<TON_TOKEN>` par ton token secret) :
```ini
[Unit]
Description=Kora Pronote Bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=<TON_USER>
WorkingDirectory=/home/<TON_USER>/kora-pronote
Environment=PRONOTE_BRIDGE_PORT=4789
Environment=PRONOTE_BRIDGE_HOST=127.0.0.1
Environment=KORA_BRIDGE_TOKEN=<TON_TOKEN>
ExecStart=/usr/bin/node /home/<TON_USER>/kora-pronote/pronote-bridge.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Active et démarre le service :
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now kora-pronote
sudo systemctl status kora-pronote
```

### Étape 4 — Exposer le bridge en HTTPS privé avec Tailscale
Sur le PC Linux TV :
```bash
tailscale serve --bg 4789
```
Tailscale affiche immédiatement ton URL privée HTTPS, par exemple :
```text
https://pc-tv.tail12345.ts.net/
```
*(Si `tailscale serve` te demande d'activer HTTPS/MagicDNS sur ton tailnet, clique simplement sur le lien qu'il affiche dans le terminal — ça prend 10 secondes dans le dashboard Tailscale.)*

Vérifie que ça répond :
```bash
curl -H "X-Kora-Token: <TON_TOKEN>" https://pc-tv.tail12345.ts.net/health
# -> {"ok":true,"service":"kora-pronote-bridge","port":4789,"authProtected":true,...}
```

### Étape 5 — Relier le Bridge dans Kora (PC & Téléphone)
1. Assure-toi que Tailscale est actif sur ton téléphone / PC principal.
2. Ouvre **Kora → Paramètres → APIs & Bridge**.
3. Renseigne :
   - **URL Bridge Pronote** : `https://pc-tv.tail12345.ts.net`
   - **Token secret (`X-Kora-Token`)** : `<TON_TOKEN>`
4. Clique sur **« Tester /health »** → tu dois voir `Bridge connecté ✓`, puis **« Sauvegarder les APIs »**.
5. Va dans **Cours → Pronote**, colle le JSON du **QR Code Pronote** + ton PIN (ou identifiants) et clique sur **Synchroniser Pronote** !
