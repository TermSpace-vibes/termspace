# Agent Studio Release 1A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a composable local Agent Studio pane with durable conversations, provider-neutral local Claude Code/Codex sessions, inspectable context/instructions, and a polished Focus Rail chat experience.

**Architecture:** Agent Studio is a new layout pane. The Rust backend owns a provider-neutral session manager that exposes normalized, sequenced events and persists durable data in SQLite; the React frontend reduces those events into typed transcript rows. Context is assembled and frozen before dispatch, and the UI renders the resulting provider capabilities and diagnostics instead of assuming provider-specific controls.

**Tech Stack:** Tauri v2, Rust, rusqlite, portable-pty, React 19, TypeScript, Zustand, Vitest, Testing Library, lucide-react, framer-motion.

## Global Constraints

- Target macOS first; use Rust path canonicalization and do not access paths outside the selected workspace.
- Preserve the existing `ClaudePane` and its `ClaudeSessionManager`; Agent Studio must not regress it.
- Support only `claude-code` and `codex` providers in Release 1A; unsupported capability controls must be disabled.
- Persist immutable typed message parts and immutable context snapshots; never persist secrets or default-excluded file contents.
- Keep active execution, ticket handoff, custom workflow authoring, remote A2A, and worktree creation unavailable.
- Use the existing CSS theme tokens and add semantic Agent Studio variables for every current theme.
- Add every new `src/**/*.ts(x)` file to `docs/dependency-map.md` by running `node scripts/gen-dep-map.js` in the final task.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/types/index.ts` | Shared Agent Studio contracts and layout leaf type |
| `src/utils/layout.ts` | Add/remove Agent Studio leaves without disturbing existing panes |
| `src/store/useAppStore.ts` | Pane records, selected conversations, transient session UI state |
| `src/components/WorkspaceView/AgentStudioPane.tsx` | Pane shell, session lifecycle, Focus Rail composition |
| `src/components/WorkspaceView/agentTranscript.ts` | Pure transcript reducer for sequenced runtime events |
| `src/components/WorkspaceView/AgentFocusRail.tsx` | Chats/artifacts navigation and narrow-pane collapse |
| `src/components/WorkspaceView/AgentComposer.tsx` | Accessible composer and context/provider controls |
| `src/components/WorkspaceView/AgentContextInspector.tsx` | Immutable context bundle and instruction/exclusion inspection |
| `src/components/WorkspaceView/AgentProviderDiagnostics.tsx` | Local provider health/capabilities view |
| `src/components/WorkspaceView/TerminalGrid.tsx` | Render Agent Studio layout leaves |
| `src/components/WorkspaceView/WorkspaceView.tsx` | Create/close panes and expose the entry point |
| `src-tauri/src/agent_runtime_manager.rs` | Provider adapters, PTY lifecycle, coalesced normalized event stream |
| `src-tauri/src/agent_context.rs` | Instruction resolution, safe path filtering, deterministic bundles |
| `src-tauri/src/db.rs` | Agent Studio schema and CRUD |
| `src-tauri/src/commands.rs` | Tauri commands for agent data, diagnostics, and sessions |
| `src-tauri/src/lib.rs` | Register the manager and commands |

### Task 1: Define provider-neutral frontend contracts and pane layout support

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/utils/layout.ts`
- Modify: `src/store/useAppStore.ts`
- Test: `src/utils/layout.test.ts`
- Test: `src/store/useAppStore.test.ts`

**Interfaces:**
- Produces `AgentStudioPane`, `AgentConversation`, `AgentRuntimeSession`, `AgentProviderId`, `AgentProviderCapabilities`, `AgentRuntimeEnvelope`, and `LayoutNode { type: 'agent-studio' }`.
- Consumed by Tasks 5–8.

- [ ] **Step 1: Write failing layout and store tests**

