# Agent Studio Design

**Date:** 2026-07-12  
**Status:** Approved design; implementation plan pending written-spec review

## Goal

Add Agent Studio: a polished, local-first, composable workspace pane where a developer can hold durable AI conversations, select a local coding runtime, choose a structured workflow, and evolve conversation output into durable planning artifacts.

The first release supports Chat, Plan, Epic, and Review workflows with Claude Code and Codex CLI. It deliberately excludes direct ticket execution and user-authored workflows until the core conversation, artifact, and review loop is stable.

## Product Principles

- **Local-first:** Termspace stores chats, artifacts, tickets, and workflow state in its existing SQLite database. Provider authentication remains owned by the installed local CLI.
- **Composable, not modal:** Agent Studio is a pane in the normal Termspace layout. It can appear beside a terminal, editor, or browser in a split, tab, or workspace according to the existing pane behavior setting.
- **Artifact-first continuity:** Plans, specs, tickets, and reviews must outlive an individual model session and be linkable from conversations.
- **Provider neutrality:** Claude Code and Codex CLI are first-class choices through one runtime contract. UI components do not branch on provider-specific process details.
- **Human control:** The UI clearly states the workflow, provider, access level, active status, and error state. The initial slice does not grant silent external execution.

## Non-goals

- Reproduce Traycer’s visual branding, proprietary workflows, or implementation.
- Replace normal terminals or the existing dedicated Claude pane.
- Host or synchronize data remotely.
- Support agent-to-agent execution, direct ticket execution, custom workflow authoring, worktree provisioning, or third-party A2A endpoints in the first release.
- Fully parse every provider terminal control sequence or tool event.

## Entry Points and Layout

Add `AgentStudioPane` as a new layout leaf alongside the existing terminal, browser, editor, Kubernetes, Docker, and Claude leaves. It must use the same existing behaviors for opening as a split, a tab, or a dedicated workspace.

The pane uses the approved **Focus Rail** composition:

```
┌─────────────────────────────────────────────────────────────┐
│ Agent Studio title · runtime status · pane actions            │
├───────────────┬───────────────────────────────────────────────┤
│ Chats         │                                               │
│ + New chat    │          focused empty state or transcript    │
│ Active chats  │                                               │
│               │          inline activity / questions / errors │
├───────────────┤                                               │
│ Artifacts     │                                               │
│ Epic brief    ├───────────────────────────────────────────────┤
│ Core flows    │ [context] [access] [mode] [model] [send]      │
│ Tech plan     │ workspace path · context availability          │
└───────────────┴───────────────────────────────────────────────┘
```

The rail shows chats first and artifacts second. On narrow panes it collapses to an icon strip and opens selected lists/details as an overlay; the center conversation must never become an unusably narrow third column.

## Visual System

Agent Studio extends, rather than replaces, Termspace’s theme system. It must use semantic CSS variables so all six existing themes continue to work. Add variables for:

- elevated agent surface and composer surface;
- selected rail row and hover row;
- provider/activity badge foreground/background;
- artifact and ticket state colors;
- attention, blocked, error, and success states.

The default warm-dark treatment is a quiet charcoal command center: precise one-pixel borders, restrained cyan accent, compact monospace metadata, and generous central whitespace. Use the existing UI font preference; do not introduce a mandatory remote font. Motion is limited to streamed-row entrance, state changes, and hover/focus feedback, respecting `prefers-reduced-motion`.

## Core Interfaces

### Pane and conversation types

Introduce provider-neutral types in `src/types/index.ts`:

```ts
type AgentProviderId = 'claude-code' | 'codex'
type AgentWorkflowMode = 'chat' | 'plan' | 'epic' | 'review'
type AgentSessionStatus = 'starting' | 'ready' | 'running' | 'blocked' | 'error' | 'exited'

interface AgentStudioPane {
  id: string
  tabId: string
  title: string
  cwd: string
  conversationId: string | null
  position: number
  createdAt: number
}

interface AgentConversation {
  id: string
  workspaceId: string
  tabId: string
  title: string
  provider: AgentProviderId
  workflow: AgentWorkflowMode
  cwd: string
  status: AgentSessionStatus
  createdAt: number
  updatedAt: number
}
```

Messages are immutable ordered records. Runtime-only chunks are reduced into transcript rows in the frontend, while durable user and assistant messages are persisted after a complete turn or explicit stop. This avoids database writes for every terminal byte.

### Runtime abstraction

The Rust backend exposes one `AgentRuntimeManager` that owns provider adapters. Each adapter resolves a local binary, launches it in a PTY, writes input, interrupts it, closes it, and emits normalized events.

```ts
type AgentRuntimeEvent =
  | { kind: 'ready' }
  | { kind: 'text'; text: string }
  | { kind: 'activity'; label: string; detail?: string }
  | { kind: 'question'; prompt: string; choices?: string[] }
  | { kind: 'error'; message: string; retryable: boolean }
  | { kind: 'exit'; detail?: string }
```

