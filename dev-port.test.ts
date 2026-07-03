import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const DEV_PORT = 1430

describe('dev server port config', () => {
  it('keeps Vite and Tauri dev URLs on the non-production dev port', () => {
    const viteConfig = readFileSync('vite.config.ts', 'utf8')
    const tauriConfig = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'))

    expect(viteConfig).toContain(`port: ${DEV_PORT}`)
    expect(tauriConfig.build.devUrl).toBe(`http://localhost:${DEV_PORT}`)
    expect(tauriConfig.build.beforeDevCommand).toBe('node scripts/ensure-vite-dev-server.mjs')
  })

  it('does not hard-code the old Vite dev port in frontend code', () => {
    const store = readFileSync('src/store/useAppStore.ts', 'utf8')

    expect(store).not.toContain('localhost:1420')
  })
})
