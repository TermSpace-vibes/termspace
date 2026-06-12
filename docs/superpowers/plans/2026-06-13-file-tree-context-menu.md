# File Tree Context Menu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a right-click context menu to `FileTree.tsx` supporting create file/folder, rename, delete (modal confirm), copy path, and open folder in terminal.

**Architecture:** `useFileTreeOperations` manages all fs-op state and calls `@tauri-apps/plugin-fs`. `useFileTreeContextMenu` manages menu position/visibility. `FileTreeContextMenu` renders the floating menu. `FileTreeInlineInput` renders an inline name input row. `FileTree.tsx` composes all four — it builds an augmented `FlatItem[]` discriminated union (tree nodes + inline-input sentinels) so the virtualizer handles the create/rename input row at the correct scroll position.

**Tech Stack:** React 18, TypeScript, `@tauri-apps/plugin-fs` (mkdir, writeTextFile, rename, remove), `invoke` from `src/utils/tauri.ts`, `framer-motion` AnimatePresence, Vitest + @testing-library/react

---

## File Map

| Status | File |
|--------|------|
| Create | `src/hooks/useFileTreeOperations.ts` |
| Create | `src/hooks/useFileTreeOperations.test.ts` |
| Create | `src/hooks/useFileTreeContextMenu.ts` |
| Create | `src/hooks/useFileTreeContextMenu.test.ts` |
| Create | `src/components/FileTreeContextMenu.tsx` |
| Create | `src/components/FileTreeContextMenu.test.tsx` |
| Create | `src/components/FileTreeInlineInput.tsx` |
| Modify | `src/components/FileTree.tsx` |
| Modify | `src/components/FileTree.test.tsx` |

---

## Task 1: `useFileTreeOperations` hook

**Files:**
- Create: `src/hooks/useFileTreeOperations.ts`
- Create: `src/hooks/useFileTreeOperations.test.ts`

Owns: inline input state (create/rename), pending delete state, all fs operations, error state. Calls `onRefreshDir(parentPath)` after each mutating op so the tree reloads the affected directory.

- [ ] **Step 1.1: Create the test file**

