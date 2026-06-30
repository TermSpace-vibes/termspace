# Claude Code Pane V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Claude panes to run persistent interactive local Claude CLI sessions with streaming output, transcript rows, raw stream fallback, and reliable lifecycle controls.

**Architecture:** Keep the existing `ClaudePane` store/layout wiring, but replace the normal prompt path from `run_claude_prompt` to `spawn_claude_session` plus `write_claude_session`. Split transcript parsing/rendering into focused frontend modules, keep raw chunks alongside parsed rows, and tighten the Rust session manager around interactive PTY lifecycle and cleanup.

**Tech Stack:** React 19, TypeScript, Zustand, Vitest/jsdom, Testing Library, Tauri v2, Rust, portable-pty.

---

## File Structure

- Create: `src/components/WorkspaceView/claudeOutputParser.ts`
  - Classifies incoming Claude CLI chunks into readable text, raw terminal redraw output, blocked/prompt-like output, and auth-like errors.
- Create: `src/components/WorkspaceView/claudeOutputParser.test.ts`
  - Unit tests for ANSI/control classification and readable-text extraction.
- Create: `src/components/WorkspaceView/claudeTranscript.ts`
  - Defines transcript row/raw chunk types and reducer helpers.
- Create: `src/components/WorkspaceView/claudeTranscript.test.ts`
  - Unit tests for transcript append/error/exit/block behavior.
- Create: `src/components/WorkspaceView/ClaudeTranscriptView.tsx`
  - Timeline renderer for transcript rows.
- Create: `src/components/WorkspaceView/ClaudeRawStream.tsx`
  - Collapsible raw stream renderer.
- Modify: `src/components/WorkspaceView/ClaudePane.tsx`
  - Owns listener attachment, interactive spawn/write lifecycle, toolbar controls, composer state, and renderer composition.
- Modify: `src/components/WorkspaceView/ClaudePane.test.tsx`
  - Replace `--print` expectations with interactive spawn/write/stream lifecycle tests.
- Modify: `src/types/index.ts`
  - Add `blocked` to `ClaudePaneStatus`.
- Modify: `src-tauri/src/claude_session_manager.rs`
  - Add readiness emission, cwd validation fallback, automatic handle cleanup on reader exit, and unit-test helpers.
- Modify: `docs/dependency-map.md`
  - Regenerate after adding new `src/` files.

Before implementing, preserve the dirty worktree. Stage and commit only files explicitly touched by each task.

## Task 1: Parser And Transcript Model

**Files:**
- Create: `src/components/WorkspaceView/claudeOutputParser.ts`
- Create: `src/components/WorkspaceView/claudeOutputParser.test.ts`
- Create: `src/components/WorkspaceView/claudeTranscript.ts`
- Create: `src/components/WorkspaceView/claudeTranscript.test.ts`

- [ ] **Step 1: Write parser tests**

Create `src/components/WorkspaceView/claudeOutputParser.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseClaudeChunk } from './claudeOutputParser'

describe('parseClaudeChunk', () => {
  it('keeps readable assistant text while preserving raw chunk', () => {
    expect(parseClaudeChunk('Hello from Claude\n')).toEqual({
      raw: 'Hello from Claude\n',
      readableText: 'Hello from Claude',
      kind: 'assistant',
    })
  })

  it('classifies terminal redraw noise as raw', () => {
    expect(parseClaudeChunk('\u001b[?25l\u001b[2K\r\u001b[?25h')).toEqual({
      raw: '\u001b[?25l\u001b[2K\r\u001b[?25h',
      readableText: '',
      kind: 'raw',
    })
  })

  it('classifies prompt-like confirmation output as blocked', () => {
    const chunk = 'Do you want to proceed? (y/N)'

    expect(parseClaudeChunk(chunk)).toEqual({
      raw: chunk,
      readableText: chunk,
      kind: 'blocked',
    })
  })

  it('classifies login/auth output as error', () => {
    const chunk = 'Please run claude login to continue.'

    expect(parseClaudeChunk(chunk)).toEqual({
      raw: chunk,
      readableText: chunk,
      kind: 'error',
    })
  })
})
```

- [ ] **Step 2: Write transcript reducer tests**

