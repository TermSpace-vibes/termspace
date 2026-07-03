import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'

const tauriConfig = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'))
const devUrl = tauriConfig.build.devUrl

function canReach(url) {
  return new Promise((resolve) => {
    const client = url.startsWith('https:') ? https : http
    const req = client.get(url, (res) => {
      res.resume()
      resolve(true)
    })

    req.setTimeout(1000, () => {
      req.destroy()
      resolve(false)
    })

    req.on('error', () => resolve(false))
  })
}

function idleUntilTauriStops() {
  const interval = setInterval(() => {}, 60_000)
  const stop = () => {
    clearInterval(interval)
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

if (await canReach(devUrl)) {
  console.log(`[dev-server] Reusing existing Vite server at ${devUrl}`)
  idleUntilTauriStops()
} else {
  console.log(`[dev-server] Starting Vite server for ${devUrl}`)
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const child = spawn(npm, ['run', 'dev'], { stdio: 'inherit' })

  const stop = (signal) => {
    child.kill(signal)
  }
  process.on('SIGINT', () => stop('SIGINT'))
  process.on('SIGTERM', () => stop('SIGTERM'))

  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal)
    process.exit(code ?? 0)
  })
}