`src/hooks/useFileTreeOperations.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFileTreeOperations } from './useFileTreeOperations'
import * as pluginFs from '@tauri-apps/plugin-fs'
import * as tauriUtils from '../utils/tauri'
import { useAppStore } from '../store/useAppStore'

vi.mock('@tauri-apps/plugin-fs', () => ({
  writeTextFile: vi.fn(),
  mkdir: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('../utils/tauri', () => ({
  invoke: vi.fn(),
}))

vi.mock('../store/useAppStore', () => ({
  useAppStore: Object.assign(
    (selector: any) => selector(useAppStore.getState()),
    {
      getState: vi.fn(() => ({
        addTerminal: vi.fn(),
        settings: { defaultTerminalType: 'built-in' },
      })),
      setState: vi.fn(),
      subscribe: vi.fn(),
    }
  ),
}))

const mockFileNode = {
  path: '/project/src/index.ts',
  name: 'index.ts',
  isDirectory: false,
  depth: 2,
}
const mockDirNode = {
  path: '/project/src',
  name: 'src',
  isDirectory: true,
  depth: 1,
}

describe('useFileTreeOperations', () => {
  const onRefreshDir = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('openCreateFile sets inlineInput state', () => {
    const { result } = renderHook(() =>
      useFileTreeOperations({ workspaceId: 'ws-1', onRefreshDir })
    )
    act(() => result.current.openCreateFile('/project/src'))
    expect(result.current.inlineInput).toEqual({
      mode: 'create-file',
      parentPath: '/project/src',
      node: undefined,
    })
  })

  it('openCreateFolder sets inlineInput state', () => {
    const { result } = renderHook(() =>
      useFileTreeOperations({ workspaceId: 'ws-1', onRefreshDir })
    )
    act(() => result.current.openCreateFolder('/project/src'))
    expect(result.current.inlineInput).toEqual({
      mode: 'create-folder',
      parentPath: '/project/src',
      node: undefined,
    })
  })

  it('openRename sets inlineInput with parent path derived from node path', () => {
    const { result } = renderHook(() =>
      useFileTreeOperations({ workspaceId: 'ws-1', onRefreshDir })
    )
    act(() => result.current.openRename(mockFileNode))
    expect(result.current.inlineInput).toEqual({
      mode: 'rename',
      parentPath: '/project/src',
      node: mockFileNode,
    })
  })

  it('commitInlineInput for create-file calls writeTextFile and refreshes', async () => {
    vi.mocked(pluginFs.writeTextFile).mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useFileTreeOperations({ workspaceId: 'ws-1', onRefreshDir })
    )
    act(() => result.current.openCreateFile('/project/src'))
    await act(() => result.current.commitInlineInput('newfile.ts'))
    expect(pluginFs.writeTextFile).toHaveBeenCalledWith('/project/src/newfile.ts', '')
    expect(onRefreshDir).toHaveBeenCalledWith('/project/src')
    expect(result.current.inlineInput).toBeNull()
  })

  it('commitInlineInput for create-folder calls mkdir and refreshes', async () => {
    vi.mocked(pluginFs.mkdir).mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useFileTreeOperations({ workspaceId: 'ws-1', onRefreshDir })
    )
    act(() => result.current.openCreateFolder('/project/src'))
    await act(() => result.current.commitInlineInput('utils'))
    expect(pluginFs.mkdir).toHaveBeenCalledWith('/project/src/utils')
    expect(onRefreshDir).toHaveBeenCalledWith('/project/src')
    expect(result.current.inlineInput).toBeNull()
  })

  it('commitInlineInput for rename calls rename and refreshes', async () => {
    vi.mocked(pluginFs.rename).mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useFileTreeOperations({ workspaceId: 'ws-1', onRefreshDir })
    )
    act(() => result.current.openRename(mockFileNode))
    await act(() => result.current.commitInlineInput('renamed.ts'))
    expect(pluginFs.rename).toHaveBeenCalledWith(
      '/project/src/index.ts',
      '/project/src/renamed.ts'
    )
    expect(onRefreshDir).toHaveBeenCalledWith('/project/src')
    expect(result.current.inlineInput).toBeNull()
  })

  it('requestDelete sets pendingDelete', () => {
    const { result } = renderHook(() =>
      useFileTreeOperations({ workspaceId: 'ws-1', onRefreshDir })
    )
    act(() => result.current.requestDelete(mockFileNode))
    expect(result.current.pendingDelete).toEqual(mockFileNode)
  })

  it('confirmDelete calls remove for a file and refreshes parent', async () => {
    vi.mocked(pluginFs.remove).mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useFileTreeOperations({ workspaceId: 'ws-1', onRefreshDir })
    )
    act(() => result.current.requestDelete(mockFileNode))
    await act(() => result.current.confirmDelete())
    expect(pluginFs.remove).toHaveBeenCalledWith('/project/src/index.ts')
    expect(onRefreshDir).toHaveBeenCalledWith('/project/src')
    expect(result.current.pendingDelete).toBeNull()
  })

  it('confirmDelete calls remove with recursive:true for a directory', async () => {
    vi.mocked(pluginFs.remove).mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useFileTreeOperations({ workspaceId: 'ws-1', onRefreshDir })
    )
    act(() => result.current.requestDelete(mockDirNode))
    await act(() => result.current.confirmDelete())
    expect(pluginFs.remove).toHaveBeenCalledWith('/project/src', { recursive: true })
    expect(onRefreshDir).toHaveBeenCalledWith('/project')
  })

  it('copyPath writes path to clipboard', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
    const { result } = renderHook(() =>
      useFileTreeOperations({ workspaceId: 'ws-1', onRefreshDir })
    )
    await act(() => result.current.copyPath('/project/src/index.ts'))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('/project/src/index.ts')
  })

  it('openInTerminal invokes spawn_terminal and calls addTerminal', async () => {
    const mockTerminal = { id: 't-1', shell: 'zsh', cwd: '/project/src' }
    vi.mocked(tauriUtils.invoke).mockResolvedValue(mockTerminal)
    const addTerminal = vi.fn()
    vi.mocked(useAppStore.getState).mockReturnValue({
      addTerminal,
      settings: { defaultTerminalType: 'built-in' },
    } as any)
    const { result } = renderHook(() =>
      useFileTreeOperations({ workspaceId: 'ws-1', onRefreshDir })
    )
    await act(() => result.current.openInTerminal('/project/src'))
    expect(tauriUtils.invoke).toHaveBeenCalledWith('spawn_terminal', {
      workspaceId: 'ws-1',
      shell: 'zsh',
      cwd: '/project/src',
    })
    expect(addTerminal).toHaveBeenCalledWith('ws-1', mockTerminal)
  })

  it('sets error on fs failure and keeps inlineInput open', async () => {
    vi.mocked(pluginFs.writeTextFile).mockRejectedValue(new Error('Permission denied'))
    const { result } = renderHook(() =>
      useFileTreeOperations({ workspaceId: 'ws-1', onRefreshDir })
    )
    act(() => result.current.openCreateFile('/project/src'))
    await act(() => result.current.commitInlineInput('fail.ts'))
    expect(result.current.error).toBe('Permission denied')
    expect(result.current.inlineInput).not.toBeNull()
  })

  it('clearError resets error to null', async () => {
    vi.mocked(pluginFs.writeTextFile).mockRejectedValue(new Error('oops'))
    const { result } = renderHook(() =>
      useFileTreeOperations({ workspaceId: 'ws-1', onRefreshDir })
    )
    act(() => result.current.openCreateFile('/project/src'))
    await act(() => result.current.commitInlineInput('fail.ts'))
    act(() => result.current.clearError())
    expect(result.current.error).toBeNull()
  })
})
```

