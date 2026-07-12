# Agent Studio Design

**Date:** 2026-07-12  
**Status:** Approved design; implementation plan pending written-spec review

## Goal

Add Agent Studio: a polished, local-first, composable workspace pane and orchestration foundation where a developer can hold durable AI conversations, select a local coding runtime, choose a structured workflow, and evolve requirements into revisioned artifacts, traceable tickets, and evidence-bound reviews.

The first release supports Chat, Plan, Epic, and Review workflows with Claude Code and Codex CLI. It deliberately excludes direct ticket execution and user-authored workflow authoring until the core conversation, artifact, context, and review loop is stable. The persisted domain still reserves execution records so later handoffs do not require a destructive database redesign.

## Product Principles

- **Local-first:** Termspace stores chats, artifacts, tickets, and workflow state in its existing SQLite database. Provider authentication remains owned by the installed local CLI.
- **Composable, not modal:** Agent Studio is a pane in the normal Termspace layout. It can appear beside a terminal, editor, or browser in a split, tab, or workspace according to the existing pane behavior setting.
- **Artifact-first continuity:** Plans, specs, tickets, reviews, requirements, decisions, evidence, and their exact revisions must outlive an individual model session and remain linkable.
- **Transparent context:** Every runtime turn has an inspectable immutable context snapshot, including its applied workspace instructions and exclusions.
- **Provider neutrality:** Claude Code and Codex CLI are first-class choices through one runtime contract. UI components do not branch on provider-specific process details.
- **Human control:** The UI clearly states the workflow, provider, access level, active status, and error state. The initial slice does not grant silent external execution.

## Non-goals

- Reproduce Traycer’s visual branding, proprietary workflows, or implementation.
- Replace normal terminals or the existing dedicated Claude pane.
- Host or synchronize data remotely.
- Do not activate agent-to-agent execution, direct ticket execution, custom workflow authoring, worktree provisioning, or third-party A2A endpoints in the first release; their domain concepts may be reserved but their controls remain unavailable.
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
  title: string
  defaultCwd: string
  createdAt: number
  updatedAt: number
  archivedAt: number | null
}
```

`tabId`, selected conversation, and pane geometry belong to `AgentStudioPane`; provider identity and live status belong to a runtime session, not a durable conversation.

```ts
interface AgentRuntimeSession {
  id: string
  conversationId: string
  provider: AgentProviderId
  providerSessionId: string | null
  providerVersion: string | null
  contextSnapshotId: string
  status: AgentSessionStatus
  parentSessionId: string | null
  createdAt: number
  endedAt: number | null
}

type AgentMessagePart =
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
```

Messages are immutable ordered records with a versioned JSON array of typed `AgentMessagePart` values, never an undefined metadata blob. Runtime-only chunks are coalesced into transcript rows and durable parts; full raw diagnostic bytes are persisted by reference, not copied into every row. The backend assigns monotonic sequence numbers and the reducer rejects duplicates and reports sequence gaps.

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

```ts
interface AgentRuntimeEnvelope {
  sessionId: string
  sequence: number
  timestamp: number
  event: AgentRuntimeEvent
}

interface AgentProviderCapabilities {
  structuredOutput: boolean
  sessionResume: boolean
  modelSelection: boolean
  reasoningEffort: boolean
  permissionRequests: boolean
  fileChangeEvents: boolean
  toolEvents: boolean
  contextContinuation: boolean
}
```

Tauri command names are provider-neutral: `start_agent_session`, `write_agent_session`, `interrupt_agent_session`, and `close_agent_session`. Events use a session-specific `agent-event-{sessionId}` channel and carry `AgentRuntimeEnvelope` data. Adapters prefer documented structured SDK/RPC/JSONL output, then a documented machine-readable CLI mode, then a semantic PTY parser, with raw-terminal compatibility as the final fallback. The UI derives controls from declared provider capabilities rather than provider-name checks. The existing Claude session manager remains intact during this slice; its process conventions are used to build the new abstraction instead of creating regressions in the current Claude pane.

One runtime session permits one active generation. Submitting while it runs is explicitly rejected in release one rather than silently queued. Stop-turn interrupts a provider turn while preserving its session; terminate-session gracefully ends the CLI; force-kill ends the process tree after a timeout; close-pane detaches UI then terminates its exclusively-owned session. Writes are persisted before provider dispatch, process control is idempotent, and backend UI updates flush coalesced chunks every 16–50 ms with bounded buffers and disk-spooled oversized diagnostics.

## Context, Instructions, and Access

Every provider dispatch is built by a deterministic `ContextAssembler`. It persists a `ContextBundle` before launch so a later provider, review, or execution can use the same normalized snapshot.

```ts
interface ContextBundle {
  id: string
  conversationId: string
  provider: AgentProviderId
  items: ContextItem[]
  estimatedTokens: number
  truncated: boolean
  createdAt: number
}

