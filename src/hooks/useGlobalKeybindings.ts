import { useEffect, useCallback } from 'react'
import { invoke } from '../utils/tauri'
import { useAppStore } from '../store/useAppStore'
import { matchShortcut } from '../utils/shortcuts'
import { Terminal as TerminalType } from '../types'

export function useKeybindingHandler() {
  const settings = useAppStore((s) => s.settings)
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId)
  const activeTerminalId = useAppStore((s) => s.activeTerminalId)
  const terminalsByWorkspace = useAppStore((s) => s.terminalsByWorkspace)
  const addTerminal = useAppStore((s) => s.addTerminal)
  const removeTerminal = useAppStore((s) => s.removeTerminal)
  const setActiveTerminalId = useAppStore((s) => s.setActiveTerminalId)

  const terminals = activeWorkspaceId ? (terminalsByWorkspace[activeWorkspaceId] ?? []) : []

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
        invoke<TerminalType>('spawn_terminal', {
          workspaceId: activeWorkspaceId,
          shell: 'zsh',
          cwd: '',
        }).then((terminal) => {
          addTerminal(activeWorkspaceId, terminal)
          setActiveTerminalId(terminal.id)
        }).catch(err => console.error('spawn_terminal failed:', err))
      }
      return true
    }

    if (matchShortcut(e, keybindings.closeTerminal)) {
      e.preventDefault()
      if (activeTerminalId) {
        removeTerminal(activeWorkspaceId, activeTerminalId)
        const remaining = terminals.filter((t) => t.id !== activeTerminalId)
        if (remaining.length > 0) {
          setActiveTerminalId(remaining[remaining.length - 1].id)
        } else {
          setActiveTerminalId(null)
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

    return false
  }, [activeWorkspaceId, activeTerminalId, settings, terminals, addTerminal, removeTerminal, setActiveTerminalId])

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