Create `src/components/WorkspaceView/claudeTranscript.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  appendClaudeError,
  appendClaudeExit,
  appendClaudeOutput,
  appendClaudeUserPrompt,
  createClaudeTranscript,
} from './claudeTranscript'

describe('claudeTranscript', () => {
  it('appends user prompts as user rows', () => {
    const transcript = appendClaudeUserPrompt(createClaudeTranscript(), 'hello')

    expect(transcript.rows).toMatchObject([
      { kind: 'user', text: 'hello' },
    ])
    expect(transcript.rawChunks).toEqual([])
  })

  it('keeps raw chunks and appends readable assistant rows', () => {
    const transcript = appendClaudeOutput(createClaudeTranscript(), 'Hi there\n')

    expect(transcript.rawChunks).toEqual(['Hi there\n'])
    expect(transcript.rows).toMatchObject([
      { kind: 'assistant', text: 'Hi there' },
    ])
  })

  it('keeps raw-only terminal redraw chunks out of the visible timeline', () => {
    const transcript = appendClaudeOutput(createClaudeTranscript(), '\u001b[?25l\u001b[2K\r\u001b[?25h')

    expect(transcript.rawChunks).toHaveLength(1)
    expect(transcript.rows).toEqual([])
  })

  it('appends blocked and error rows from classified output', () => {
    const blocked = appendClaudeOutput(createClaudeTranscript(), 'Do you want to proceed? (y/N)')
    const errored = appendClaudeOutput(blocked, 'Please run claude login to continue.')

    expect(errored.rows).toMatchObject([
      { kind: 'blocked', text: 'Do you want to proceed? (y/N)' },
      { kind: 'error', text: 'Please run claude login to continue.' },
    ])
  })

  it('appends explicit error and exit rows', () => {
    const errored = appendClaudeError(createClaudeTranscript(), 'Claude CLI not found')
    const exited = appendClaudeExit(errored, 'Claude session exited')

    expect(exited.rows).toMatchObject([
      { kind: 'error', text: 'Claude CLI not found' },
      { kind: 'status', text: 'Claude session exited' },
    ])
  })
})
```

- [ ] **Step 3: Run tests to verify RED**

Run:

```bash
npm test -- src/components/WorkspaceView/claudeOutputParser.test.ts src/components/WorkspaceView/claudeTranscript.test.ts
```

Expected: both suites fail because the modules do not exist.

- [ ] **Step 4: Implement parser**

Create `src/components/WorkspaceView/claudeOutputParser.ts`:

```ts
export type ClaudeParsedChunkKind = 'assistant' | 'raw' | 'blocked' | 'error'

export interface ClaudeParsedChunk {
  raw: string
  readableText: string
  kind: ClaudeParsedChunkKind
}

export function stripClaudeAnsi(text: string): string {
  return text
    .replace(/\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[@-Z\\-_]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .join('\n')
    .trim()
}

export function parseClaudeChunk(raw: string): ClaudeParsedChunk {
  const readableText = stripClaudeAnsi(raw)
  if (!readableText) {
    return { raw, readableText: '', kind: 'raw' }
  }

  const lower = readableText.toLowerCase()
  if (
    lower.includes('claude login') ||
    lower.includes('not authenticated') ||
    lower.includes('authentication') ||
    lower.includes('api key')
  ) {
    return { raw, readableText, kind: 'error' }
  }

  if (
    /\((y\/n|y\/N|yes\/no)\)/.test(readableText) ||
    readableText.includes('Do you want to proceed?') ||
    readableText.includes('Allow this command?')
  ) {
    return { raw, readableText, kind: 'blocked' }
  }

  return { raw, readableText, kind: 'assistant' }
}
```

- [ ] **Step 5: Implement transcript reducer**

Create `src/components/WorkspaceView/claudeTranscript.ts`:

