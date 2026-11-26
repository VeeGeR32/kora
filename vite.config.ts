import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Generates `dist/precache-manifest.json` listing the app shell and every built JS/CSS chunk
 * (including lazy chunks) and stamps a unique build ID into `dist/sw.js` so iOS Safari/PWA
 * can launch and run 100% offline in Airplane Mode.
 */
function rowavOfflinePrecachePlugin(): Plugin {
  return {
    name: 'rowav-offline-precache',
    apply: 'build',
    closeBundle() {
      const distDir = path.resolve(process.cwd(), 'dist');
      const assetsDir = path.join(distDir, 'assets');
      if (!fs.existsSync(distDir)) return;

      const urls = new Set<string>([
        '/',
        '/index.html',
        '/manifest.webmanifest',
        '/icon-192.png',
        '/icon-512.png',
        '/apple-touch-icon.png',
        '/kora-icon.svg',
      ]);

      if (fs.existsSync(assetsDir)) {
        for (const file of fs.readdirSync(assetsDir)) {
          if (/\.(js|css|woff2?|png|svg|webp)$/i.test(file)) {
            urls.add(`/assets/${file}`);
          }
        }
      }

      const buildId = Date.now().toString(36);
      const manifest = {
        version: buildId,
        urls: Array.from(urls),
      };
      fs.writeFileSync(
        path.join(distDir, 'precache-manifest.json'),
        JSON.stringify(manifest, null, 2),
        'utf8'
      );

      const swPath = path.join(distDir, 'sw.js');
      if (fs.existsSync(swPath)) {
        const swContent = fs.readFileSync(swPath, 'utf8');
        fs.writeFileSync(swPath, swContent.replace(/__ROWAV_BUILD_ID__/g, buildId), 'utf8');
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), rowavOfflinePrecachePlugin()],
});