- [ ] **Step 1.2: Run test to verify it fails**

```bash
npx vitest run src/hooks/useFileTreeOperations.test.ts
```

Expected: FAIL with `Cannot find module './useFileTreeOperations'`

- [ ] **Step 1.3: Create `src/hooks/useFileTreeOperations.ts`**

```typescript
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
  mode: 'create-file' | 'create-folder' | 'rename'
  parentPath: string
  node?: NodeRef
}

interface UseFileTreeOperationsParams {
  workspaceId: string
  onRefreshDir: (dirPath: string) => Promise<void>
}

export function useFileTreeOperations({ workspaceId, onRefreshDir }: UseFileTreeOperationsParams) {
  const [inlineInput, setInlineInput] = useState<InlineInputState | null>(null)
  const [pendingDelete, setPendingDelete] = useState<NodeRef | null>(null)
  const [error, setError] = useState<string | null>(null)

  const parentOf = (path: string) => path.split('/').slice(0, -1).join('/')

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

  const closeInlineInput = useCallback(() => {
    setInlineInput(null)
    setError(null)
  }, [])

  const commitInlineInput = useCallback(async (name: string) => {
    if (!inlineInput || !name.trim()) return
    const { mode, parentPath, node } = inlineInput
    try {
      if (mode === 'create-file') {
        await writeTextFile(`${parentPath}/${name}`, '')
      } else if (mode === 'create-folder') {
        await mkdir(`${parentPath}/${name}`)
      } else if (mode === 'rename' && node) {
        await rename(node.path, `${parentPath}/${name}`)
      }
      setInlineInput(null)
      setError(null)
      await onRefreshDir(parentPath)
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
```

- [ ] **Step 1.4: Run tests**

```bash
npx vitest run src/hooks/useFileTreeOperations.test.ts
```

Expected: All PASS

- [ ] **Step 1.5: Commit**

```bash
git add src/hooks/useFileTreeOperations.ts src/hooks/useFileTreeOperations.test.ts
git commit -m "feat: add useFileTreeOperations hook"
```

---

## Task 2: `useFileTreeContextMenu` hook

**Files:**
- Create: `src/hooks/useFileTreeContextMenu.ts`
- Create: `src/hooks/useFileTreeContextMenu.test.ts`

