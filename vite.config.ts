import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
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
