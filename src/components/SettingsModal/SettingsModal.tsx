import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useAppStore } from '../../store/useAppStore'
import { Settings } from '../../types'
import { check } from '@tauri-apps/plugin-updater'
import { getVersion } from '@tauri-apps/api/app'
import { invoke } from '../../utils/tauri'

interface Props {
  onClose: () => void
}

type TabKey = 'Appearance' | 'Application' | 'Keybindings' | 'Data'

export function SettingsModal({ onClose }: Props) {
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)

  const [activeTab, setActiveTab] = useState<TabKey>('Appearance')

  const [theme, setTheme] = useState<Settings['theme']>(settings.theme)
  const [fontSize, setFontSize] = useState(settings.fontSize)
  const [uiFontFamily, setUiFontFamily] = useState(settings.uiFontFamily || 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif')
  const [terminalFontFamily, setTerminalFontFamily] = useState(settings.terminalFontFamily || '"JetBrains Mono", "Fira Code", Menlo, monospace')
  const [timeFormat, setTimeFormat] = useState<Settings['timeFormat']>(settings.timeFormat || '24h')
  const [autosave, setAutosave] = useState(settings.autosave || false)
  const [showTabBar, setShowTabBar] = useState(settings.showTabBar !== false)
  const [iconTheme, setIconTheme] = useState<Settings['iconTheme']>(settings.iconTheme || 'colorful')
  const [defaultTerminalType, setDefaultTerminalType] = useState<'built-in' | 'ghostty'>(
    settings.defaultTerminalType || 'built-in'
  )
  const [terminalRenderer, setTerminalRenderer] = useState<'native' | 'xterm'>(
    settings.terminalRenderer || 'native'
  )
  const [smoothCaret, setSmoothCaret] = useState(settings.smoothCaret ?? true)
  const [keybindings, setKeybindings] = useState<Settings['keybindings']>({
    newTerminal: settings.keybindings?.newTerminal || 'CmdOrCtrl+T',
    closeTerminal: settings.keybindings?.closeTerminal || 'CmdOrCtrl+W',
    nextTerminal: settings.keybindings?.nextTerminal || 'CmdOrCtrl+Shift+]',
    prevTerminal: settings.keybindings?.prevTerminal || 'CmdOrCtrl+Shift+[',
    commandPalette: settings.keybindings?.commandPalette || 'CmdOrCtrl+K',
    toggleSidebar: settings.keybindings?.toggleSidebar || 'CmdOrCtrl+B',
    searchFiles: settings.keybindings?.searchFiles || 'CmdOrCtrl+Shift+F',
    closeTab: settings.keybindings?.closeTab || 'CmdOrCtrl+W',
    switchTab: settings.keybindings?.switchTab || 'Ctrl+Tab',
    splitEditor: settings.keybindings?.splitEditor || 'CmdOrCtrl+\\',
    openSettings: settings.keybindings?.openSettings || 'CmdOrCtrl+,',
    toggleDictation: settings.keybindings?.toggleDictation || 'CmdOrCtrl+Shift+M',
  })

  const [appVersion, setAppVersion] = useState<string>('Loading...')
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'downloading' | 'ready' | 'none'>('idle')
  const [updateProgress, setUpdateProgress] = useState(0)
  const [updateVersion, setUpdateVersion] = useState('')

  useEffect(() => {
    getVersion().then(setAppVersion).catch(console.error)
  }, [])

  function handleSave() {
    updateSettings({ theme, fontSize, uiFontFamily, terminalFontFamily, timeFormat, autosave, showTabBar, iconTheme, keybindings, defaultTerminalType, smoothCaret, terminalRenderer })
    useAppStore.getState().addToast('Settings saved', 'success')
    onClose()
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'Appearance', label: 'Appearance' },
    { key: 'Application', label: 'Application' },
    { key: 'Keybindings', label: 'Keybindings' },
    { key: 'Data', label: 'Data & Privacy' }
  ]

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
        initial={{ opacity: 0, y: 15, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 15, scale: 0.98 }}
        style={{
          background: 'var(--bg-main)', border: '1px solid var(--border-inactive)',
          borderRadius: 12, width: 800, maxWidth: '90%', height: 600,
          maxHeight: '90vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 16px 40px rgba(0,0,0,0.2)',
          overflow: 'hidden'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '24px 32px 16px', borderBottom: '1px solid var(--border-inactive)' }}>
          <h2 style={{ fontSize: 18, color: 'var(--text-active)', margin: 0, fontWeight: 600 }}>Settings</h2>
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Sidebar */}
          <div style={{ 
            width: 200, 
            borderRight: '1px solid var(--border-inactive)', 
            padding: '16px 12px',
            display: 'flex', flexDirection: 'column', gap: 4,
            background: 'var(--bg-sidebar)'
          }}>
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: 'none',
                  background: activeTab === tab.key ? 'var(--accent)' : 'transparent',
                  color: activeTab === tab.key ? 'var(--bg-main)' : 'var(--text-inactive)',
                  fontWeight: activeTab === tab.key ? 600 : 500,
                  fontSize: 13,
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => {
                  if (activeTab !== tab.key) {
                    e.currentTarget.style.background = 'var(--bg-item)'
                    e.currentTarget.style.color = 'var(--text-active)'
                  }
                }}
                onMouseLeave={(e) => {
                  if (activeTab !== tab.key) {
                    e.currentTarget.style.background = 'transparent'
                    e.currentTarget.style.color = 'var(--text-inactive)'
                  }
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Main Content Area */}
          <div className="no-scrollbar" style={{ flex: 1, padding: '24px 32px', overflowY: 'auto' }}>
            {activeTab === 'Appearance' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-active)' }}>Appearance Settings</div>
                
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
                    />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'Application' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-active)' }}>Application Settings</div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-inactive)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Terminal</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ fontSize: 13, color: 'var(--text-inactive)', fontWeight: 500 }}>Terminal App Integration</label>
                    <select
                      value={defaultTerminalType}
                      onChange={(e) => setDefaultTerminalType(e.target.value as 'built-in' | 'ghostty')}
                      style={{
                        padding: '10px 14px', background: 'var(--bg-sidebar)',
                        border: '1px solid var(--border-inactive)', borderRadius: 6,
                        color: 'var(--text-active)', outline: 'none', fontSize: 14,
                        transition: 'border 0.2s', width: '100%', maxWidth: 300
                      }}
                      onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
                      onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-inactive)'}
                    >
                      <option value="built-in">Built-in App</option>
                      <option value="ghostty">External App (Ghostty macOS)</option>
                    </select>
                    {defaultTerminalType === 'ghostty' && (
                      <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: 0, lineHeight: 1.5 }}>
                        Requires Ghostty installed at /Applications/Ghostty.app. Ghostty panes use macOS native window embedding.
                      </p>
                    )}
                  </div>

                  {defaultTerminalType === 'built-in' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
                      <label style={{ fontSize: 13, color: 'var(--text-inactive)', fontWeight: 500 }}>Built-in Terminal Renderer</label>
                      <select
                        value={terminalRenderer}
                        onChange={(e) => setTerminalRenderer(e.target.value as 'native' | 'xterm')}
                        style={{
                          padding: '10px 14px', background: 'var(--bg-sidebar)',
                          border: '1px solid var(--border-inactive)', borderRadius: 6,
                          color: 'var(--text-active)', outline: 'none', fontSize: 14,
                          transition: 'border 0.2s', width: '100%', maxWidth: 300
                        }}
                        onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
                        onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-inactive)'}
                      >
                        <option value="native">Custom Canvas (Rust Backend)</option>
                        <option value="xterm">xterm.js Web Renderer (Standard)</option>
                      </select>
                    </div>
                  )}
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
                    <label style={{ fontSize: 13, color: 'var(--text-inactive)', fontWeight: 500 }}>Terminal Smooth Caret</label>
                    <div
                      onClick={() => setSmoothCaret(!smoothCaret)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                        color: smoothCaret ? 'var(--accent)' : 'var(--text-inactive)',
                        fontSize: 13, userSelect: 'none'
                      }}
                    >
                      <div style={{
                        width: 32, height: 18, borderRadius: 10,
                        background: smoothCaret ? 'var(--accent)' : 'var(--bg-item)',
                        position: 'relative', transition: 'background 0.2s'
                      }}>
                        <div style={{
                          width: 14, height: 14, borderRadius: 7, background: 'var(--bg-main)',
                          position: 'absolute', top: 2, left: smoothCaret ? 16 : 2,
                          transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.2)'
                        }} />
                      </div>
                      Enable smooth caret animation
                    </div>
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--border-inactive)', margin: '4px 0' }} />

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-inactive)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Dictation</div>
                  <div style={{ display: 'flex', gap: 16 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                      <label style={{ fontSize: 13, color: 'var(--text-inactive)', fontWeight: 500 }}>Provider</label>
                      <select
                        value={settings.dictationProvider || 'local'}
                        onChange={(e) => updateSettings({ dictationProvider: e.target.value as 'local' | 'openai' | 'groq' })}
                        style={{
                          padding: '10px 14px', background: 'var(--bg-sidebar)',
                          border: '1px solid var(--border-inactive)', borderRadius: 6,
                          color: 'var(--text-active)', outline: 'none', fontSize: 14,
                          transition: 'border 0.2s', width: '100%'
                        }}
                      >
                        <option value="local">Local Native (Offline)</option>
                        <option value="openai">OpenAI (Whisper API)</option>
                        <option value="groq">Groq (Whisper API)</option>
                      </select>
                    </div>

                    {(settings.dictationProvider === 'openai' || settings.dictationProvider === 'groq') && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 2 }}>
                        <label style={{ fontSize: 13, color: 'var(--text-inactive)', fontWeight: 500 }}>API Key</label>
                        <input
                          type="password"
                          value={settings.dictationApiKey || ''}
                          onChange={(e) => updateSettings({ dictationApiKey: e.target.value })}
                          placeholder={`Enter ${settings.dictationProvider === 'openai' ? 'OpenAI' : 'Groq'} API Key`}
                          style={{
                            padding: '10px 14px', background: 'var(--bg-sidebar)',
                            border: '1px solid var(--border-inactive)', borderRadius: 6,
                            color: 'var(--text-active)', outline: 'none', fontSize: 14,
                            transition: 'border 0.2s', width: '100%'
                          }}
                        />
                      </div>
                    )}
                  </div>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                    <label style={{ fontSize: 13, color: 'var(--text-inactive)', fontWeight: 500 }}>
                      Dictation Context Prompt (Optional)
                    </label>
                    <textarea
                      value={settings.dictationPrompt || ''}
                      onChange={(e) => updateSettings({ dictationPrompt: e.target.value })}
                      placeholder="e.g. 'This transcript is in English, spoken with an Asian accent. The user often says termspace, tauri, rust, and react.'"
                      style={{
                        padding: '10px 14px', background: 'var(--bg-sidebar)',
                        border: '1px solid var(--border-inactive)', borderRadius: 6,
                        color: 'var(--text-active)', outline: 'none', fontSize: 13,
                        transition: 'border 0.2s', width: '100%', minHeight: 60, resize: 'vertical',
                        fontFamily: 'inherit', lineHeight: 1.4
                      }}
                    />
                    <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: 0 }}>
                      Provide a cheat sheet to force the AI to correctly spell specific names, jargon, or to hint at your accent.
                    </p>
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--border-inactive)', margin: '4px 0' }} />

                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                    <input 
                      type="checkbox" 
                      checked={autosave} 
                      onChange={(e) => setAutosave(e.target.checked)}
                      style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--accent)' }}
                    />
                    <span style={{ fontSize: 14, color: 'var(--text-active)', fontWeight: 500 }}>
                      Enable Global Autosave (1s debounce)
                    </span>
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                    <input 
                      type="checkbox" 
                      checked={showTabBar} 
                      onChange={(e) => setShowTabBar(e.target.checked)}
                      style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--accent)' }}
                    />
                    <span style={{ fontSize: 14, color: 'var(--text-active)', fontWeight: 500 }}>
                      Show Tab Bar (Workspace Header)
                    </span>
                  </label>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 0' }}>
                    <label style={{ fontSize: 13, color: 'var(--text-inactive)', fontWeight: 500 }}>File & Directory Icons</label>
                    <select
                      value={iconTheme}
                      onChange={(e) => setIconTheme(e.target.value as Settings['iconTheme'])}
                      style={{
                        padding: '10px 14px', background: 'var(--bg-sidebar)',
                        border: '1px solid var(--border-inactive)', borderRadius: 6,
                        color: 'var(--text-active)', outline: 'none', fontSize: 14,
                        transition: 'border 0.2s', width: '100%', maxWidth: 300
                      }}
                      onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
                      onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-inactive)'}
                    >
                      <option value="plain">Plain (Monochrome)</option>
                      <option value="colorful">Colorful (Line Icons)</option>
                      <option value="filled">Filled (Solid Colorful Icons)</option>
                    </select>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '50%' }}>
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
                    >
                      <option value="12h">12-hour (e.g. 2:30 PM)</option>
                      <option value="24h">24-hour (e.g. 14:30)</option>
                    </select>
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--border-inactive)', margin: '8px 0' }} />

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <p style={{ fontSize: 14, color: 'var(--text-dim)', margin: 0 }}>
                    Current version: <span style={{ color: 'var(--text-active)', fontWeight: 600 }}>{appVersion}</span>
                  </p>

                  {updateState === 'downloading' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: 0 }}>
                        Downloading v{updateVersion}… {updateProgress}%
                      </p>
                      <div style={{ height: 4, background: 'var(--border-inactive)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{
                          height: '100%', width: `${updateProgress}%`,
                          background: 'var(--accent, #7c6af7)', borderRadius: 2,
                          transition: 'width 0.2s ease'
                        }} />
                      </div>
                    </div>
                  )}

                  {updateState === 'ready' && (
                    <p style={{ fontSize: 13, color: '#4ade80', margin: 0 }}>
                      ✓ v{updateVersion} installed — restart to apply
                    </p>
                  )}

                  {updateState === 'none' && (
                    <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: 0 }}>
                      ✓ You're on the latest version
                    </p>
                  )}

                  <button
                    disabled={updateState === 'checking' || updateState === 'downloading' || updateState === 'ready'}
                    onClick={async () => {
                      setUpdateState('checking')
                      try {
                        const update = await check()
                        if (update) {
                          setUpdateVersion(update.version)
                          setUpdateState('downloading')
                          setUpdateProgress(0)
                          let downloaded = 0
                          let total = 0
                          await update.downloadAndInstall((event) => {
                            if (event.event === 'Started') {
                              total = event.data.contentLength ?? 0
                            } else if (event.event === 'Progress') {
                              downloaded += event.data.chunkLength
                              setUpdateProgress(total > 0 ? Math.round((downloaded / total) * 100) : 0)
                            } else if (event.event === 'Finished') {
                              setUpdateProgress(100)
                            }
                          })
                          setUpdateState('ready')
                        } else {
                          setUpdateState('none')
                        }
                      } catch (err) {
                        console.error(err)
                        setUpdateState('idle')
                        useAppStore.getState().addToast('Failed to check for updates.', 'error')
                      }
                    }}
                    style={{
                      padding: '8px 16px', background: 'var(--bg-sidebar)',
                      border: '1px solid var(--border-inactive)', borderRadius: 6,
                      color: updateState === 'idle' || updateState === 'none' ? 'var(--text-active)' : 'var(--text-dim)',
                      cursor: updateState === 'checking' || updateState === 'downloading' || updateState === 'ready' ? 'default' : 'pointer',
                      fontSize: 14, fontWeight: 500,
                      transition: 'background 0.2s', width: 'fit-content', opacity: updateState === 'ready' ? 0.5 : 1
                    }}
                    onMouseEnter={(e) => {
                      if (updateState === 'idle' || updateState === 'none') e.currentTarget.style.background = 'var(--bg-item)'
                    }}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-sidebar)'}
                  >
                    {updateState === 'checking' ? 'Checking…' :
                     updateState === 'downloading' ? 'Downloading…' :
                     updateState === 'ready' ? 'Restart to Update' :
                     'Check for Updates'}
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'Keybindings' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-active)' }}>Keyboard Shortcuts</div>
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
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'Data' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#f87171' }}>Danger Zone</div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, background: 'rgba(248, 113, 113, 0.05)', padding: 16, borderRadius: 8, border: '1px solid rgba(248, 113, 113, 0.2)' }}>
                  <h3 style={{ fontSize: 14, margin: 0, color: '#f87171', fontWeight: 600 }}>Clear All Data</h3>
                  <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: 0, lineHeight: 1.5 }}>
                    This will permanently delete all workspaces, terminals, browser panes, settings, and preferences. 
                    The application will immediately restart after clearing. This action cannot be undone.
                  </p>
                  <button
                    onClick={async () => {
                      if (window.confirm('Are you absolutely sure you want to clear all data? This cannot be undone.')) {
                        try {
                          await invoke('clear_database')
                          localStorage.clear()
                          window.location.reload()
                        } catch (err) {
                          console.error('Failed to clear database:', err)
                          useAppStore.getState().addToast('Failed to clear data', 'error')
                        }
                      }
                    }}
                    style={{
                      padding: '8px 16px', background: '#f87171', marginTop: 8,
                      border: 'none', borderRadius: 6,
                      color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600,
                      transition: 'opacity 0.2s', width: 'fit-content'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.opacity = '0.9'}
                    onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
                  >
                    Clear All Data
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ 
          padding: '16px 32px', 
          borderTop: '1px solid var(--border-inactive)',
          display: 'flex', justifyContent: 'flex-end', gap: 12,
          background: 'var(--bg-sidebar)'
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 20px', background: 'transparent',
              border: '1px solid var(--border-inactive)', borderRadius: 6,
              color: 'var(--text-inactive)', cursor: 'pointer', fontSize: 14, fontWeight: 500,
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-item)'; e.currentTarget.style.color = 'var(--text-active)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-inactive)' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            style={{
              padding: '8px 24px', background: 'var(--accent)',
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