```ts
it('adds and removes an agent studio leaf without removing an editor leaf', () => {
  const root = addEditorPaneToLayout(null, 'editor-1')
  const withAgent = addAgentStudioPaneToLayout(root, 'agent-1')
  expect(withAgent).toContainEqual(expect.objectContaining({ type: 'agent-studio', agentStudioPaneId: 'agent-1' }))
  expect(removeAgentStudioPaneFromLayout(withAgent, 'agent-1')).toEqual(root)
})

it('removes an agent studio pane from its tab state and layout', () => {
  useAppStore.getState().addAgentStudioPane('tab-1', pane)
  useAppStore.getState().removeAgentStudioPane('tab-1', pane.id)
  expect(useAppStore.getState().agentStudioPanesByTab['tab-1']).toEqual([])
})
```

- [ ] **Step 2: Run the focused tests to verify failure**

Run: `npm test -- src/utils/layout.test.ts src/store/useAppStore.test.ts`

Expected: TypeScript/test failures because Agent Studio types and store actions do not exist.

- [ ] **Step 3: Add shared types and layout helpers**

```ts
export type AgentProviderId = 'claude-code' | 'codex'
export type AgentSessionStatus = 'starting' | 'ready' | 'running' | 'blocked' | 'error' | 'exited'

export interface AgentStudioPane {
  id: string; tabId: string; title: string; cwd: string
  conversationId: string | null; position: number; createdAt: number
}

export type LayoutNode =
  | { type: 'agent-studio'; id: string; agentStudioPaneId: string }
  // retain every existing union member
```

Add `addAgentStudioPaneToLayout`/`removeAgentStudioPaneFromLayout` by following the exact existing Claude helper pattern, and add `agentStudioPanesByTab`, `addAgentStudioPane`, `removeAgentStudioPane`, and `updateAgentStudioPane` actions to the store and durable UI state.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- src/utils/layout.test.ts src/store/useAppStore.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/utils/layout.ts src/utils/layout.test.ts src/store/useAppStore.ts src/store/useAppStore.test.ts
git commit -m "feat: add agent studio pane contracts"
```

### Task 2: Add migration-safe Agent Studio persistence

**Files:**
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/commands.rs`
- Test: `src-tauri/src/db.rs`

**Interfaces:**
- Produces CRUD commands: `create_agent_conversation`, `list_agent_conversations`, `append_agent_message`, `create_agent_context_bundle`, `get_agent_context_bundle`.
- Consumed by Tasks 5–7.

- [ ] **Step 1: Write Rust database tests inside `db.rs`**

```rust
#[test]
fn context_bundle_keeps_hashes_and_never_stores_excluded_content() {
    let conn = init_test_db();
    let bundle = create_agent_context_bundle(&conn, ContextBundleInput::fixture());
    assert_eq!(get_agent_context_bundle(&conn, &bundle.id).unwrap().items[0].content_hash, "abc");
    assert!(!get_agent_context_bundle(&conn, &bundle.id).unwrap().items[0].source.contains("SECRET"));
}

#[test]
fn messages_keep_versioned_typed_parts_in_sequence_order() { /* assert 1 then 2 */ }
```

- [ ] **Step 2: Run the Rust test target to verify failure**

Run: `cargo test db::tests --manifest-path src-tauri/Cargo.toml`

Expected: FAIL because Agent Studio tables and functions are missing.

- [ ] **Step 3: Add idempotent schema migration and CRUD**

Create `agent_schema_migrations` and use `PRAGMA user_version` or a recorded migration id. Add tables for conversations, runtime sessions, messages, message parts, context bundles/items, and raw diagnostics. Enable foreign keys/WAL through existing `init_db`. Store typed parts as `parts_json TEXT NOT NULL`, context item hashes and metadata—not sensitive contents—and indexed conversation/update columns.

