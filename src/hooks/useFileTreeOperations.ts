import { useState, useCallback } from 'react'
import { writeTextFile, mkdir, rename, remove } from '@tauri-apps/plugin-fs'
import { invoke } from '../utils/tauri'
import { useAppStore } from '../store/useAppStore'
import type { Terminal } from '../types'

export interface NodeRef {
  path: string
  name: string
  isDirectory: boolean
  depth: number
}

export interface InlineInputState {
  mode: 'create-file' | 'create-folder' | 'rename' | 'duplicate'
  parentPath: string
  node?: NodeRef
}

interface UseFileTreeOperationsParams {
  workspaceId: string
  onRefreshDir: (dirPath: string) => Promise<void>
}

function parentOf(path: string) {
  return path.split('/').slice(0, -1).join('/')
}

export function useFileTreeOperations({ workspaceId, onRefreshDir }: UseFileTreeOperationsParams) {
  const [inlineInput, setInlineInput] = useState<InlineInputState | null>(null)
  const [pendingDelete, setPendingDelete] = useState<NodeRef | null>(null)
  const [error, setError] = useState<string | null>(null)

  const openCreateFile = useCallback((parentPath: string) => {
    setError(null)
    setInlineInput({ mode: 'create-file', parentPath })
  }, [])

  const openCreateFolder = useCallback((parentPath: string) => {
    setError(null)
    setInlineInput({ mode: 'create-folder', parentPath })
  }, [])

  const openRename = useCallback((node: NodeRef) => {
    setError(null)
    setInlineInput({ mode: 'rename', parentPath: parentOf(node.path), node })
  }, [])

  const openDuplicate = useCallback((node: NodeRef) => {
    setError(null)
    setInlineInput({ mode: 'duplicate', parentPath: parentOf(node.path), node })
  }, [])

  const closeInlineInput = useCallback(() => {
    setInlineInput(null)
    setError(null)
  }, [])

  const commitInlineInput = useCallback(async (name: string) => {
    if (!inlineInput || !name.trim()) return
    const { mode, parentPath, node } = inlineInput
    const trimmed = name.trim()
    if (trimmed.includes('/') || trimmed.includes('\\') || trimmed === '..' || trimmed.startsWith('../')) {
      setError('Invalid filename: cannot contain path separators or traversal sequences')
      return
    }
    try {
      if (mode === 'create-file') {
        await writeTextFile(`${parentPath}/${trimmed}`, '')
      } else if (mode === 'create-folder') {
        await mkdir(`${parentPath}/${trimmed}`)
      } else if (mode === 'rename' && node) {
        await rename(node.path, `${parentPath}/${trimmed}`)
      } else if (mode === 'duplicate' && node) {
        await invoke('duplicate_file', { source: node.path, newPath: `${parentPath}/${trimmed}` })
      }
      await onRefreshDir(parentPath)
      setInlineInput(null)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [inlineInput, onRefreshDir])

  const requestDelete = useCallback((node: NodeRef) => {
    setError(null)
    setPendingDelete(node)
  }, [])

  const cancelDelete = useCallback(() => setPendingDelete(null), [])

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return
    const parentPath = parentOf(pendingDelete.path)
    try {
      if (pendingDelete.isDirectory) {
        await remove(pendingDelete.path, { recursive: true })
      } else {
        await remove(pendingDelete.path)
      }
      setPendingDelete(null)
      setError(null)
      await onRefreshDir(parentPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [pendingDelete, onRefreshDir])

  const copyPath = useCallback(async (path: string) => {
    await navigator.clipboard.writeText(path)
  }, [])

  const openInTerminal = useCallback(async (path: string) => {
    try {
      const terminal = await invoke<Terminal>('spawn_terminal', {
        workspaceId,
        shell: 'zsh',
        cwd: path,
      })
      useAppStore.getState().addTerminal(workspaceId, terminal)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [workspaceId])

  const clearError = useCallback(() => setError(null), [])

  return {
    inlineInput,
    pendingDelete,
    error,
    openCreateFile,
    openCreateFolder,
    openRename,
    openDuplicate,
    closeInlineInput,
    commitInlineInput,
    requestDelete,
    cancelDelete,
    confirmDelete,
    copyPath,
    openInTerminal,
    clearError,
  }
}
