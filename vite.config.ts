import fs from 'node:fs';
import path from 'node:path';
import {defineConfig, type Plugin} from 'vite';

const FRONTEND_DIR = path.resolve(__dirname, 'frontend');
const DIST_DIR = path.resolve(__dirname, 'dist');

const htmlEntries = Object.fromEntries(
  fs
    .readdirSync(FRONTEND_DIR)
    .filter((file) => file.endsWith('.html'))
    .map((file) => [file.replace(/\.html$/, ''), path.resolve(FRONTEND_DIR, file)]),
);

function unimeetStaticPlugin(): Plugin {
  return {
    name: 'unimeet-static-assets-and-rewrites',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url === '/reset-password' || req.url?.startsWith('/reset-password?')) {
          req.url = req.url.replace(/^\/reset-password/, '/reset-password.html');
        }
        next();
      });
    },
    closeBundle() {
      const assetsSrc = path.resolve(FRONTEND_DIR, 'assets');
      const assetsDest = path.resolve(DIST_DIR, 'assets');
      if (fs.existsSync(assetsSrc)) {
        fs.cpSync(assetsSrc, assetsDest, {
          recursive: true,
          filter: (src) => !path.basename(src).startsWith('.'),
        });
      }
      const faviconSrc = path.resolve(FRONTEND_DIR, 'favicon.ico');
      const faviconDest = path.resolve(DIST_DIR, 'favicon.ico');
      if (fs.existsSync(faviconSrc)) {
        fs.copyFileSync(faviconSrc, faviconDest);
      }
      const manifestSrc = path.resolve(FRONTEND_DIR, 'manifest.webmanifest');
      const manifestDest = path.resolve(DIST_DIR, 'manifest.webmanifest');
      if (fs.existsSync(manifestSrc)) {
        fs.copyFileSync(manifestSrc, manifestDest);
      }
    },
  };
}

export default defineConfig(() => {
  return {
    root: FRONTEND_DIR,
    // Relative asset URLs so the same build works at a sub-path (GitHub Pages: /UniMeet4/),
    // at a domain root (Firebase Hosting) and inside the Capacitor Android app.
    base: './',
    plugins: [unimeetStaticPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        '@firebase-config': path.resolve(__dirname, 'firebase-applet-config.json'),
      },
    },
    build: {
      outDir: DIST_DIR,
      emptyOutDir: true,
      rollupOptions: {
        input: htmlEntries,
      },
    },
    server: {
      fs: {
        allow: [path.resolve(__dirname)],
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
