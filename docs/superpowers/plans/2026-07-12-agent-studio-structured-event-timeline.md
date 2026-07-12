# Agent Studio Structured Event Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Agent Studio's raw terminal-style transcript with a Traycer-inspired typed execution timeline and actionable in-flow question cards.

**Architecture:** The local PTY remains a compatibility source, but its payload is normalized before React renders it. A pure frontend classifier converts recognizable Claude trust prompts into typed questions; a pure reducer owns ordered timeline rows and answer state. Small timeline components render each event type independently, so native JSON/JSONL adapters can later use the same UI contract.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Tauri v2, existing Claude output parser, lucide-react, CSS custom properties.

## Global Constraints

- Do not render ANSI escapes, terminal frames, or screen-reader controls as assistant messages.
- Keep providers local (`claude-code`, `codex`) and do not claim unsupported hosted models.
- Preserve listener-before-provider-start and the clean initial start screen.
- Allow no more than one unresolved question per runtime session.
- Access modes remain advisory until the active provider proves enforcement.
- Unknown output is readable normalized text; raw payloads remain diagnostics only.
- Run `node scripts/gen-dep-map.js` before final commit because new `src/` files are added.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/types/index.ts` | Shared typed question, command, activity, and message event contracts. |
| `src/components/WorkspaceView/agentRuntimeNormalizer.ts` | Pure raw-PTY-to-safe-event compatibility classifier. |
| `src/components/WorkspaceView/agentRuntimeNormalizer.test.ts` | Classifier tests, including Claude workspace trust. |
| `src/components/WorkspaceView/agentTranscript.ts` | Pure ordered timeline reducer and answer state. |
| `src/components/WorkspaceView/agentTranscript.test.ts` | Reducer event/answer tests. |
| `src/components/WorkspaceView/AgentTimeline.tsx` | Typed event-to-card renderer. |
| `src/components/WorkspaceView/AgentCommandCard.tsx` | Expandable command evidence. |
| `src/components/WorkspaceView/AgentQuestionCard.tsx` | Accessible selectable question form. |
| `src/components/WorkspaceView/AgentTimeline.test.tsx` | Timeline/card tests. |
| `src/components/WorkspaceView/AgentStudioPane.tsx` | Listener lifecycle, answer write, composer state. |
| `src/components/WorkspaceView/AgentStudioPane.test.tsx` | Pane integration tests. |
| `src/styles/globals.css` | Theme-token-based timeline/question styling. |

### Task 1: Define typed events and the timeline reducer

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/components/WorkspaceView/agentTranscript.ts`
- Modify: `src/components/WorkspaceView/agentTranscript.test.ts`

**Consumes:** `AgentRuntimeEnvelope` sequence numbers.

**Produces:** `AgentQuestionChoice`, typed rows, `appendAgentQuestionAnswer`, `hasOpenAgentQuestion`, and `getOpenAgentQuestion`.

- [ ] **Step 1: Write the failing reducer tests**

```ts
it('keeps a question open until an explicit answer is appended', () => {
  const state = appendAgentEnvelope(createAgentTranscript(), envelope(1, {
    kind: 'question', id: 'trust-workspace', prompt: 'Trust this workspace?',
    choices: [{ id: 'trust', label: 'Yes, trust workspace', input: '1\n' }], allowCustom: false,
  }))
  expect(hasOpenAgentQuestion(state)).toBe(true)
  expect(appendAgentQuestionAnswer(state, 'trust-workspace', 'trust', false).rows.at(-1))
    .toMatchObject({ kind: 'answer', answer: 'trust' })
})

it('does not coalesce messages across activity rows', () => {
  const first = appendAgentEnvelope(createAgentTranscript(), envelope(1, { kind: 'message', markdown: 'First' }))
  const activity = appendAgentEnvelope(first, envelope(2, { kind: 'activity', label: 'Thought for 1s' }))
  const final = appendAgentEnvelope(activity, envelope(3, { kind: 'message', markdown: 'Second' }))
  expect(final.rows.filter((row) => row.kind === 'message')).toHaveLength(2)
})
```

