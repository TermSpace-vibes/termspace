import { useEffect, useCallback } from 'react'
import { invoke } from '../utils/tauri'
import { useAppStore } from '../store/useAppStore'
import { matchShortcut } from '../utils/shortcuts'
import { Terminal as TerminalType } from '../types'

export function useKeybindingHandler() {
  const settings = useAppStore((s) => s.settings)
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId)
  const activeTabIds = useAppStore((s) => s.activeTabIds)
  const activeTabId = activeWorkspaceId ? activeTabIds[activeWorkspaceId] || activeWorkspaceId : null
  const activeTerminalId = useAppStore((s) => s.activeTerminalId)
  const terminalsByTab = useAppStore((s) => s.terminalsByTab)
  const addTerminal = useAppStore((s) => s.addTerminal)
  const removeTerminal = useAppStore((s) => s.removeTerminal)
  const setTerminalToCloseId = useAppStore((s) => s.setTerminalToCloseId)
  const setActiveTerminalId = useAppStore((s) => s.setActiveTerminalId)

  const terminals = activeWorkspaceId ? (terminalsByTab[activeTabId!] ?? []) : []

  const handleKeydown = useCallback((e: KeyboardEvent): boolean => {
    if (!activeWorkspaceId) return false
    
    const { keybindings } = settings

    if (matchShortcut(e, keybindings.commandPalette)) {
      e.preventDefault()
      useAppStore.getState().setShowCommandPalette(true)
      return true
    }

    if (matchShortcut(e, keybindings.newTerminal)) {
      e.preventDefault()
      if (terminals.length < 4) {
        let cwd = ''
        const activeTerminal = activeTerminalId ? terminals.find(t => t.id === activeTerminalId) : null
        if (activeTerminal) cwd = activeTerminal.cwd || ''

        const spawn = (finalCwd: string) => {
          invoke<TerminalType>('spawn_terminal', {
            workspaceId: activeWorkspaceId,
            shell: useAppStore.getState().settings.defaultShell || 'zsh',
            cwd: finalCwd,
          }).then((terminal) => {
            addTerminal(activeTabId!, terminal)
            setActiveTerminalId(terminal.id)
          }).catch(err => console.error('spawn_terminal failed:', err))
        }

        if (activeTerminalId) {
          invoke<string>('get_terminal_active_cwd', { id: activeTerminalId })
            .then(activeCwd => {
              spawn(activeCwd || cwd)
            })
            .catch(() => spawn(cwd))
        } else {
          spawn(cwd)
        }
      }
      return true
    }

    const isTerminalFocused = !!document.activeElement?.closest('.terminal-wrapper, .xterm, .terminal-pane, .xterm-helper-textarea')

    if (matchShortcut(e, keybindings.closeTerminal)) {
      if (isTerminalFocused || keybindings.closeTerminal !== (keybindings.closeTab || 'CmdOrCtrl+W')) {
        e.preventDefault()
        if (activeTerminalId) {
          invoke<boolean>('is_terminal_busy', { id: activeTerminalId })
            .then(isBusy => {
              if (isBusy) {
                setTerminalToCloseId({ workspaceId: activeTabId!, terminalId: activeTerminalId })
              } else {
                invoke('close_terminal', { id: activeTerminalId, scrollback: [] }).catch(console.error)
                removeTerminal(activeTabId!, activeTerminalId)
                const remaining = terminals.filter((t) => t.id !== activeTerminalId)
                if (remaining.length > 0) {
                  setActiveTerminalId(remaining[remaining.length - 1].id)
                } else {
                  setActiveTerminalId(null)
                }
              }
            })
            .catch(err => {
              console.error(err)
              setTerminalToCloseId({ workspaceId: activeTabId!, terminalId: activeTerminalId })
            })
        }
        return true
      }
    }

    if (matchShortcut(e, keybindings.closeTab || 'CmdOrCtrl+W')) {
      e.preventDefault()
      const store = useAppStore.getState()
      const editorPanes = store.editorPanesByTab[activeTabId!] || []
      const activeFile = store.activeFileByTab[activeTabId!]
      if (activeFile) {
        const pane = editorPanes.find(p => p.openFiles.includes(activeFile))
        if (pane) {
          store.closeEditorFile(activeTabId!, pane.id, activeFile)
        }
      }
      return true
    }

    if (matchShortcut(e, keybindings.toggleSidebar || 'CmdOrCtrl+B')) {
      e.preventDefault()
      window.dispatchEvent(new CustomEvent('termspace:toggle-sidebar'))
      return true
    }

    if (matchShortcut(e, 'CmdOrCtrl+J')) {
      e.preventDefault()
      const state = useAppStore.getState()
      state.updateSettings({ showToolingPane: !state.settings.showToolingPane })
      return true
    }

    if (matchShortcut(e, keybindings.searchFiles || 'CmdOrCtrl+Shift+F')) {
      e.preventDefault()
      useAppStore.getState().setShowCommandPalette(true)
      return true
    }

    if (matchShortcut(e, keybindings.openSettings || 'CmdOrCtrl+,')) {
      e.preventDefault()
      window.dispatchEvent(new CustomEvent('termspace:open-settings'))
      return true
    }

    if (matchShortcut(e, keybindings.switchTab || 'Ctrl+Tab')) {
      e.preventDefault()
      const store = useAppStore.getState()
      const editorPanes = store.editorPanesByTab[activeTabId!] || []
      const activeFile = store.activeFileByTab[activeTabId!]
      if (activeFile && editorPanes.length > 0) {
        const pane = editorPanes.find(p => p.openFiles.includes(activeFile)) || editorPanes[0]
        if (pane && pane.openFiles.length > 1) {
          const idx = pane.openFiles.indexOf(activeFile)
          const nextIdx = (idx + 1) % pane.openFiles.length
          store.updateEditorPaneFile(activeTabId!, pane.id, pane.openFiles[nextIdx])
        }
      }
      return true
    }

    if (matchShortcut(e, keybindings.splitEditor || 'CmdOrCtrl+\\')) {
      e.preventDefault()
      const store = useAppStore.getState()
      const editorPanes = store.editorPanesByTab[activeTabId!] || []
      const activeFile = store.activeFileByTab[activeTabId!]
      if (activeFile && editorPanes.length > 0) {
        const pane = editorPanes.find(p => p.openFiles.includes(activeFile)) || editorPanes[0]
        if (pane) {
          store.splitEditor(activeTabId!, pane.id, 'horizontal')
        }
      }
      return true
    }

    if (matchShortcut(e, keybindings.nextTerminal)) {
      e.preventDefault()
      if (terminals.length > 1 && activeTerminalId) {
        const idx = terminals.findIndex(t => t.id === activeTerminalId)
        if (idx !== -1) {
          const nextIdx = (idx + 1) % terminals.length
          setActiveTerminalId(terminals[nextIdx].id)
        }
      }
      return true
    }

    if (matchShortcut(e, keybindings.prevTerminal)) {
      e.preventDefault()
      if (terminals.length > 1 && activeTerminalId) {
        const idx = terminals.findIndex(t => t.id === activeTerminalId)
        if (idx !== -1) {
          const prevIdx = (idx - 1 + terminals.length) % terminals.length
          setActiveTerminalId(terminals[prevIdx].id)
        }
      }
      return true
    }

    if (matchShortcut(e, keybindings.toggleDictation || 'CmdOrCtrl+Shift+M')) {
      if (e.repeat) return false
      if (
        settings.globalDictationEnabled &&
        (settings.globalDictationHotkey || 'CmdOrCtrl+Shift+M') === (keybindings.toggleDictation || 'CmdOrCtrl+Shift+M')
      ) {
        return false
      }
      e.preventDefault()
      window.dispatchEvent(new CustomEvent('termspace:toggle-dictation'))
      return true
    }

    return false
  }, [activeWorkspaceId, activeTerminalId, settings, terminals, addTerminal, removeTerminal, setTerminalToCloseId, setActiveTerminalId])

  return handleKeydown
}

export function useGlobalKeybindings() {
  const handler = useKeybindingHandler()

  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      handler(e)
    }
    window.addEventListener('keydown', listener, { capture: true })
    return () => window.removeEventListener('keydown', listener, { capture: true })
  }, [handler])
}