```rust
conn.execute_batch("CREATE TABLE IF NOT EXISTS agent_conversations (...);
CREATE TABLE IF NOT EXISTS agent_runtime_sessions (...);
CREATE TABLE IF NOT EXISTS agent_messages (... parts_json TEXT NOT NULL ...);
CREATE TABLE IF NOT EXISTS agent_context_bundles (... truncated INTEGER NOT NULL ...);
CREATE TABLE IF NOT EXISTS agent_context_items (... content_hash TEXT NOT NULL ...);")?;
```

Expose thin command handlers that validate IDs and map database errors to user-safe strings. Do not expose raw SQL to the frontend.

- [ ] **Step 4: Run database tests**

Run: `cargo test db::tests --manifest-path src-tauri/Cargo.toml`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db.rs src-tauri/src/commands.rs
git commit -m "feat: persist agent conversations and context"
```

### Task 3: Implement safe instruction resolution and context assembly

**Files:**
- Create: `src-tauri/src/agent_context.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/commands.rs`
- Test: `src-tauri/src/agent_context.rs`

**Interfaces:**
- Produces `resolve_workspace_instructions(workspace_root, selected_paths)` and `assemble_context(ContextRequest) -> ContextBundleInput`.
- Consumed by Task 4 and the Context Inspector in Task 6.

- [ ] **Step 1: Write failing resolver tests**

```rust
#[test]
fn closest_agents_instruction_precedes_root_and_claude_files() {
    let resolved = resolve_workspace_instructions(&fixture.root, &[fixture.package_file.clone()]).unwrap();
    assert_eq!(resolved.files.iter().map(|file| file.path.clone()).collect::<Vec<_>>(), vec![fixture.nested_agents, fixture.root_agents, fixture.root_claude]);
}

#[test]
fn assembler excludes_env_and_outside_symlink_targets() {
    let bundle = assemble_context(ContextRequest::fixture()).unwrap();
    assert!(bundle.items.iter().all(|item| !item.source.ends_with(".env")));
    assert!(bundle.exclusions.iter().any(|item| item.reason == "outside_workspace"));
}
```

- [ ] **Step 2: Run focused test to verify failure**

Run: `cargo test agent_context::tests --manifest-path src-tauri/Cargo.toml`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement resolver and deterministic budget policy**

Canonicalize selected paths, reject escapes, collect nested `AGENTS.md`, root `AGENTS.md`, then `CLAUDE.md`, hash file contents, and record scope/conflicts. Build bundles from required items first, sort optional items by descending priority then stable path/id, and set `truncated` plus exclusion reasons when the configured provider budget is reached. Treat repository content as `untrusted_content`; only explicit user/session instructions use instruction trust.

- [ ] **Step 4: Register module and command**

Add `mod agent_context;` to `lib.rs`, then add a `preview_agent_context` Tauri command that returns the same safe bundle used before dispatch.

- [ ] **Step 5: Run focused tests**

Run: `cargo test agent_context::tests --manifest-path src-tauri/Cargo.toml`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/agent_context.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: assemble safe agent context"
```

### Task 4: Add capability-aware provider runtime manager

**Files:**
- Create: `src-tauri/src/agent_runtime_manager.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/agent_runtime_manager.rs`

**Interfaces:**
- Produces Tauri commands `get_agent_provider_diagnostics`, `start_agent_session`, `write_agent_session`, `interrupt_agent_session`, `close_agent_session` and event `agent-event-{session_id}`.
- Consumed by Tasks 5–7.

- [ ] **Step 1: Write failing adapter tests**

```rust
#[test]
fn normalizer_coalesces_text_and_assigns_monotonic_sequences() {
    let events = normalize_chunks("s1", vec![b"hel", b"lo"]);
    assert_eq!(events[0].sequence, 1);
    assert_eq!(events[0].event, AgentRuntimeEvent::Text { text: "hello".into() });
}

#[test]
fn codex_diagnostic_reports_missing_binary_without_claiming_capabilities() {
    let diagnostic = inspect_provider(AgentProviderId::Codex, "/missing");
    assert!(!diagnostic.available);
    assert!(!diagnostic.capabilities.structured_output);
}
```