```ts
import { parseClaudeChunk } from './claudeOutputParser'

export type ClaudeTranscriptRowKind = 'user' | 'assistant' | 'status' | 'raw' | 'error' | 'blocked'

export interface ClaudeTranscriptRow {
  id: string
  kind: ClaudeTranscriptRowKind
  text: string
  createdAt: number
}

export interface ClaudeTranscriptState {
  rows: ClaudeTranscriptRow[]
  rawChunks: string[]
}

const createRow = (kind: ClaudeTranscriptRowKind, text: string): ClaudeTranscriptRow => ({
  id: crypto.randomUUID(),
  kind,
  text,
  createdAt: Date.now(),
})

export function createClaudeTranscript(): ClaudeTranscriptState {
  return { rows: [], rawChunks: [] }
}

export function appendClaudeUserPrompt(state: ClaudeTranscriptState, text: string): ClaudeTranscriptState {
  return { ...state, rows: [...state.rows, createRow('user', text)] }
}

export function appendClaudeOutput(state: ClaudeTranscriptState, raw: string): ClaudeTranscriptState {
  const parsed = parseClaudeChunk(raw)
  const rawChunks = [...state.rawChunks, raw]
  if (!parsed.readableText) {
    return { ...state, rawChunks }
  }
  return {
    rawChunks,
    rows: [...state.rows, createRow(parsed.kind, parsed.readableText)],
  }
}

export function appendClaudeError(state: ClaudeTranscriptState, text: string): ClaudeTranscriptState {
  return { ...state, rows: [...state.rows, createRow('error', text)] }
}

export function appendClaudeStatus(state: ClaudeTranscriptState, text: string): ClaudeTranscriptState {
  return { ...state, rows: [...state.rows, createRow('status', text)] }
}

export function appendClaudeExit(state: ClaudeTranscriptState, text: string): ClaudeTranscriptState {
  return appendClaudeStatus(state, text || 'Claude session exited')
}
```

- [ ] **Step 6: Run tests to verify GREEN**

Run:

```bash
npm test -- src/components/WorkspaceView/claudeOutputParser.test.ts src/components/WorkspaceView/claudeTranscript.test.ts
```

Expected: parser and transcript tests pass.

- [ ] **Step 7: Commit Task 1**

Run:

```bash
git add src/components/WorkspaceView/claudeOutputParser.ts src/components/WorkspaceView/claudeOutputParser.test.ts src/components/WorkspaceView/claudeTranscript.ts src/components/WorkspaceView/claudeTranscript.test.ts
git commit -m "feat(claude): add transcript parser"
```

## Task 2: Transcript And Raw Stream Renderers

**Files:**
- Create: `src/components/WorkspaceView/ClaudeTranscriptView.tsx`
- Create: `src/components/WorkspaceView/ClaudeRawStream.tsx`
- Modify: `src/components/WorkspaceView/ClaudePane.test.tsx`

- [ ] **Step 1: Add renderer expectations to component tests**

Modify `src/components/WorkspaceView/ClaudePane.test.tsx` by importing `listen` and capturing event handlers:

```ts
import { invoke, listen } from '../../utils/tauri'

const listeners = new Map<string, (event: { payload: string }) => void>()

vi.mock('../../utils/tauri', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn((eventName: string, handler: (event: { payload: string }) => void) => {
    listeners.set(eventName, handler)
    return Promise.resolve(() => listeners.delete(eventName))
  }),
}))
```

Replace the current output-related tests with:

```tsx
it('renders streamed output and keeps raw stream available', async () => {
  render(
    <ClaudePaneComponent
      tabId="tab-1"
      paneId="claude-1"
      isActive
      onFocus={() => {}}
      onClose={() => {}}
    />,
  )

  await waitFor(() => {
    expect(listen).toHaveBeenCalledWith('claude-output-claude-1', expect.any(Function))
  })

  listeners.get('claude-output-claude-1')?.({ payload: 'Hello from Claude\n' })

  expect(await screen.findByText('Hello from Claude')).toBeInTheDocument()

  fireEvent.click(screen.getByTitle('Show raw Claude stream'))

  expect(screen.getByText('Hello from Claude')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm test -- src/components/WorkspaceView/ClaudePane.test.tsx
```

Expected: fails because the raw stream toggle/renderer is not present.

- [ ] **Step 3: Implement `ClaudeTranscriptView`**

Create `src/components/WorkspaceView/ClaudeTranscriptView.tsx`:

```tsx
import type { CSSProperties } from 'react'
import { ClaudeTranscriptRow } from './claudeTranscript'

interface ClaudeTranscriptViewProps {
  rows: ClaudeTranscriptRow[]
}

const rowStyle = (kind: ClaudeTranscriptRow['kind']): CSSProperties => ({
  alignSelf: kind === 'user' ? 'flex-end' : 'stretch',
  maxWidth: kind === 'user' ? '78%' : '100%',
  border: kind === 'error'
    ? '1px solid rgba(248, 113, 113, 0.45)'
    : kind === 'blocked'
      ? '1px solid rgba(251, 191, 36, 0.45)'
      : '1px solid #2b333d',
  background: kind === 'user'
    ? '#152033'
    : kind === 'error'
      ? '#2a1115'
      : kind === 'blocked'
        ? '#2a2111'
        : kind === 'status'
          ? '#111827'
          : '#10151c',
  color: kind === 'error' ? '#fecaca' : kind === 'blocked' ? '#fde68a' : '#dfe7ef',
  borderRadius: 7,
  padding: '10px 12px',
  fontSize: 13,
  lineHeight: 1.55,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
})

export function ClaudeTranscriptView({ rows }: ClaudeTranscriptViewProps) {
  if (rows.length === 0) {
    return <div style={{ color: '#7f8894', fontSize: 13 }}>Claude Code is starting...</div>
  }

  return (
    <>
      {rows.map((row) => (
        <div key={row.id} data-kind={row.kind} style={rowStyle(row.kind)}>
          {row.text}
        </div>
      ))}
    </>
  )
}
```

- [ ] **Step 4: Implement `ClaudeRawStream`**

Create `src/components/WorkspaceView/ClaudeRawStream.tsx`:

```tsx
interface ClaudeRawStreamProps {
  chunks: string[]
}

export function ClaudeRawStream({ chunks }: ClaudeRawStreamProps) {
  return (
    <div
      style={{
        borderTop: '1px solid #222831',
        background: '#05070a',
        color: '#8fa3b8',
        fontFamily: 'var(--terminal-font-family)',
        fontSize: 11,
        lineHeight: 1.45,
        maxHeight: 180,
        overflow: 'auto',
        padding: 10,
        whiteSpace: 'pre-wrap',
      }}
    >
      {chunks.length === 0 ? 'No raw Claude stream yet.' : chunks.join('')}
    </div>
  )
}
```

- [ ] **Step 5: Wire renderers into `ClaudePane`**

In `src/components/WorkspaceView/ClaudePane.tsx`, replace local `ClaudeMessage` state with `ClaudeTranscriptState`, add `showRawStream`, render `ClaudeTranscript`, and add a toolbar button:

```tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Code2, FolderOpen, RotateCcw, Send, Sparkles, Square, X } from 'lucide-react'
import { ClaudeRawStream } from './ClaudeRawStream'
import { ClaudeTranscriptView } from './ClaudeTranscriptView'
import {
  appendClaudeError,
  appendClaudeExit,
  appendClaudeOutput,
  appendClaudeStatus,
  appendClaudeUserPrompt,
  createClaudeTranscript,
} from './claudeTranscript'
```

Use:

```tsx
const [transcript, setTranscript] = useState(createClaudeTranscript)
const [showRawStream, setShowRawStream] = useState(false)
```

Render the toggle near the cwd/restart/stop buttons:

```tsx
<button
  title={showRawStream ? 'Hide raw Claude stream' : 'Show raw Claude stream'}
  onClick={() => setShowRawStream((visible) => !visible)}
  style={{
    ...iconButtonStyle,
    background: showRawStream ? 'rgba(148, 163, 184, 0.14)' : 'transparent',
    color: showRawStream ? '#cbd5e1' : '#96a0ad',
  }}
>
  <Code2 size={14} />
</button>
```

Render the timeline and raw stream:

```tsx
<div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
  <ClaudeTranscriptView rows={transcript.rows} />
</div>
{showRawStream && <ClaudeRawStream chunks={transcript.rawChunks} />}
```

- [ ] **Step 6: Run test to verify GREEN**

Run:

```bash
npm test -- src/components/WorkspaceView/ClaudePane.test.tsx
```

Expected: component tests pass.

- [ ] **Step 7: Commit Task 2**

Run:

```bash
git add src/components/WorkspaceView/ClaudeTranscriptView.tsx src/components/WorkspaceView/ClaudeRawStream.tsx src/components/WorkspaceView/ClaudePane.tsx src/components/WorkspaceView/ClaudePane.test.tsx docs/superpowers/plans/2026-06-30-claude-code-pane-v2.md
git commit -m "feat(claude): render stream timeline"
```

