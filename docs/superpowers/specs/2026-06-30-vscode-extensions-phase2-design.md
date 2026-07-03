# VS Code Extension Host — Phase 2 Design

## Goal

Enable VS Code extensions to run in Termspace's Monaco editor by adding extension host support via `ExtensionHostKind.LocalProcess` (main thread, no Web Worker) and VSIX loading capability.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      Main Thread                             │
│                                                              │
│  EditorPane.tsx                                              │
│    └─ awaits initializeExtensions() → gates render           │
│                                                              │
│  setup.ts (side-effect + initializeExtensions export)        │
│    ├─ import 'vscode/localExtensionHost' (registers kind)    │
│    ├─ useWorkerFactory({...})  (textmate/language workers)   │
│    ├─ initialize({...serviceOverrides})                      │
│    └─ loader.config({ monaco })  (same instance!)            │
│                                                              │
│  extensions.ts                                               │
│    └─ registerExtension(manifest, LocalProcess) → activate() │
│                                                              │
│  @monaco-editor/react ──(loader)──► @codingame editor-api    │
│       (monaco-editor is aliased to editor-api, EXACT match)  │
└──────────────────────────────────────────────────────────────┘
Extensions run IN-PROCESS (main thread) via ExtensionHostKind.LocalProcess.
No Web Worker / iframe is used for the extension host (avoids Tauri CORS/CSP issues).
TextMate tokenization and language detection still use background workers via useWorkerFactory.
```

## Key Components

### 1. Async Initialization (`initializeExtensions()`)

`setup.ts` exports an `initializeExtensions()` function that:
1. Configures Web Workers for textmate tokenization + language detection via `useWorkerFactory()`
2. Calls `initialize({...serviceOverrides})` with the full interdependent service set
3. Configures `@monaco-editor/react`'s `loader` to use the same `monaco-editor` instance
4. Is idempotent — subsequent calls return a cached promise (handles React StrictMode double-invoke)

**Render-gating:** `EditorPane.tsx` awaits this promise before rendering `<Editor>`. Fail-open on error (editor renders without extensions).

**The monaco-editor alias is REQUIRED:** `monaco-editor` in npm must resolve to `@codingame/monaco-vscode-editor-api` at the same version. Without this, `loader.config({ monaco })` and VS Code services bind to different instances.

**Worker wiring via useWorkerFactory:**
```ts
import { useWorkerFactory } from '@codingame/monaco-vscode-api/workers'

function configureWorkers() {
  useWorkerFactory({
    workerLoaders: {
      TextEditorWorker: () =>
        new Worker(new URL('@codingame/monaco-vscode-editor-api/esm/vs/editor/editor.worker.js', import.meta.url), { type: 'module' }),
      TextMateWorker: () =>
        new Worker(new URL('@codingame/monaco-vscode-textmate-service-override/worker', import.meta.url), { type: 'module' }),
    },
  })
}
```

This replaces the standalone `window.MonacoEnvironment` configuration. `vite-plugin-monaco-editor` is NOT used — it conflicts with the `useWorkerFactory` mechanism and doesn't support the custom worker IDs (`TextMateWorker`) that the @codingame service overrides need.

### 2. Full Service Override Chain

The extensions service cannot be enabled in isolation. All overrides are passed to a single `initialize()` call:

```ts
import getExtensionServiceOverride from '@codingame/monaco-vscode-extensions-service-override'
import getLanguagesServiceOverride from '@codingame/monaco-vscode-languages-service-override'
import getModelServiceOverride from '@codingame/monaco-vscode-model-service-override'
import getConfigurationServiceOverride from '@codingame/monaco-vscode-configuration-service-override'
import getFilesServiceOverride from '@codingame/monaco-vscode-files-service-override'
import getTextmateServiceOverride from '@codingame/monaco-vscode-textmate-service-override'
import getThemeServiceOverride from '@codingame/monaco-vscode-theme-service-override'
import getLanguageDetectionServiceOverride from '@codingame/monaco-vscode-language-detection-worker-service-override'

