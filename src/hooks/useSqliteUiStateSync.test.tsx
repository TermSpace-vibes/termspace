import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSqliteUiStateSync } from './useSqliteUiStateSync'
import { useAppStore } from '../store/useAppStore'

const setSqliteUiStateMock = vi.fn().mockResolvedValue(undefined)

vi.mock('../utils/sqliteUiState', () => ({
  setSqliteUiState: (...args: unknown[]) => setSqliteUiStateMock(...args),
}))

beforeEach(() => {
  vi.useFakeTimers()
  setSqliteUiStateMock.mockClear()
  useAppStore.setState({
    activeTabIds: {},
    layoutsByTab: {},
    editorPanesByTab: {},
    activeFileByTab: {},
    kubernetesPanesByTab: {},
    dockerPanesByTab: {},
    claudePanesByTab: {},
  })
})

describe('useSqliteUiStateSync', () => {
  it('debounces durable workspace UI state into SQLite', async () => {
    renderHook(() => useSqliteUiStateSync(true))

    act(() => {
      useAppStore.getState().setActiveTabId('ws-1', 'tab-2')
      vi.advanceTimersByTime(249)
    })
    expect(setSqliteUiStateMock).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(1)
      await Promise.resolve()
    })

    expect(setSqliteUiStateMock).toHaveBeenCalledWith('workspace-ui-state-v1', expect.objectContaining({
      activeTabIds: { 'ws-1': 'tab-2' },
    }))
  })

  it('does not write before bootstrap hydration has enabled syncing', () => {
    renderHook(() => useSqliteUiStateSync(false))

    act(() => {
      useAppStore.getState().setActiveTabId('ws-1', 'tab-2')
      vi.advanceTimersByTime(300)
    })

    expect(setSqliteUiStateMock).not.toHaveBeenCalled()
  })
})
