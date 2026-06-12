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

  it('sets error when confirmDelete fails', async () => {
    vi.mocked(pluginFs.remove).mockRejectedValue(new Error('Cannot delete'))
    const { result } = renderHook(() =>
      useFileTreeOperations({ workspaceId: 'ws-1', onRefreshDir })
    )
    act(() => result.current.requestDelete(mockFileNode))
    await act(() => result.current.confirmDelete())
    expect(result.current.error).toBe('Cannot delete')
    expect(result.current.pendingDelete).not.toBeNull()
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
