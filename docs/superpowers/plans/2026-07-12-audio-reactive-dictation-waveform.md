# Audio-Reactive Dictation Waveform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dictation button's listening waveform bars reflect real microphone loudness instead of looping through a fixed, canned animation.

**Architecture:** `useDictation.ts` already computes real 7-band volume levels (0-1, ~15Hz) via `AnalyserNode.getByteFrequencyData` and exposes them through an unused `onAudioLevels` callback prop. Wire that callback through two paths into `DictationButton`'s bar rendering: (1) directly, for the local terminal-dictation `useDictation` call the button already owns, and (2) via a dedicated `window` `CustomEvent`, for the separate `useDictation` instance inside `useGlobalTranscription` (used for the global hotkey/tray flow), since that hook has no direct React relationship to `DictationButton`. A `settings.globalDictationEnabled` gate — the same flag the button already uses to choose which dictation session it displays — ensures only one of the two sources writes to the bars at a time.

**Tech Stack:** React 18, TypeScript, Framer Motion, Vitest + Testing Library.

## Global Constraints

- No Rust/tray changes — `set_tray_dictation_state` only swaps a static icon, never renders this waveform.
- No changes to `useDictation.ts`'s `AnalyserNode` setup, band math, normalization, or update interval — it already does exactly what's needed.
- Scope is volume/loudness only, not pitch/fundamental-frequency detection.
- Bar values must be clamped to `[0, 1]`; the cross-window event payload must be validated defensively since it crosses a `CustomEvent` boundary (the direct local callback does not need re-validation — `useDictation` already clamps it).
- Local and global audio-level sources must never write to the same `audioLevels` state concurrently — gate both by `settings.globalDictationEnabled`.
- Silent bars must stay at least 4px tall; transitions must be a single 90ms ease-out tween, no infinite looping.

---

### Task 1: Forward audio levels from global dictation as a window event

**Files:**
- Modify: `src/utils/constants.ts`
- Modify: `src/hooks/useGlobalTranscription.ts:1-9` (imports), `:195-211` (add callback + wire into `useDictation`)
- Test: `src/hooks/useGlobalTranscription.test.tsx`

**Interfaces:**
- Consumes: `useDictation`'s existing `onAudioLevels?: (levels: number[]) => void` prop (`src/hooks/useDictation.ts:33`) — already implemented and called with 7 numbers in `[0,1]`, and with 7 zeros on stop.
- Produces: `GLOBAL_DICTATION_AUDIO_LEVELS_EVENT` (exported string constant), dispatched as a `window` `CustomEvent` whose `detail` is `number[]` — this is what Task 3 will listen for.

- [ ] **Step 1: Add the shared event constant**