- [ ] **Step 2: Verify red**

Run: `npm test -- src/components/WorkspaceView/agentTranscript.test.ts`

Expected: FAIL because typed questions, messages, and answer helpers do not exist.

- [ ] **Step 3: Implement the shared contract and reducer**

```ts
export interface AgentQuestionChoice { id: string; label: string; input: string; description?: string }
export type AgentRuntimeEvent =
  | { kind: 'text'; text: string } // compatibility input, normalized before reduction
  | { kind: 'message'; markdown: string }
  | { kind: 'activity'; label: string; durationMs?: number }
  | { kind: 'command'; command: string; cwd: string; output?: string; exitCode?: number | null }
  | { kind: 'question'; id: string; prompt: string; choices: AgentQuestionChoice[]; allowCustom: boolean }
  | { kind: 'ready' }
  | { kind: 'error'; message: string; rawOutputRef?: string }
  | { kind: 'status'; status: AgentSessionStatus }
  | { kind: 'diagnostic'; rawOutputRef: string }
```

Replace `assistant` rows with separate `user` and `message` rows. Add `question`, `answer`, `activity`, `command`, `status`, `error`, and `diagnostic` rows while retaining sequence-gap and duplicate-sequence behavior. `appendAgentQuestionAnswer` closes only its matching open question.

- [ ] **Step 4: Verify green**

Run: `npm test -- src/components/WorkspaceView/agentTranscript.test.ts`

Expected: PASS with zero failures.

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/components/WorkspaceView/agentTranscript.ts src/components/WorkspaceView/agentTranscript.test.ts
git commit -m "feat: add typed agent timeline events"
```

### Task 2: Normalize compatibility output before rendering

**Files:**
- Create: `src/components/WorkspaceView/agentRuntimeNormalizer.ts`
- Create: `src/components/WorkspaceView/agentRuntimeNormalizer.test.ts`
- Modify: `src/components/WorkspaceView/AgentStudioPane.tsx`

**Consumes:** raw `text` envelopes plus `detectClaudePermissionPrompt` and `stripClaudeAnsi`.

**Produces:** `normalizeAgentRuntimeEnvelope(envelope): AgentRuntimeEnvelope[]`.

- [ ] **Step 1: Write the failing normalizer tests**

```ts
it('turns Claude trust output into a typed question instead of a message', () => {
  const events = normalizeAgentRuntimeEnvelope(envelope(4, {
    kind: 'text', text: 'Do you trust this workspace?\n1. Yes, I trust this folder\n2. No, exit',
  }))
  expect(events).toEqual([expect.objectContaining({
    event: expect.objectContaining({ kind: 'question', id: 'claude-workspace-trust' }),
  })])
})