Owns: `{ x, y, node } | null` menu state, `openMenu` (called from TreeNode's onContextMenu), `closeMenu`.

- [ ] **Step 2.1: Create the test file**

`src/hooks/useFileTreeContextMenu.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFileTreeContextMenu } from './useFileTreeContextMenu'

const mockNode = {
  path: '/project/src/index.ts',
  name: 'index.ts',
  isDirectory: false,
  depth: 2,
}

describe('useFileTreeContextMenu', () => {
  it('menu is null initially', () => {
    const { result } = renderHook(() => useFileTreeContextMenu())
    expect(result.current.menu).toBeNull()
  })

  it('openMenu sets x, y, and node from the event', () => {
    const { result } = renderHook(() => useFileTreeContextMenu())
    const fakeEvent = { preventDefault: () => {}, clientX: 100, clientY: 200 } as any
    act(() => result.current.openMenu(fakeEvent, mockNode))
    expect(result.current.menu).toEqual({ x: 100, y: 200, node: mockNode })
  })

  it('closeMenu resets menu to null', () => {
    const { result } = renderHook(() => useFileTreeContextMenu())
    const fakeEvent = { preventDefault: () => {}, clientX: 100, clientY: 200 } as any
    act(() => result.current.openMenu(fakeEvent, mockNode))
    act(() => result.current.closeMenu())
    expect(result.current.menu).toBeNull()
  })
})
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
npx vitest run src/hooks/useFileTreeContextMenu.test.ts
```

Expected: FAIL with `Cannot find module './useFileTreeContextMenu'`

- [ ] **Step 2.3: Create `src/hooks/useFileTreeContextMenu.ts`**

```typescript
import { useState, useCallback } from 'react'
import type { NodeRef } from './useFileTreeOperations'

export interface ContextMenuState {
  x: number
  y: number
  node: NodeRef
}

export function useFileTreeContextMenu() {
  const [menu, setMenu] = useState<ContextMenuState | null>(null)

  const openMenu = useCallback((e: React.MouseEvent, node: NodeRef) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, node })
  }, [])

  const closeMenu = useCallback(() => setMenu(null), [])

  return { menu, openMenu, closeMenu }
}
```

- [ ] **Step 2.4: Run tests**

```bash
npx vitest run src/hooks/useFileTreeContextMenu.test.ts
```

Expected: All PASS

- [ ] **Step 2.5: Commit**

```bash
git add src/hooks/useFileTreeContextMenu.ts src/hooks/useFileTreeContextMenu.test.ts
git commit -m "feat: add useFileTreeContextMenu hook"
```

---

## Task 3: `FileTreeContextMenu` component

**Files:**
- Create: `src/components/FileTreeContextMenu.tsx`
- Create: `src/components/FileTreeContextMenu.test.tsx`

Floating menu at `(x, y)`. Closes on outside `mousedown`, Escape keydown, or scroll. Items differ by `node.isDirectory`.

- [ ] **Step 3.1: Create `src/components/FileTreeContextMenu.tsx`**

```typescript
import React, { useEffect, useRef } from 'react'
import { FilePlus, FolderPlus, Pencil, Trash2, Copy, Terminal } from 'lucide-react'
import type { ContextMenuState } from '../hooks/useFileTreeContextMenu'

interface Props {
  menu: ContextMenuState
  onClose: () => void
  onNewFile: () => void
  onNewFolder: () => void
  onRename: () => void
  onDelete: () => void
  onCopyPath: () => void
  onOpenInTerminal: () => void
}

function MenuItem({
  icon,
  label,
  onClick,
  isDestructive = false,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  isDestructive?: boolean
}) {
  const [hovered, setHovered] = React.useState(false)
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        fontSize: 13,
        cursor: 'pointer',
        borderRadius: 4,
        userSelect: 'none',
        transition: 'background 0.1s, color 0.1s',
        color: isDestructive
          ? hovered ? '#ff6b6b' : '#e07b7b'
          : hovered ? 'var(--text-active)' : 'var(--text-inactive)',
        backgroundColor: hovered ? 'var(--bg-item-active)' : 'transparent',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </div>
  )
}

const SEPARATOR: React.CSSProperties = {
  height: 1,
  margin: '4px 8px',
  backgroundColor: 'var(--border-inactive)',
}

export function FileTreeContextMenu({
  menu,
  onClose,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
  onCopyPath,
  onOpenInTerminal,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const handleScroll = () => onClose()

    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('scroll', handleScroll, true)
    }
  }, [onClose])

  const { x, y, node } = menu

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: y,
        left: x,
        zIndex: 1000,
        backgroundColor: 'var(--bg-sidebar)',
        border: '1px solid var(--border-inactive)',
        borderRadius: 6,
        padding: '4px 0',
        minWidth: 160,
        boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
      }}
    >
      {node.isDirectory && (
        <>
          <MenuItem icon={<FilePlus size={14} />} label="New File" onClick={onNewFile} />
          <MenuItem icon={<FolderPlus size={14} />} label="New Folder" onClick={onNewFolder} />
          <div style={SEPARATOR} />
        </>
      )}
      <MenuItem icon={<Pencil size={14} />} label="Rename" onClick={onRename} />
      <MenuItem icon={<Copy size={14} />} label="Copy Path" onClick={onCopyPath} />
      {node.isDirectory && (
        <MenuItem icon={<Terminal size={14} />} label="Open in Terminal" onClick={onOpenInTerminal} />
      )}
      <div style={SEPARATOR} />
      <MenuItem icon={<Trash2 size={14} />} label="Delete" onClick={onDelete} isDestructive />
    </div>
  )
}
```

- [ ] **Step 3.2: Create `src/components/FileTreeContextMenu.test.tsx`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FileTreeContextMenu } from './FileTreeContextMenu'

