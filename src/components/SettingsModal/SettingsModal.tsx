import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useAppStore } from '../../store/useAppStore'
import { Settings } from '../../types'
import { check } from '@tauri-apps/plugin-updater'
import { getVersion } from '@tauri-apps/api/app'

interface Props {
  onClose: () => void
}

export function SettingsModal({ onClose }: Props) {
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)

  const [theme, setTheme] = useState<Settings['theme']>(settings.theme)
  const [fontSize, setFontSize] = useState(settings.fontSize)
  const [uiFontFamily, setUiFontFamily] = useState(settings.uiFontFamily || 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif')
  const [terminalFontFamily, setTerminalFontFamily] = useState(settings.terminalFontFamily || '"JetBrains Mono", "Fira Code", Menlo, monospace')
  const [timeFormat, setTimeFormat] = useState<Settings['timeFormat']>(settings.timeFormat || '24h')
  const [autosave, setAutosave] = useState(settings.autosave || false)
  const [keybindings, setKeybindings] = useState(settings.keybindings || {
    newTerminal: 'CmdOrCtrl+T',
    closeTerminal: 'CmdOrCtrl+W',
    nextTerminal: 'CmdOrCtrl+Shift+]',
    prevTerminal: 'CmdOrCtrl+Shift+[',
    commandPalette: 'CmdOrCtrl+K',
  })

  const [appVersion, setAppVersion] = useState<string>('Loading...')

  useEffect(() => {
    getVersion().then(setAppVersion).catch(console.error)
  }, [])

  function handleSave() {
    updateSettings({ theme, fontSize, uiFontFamily, terminalFontFamily, timeFormat, autosave, keybindings })
    useAppStore.getState().addToast('Settings saved', 'success')
    onClose()
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
        background: 'rgba(0,0,0,0.6)', zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(4px)'
      }}
      onClick={onClose}
    >
      <motion.div
        className="no-scrollbar"
        initial={{ opacity: 0, y: 15, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 15, scale: 0.98 }}
        style={{
          background: 'var(--bg-main)', border: '1px solid var(--border-inactive)',
          borderRadius: 12, padding: 32, width: 800, maxWidth: '90%',
          maxHeight: '90vh', overflowY: 'auto',
          display: 'flex', flexDirection: 'column', gap: 20,
          boxShadow: '0 16px 40px rgba(0,0,0,0.2)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ fontSize: 18, color: 'var(--text-active)', marginBottom: 4, fontWeight: 600, marginTop: 0 }}>Settings</h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, color: 'var(--text-inactive)', fontWeight: 500 }}>Theme</label>
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as Settings['theme'])}
              style={{
                padding: '10px 14px', background: 'var(--bg-sidebar)',
                border: '1px solid var(--border-inactive)', borderRadius: 6,
                color: 'var(--text-active)', outline: 'none', fontSize: 14,
                transition: 'border 0.2s', width: '100%'
              }}
              onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
              onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-inactive)'}
            >
              <option value="warm-dark">Warm Dark (Default)</option>
              <option value="cold-dark">Cold Dark</option>
              <option value="light">Light Mode</option>
              <option value="catppuccin-mocha">Catppuccin Mocha</option>
              <option value="synthwave">Synthwave (Neon)</option>
              <option value="fruity">Fruity (Colorful)</option>
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, color: 'var(--text-inactive)', fontWeight: 500 }}>UI Font Family</label>
            <select
              value={uiFontFamily}
              onChange={(e) => setUiFontFamily(e.target.value)}
              style={{
                padding: '10px 14px', background: 'var(--bg-sidebar)',
                border: '1px solid var(--border-inactive)', borderRadius: 6,
                color: 'var(--text-active)', outline: 'none', fontSize: 14,
                transition: 'border 0.2s', width: '100%'
              }}
              onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
              onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-inactive)'}
            >
              <option value='Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'>Inter (Default)</option>
              <option value='"Outfit", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'>Outfit (Modern)</option>
              <option value='"Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'>Roboto</option>
              <option value='-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'>System UI</option>
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, color: 'var(--text-inactive)', fontWeight: 500 }}>Terminal/Editor Font</label>
            <select
              value={terminalFontFamily}
              onChange={(e) => setTerminalFontFamily(e.target.value)}
              style={{
                padding: '10px 14px', background: 'var(--bg-sidebar)',
                border: '1px solid var(--border-inactive)', borderRadius: 6,
                color: 'var(--text-active)', outline: 'none', fontSize: 14,
                transition: 'border 0.2s', width: '100%'
              }}
              onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
              onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-inactive)'}
            >
              <option value='"JetBrains Mono", "Fira Code", Menlo, monospace'>JetBrains Mono (Default)</option>
              <option value='"Fira Code", Menlo, Monaco, "Courier New", monospace'>Fira Code</option>
              <option value='Menlo, Monaco, "Courier New", monospace'>System Monospace</option>
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, color: 'var(--text-inactive)', fontWeight: 500 }}>Terminal Font Size</label>
            <input
              type="number"
              min={8}
              max={48}
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
              style={{
                padding: '10px 14px', background: 'var(--bg-sidebar)',
                border: '1px solid var(--border-inactive)', borderRadius: 6,
                color: 'var(--text-active)', outline: 'none', fontSize: 14,
                transition: 'border 0.2s', width: '100%'
              }}
              onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
              onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-inactive)'}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, color: 'var(--text-inactive)', fontWeight: 500 }}>Time Format</label>
            <select
              value={timeFormat}
              onChange={(e) => setTimeFormat(e.target.value as Settings['timeFormat'])}
              style={{
                padding: '10px 14px', background: 'var(--bg-sidebar)',
                border: '1px solid var(--border-inactive)', borderRadius: 6,
                color: 'var(--text-active)', outline: 'none', fontSize: 14,
                transition: 'border 0.2s', width: '100%'
              }}
              onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
              onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-inactive)'}
            >
              <option value="12h">12-hour (e.g. 2:30 PM)</option>
              <option value="24h">24-hour (e.g. 14:30)</option>
            </select>
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--border-inactive)', margin: '10px 0' }} />

        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-active)' }}>Keybindings</div>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          {(Object.keys(keybindings) as (keyof typeof keybindings)[]).map((key) => (
            <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 13, color: 'var(--text-inactive)', fontWeight: 500 }}>
                {key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
              </label>
              <input
                type="text"
                value={keybindings[key]}
                onChange={(e) => setKeybindings({ ...keybindings, [key]: e.target.value })}
                style={{
                  padding: '8px 12px', background: 'var(--bg-sidebar)',
                  border: '1px solid var(--border-inactive)', borderRadius: 6,
                  color: 'var(--text-active)', outline: 'none', fontSize: 13,
                  transition: 'border 0.2s', width: '100%'
                }}
                onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
                onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-inactive)'}
              />
            </div>
          ))}
        </div>

        <div style={{ borderTop: '1px solid var(--border-inactive)', margin: '10px 0' }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-active)' }}>Application</div>
          
          <label style={{ 
            display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
            padding: '4px 0'
          }}>
            <input 
              type="checkbox" 
              checked={autosave} 
              onChange={(e) => setAutosave(e.target.checked)}
              style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--accent)' }}
            />
            <span style={{ fontSize: 13, color: 'var(--text-active)', fontWeight: 500 }}>
              Enable Global Autosave (1s debounce)
            </span>
          </label>

          <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: 0 }}>Current version: {appVersion}</p>
          <button
            onClick={async () => {
              useAppStore.getState().addToast('Checking for updates...', 'info')
              try {
                const update = await check()
                if (update) {
                  useAppStore.getState().addToast(`Update ${update.version} available! Downloading...`, 'info')
                  await update.downloadAndInstall()
                  useAppStore.getState().addToast('Update installed! Please restart the app.', 'success')
                } else {
                  useAppStore.getState().addToast('You are on the latest version.', 'info')
                }
              } catch (err) {
                console.error(err)
                useAppStore.getState().addToast('Failed to check for updates.', 'error')
              }
            }}
            style={{
              padding: '8px 16px', background: 'transparent',
              border: '1px solid var(--border-inactive)', borderRadius: 6,
              color: 'var(--text-active)', cursor: 'pointer', fontSize: 14, fontWeight: 500,
              transition: 'background 0.2s', width: 'fit-content'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-item)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            Check for Updates
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px', background: 'transparent',
              border: '1px solid var(--border-inactive)', borderRadius: 6,
              color: 'var(--text-inactive)', cursor: 'pointer', fontSize: 14, fontWeight: 500,
              transition: 'background 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-item)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            style={{
              padding: '8px 16px', background: 'var(--accent)',
              border: 'none', borderRadius: 6,
              color: 'var(--bg-main)', cursor: 'pointer', fontSize: 14, fontWeight: 600,
              transition: 'opacity 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
            onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
          >
            Save Changes
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