- [ ] **Step 2: Run the focused target to verify failure**

Run: `cargo test agent_runtime_manager::tests --manifest-path src-tauri/Cargo.toml`

Expected: FAIL because the manager is missing.

- [ ] **Step 3: Implement provider descriptors and safe PTY fallback**

Define one adapter descriptor per provider with executable discovery, documented machine-readable mode if installed version supports it, fallback PTY command, and static capability defaults. Launch with the selected immutable context bundle, emit `AgentRuntimeEnvelope { session_id, sequence, timestamp, event }`, coalesce text for 16–50 ms, cap buffers, and spool large raw diagnostics. `interrupt` must preserve the process/session where supported; `close` must terminate and reap the process tree idempotently.

- [ ] **Step 4: Register managed state and commands**

Add `app.manage(AgentRuntimeManager::new())` in the existing setup path and register all five commands in the current `generate_handler!` block. Do not modify Claude command registration or `ClaudeSessionManager`.

- [ ] **Step 5: Run focused Rust tests**

Run: `cargo test agent_runtime_manager::tests --manifest-path src-tauri/Cargo.toml`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/agent_runtime_manager.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add provider-neutral agent runtime"
```

### Task 5: Build the pure transcript/session reducer

**Files:**
- Create: `src/components/WorkspaceView/agentTranscript.ts`
- Create: `src/components/WorkspaceView/agentTranscript.test.ts`

**Interfaces:**
- Produces `createAgentTranscript`, `appendAgentEnvelope`, `appendAgentUserMessage`, and `AgentTranscriptRow`.
- Consumed by Task 6.

- [ ] **Step 1: Write reducer tests**

```ts
it('coalesces adjacent text envelopes and ignores duplicates', () => {
  const first = appendAgentEnvelope(createAgentTranscript(), envelope(1, { kind: 'text', text: 'hel' }))
  const second = appendAgentEnvelope(first, envelope(2, { kind: 'text', text: 'lo' }))
  expect(appendAgentEnvelope(second, envelope(2, { kind: 'text', text: 'lo' })).rows).toEqual(second.rows)
  expect(second.rows.at(-1)).toMatchObject({ kind: 'assistant', text: 'hello' })
})

it('adds a sequence-gap diagnostic without discarding the later event', () => {
  expect(appendAgentEnvelope(createAgentTranscript(), envelope(2, { kind: 'ready' })).rows).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'diagnostic' })]))
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- src/components/WorkspaceView/agentTranscript.test.ts`

Expected: FAIL because the reducer module is missing.

- [ ] **Step 3: Implement immutable reducer**

Map typed runtime events to text, activity, question, error, status, and diagnostic rows. Keep `lastSequence`, never mutate prior rows, merge only adjacent text rows from the same session, and preserve `rawOutputRef` rather than raw bytes.

- [ ] **Step 4: Run test to verify pass**

Run: `npm test -- src/components/WorkspaceView/agentTranscript.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/WorkspaceView/agentTranscript.ts src/components/WorkspaceView/agentTranscript.test.ts
git commit -m "feat: reduce typed agent runtime events"
```

### Task 6: Implement the Focus Rail Agent Studio UI

**Files:**
- Create: `src/components/WorkspaceView/AgentStudioPane.tsx`
- Create: `src/components/WorkspaceView/AgentFocusRail.tsx`
- Create: `src/components/WorkspaceView/AgentComposer.tsx`
- Create: `src/components/WorkspaceView/AgentContextInspector.tsx`
- Create: `src/components/WorkspaceView/AgentProviderDiagnostics.tsx`
- Create: `src/components/WorkspaceView/AgentStudioPane.test.tsx`
- Modify: `src/styles/globals.css`

**Interfaces:**
- Consumes Task 1 types, Task 2 CRUD commands, Task 3 preview command, Task 4 runtime commands, and Task 5 reducer.
- Produces a pane that starts a session only after Tauri listeners are attached and preserves a failed draft.

- [ ] **Step 1: Write UI tests**

```tsx
it('attaches agent-event listener before starting the selected provider session', async () => {
  render(<AgentStudioPane tabId="tab-1" paneId="agent-1" isActive onFocus={vi.fn()} onClose={vi.fn()} />)
  await waitFor(() => expect(listen.mock.invocationCallOrder[0]).toBeLessThan(invoke.mock.invocationCallOrder.find((_, i) => vi.mocked(invoke).mock.calls[i][0] === 'start_agent_session')!))
})