const dirMenu = {
  x: 100,
  y: 200,
  node: { path: '/project/src', name: 'src', isDirectory: true, depth: 1 },
}
const fileMenu = {
  x: 100,
  y: 200,
  node: { path: '/project/index.ts', name: 'index.ts', isDirectory: false, depth: 0 },
}

const defaultProps = {
  menu: dirMenu,
  onClose: vi.fn(),
  onNewFile: vi.fn(),
  onNewFolder: vi.fn(),
  onRename: vi.fn(),
  onDelete: vi.fn(),
  onCopyPath: vi.fn(),
  onOpenInTerminal: vi.fn(),
}

describe('FileTreeContextMenu', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows folder-specific items for directories', () => {
    render(<FileTreeContextMenu {...defaultProps} />)
    expect(screen.getByText('New File')).toBeInTheDocument()
    expect(screen.getByText('New Folder')).toBeInTheDocument()
    expect(screen.getByText('Open in Terminal')).toBeInTheDocument()
  })

  it('hides New File, New Folder, Open in Terminal for files', () => {
    render(<FileTreeContextMenu {...defaultProps} menu={fileMenu} />)
    expect(screen.queryByText('New File')).not.toBeInTheDocument()
    expect(screen.queryByText('New Folder')).not.toBeInTheDocument()
    expect(screen.queryByText('Open in Terminal')).not.toBeInTheDocument()
  })

  it('shows Rename, Copy Path, Delete for files', () => {
    render(<FileTreeContextMenu {...defaultProps} menu={fileMenu} />)
    expect(screen.getByText('Rename')).toBeInTheDocument()
    expect(screen.getByText('Copy Path')).toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
  })

  it('calls onNewFile when New File clicked', () => {
    const onNewFile = vi.fn()
    render(<FileTreeContextMenu {...defaultProps} onNewFile={onNewFile} />)
    fireEvent.click(screen.getByText('New File'))
    expect(onNewFile).toHaveBeenCalledTimes(1)
  })

  it('calls onDelete when Delete clicked', () => {
    const onDelete = vi.fn()
    render(<FileTreeContextMenu {...defaultProps} onDelete={onDelete} />)
    fireEvent.click(screen.getByText('Delete'))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('calls onClose on Escape keydown', () => {
    const onClose = vi.fn()
    render(<FileTreeContextMenu {...defaultProps} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose on outside mousedown', () => {
    const onClose = vi.fn()
    render(<FileTreeContextMenu {...defaultProps} onClose={onClose} />)
    fireEvent.mouseDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('is positioned at menu coordinates', () => {
    const { container } = render(<FileTreeContextMenu {...defaultProps} />)
    const el = container.firstChild as HTMLElement
    expect(el.style.top).toBe('200px')
    expect(el.style.left).toBe('100px')
  })
})
```

- [ ] **Step 3.3: Run tests**

```bash
npx vitest run src/components/FileTreeContextMenu.test.tsx
```

Expected: All PASS

- [ ] **Step 3.4: Commit**

```bash
git add src/components/FileTreeContextMenu.tsx src/components/FileTreeContextMenu.test.tsx
git commit -m "feat: add FileTreeContextMenu component"
```

---

## Task 4: `FileTreeInlineInput` component

**Files:**
- Create: `src/components/FileTreeInlineInput.tsx`

Renders as a `position: absolute` row at `top: index * 28px` inside the virtualizer. Auto-focuses on mount. Enter → commit (if non-empty), Escape → cancel, blur → commit if non-empty else cancel.

- [ ] **Step 4.1: Create `src/components/FileTreeInlineInput.tsx`**

```typescript
import React, { useEffect, useRef, useState } from 'react'
import { File, Folder } from 'lucide-react'

const ITEM_HEIGHT = 28

interface Props {
  mode: 'create-file' | 'create-folder' | 'rename'
  prefill: string
  depth: number
  index: number
  onCommit: (name: string) => void
  onCancel: () => void
}

export function FileTreeInlineInput({ mode, prefill, depth, index, onCommit, onCancel }: Props) {
  const [value, setValue] = useState(prefill)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const commit = () => {
    const trimmed = value.trim()
    if (trimmed) onCommit(trimmed)
    else onCancel()
  }

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        height: ITEM_HEIGHT,
        top: index * ITEM_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        paddingLeft: `${depth * 14 + 12}px`,
        paddingRight: 8,
        backgroundColor: 'var(--bg-item-active)',
      }}
    >
      <span style={{ marginRight: 6, display: 'flex', alignItems: 'center' }}>
        {mode === 'create-folder'
          ? <Folder size={14} color="#90A4AE" />
          : <File size={14} color="#90A4AE" />
        }
      </span>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          if (e.key === 'Escape') { e.preventDefault(); onCancel() }
        }}
        onBlur={commit}
        style={{
          flex: 1,
          background: 'transparent',
          border: '1px solid var(--accent)',
          borderRadius: 3,
          color: 'var(--text-active)',
          fontSize: 13,
          fontFamily: 'Inter, system-ui, sans-serif',
          outline: 'none',
          padding: '1px 4px',
        }}
      />
    </div>
  )
}
```

- [ ] **Step 4.2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 4.3: Commit**

```bash
git add src/components/FileTreeInlineInput.tsx
git commit -m "feat: add FileTreeInlineInput component"
```

---

## Task 5: Wire everything into `FileTree.tsx`

**Files:**
- Modify: `src/components/FileTree.tsx`
- Modify: `src/components/FileTree.test.tsx`

Changes:
1. Add new imports
2. Define `FlatItem` discriminated union type
3. Add `onContextMenu` prop to `TreeNode`
4. Add hooks + `handleRefreshDir` to `FileTree` component body
5. Replace `visibleNodes` with `flatItems` + `visibleItems` (augmented for inline input)
6. Update scroll height and render loop
7. Mount `FileTreeContextMenu`, `FileTreeInlineInput`, `ConfirmModal`, error banner

- [ ] **Step 5.1: Add imports to the top of `FileTree.tsx`**

After the last existing import line, add:

```typescript
import { AnimatePresence } from 'framer-motion'
import { useFileTreeContextMenu } from '../hooks/useFileTreeContextMenu'
import { useFileTreeOperations } from '../hooks/useFileTreeOperations'
import { FileTreeContextMenu } from './FileTreeContextMenu'
import { FileTreeInlineInput } from './FileTreeInlineInput'
import { ConfirmModal } from './ConfirmModal/ConfirmModal'
```

- [ ] **Step 5.2: Add `FlatItem` type after the `FlatNode` interface**

After the closing `}` of the `FlatNode` interface, add:

```typescript
type FlatItem =
  | { kind: 'node'; data: FlatNode; index: number }
  | { kind: 'inline-input'; depth: number; mode: 'create-file' | 'create-folder' | 'rename'; prefill: string; index: number }
