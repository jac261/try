import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Deployed under https://jac261.github.io/try/ — assets must be prefixed with /try/.
// For local dev/preview pass `--base /` so the app serves from the root.
export default defineConfig({
  base: '/try/',
  // `@` → src/, so modules import as `@/lib/date` instead of `../../lib/date`.
  resolve: {
    alias: { '@': resolve(import.meta.dirname, 'src') },
  },
  // Vitest: unit tests for the pure lib/ modules run in a plain Node env.
  test: {
    include: ['src/**/*.test.{js,jsx}'],
    environment: 'node',
  },
  build: {
    outDir: 'dist',
    // Multi-page: the app + the visual style guide. The style guide imports the
    // real src/styles.css, so it stays in sync with the app and deploys live at
    // /try/docs/style-guide.html (the docs/*.md files stay in the repo for GitHub).
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        styleGuide: resolve(import.meta.dirname, 'docs/style-guide.html'),
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg', 'icons/favicon-48.png', 'icons/apple-touch-icon-180.png'],
      // The default glob is js/css/html only; the self-hosted Figtree woff2
      // must be precached or offline sessions fall back to the system font.
      workbox: { globPatterns: ['**/*.{js,css,html,woff2}'] },
      manifest: {
        name: 'Try — Triathlon Training',
        short_name: 'Try',
        description: 'Personalised triathlon training plans — swim, bike & run, from your race date and fitness.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0e1217',
        theme_color: '#0e1217',
        categories: ['sports', 'health', 'fitness'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