it('opens context inspector and labels advisory access honestly', async () => {
  renderPaneWithProvider({ enforcement: 'advisory' })
  await userEvent.click(screen.getByRole('button', { name: /context/i }))
  expect(screen.getByText(/advisory access/i)).toBeVisible()
})
```

- [ ] **Step 2: Run UI tests to verify failure**

Run: `npm test -- src/components/WorkspaceView/AgentStudioPane.test.tsx`

Expected: FAIL because the components are missing.

- [ ] **Step 3: Implement components with accessible markup**

Use a CSS grid with a 232px rail and `@container`/media query collapse below 760px. The empty state must show the workspace name, a focused prompt, and no fake active agent. The composer uses a `textarea`, `CmdOrCtrl+Enter` submit, `Shift+Enter` newline, labelled controls, visible focus, a live status region, and Stop only while running. The context inspector displays included/excluded items, hashes/line ranges, instructions, token estimate, and trust labels. Provider diagnostics displays binary/version/auth capability data and hides unsupported reasoning/model controls.

- [ ] **Step 4: Add semantic theme tokens**

Add to every theme block:

```css
--agent-surface: var(--bg-secondary);
--agent-composer: color-mix(in srgb, var(--bg-terminal) 88%, var(--accent));
--agent-rail-selected: color-mix(in srgb, var(--accent) 24%, transparent);
--agent-attention: #d7a84a;
--agent-success: #55bc91;
```

Use `@media (prefers-reduced-motion: reduce)` to disable entry/transition animation.

- [ ] **Step 5: Run UI test and TypeScript build**

Run: `npm test -- src/components/WorkspaceView/AgentStudioPane.test.tsx && npm run build`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/WorkspaceView/AgentStudioPane.tsx src/components/WorkspaceView/AgentFocusRail.tsx src/components/WorkspaceView/AgentComposer.tsx src/components/WorkspaceView/AgentContextInspector.tsx src/components/WorkspaceView/AgentProviderDiagnostics.tsx src/components/WorkspaceView/AgentStudioPane.test.tsx src/styles/globals.css
git commit -m "feat: add agent studio focus rail"
```

### Task 7: Integrate Agent Studio into the workspace pane system

**Files:**
- Modify: `src/components/WorkspaceView/TerminalGrid.tsx`
- Modify: `src/components/WorkspaceView/WorkspaceView.tsx`
- Modify: `src/components/WorkspaceView/WorkspaceHeader.tsx`
- Test: `src/components/WorkspaceView/TerminalGrid.test.tsx`
- Test: `src/components/WorkspaceView/WorkspaceView.test.tsx`

**Interfaces:**
- Consumes the `agent-studio` layout leaf and `AgentStudioPane` from Tasks 1 and 6.
- Produces the visible entry point and safe close behavior.

- [ ] **Step 1: Write integration tests**

