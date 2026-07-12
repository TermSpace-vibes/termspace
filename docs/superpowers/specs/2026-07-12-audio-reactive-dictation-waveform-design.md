# Audio-reactive dictation waveform

## Problem

The dictation button's "listening" waveform (`DictationButton.tsx:92,171-193`) is a
fixed 7-bar array (`[12, 24, 16, 30, 20, 26, 14]`) animated by an infinite-loop
framer-motion keyframe sequence. It never reads real audio — it looks the same
whether the user is silent or shouting.

`useDictation.ts` already computes real audio levels: `startLevelMeter`
(lines 101-127) reads `AnalyserNode.getByteFrequencyData` into 7 frequency
bands, ~15 times/sec (66ms interval), normalized to 0-1, and calls an
`onAudioLevels` callback. That callback is declared on the hook's props
(line 33) but no caller ever passes it in, so the real data is computed and
discarded every frame.

Scope: react to **volume/loudness**, not true pitch (fundamental frequency).
True pitch detection does not exist anywhere in the codebase and would
require new autocorrelation-based DSP; volume data already exists and maps
directly onto the 7 existing bars. Apply this everywhere the waveform bars
render — both the local terminal-dictation path and the global/tray
dictation path (both feed the same `DictationButton` UI).

## Design

### 1. `DictationButton.tsx`

- Add `const [audioLevels, setAudioLevels] = useState<number[]>(() => new Array(7).fill(0))`.
- Pass `onAudioLevels: setAudioLevels` into the existing local `useDictation({...})` call (line 75).
- Add a `useEffect` that listens for a new `window` event,
  `termspace:global-dictation-audio-levels`, and applies `event.detail` to the
  same `audioLevels` state — this covers the global-dictation-mode case (see
  below).
- Keep `barMaxHeights = [12, 24, 16, 30, 20, 26, 14]` as a constant (renamed
  from `waveformBars`) — each value is now an amplitude ceiling rather than a
  fixed height.
- Replace each bar's `animate={{ height: [...], opacity: [...] }}` keyframe
  array + `transition={{ repeat: Infinity, ... }}` with a single live target:
  ```
  animate={{
    height: Math.max(4, barMaxHeights[index] * (audioLevels[index] ?? 0)),
    opacity: 0.35 + 0.65 * (audioLevels[index] ?? 0),
  }}
  transition={{ duration: 0.09, ease: 'easeOut' }}
  ```
  The short tween eases between the ~66ms level updates instead of snapping,
  giving a smooth live waveform. A height floor of 4px keeps bars visible
  during silence instead of collapsing to nothing.
- No change to the processing spinner or idle icon.

### 2. `useGlobalTranscription.ts`

- Its own internal `useDictation({...})` call (line 205, used for the
  tray/global-hotkey dictation flow) gets `onAudioLevels` added:
  ```
  onAudioLevels: (levels) => window.dispatchEvent(
    new CustomEvent('termspace:global-dictation-audio-levels', { detail: levels })
  )
  ```
- This is a separate, lightweight event rather than folding levels into the
  existing `termspace:global-dictation-state` broadcast (line 298-302),
  because that broadcast already re-fires on every state object change and
  folding in 15Hz level updates would multiply that further for no benefit —
  only `DictationButton` needs the raw levels, so it gets its own event.

### 3. Out of scope

- No Rust/tray changes. The native tray icon (`set_tray_dictation_state`)
  only swaps a static icon per lifecycle state (listening/processing/idle) —
  there's no waveform rendered there to make reactive.
- No changes to `startLevelMeter`/`AnalyserNode` setup in `useDictation.ts` —
  the level computation already does what's needed (7 bands, 0-1 normalized,
  resets to zeros on stop via `stopLevelMeter` line 92-99).

## Testing

- `DictationButton.test.tsx` currently only asserts
  `getByTestId('dictation-waveform')` is present (line 54) — it mocks
  `useDictation` and does not assert on specific bar heights, so it is
  unaffected by this change.
- Manual verification: run the app, start dictation, confirm bars visibly
  rise and fall with actual speaking volume (both via the in-app button in
  terminal-dictation mode, and via the global hotkey/tray flow if
  `globalDictationEnabled` is on).
