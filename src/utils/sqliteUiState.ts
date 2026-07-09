import { invoke } from './tauri'

export async function getSqliteUiState<T>(key: string): Promise<T | null> {
  const raw = await invoke<string | null>('get_ui_state', { key })
  if (raw == null) return null
  return JSON.parse(raw) as T
}

export async function setSqliteUiState<T>(key: string, value: T): Promise<void> {
  await invoke('set_ui_state', { key, value: JSON.stringify(value) })
}

export async function deleteSqliteUiState(key: string): Promise<void> {
  await invoke('delete_ui_state', { key })
}