```tsx
it('renders AgentStudioPane for an agent-studio layout node', () => {
  seedLayout({ type: 'agent-studio', id: 'agent-a', agentStudioPaneId: 'agent-1' })
  render(<TerminalGrid {...props} />)
  expect(screen.getByLabelText('Agent Studio')).toBeVisible()
})

it('adds Agent Studio using the configured tab pane behavior', async () => {
  renderWorkspace({ toolPaneBehavior: 'tab' })
  await userEvent.click(screen.getByRole('button', { name: /agent studio/i }))
  expect(useAppStore.getState().agentStudioPanesByTab).toHaveProperty('new-tab')
})
```

- [ ] **Step 2: Run integration tests to verify failure**

Run: `npm test -- src/components/WorkspaceView/TerminalGrid.test.tsx src/components/WorkspaceView/WorkspaceView.test.tsx`

Expected: FAIL because no Agent Studio node is rendered or created.

- [ ] **Step 3: Wire rendering, add action, and close lifecycle**

Mirror the existing Claude pane wiring: extend empty pane collections, grid flatten/render/maximize branches, visible-pane condition, and close action. On close, invoke `close_agent_session` only for a live pane-owned session, remove the layout leaf, and leave durable conversation data untouched. Add a clearly labelled Agent Studio action beside existing workspace tooling actions.

- [ ] **Step 4: Run integration tests and full frontend suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/WorkspaceView/TerminalGrid.tsx src/components/WorkspaceView/WorkspaceView.tsx src/components/WorkspaceView/WorkspaceHeader.tsx src/components/WorkspaceView/TerminalGrid.test.tsx src/components/WorkspaceView/WorkspaceView.test.tsx
git commit -m "feat: open agent studio in workspace layouts"
```

### Task 8: Verify the release, update dependency map, and document deferred phases

**Files:**
- Modify: `docs/dependency-map.md`
- Modify: `docs/superpowers/specs/2026-07-12-agent-studio-design.md`

- [ ] **Step 1: Add explicit release-status notes to the design spec**

Record Release 1A as implemented only after all verification below passes. Record Release 1B (Epic/revisions/requirements/tickets) and Release 1C (evidence-bound review) as planned, not implemented.

- [ ] **Step 2: Generate the dependency map**

Run: `node scripts/gen-dep-map.js`

Expected: `docs/dependency-map.md` lists every new Agent Studio source file and its imports/dependents.

- [ ] **Step 3: Run frontend, Rust, and formatting verification**

Run: `npm test && npm run build && cargo test --manifest-path src-tauri/Cargo.toml && cargo fmt --check --manifest-path src-tauri/Cargo.toml`

Expected: every command exits 0.

- [ ] **Step 4: Perform manual acceptance checks**

1. Open Agent Studio as a split, tab, and workspace; confirm terminal/editor panes remain alive.
2. Run Claude Code and Codex conversations independently; confirm provider label, event order, stop, retry, close, and preserved drafts.
3. Inspect applied `AGENTS.md`/`CLAUDE.md`, selected artifact/file context, exclusions, token estimate, and advisory/provider enforcement label.
4. Restart Termspace; reopen the pane and confirm durable conversation selection returns but no stale CLI process is assumed alive.
5. Test 760px-or-narrow pane width, keyboard composer controls, visible focus, screen-reader status, reduced motion, and all six themes.

- [ ] **Step 5: Commit verification artifacts**

```bash
git add docs/dependency-map.md docs/superpowers/specs/2026-07-12-agent-studio-design.md
git commit -m "docs: verify agent studio release 1a"
```

## Plan Self-Review

- Spec coverage: Tasks 1–4 implement the durable pane/runtime/context foundation; Tasks 5–7 implement the Focus Rail and integration; Task 8 verifies persistence, themes, accessibility, and dependency-map maintenance. Epic graph/revisions/requirements/tickets and review evidence are intentionally assigned to the approved subsequent release plans rather than claimed in Release 1A.
- Placeholder scan: no task uses TBD/TODO, generic testing directions, or undefined interfaces.
- Type consistency: frontend `AgentStudioPane`/layout leaf names, backend session commands, event channel, and `ContextBundle` contracts are defined before their consumers.