Tauri command names are provider-neutral: `start_agent_session`, `write_agent_session`, `interrupt_agent_session`, and `close_agent_session`. Events use a session-specific `agent-event-{sessionId}` channel. The existing Claude session manager remains intact during this slice; its process conventions are used to build the new abstraction instead of creating regressions in the current Claude pane.

## Workflow Model

### Chat

Open-ended local conversation. The user can attach workspace files/folders, choose a provider, and receive streamed output. Chat does not generate planning artifacts unless the user explicitly asks to promote content.

### Plan

The assistant asks one focused question at a time when requirements are incomplete. On approval, it creates one `plan` artifact with scope, assumptions, affected areas, implementation steps, and acceptance criteria. It must label inferred requirements as assumptions.

### Epic

Epic is a guided artifact ladder, not an unstructured giant prompt:

```
Epic brief → Core flows → Technical plan → Tickets → Mini-tickets
```

- **Epic brief:** problem, users, desired outcome, constraints, success measures.
- **Core flows:** primary and alternate user journeys, states, edge cases, and diagrams when useful.
- **Technical plan:** components, contracts, data changes, risks, migration/rollback behavior, and test strategy.
- **Tickets:** independently reviewable work items with dependencies and acceptance checklist.
- **Mini-tickets:** atomic testable actions within a ticket; they are not separately executable in this release.

The assistant presents a suggested next command rather than silently creating the next artifact. At each artifact stage it supplies contextual prompt suggestions, for example missing success criteria, unknown failure behavior, affected shared types, or an oversized ticket.

### Review

The user selects one or more artifacts and optionally the current workspace changes. The assistant produces a durable `review` artifact containing findings with severity, evidence, affected ticket/checklist item, and a concrete recommendation. The workflow does not claim code is verified if it could not access the necessary files or command output.

## Artifact and Ticket Data

SQLite is the source of truth. Add tables with UUID text keys and `created_at`/`updated_at` millisecond timestamps:

- `agent_conversations`: provider, workflow, title, workspace/tab references, cwd, status.
- `agent_messages`: ordered durable conversation messages; source, role, body, and metadata JSON.
- `agent_artifacts`: conversation/epic links, kind, title, Markdown content, lifecycle status, version.
- `agent_tickets`: epic/artifact parent, optional parent ticket for mini-tickets, title, description, status, position, dependencies JSON, acceptance checklist JSON.
- `agent_artifact_links`: many-to-many relationships among messages, artifacts, tickets, and filesystem references.

Initial ticket states are `draft`, `ready`, `in_review`, `done`, and `blocked`. A parent ticket cannot be marked `done` while a non-done mini-ticket exists. Tickets are not assigned to an agent or executed in this slice.

## Composer and Context

The anchored composer includes, in order: context attachment, access badge, workflow selector, provider/model selector, reasoning-effort selector where a provider supports it, dictation action, and send/stop control. The footer shows active workspace path and context availability.

File/folder attachment captures a reference, not an uncontrolled full-repository dump. Before sending, the user sees the selected references. The initial access presets are `read-only` and `workspace`; unavailable capabilities are disabled rather than implied.

## State, Errors, and Recovery

- Starting a pane with no conversation displays the intentional Focus Rail empty state and creates a conversation only on the first submitted message.
- Switching provider starts a new session for the same conversation only after the current provider is idle; runtime transcripts stay attributed to their provider.
- A missing binary, authentication error, invalid cwd, write failure, or abnormal exit becomes an inline event with Retry. Draft text remains intact after failed sends.
- Raw provider output stays available in an expandable diagnostic section when normalization cannot represent it safely.
- Closing a pane closes only its live runtime session. The durable conversation and artifacts remain available when a pane is reopened.
- App restart restores panes and their selected conversation IDs; it never assumes a previous CLI process remains alive.

## Accessibility and Keyboard Behavior

- All controls have labels, visible focus rings, and keyboard access.
- `CmdOrCtrl+Enter` submits; `Shift+Enter` inserts a newline.
- Escape closes transient selectors before it affects the pane.
- Rail selection uses predictable arrow-key navigation.
- Streaming status is announced through a restrained live region without re-announcing every chunk.

## Testing and Acceptance Criteria

Frontend unit tests cover transcript reducers, composer keyboard behavior, workflow state transitions, rail navigation, narrow-pane collapse, provider labels, error/retry states, and all theme token use. Rust tests cover provider resolution, normalized event mapping, unknown-session interruption/close, and database CRUD/invariants. Integration tests verify pane/layout persistence and restored selected conversations.

Manual QA verifies:

1. Open Agent Studio as split, tab, and workspace.
2. Start a Chat with Claude Code and Codex; confirm independently attributed streamed text and recoverable errors.
3. Create a Plan artifact and reopen it after app restart.
4. Create an Epic through its artifact ladder, add tickets and mini-tickets, and verify the parent-completion invariant.
5. Create a Review artifact from selected planning artifacts and workspace references.
6. Verify compact rail behavior at narrow pane widths and visual consistency across every existing theme.

The release succeeds when a user can run a local Claude Code or Codex conversation in a composable, polished pane; persist and revisit its planning artifacts; progress through the guided Epic ladder; and produce an evidence-bound Review without losing work when the app or pane closes.
