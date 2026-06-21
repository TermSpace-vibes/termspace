# Design Spec: Editor Enhancements (Tabs, Persistence, Images, Autosave)

## Overview
Enhance the current `EditorPane` from a single-file editor to a multi-file, tabbed environment with improved binary handling and persistence.

## Current State Architecture

The implemented editor state is split between persisted pane metadata in Zustand and transient per-mounted-pane UI state in `EditorPaneComponent`.

### Persisted Store State

Editor panes are stored by workspace tab id in `editorPanesByTab: Record<string, EditorPane[]>`. Each `EditorPane` record describes durable pane metadata:

```typescript
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
```

Related editor state:

- `activeFileByTab: Record<string, string | null>` tracks the active file at tab scope for shortcuts and file tree highlighting.
- `gitStatusByWorkspace: Record<string, GitStatus>` caches Git status by workspace/root.
- `layoutsByTab: Record<string, LayoutNode | null>` owns placement of editor panes beside terminals, browsers, and Kubernetes panes.
- Persist middleware stores editor panes under the legacy key `editorPanesByWorkspace`, mapped from `editorPanesByTab`.

### Store Actions

- `setEditorPanes(tabId, panes)` replaces editor panes and repairs layout references.
- `addEditorPane(tabId, pane, targetId?, direction?)` appends a pane and inserts an editor node into the layout tree.
- `removeEditorPane(tabId, editorPaneId)` removes pane state and its layout node.
- `updateEditorPaneFile(tabId, editorPaneId, path, lineNumber?)` adds a file to `openFiles`, promotes it in `mruStack`, updates `activeFilePath`, updates `activeFileByTab`, and optionally sets `jumpToLine`.
- `closeEditorFile(tabId, editorPaneId, filePath)` removes the file from `openFiles` and `mruStack`; if it was active, the next active file comes from the MRU stack.
- `updateEditorPaneLayout(tabId, editorPaneId, layout)` merges pane UI metadata such as `fileTreeWidth`, `activeSidebarTab`, `diffViewEnabled`, `rootPath`, or `jumpToLine`.
- `splitEditor(tabId, editorPaneId, direction)` clones the source pane metadata into a new pane and adds it beside the original through the layout tree.

### Component-Local State

`EditorPaneComponent` keeps editor session state that is not currently persisted:

- `fileContent` and `originalFileContent` hold the active file buffer and Git baseline for diff view.
- `isDirty` tracks unsaved edits only for the active file in the mounted pane.
- `isLoading` guards async file reads.
- `showPreview` controls Markdown preview visibility for `.md` files and defaults to `true` on mount.
- `showConfirmDiscard` holds the pending file switch when unsaved edits would be discarded.
- Monaco editor refs and blame decoration refs are stored in `useRef`.

### File Selection And Render Flow

1. `FileTree`, `GitPanel`, `SearchPanel`, command palette, or terminal file detection calls `updateEditorPaneFile`.
2. The store updates open tabs, MRU order, active file, optional line jump, and tab-scoped active file.
3. `EditorPaneComponent` reacts to `activeFilePath`, reads text content through `readTextFileContent`, or skips binary files.
4. Images render through `convertFileSrc`; unsupported binary files render a placeholder.
5. Markdown files render `MarkdownPreview` when `showPreview` is true; otherwise Monaco renders the Markdown source.
6. Diff view loads original content through `get_git_file_content` and renders Monaco `DiffEditor`.
7. Save writes through `writeTextFileContent`, clears dirty state, shows a toast, and refreshes Git status.

### Markdown Preview State

Markdown preview is intentionally local to each mounted editor pane today. The only stored Markdown-related state is the active file path; `showPreview` is not part of `EditorPane`, so preview mode resets to visible when the pane remounts. If preview visibility should persist per pane, add a field such as `markdownPreviewVisible?: boolean` to `EditorPane` and update it via `updateEditorPaneLayout`.

## 1. Architecture & State Changes

### 1.1 Store Updates (`src/types/index.ts`)
Modify `EditorPane` interface:
```typescript
export interface EditorPane {
  id: string
  workspaceId: string
  rootPath: string
  openFiles: string[]       // List of absolute paths currently open in tabs
  activeFilePath: string | null // The currently visible file
  mruStack: string[]        // Paths ordered by most recently used
  fileTreeWidth: number     // Persistent percentage for the FileTree panel
  position: number
  createdAt: number
}
```

Modify `Settings` interface:
```typescript
export interface Settings {
  // ... existing
  autosave: boolean
}
```

### 1.2 Store Actions (`src/store/useAppStore.ts`)
- `updateEditorPaneFile`: Update to handle adding to `openFiles` and updating `mruStack`.
- `closeEditorFile(workspaceId, paneId, filePath)`: Remove from `openFiles` and `mruStack`.
- `updateEditorPaneLayout(workspaceId, paneId, { fileTreeWidth })`: Persist panel sizes.

## 2. Component Enhancements (`src/components/EditorPane.tsx`)

### 2.1 Tab Bar
- Add a scrollable horizontal bar below the header/breadcrumbs.
- Each tab shows the file name, a "dirty" indicator (dot), and a close button (x).
- Clicking a tab makes it the `activeFilePath`.

### 2.2 MRU Switching
- Implement logic to track usage order in `mruStack`.
- Support `Cmd+Tab` (or similar) to cycle through the stack if requested later (initial implementation focuses on state tracking).

### 2.3 Image Preview
- New helper `isImageFile(path: string)`.
- If `activeFilePath` is an image, use `@tauri-apps/api/core`'s `convertFileSrc` to render a centered `<img>` with a transparent "checkerboard" background.

### 2.4 Persistent Layout
- Replace hardcoded `defaultSize={20}` with `editorPane.fileTreeWidth`.
- Use `onResize` or `onLayout` from `react-resizable-panels` to sync width back to the store.

### 2.5 Global Autosave
- Add `useEffect` with `setTimeout` (1000ms) that calls `handleSave()` if `settings.autosave` is true and `isDirty` is true.
- Clear timeout on any new change (debounce).

## 3. User Interaction Flow
1. User clicks file in `FileTree`.
2. Action adds file to `openFiles` (if new), sets as `activeFilePath`, and moves to top of `mruStack`.
3. If file is an image, it renders immediately.
4. If file is text, Monaco loads content.
5. User resizes FileTree; width is saved to SQLite via Zustand persistence.

## 4. Testing Strategy
- **Unit:** Test `mruStack` logic in `useAppStore.test.ts`.
- **Manual:** Verify image rendering for various formats.
- **Persistence:** Reload app and ensure tab list and sidebar width remain unchanged.