it('strips ANSI controls and exposes unknown text as a message', () => {
  const [result] = normalizeAgentRuntimeEnvelope(envelope(5, { kind: 'text', text: '\u001b[2KHello\r\n' }))
  expect(result.event).toEqual({ kind: 'message', markdown: 'Hello' })
})
```

- [ ] **Step 2: Verify red**

Run: `npm test -- src/components/WorkspaceView/agentRuntimeNormalizer.test.ts`

Expected: FAIL because the normalizer module does not exist.

- [ ] **Step 3: Implement the pure classifier and wire it into the listener**

```ts
export function normalizeAgentRuntimeEnvelope(envelope: AgentRuntimeEnvelope): AgentRuntimeEnvelope[] {
  if (envelope.event.kind !== 'text') return [envelope]
  const readable = stripClaudeAnsi(envelope.event.text)
  const permission = detectClaudePermissionPrompt(readable)
  if (permission) return [{ ...envelope, event: {
    kind: 'question', id: 'claude-workspace-trust', prompt: permission.message,
    choices: permission.choices.map((choice, index) => ({ id: `choice-${index + 1}`, label: choice.label, input: choice.input })),
    allowCustom: false,
  }}]
  return readable ? [{ ...envelope, event: { kind: 'message', markdown: readable } }] : []
}
```

In `AgentStudioPane`, replace inline ANSI cleanup with a loop over normalized envelopes. Do not append the original raw prompt after emitting a structured question.

- [ ] **Step 4: Verify green**

Run: `npm test -- src/components/WorkspaceView/agentRuntimeNormalizer.test.ts src/components/WorkspaceView/AgentStudioPane.test.tsx`

Expected: PASS with zero failures.

- [ ] **Step 5: Commit**

```bash
git add src/components/WorkspaceView/agentRuntimeNormalizer.ts src/components/WorkspaceView/agentRuntimeNormalizer.test.ts src/components/WorkspaceView/AgentStudioPane.tsx src/components/WorkspaceView/AgentStudioPane.test.tsx
git commit -m "feat: normalize agent compatibility output"
```

### Task 3: Build timeline, command evidence, and question card components

**Files:**
- Create: `src/components/WorkspaceView/AgentTimeline.tsx`
- Create: `src/components/WorkspaceView/AgentCommandCard.tsx`
- Create: `src/components/WorkspaceView/AgentQuestionCard.tsx`
- Create: `src/components/WorkspaceView/AgentTimeline.test.tsx`

**Consumes:** Task 1's `AgentTranscriptRow` union.

**Produces:** accessible presentation components for Task 4.

- [ ] **Step 1: Write failing card tests**

```tsx
it('keeps command evidence collapsed until opened', () => {
  render(<AgentCommandCard command="git status --short" cwd="/repo" output=" M src/App.tsx" exitCode={0} />)
  expect(screen.queryByText(' M src/App.tsx')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /ran 1 command/i }))
  expect(screen.getByText(' M src/App.tsx')).toBeVisible()
})

it('submits the selected question option', () => {
  const onSubmit = vi.fn()
  render(<AgentQuestionCard row={questionRow} onSubmit={onSubmit} />)
  fireEvent.click(screen.getByRole('radio', { name: 'Yes, trust workspace' }))
  fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }))
  expect(onSubmit).toHaveBeenCalledWith('trust', false)
})
```

- [ ] **Step 2: Verify red**

Run: `npm test -- src/components/WorkspaceView/AgentTimeline.test.tsx`

Expected: FAIL because the timeline/card components do not exist.

- [ ] **Step 3: Implement the focused components**

`AgentTimeline` maps `activity` to compact disclosure rows, `command` to `AgentCommandCard`, `question` to `AgentQuestionCard`, `message` to safe readable prose, and `user` to a right-aligned `You` bubble. `AgentCommandCard` owns one `expanded` boolean and reveals command/cwd/output/exit code only after disclosure. `AgentQuestionCard` uses a `fieldset`, native radio inputs, optional controlled custom text, disabled Submit until valid, and Skip calling `onSubmit('', true)`.

- [ ] **Step 4: Verify green**

Run: `npm test -- src/components/WorkspaceView/AgentTimeline.test.tsx`

Expected: PASS with zero failures.

- [ ] **Step 5: Commit**

```bash
git add src/components/WorkspaceView/AgentTimeline.tsx src/components/WorkspaceView/AgentCommandCard.tsx src/components/WorkspaceView/AgentQuestionCard.tsx src/components/WorkspaceView/AgentTimeline.test.tsx
git commit -m "feat: render agent timeline and question cards"
```

### Task 4: Integrate answer dispatch and final visual treatment

**Files:**
- Modify: `src/components/WorkspaceView/AgentStudioPane.tsx`
- Modify: `src/components/WorkspaceView/AgentStudioPane.test.tsx`
- Modify: `src/styles/globals.css`

**Consumes:** Tasks 1–3.

**Produces:** an interactive Agent Studio that blocks the composer only during unresolved questions.

- [ ] **Step 1: Write failing integration tests**

```tsx
it('renders a trust prompt as a question card and writes the selected input once', async () => {
  renderPane()
  emitAgentEvent({ sequence: 2, event: { kind: 'text', text: 'Do you trust this workspace?\n1. Yes, I trust this folder' } })
  fireEvent.click(await screen.findByRole('radio', { name: 'Yes, trust workspace' }))
  fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }))
  await waitFor(() => expect(tauri.invoke).toHaveBeenCalledWith('write_agent_session', { sessionId: 'agent-1', data: '1\n' }))
})