interface ContextItem {
  id: string
  kind: 'user_attachment' | 'active_file' | 'artifact' | 'ticket' | 'conversation_summary' | 'workspace_instruction' | 'git_diff' | 'diagnostic'
  source: string
  contentHash: string
  includedRange?: { startLine: number; endLine: number }
  estimatedTokens: number
  priority: number
  inclusionReason: string
  trust: 'user_instruction' | 'project_instruction' | 'untrusted_content' | 'generated_content' | 'tool_output'
}
```

The bundle always includes the active workflow constraints, explicitly selected artifacts/tickets, user attachments, and applicable resolved workspace instructions. It includes an active file, git diff, and conversation summary only when selected or required by the structured workflow. When a provider limit is exceeded, lower-priority items are omitted first; older conversation context is summarized into a new provenance-bearing item; the user sees omitted items and the reason. File content is captured at send time, content-hashed, and unavailable/deleted/moved paths are recorded as unavailable rather than silently substituted. The Context Inspector displays included items, estimated size, exclusions, trust labels, and the exact snapshot that a provider receives.

`InstructionResolver` walks from every selected path toward the workspace root and resolves supported `AGENTS.md`, `CLAUDE.md`, and configured custom instruction filenames. Its precedence is: explicit session instructions; selected artifact constraints; closest nested `AGENTS.md`; root `AGENTS.md`; provider-specific instruction files; application defaults. It persists file paths, scope roots, hashes, resolution path, and detected conflicts, and displays the applied instructions to the user.

Access profiles are explicit capability policies, not decorative labels:

```ts
interface AgentAccessProfile {
  id: string
  filesystem: 'none' | 'read-workspace' | 'write-workspace'
  shell: 'none' | 'confirm' | 'allowed'
  network: 'none' | 'confirm' | 'allowed'
  git: 'read' | 'write' | 'commit'
  enforcement: 'advisory' | 'provider' | 'sandbox'
}
```

Release one offers only the enforcement level that its provider adapter can actually guarantee and labels advisory controls as advisory. Rust canonicalizes all paths before applying policy. Default context exclusions include `.env*`, private keys, credential stores, `.git`, cloud credentials, SSH configuration, OS keychain paths, large binaries, and paths outside the workspace. Symlinks escaping the workspace, traversal, nested repositories, submodules, case-insensitive collisions, and deleted paths are surfaced explicitly. The user may override an exclusion only through a confirmation that identifies the sensitive source.

Repository files, terminal output, web content, issue text, and generated artifacts are untrusted content: they may inform a task but never change system policy, instruction precedence, or access privileges. Project instructions are visibly distinguished from user instructions; generated content cannot silently request a higher access profile; and sensitive capabilities require confirmation according to the active policy.

## Workflow Model

### Chat

Open-ended local conversation. The user can attach workspace files/folders, choose a provider, and receive streamed output. Chat does not generate planning artifacts unless the user explicitly asks to promote content.

### Plan

The assistant asks one focused question at a time when requirements are incomplete. On approval, it creates one `plan` artifact with scope, assumptions, affected areas, implementation steps, and acceptance criteria. It must label inferred requirements as assumptions.

### Epic

Epic is an explicit durable entity, not a conversation mode. It owns multiple conversations, runtime sessions, artifacts, tickets, review records, and future executions. Release one ships one non-editable built-in workflow definition; the engine is graph-based so a backend-only feature can skip Core Flows, an API specification can be inserted, and a user can return to an earlier stage without a future migration.

```ts
interface AgentEpic {
  id: string
  workspaceId: string
  title: string
  description: string
  status: 'draft' | 'active' | 'completed' | 'archived'
  workflowDefinitionId: string
  workflowVersion: number
  createdAt: number
  updatedAt: number
}

