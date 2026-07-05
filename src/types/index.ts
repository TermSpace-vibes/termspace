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
  isPinned?: boolean
  isArchived?: boolean
  defaultPath?: string
}

export interface Terminal {
  id: string
  tabId: string
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
  tabId: string
  url: string
  position: number
  createdAt: number
  autoReload?: boolean
}

export interface BrowserMediaSession {
  id: string
  workspaceId: string
  workspaceName: string
  browserTabId: string
  pageUrl: string
  pageTitle?: string
  mediaTitle?: string
  thumbnailUrl?: string
  isPlaying: boolean
  mediaType: 'audio' | 'video'
  canPlayPause: boolean
  canPrev: boolean
  canNext: boolean
  lastActiveAt: number
}

export interface EditorPane {
  id: string
  tabId: string
  rootPath: string | null
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
  tabId: string
  position: number
  createdAt: number
  autoReload?: boolean
  selectedContext?: string
  selectedNamespace?: string
  resourceType?: string
  collapsedGroups?: string[]
}

export interface DockerPane {
  id: string
  tabId: string
  position: number
  createdAt: number
  resourceType?: 'containers' | 'images' | 'volumes' | 'networks'
  autoReload?: boolean
}

export type ClaudePaneStatus = 'starting' | 'ready' | 'running' | 'blocked' | 'error' | 'exited'

export interface ClaudePane {
  id: string
  tabId: string
  title: string
  cwd: string
  position: number
  createdAt: number
  status?: ClaudePaneStatus
  error?: string | null
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
  lineHeight?: number
  defaultShell?: string
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
  minimapEnabled?: boolean
  showToolingPane?: boolean
  discardTabsAfterMs?: number | 'never'
  showWorkspaceDefaultPaths?: boolean
  toolPaneBehavior?: 'split' | 'tab' | 'workspace'
}

export type LayoutDirection = 'horizontal' | 'vertical'

export type LayoutNode =
  | { type: 'pane';    id: string; terminalId: string }
  | { type: 'browser'; id: string; browserPaneId: string }
  | { type: 'editor';  id: string; editorPaneId: string }
  | { type: 'kubernetes'; id: string; kubernetesPaneId: string }
  | { type: 'docker'; id: string; dockerPaneId: string }
  | { type: 'claude'; id: string; claudePaneId: string }
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

export interface WorkspaceTab {
    id: string;
    workspaceId: string;
    name: string;
    position: number;
    createdAt: number;
}
