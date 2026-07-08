import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteSqliteUiState, getSqliteUiState, setSqliteUiState } from './sqliteUiState'

const invokeMock = vi.fn()

vi.mock('./tauri', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

beforeEach(() => {
  invokeMock.mockReset()
})

describe('sqliteUiState', () => {
  it('parses JSON values returned from SQLite UI state', async () => {
    invokeMock.mockResolvedValueOnce('{"activeTabIds":{"ws-1":"tab-2"}}')

    await expect(getSqliteUiState('workspace-ui-state-v1')).resolves.toEqual({
      activeTabIds: { 'ws-1': 'tab-2' },
    })
    expect(invokeMock).toHaveBeenCalledWith('get_ui_state', { key: 'workspace-ui-state-v1' })
  })

  it('returns null when no SQLite UI state exists', async () => {
    invokeMock.mockResolvedValueOnce(null)

    await expect(getSqliteUiState('missing')).resolves.toBeNull()
  })

  it('stringifies JSON values into SQLite UI state', async () => {
    invokeMock.mockResolvedValueOnce(undefined)

    await setSqliteUiState('workspace-ui-state-v1', { activeTabIds: { 'ws-1': 'tab-2' } })

    expect(invokeMock).toHaveBeenCalledWith('set_ui_state', {
      key: 'workspace-ui-state-v1',
      value: '{"activeTabIds":{"ws-1":"tab-2"}}',
    })
  })

  it('deletes SQLite UI state values by key', async () => {
    invokeMock.mockResolvedValueOnce(undefined)

    await deleteSqliteUiState('workspace-ui-state-v1')

    expect(invokeMock).toHaveBeenCalledWith('delete_ui_state', { key: 'workspace-ui-state-v1' })
  })
})