interface WorkflowDefinition {
  id: string
  version: number
  entryStepId: string
  steps: WorkflowStep[]
  transitions: WorkflowTransition[]
}
```

The default path is a guided artifact ladder, not an unstructured giant prompt:

```
Epic brief → Core flows → Technical plan → Tickets → Mini-tickets
```

- **Epic brief:** problem, users, desired outcome, constraints, success measures.
- **Core flows:** primary and alternate user journeys, states, edge cases, and diagrams when useful.
- **Technical plan:** components, contracts, data changes, risks, migration/rollback behavior, and test strategy.
- **Tickets:** independently reviewable work items with dependencies and acceptance checklist.
- **Mini-tickets:** atomic testable actions within a ticket; they are not separately executable in this release.

The assistant presents a suggested next command rather than silently creating the next artifact. At each artifact stage it supplies contextual prompt suggestions, for example missing success criteria, unknown failure behavior, affected shared types, or an oversized ticket. Commands such as `/new-plan`, `/create-epic`, `/create-core-flows`, `/create-tech-plan`, `/generate-tickets`, `/review`, and `/reconcile` dispatch structured UI actions rather than raw prompt text.

Each clarification is a durable question with a rationale, priority, affected fields, and resolution state. Required questions must be answered, explicitly assumed, or deliberately dismissed before a dependent artifact can be approved; recommended and optional questions never trap the user in an endless loop.

### Review

The user selects one or more artifacts and a precise workspace baseline: working tree against HEAD, staged changes, selected files, a commit, a commit range, or branch against base. The assistant produces a durable `review` artifact containing findings with severity, evidence, affected requirement/ticket/checklist item, and a concrete recommendation. Reviews use a selected profile—requirement coverage, implementation correctness, regression risk, architecture consistency, security, test adequacy, accessibility, performance, or migration safety—and do not claim code is verified if required inputs are unavailable.

## Artifact and Ticket Data

SQLite is the source of truth. Continue the existing WAL and foreign-key setup; add schema-version migrations, startup integrity checking, export/backup, bounded raw-log retention, and recovery messaging for interrupted writes. All primary keys are UUID text values and timestamps are milliseconds.

- `agent_conversations`, `agent_runtime_sessions`, `agent_messages`, and `agent_message_parts` separate durable conversations from provider process sessions and typed transcript parts.
- `agent_context_bundles` and `agent_context_items` preserve exactly what was sent, why, its hash, estimated tokens, trust level, and truncation decision.
- `agent_epics`, `agent_workflow_definitions`, `agent_workflow_steps`, `agent_workflow_questions`, and `agent_decisions` preserve guided intent and explicit decisions.
- `agent_artifacts` holds identity, kind/template schema, `current_revision_id`, content/review/freshness states; append-only `agent_artifact_revisions` holds Markdown content, hashes, author/source, change summary, parent revision, and timestamp.
- `agent_requirements` and typed entity links connect a requirement to source revision, flow, decision, ticket, criterion, and verification result. Requirement status is `uncovered`, `planned`, `implemented`, `verified`, or `rejected`.
- `agent_tickets`, `agent_ticket_dependencies`, and `agent_acceptance_criteria` normalize ticket dependencies and criterion status/method/evidence rather than storing query-critical arrays as JSON.
- `agent_executions`, `agent_evidence`, `agent_reviews`, and `agent_review_findings` reserve durable handoff, evidence, baseline, profile, and finding resolution history.
- `agent_entity_links` supports explicitly allowed polymorphic links with a source type/id, target type/id, relation, metadata JSON, and creation time. Rust domain validation enforces valid combinations; high-value relationships retain dedicated tables.

Artifact state has independent dimensions: content (`draft`, `active`, `superseded`, `archived`), review (`unreviewed`, `changes_requested`, `approved`), and freshness (`current`, `potentially_stale`, `stale`). Revisions are append-only: a ticket or review references an exact revision, never an artifact’s mutable current value. Referenced conversations, artifacts, tickets, and evidence use archive/tombstone behavior rather than destructive deletion.

Artifacts declare a template/schema version, required and recommended sections, structured metadata, parser, renderer, and migration path. Markdown remains the editable document format; template validation warns when expected sections such as test strategy or rollback behavior are missing.

`derived_from`, `constrains`, `implements`, `verifies`, `supersedes`, and `references` dependency edges drive freshness. When an upstream revision changes, downstream artifacts become potentially stale, affected requirements are recalculated, the UI explains why, and the assistant offers reconciliation or regeneration. No user-authored downstream content is overwritten automatically.

Initial ticket states are `draft`, `ready`, `in_review`, `done`, and `blocked`. Dependencies reject self references, cycles, references to tombstoned tickets, and invalid parent/mini-ticket relationships; unmet dependencies derive `blocked`. A parent ticket cannot be marked `done` while a non-done mini-ticket exists. Acceptance criteria are rows with `pending`, `passed`, `failed`, or `waived` state; method (`manual`, `test`, `command`, `inspection`, `not_defined`); and evidence references.

`AgentExecution` exists in the schema but execution controls are disabled for release one. It records a conversation, optional ticket, provider, cwd, immutable input snapshot, baseline/result Git refs, timestamps, and `queued`, `starting`, `running`, `awaiting_input`, `interrupted`, `failed`, `completed`, `verification_pending`, `verified`, or `rejected` status. Release-one entries may represent manual review, workspace inspection, or plan validation; no ticket implementation handoff is launched.

Evidence is first-class and hash-addressed: file range, Git diff, command output, test result, artifact revision, user statement, or runtime event. A review finding must point to evidence IDs, distinguish observed/inferred/unverified/contradicted claims, and has `open`, `accepted`, `dismissed`, `fixed`, `recheck_required`, or `verified_fixed` resolution state with dismissal reason and recheck link where applicable.

## Composer and Context

The anchored composer includes, in order: context attachment, access badge with enforcement level, workflow selector, provider/model selector, reasoning-effort selector where a provider supports it, dictation action, and send/stop control. The footer shows active workspace path, context availability, and a Context Inspector entry point.

File/folder attachment captures a reference, not an uncontrolled full-repository dump. Before sending, the user sees the selected references, automatically applied instructions, exact artifact revisions, context estimate, omissions, and trust labels. The initial access presets are `read-only` and `workspace`; unavailable capabilities are disabled rather than implied.

The center surface supports three views selected from the Focus Rail: conversation, artifact workspace, and ticket/review detail. The artifact workspace provides rendered Markdown, source editing, revision history/diff, approval/request-changes actions, requirements, stale warnings, references, and “Refer in chat.” The rail also supports full-text search, filters, pins, archive, tags, recent artifacts, and backlinks using SQLite FTS5.

## State, Errors, and Recovery

- Starting a pane with no conversation displays the intentional Focus Rail empty state and creates a conversation only on the first submitted message.
- Switching provider creates a child runtime session for the same conversation only after the current provider is idle; it receives a selected immutable context snapshot and provider-attributed transcript summary rather than an undocumented implicit history transfer. The user can return to an earlier session; concurrent sessions are deferred.
- A missing binary, authentication error, invalid cwd, write failure, or abnormal exit becomes an inline event with Retry. Draft text remains intact after failed sends.
- Raw provider output stays available in an expandable diagnostic section when normalization cannot represent it safely.
- Closing a pane closes only its exclusively-owned live runtime session. The durable conversation and artifacts remain available when a pane is reopened; if multiple panes later expose one conversation, live session ownership must be explicit before shared-session behavior is enabled.
- App restart restores panes and their selected conversation IDs; it never assumes a previous CLI process remains alive.

## Accessibility and Keyboard Behavior

- All controls have labels, visible focus rings, and keyboard access.
- `CmdOrCtrl+Enter` submits; `Shift+Enter` inserts a newline.
- Escape closes transient selectors before it affects the pane.
- Rail selection uses predictable arrow-key navigation.
- Streaming status is announced through a restrained live region without re-announcing every chunk.

## Testing and Acceptance Criteria

Frontend unit tests cover typed transcript reducers; duplicate/out-of-order events; composer keyboard behavior; workflow state transitions; rail navigation; narrow-pane collapse; context inspection; provider capability controls; error/retry states; reduced motion; screen-reader streaming; and all theme token use. Rust tests cover provider resolution; capability detection; structured and PTY fallback event mapping; invalid UTF-8; chunk bounds; unknown-session interruption/close; process-tree cleanup; path containment; instruction precedence; sensitive-file exclusion; database migrations, CRUD, integrity, revision/freshness propagation, ticket cycles, and crash-safe writes. Integration tests verify pane/layout persistence, restored selected conversations, provider switching after interruption, two panes opening one conversation, runtime event replay after remount, and corrupted diagnostic recovery.

Manual QA verifies:

1. Open Agent Studio as split, tab, and workspace.
2. Start a Chat with Claude Code and Codex; confirm independently attributed streamed text and recoverable errors.
3. Create a Plan artifact and reopen it after app restart.
4. Create an Epic through its artifact ladder, add tickets and mini-tickets, and verify the parent-completion invariant.
5. Create a Review artifact from selected planning artifacts and workspace references.
6. Verify compact rail behavior at narrow pane widths and visual consistency across every existing theme.
7. Inspect a saved Context Bundle and verify exactly which instructions, artifacts, file revisions, and exclusions reached each provider.
8. Change an approved Core Flows revision and verify affected tickets/requirements become potentially stale without overwriting user edits.
9. Run a requirement-coverage review against an explicit Git baseline and reopen the evidence-bound findings later.

The release succeeds when a user can run a local Claude Code or Codex conversation in a composable, polished pane; persist and revisit its planning artifacts; progress through the guided Epic ladder; and produce an evidence-bound Review without losing work when the app or pane closes.