Read `src/utils/constants.ts` first (it's one line today), then add:

```ts
export const DRAG_FORMAT_TERMINAL = 'application/terminal-id'
export const GLOBAL_DICTATION_AUDIO_LEVELS_EVENT = 'termspace:global-dictation-audio-levels'
```

- [ ] **Step 2: Write the failing test**

Open `src/hooks/useGlobalTranscription.test.tsx`. Update the `useDictation` mock to also capture `onAudioLevels`, and import the new constant:

```ts
import { useGlobalTranscription } from './useGlobalTranscription'
import { useAppStore } from '../store/useAppStore'
import { GLOBAL_DICTATION_AUDIO_LEVELS_EVENT } from '../utils/constants'
```

Add a module-level capture variable next to the existing ones (near line 12):

```ts
let capturedOnStateChange: ((state: { isListening: boolean; isProcessing: boolean }) => void) | null = null
let capturedOnAudioLevels: ((levels: number[]) => void) | null = null
```

Update the mock factory (currently lines 27-45) to capture it:

```ts
vi.mock('./useDictation', () => ({
  useDictation: ({
    onResult,
    onStateChange,
    onAudioLevels,
  }: {
    onResult: (text: string) => void | Promise<void>
    onStateChange?: (state: { isListening: boolean; isProcessing: boolean }) => void
    onAudioLevels?: (levels: number[]) => void
  }) => {
    capturedOnResult = onResult
    capturedOnStateChange = onStateChange ?? null
    capturedOnAudioLevels = onAudioLevels ?? null
    return {
      isListening: dictationMockState.isListening,
      isProcessing: dictationMockState.isProcessing,
      interimTranscript: '',
      toggleListening: toggleListeningMock,
      cancelPendingStart: cancelPendingStartMock,
    }
  },
}))
```

Reset it in `beforeEach` next to the other capture resets (near line 51):

```ts
capturedOnResult = null
capturedOnStateChange = null
capturedOnAudioLevels = null
```

Add the new test at the end of the `describe` block, right after the `'forwards open-dictation-settings...'` test:

```ts
  it('forwards audio levels from global dictation as a window event', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

    renderHook(() => useGlobalTranscription())
    await act(async () => {})

    act(() => {
      capturedOnAudioLevels?.([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7])
    })

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: GLOBAL_DICTATION_AUDIO_LEVELS_EVENT,
        detail: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
      })
    )

    dispatchSpy.mockRestore()
  })
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/hooks/useGlobalTranscription.test.tsx -t "forwards audio levels"`
Expected: FAIL — `capturedOnAudioLevels` is never set because `useGlobalTranscription` doesn't pass `onAudioLevels` yet, so `capturedOnAudioLevels?.(...)` is a no-op and `dispatchSpy` is never called with the expected event.

- [ ] **Step 4: Implement**

In `src/hooks/useGlobalTranscription.ts`, add the import (top of file, alongside the existing `useDictation` import block, lines 6-9):

```ts
import { useAppStore } from '../store/useAppStore'
import { GLOBAL_DICTATION_AUDIO_LEVELS_EVENT } from '../utils/constants'
import {
  useDictation,
  type DictationError,
} from './useDictation'
```

Add a stabilized callback right before the `const dictation = useDictation({...})` call (currently line 205), and pass it in:

```ts
  const handleAudioLevels = useCallback((levels: number[]) => {
    window.dispatchEvent(new CustomEvent(GLOBAL_DICTATION_AUDIO_LEVELS_EVENT, { detail: levels }))
  }, [])

  const dictation = useDictation({
    onResult: handleResult,
    onEmpty: handleEmpty,
    onError: handleError,
    onStateChange: syncTrayDictationState,
    onAudioLevels: handleAudioLevels,
    listenForGlobalToggle: false,
  })
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/hooks/useGlobalTranscription.test.tsx`
Expected: PASS (all tests in the file, including the new one and the pre-existing ones)

- [ ] **Step 6: Commit**

```bash
git add src/utils/constants.ts src/hooks/useGlobalTranscription.ts src/hooks/useGlobalTranscription.test.tsx
git commit -m "feat(dictation): forward global audio levels as a window event"
```

---

### Task 2: Drive the waveform bars from local audio levels

**Files:**
- Modify: `src/components/ui/DictationButton.tsx:1-92` (state, local `useDictation` call, reset effect), `:171-193` (bar rendering)
- Test: `src/components/ui/DictationButton.test.tsx`

**Interfaces:**
- Consumes: `useDictation`'s `onAudioLevels` prop (as in Task 1); `settings.globalDictationEnabled` (already destructured at `DictationButton.tsx:13`); `isListening` (already destructured from `activeDictation` at `DictationButton.tsx:89`).
- Produces: `BAR_MAX_HEIGHTS: readonly number[]` and `EMPTY_AUDIO_LEVELS: readonly number[]` module constants, and `audioLevels` component state — Task 3 also calls `setAudioLevels`.

- [ ] **Step 1: Write the failing tests**

Read `src/components/ui/DictationButton.test.tsx` first. Replace its top section (imports through the `useDictation` mock, currently lines 1-16) with:

```tsx
import React from 'react'
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { DictationButton } from './DictationButton'

let dictationState = {
  isListening: false,
  isProcessing: false,
  interimTranscript: '',
  toggleListening: vi.fn(),
}
let storeState: any
let capturedOnAudioLevels: ((levels: number[]) => void) | null = null

vi.mock('../../hooks/useDictation', () => ({
  useDictation: (props: { onAudioLevels?: (levels: number[]) => void }) => {
    capturedOnAudioLevels = props.onAudioLevels ?? null
    return dictationState
  },
}))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({
      children,
      drag,
      dragMomentum,
      dragConstraints,
      initial,
      onDragStart,
      onDrag,
      onDragEnd,
      whileDrag,
      animate,
      transition,
      ...domProps
    }: any) => <div {...domProps}>{children}</div>,
    span: ({ children, animate, transition, style, ...domProps }: any) => (
      <span {...domProps} style={{ ...style, ...(animate ?? {}) }}>{children}</span>
    ),
  },
}))

vi.mock('../../store/useAppStore', () => ({
  useAppStore: (selector: any) => selector(storeState),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))
```

(This mirrors the framer-motion mock already used in `src/components/SettingsModal/SettingsModal.test.tsx:26-31`; here it also merges each `motion.span`'s `animate` target directly into `style` so bar height/opacity can be asserted synchronously without depending on animation timing.)

Update `beforeEach` (currently lines 27-43) to reset the new capture variable:

```ts
  beforeEach(() => {
    dictationState = {
      isListening: false,
      isProcessing: false,
      interimTranscript: '',
      toggleListening: vi.fn(),
    }
    capturedOnAudioLevels = null
    storeState = {
      activeTerminalId: 'terminal-1',
      addToast: vi.fn(),
      dictationButtonPosition: null,
      setDictationButtonPosition: vi.fn(),
      settings: {
        globalDictationEnabled: false,
      },
    }
  })
```

Add these tests at the end of the `describe` block:

```tsx
  it('reflects local audio levels in the waveform bars', () => {
    dictationState = { ...dictationState, isListening: true }

    render(<DictationButton />)

    act(() => {
      capturedOnAudioLevels?.([1, 0.5, 0, 0.25, 0.75, 1, 0.1])
    })

    const bars = screen.getByTestId('dictation-waveform').querySelectorAll('span')
    expect(bars).toHaveLength(7)
    expect(bars[0]).toHaveStyle({ height: '12px', opacity: '1' })
    expect(bars[2]).toHaveStyle({ height: '4px', opacity: '0.35' })
  })

  it('ignores local audio levels while global dictation mode is active', () => {
    storeState.settings = { ...storeState.settings, globalDictationEnabled: true }

    render(<DictationButton />)

    act(() => {
      window.dispatchEvent(new CustomEvent('termspace:global-dictation-state', {
        detail: { isListening: true, isProcessing: false, interimTranscript: '', toggleListening: vi.fn() },
      }))
    })

    act(() => {
      capturedOnAudioLevels?.([1, 1, 1, 1, 1, 1, 1])
    })

    const bars = screen.getByTestId('dictation-waveform').querySelectorAll('span')
    bars.forEach((bar) => expect(bar).toHaveStyle({ height: '4px' }))
  })

  it('resets stale audio levels before a new listening session', () => {
    dictationState = { ...dictationState, isListening: true }
    const { rerender } = render(<DictationButton />)

    act(() => {
      capturedOnAudioLevels?.([1, 1, 1, 1, 1, 1, 1])
    })
    expect(screen.getByTestId('dictation-waveform').querySelectorAll('span')[0]).toHaveStyle({ height: '12px' })

    dictationState = { ...dictationState, isListening: false, isProcessing: true }
    rerender(<DictationButton />)

    dictationState = { ...dictationState, isListening: true, isProcessing: false }
    rerender(<DictationButton />)

    const bars = screen.getByTestId('dictation-waveform').querySelectorAll('span')
    expect(bars[0]).toHaveStyle({ height: '4px' })
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/ui/DictationButton.test.tsx`
Expected: FAIL — bars still render the old hardcoded heights/keyframes (no `animate` height matching `maxHeight * level`), and `capturedOnAudioLevels` is never populated since `onAudioLevels` isn't passed to `useDictation` yet.

- [ ] **Step 3: Implement**

In `src/components/ui/DictationButton.tsx`, add the import and module constants right after the existing imports (before the component, i.e. after current line 6):

```tsx
import { GLOBAL_DICTATION_AUDIO_LEVELS_EVENT } from '../../utils/constants';

const BAR_MAX_HEIGHTS = [12, 24, 16, 30, 20, 26, 14] as const;
const EMPTY_AUDIO_LEVELS = [0, 0, 0, 0, 0, 0, 0] as const;
```

Add state right after the existing `globalDictationState` state (after current lines 19-24):

```tsx
  const [audioLevels, setAudioLevels] = React.useState<number[]>(() => [...EMPTY_AUDIO_LEVELS]);
```

Update the local `useDictation` call (currently lines 75-79) to add `onAudioLevels`, gated by `settings.globalDictationEnabled`:

```tsx
  const terminalDictation = useDictation({
    onResult: handleResult,
    onError: handleError,
    listenForGlobalToggle: !settings.globalDictationEnabled,
    onAudioLevels: (levels) => {
      if (!settings.globalDictationEnabled) setAudioLevels(levels);
    },
  });
```

After `const isActive = isListening || isProcessing;` (currently line 90), add the reset effect and remove the old `waveformBars` constant (currently line 92):

```tsx
  const isActive = isListening || isProcessing;
  const statusText = isProcessing ? 'Processing transcription...' : interimTranscript;

  React.useEffect(() => {
    if (!isListening) setAudioLevels([...EMPTY_AUDIO_LEVELS]);
  }, [isListening]);
```

Replace the bar-rendering block (currently lines 171-193, the `waveformBars.map(...)`) with:

```tsx
            {BAR_MAX_HEIGHTS.map((maxHeight, index) => {
              const level = audioLevels[index] ?? 0;
              return (
                <motion.span
                  key={index}
                  aria-hidden="true"
                  animate={{
                    height: Math.max(4, maxHeight * level),
                    opacity: 0.35 + 0.65 * level,
                  }}
                  transition={{ duration: 0.09, ease: 'easeOut' }}
                  style={{
                    width: 3,
                    borderRadius: 999,
                    background: 'currentColor',
                    boxShadow: '0 0 8px color-mix(in srgb, var(--accent) 65%, transparent)',
                  }}
                />
              );
            })}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/ui/DictationButton.test.tsx`
Expected: PASS (all tests, including the 3 pre-existing ones and the 3 new ones)

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/DictationButton.tsx src/components/ui/DictationButton.test.tsx
git commit -m "feat(dictation): drive waveform bars from local audio levels"
```

---

### Task 3: Apply global audio-level events to the waveform

**Files:**
- Modify: `src/components/ui/DictationButton.tsx` (add a `window` event listener effect)
- Test: `src/components/ui/DictationButton.test.tsx`

**Interfaces:**
- Consumes: `GLOBAL_DICTATION_AUDIO_LEVELS_EVENT` (from Task 1); `setAudioLevels`, `BAR_MAX_HEIGHTS`, `settings.globalDictationEnabled` (from Task 2).
- Produces: nothing new for later tasks — this is the last piece of the feature.

- [ ] **Step 1: Write the failing tests**

Add to `src/components/ui/DictationButton.test.tsx`. First add the constant import at the top (alongside the other imports):

```ts
import { GLOBAL_DICTATION_AUDIO_LEVELS_EVENT } from '../../utils/constants'
```

Add these tests at the end of the `describe` block:

```tsx
  it('applies valid global audio-level events while in global dictation mode', () => {
    storeState.settings = { ...storeState.settings, globalDictationEnabled: true }
    render(<DictationButton />)

    act(() => {
      window.dispatchEvent(new CustomEvent('termspace:global-dictation-state', {
        detail: { isListening: true, isProcessing: false, interimTranscript: '', toggleListening: vi.fn() },
      }))
    })

    act(() => {
      window.dispatchEvent(new CustomEvent(GLOBAL_DICTATION_AUDIO_LEVELS_EVENT, {
        detail: [1, 0.5, 0, 0.25, 0.75, 1, 0.1],
      }))
    })

    const bars = screen.getByTestId('dictation-waveform').querySelectorAll('span')
    expect(bars[0]).toHaveStyle({ height: '12px' })
  })

  it('ignores global audio-level events while in local dictation mode', () => {
    dictationState = { ...dictationState, isListening: true }
    render(<DictationButton />)

    act(() => {
      window.dispatchEvent(new CustomEvent(GLOBAL_DICTATION_AUDIO_LEVELS_EVENT, {
        detail: [1, 1, 1, 1, 1, 1, 1],
      }))
    })

    const bars = screen.getByTestId('dictation-waveform').querySelectorAll('span')
    bars.forEach((bar) => expect(bar).toHaveStyle({ height: '4px' }))
  })

  it('ignores malformed global audio-level payloads', () => {
    storeState.settings = { ...storeState.settings, globalDictationEnabled: true }
    render(<DictationButton />)

    act(() => {
      window.dispatchEvent(new CustomEvent('termspace:global-dictation-state', {
        detail: { isListening: true, isProcessing: false, interimTranscript: '', toggleListening: vi.fn() },
      }))
    })

    for (const payload of [null, 'not-an-array', [Number.NaN, -1, 4]]) {
      expect(() => {
        act(() => {
          window.dispatchEvent(new CustomEvent(GLOBAL_DICTATION_AUDIO_LEVELS_EVENT, { detail: payload }))
        })
      }).not.toThrow()
    }

    const bars = screen.getByTestId('dictation-waveform').querySelectorAll('span')
    expect(bars[0]).toHaveStyle({ height: '4px' })
  })

  it('removes the global audio-level listener on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')

    const { unmount } = render(<DictationButton />)
    unmount()

    expect(removeSpy).toHaveBeenCalledWith(GLOBAL_DICTATION_AUDIO_LEVELS_EVENT, expect.any(Function))

    removeSpy.mockRestore()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/ui/DictationButton.test.tsx`
Expected: FAIL — dispatching `GLOBAL_DICTATION_AUDIO_LEVELS_EVENT` currently does nothing, so the first test's bars stay at the 4px floor instead of reflecting `[1, 0.5, 0, ...]`, and the unmount test finds no matching `removeEventListener` call.

- [ ] **Step 3: Implement**

In `src/components/ui/DictationButton.tsx`, add this effect right after the reset effect added in Task 2:

```tsx
  React.useEffect(() => {
    const handleGlobalAudioLevels = (event: Event) => {
      if (!settings.globalDictationEnabled) return;
      const detail = (event as CustomEvent<unknown>).detail;
      if (!Array.isArray(detail)) return;
      setAudioLevels(
        Array.from({ length: BAR_MAX_HEIGHTS.length }, (_, index) => {
          const value = Number(detail[index] ?? 0);
          return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
        })
      );
    };
    window.addEventListener(GLOBAL_DICTATION_AUDIO_LEVELS_EVENT, handleGlobalAudioLevels);
    return () => window.removeEventListener(GLOBAL_DICTATION_AUDIO_LEVELS_EVENT, handleGlobalAudioLevels);
  }, [settings.globalDictationEnabled]);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/ui/DictationButton.test.tsx`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Run the full frontend test suite**

Run: `npx vitest run`
Expected: PASS — no regressions in unrelated suites.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/DictationButton.tsx src/components/ui/DictationButton.test.tsx
git commit -m "feat(dictation): apply global audio-level events to the waveform"
```

---

### Task 4: Manual verification

**Files:** none (manual QA pass, no code changes)

- [ ] **Step 1: Run the app**

Run: `npm run dev` (or the project's usual `run` flow) and open the app.

- [ ] **Step 2: Verify local terminal dictation**

Click the dictation button to start listening. Confirm:
- Bars sit near their 4px floor in silence.
- Bars visibly rise with louder speech and fall with quieter speech.
- Stopping dictation replaces the waveform with the processing spinner / idle icon, with no lingering bar heights.

- [ ] **Step 3: Verify global dictation**

In Settings, enable global dictation. Trigger it via the configured hotkey or tray icon. Confirm:
- The same in-app button waveform reacts to microphone loudness.
- Starting a new global session doesn't briefly flash the previous session's bar heights.

- [ ] **Step 4: Confirm no regressions**

Confirm terminal/browser media, tray lifecycle icons, transcription accuracy, and mic cleanup all behave as before this change.

- [ ] **Step 5: Report results to the user**

Summarize what was verified and any issues found. Do not commit anything in this task — it's verification only.
