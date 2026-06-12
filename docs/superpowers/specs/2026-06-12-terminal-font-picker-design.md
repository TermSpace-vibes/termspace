# Terminal Font Picker — Design Spec

**Date:** 2026-06-12  
**Status:** Approved

## Summary

Expand the terminal font selector in Settings → Appearance from 3 hard-coded presets to 10 curated presets plus a "Custom…" option that reveals a free-text CSS font-family input.

## Scope

Single file change: `src/components/SettingsModal/SettingsModal.tsx`.  
No changes to `types/index.ts`, `NativeTerminalPane.tsx`, `useTerminalWorker.ts`, or any Rust code.

## Preset List

| Label | CSS value stored in Settings |
|---|---|
| JetBrains Mono (Default) | `"JetBrains Mono", "Fira Code", Menlo, monospace` |
| Fira Code | `"Fira Code", Menlo, Monaco, monospace` |
| Cascadia Code | `"Cascadia Code", "Fira Code", monospace` |
| Source Code Pro | `"Source Code Pro", Menlo, monospace` |
| Hack | `"Hack", "Fira Code", monospace` |
| Geist Mono | `"Geist Mono", "JetBrains Mono", monospace` |
| Monaspace Neon | `"Monaspace Neon", "JetBrains Mono", monospace` |
| IBM Plex Mono | `"IBM Plex Mono", Menlo, monospace` |
| SF Mono | `"SF Mono", Menlo, monospace` |
| System Monospace | `Menlo, Monaco, "Courier New", monospace` |
| Custom… | *(sentinel — not saved)* |

## State

Three pieces of local state inside `SettingsModal`, scoped to the font control:

```ts
const PRESET_FONTS: { label: string; value: string }[] = [ /* table above */ ]
const CUSTOM_SENTINEL = '__custom__'

// Derived on mount from settings.terminalFontFamily:
//   if value matches a preset → that preset is selected, isCustomFont = false
//   if value doesn't match any preset → isCustomFont = true, customFontInput = stored value
const [terminalFontFamily, setTerminalFontFamily] = useState(...)
const [isCustomFont, setIsCustomFont] = useState(false)
const [customFontInput, setCustomFontInput] = useState('')
```

`terminalFontFamily` always holds the resolved CSS string passed to `handleSave`. It is never set to `CUSTOM_SENTINEL`.

## Behaviour

### On load
```
storedValue = settings.terminalFontFamily ?? PRESET_FONTS[0].value
if PRESET_FONTS has an entry matching storedValue:
    terminalFontFamily = storedValue
    isCustomFont = false
else:
    terminalFontFamily = storedValue
    isCustomFont = true
    customFontInput = storedValue
```

### Dropdown onChange
```
if selected value === CUSTOM_SENTINEL:
    isCustomFont = true
    terminalFontFamily = customFontInput (existing text, or '' initially)
else:
    isCustomFont = false
    terminalFontFamily = selected preset value
```

### Custom text input onChange
```
customFontInput = e.target.value
terminalFontFamily = e.target.value   // kept in sync
```

### On save
`handleSave` passes `terminalFontFamily` as-is — no change to the save call.

## UI

The "Terminal/Editor Font" section in the Appearance grid becomes:

```
[ Dropdown: preset list + "Custom…" at bottom        ▼ ]
[ Text input (only rendered when isCustomFont=true)    ]  ← placeholder: e.g. "Comic Code", monospace
```

The text input uses the same style as the existing number inputs in the grid (matching padding, border, border-radius, color tokens). No new design tokens needed.

## What Doesn't Change

- `Settings` type — `terminalFontFamily?: string` already exists
- `NativeTerminalPane` — reads `settings.terminalFontFamily` unchanged
- `useTerminalWorker` / `WebGLRenderer` / Rust backend — font string flows through as today
- `handleSave()` signature — no change
