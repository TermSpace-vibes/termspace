export interface Workspace {
  id: string
  name: string
  emoji: string
  color: string
  position: number
  createdAt: number
  autoReload?: boolean
  notificationCount?: number
  groupName?: string
}

export interface Terminal {
  id: string
  workspaceId: string
  title?: string
  shell: string
  cwd: string
  position: number
  sizePercent: number
  createdAt: number
  autoReload?: boolean
  scrollback?: string[]
  notificationCount?: number
  executionState?: 'idle' | 'running' | 'stalled'
}

export interface BrowserPane {
  id: string
  workspaceId: string
  url: string
  position: number
  createdAt: number
  autoReload?: boolean
}

export interface EditorPane {
  id: string
  workspaceId: string
  rootPath: string
  openFiles: string[]
  activeFilePath: string | null
  jumpToLine?: number | null
  mruStack: string[]
  fileTreeWidth: number
  position: number
  createdAt: number
  autoReload?: boolean
  activeSidebarTab?: 'explorer' | 'git' | 'search'
  diffViewEnabled?: boolean
}

export interface KubernetesPane {
  id: string
  workspaceId: string
  position: number
  createdAt: number
  autoReload?: boolean
  selectedContext?: string
  selectedNamespace?: string
  resourceType?: string
  collapsedGroups?: string[]
}

export interface Keybindings {
  newTerminal: string
  closeTerminal: string
  nextTerminal: string
  prevTerminal: string
  commandPalette: string
  toggleSidebar: string
  searchFiles: string
  closeTab: string
  switchTab: string
  splitEditor: string
  openSettings: string
  toggleDictation: string
}

export interface Settings {
  theme: 'warm-dark' | 'cold-dark' | 'light' | 'catppuccin-mocha' | 'synthwave' | 'fruity'
  fontSize: number
  uiFontFamily?: string
  terminalFontFamily?: string
  timeFormat: '12h' | '24h'
  keybindings: Keybindings
  autosave: boolean
  adblockEnabled?: boolean
  showTabBar?: boolean
  iconTheme?: 'plain' | 'colorful' | 'filled'
  smoothCaret?: boolean
  defaultTerminalType?: 'built-in' | 'ghostty'
  terminalRenderer?: 'native' | 'xterm'
  dictationProvider?: 'local' | 'openai' | 'groq'
  dictationApiKey?: string
  dictationPrompt?: string
}

export type LayoutDirection = 'horizontal' | 'vertical'

export type LayoutNode =
  | { type: 'pane';    id: string; terminalId: string }
  | { type: 'browser'; id: string; browserPaneId: string }
  | { type: 'editor';  id: string; editorPaneId: string }
  | { type: 'kubernetes'; id: string; kubernetesPaneId: string }
  | { type: 'split';   id: string; direction: LayoutDirection; sizes: number[]; children: LayoutNode[] }

export interface GitStatus {
  [filePath: string]: string
}

export interface DetectedTask {
  name: string
  command: string
}

export interface DetectedProject {
  name: string
  path: string
  projectType: string
  tasks: DetectedTask[]
}

