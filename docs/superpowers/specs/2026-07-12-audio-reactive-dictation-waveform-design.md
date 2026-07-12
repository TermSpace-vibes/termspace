# Audio-reactive dictation waveform

## Problem

The dictation button's "listening" waveform (`DictationButton.tsx:92,171-193`) is a
fixed 7-bar array (`[12, 24, 16, 30, 20, 26, 14]`) animated by an infinite-loop
framer-motion keyframe sequence. It never reads real audio — it looks the same
whether the user is silent or shouting.

`useDictation.ts` already computes real audio levels: `startLevelMeter`
(lines 101-127) reads `AnalyserNode.getByteFrequencyData` into 7 frequency
bands, ~15 times/sec (66ms interval), normalized to 0-1, and calls an
`onAudioLevels` callback. `stopLevelMeter` (lines 92-99) calls that same
callback with 7 zeros when the meter stops. The callback is declared on the
hook's props (line 33) but no caller ever passes it in, so the real data is
computed and discarded every frame.

Scope: react to **volume/loudness**, not true pitch (fundamental frequency).
True pitch detection does not exist anywhere in the codebase and would
require new autocorrelation-based DSP; volume data already exists and maps
directly onto the 7 existing bars. Apply this everywhere the waveform bars
render — both the local terminal-dictation path and the global/tray
dictation path (both feed the same `DictationButton` UI).

No Rust or native tray changes are required — `set_tray_dictation_state`
only swaps a static icon per lifecycle state and doesn't render this
waveform.

## Source ownership (why this matters)

`DictationButton` always mounts its own local `useDictation` call (line 75)
*regardless* of `settings.globalDictationEnabled` — it just doesn't display
that state when global mode is active (`activeDictation` picks between
`terminalDictation` and `globalDictationState`, lines 86-89). That means both
a local level stream and a global event stream can exist at the same time,
and without gating, the last one to fire would win arbitrarily and cause
flicker.

The existing mode flag `settings.globalDictationEnabled` is the single
source of truth for which stream should currently own the bars — the same
flag `activeDictation` already uses. Both the local callback and the global
event handler must check it before calling `setAudioLevels`, rather than
inventing a second notion of "mode."

## Design

### 1. Shared event constant

No shared constants module exists today for the other `termspace:*` window
events (they're inline string literals in `App.tsx`, `DictationButton.tsx`,
`useGlobalTranscription.ts`, `useGlobalKeybindings.ts`). This one is worth
extracting since a typo between the two new call sites would silently break
the waveform with no error. Add to `src/utils/constants.ts` (currently just
holds `DRAG_FORMAT_TERMINAL`):

```ts
export const GLOBAL_DICTATION_AUDIO_LEVELS_EVENT = 'termspace:global-dictation-audio-levels'
```

Both `DictationButton.tsx` and `useGlobalTranscription.ts` import this
instead of writing the string literal.

### 2. `DictationButton.tsx`

**Constants** (module scope, not re-created per render):

```ts
const BAR_MAX_HEIGHTS = [12, 24, 16, 30, 20, 26, 14] as const
const EMPTY_AUDIO_LEVELS = [0, 0, 0, 0, 0, 0, 0] as const
```

**State:**

```ts
const [audioLevels, setAudioLevels] = useState<number[]>(() => [...EMPTY_AUDIO_LEVELS])
```

**Local levels**, gated by the existing mode flag:

```ts
const terminalDictation = useDictation({
  onResult: handleResult,
  onError: handleError,
  listenForGlobalToggle: !settings.globalDictationEnabled,
  onAudioLevels: (levels) => {
    if (!settings.globalDictationEnabled) setAudioLevels(levels)
  },
})
```

(`useDictation`'s own levels are already clamped to 0-1 in `startLevelMeter`,
so no extra validation is needed on this path — only the cross-process
event path below needs it.)

**Global levels**, via a `window` listener, gated the same way, with
payload validation since this data crosses a `CustomEvent` boundary and
shouldn't be trusted blindly:

```ts
useEffect(() => {
  const handleGlobalAudioLevels = (event: Event) => {
    if (!settings.globalDictationEnabled) return
    const detail = (event as CustomEvent<unknown>).detail
    if (!Array.isArray(detail)) return
    setAudioLevels(
      Array.from({ length: BAR_MAX_HEIGHTS.length }, (_, i) => {
        const value = Number(detail[i] ?? 0)
        return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
      })
    )
  }
  window.addEventListener(GLOBAL_DICTATION_AUDIO_LEVELS_EVENT, handleGlobalAudioLevels)
  return () => window.removeEventListener(GLOBAL_DICTATION_AUDIO_LEVELS_EVENT, handleGlobalAudioLevels)
}, [settings.globalDictationEnabled])
```

