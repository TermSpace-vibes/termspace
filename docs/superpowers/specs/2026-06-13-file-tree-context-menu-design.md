# File Tree Context Menu — Design Spec

**Date:** 2026-06-13  
**Status:** Approved

## Overview

Add right-click context menu to `FileTree.tsx` with file operations: create file/folder, rename, delete, copy path, and open folder in terminal. Uses existing `@tauri-apps/plugin-fs` APIs — no new Rust commands needed.

## New Files

```
src/components/
  FileTreeContextMenu.tsx       — floating context menu UI
  FileTreeInlineInput.tsx       — inline name input row for create/rename

src/hooks/
  useFileTreeContextMenu.ts     — menu open/close/position state
  useFileTreeOperations.ts      — fs ops: create, rename, delete, copy path
```

`FileTree.tsx` is modified to compose these hooks and components.

## Architecture & Data Flow

1. `TreeNode` receives `onContextMenu` prop → fires hook to set `{ x, y, node }`
2. `FileTreeContextMenu` reads that state, renders as fixed-position div at `(x, y)`
3. User picks action → `useFileTreeOperations` executes the fs op
4. On success → `onRefresh(parentPath)` callback re-fetches that directory's children, updates `loadedChildren` in FileTree
5. For create/rename → `FileTreeInlineInput` mounts as a virtual row in the flat list at the correct depth; commits on Enter/blur, cancels on Escape

## File System Operations

All ops use `@tauri-apps/plugin-fs` (already imported in `fs.ts`).

| Operation     | API                                        |
|---------------|--------------------------------------------|
| Create file   | `writeTextFile(path, '')`                  |
| Create folder | `mkdir(path)`                              |
| Rename        | `rename(oldPath, newPath)`                 |
| Delete file   | `remove(path)`                             |
| Delete folder | `remove(path, { recursive: true })`        |
| Copy path     | `navigator.clipboard.writeText(path)`      |
| Open terminal | invoke `spawn_terminal` with `cwd = path`  |

Error handling: failed ops show a brief inline error below the context menu. No modal for non-destructive errors.

## Context Menu Items by Node Type

| Item             | File | Folder |
|------------------|------|--------|
| New File         | —    | ✓      |
| New Folder       | —    | ✓      |
| Rename           | ✓    | ✓      |
| Delete           | ✓    | ✓      |
| Copy Path        | ✓    | ✓      |
| Open in Terminal | —    | ✓      |

## Context Menu UI

- Fixed-position div at click `(x, y)`, `z-index: 1000`
- Styled with existing CSS vars: `var(--bg-sidebar)`, `var(--border-inactive)`, `var(--text-active)`
- Closes on: click outside, Escape keydown, scroll
- Delete triggers existing `ConfirmModal` before executing

## Inline Input (`FileTreeInlineInput`)

- Renders as a virtual row inserted at the correct depth in the virtualized flat list
- Same `ITEM_HEIGHT = 28px`, same left-padding indent as siblings
- Auto-focuses on mount
- Rename: pre-fills current node name, selects all text
- Enter → commit (if non-empty), Escape → cancel, blur → commit if non-empty else cancel
- Duplicate names at same level → show inline error, do not commit

## State Shape

### `useFileTreeContextMenu`
```ts
interface ContextMenuState {
  x: number
  y: number
  node: FlatNode
} | null
```

### `useFileTreeOperations`
```ts
interface InlineInputState {
  mode: 'create-file' | 'create-folder' | 'rename'
  parentPath: string
  node?: FlatNode  // present for rename
} | null
```

## Out of Scope

- Drag and drop (separate feature)
- Duplicate file operation
- Multi-select operations
