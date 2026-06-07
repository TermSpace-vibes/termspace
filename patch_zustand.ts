import fs from 'fs'
let code = fs.readFileSync('src/store/useAppStore.ts', 'utf8')
code = code.replace(/set\(\(s\) => \(\{/g, "set((s) => { fetch('http://localhost:1420/__log_error', { method: 'POST', body: 'Zustand update: ' + new Error().stack?.split('\\n')[2] }); return {")
fs.writeFileSync('src/store/useAppStore.ts', code)
