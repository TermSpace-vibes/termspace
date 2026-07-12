# Agent Studio Structured Event Timeline

## Purpose

Replace Agent Studio's raw terminal-text transcript with a Traycer-inspired, local-first execution timeline. The UI must express what an agent is doing, what it ran, what it needs from the user, and its final response without presenting terminal control output as chat.

## Scope

This increment changes the Agent Studio conversation surface and the frontend/runtime event boundary.

Included:

- typed activity, command, assistant-message, question, answer, error, and completion events;
- a compact, chronological execution timeline;
- in-flow single-question cards with selectable options, an optional custom response, Skip, and Submit;
- command cards that are collapsed by default and expose command/cwd/output when expanded;
- conversion of recognisable Claude workspace-trust prompts into a structured question event;
- preservation of the existing composer, context inspector, access selector, provider picker, and local-first runtime.

Excluded:

- arbitrary model-generated multi-question forms;
- custom workflow authoring;
- remote providers or Traycer service integration;
- claiming OS-level access enforcement where the active local provider cannot provide it;
- provider-specific JSON streaming until the adapter supports it.

## Interaction Design

The conversation center is a timeline, not terminal output.

1. A user prompt is right-aligned and labelled `You`.
2. Agent progress appears as small timeline rows such as `Thought for 2s` or `Ran 1 command`.
3. A command row opens inline. It contains the command, working directory, exit state, and normalized output. It never renders ANSI escape sequences.
4. An agent message uses readable Markdown-like prose with code blocks styled separately.
5. When the agent needs a decision, it emits a question card below the relevant timeline event. The card provides radio-style options, custom text when allowed, Skip, and Submit. It blocks follow-on agent input until resolved.
6. The composer remains at the bottom, becomes disabled while a question is open, and returns to ready once the answer has been sent.

The visual vocabulary follows the supplied reference: restrained dark panels, teal selection states, sparse icons, generous vertical rhythm, and no simulated terminal chrome.

## Event Contract

`AgentRuntimeEvent` becomes a display-neutral union:

```ts
type AgentRuntimeEvent =
  | { kind: 'message'; markdown: string }
  | { kind: 'activity'; label: string; durationMs?: number }
  | { kind: 'command'; command: string; cwd: string; output?: string; exitCode?: number | null }
  | { kind: 'question'; id: string; prompt: string; choices: AgentQuestionChoice[]; allowCustom: boolean }
  | { kind: 'question_answered'; questionId: string; answer: string; skipped: boolean }
  | { kind: 'ready' }
  | { kind: 'error'; message: string; rawOutputRef?: string }
  | { kind: 'status'; status: AgentSessionStatus }
  | { kind: 'diagnostic'; rawOutputRef: string }
```

The renderer receives only this normalized contract. Provider adapters own parsing, ANSI removal, and provider-specific patterns.

## Provider Normalization

The current interactive Claude PTY is a compatibility adapter. It must:

- remove terminal control sequences before classification;
- accumulate a bounded recent-output buffer;
- recognize workspace trust prompts with the existing Claude permission parser;
- emit a `question` event with two explicit choices instead of forwarding the prompt as a message;
- route the chosen answer back to the PTY;
- emit plain text as a `message` event only when no structured pattern is recognised.

Codex starts with the same safe compatibility path. Provider-native JSON/JSONL modes can later replace the compatibility parser without changing the UI or transcript reducer.

## State and Safety

- Only one unresolved question may exist per runtime session.
- Question submission is idempotent by question ID.
- A skipped question sends an explicit provider-compatible cancellation input only when the adapter declares one; otherwise it leaves the session awaiting input and reports that limitation.
- User access-mode selection remains visibly advisory until the active adapter reports enforced permission support.
- Raw output is retained only in diagnostics, never rendered as the assistant response.

## Component Boundaries

- `agentTranscript.ts`: pure event-to-row reducer and answer state.
- `AgentTimeline.tsx`: selects the right visual row component.
- `AgentQuestionCard.tsx`: controlled selection/custom-response form.
- `AgentCommandCard.tsx`: expandable command evidence.
- `AgentStudioPane.tsx`: listener lifecycle, provider writes, composer state, and orchestration.
- `agent_runtime_manager.rs`: provider adapters emit typed events instead of undifferentiated text where a pattern is known.

## Tests

- opening the pane does not start a provider;
- timeline reducer preserves order, removes duplicates, and coalesces adjacent messages;
- recognized Claude trust text produces a question event and no assistant terminal row;
- selecting and submitting a question writes the expected provider input once;
- command cards start collapsed and reveal normalized output;
- composer is disabled while a question is unresolved;
- existing context, provider-selection, and event-listener-before-start behavior remain covered.

## Acceptance Criteria

- No ANSI/control bytes or terminal frames are displayed in Agent Studio messages.
- A fresh pane remains a clean start page until a user sends a prompt.
- A recognized provider permission prompt appears as a structured, selectable question card.
- The timeline can represent thought/activity, command, message, question, answer, error, and status independently.
- The UI remains useful when a provider only exposes raw PTY output: unknown output is normalized to readable message text, not displayed as a terminal screen.
