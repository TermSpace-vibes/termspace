# Claude Code Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multiple dedicated Claude Code panes per Termspace tab, backed by independent local `claude` CLI sessions.

**Architecture:** Extend the existing pane model with `ClaudePane`, a `claude` layout node, and store actions matching browser/editor/docker panes. Add a React `ClaudePaneComponent` that owns one CLI session through Tauri commands, while Rust owns process lifecycle and emits per-session output events.

**Tech Stack:** React 19, TypeScript, Zustand, Vitest/jsdom, Tauri v2, Rust, portable-pty, lucide-react.

---

## File Structure

- Modify `src/types/index.ts` for `ClaudePane`, `ClaudePaneStatus`, and `LayoutNode`.
- Modify `src/utils/layout.ts` for `addClaudePaneToLayout` and `removeClaudePaneFromLayout`.
- Modify `src/utils/layout.test.ts` for Claude layout red/green tests.
- Modify `src/store/useAppStore.ts` for `claudePanesByTab` and pane actions.
- Modify `src/store/useAppStore.test.ts` for multiple Claude panes in one tab.
- Create `src/components/WorkspaceView/ClaudePane.tsx` for the dedicated UI and CLI session wiring.
- Create `src/components/WorkspaceView/ClaudePane.test.tsx` for composer keyboard behavior.
- Modify `src/components/WorkspaceView/TerminalGrid.tsx` to render Claude panes.
- Modify `src/components/WorkspaceView/WorkspaceView.tsx` to create and close Claude panes.
- Modify `src/components/WorkspaceView/WorkspaceHeader.tsx` to expose a `Claude` action.
- Modify `src/components/WorkspaceSidebar/WorkspaceSidebar.tsx` to add the sidebar launch button.
- Modify `src/App.tsx` to pass the sidebar launch callback.
- Create `src-tauri/src/claude_session_manager.rs` for CLI process lifecycle.
- Modify `src-tauri/src/commands.rs` and `src-tauri/src/lib.rs` to register Claude commands and state.

## Task 1: Layout Type And Helper Tests

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/utils/layout.ts`
- Test: `src/utils/layout.test.ts`

- [ ] **Step 1: Write failing layout tests**

Add imports and tests:

```ts
import {
  addBrowserPaneToLayout,
  removeBrowserPaneFromLayout,
  addClaudePaneToLayout,
  removeClaudePaneFromLayout,
} from './layout'

describe('addClaudePaneToLayout', () => {
  it('creates a single Claude node wrapped in split when root is null', () => {
    const result = addClaudePaneToLayout(null, 'claude-1')
    expect(result).toEqual({
      type: 'split', id: 'root', direction: 'horizontal', sizes: [100],
      children: [{ type: 'claude', id: 'claude-claude-1', claudePaneId: 'claude-1' }]
    })
  })

  it('appends multiple Claude panes to the same split', () => {
    const first = addClaudePaneToLayout(null, 'claude-1')
    const second = addClaudePaneToLayout(first, 'claude-2')
    expect(second.type).toBe('split')
    if (second.type === 'split') {
      expect(second.children.map(child => child.type)).toEqual(['claude', 'claude'])
      expect(second.sizes).toEqual([50, 50])
    }
  })
})

describe('removeClaudePaneFromLayout', () => {
  it('removes a Claude node and normalizes remaining split sizes', () => {
    const root: LayoutNode = {
      type: 'split', id: 's1', direction: 'horizontal', sizes: [50, 50],
      children: [
        { type: 'pane', id: 'p1', terminalId: 't-1' },
        { type: 'claude', id: 'c1', claudePaneId: 'claude-1' },
      ]
    }
    expect(removeClaudePaneFromLayout(root, 'claude-1')).toEqual({
      type: 'split', id: 's1', direction: 'horizontal', sizes: [100],
      children: [{ type: 'pane', id: 'p1', terminalId: 't-1' }]
    })
  })
})
```

- [ ] **Step 2: Run test to verify RED**

Run: `npm test -- src/utils/layout.test.ts`

Expected: fail because `addClaudePaneToLayout` and `removeClaudePaneFromLayout` are not exported.

- [ ] **Step 3: Add minimal type/helper implementation**

Add `ClaudePane` and `claude` layout node in `src/types/index.ts`. Add layout helpers mirroring browser/docker helpers, and include `claude` in shared node checks.

- [ ] **Step 4: Run test to verify GREEN**

Run: `npm test -- src/utils/layout.test.ts`

Expected: pass.

## Task 2: Store Tests And Store Actions

**Files:**
- Modify: `src/store/useAppStore.ts`
- Test: `src/store/useAppStore.test.ts`

- [ ] **Step 1: Write failing store tests**

Add tests:

```ts
it('adds multiple Claude panes to one tab', () => {
  const tabId = 'tab-claude'
  const first = { id: 'claude-1', tabId, title: 'Claude 1', cwd: '/tmp', position: 0, createdAt: 1, status: 'starting' as const }
  const second = { id: 'claude-2', tabId, title: 'Claude 2', cwd: '/tmp', position: 1, createdAt: 2, status: 'starting' as const }

  useAppStore.getState().addClaudePane(tabId, first)
  useAppStore.getState().addClaudePane(tabId, second)

  expect(useAppStore.getState().claudePanesByTab[tabId].map(p => p.id)).toEqual(['claude-1', 'claude-2'])
})