it('disables the composer while a question is unresolved', async () => {
  renderPane()
  emitAgentEvent(questionEnvelope)
  expect(await screen.findByRole('textbox', { name: 'Ask Agent Studio' })).toBeDisabled()
})
```

- [ ] **Step 2: Verify red**

Run: `npm test -- src/components/WorkspaceView/AgentStudioPane.test.tsx`

Expected: FAIL because the pane does not render timeline cards, route answers, or block the composer.

- [ ] **Step 3: Integrate the timeline and answer write**

```ts
const submitQuestionAnswer = async (questionId: string, answerId: string, skipped: boolean) => {
  const question = getOpenAgentQuestion(transcript)
  if (!question || question.id !== questionId) return
  const choice = question.choices.find((item) => item.id === answerId)
  const input = skipped ? '' : choice?.input ?? answerId
  if (input) await invoke('write_agent_session', { sessionId: paneId, data: input })
  setTranscript((current) => appendAgentQuestionAnswer(current, questionId, choice?.label ?? answerId, skipped))
}
```

Render `<AgentTimeline transcript={transcript} onQuestionAnswer={submitQuestionAnswer} />`. Derive an open question from the reducer and disable the textarea/send button only while it exists. Add CSS for compact activity rows, collapsed command evidence, question cards, selected radio options, answer summaries, and a blocked composer. Use existing theme tokens and preserve visible focus rings/reduced-motion behavior.

- [ ] **Step 4: Verify green**

Run: `npm test -- src/components/WorkspaceView/AgentStudioPane.test.tsx src/components/WorkspaceView/AgentTimeline.test.tsx && npm run build`

Expected: all focused tests PASS and `tsc && vite build` exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/components/WorkspaceView/AgentStudioPane.tsx src/components/WorkspaceView/AgentStudioPane.test.tsx src/styles/globals.css
git commit -m "feat: integrate structured agent interactions"
```

### Task 5: Verify the full app and refresh the dependency map

**Files:**
- Modify: `docs/dependency-map.md`

**Consumes:** Tasks 1–4.

- [ ] **Step 1: Generate the map**

Run: `node scripts/gen-dep-map.js`

Expected: the generated map contains Agent Timeline and card modules.

- [ ] **Step 2: Run full verification**

Run: `npm test && npm run build && cargo test --manifest-path src-tauri/Cargo.toml && cargo fmt --check --manifest-path src-tauri/Cargo.toml`

Expected: every command exits 0.

- [ ] **Step 3: Manual acceptance pass**

1. Open a fresh pane and confirm the centered clean start state.
2. Send a prompt and confirm a right-aligned user bubble and running state.
3. Feed a Claude trust prompt and confirm a selectable question card, never ANSI/terminal text.
4. Submit one option and confirm exactly one provider write and a concise answer row.
5. Expand a command card and confirm command evidence is initially hidden.
6. Check every existing theme for readable cards, focus rings, and selection states.

- [ ] **Step 4: Commit verification artifacts**

```bash
git add docs/dependency-map.md
git commit -m "docs: map structured agent timeline dependencies"
```

## Plan Self-Review

- Spec coverage: Tasks 1–4 implement typed events, compatibility normalization, timeline activities, command evidence, questions, answers, composer blocking, and terminal-text suppression. Task 5 covers validation and the dependency map.
- Placeholder scan: every implementation step names paths, commands, and expected results.
- Type consistency: `AgentQuestionChoice`, `normalizeAgentRuntimeEnvelope`, `appendAgentQuestionAnswer`, `hasOpenAgentQuestion`, `getOpenAgentQuestion`, `AgentTimeline`, and `AgentQuestionCard` use one spelling across all tasks.