## Task 3: Interactive Pane Lifecycle

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/components/WorkspaceView/ClaudePane.tsx`
- Modify: `src/components/WorkspaceView/ClaudePane.test.tsx`

- [ ] **Step 1: Update tests for interactive spawn/write**

In `src/components/WorkspaceView/ClaudePane.test.tsx`, replace the old test named `does not start Claude before the user sends a prompt` with:

```tsx
it('starts an interactive Claude session after listeners attach', async () => {
  render(
    <ClaudePaneComponent
      tabId="tab-1"
      paneId="claude-1"
      isActive
      onFocus={() => {}}
      onClose={() => {}}
    />,
  )

  await waitFor(() => {
    expect(listen).toHaveBeenCalledWith('claude-output-claude-1', expect.any(Function))
    expect(invoke).toHaveBeenCalledWith('spawn_claude_session', {
      sessionId: 'claude-1',
      cwd: '/tmp',
    })
  })
})
```

Replace the send test with:

```tsx
it('writes prompt to the live Claude session on Enter', async () => {
  render(
    <ClaudePaneComponent
      tabId="tab-1"
      paneId="claude-1"
      isActive
      onFocus={() => {}}
      onClose={() => {}}
    />,
  )

  const input = screen.getByPlaceholderText('Ask Claude to edit...')
  fireEvent.change(input, { target: { value: 'hello' } })
  fireEvent.keyDown(input, { key: 'Enter' })

  await waitFor(() => {
    expect(invoke).toHaveBeenCalledWith('write_claude_session', {
      sessionId: 'claude-1',
      data: 'hello\n',
    })
  })
  expect(invoke).not.toHaveBeenCalledWith('run_claude_prompt', expect.anything())
  expect(input).toHaveValue('')
})
```

Add lifecycle tests:

```tsx
it('marks exit events as exited and keeps transcript visible', async () => {
  render(
    <ClaudePaneComponent
      tabId="tab-1"
      paneId="claude-1"
      isActive
      onFocus={() => {}}
      onClose={() => {}}
    />,
  )

  await waitFor(() => {
    expect(listeners.has('claude-exit-claude-1')).toBe(true)
  })

  listeners.get('claude-exit-claude-1')?.({ payload: 'Claude session exited' })

  expect(await screen.findByText('Claude session exited')).toBeInTheDocument()
  expect(screen.getByText('exited')).toBeInTheDocument()
})

