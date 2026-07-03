/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import vsix from '@codingame/monaco-vscode-rollup-vsix-plugin'

export default defineConfig({
  plugins: [
    react(),
    vsix(),
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
  server: { port: 1430, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_'],
  resolve: {
    alias: {
      'monaco-editor': '@codingame/monaco-vscode-editor-api',
      // v25 split the extension-facing 'vscode' namespace out of the core
      // api package into its own package — monaco-languageclient (and any
      // other code doing `import * as vscode from 'vscode'`) needs this one,
      // not @codingame/monaco-vscode-api itself.
      'vscode': '@codingame/monaco-vscode-extension-api',
    },
  },
  build: {
    target: ['es2021', 'safari14'],
    minify: !process.env.TAURI_DEBUG,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-tauri': ['@tauri-apps/api', '@tauri-apps/plugin-updater', '@tauri-apps/plugin-clipboard-manager'],
          'vendor-monaco': ['@monaco-editor/react', '@codingame/monaco-vscode-editor-api'],
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
    // Every @codingame/monaco-vscode-* package must bypass esbuild's dep
    // pre-bundling. They all share singleton vscode-api registries (extension
    // points, services, ...) via internal source imports; if esbuild bundles
    // a second copy alongside Vite's own dev-server transform of those same
    // files, workbench modules like authenticationService.js run their
    // top-level `registerExtensionPoint()` calls twice and the second one
    // throws "Duplicate extension point: authentication", crashing the app
    // before React ever mounts.
    exclude: [
      '@monaco-editor/react',
      '@codingame/monaco-vscode-api',
      '@codingame/monaco-vscode-extension-api',
      '@codingame/monaco-vscode-editor-api',
      '@codingame/monaco-vscode-extensions-service-override',
      '@codingame/monaco-vscode-languages-service-override',
      '@codingame/monaco-vscode-model-service-override',
      '@codingame/monaco-vscode-configuration-service-override',
      '@codingame/monaco-vscode-files-service-override',
      '@codingame/monaco-vscode-textmate-service-override',
      '@codingame/monaco-vscode-theme-service-override',
      '@codingame/monaco-vscode-language-detection-worker-service-override',
      '@codingame/monaco-vscode-typescript-language-features-default-extension',
      '@codingame/monaco-vscode-typescript-basics-default-extension',
      '@codingame/monaco-vscode-javascript-default-extension',
      '@codingame/monaco-vscode-json-default-extension',
      '@codingame/monaco-vscode-json-language-features-default-extension',
      '@codingame/monaco-vscode-css-default-extension',
      '@codingame/monaco-vscode-css-language-features-default-extension',
      '@codingame/monaco-vscode-html-default-extension',
      '@codingame/monaco-vscode-html-language-features-default-extension',
      '@codingame/monaco-vscode-markdown-basics-default-extension',
      '@codingame/monaco-vscode-markdown-language-features-default-extension',
      '@codingame/monaco-vscode-theme-defaults-default-extension',
    ],
  },
})