await initialize({
  ...getExtensionServiceOverride(),
  ...getLanguagesServiceOverride(),
  ...getModelServiceOverride(),
  ...getConfigurationServiceOverride(),
  ...getFilesServiceOverride(),
  ...getTextmateServiceOverride(),
  ...getThemeServiceOverride(),
  ...getLanguageDetectionServiceOverride(),
})
```

The `vscode/localExtensionHost` import (side-effect) is placed alongside this setup (NOT scattered in EditorPane).

### 3. Extension Registry (`src/vscode-extensions/extensions.ts`)

New module providing:
- `registerLocalExtension(manifest, entryPointUrl?)` — register an extension by manifest. Idempotent: disposes previous if same ID re-registered (handles HMR/StrictMode). Wraps registration in try/catch, fails open.
- `getExtensionApi(id)` — get the `vscode` API for a registered extension
- `loadVsixExtension(vsixModule)` — loads a VSIX file. The signature matches the Vite rollup plugin's output: the plugin returns `{ manifest, files }` where `files` is a `Record<string, string>` of resource URLs. After registration, ALL contributed resource files (grammars, themes, icons) must be registered via `registerFileUrl()`, not just `manifest.main`.
- `getInstalledExtensions()` — list registered extension IDs
- `disposeAllExtensions()` — clean teardown (for HMR dev and pane unmount). Duplicate registration attempts auto-dispose the old one.

**Error handling:**
| Failure | Behavior |
|---------|----------|
| `initialize()` rejects | Editor loads without extensions (fail open) |
| `registerExtension()` throws | Logs error, continues without that extension |
| Extension `activate()` throws | Logs error, extension disabled for session |
| `loadVsixExtension()` fails | Logs error, returns null |
| Worker factory fails | Falls back — textmate/tokenization may degrade |

### 4. Default Extension Packages (explicit imports required)

These are NOT bundled for free — each must be explicitly imported as a side-effect module:

```
@codingame/monaco-vscode-typescript-language-features-default-extension
@codingame/monaco-vscode-typescript-basics-default-extension
@codingame/monaco-vscode-javascript-default-extension
@codingame/monaco-vscode-json-default-extension
@codingame/monaco-vscode-json-language-features-default-extension
@codingame/monaco-vscode-css-default-extension
@codingame/monaco-vscode-css-language-features-default-extension
@codingame/monaco-vscode-html-default-extension
@codingame/monaco-vscode-html-language-features-default-extension
@codingame/monaco-vscode-markdown-basics-default-extension
@codingame/monaco-vscode-markdown-language-features-default-extension
@codingame/monaco-vscode-theme-defaults-default-extension
```

Imported in `src/vscode-extensions/default-extensions.ts` and loaded from `setup.ts`.

### 5. VSIX Vite Plugin

`@codingame/monaco-vscode-rollup-vsix-plugin` added to `vite.config.ts`. Handles:
- Inlining VSIX content during build
- Serving VSIX files in dev mode
- Producing `{ manifest, files }` on import for direct use with `loadVsixExtension()`

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `package.json` | Modify | Add deps (pinned); convert existing `^` ranges to exact |
| `.npmrc` | *Skip* | `save-exact=true` won't fix already-installed — handled in package.json step |
| `vite.config.ts` | Modify | Add VSIX plugin + `monaco-editor` alias + `optimizeDeps.exclude`; **remove** `vite-plugin-monaco-editor` |
| `src/vscode-extensions/setup.ts` | Rewrite | Export `initializeExtensions()` with full service overrides + useWorkerFactory |
| `src/vscode-extensions/extensions.ts` | Create | Extension registry with error handling + disposal |
| `src/vscode-extensions/default-extensions.ts` | Create | Side-effect imports for built-in extensions |
| `src/components/EditorPane.tsx` | Modify | Gate render on `initializeExtensions()` promise (fail open) |
| `src-tauri/tauri.conf.json` | Audit | Set CSP: `worker-src 'self' blob:`, `script-src 'self' 'wasm-unsafe-eval'` for onigasm WASM |

## Dependencies

**Lockstep group (all pinned to exact 18.4.0 — no `^`):**
- `@codingame/monaco-vscode-api@18.4.0`
- `@codingame/monaco-vscode-editor-api@18.4.0` (as `monaco-editor` alias target)
- `@codingame/monaco-vscode-extensions-service-override@18.4.0`
- `@codingame/monaco-vscode-languages-service-override@18.4.0`
- `@codingame/monaco-vscode-model-service-override@18.4.0`
- `@codingame/monaco-vscode-configuration-service-override@18.4.0`
- `@codingame/monaco-vscode-files-service-override@18.4.0`
- `@codingame/monaco-vscode-textmate-service-override@18.4.0`
- `@codingame/monaco-vscode-theme-service-override@18.4.0`
- `@codingame/monaco-vscode-language-detection-worker-service-override@18.4.0`
- All default-extension packages (all @18.4.0)

**Independent (versioned separately, compatible with 18.x):**
- `@codingame/monaco-vscode-rollup-vsix-plugin@18.4.0`
- `@types/vscode` (use version matching the VS Code commit that 18.4.0 is based on)

**Already installed (may need removal or version bump):**
- `vite-plugin-monaco-editor@1.1.0` → **REMOVE** (conflicts with useWorkerFactory)

**Critical rule:** The lockstep group (API + service-override + editor-api + default-extensions) must all share the exact same version. Mismatches between these are the #1 cause of cryptic runtime failures. The rollup plugin and @types/vscode are NOT in the lockstep group.

**API shape note:** The `registerExtension()` return shape differs across 18.x minors — specifically whether `whenReady` and `getApi` are both present, or just `getApi`. Verify against the installed version during setup.

## CSP (tauri.conf.json)

Target directives for the security policy:
```json
"security": {
  "csp": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' asset: data:; font-src 'self' data:"
}
```

The `worker-src 'self' blob:` is needed for the textmate worker (loaded via `new Worker(new URL(...), { type: 'module' })`). The `script-src 'wasm-unsafe-eval'` is needed for onigasm WASM that the textmate grammar engine uses. Both are required even with `ExtensionHostKind.LocalProcess` because the textmate/theme service overrides use their own workers.

## Not in Scope (Phase 3)

- Extensions marketplace (Open VSX Registry integration)
- Extensions management UI (sidebar, enable/disable)
- User-installed extension persistence across sessions
- Dedicated extension settings editor
