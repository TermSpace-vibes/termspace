# Dependency Map

> Auto-generated 2026-07-05 by `node scripts/gen-dep-map.js`. Re-run after structural changes.

## How to use

- **Changing a file?** Find it in Table 2 (Dependents) to see what could break.
- **Adding a file?** Find similar files in Table 1 (Imports) for patterns.
- **Debugging a regression?** Trace upstream changes through the Dependents table.

## Table 1 — Imports (what each file depends on)

| File | Imports |
|------|---------|
| `src/App.tsx` | `src/components/CommandPalette/CommandPalette.tsx`, `src/components/ConfirmModal/ConfirmModal.tsx`, `src/components/MarkdownModal/MarkdownModal.tsx`, `src/components/SettingsModal/SettingsModal.tsx`, `src/components/UsernameModal/UsernameModal.tsx`, `src/components/WorkspaceModal/WorkspaceModal.tsx`, `src/components/WorkspaceSidebar/WorkspaceSidebar.tsx`, `src/components/WorkspaceView/WorkspaceView.tsx`, `src/components/ui/ContextMenu.tsx`, `src/components/ui/DictationButton.tsx`, `src/components/ui/ToastContainer.tsx`, `src/hooks/useGlobalKeybindings.ts`, `src/store/useAppStore.ts`, `src/types/index.ts`, `src/utils/tauri.ts` |
| `src/components/CommandPalette/CommandPalette.tsx` | `src/store/useAppStore.ts` |
| `src/components/ConfirmModal/ConfirmModal.tsx` | — |
| `src/components/EditorPane.tsx` | `src/components/ConfirmModal/ConfirmModal.tsx`, `src/components/FileTree.tsx`, `src/components/GitPanel.tsx`, `src/components/MarkdownPreview.tsx`, `src/components/SearchPanel.tsx`, `src/store/useAppStore.ts`, `src/utils/fs.ts`, `src/utils/lspManager.ts`, `src/vscode-extensions/setup.ts` |
| `src/components/EditorWelcomeScreen.tsx` | `src/store/useAppStore.ts` |
| `src/components/ErrorBoundary.tsx` | — |
| `src/components/FileTree.tsx` | `src/components/ConfirmModal/ConfirmModal.tsx`, `src/components/FileTreeContextMenu.tsx`, `src/components/FileTreeInlineInput.tsx`, `src/hooks/useFileTreeContextMenu.ts`, `src/hooks/useFileTreeOperations.ts`, `src/store/useAppStore.ts`, `src/utils/fs.ts` |
| `src/components/FileTreeContextMenu.tsx` | `src/hooks/useFileTreeContextMenu.ts` |
| `src/components/FileTreeInlineInput.tsx` | — |
| `src/components/GitPanel.tsx` | `src/store/useAppStore.ts` |
| `src/components/MarkdownModal/MarkdownModal.tsx` | `src/components/MarkdownPreview.tsx`, `src/store/useAppStore.ts`, `src/utils/fs.ts` |
| `src/components/MarkdownPreview.tsx` | `src/store/useAppStore.ts` |
| `src/components/SearchPanel.tsx` | `src/store/useAppStore.ts` |
| `src/components/SettingsModal/SettingsModal.tsx` | `src/store/useAppStore.ts`, `src/types/index.ts`, `src/utils/tauri.ts` |
| `src/components/UsernameModal/UsernameModal.tsx` | — |
| `src/components/WorkspaceModal/WorkspaceModal.tsx` | `src/types/index.ts` |
| `src/components/WorkspaceSidebar/AddWorkspaceButton.tsx` | — |
| `src/components/WorkspaceSidebar/ProjectTasks.tsx` | `src/store/useAppStore.ts`, `src/types/index.ts` |
| `src/components/WorkspaceSidebar/WorkspaceItem.tsx` | `src/store/useAppStore.ts`, `src/types/index.ts` |
| `src/components/WorkspaceSidebar/WorkspaceSidebar.tsx` | `src/components/WorkspaceSidebar/AddWorkspaceButton.tsx`, `src/components/WorkspaceSidebar/ProjectTasks.tsx`, `src/components/WorkspaceSidebar/WorkspaceItem.tsx`, `src/store/useAppStore.ts`, `src/types/index.ts` |
| `src/components/WorkspaceView/BrowserPane.tsx` | `src/store/useAppStore.ts`, `src/utils/tauri.ts` |
| `src/components/WorkspaceView/ClaudePane.tsx` | `src/components/WorkspaceView/ClaudeRawStream.tsx`, `src/components/WorkspaceView/claudeOutputParser.ts`, `src/components/WorkspaceView/claudeTranscript.ts`, `src/store/useAppStore.ts`, `src/utils/tauri.ts` |
| `src/components/WorkspaceView/ClaudeRawStream.tsx` | — |
| `src/components/WorkspaceView/ClaudeTranscriptView.tsx` | `src/components/WorkspaceView/claudeTranscript.ts` |
| `src/components/WorkspaceView/DockerPaneComponent.tsx` | `src/store/useAppStore.ts`, `src/types/index.ts` |
| `src/components/WorkspaceView/KubernetesPaneComponent.tsx` | `src/store/useAppStore.ts`, `src/types/index.ts` |
| `src/components/WorkspaceView/NativeTerminalPane.tsx` | `src/components/ConfirmModal/ConfirmModal.tsx`, `src/components/WorkspaceView/renderers/CanvasRenderer.ts`, `src/components/WorkspaceView/renderers/WebGLRenderer.ts`, `src/components/WorkspaceView/renderers/types.ts`, `src/components/WorkspaceView/selectionUtils.ts`, `src/components/WorkspaceView/useTerminalWorker.ts`, `src/hooks/useGlobalKeybindings.ts`, `src/store/useAppStore.ts`, `src/utils/constants.ts`, `src/utils/tauri.ts` |
| `src/components/WorkspaceView/TerminalGrid.tsx` | `src/components/EditorPane.tsx`, `src/components/WorkspaceView/BrowserPane.tsx`, `src/components/WorkspaceView/ClaudePane.tsx`, `src/components/WorkspaceView/DockerPaneComponent.tsx`, `src/components/WorkspaceView/KubernetesPaneComponent.tsx`, `src/components/WorkspaceView/NativeTerminalPane.tsx`, `src/components/WorkspaceView/TerminalPane.tsx`, `src/components/ui/ErrorBoundary.tsx`, `src/store/useAppStore.ts`, `src/types/index.ts` |
| `src/components/WorkspaceView/TerminalPane.tsx` | `src/components/ConfirmModal/ConfirmModal.tsx`, `src/hooks/useGlobalKeybindings.ts`, `src/store/useAppStore.ts`, `src/utils/constants.ts`, `src/utils/tauri.ts` |
| `src/components/WorkspaceView/ToolingPane.tsx` | `src/components/WorkspaceView/NativeTerminalPane.tsx`, `src/components/WorkspaceView/TerminalPane.tsx`, `src/store/useAppStore.ts`, `src/types/index.ts`, `src/utils/tauri.ts` |
| `src/components/WorkspaceView/WorkspaceHeader.tsx` | `src/store/useAppStore.ts`, `src/types/index.ts` |
| `src/components/WorkspaceView/WorkspaceTabBar.tsx` | `src/store/useAppStore.ts`, `src/types/index.ts` |
| `src/components/WorkspaceView/WorkspaceView.tsx` | `src/components/WorkspaceView/TerminalGrid.tsx`, `src/components/WorkspaceView/ToolingPane.tsx`, `src/components/WorkspaceView/WorkspaceHeader.tsx`, `src/components/WorkspaceView/WorkspaceTabBar.tsx`, `src/store/useAppStore.ts`, `src/types/index.ts`, `src/utils/tauri.ts` |
| `src/components/WorkspaceView/claudeOutputParser.ts` | — |
| `src/components/WorkspaceView/claudeTranscript.ts` | `src/components/WorkspaceView/claudeOutputParser.ts` |
| `src/components/WorkspaceView/renderers/CanvasRenderer.ts` | `src/components/WorkspaceView/renderers/types.ts` |
| `src/components/WorkspaceView/renderers/GlyphAtlas.ts` | — |
| `src/components/WorkspaceView/renderers/WebGLRenderer.ts` | `src/components/WorkspaceView/renderers/GlyphAtlas.ts`, `src/components/WorkspaceView/renderers/types.ts` |
| `src/components/WorkspaceView/renderers/terminal.worker.ts` | `src/components/WorkspaceView/renderers/CanvasRenderer.ts`, `src/components/WorkspaceView/renderers/WebGLRenderer.ts`, `src/components/WorkspaceView/renderers/types.ts`, `src/components/WorkspaceView/renderers/worker-protocol.ts` |
| `src/components/WorkspaceView/renderers/types.ts` | — |
| `src/components/WorkspaceView/renderers/worker-protocol.ts` | `src/components/WorkspaceView/renderers/types.ts` |
| `src/components/WorkspaceView/selectionUtils.ts` | `src/components/WorkspaceView/renderers/types.ts` |
| `src/components/WorkspaceView/useTerminalWorker.ts` | `src/components/WorkspaceView/renderers/types.ts`, `src/components/WorkspaceView/renderers/worker-protocol.ts` |
| `src/components/ui/ContextMenu.tsx` | — |
| `src/components/ui/DictationButton.tsx` | `src/hooks/useDictation.ts`, `src/store/useAppStore.ts` |
| `src/components/ui/ErrorBoundary.tsx` | — |
| `src/components/ui/ToastContainer.tsx` | `src/store/useAppStore.ts` |
| `src/hooks/useDictation.ts` | `src/store/useAppStore.ts` |
| `src/hooks/useFileTreeContextMenu.ts` | `src/hooks/useFileTreeOperations.ts` |
| `src/hooks/useFileTreeOperations.ts` | `src/store/useAppStore.ts`, `src/types/index.ts`, `src/utils/tauri.ts` |
| `src/hooks/useGlobalKeybindings.ts` | `src/store/useAppStore.ts`, `src/types/index.ts`, `src/utils/shortcuts.ts`, `src/utils/tauri.ts` |
| `src/main.tsx` | `src/App.tsx`, `src/components/ui/ErrorBoundary.tsx` |
| `src/store/useAppStore.ts` | `src/types/index.ts`, `src/utils/layout.ts` |
| `src/test-setup.ts` | — |
| `src/test_version.ts` | — |
| `src/types/index.ts` | — |
| `src/utils/constants.ts` | — |
| `src/utils/dragState.ts` | — |
| `src/utils/fs.ts` | — |
| `src/utils/layout.ts` | `src/types/index.ts` |
| `src/utils/lspManager.ts` | — |
| `src/utils/shortcuts.ts` | — |
| `src/utils/tauri.ts` | — |
| `src/vscode-extensions/default-extensions.ts` | — |
| `src/vscode-extensions/extensions.ts` | — |
| `src/vscode-extensions/setup.ts` | `src/vscode-extensions/default-extensions.ts` |

