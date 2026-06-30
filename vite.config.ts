/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import monacoEditorPluginPkg from 'vite-plugin-monaco-editor'
const monacoEditorPlugin = monacoEditorPluginPkg.default

export default defineConfig({
  plugins: [
    react(),
    monacoEditorPlugin({ languageWorkers: ['editorWorkerService', 'typescript', 'json'] }),
    {
      name: 'error-logger',
      configureServer(server) {
        server.middlewares.use('/__log_error', (req, res) => {
          let body = '';
          req.on('data', chunk => body += chunk.toString());
          req.on('end', () => {
            console.error('\n\n[FRONTEND ERROR]', body, '\n\n');
            res.end('ok');
          });
        });
      }
    },
    // In tests, stub monaco-editor and CSS/SVG imports
    ...(process.env.VITEST
      ? [{
          name: 'stub-monaco-css-in-tests',
          enforce: 'pre',
          resolveId(id: string) {
            if (id === 'monaco-editor') return '\0monaco-editor'
            if (id.startsWith('@codingame/')) return '\0codingame-stub'
            if (/\.(css|svg|png|jpg|gif)$/.test(id)) return '\0asset-stub'
            return undefined
          },
          load(id: string) {
            if (id === '\0monaco-editor') return `export const editor = { defineTheme: () => {}, setTheme: () => {} }; export const languages = {}; export const Uri = {}; export const KeyMod = {}; export const KeyCode = {}; export const Range = class {}`
            if (id === '\0codingame-stub') return 'export default {}'
            if (id === '\0asset-stub') return 'export default {}'
          },
        }]
      : []),
  ],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: ['es2021', 'safari14'],
    minify: !process.env.TAURI_DEBUG,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-tauri': ['@tauri-apps/api', '@tauri-apps/plugin-updater', '@tauri-apps/plugin-clipboard-manager'],
          'vendor-monaco': ['@monaco-editor/react'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
    deps: {
      external: [/@monaco-editor\/react/],
    },
  },
  optimizeDeps: {
    exclude: ['@monaco-editor/react'],
  },
})
