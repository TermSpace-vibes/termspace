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

export type AgentProviderId = 'claude-code' | 'codex'

export type AgentSessionStatus =
  | 'starting'
  | 'ready'
  | 'running'
  | 'blocked'
  | 'error'
  | 'exited'

export interface AgentProviderCapabilities {
  structuredOutput: boolean
  sessionResume: boolean
  modelSelection: boolean
  reasoningEffort: boolean
  permissionRequests: boolean
  fileChangeEvents: boolean
  toolEvents: boolean
  contextContinuation: boolean
}

export type AgentMessagePart =
  | { type: 'text'; text: string }
  | { type: 'activity'; label: string; detail?: string }
  | { type: 'question'; prompt: string; choices?: string[] }
  | { type: 'file_reference'; referenceId: string }
  | { type: 'command'; command: string; cwd: string }
  | { type: 'command_result'; exitCode: number | null; outputRef: string }
  | { type: 'permission_request'; requestId: string; capability: string }
  | { type: 'diagnostic'; rawOutputRef: string }
  | { type: 'artifact_reference'; artifactId: string }
  | { type: 'verification_result'; verificationId: string }

export interface AgentConversation {
  id: string
  workspaceId: string
  title: string
  defaultCwd: string
  createdAt: number
  updatedAt: number
  archivedAt: number | null
}

export interface AgentRuntimeSession {
  id: string
  conversationId: string
  provider: AgentProviderId
  providerSessionId: string | null
  contextSnapshotId: string
  status: AgentSessionStatus
  parentSessionId: string | null
  createdAt: number
}

export type AgentRuntimeEvent =
  | { kind: 'text'; text: string }
  | { kind: 'message'; markdown: string }
  | { kind: 'activity'; label: string; detail?: string }
  | { kind: 'command'; command: string; cwd: string; output?: string; exitCode?: number | null }
  | { kind: 'question'; id: string; prompt: string; choices: AgentQuestionChoice[]; allowCustom: boolean }
  | { kind: 'ready' }
  | { kind: 'error'; message: string; rawOutputRef?: string }
  | { kind: 'status'; status: AgentSessionStatus }
  | { kind: 'diagnostic'; rawOutputRef: string }

export interface AgentQuestionChoice {
  id: string
  label: string
  input: string
  description?: string
}

export interface AgentRuntimeEnvelope {
  sessionId: string
  sequence: number
  timestamp: number
  event: AgentRuntimeEvent
}

export interface AgentStudioPane {
  id: string
  tabId: string
  title: string
  cwd: string
  conversationId: string | null
  position: number
  createdAt: number
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
  globalDictationEnabled?: boolean
  globalDictationHotkey?: string
  globalDictationAutoPaste?: boolean
  globalDictationRestoreClipboard?: boolean
  globalDictationShowFloatingButton?: boolean
  globalDictationOverlayPosition?: { x: number; y: number }
  globalDictationPasteDelayMs?: number
  minimapEnabled?: boolean
  showToolingPane?: boolean
  discardTabsAfterMs?: number | 'never'
  showWorkspaceDefaultPaths?: boolean
  toolPaneBehavior?: 'split' | 'tab' | 'workspace'
  notificationsEnabled?: boolean
  notifyOnComplete?: boolean
  notifyOnPrompt?: boolean
  notifyOnBell?: boolean
  useOsNotification?: boolean
}

export type TaskEventKind = 'started' | 'completed' | 'failed' | 'needs-input' | 'attention'

export interface TaskEvent {
  id: string
  source: 'claude' | 'native-terminal' | 'agent-hook' | 'osc' | 'bell'
  kind: TaskEventKind
  label?: string
  detail?: string
  exitCode?: number
  userInitiated?: boolean
}

export type LayoutDirection = 'horizontal' | 'vertical'

export type LayoutNode =
  | { type: 'pane';    id: string; terminalId: string }
  | { type: 'browser'; id: string; browserPaneId: string }
  | { type: 'editor';  id: string; editorPaneId: string }
  | { type: 'kubernetes'; id: string; kubernetesPaneId: string }
  | { type: 'docker'; id: string; dockerPaneId: string }
  | { type: 'claude'; id: string; claudePaneId: string }
  | { type: 'agent-studio'; id: string; agentStudioPaneId: string }
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
