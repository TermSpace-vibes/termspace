/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react(),
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
    }
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
  },
})
