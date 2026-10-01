import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import type { Plugin } from 'vite';

/**
 * Dev only: the legacy static pages (dashboard.html, project.html, ...) still sit at the project root and
 * Vite serves real files before any SPA fallback. Send every app URL to the React entry (app.html)
 * instead so `npm run dev` shows the React app. The static marketing pages stay reachable (/index.html).
 */
const APP_PATHS = new Set([
  '/', '/app', '/app.html', '/dashboard', '/dashboard.html', '/project', '/project.html',
  '/operations', '/operations.html', '/reconcile', '/reconcile.html',
  '/login', '/login.html', '/signin',
  ...['proforma', 'property', 'debt', 'diligence', 'sensitivity', 'tax'].flatMap((t) => [`/project-${t}`, `/project-${t}.html`]),
]);
const reactDevRoutes = (): Plugin => ({
  name: 'react-dev-routes',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const url = req.url || '/';
      const pathname = url.split('?')[0];
      if (APP_PATHS.has(pathname) && pathname !== '/app.html') {
        req.url = '/app.html' + url.slice(pathname.length);
      }
      next();
    });
  },
});

export default defineConfig({
  plugins: [react(), reactDevRoutes()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Single-source math engine shared with the Supabase Edge Functions (Deno)
      '@engine': path.resolve(__dirname, './supabase/functions/_shared'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      input: {
        app: path.resolve(__dirname, 'app.html'),
      },
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-charts': ['chart.js', 'react-chartjs-2'],
          'vendor-icons': ['lucide-react'],
          'vendor-supabase': ['@supabase/supabase-js']
        }
      }
    },
  },
  server: {
    port: 3000,
    open: true,
  },
});
