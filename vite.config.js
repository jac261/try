import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Deployed under https://jac261.github.io/try/ — assets must be prefixed with /try/.
// For local dev/preview pass `--base /` so the app serves from the root.
export default defineConfig({
  base: '/try/',
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