## Table 2 — Dependents / Ripple Risk (sorted by blast radius)

| File | Dependent Count | Imported By |
|------|----------------|-------------|
| `src/store/useAppStore.ts` | 29 | `src/App.tsx`, `src/components/CommandPalette/CommandPalette.tsx`, `src/components/EditorPane.tsx`, `src/components/EditorWelcomeScreen.tsx`, `src/components/FileTree.tsx`, `src/components/GitPanel.tsx`, `src/components/MarkdownModal/MarkdownModal.tsx`, `src/components/MarkdownPreview.tsx`, `src/components/SearchPanel.tsx`, `src/components/SettingsModal/SettingsModal.tsx`, `src/components/WorkspaceSidebar/ProjectTasks.tsx`, `src/components/WorkspaceSidebar/WorkspaceItem.tsx`, `src/components/WorkspaceSidebar/WorkspaceSidebar.tsx`, `src/components/WorkspaceView/BrowserPane.tsx`, `src/components/WorkspaceView/ClaudePane.tsx`, `src/components/WorkspaceView/DockerPaneComponent.tsx`, `src/components/WorkspaceView/KubernetesPaneComponent.tsx`, `src/components/WorkspaceView/NativeTerminalPane.tsx`, `src/components/WorkspaceView/TerminalGrid.tsx`, `src/components/WorkspaceView/TerminalPane.tsx`, `src/components/WorkspaceView/ToolingPane.tsx`, `src/components/WorkspaceView/WorkspaceHeader.tsx`, `src/components/WorkspaceView/WorkspaceTabBar.tsx`, `src/components/WorkspaceView/WorkspaceView.tsx`, `src/components/ui/DictationButton.tsx`, `src/components/ui/ToastContainer.tsx`, `src/hooks/useDictation.ts`, `src/hooks/useFileTreeOperations.ts`, `src/hooks/useGlobalKeybindings.ts` |
| `src/types/index.ts` | 17 | `src/App.tsx`, `src/components/SettingsModal/SettingsModal.tsx`, `src/components/WorkspaceModal/WorkspaceModal.tsx`, `src/components/WorkspaceSidebar/ProjectTasks.tsx`, `src/components/WorkspaceSidebar/WorkspaceItem.tsx`, `src/components/WorkspaceSidebar/WorkspaceSidebar.tsx`, `src/components/WorkspaceView/DockerPaneComponent.tsx`, `src/components/WorkspaceView/KubernetesPaneComponent.tsx`, `src/components/WorkspaceView/TerminalGrid.tsx`, `src/components/WorkspaceView/ToolingPane.tsx`, `src/components/WorkspaceView/WorkspaceHeader.tsx`, `src/components/WorkspaceView/WorkspaceTabBar.tsx`, `src/components/WorkspaceView/WorkspaceView.tsx`, `src/hooks/useFileTreeOperations.ts`, `src/hooks/useGlobalKeybindings.ts`, `src/store/useAppStore.ts`, `src/utils/layout.ts` |
| `src/utils/tauri.ts` | 10 | `src/App.tsx`, `src/components/SettingsModal/SettingsModal.tsx`, `src/components/WorkspaceView/BrowserPane.tsx`, `src/components/WorkspaceView/ClaudePane.tsx`, `src/components/WorkspaceView/NativeTerminalPane.tsx`, `src/components/WorkspaceView/TerminalPane.tsx`, `src/components/WorkspaceView/ToolingPane.tsx`, `src/components/WorkspaceView/WorkspaceView.tsx`, `src/hooks/useFileTreeOperations.ts`, `src/hooks/useGlobalKeybindings.ts` |
| `src/components/WorkspaceView/renderers/types.ts` | 7 | `src/components/WorkspaceView/NativeTerminalPane.tsx`, `src/components/WorkspaceView/renderers/CanvasRenderer.ts`, `src/components/WorkspaceView/renderers/WebGLRenderer.ts`, `src/components/WorkspaceView/renderers/terminal.worker.ts`, `src/components/WorkspaceView/renderers/worker-protocol.ts`, `src/components/WorkspaceView/selectionUtils.ts`, `src/components/WorkspaceView/useTerminalWorker.ts` |
| `src/components/ConfirmModal/ConfirmModal.tsx` | 5 | `src/App.tsx`, `src/components/EditorPane.tsx`, `src/components/FileTree.tsx`, `src/components/WorkspaceView/NativeTerminalPane.tsx`, `src/components/WorkspaceView/TerminalPane.tsx` |
| `src/hooks/useGlobalKeybindings.ts` | 3 | `src/App.tsx`, `src/components/WorkspaceView/NativeTerminalPane.tsx`, `src/components/WorkspaceView/TerminalPane.tsx` |
| `src/utils/fs.ts` | 3 | `src/components/EditorPane.tsx`, `src/components/FileTree.tsx`, `src/components/MarkdownModal/MarkdownModal.tsx` |
| `src/components/MarkdownPreview.tsx` | 2 | `src/components/EditorPane.tsx`, `src/components/MarkdownModal/MarkdownModal.tsx` |
| `src/components/WorkspaceView/NativeTerminalPane.tsx` | 2 | `src/components/WorkspaceView/TerminalGrid.tsx`, `src/components/WorkspaceView/ToolingPane.tsx` |
| `src/components/WorkspaceView/TerminalPane.tsx` | 2 | `src/components/WorkspaceView/TerminalGrid.tsx`, `src/components/WorkspaceView/ToolingPane.tsx` |
| `src/components/WorkspaceView/claudeOutputParser.ts` | 2 | `src/components/WorkspaceView/ClaudePane.tsx`, `src/components/WorkspaceView/claudeTranscript.ts` |
| `src/components/WorkspaceView/claudeTranscript.ts` | 2 | `src/components/WorkspaceView/ClaudePane.tsx`, `src/components/WorkspaceView/ClaudeTranscriptView.tsx` |
| `src/components/WorkspaceView/renderers/CanvasRenderer.ts` | 2 | `src/components/WorkspaceView/NativeTerminalPane.tsx`, `src/components/WorkspaceView/renderers/terminal.worker.ts` |
| `src/components/WorkspaceView/renderers/WebGLRenderer.ts` | 2 | `src/components/WorkspaceView/NativeTerminalPane.tsx`, `src/components/WorkspaceView/renderers/terminal.worker.ts` |
| `src/components/WorkspaceView/renderers/worker-protocol.ts` | 2 | `src/components/WorkspaceView/renderers/terminal.worker.ts`, `src/components/WorkspaceView/useTerminalWorker.ts` |
| `src/components/ui/ErrorBoundary.tsx` | 2 | `src/components/WorkspaceView/TerminalGrid.tsx`, `src/main.tsx` |
| `src/hooks/useFileTreeContextMenu.ts` | 2 | `src/components/FileTree.tsx`, `src/components/FileTreeContextMenu.tsx` |
| `src/hooks/useFileTreeOperations.ts` | 2 | `src/components/FileTree.tsx`, `src/hooks/useFileTreeContextMenu.ts` |
| `src/utils/constants.ts` | 2 | `src/components/WorkspaceView/NativeTerminalPane.tsx`, `src/components/WorkspaceView/TerminalPane.tsx` |
| `src/App.tsx` | 1 | `src/main.tsx` |
| `src/components/CommandPalette/CommandPalette.tsx` | 1 | `src/App.tsx` |
| `src/components/EditorPane.tsx` | 1 | `src/components/WorkspaceView/TerminalGrid.tsx` |
| `src/components/FileTree.tsx` | 1 | `src/components/EditorPane.tsx` |
| `src/components/FileTreeContextMenu.tsx` | 1 | `src/components/FileTree.tsx` |
| `src/components/FileTreeInlineInput.tsx` | 1 | `src/components/FileTree.tsx` |
| `src/components/GitPanel.tsx` | 1 | `src/components/EditorPane.tsx` |
| `src/components/MarkdownModal/MarkdownModal.tsx` | 1 | `src/App.tsx` |
| `src/components/SearchPanel.tsx` | 1 | `src/components/EditorPane.tsx` |
| `src/components/SettingsModal/SettingsModal.tsx` | 1 | `src/App.tsx` |
| `src/components/UsernameModal/UsernameModal.tsx` | 1 | `src/App.tsx` |
| `src/components/WorkspaceModal/WorkspaceModal.tsx` | 1 | `src/App.tsx` |
| `src/components/WorkspaceSidebar/AddWorkspaceButton.tsx` | 1 | `src/components/WorkspaceSidebar/WorkspaceSidebar.tsx` |
| `src/components/WorkspaceSidebar/ProjectTasks.tsx` | 1 | `src/components/WorkspaceSidebar/WorkspaceSidebar.tsx` |
| `src/components/WorkspaceSidebar/WorkspaceItem.tsx` | 1 | `src/components/WorkspaceSidebar/WorkspaceSidebar.tsx` |
| `src/components/WorkspaceSidebar/WorkspaceSidebar.tsx` | 1 | `src/App.tsx` |
| `src/components/WorkspaceView/BrowserPane.tsx` | 1 | `src/components/WorkspaceView/TerminalGrid.tsx` |
| `src/components/WorkspaceView/ClaudePane.tsx` | 1 | `src/components/WorkspaceView/TerminalGrid.tsx` |
| `src/components/WorkspaceView/ClaudeRawStream.tsx` | 1 | `src/components/WorkspaceView/ClaudePane.tsx` |
| `src/components/WorkspaceView/DockerPaneComponent.tsx` | 1 | `src/components/WorkspaceView/TerminalGrid.tsx` |
| `src/components/WorkspaceView/KubernetesPaneComponent.tsx` | 1 | `src/components/WorkspaceView/TerminalGrid.tsx` |
| `src/components/WorkspaceView/TerminalGrid.tsx` | 1 | `src/components/WorkspaceView/WorkspaceView.tsx` |
| `src/components/WorkspaceView/ToolingPane.tsx` | 1 | `src/components/WorkspaceView/WorkspaceView.tsx` |
| `src/components/WorkspaceView/WorkspaceHeader.tsx` | 1 | `src/components/WorkspaceView/WorkspaceView.tsx` |
| `src/components/WorkspaceView/WorkspaceTabBar.tsx` | 1 | `src/components/WorkspaceView/WorkspaceView.tsx` |
| `src/components/WorkspaceView/WorkspaceView.tsx` | 1 | `src/App.tsx` |
| `src/components/WorkspaceView/renderers/GlyphAtlas.ts` | 1 | `src/components/WorkspaceView/renderers/WebGLRenderer.ts` |
| `src/components/WorkspaceView/selectionUtils.ts` | 1 | `src/components/WorkspaceView/NativeTerminalPane.tsx` |
| `src/components/WorkspaceView/useTerminalWorker.ts` | 1 | `src/components/WorkspaceView/NativeTerminalPane.tsx` |
| `src/components/ui/ContextMenu.tsx` | 1 | `src/App.tsx` |
| `src/components/ui/DictationButton.tsx` | 1 | `src/App.tsx` |
| `src/components/ui/ToastContainer.tsx` | 1 | `src/App.tsx` |
| `src/hooks/useDictation.ts` | 1 | `src/components/ui/DictationButton.tsx` |
| `src/utils/layout.ts` | 1 | `src/store/useAppStore.ts` |
| `src/utils/lspManager.ts` | 1 | `src/components/EditorPane.tsx` |
| `src/utils/shortcuts.ts` | 1 | `src/hooks/useGlobalKeybindings.ts` |
| `src/vscode-extensions/default-extensions.ts` | 1 | `src/vscode-extensions/setup.ts` |
| `src/vscode-extensions/setup.ts` | 1 | `src/components/EditorPane.tsx` |
| `src/components/EditorWelcomeScreen.tsx` | 0 | — |
| `src/components/ErrorBoundary.tsx` | 0 | — |
| `src/components/WorkspaceView/ClaudeTranscriptView.tsx` | 0 | — |
| `src/components/WorkspaceView/renderers/terminal.worker.ts` | 0 | — |
| `src/main.tsx` | 0 | — |
| `src/test-setup.ts` | 0 | — |
| `src/test_version.ts` | 0 | — |
| `src/utils/dragState.ts` | 0 | — |
| `src/vscode-extensions/extensions.ts` | 0 | — |

## High-Risk Files (3+ dependents)

Changes here have a wide blast radius — check all dependents before editing.

- `src/store/useAppStore.ts` — **29 dependents**
- `src/types/index.ts` — **17 dependents**
- `src/utils/tauri.ts` — **10 dependents**
- `src/components/WorkspaceView/renderers/types.ts` — **7 dependents**
- `src/components/ConfirmModal/ConfirmModal.tsx` — **5 dependents**
- `src/hooks/useGlobalKeybindings.ts` — **3 dependents**
- `src/utils/fs.ts` — **3 dependents**
