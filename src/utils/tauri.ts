import { invoke as tauriInvoke, isTauri as checkIsTauri } from '@tauri-apps/api/core'
import { listen as tauriListen } from '@tauri-apps/api/event'

// Fallback error boundaries / mock invoke for web development to simulate a terminal environment when not in Tauri
const isTauri = checkIsTauri();

let mockTerminalCounter = 1;

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri) {
    return tauriInvoke<T>(cmd, args);
  }

  console.warn(`[Mock Tauri] invoke('${cmd}') with args:`, args);

  switch (cmd) {
    case 'get_workspaces':
      return [] as unknown as T;
    case 'create_workspace':
      return {
        id: `mock-ws-${Date.now()}`,
        name: args?.name || 'Mock Workspace',
        emoji: args?.emoji || '💻',
        color: args?.color || '#e8a045'
      } as unknown as T;
    case 'update_workspace':
    case 'delete_workspace':
    case 'respawn_terminal':
    case 'set_workspace_default_path':
    case 'set_workspace_ssh_host':
      return undefined as unknown as T;
    case 'get_ssh_hosts':
      return [] as unknown as T;
    case 'spawn_terminal':
      return {
        id: `mock-term-${mockTerminalCounter++}`,
        shell: args?.shell || 'zsh',
        cwd: args?.cwd || ''
      } as unknown as T;
    case 'get_terminals':
      return [] as unknown as T;
    case 'write_terminal':
    case 'resize_terminal':
    case 'scroll_terminal':
    case 'refresh_terminal_snapshot':
    case 'kill_terminal':
    case 'start_terminal':
    case 'save_scrollback':
      return undefined as unknown as T;
    case 'search_terminal':
      return [] as unknown as T;
    case 'create_browser_pane':
    case 'respawn_browser_pane':
      return { id: `mock-bp-${Date.now()}`, workspaceId: args?.workspaceId || '', url: args?.url || 'termspace://newtab' } as unknown as T;
    case 'get_browser_panes':
      return [] as unknown as T;
    case 'resize_browser_pane':
    case 'navigate_browser_pane':
    case 'save_browser_pane_url':
    case 'show_browser_pane':
    case 'hide_browser_pane':
    case 'destroy_browser_pane':
    case 'browser_go_back':
    case 'browser_go_forward':
    case 'browser_reload':
    case 'browser_media_control':
      return undefined as unknown as T;
    case 'start_ssh_port_forward':
      return {
        id: `mock-tunnel-${Date.now()}`,
        ssh_host: args?.sshHost || 'user@remote',
        remote_port: args?.remotePort || 3000,
        local_port: args?.localPort || args?.remotePort || 3000,
        remote_host: args?.remoteHost || '127.0.0.1',
        created_at: Date.now(),
      } as unknown as T;
    case 'stop_ssh_port_forward':
      return undefined as unknown as T;
    case 'get_active_ssh_port_forwards':
      return [] as unknown as T;
    default:
      console.warn(`[Mock Tauri] Unhandled command: ${cmd}`);
      return undefined as unknown as T;
  }
}

export function listen<T>(event: string, handler: (event: any) => void): Promise<() => void> {
  if (isTauri) {
    return tauriListen<T>(event, handler);
  }
  console.warn(`[Mock Tauri] listen('${event}')`);
  
  // Return a dummy unlisten function
  return Promise.resolve(() => {});
}