it('restarts by closing and spawning the same session id', async () => {
  render(
    <ClaudePaneComponent
      tabId="tab-1"
      paneId="claude-1"
      isActive
      onFocus={() => {}}
      onClose={() => {}}
    />,
  )

  fireEvent.click(screen.getByTitle('Restart Claude'))

  await waitFor(() => {
    expect(invoke).toHaveBeenCalledWith('close_claude_session', { sessionId: 'claude-1' })
    expect(invoke).toHaveBeenCalledWith('spawn_claude_session', {
      sessionId: 'claude-1',
      cwd: '/tmp',
    })
  })
})
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm test -- src/components/WorkspaceView/ClaudePane.test.tsx
```

Expected: fails because `ClaudePane` still calls `run_claude_prompt` and does not spawn on mount.

- [ ] **Step 3: Add `blocked` pane status**

Modify `src/types/index.ts`:

```ts
export type ClaudePaneStatus = 'starting' | 'ready' | 'running' | 'blocked' | 'error' | 'exited'
```

- [ ] **Step 4: Implement lifecycle in `ClaudePane`**

In `src/components/WorkspaceView/ClaudePane.tsx`, add a reusable `startSession` callback:

```tsx
const startSession = useCallback(async () => {
  updateClaudePane(tabId, paneId, { status: 'starting', error: null })
  setTranscript((prev) => appendClaudeStatus(prev, 'Starting Claude session...'))
  try {
    await invoke('spawn_claude_session', { sessionId: paneId, cwd: pane?.cwd || '' })
    updateClaudePane(tabId, paneId, { status: 'ready', error: null })
    setTranscript((prev) => appendClaudeStatus(prev, 'Claude session started'))
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    updateClaudePane(tabId, paneId, { status: 'error', error })
    setTranscript((prev) => appendClaudeError(prev, error))
  }
}, [pane?.cwd, paneId, tabId, updateClaudePane])
```

After listener attachment succeeds, call `startSession()` once for the current pane:

```tsx
if (!disposed) {
  await startSession()
}
```

Change output handling:

```tsx
setTranscript((prev) => {
  const next = appendClaudeOutput(prev, text)
  const last = next.rows[next.rows.length - 1]
  if (last?.kind === 'blocked') {
    updateClaudePane(tabId, paneId, { status: 'blocked', error: null })
  } else if (last?.kind === 'error') {
    updateClaudePane(tabId, paneId, { status: 'error', error: last.text })
  } else if (last?.kind === 'assistant') {
    updateClaudePane(tabId, paneId, { status: 'running', error: null })
  }
  return next
})
```

Change sending:

```tsx
const sendPrompt = async () => {
  const text = draft.trimEnd()
  if (!text || isSending) return
  setIsSending(true)
  setTranscript((prev) => appendClaudeUserPrompt(prev, text))
  setDraft('')
  updateClaudePane(tabId, paneId, { status: 'running', error: null })
  try {
    await invoke('write_claude_session', { sessionId: paneId, data: `${text}\n` })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    setDraft(text)
    setTranscript((prev) => appendClaudeError(prev, error))
    updateClaudePane(tabId, paneId, { status: 'error', error })
  } finally {
    setIsSending(false)
  }
}
```

Change restart:

```tsx
const restart = async () => {
  setTranscript(createClaudeTranscript())
  setDraft('')
  setIsSending(false)
  await invoke('close_claude_session', { sessionId: paneId }).catch(() => {})
  await startSession()
}
```

Change exit handling:

```tsx
setTranscript((prev) => appendClaudeExit(prev, text || 'Claude session exited'))
setIsSending(false)
updateClaudePane(tabId, paneId, { status: 'exited', error: null })
```

- [ ] **Step 5: Run test to verify GREEN**

Run:

```bash
npm test -- src/components/WorkspaceView/ClaudePane.test.tsx
```

Expected: component tests pass and no expectation references `run_claude_prompt`.

- [ ] **Step 6: Commit Task 3**

Run:

```bash
git add src/types/index.ts src/components/WorkspaceView/ClaudePane.tsx src/components/WorkspaceView/ClaudePane.test.tsx
git commit -m "feat(claude): use interactive sessions"
```

## Task 4: Backend Session Lifecycle Hardening

**Files:**
- Modify: `src-tauri/src/claude_session_manager.rs`

- [ ] **Step 1: Add backend lifecycle tests**

In `src-tauri/src/claude_session_manager.rs`, extend the existing test module imports:

```rust
use super::{claude_print_args, resolve_claude_binary_from, resolved_working_directory};
use std::path::PathBuf;
```

Add tests:

```rust
#[test]
fn falls_back_to_home_when_cwd_is_empty() {
    let home = PathBuf::from("/tmp/termspace-home");

    assert_eq!(
        resolved_working_directory("", Some(&home)),
        home
    );
}

#[test]
fn falls_back_to_home_when_cwd_does_not_exist() {
    let home = PathBuf::from("/tmp/termspace-home");

    assert_eq!(
        resolved_working_directory("/definitely/not/a/real/termspace/path", Some(&home)),
        home
    );
}

#[test]
fn keeps_existing_cwd_when_it_exists() {
    let cwd = std::env::temp_dir();

    assert_eq!(
        resolved_working_directory(cwd.to_string_lossy().as_ref(), None),
        cwd
    );
}

