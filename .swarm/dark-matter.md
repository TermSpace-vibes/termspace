## Dark Matter: Hidden Couplings

Found 20 file pairs that frequently co-change but have no import relationship:

| File A | File B | NPMI | Co-Changes | Lift |
|--------|--------|------|------------|------|
| package-lock.json | package.json | 0.965 | 8 | 26.00 |
| src-tauri/src/commands.rs | src-tauri/src/lib.rs | 0.824 | 30 | 5.43 |
| src/components/WorkspaceView/renderers/terminal.worker.ts | src/components/WorkspaceView/useTerminalWorker.ts | 0.817 | 3 | 35.10 |
| src/components/EditorPane.test.tsx | src/components/WorkspaceView/KubernetesPaneComponent.tsx | 0.775 | 3 | 29.25 |
| src/components/EditorPane.tsx | src/components/WorkspaceView/KubernetesPaneComponent.tsx | 0.751 | 4 | 21.27 |
| src-tauri/src/browser_pane_manager.rs | src/components/WorkspaceView/BrowserPane.tsx | 0.719 | 8 | 11.35 |
| src/components/WorkspaceSidebar/AddWorkspaceButton.tsx | src/components/WorkspaceSidebar/WorkspaceItem.tsx | 0.704 | 5 | 15.00 |
| src-tauri/Cargo.lock | src-tauri/Cargo.toml | 0.699 | 12 | 7.98 |
| src/components/CommandPalette/CommandPalette.tsx | src/store/useAppStore.test.ts | 0.688 | 3 | 20.06 |
| src/components/FileTree.tsx | src/store/useAppStore.test.ts | 0.688 | 3 | 20.06 |
| src/components/EditorPane.test.tsx | src/components/WorkspaceView/BrowserPane.tsx | 0.667 | 5 | 13.00 |
| src/components/WorkspaceSidebar/ProjectTasks.tsx | src/components/WorkspaceView/TerminalGrid.test.tsx | 0.658 | 3 | 17.55 |
| package-lock.json | src-tauri/capabilities/default.json | 0.658 | 3 | 17.55 |
| src/components/WorkspaceSidebar/WorkspaceSidebar.tsx | src/components/WorkspaceView/TerminalPane.tsx | 0.657 | 13 | 6.67 |
| src/components/WorkspaceSidebar/WorkspaceSidebar.tsx | src/styles/globals.css | 0.649 | 8 | 8.96 |
| src/components/EditorPane.test.tsx | src/components/FileTree.tsx | 0.646 | 3 | 16.71 |
| src/components/EditorPane.tsx | src/components/WorkspaceSidebar/ProjectTasks.tsx | 0.636 | 3 | 15.95 |
| package.json | src-tauri/capabilities/default.json | 0.631 | 3 | 15.60 |
| src/components/WorkspaceView/KubernetesPaneComponent.tsx | src/hooks/useGlobalKeybindings.ts | 0.616 | 3 | 14.62 |
| src/components/CommandPalette/CommandPalette.tsx | src/components/EditorPane.tsx | 0.614 | 4 | 12.16 |

These pairs likely share an architectural concern invisible to static analysis.
Consider adding explicit documentation or extracting the shared concern.