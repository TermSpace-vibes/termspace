import { useEffect } from 'react'
import { useAppStore, DurableWorkspaceUiState } from '../store/useAppStore'
import { setSqliteUiState } from '../utils/sqliteUiState'

export const WORKSPACE_UI_STATE_KEY = 'workspace-ui-state-v1'
const SYNC_DEBOUNCE_MS = 250

export function buildDurableWorkspaceUiState(): DurableWorkspaceUiState {
  const state = useAppStore.getState()
  return {
    activeTabIds: state.activeTabIds,
    layoutsByTab: state.layoutsByTab,
    browserPanesByTab: state.browserPanesByTab,
    editorPanesByTab: state.editorPanesByTab,
    activeFileByTab: state.activeFileByTab,
    kubernetesPanesByTab: state.kubernetesPanesByTab,
    dockerPanesByTab: state.dockerPanesByTab,
    claudePanesByTab: state.claudePanesByTab,
  }
}

export function useSqliteUiStateSync(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return

    let lastSerialized = JSON.stringify(buildDurableWorkspaceUiState())
    let timer: ReturnType<typeof setTimeout> | null = null

    const flush = () => {
      timer = null
      const snapshot = buildDurableWorkspaceUiState()
      const serialized = JSON.stringify(snapshot)
      if (serialized === lastSerialized) return
      lastSerialized = serialized
      void setSqliteUiState(WORKSPACE_UI_STATE_KEY, snapshot).catch((err) => {
        console.error('Failed to persist workspace UI state:', err)
      })
    }

    const unsubscribe = useAppStore.subscribe(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, SYNC_DEBOUNCE_MS)
    })

    return () => {
      unsubscribe()
      if (timer) clearTimeout(timer)
    }
  }, [enabled])
}