**Lifecycle reset** — belt-and-suspenders alongside the hook's own
zero-reset, in case the global path stops dispatching (unmount, mode
toggle mid-session) before a zero reaches this component. Use the existing
`isListening` from `activeDictation` rather than inventing a new state enum:

```ts
useEffect(() => {
  if (!isListening) setAudioLevels([...EMPTY_AUDIO_LEVELS])
}, [isListening])
```

**Bar rendering** — replace each bar's infinite keyframe `animate`/`transition`
with a live single target:

```tsx
{BAR_MAX_HEIGHTS.map((maxHeight, index) => {
  const level = audioLevels[index] ?? 0
  return (
    <motion.span
      key={index}
      aria-hidden="true"
      animate={{
        height: Math.max(4, maxHeight * level),
        opacity: 0.35 + 0.65 * level,
      }}
      transition={{ duration: 0.09, ease: 'easeOut' }}
      style={{ /* unchanged */ }}
    />
  )
})}
```

A 4px height floor keeps bars visible during silence rather than
collapsing to nothing. Remove the keyframe arrays, `repeat: Infinity`,
and per-bar `delay` — none of that is needed once bars track real data.

Framer Motion's `useReducedMotion` isn't used anywhere in this codebase
today, and this is a small enough visual change (a 90ms ease on a 4-30px
bar) that adding reduced-motion support here would be new scope beyond
this feature, not a fix to something this change regresses. Skip it for
this pass.

### 3. `useGlobalTranscription.ts`

Add a stabilized callback (so `useDictation`'s effects don't see a new
function identity every render) that forwards levels as the shared event:

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

Do **not** fold levels into the existing `termspace:global-dictation-state`
broadcast (lines 298-302) — that broadcast fires on lifecycle changes, and
that effect's dependency is the whole `dictation` object, so piggybacking
15Hz level data on it would multiply an already-broad re-dispatch for no
benefit. Only `DictationButton` needs the raw stream, so it gets its own
dedicated event.

`stopLevelMeter`'s zero-array call flows through the same
`handleAudioLevels` path automatically, so a session end already forwards
zeros through this event — the reset effect in `DictationButton` is the
backstop for cases where that event doesn't arrive.

### 4. `useDictation.ts`

No behavioral changes. `startLevelMeter`/`stopLevelMeter`, the
`AnalyserNode` config, band math, and 0-1 normalization all stay as-is —
they already do exactly what's needed.

## Testing

- Existing `DictationButton.test.tsx` only asserts
  `getByTestId('dictation-waveform')` is present (line 54) and mocks
  `useDictation` without asserting bar heights — unaffected by this change.
- Add: local `onAudioLevels` callback invocation updates bar `animate`
  targets (capture the mocked callback, call it with known values, assert
  target height/opacity — not intermediate animated pixel values).
- Add: dispatching `GLOBAL_DICTATION_AUDIO_LEVELS_EVENT` while
  `settings.globalDictationEnabled` is true updates all 7 bars.
- Add: dispatching malformed payloads (`null`, `'not-an-array'`,
  `[NaN, -1, 4]`) doesn't throw and normalizes/ignores bad values.
- Add: unmounting the component removes the window listener (no
  post-unmount `setState` warnings when the event fires after unmount).
- Add: toggling `isListening` false resets `audioLevels` to zeros.
- Add: while both local and global `useDictation` instances are mounted,
  only the stream matching `settings.globalDictationEnabled` updates the
  bars (source-ownership gating).

## Manual verification

1. Start local terminal dictation; confirm bars sit at their 4px floor in
   silence, move with quiet/loud speech, and settle back down when you stop
   talking.
2. Stop dictation; confirm the waveform doesn't linger — it's replaced by
   the processing spinner / idle icon with no stale bar heights.
3. Enable global dictation, trigger via hotkey/tray; confirm the same
   button waveform reacts to mic loudness.
4. Start/stop global dictation repeatedly; confirm no flash of a previous
   session's levels at the start of a new one.
5. Confirm terminal/browser media, tray lifecycle icons, transcription, and
   mic cleanup are all unchanged.

## Acceptance criteria

- Listening waveform responds visibly to real microphone loudness.
- 7 bars correspond to the 7 values from `useDictation`.
- Values are clamped to 0-1; malformed global-event payloads can't break it.
- Silent bars stay at least 4px tall.
- Bar changes tween smoothly (90ms ease-out), no infinite looping.
- Local and global level streams never write to `audioLevels` concurrently —
  gated by `settings.globalDictationEnabled`.
- Audio levels reset to zero whenever `isListening` goes false.
- The global window listener is added and removed correctly (no leak).
- Processing spinner and idle icon are unchanged.
- No Rust/tray changes.
- Existing dictation/waveform tests continue to pass.