it('removes Claude panes from store and layout', () => {
  const tabId = 'tab-remove-claude'
  const pane = { id: 'claude-1', tabId, title: 'Claude 1', cwd: '/tmp', position: 0, createdAt: 1, status: 'ready' as const }
  useAppStore.getState().addClaudePane(tabId, pane)
  useAppStore.getState().removeClaudePane(tabId, pane.id)

  expect(useAppStore.getState().claudePanesByTab[tabId]).toEqual([])
  expect(useAppStore.getState().layoutsByTab[tabId]).toBeNull()
})
```

- [ ] **Step 2: Run test to verify RED**

Run: `npm test -- src/store/useAppStore.test.ts`

Expected: fail because `claudePanesByTab`, `addClaudePane`, and `removeClaudePane` are missing.

- [ ] **Step 3: Implement store actions**

Add `claudePanesByTab`, `addClaudePane`, `removeClaudePane`, and `updateClaudePane` following the Docker pane store pattern. Persist `claudePanesByTab` in `partialize`.

- [ ] **Step 4: Run test to verify GREEN**

Run: `npm test -- src/store/useAppStore.test.ts`

Expected: pass.

## Task 3: Claude Pane Component Tests And UI

**Files:**
- Create: `src/components/WorkspaceView/ClaudePane.tsx`
- Test: `src/components/WorkspaceView/ClaudePane.test.tsx`

- [ ] **Step 1: Write failing composer test**

Test that Enter sends and Shift+Enter keeps a newline:

```tsx
it('sends prompt on Enter and keeps newline on Shift+Enter', async () => {
  render(<ClaudePaneComponent tabId="tab-1" paneId="claude-1" isActive onFocus={() => {}} onClose={() => {}} />)
  const input = screen.getByPlaceholderText('Ask Claude to edit...')
  await userEvent.type(input, 'hello')
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(invoke).toHaveBeenCalledWith('write_claude_session', expect.objectContaining({ sessionId: 'claude-1', data: 'hello\\n' }))
})
```

- [ ] **Step 2: Run test to verify RED**

Run: `npm test -- src/components/WorkspaceView/ClaudePane.test.tsx`

Expected: fail because the component does not exist.

- [ ] **Step 3: Implement component**

Build a focused component with title bar, transcript, textarea composer, restart/stop/close controls, event listeners for `claude-output-${paneId}`, `claude-error-${paneId}`, and `claude-exit-${paneId}`, and invoke calls for spawn/write/stop/close.

- [ ] **Step 4: Run test to verify GREEN**

Run: `npm test -- src/components/WorkspaceView/ClaudePane.test.tsx`

Expected: pass.

## Task 4: Grid, Workspace, Header, And Sidebar Wiring

**Files:**
- Modify: `src/components/WorkspaceView/TerminalGrid.tsx`
- Modify: `src/components/WorkspaceView/WorkspaceView.tsx`
- Modify: `src/components/WorkspaceView/WorkspaceHeader.tsx`
- Modify: `src/components/WorkspaceSidebar/WorkspaceSidebar.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Wire render path**

Add `claude` handling to `containsMaximized`, `getNodeKey`, `renderLayoutPlaceholder`, and `renderAbsoluteNode`. Pass `onCloseClaudePane` and render `ClaudePaneComponent`.

- [ ] **Step 2: Wire creation path**

In `WorkspaceView`, add `handleAddClaudePane` that creates a new `ClaudePane` in the active tab with title `Claude N`, cwd from active terminal, workspace default path, or empty string, then focuses it.

- [ ] **Step 3: Add controls**

Add a compact `Claude` button to `WorkspaceHeader` and a `Launch Claude Code` sidebar button in `WorkspaceSidebar`.

- [ ] **Step 4: Run frontend tests/build**

Run: `npm test -- src/utils/layout.test.ts src/store/useAppStore.test.ts src/components/WorkspaceView/ClaudePane.test.tsx`

Expected: pass.

Run: `npm run build`

Expected: TypeScript and Vite build pass.

## Task 5: Rust Claude CLI Session Bridge

**Files:**
- Create: `src-tauri/src/claude_session_manager.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Implement session manager**

Use `portable_pty` to spawn `claude` in a PTY, keep writer/child handles by session id, read output on a background thread, and emit `claude-output-${id}`, `claude-error-${id}`, and `claude-exit-${id}`.

- [ ] **Step 2: Register commands**

Add `spawn_claude_session`, `write_claude_session`, `stop_claude_session`, and `close_claude_session` commands, manage `ClaudeSessionManager` in setup, and add commands to `generate_handler`.

- [ ] **Step 3: Run Rust checks**

Run: `npm run tauri build`

Expected: Rust and frontend build complete. If app signing/bundling fails for local environment reasons after compilation, capture the exact failure and run `cargo check --manifest-path src-tauri/Cargo.toml`.

## Task 6: Manual Validation

**Files:**
- No code files.

- [ ] **Step 1: Start dev app**

Run: `npm run tauri dev`

Expected: app opens.

- [ ] **Step 2: Validate behavior**

Click `Launch Claude Code` twice in one tab. Expected: `Claude 1` and `Claude 2` panes appear as independent panes. Send a small prompt in each. Expected: each pane streams independent CLI output or shows a clear missing-CLI error.