```

- [ ] **Step 5.3: Add `onContextMenu` prop to `TreeNode`**

Find the `TreeNode` props definition (starts with `const TreeNode = React.memo<{`). Change the props type block from:

```typescript
const TreeNode = React.memo<{
  node: FlatNode
  isFocused: boolean
  isSelected: boolean
  iconTheme: 'plain' | 'colorful' | 'filled'
  onToggle: (node: FlatNode) => void
  onFocus: (node: FlatNode) => void
  style?: React.CSSProperties
}>(({ node, isFocused, isSelected, iconTheme, onToggle, onFocus, style }) => {
```

To:

```typescript
const TreeNode = React.memo<{
  node: FlatNode
  isFocused: boolean
  isSelected: boolean
  iconTheme: 'plain' | 'colorful' | 'filled'
  onToggle: (node: FlatNode) => void
  onFocus: (node: FlatNode) => void
  onContextMenu: (e: React.MouseEvent, node: FlatNode) => void
  style?: React.CSSProperties
}>(({ node, isFocused, isSelected, iconTheme, onToggle, onFocus, onContextMenu, style }) => {
```

Find the outer `<div` in TreeNode's render (the div with `role="treeitem"`). Add `onContextMenu` to it:

```typescript
onContextMenu={(e) => onContextMenu(e, node)}
```

Place it after the existing `onClick` handler on that div.

- [ ] **Step 5.4: Add hooks and `handleRefreshDir` inside `FileTree` component**

Inside `export const FileTree`, after the existing state declarations (after line `const iconTheme = useAppStore(...)`), add:

```typescript
const { menu, openMenu, closeMenu } = useFileTreeContextMenu()

const handleRefreshDir = useCallback(async (dirPath: string) => {
  const children = await fetchDirectoryTree(dirPath)
  setLoadedChildren(prev => ({ ...prev, [dirPath]: children }))
  if (dirPath === rootPath) {
    setRootNodes(children)
  }
}, [rootPath])

const {
  inlineInput,
  pendingDelete,
  error,
  openCreateFile,
  openCreateFolder,
  openRename,
  closeInlineInput,
  commitInlineInput,
  requestDelete,
  cancelDelete,
  confirmDelete,
  copyPath,
  openInTerminal,
  clearError,
} = useFileTreeOperations({ workspaceId, onRefreshDir: handleRefreshDir })
```

- [ ] **Step 5.5: Add `flatItems` and replace `visibleNodes` with `visibleItems`**

Find the existing `visibleNodes` useMemo (around line 437 — it computes `startIndex`, `endIndex`, and calls `flatNodes.slice(...).map(...)`).

**Replace the entire `visibleNodes` useMemo** with the following two blocks:

```typescript
const flatItems = useMemo((): FlatItem[] => {
  const base: FlatItem[] = flatNodes.map((node, i) => ({ kind: 'node', data: node, index: i }))
  if (!inlineInput) return base

  if (inlineInput.mode === 'rename' && inlineInput.node) {
    return base.map(item =>
      item.kind === 'node' && item.data.path === inlineInput.node!.path
        ? { kind: 'inline-input' as const, depth: item.data.depth, mode: inlineInput.mode, prefill: item.data.name, index: item.index }
        : item
    )
  }

  // create-file or create-folder: insert one row after the parent directory
  const parentIdx = base.findIndex(
    item => item.kind === 'node' && item.data.path === inlineInput.parentPath
  )
  const insertAt = parentIdx >= 0 ? parentIdx + 1 : base.length
  const parentDepth = parentIdx >= 0 && base[parentIdx].kind === 'node'
    ? (base[parentIdx] as { kind: 'node'; data: FlatNode; index: number }).data.depth
    : 0
  const sentinel: FlatItem = {
    kind: 'inline-input',
    depth: parentDepth + 1,
    mode: inlineInput.mode,
    prefill: '',
    index: insertAt,
  }
  return [
    ...base.slice(0, insertAt).map((item, i) => ({ ...item, index: i })),
    { ...sentinel, index: insertAt },
    ...base.slice(insertAt).map((item, i) => ({ ...item, index: insertAt + 1 + i })),
  ]
}, [flatNodes, inlineInput])

const visibleItems = useMemo(() => {
  const total = flatItems.length
  const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER)
  const endIndex = Math.min(total, Math.ceil((scrollTop + containerHeight) / ITEM_HEIGHT) + BUFFER)
  return flatItems.slice(startIndex, endIndex)
}, [flatItems, scrollTop, containerHeight])
```

- [ ] **Step 5.6: Update scroll container height div**

Find the line:

```typescript
<div style={{ height: flatNodes.length * ITEM_HEIGHT, position: 'relative' }}>
```

Change it to:

```typescript
<div style={{ height: flatItems.length * ITEM_HEIGHT, position: 'relative' }}>
```

- [ ] **Step 5.7: Replace the render loop**

Find the existing `visibleNodes.map(...)` call. Replace it with:

```typescript
{visibleItems.map((item) => {
  if (item.kind === 'inline-input') {
    return (
      <FileTreeInlineInput
        key="inline-input"
        mode={item.mode}
        prefill={item.prefill}
        depth={item.depth}
        index={item.index}
        onCommit={commitInlineInput}
        onCancel={closeInlineInput}
      />
    )
  }
  return (
    <TreeNode
      key={item.data.path}
      node={item.data}
      isFocused={focusedPath === item.data.path}
      isSelected={activeFile === item.data.path}
      iconTheme={iconTheme}
      onToggle={handleToggle}
      onFocus={(n) => setFocusedPath(n.path)}
      onContextMenu={openMenu}
      style={{ top: item.index * ITEM_HEIGHT }}
    />
  )
})}
```

- [ ] **Step 5.8: Add FileTreeContextMenu, ConfirmModal, and error banner**

After the scroll container's closing `</div>` (the div with `ref={containerRef}`), and **before** the FileTree's outermost closing `</div>`, add:

```typescript
{menu && (
  <FileTreeContextMenu
    menu={menu}
    onClose={closeMenu}
    onNewFile={() => { openCreateFile(menu.node.path); closeMenu() }}
    onNewFolder={() => { openCreateFolder(menu.node.path); closeMenu() }}
    onRename={() => { openRename(menu.node); closeMenu() }}
    onDelete={() => { requestDelete(menu.node); closeMenu() }}
    onCopyPath={() => { copyPath(menu.node.path); closeMenu() }}
    onOpenInTerminal={() => { openInTerminal(menu.node.path); closeMenu() }}
  />
)}

<AnimatePresence>
  {pendingDelete && (
    <ConfirmModal
      title={`Delete ${pendingDelete.isDirectory ? 'folder' : 'file'}`}
      message={`Are you sure you want to delete "${pendingDelete.name}"? This cannot be undone.`}
      confirmText="Delete"
      isDestructive
      onConfirm={confirmDelete}
      onCancel={cancelDelete}
    />
  )}
</AnimatePresence>

{error && (
  <div style={{
    position: 'absolute',
    bottom: 8,
    left: 8,
    right: 8,
    background: 'rgba(224, 123, 123, 0.15)',
    border: '1px solid #e07b7b',
    borderRadius: 4,
    padding: '6px 10px',
    fontSize: 12,
    color: '#e07b7b',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 10,
  }}>
    <span>{error}</span>
    <button
      onClick={clearError}
      style={{ background: 'none', border: 'none', color: '#e07b7b', cursor: 'pointer', fontSize: 14, padding: 0 }}
    >
      ×
    </button>
  </div>
)}
```

- [ ] **Step 5.9: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 5.10: Update `FileTree.test.tsx` — add hook mocks**

Open `src/components/FileTree.test.tsx`. After the existing `vi.mock('../store/useAppStore', ...)` block, add:

```typescript
vi.mock('../hooks/useFileTreeContextMenu', () => ({
  useFileTreeContextMenu: () => ({ menu: null, openMenu: vi.fn(), closeMenu: vi.fn() }),
}))

vi.mock('../hooks/useFileTreeOperations', () => ({
  useFileTreeOperations: () => ({
    inlineInput: null,
    pendingDelete: null,
    error: null,
    openCreateFile: vi.fn(),
    openCreateFolder: vi.fn(),
    openRename: vi.fn(),
    closeInlineInput: vi.fn(),
    commitInlineInput: vi.fn(),
    requestDelete: vi.fn(),
    cancelDelete: vi.fn(),
    confirmDelete: vi.fn(),
    copyPath: vi.fn(),
    openInTerminal: vi.fn(),
    clearError: vi.fn(),
  }),
}))
```

- [ ] **Step 5.11: Run all FileTree tests**

```bash
npx vitest run src/components/FileTree.test.tsx
```

Expected: All existing tests PASS

- [ ] **Step 5.12: Run full test suite**

```bash
npx vitest run
```

Expected: All tests PASS

- [ ] **Step 5.13: Commit**

```bash
git add src/components/FileTree.tsx src/components/FileTree.test.tsx
git commit -m "feat: wire context menu and inline input into FileTree"
```
