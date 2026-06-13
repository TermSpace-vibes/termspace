import React, { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SerializeAddon } from '@xterm/addon-serialize'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { DRAG_FORMAT_TERMINAL } from '../../utils/constants'
import { invoke, listen } from '../../utils/tauri'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useAppStore } from '../../store/useAppStore'
import '@xterm/xterm/css/xterm.css'
import { writeText, readText } from '@tauri-apps/plugin-clipboard-manager'

interface Props {
  terminalId: string
  workspaceId: string
  isActive: boolean
  isMaximized: boolean
  scrollback?: string[]
  onFocus: (id: string) => void
  onToggleMaximize: (id: string) => void
  onClose: (id: string) => void
  onSplit: (id: string, direction: 'horizontal' | 'vertical') => void
  isDragOver?: boolean
}

const XTERM_THEMES = {
  'warm-dark': {
    background: 'transparent',
    foreground: '#cccccc',
    cursor: '#06b6d4',
    cursorAccent: '#1c1c1c',
    selectionBackground: 'rgba(6,182,212,0.3)',
  },
  'cold-dark': {
    background: 'transparent',
    foreground: '#c0caf5',
    cursor: '#7dcfff',
    cursorAccent: '#1a1b26',
    selectionBackground: 'rgba(125,207,255,0.3)',
  },
  'light': {
    background: 'transparent',
    foreground: '#171717',
    cursor: '#0891b2',
    cursorAccent: '#ffffff',
    selectionBackground: 'rgba(8,145,178,0.3)',
  },
  'catppuccin-mocha': {
    background: 'transparent',
    foreground: '#cdd6f4',
    cursor: '#89b4fa',
    cursorAccent: '#1e1e2e',
    selectionBackground: 'rgba(137,180,250,0.3)',
    black: '#45475a',
    red: '#f38ba8',
    green: '#a6e3a1',
    yellow: '#f9e2af',
    blue: '#89b4fa',
    magenta: '#f5c2e7',
    cyan: '#94e2d5',
    white: '#bac2de',
    brightBlack: '#585b70',
    brightRed: '#f38ba8',
    brightGreen: '#a6e3a1',
    brightYellow: '#f9e2af',
    brightBlue: '#89b4fa',
    brightMagenta: '#f5c2e7',
    brightCyan: '#94e2d5',
    brightWhite: '#a6adc8',
  },
  'synthwave': {
    background: 'transparent',
    foreground: '#ff7edb',
    cursor: '#36f9f6',
    cursorAccent: '#2b213a',
    selectionBackground: 'rgba(54,249,246,0.3)',
    black: '#000000',
    red: '#fe4450',
    green: '#72f1b8',
    yellow: '#f3e70f',
    blue: '#03edf9',
    magenta: '#ff7edb',
    cyan: '#03edf9',
    white: '#ffffff',
    brightBlack: '#848bbd',
    brightRed: '#fe4450',
    brightGreen: '#72f1b8',
    brightYellow: '#f3e70f',
    brightBlue: '#03edf9',
    brightMagenta: '#ff7edb',
    brightCyan: '#03edf9',
    brightWhite: '#ffffff',
  },
  'fruity': {
    background: 'transparent',
    foreground: '#f8f8f2',
    cursor: '#ff79c6',
    cursorAccent: '#1e1e1e',
    selectionBackground: 'rgba(255,121,198,0.3)',
    black: '#424242',
    red: '#ff1744',
    green: '#00e676',
    yellow: '#ffea00',
    blue: '#2979ff',
    magenta: '#d500f9',
    cyan: '#00e5ff',
    white: '#ffffff',
    brightBlack: '#757575',
    brightRed: '#ff5252',
    brightGreen: '#69f0ae',
    brightYellow: '#ffff00',
    brightBlue: '#448aff',
    brightMagenta: '#e040fb',
    brightCyan: '#18ffff',
    brightWhite: '#ffffff',
  }
}