#[test]
fn close_is_harmless_when_session_is_not_running() {
    let manager = super::ClaudeSessionManager::new();

    assert!(manager.close("missing").is_ok());
}
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
cargo test claude_session_manager --manifest-path src-tauri/Cargo.toml
```

Expected: fails because `resolved_working_directory` does not exist.

- [ ] **Step 3: Implement cwd fallback helper**

In `src-tauri/src/claude_session_manager.rs`, add:

```rust
fn resolved_working_directory(cwd: &str, home: Option<&Path>) -> PathBuf {
    if !cwd.is_empty() {
        let requested = PathBuf::from(cwd);
        if requested.is_dir() {
            return requested;
        }
    }

    home.map(PathBuf::from)
        .or_else(|| std::env::var("HOME").ok().map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("/"))
}
```

Replace both existing `resolved_cwd` string blocks in `spawn` and `run_prompt`:

```rust
let home = std::env::var("HOME").ok().map(PathBuf::from);
let resolved_cwd = resolved_working_directory(cwd, home.as_deref());
```

Use `cmd.cwd(&resolved_cwd);` and `.current_dir(resolved_cwd)`.

- [ ] **Step 4: Clean up handles on reader exit**

Change `ClaudeSessionManager` so `handles` is stored in an `Arc<Mutex<HashMap<...>>>` and the reader thread can remove the exited session:

```rust
pub struct ClaudeSessionManager {
    handles: Arc<Mutex<HashMap<String, ClaudeSessionHandle>>>,
    prompt_children: Arc<Mutex<HashMap<String, Arc<Mutex<Child>>>>>,
}
```

In `new()`:

```rust
handles: Arc::new(Mutex::new(HashMap::new())),
```

Before spawning the reader thread:

```rust
let handles = Arc::clone(&self.handles);
```

At the end of the reader thread, before emitting exit or immediately after:

```rust
handles.lock().remove(&session_id);
let _ = app.emit(&format!("claude-exit-{session_id}"), "Claude session exited");
```

- [ ] **Step 5: Emit explicit spawn-ready event**

After inserting the handle in `spawn`, emit:

```rust
let _ = app.emit(&format!("claude-ready-{session_id}"), "Claude session started");
```

Frontend listens to this event in Task 5. The existing `spawn_claude_session` command still returns `Ok(())` after the process is spawned.

- [ ] **Step 6: Run Rust tests to verify GREEN**

Run:

```bash
cargo test claude_session_manager --manifest-path src-tauri/Cargo.toml
```

Expected: Claude session manager tests pass.

- [ ] **Step 7: Commit Task 4**

Run:

```bash
git add src-tauri/src/claude_session_manager.rs
git commit -m "fix(claude): harden session lifecycle"
```

## Task 5: Ready Event, Retry UI, And Error Recovery

**Files:**
- Modify: `src/components/WorkspaceView/ClaudePane.tsx`
- Modify: `src/components/WorkspaceView/ClaudePane.test.tsx`

- [ ] **Step 1: Add tests for ready and retry**

In `src/components/WorkspaceView/ClaudePane.test.tsx`, add:

```tsx
it('marks the pane ready when the backend emits ready', async () => {
  render(
    <ClaudePaneComponent
      tabId="tab-1"
      paneId="claude-1"
      isActive
      onFocus={() => {}}
      onClose={() => {}}
    />,
  )

  await waitFor(() => {
    expect(listeners.has('claude-ready-claude-1')).toBe(true)
  })

  listeners.get('claude-ready-claude-1')?.({ payload: 'Claude session started' })

  expect(await screen.findByText('Claude session started')).toBeInTheDocument()
  expect(screen.getByText('ready')).toBeInTheDocument()
})

it('shows retry after spawn failure and retries the same session', async () => {
  vi.mocked(invoke).mockImplementation((command) => {
    if (command === 'spawn_claude_session') {
      return Promise.reject('Claude CLI not found')
    }
    return Promise.resolve(undefined)
  })

  render(
    <ClaudePaneComponent
      tabId="tab-1"
      paneId="claude-1"
      isActive
      onFocus={() => {}}
      onClose={() => {}}
    />,
  )

  expect(await screen.findByText('Claude CLI not found')).toBeInTheDocument()

  vi.mocked(invoke).mockResolvedValue(undefined)
  fireEvent.click(screen.getByRole('button', { name: 'Retry Claude session' }))

  await waitFor(() => {
    expect(invoke).toHaveBeenCalledWith('spawn_claude_session', {
      sessionId: 'claude-1',
      cwd: '/tmp',
    })
  })
})
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npm test -- src/components/WorkspaceView/ClaudePane.test.tsx
```

Expected: fails because `claude-ready` and Retry UI are not wired.

- [ ] **Step 3: Listen for ready events**

In `ClaudePane.tsx`, attach `claude-ready-${paneId}` beside output/error/exit:

```tsx
let unlistenReady: (() => void) | null = null

