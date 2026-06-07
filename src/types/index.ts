export interface Workspace {
  id: string
  name: string
  emoji: string
  color: string
  position: number
  createdAt: number
  notificationCount?: number
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
  scrollback?: string[]
  notificationCount?: number
}

export interface BrowserPane {
  id: string
  workspaceId: string
  url: string
  position: number
  createdAt: number
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
}

export interface Keybindings {
  newTerminal: string
  closeTerminal: string
  nextTerminal: string
  prevTerminal: string
  commandPalette: string
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
}

export type LayoutDirection = 'horizontal' | 'vertical'

export type LayoutNode =
  | { type: 'pane';    id: string; terminalId: string }
  | { type: 'browser'; id: string; browserPaneId: string }
  | { type: 'editor';  id: string; editorPaneId: string }
  | { type: 'split';   id: string; direction: LayoutDirection; sizes: number[]; children: LayoutNode[] }

export interface GitStatus {
  [filePath: string]: string
}