import { useKeybindingHandler } from '../../hooks/useGlobalKeybindings'

const scrollbackCache = new Map<string, string[]>()

const writeTerminalChunked = async (terminalId: string, data: string) => {
  const CHUNK_SIZE = 4096;
  for (let i = 0; i < data.length; i += CHUNK_SIZE) {
    await invoke('write_terminal', { terminalId, data: data.slice(i, i + CHUNK_SIZE) });
    if (i + CHUNK_SIZE < data.length) {
      await new Promise(r => setTimeout(r, 1));
    }
  }
}

export const TerminalPane = React.memo(function TerminalPane({ terminalId, workspaceId, isActive, isMaximized, scrollback, onFocus, onToggleMaximize, onClose, onSplit, isDragOver }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const unlistenRef = useRef<Promise<() => void> | null>(null)
  // Removed isHovered state
  
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  
  const setDraggedTerminalId = useAppStore(s => s.setDraggedTerminalId)
  const terminal = useAppStore(s => s.terminalsByWorkspace[workspaceId]?.find(t => t.id === terminalId))
  const terminalIndex = useAppStore(s => s.terminalsByWorkspace[workspaceId]?.findIndex(t => t.id === terminalId)) ?? -1
  const defaultTitle = `Terminal ${terminalIndex >= 0 ? terminalIndex + 1 : ''}`.trim()
  const renameTerminal = useAppStore(s => s.renameTerminal)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editTitleValue, setEditTitleValue] = useState('')
  const [gitBranch, setGitBranch] = useState<string | null>(null)

  useEffect(() => {
    if (!terminal?.cwd) {
      setGitBranch(null)
      return
    }
    invoke<string>('get_git_branch', { cwd: terminal.cwd })
      .then(branch => setGitBranch(branch))
      .catch(() => setGitBranch(null))
  }, [terminal?.cwd])

  const formatCwd = (path: string) => {
    if (!path) return ''
    return path.replace(/^\/Users\/[^\/]+/, '~').replace(/^\/home\/[^\/]+/, '~')
  }

  const handleTitleSave = () => {
    setIsEditingTitle(false)
    if (editTitleValue.trim() !== terminal?.title) {
      renameTerminal(workspaceId, terminalId, editTitleValue.trim())
      invoke('rename_terminal', { id: terminalId, title: editTitleValue.trim() }).catch(console.error)
    }
  }

  const settings = useAppStore((s) => s.settings)
  const keybindingHandler = useKeybindingHandler()
  const keybindingHandlerRef = useRef(keybindingHandler)

  useEffect(() => {
    keybindingHandlerRef.current = keybindingHandler
  }, [keybindingHandler])

  // Apply settings to XTerm whenever they change
  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.theme = XTERM_THEMES[settings.theme]
      xtermRef.current.options.fontSize = settings.fontSize
      xtermRef.current.options.fontFamily = settings.terminalFontFamily || '"JetBrains Mono", "Fira Code", Menlo, monospace'
    }
  }, [settings])

  useEffect(() => {
    if (!containerRef.current) return

    const xterm = new XTerm({
      theme: XTERM_THEMES[settings.theme],
      allowTransparency: true,
      fontFamily: settings.terminalFontFamily || '"JetBrains Mono", "Fira Code", Menlo, monospace',
      fontSize: settings.fontSize,
      lineHeight: settings.lineHeight || 1.2,
      cursorBlink: true,
      macOptionIsMeta: true,
    })

    const fitAddon = new FitAddon()
    const serializeAddon = new SerializeAddon()
    const searchAddon = new SearchAddon()
    xterm.loadAddon(fitAddon)
    xterm.loadAddon(serializeAddon)
    xterm.loadAddon(searchAddon)
    searchAddonRef.current = searchAddon

    const webLinksAddon = new WebLinksAddon((_event, uri) => {
      useAppStore.getState().addBrowserPane(workspaceId, {
        id: crypto.randomUUID(),
        workspaceId,
        url: uri,
        position: 0,
        createdAt: Date.now()
      }, terminalId, 'vertical')
    })
    xterm.loadAddon(webLinksAddon)

    xterm.registerLinkProvider({
      provideLinks: (bufferLineNumber, callback) => {
        const line = xterm.buffer.active.getLine(bufferLineNumber - 1)?.translateToString(true)
        if (!line) {
          callback([])
          return
        }

        const links: any[] = []
        const regex = /(?:^|\s|\"|\')((?:\.\/|\/|~\|[a-zA-Z]:\\)?[^\s"']+\.md)(?:\s|\"|\'|$)/g
        let match
        while ((match = regex.exec(line)) !== null) {
          links.push({
            range: {
              start: { x: match.index + 1 + (match[0].length - match[1].length), y: bufferLineNumber },
              end: { x: match.index + (match[0].length - match[1].length) + match[1].length, y: bufferLineNumber }
            },
            text: match[1],
            activate: (_e: any, text: string) => {
               let fullPath = text
               const existingEditor = useAppStore.getState().editorPanesByWorkspace[workspaceId]?.[0]
               const rootPath = existingEditor?.rootPath || terminal?.cwd || ''
               
               if (rootPath) {
                 if (text.startsWith('./')) {
                   fullPath = `${rootPath}/${text.slice(2)}`
                 } else if (!text.startsWith('/')) {
                   fullPath = `${rootPath}/${text}`
                 }
               }
               
               const editorPanes = useAppStore.getState().editorPanesByWorkspace[workspaceId] || []
               if (editorPanes.length > 0) {
                 useAppStore.getState().updateEditorPaneFile(workspaceId, editorPanes[0].id, fullPath)
               } else {
                 if (rootPath) {
                   useAppStore.getState().addEditorPane(workspaceId, {
                     id: crypto.randomUUID(),
                     workspaceId,
                     rootPath,
                     openFiles: [fullPath],
                     activeFilePath: fullPath,
                     mruStack: [fullPath],
                     fileTreeWidth: 20,
                     position: 0,
                     createdAt: Date.now()
                   }, terminalId, 'vertical')
                 }
               }
            }
          })
        }
        callback(links)
      }
    })
    
    xterm.parser.registerOscHandler(7, (data) => {
      const match = data.match(/^file:\/\/[^\/]*(\/.*)$/)
      if (match) {
        let newCwd = match[1]
        try {
          newCwd = decodeURI(newCwd)
        } catch (e) {
          // ignore decoding errors
        }
        useAppStore.getState().updateTerminalCwd(workspaceId, terminalId, newCwd)
        invoke('update_terminal_cwd', { id: terminalId, cwd: newCwd }).catch(console.error)
      }
      return true
    })

    xterm.parser.registerOscHandler(99, (data) => {
      if (data === 'NeedsAttention=1') {
        const currentCount = useAppStore.getState().terminalsByWorkspace[workspaceId]?.find(t => t.id === terminalId)?.notificationCount || 0
        useAppStore.getState().setTerminalNotification(workspaceId, terminalId, currentCount + 1)
      } else if (data === 'NeedsAttention=0') {
        useAppStore.getState().setTerminalNotification(workspaceId, terminalId, 0)
      }
      return true
    })
    
    const handleFocus = () => {
      useAppStore.getState().setTerminalNotification(workspaceId, terminalId, 0)
      getCurrentWindow().requestUserAttention(null).catch(() => {})
    }
    containerRef.current.addEventListener('focusin', handleFocus)
    
    xterm.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown') {
        // Handle Cmd+C (Copy)
        if (e.metaKey && e.key.toLowerCase() === 'c') {
          if (xterm.hasSelection()) {
            writeText(xterm.getSelection())
            xterm.clearSelection()
            return false
          }
        }

        // Handle Cmd+V (Paste)
        if (e.metaKey && e.key.toLowerCase() === 'v') {
          readText().then(text => {
            if (text) {
              const sanitizedText = text.replace(/\r?\n/g, '\r');
              writeTerminalChunked(terminalId, sanitizedText).catch(console.error)
            }
          }).catch(console.error)
          return false
        }

        // Handle Cmd+A (Select All)
        if (e.metaKey && e.key.toLowerCase() === 'a') {
          xterm.selectAll()
          return false
        }

        // Cmd/Ctrl + F to toggle search
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
          e.preventDefault()
          setShowSearch(true)
          setTimeout(() => searchInputRef.current?.focus(), 50)
          return false
        }

        // Force explicit backspace handling to bypass any xterm/DOM swallowing
        if (e.key === 'Backspace') {
          if (e.altKey) {
            // Option+Backspace deletes word
            invoke('write_terminal', { terminalId, data: '\x1b\x7f' }).catch(console.error)
          } else if (e.metaKey) {
            // Cmd+Backspace deletes line (Ctrl+U)
            invoke('write_terminal', { terminalId, data: '\x15' }).catch(console.error)
          } else {
            invoke('write_terminal', { terminalId, data: '\x7f' }).catch(console.error)
          }
          return false // Tell xterm to not process it natively
        }
        
        // Handle Option + Arrow keys for word navigation
        if (e.altKey && e.key === 'ArrowLeft') {
          invoke('write_terminal', { terminalId, data: '\x1bb' }).catch(console.error)
          return false
        }
        if (e.altKey && e.key === 'ArrowRight') {
          invoke('write_terminal', { terminalId, data: '\x1bf' }).catch(console.error)
          return false
        }
        
        const handled = keybindingHandlerRef.current(e)
        if (handled) return false // Tell xterm not to process this key
      }
      return true
    })

    xterm.open(containerRef.current)
    fitAddon.fit()
    xtermRef.current = xterm

    // replay saved scrollback
    const cachedLines = scrollbackCache.get(terminalId) || scrollback
    if (cachedLines && cachedLines.length > 0) {
      xterm.write(cachedLines.join('\n'))
    }

    xterm.focus()

    // send keystrokes to PTY
    const onDataDispose = xterm.onData((data) => {
      writeTerminalChunked(terminalId, data).catch(console.error)
    })

    // Attach listener first, then tell Rust to start streaming — prevents
    // the shell's initial prompt from being emitted before anyone is listening.
    let outputBuffer = ''
    
    const triggerAttention = () => {
      const currentCount = useAppStore.getState().terminalsByWorkspace[workspaceId]?.find(t => t.id === terminalId)?.notificationCount || 0
      useAppStore.getState().setTerminalNotification(workspaceId, terminalId, currentCount + 1)
      if (!document.hasFocus() || !isActive) {
        getCurrentWindow().requestUserAttention(1).catch(() => {}) // 1 = Critical (continuous bounce until focused)
        
        const existingToasts = useAppStore.getState().toasts
        if (!existingToasts.some(t => t.message === 'Agy in workspace wants your input')) {
          useAppStore.getState().addToast(
            'Agy in workspace wants your input',
            'info',
            {
              label: 'Check',
              onClick: () => {
                useAppStore.getState().setActiveWorkspaceId(workspaceId)
                onFocus(terminalId)
                setTimeout(() => xtermRef.current?.focus(), 100)
              }
            }
          )
        }
      }
    }
    
    xterm.onBell(() => triggerAttention())

    unlistenRef.current = listen<string>(`pty-output-${terminalId}`, (e) => {
      xterm.write(e.payload)
      
      // Buffer output to detect prompts if terminal is not actively focused
      if (!containerRef.current?.contains(document.activeElement)) {
        outputBuffer += e.payload
        if (outputBuffer.length > 1000) outputBuffer = outputBuffer.slice(-1000)
        
        // Match common agent and cli prompts
        if (/(Do you want to proceed\?|\[Y\/n\]|\[y\/N\]|\(y\/n\)|\bConfirm\b.*\?|Please select|Select an option|Requesting permission for:)/i.test(outputBuffer)) {
          triggerAttention()
          outputBuffer = '' // reset to avoid multiple triggers
        }
      }
    })
    unlistenRef.current.then(() => {
      invoke('start_terminal', { terminalId }).catch(console.error)
    })

    // Custom auto-scrolling for drag selection
    let scrollInterval: ReturnType<typeof setInterval> | null = null
    let lastMouseX = 0
    let lastMouseY = 0

    const handleGlobalMouseMove = (e: MouseEvent) => {
      lastMouseX = e.clientX
      lastMouseY = e.clientY
      
      if (e.buttons !== 1) {
        if (scrollInterval) { clearInterval(scrollInterval); scrollInterval = null }
        return
      }
      
      const rect = containerRef.current?.getBoundingClientRect()
      // Only auto-scroll if xterm already has a selection started
      if (!rect || !xtermRef.current?.hasSelection()) return
      
      const threshold = 40
      let scrollDir = 0
      
      // Check if within horizontal bounds (with some leeway)
      if (e.clientX >= rect.left - 50 && e.clientX <= rect.right + 50) {
        // Near top edge
        if (e.clientY <= rect.top + threshold) {
          scrollDir = -1
        } 
        // Near bottom edge
        else if (e.clientY >= rect.bottom - threshold) {
          scrollDir = 1
        }
      }
      
      if (scrollDir !== 0) {
        if (!scrollInterval) {
          scrollInterval = setInterval(() => {
            if (xtermRef.current) {
              xtermRef.current.scrollLines(scrollDir)
              // Trigger a synthetic mouse event to update xterm's selection state during scroll
              const evt = new MouseEvent('mousemove', {
                clientX: lastMouseX,
                clientY: lastMouseY,
                buttons: 1,
                bubbles: true,
                cancelable: true,
                view: window
              })
              // Target the inner screen element which handles xterm selection
              const screen = containerRef.current?.querySelector('.xterm-screen') || containerRef.current
              screen?.dispatchEvent(evt)
            }
          }, 50)
        }
      } else {
        if (scrollInterval) { clearInterval(scrollInterval); scrollInterval = null }
      }
    }
    
    const handleGlobalMouseUp = () => {
      if (scrollInterval) { clearInterval(scrollInterval); scrollInterval = null }
    }
    
    document.addEventListener('mousemove', handleGlobalMouseMove)
    document.addEventListener('mouseup', handleGlobalMouseUp)

    // resize observer keeps cols/rows in sync with DOM
    const ro = new ResizeObserver((entries) => {
      if (!entries.length || entries[0].contentRect.width === 0) return

      try {
        fitAddon.fit()
        invoke('resize_terminal', { terminalId, cols: xterm.cols, rows: xterm.rows }).catch(console.error)
      } catch (e) {
        console.warn('fit() failed', e)
      }
    })
    ro.observe(containerRef.current)

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove)
      document.removeEventListener('mouseup', handleGlobalMouseUp)
      if (scrollInterval) clearInterval(scrollInterval)
      
      onDataDispose.dispose()
      unlistenRef.current?.then((fn) => fn()).catch(() => {})
      ro.disconnect()
      const lines = serializeAddon.serialize().split('\n')
      scrollbackCache.set(terminalId, lines)
      // Only save scrollback on unmount, do NOT kill the backend process
      // because unmount happens naturally when layout is reparented or workspace switched.
      invoke('save_scrollback', { id: terminalId, scrollback: lines }).catch(console.error)
      xterm.dispose()
      // Note: removeTerminal is intentionally NOT called here.
      // The parent (App.tsx activateWorkspace) owns terminal lifecycle in the store.
      if (containerRef.current) {
        containerRef.current.removeEventListener('focusin', handleFocus)
      }
    }
  }, [terminalId, workspaceId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isActive) xtermRef.current?.focus()
  }, [isActive])

  return (
    <div
      onClick={() => onFocus(terminalId)}

      onContextMenu={(e) => {
        // Only trigger our context menu if clicking near the top/edges, not inside the actual terminal text area
        // to preserve native copy/paste context menus. Or we just allow it on the container.
        // Actually xterm intercepts right clicks in its text area! So container right-click is fine.
        e.preventDefault()
        e.stopPropagation()
        
        const menuItems: any[] = []
        
        if (xtermRef.current?.hasSelection()) {
          menuItems.push({
            label: 'Copy',
            icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>,
            onClick: () => {
              const text = xtermRef.current?.getSelection()
              if (text) {
                writeText(text)
                xtermRef.current?.clearSelection()
              }
            }
          })
        }
        
        menuItems.push({
          label: 'Paste',
          icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>,
          onClick: () => {
            readText().then(text => {
              if (text) {
                const sanitizedText = text.replace(/\r?\n/g, '\r');
                writeTerminalChunked(terminalId, sanitizedText).catch(console.error)
              }
            }).catch(console.error)
          }
        })
        
        menuItems.push({ separator: true, label: '', onClick: () => {} })

        menuItems.push(
          {
            label: 'Clear Output',
            icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>,
            onClick: () => {
              xtermRef.current?.clear()
            }
          },
          { separator: true, label: '', onClick: () => {} },
          {
            label: 'Split Down',
            icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="12" x2="21" y2="12"></line></svg>,
            onClick: () => onSplit(terminalId, 'vertical')
          },
          {
            label: 'Split Right',
            icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="12" y1="3" x2="12" y2="21"></line></svg>,
            onClick: () => onSplit(terminalId, 'horizontal')
          },
          { separator: true, label: '', onClick: () => {} },
          {
            label: isMaximized ? 'Restore' : 'Maximize',
            icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>,
            onClick: () => onToggleMaximize(terminalId)
          },
          {
            label: 'Close Terminal',
            danger: true,
            icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>,
            onClick: () => onClose(terminalId)
          }
        )

        useAppStore.getState().showContextMenu(e.clientX, e.clientY, menuItems)
      }}
      style={{
        width: '100%', height: '100%',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden', borderRadius: 0,
        border: isDragOver 
          ? '2px dashed var(--accent)' 
          : (isActive ? '2px solid color-mix(in srgb, var(--accent) 40%, transparent)' : '2px solid transparent'),
        boxShadow: isDragOver
          ? '0 8px 24px rgba(0,0,0,0.15)'
          : 'none',
        background: XTERM_THEMES[settings.theme as keyof typeof XTERM_THEMES]?.background || 'var(--bg-terminal)', cursor: 'text',
        position: 'relative',
        transition: 'border 0.2s',
        opacity: isDragOver ? 0.7 : 1,
      }}
    >
      {showSearch && (
        <div
          style={{
            position: 'absolute', top: 10, right: 10, zIndex: 20,
            background: 'var(--bg-sidebar)', border: '1px solid var(--border-inactive)',
            borderRadius: 6, padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 6,
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
          }}
          onClick={e => e.stopPropagation()}
        >
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Find..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              searchAddonRef.current?.findNext(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (e.shiftKey) searchAddonRef.current?.findPrevious(searchQuery)
                else searchAddonRef.current?.findNext(searchQuery)
              }
              if (e.key === 'Escape') {
                setShowSearch(false)
                xtermRef.current?.focus()
              }
            }}
            style={{
              background: 'transparent', border: 'none', color: 'var(--text-active)',
              outline: 'none', fontSize: 13, width: 150
            }}
          />
          <button
            onClick={() => searchAddonRef.current?.findPrevious(searchQuery)}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-inactive)', cursor: 'pointer', padding: 2 }}
            title="Find Previous (Shift+Enter)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
          </button>
          <button
            onClick={() => searchAddonRef.current?.findNext(searchQuery)}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-inactive)', cursor: 'pointer', padding: 2 }}
            title="Find Next (Enter)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </button>
          <div style={{ width: 1, height: 16, background: 'var(--border-inactive)', margin: '0 2px' }} />
          <button
            onClick={() => {
              setShowSearch(false)
              xtermRef.current?.focus()
            }}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-inactive)', cursor: 'pointer', padding: 2 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      )}
      {!showSearch && (
        <div
          style={{
            display: 'flex', alignItems: 'center', padding: '0 16px', height: 32,
            background: 'transparent',
            borderBottom: '1px solid var(--border-inactive)',
            flexShrink: 0
          }}
        >
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', marginRight: 10 }} />
          
          {isEditingTitle ? (
            <input
              autoFocus
              value={editTitleValue}
              onChange={e => setEditTitleValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleTitleSave()
                if (e.key === 'Escape') setIsEditingTitle(false)
              }}
              onBlur={handleTitleSave}
              style={{
                background: 'transparent', border: 'none', outline: 'none', color: 'var(--accent)',
                fontSize: 10, letterSpacing: 1, width: 120, fontFamily: 'SF Mono, Menlo, monospace', textTransform: 'uppercase'
              }}
            />
          ) : (
            <div
              onDoubleClick={() => {
                setEditTitleValue(terminal?.title || defaultTitle)
                setIsEditingTitle(true)
              }}
              style={{
                fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1,
                cursor: 'text', userSelect: 'none', fontWeight: 600, fontFamily: 'SF Mono, Menlo, monospace',
                position: 'relative'
              }}
            >
              {terminal?.title || defaultTitle}
              {(terminal?.notificationCount ?? 0) > 0 && (
                <span style={{
                  position: 'absolute', top: -6, right: -12, background: '#ef4444', color: 'white',
                  fontSize: 9, fontWeight: 'bold', padding: '1px 4px', borderRadius: 10,
                  lineHeight: 1, minWidth: 14, textAlign: 'center', display: 'inline-block'
                }}>
                  {terminal?.notificationCount && terminal.notificationCount > 99 ? '99+' : terminal?.notificationCount}
                </span>
              )}
            </div>
          )}

          <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 16, fontFamily: 'SF Mono, Menlo, monospace', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {formatCwd(terminal?.cwd || '')}{gitBranch ? <span style={{ opacity: 0.5 }}> · {gitBranch}</span> : ''}
          </span>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div
              draggable
              onDragStart={(e) => {
                e.stopPropagation()
                e.dataTransfer.setData(DRAG_FORMAT_TERMINAL, terminalId)
                e.dataTransfer.effectAllowed = 'move'
                setDraggedTerminalId(terminalId)
              }}
              onDragEnd={() => {
                setDraggedTerminalId(null)
              }}
              title="Drag to reorder"
              style={{ color: 'var(--text-dim)', cursor: 'grab', display: 'flex', marginRight: 4 }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--text-active)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-dim)'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/></svg>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); onSplit(terminalId, 'horizontal') }}
              title="Split Right"
              style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', display: 'flex' }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--text-active)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-dim)'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="12" y1="3" x2="12" y2="21"></line></svg>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onSplit(terminalId, 'vertical') }}
              title="Split Down"
              style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', display: 'flex' }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--text-active)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-dim)'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="12" x2="21" y2="12"></line></svg>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onToggleMaximize(terminalId) }}
              title={isMaximized ? "Restore" : "Maximize"}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--accent)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-dim)'}
            >
              {isMaximized ? '↙' : '↗'}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onClose(terminalId) }}
              title="Close"
              style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 16, lineHeight: 1, paddingBottom: 2 }}
              onMouseEnter={e => e.currentTarget.style.color = '#e07b7b'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-dim)'}
            >
              ×
            </button>
          </div>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, padding: '4px 0 0 8px' }}>
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      </div>
    </div>
  )
})