unlistenReady = await listen<string>(`claude-ready-${paneId}`, (event) => {
  if (disposed) return
  const text = String(event.payload ?? 'Claude session started')
  setTranscript((prev) => appendClaudeStatus(prev, text))
  updateClaudePane(tabId, paneId, { status: 'ready', error: null })
})
```

Cleanup:

```tsx
unlistenReady?.()
```

- [ ] **Step 4: Add Retry UI**

When `status === 'error' || status === 'exited'`, render a small retry button above the composer:

```tsx
{(status === 'error' || status === 'exited') && (
  <div style={{ padding: '8px 10px', borderTop: '1px solid #222831', background: '#0b0f14' }}>
    <button
      type="button"
      aria-label="Retry Claude session"
      onClick={startSession}
      style={{
        border: '1px solid #3a4654',
        borderRadius: 6,
        background: '#151b24',
        color: '#e8edf3',
        cursor: 'pointer',
        fontSize: 12,
        padding: '6px 10px',
      }}
    >
      Retry
    </button>
  </div>
)}
```

- [ ] **Step 5: Run tests to verify GREEN**

Run:

```bash
npm test -- src/components/WorkspaceView/ClaudePane.test.tsx
```

Expected: component tests pass.

- [ ] **Step 6: Commit Task 5**

Run:

```bash
git add src/components/WorkspaceView/ClaudePane.tsx src/components/WorkspaceView/ClaudePane.test.tsx
git commit -m "feat(claude): add ready and retry states"
```

## Task 6: Dependency Map And Full Verification

**Files:**
- Modify: `docs/dependency-map.md`

- [ ] **Step 1: Regenerate dependency map**

Run:

```bash
node scripts/gen-dep-map.js
```

Expected: `docs/dependency-map.md` includes the new Claude parser/transcript modules.

- [ ] **Step 2: Run focused frontend tests**

Run:

```bash
npm test -- src/components/WorkspaceView/claudeOutputParser.test.ts src/components/WorkspaceView/claudeTranscript.test.ts src/components/WorkspaceView/ClaudePane.test.tsx src/components/WorkspaceView/TerminalGrid.test.tsx src/store/useAppStore.test.ts src/utils/layout.test.ts
```

Expected: all listed frontend tests pass.

- [ ] **Step 3: Run Rust Claude tests**

Run:

```bash
cargo test claude --manifest-path src-tauri/Cargo.toml
```

Expected: all Claude-related Rust tests pass.

- [ ] **Step 4: Run full frontend build**

Run:

```bash
npm run build
```

Expected: TypeScript and Vite build pass. Existing large chunk warnings can remain if no new warning is introduced by this work.

- [ ] **Step 5: Manual app validation**

Run:

```bash
npm run tauri dev
```

Manual checks:

- Open one Claude pane and confirm `spawn_claude_session` starts the session.
- Send `hello` and confirm the pane writes through `write_claude_session`.
- Confirm output streams into the transcript and raw drawer.
- Open a second Claude pane and confirm output does not cross streams.
- Click Stop during output and confirm the pane remains usable.
- Click Restart and confirm a new session starts in the same cwd.
- Temporarily move `claude` out of PATH or run with a PATH that excludes it, then confirm the missing CLI error and Retry UI.

- [ ] **Step 6: Commit Task 6**

Run:

```bash
git add docs/dependency-map.md
git commit -m "docs: refresh dependency map"
```

## Final Review Checklist

- [ ] `ClaudePane.tsx` does not call `run_claude_prompt` for normal sends.
- [ ] `write_claude_session` receives composer text with a trailing newline.
- [ ] Listener setup happens before `spawn_claude_session`.
- [ ] Raw chunks are preserved even when they do not produce visible transcript rows.
- [ ] `blocked`, `error`, and `exited` statuses are visible in the pane.
- [ ] Restart closes the old session before spawning again.
- [ ] Backend reader exit removes the session handle.
- [ ] Missing CLI errors include candidate paths from the resolver.
- [ ] Added `src/` files are reflected in `docs/dependency-map.md`.
- [ ] Only files touched by this plan are staged and committed.
