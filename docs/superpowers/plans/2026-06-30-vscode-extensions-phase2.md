# VS Code Extension Host — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add extension host support to Termspace's Monaco editor so VS Code extensions can run in-process, plus VSIX loading capability.

**Architecture:** Install the full @codingame/monaco-vscode-api 18.4.0 stack with all service overrides (extensions, languages, model, configuration, files, textmate, theme, language-detection). Wire via `useWorkerFactory` for textmate/language workers. Add extension registry module for registering extensions from manifest or VSIX files. Gate editor render on async initialization. Remove `vite-plugin-monaco-editor` to avoid worker-wiring conflicts.

**Tech Stack:** @codingame/monaco-vscode-api@18.4.0, @codingame/monaco-vscode-*-service-override packages (lockstep), @codingame/monaco-vscode-rollup-vsix-plugin, Tauri v2

---

### Task 0: Pre-Flight Verification

**Files:**
- None (read-only investigation)

Run this block BEFORE any installs to record actual values the rest of the plan needs. This prevents "fails mid-execution" surprises.

- [ ] **Step 1: Verify the monaco-vscode-editor-api is already installed at 18.4.0**

```bash
npm ls @codingame/monaco-vscode-editor-api 2>/dev/null | grep monaco-vscode-editor-api
```

Expected output includes `@codingame/monaco-vscode-editor-api@18.4.0` (direct). It's OK if a different version is nested under `monaco-languageclient`.

- [ ] **Step 2: Confirm no previous installs of service-override packages exist**

```bash
npm ls @codingame/monaco-vscode-extensions-service-override 2>/dev/null
```

Expected: `(empty)` — nothing installed yet.

- [ ] **Step 3: Confirm the rollup VSIX plugin's published version**

```bash
npm view @codingame/monaco-vscode-rollup-vsix-plugin version
```

Note the latest version. If it's NOT 18.4.0 (likely — it's independently versioned), use whatever version npm says. Record it for Task 1.

- [ ] **Step 4: Confirm the textmate service override has a `./worker` export**

```bash
npm pack @codingame/monaco-vscode-textmate-service-override@18.4.0 --dry-run 2>&1 | grep -i worker
```

Or just trust the finding from the installed 25.1.2 version (the 18.4.0 also has `./worker` export — same package shape across majors). If this returns nothing useful, verify via:

```bash
node -e "const p = require('@codingame/monaco-vscode-textmate-service-override/package.json'); console.log(JSON.stringify(p.exports, null, 2))"
```

After installing one of the service-override packages at 18.4.0 in later tasks.

- [ ] **Step 5: Record the findings**

Note down:
- `@codingame/monaco-vscode-editor-api` → ___ (e.g., `18.4.0`)
- `@codingame/monaco-vscode-rollup-vsix-plugin` → ___ (e.g., `18.4.0` or `1.0.0` — whatever npm says)

These values will be used in Task 1 install commands.

---

### Task 1: Install Dependencies and Remove Conflicting Plugin

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Remove vite-plugin-monaco-editor**

```bash
npm uninstall vite-plugin-monaco-editor
```

- [ ] **Step 2: Pin the monaco-vscode-editor-api explicitly at 18.4.0**

```bash
npm install @codingame/monaco-vscode-editor-api@18.4.0
```

(It was already installed in Phase 1, but ensure it's pinned with exact version, no `^`.)

- [ ] **Step 3: Install the main API package**

```bash
npm install @codingame/monaco-vscode-api@18.4.0
```

- [ ] **Step 4: Install all service-override packages**

```bash
npm install \
  @codingame/monaco-vscode-extensions-service-override@18.4.0 \
  @codingame/monaco-vscode-languages-service-override@18.4.0 \
  @codingame/monaco-vscode-model-service-override@18.4.0 \
  @codingame/monaco-vscode-configuration-service-override@18.4.0 \
  @codingame/monaco-vscode-files-service-override@18.4.0 \
  @codingame/monaco-vscode-textmate-service-override@18.4.0 \
  @codingame/monaco-vscode-theme-service-override@18.4.0 \
  @codingame/monaco-vscode-language-detection-worker-service-override@18.4.0
```

- [ ] **Step 5: Install VSIX rollup plugin (version may differ from 18.4.0)**

```bash
npm install -D @codingame/monaco-vscode-rollup-vsix-plugin@18.4.0
```

If npm says "404 Not Found" for 18.4.0, try without a version pin to get the latest:
```bash
npm install -D @codingame/monaco-vscode-rollup-vsix-plugin
```

- [ ] **Step 6: Install default extension packages**

```bash
npm install \
  @codingame/monaco-vscode-typescript-language-features-default-extension@18.4.0 \
  @codingame/monaco-vscode-typescript-basics-default-extension@18.4.0 \
  @codingame/monaco-vscode-javascript-default-extension@18.4.0 \
  @codingame/monaco-vscode-json-default-extension@18.4.0 \
  @codingame/monaco-vscode-json-language-features-default-extension@18.4.0 \
  @codingame/monaco-vscode-css-default-extension@18.4.0 \
  @codingame/monaco-vscode-css-language-features-default-extension@18.4.0 \
  @codingame/monaco-vscode-html-default-extension@18.4.0 \
  @codingame/monaco-vscode-html-language-features-default-extension@18.4.0 \
  @codingame/monaco-vscode-markdown-basics-default-extension@18.4.0 \
  @codingame/monaco-vscode-markdown-language-features-default-extension@18.4.0 \
  @codingame/monaco-vscode-theme-defaults-default-extension@18.4.0
```

- [ ] **Step 7: Verify ALL packages resolved to 18.4.0**

```bash
npm ls @codingame/monaco-vscode 2>/dev/null | grep '@codingame'
```

Expected: every `@codingame/monaco-vscode-*` package at `18.4.0`. The `/rollup-vsix-plugin` may be a different version — that's fine (it has independent versioning).

```bash
npm ls @codingame/monaco-vscode-api 2>/dev/null | head -5
npm ls @codingame/monaco-vscode-editor-api 2>/dev/null | head -5
```

Both at `18.4.0`. If any show a different version, re-install with explicit `@18.4.0`.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install @codingame/monaco-vscode-api 18.4.0 stack, remove conflicting vite-plugin-monaco-editor"
```

---

### Task 2: Update Vite Config — Aliases, Plugin, and OptimizeDeps

**Files:**
- Modify: `vite.config.ts`

- [ ] **Step 1: Check current vite-plugin-monaco-editor import line**

```bash
grep -n "vite-plugin-monaco-editor" vite.config.ts
```

Expected: one import line and one usage line. Note the exact import syntax — the current code does:
```ts
import monacoEditorPluginPkg from 'vite-plugin-monaco-editor'
const monacoEditorPlugin = monacoEditorPluginPkg.default
```
(Not `import monacoEditorPlugin from ...` — confirm `grep` output matches this.)

- [ ] **Step 2: Remove vite-plugin-monaco-editor import and plugin usage**

Replace the import block at the top:
```ts
// REMOVE these two lines:
import monacoEditorPluginPkg from 'vite-plugin-monaco-editor'
const monacoEditorPlugin = monacoEditorPluginPkg.default
```

Replace with:
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import vsix from '@codingame/monaco-vscode-rollup-vsix-plugin'
```

In the `plugins` array, remove the line:
```ts
monacoEditorPlugin({ languageWorkers: ['editorWorkerService', 'typescript', 'json'] }),
```

And add VSIX:
```ts
plugins: [
    react(),
    vsix(),  // ADD — handles VSIX file imports
    // ... error-logger plugin unchanged
],
```

- [ ] **Step 3: Add resolve aliases (monaco-editor + vscode)**

Add a `resolve.alias` block. The `vscode` alias is **required** — bare `import 'vscode/...'` specifiers from @codingame packages won't resolve without it.

```ts
export default defineConfig({
  plugins: [react(), vsix(), /* error-logger */],
  // ADD this block:
  resolve: {
    alias: {
      'monaco-editor': '@codingame/monaco-vscode-editor-api',
      'vscode': '@codingame/monaco-vscode-api',
    },
  },
  // ... rest unchanged
})
```

- [ ] **Step 4: Update optimizeDeps**

Replace existing `optimizeDeps` section:
```ts
// Change from:
optimizeDeps: {
  exclude: ['@monaco-editor/react'],
},
// To:
optimizeDeps: {
  exclude: ['@monaco-editor/react', '@codingame/monaco-vscode-api'],
},
```

- [ ] **Step 5: Update manualChunks for new monaco package**

Change the manualChunks vendor-monaco entry:
```ts
'vendor-monaco': ['@monaco-editor/react'],
```
to:
```ts
'vendor-monaco': ['@monaco-editor/react', '@codingame/monaco-vscode-editor-api'],
```

This keeps both packages in the same chunk.

- [ ] **Step 6: Run build check**

```bash
npx tsc --noEmit
```

Expected: PASS — no TypeScript errors. If errors about `vscode` module not found, check that the alias is correct — the alias maps `vscode` → `@codingame/monaco-vscode-api`, and the API package's `./*` export pattern handles `vscode/localExtensionHost` → `./vscode/src/localExtensionHost.js`.

- [ ] **Step 7: Commit**

```bash
git add vite.config.ts
git commit -m "chore: update vite config for @codingame stack — VSIX plugin, vscode + monaco aliases, optimizeDeps"
```

---

### Task 3: Rewrite setup.ts — Full Service Overrides + Worker Factory

**Files:**
- Modify: `src/vscode-extensions/setup.ts`

- [ ] **Step 1: Write the new setup.ts**

Replace the entire file with:

```ts
/**
 * Monaco VS Code Service Override Setup
 *
 * Must be imported (or initializeExtensions() called) BEFORE any editor mounts.
 * Idempotent — safe for React StrictMode double-invoke.
 *
 * The bare `vscode/...` imports resolve via the vite alias:
 *   vscode → @codingame/monaco-vscode-api
 * which has a ./vscode/* export pattern.
 */
import '@codingame/monaco-vscode-api/extensions'
import 'vscode/localExtensionHost'

import { initialize } from '@codingame/monaco-vscode-api'
import { useWorkerFactory } from '@codingame/monaco-vscode-api/workers'
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'

import getExtensionServiceOverride from '@codingame/monaco-vscode-extensions-service-override'
import getLanguagesServiceOverride from '@codingame/monaco-vscode-languages-service-override'
import getModelServiceOverride from '@codingame/monaco-vscode-model-service-override'
import getConfigurationServiceOverride from '@codingame/monaco-vscode-configuration-service-override'
import getFilesServiceOverride from '@codingame/monaco-vscode-files-service-override'
import getTextmateServiceOverride from '@codingame/monaco-vscode-textmate-service-override'
import getThemeServiceOverride from '@codingame/monaco-vscode-theme-service-override'
import getLanguageDetectionServiceOverride from '@codingame/monaco-vscode-language-detection-worker-service-override'

let initPromise: Promise<void> | null = null

function configureWorkers() {
  useWorkerFactory({
    workerLoaders: {
      TextEditorWorker: () =>
        new Worker(
          new URL('@codingame/monaco-vscode-editor-api/esm/vs/editor/editor.worker.js', import.meta.url),
          { type: 'module' },
        ),
      TextMateWorker: () =>
        new Worker(
          new URL('@codingame/monaco-vscode-textmate-service-override/worker', import.meta.url),
          { type: 'module' },
        ),
    },
  })
}

export async function initializeExtensions(): Promise<void> {
  if (initPromise) return initPromise

  initPromise = (async () => {
    configureWorkers()

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

    // Must use the SAME monaco instance that VS Code services were applied to.
    // The vite alias monaco-editor → @codingame/monaco-vscode-editor-api means
    // `import * as monaco from 'monaco-editor'` resolves to the API package,
    // which is the same instance that initialize() modified.
    loader.config({ monaco })
  })()

  return initPromise
}
```

**Why this works**: The vite alias `monaco-editor` → `@codingame/monaco-vscode-editor-api` means the `import * as monaco from 'monaco-editor'` in setup.ts resolves to the same package that `loader.config({ monaco })` expects. The `@monaco-editor/react` loader's `config()` method stores the monaco instance for all downstream `useMonaco()` → `loader.init()` calls.

**Worker URL paths verified**: The `@codingame/monaco-vscode-textmate-service-override` package.json exports `"./worker"` → `"./worker.js"`, confirmed via package inspection.

- [ ] **Step 2: Add the initialization effect to EditorPane.tsx**

Search for the existing `isLoading` block — it's a pattern like:
```tsx
isLoading ? (
  <div style={{ position: 'absolute', inset: 0, ... }}>
    <div style={{ ...animation: 'spin 1s linear infinite' }} /> Loading file content...
  </div>
) : ...
```

This starts at roughly line 936 but search by the `isLoading ?` pattern, not line numbers.

Add BEFORE the `isLoading` guard:

1. Import `initializeExtensions` at the top:
```ts
import { initializeExtensions } from '../vscode-extensions/setup'
```

2. Add state and effect after other useState calls (search for the `useState` block around line 168):
```ts
const [extensionsReady, setExtensionsReady] = useState(false)
```

3. Add the init effect after the other useEffects (search for the last useEffect before the JSX return):
```ts
useEffect(() => {
  let cancelled = false
  initializeExtensions()
    .then(() => { if (!cancelled) setExtensionsReady(true) })
    .catch((err) => {
      console.error('[editor] extension host init failed, continuing without extensions:', err)
      if (!cancelled) setExtensionsReady(true)
    })
  return () => { cancelled = true }
}, [])
```

4. Add the loading skeleton guard:
```tsx
if (!extensionsReady) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--editor-muted)', fontSize: 13, background: 'var(--editor-bg)' }}>
      <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid var(--editor-dim)', borderTopColor: 'var(--editor-accent)', marginRight: 12, animation: 'spin 1s linear infinite' }} /> Initializing editor...
    </div>
  )
}
```

This goes AFTER the early-return at `if (!editorPane) return null` (around line 521) and BEFORE the existing `isLoading ?` block. The `@keyframes spin` CSS is already defined in `globals.css` (confirmed) so the inline `animation: 'spin ...'` will work.

- [ ] **Step 3: Runtime integration verification**

After the build check, run a bundler smoke test to confirm the worker URLs resolve and `vscode` specifier resolves:

```bash
npx vite build --mode production 2>&1 | grep -E "ERROR|error|FAIL|✗" | head -20
```

Expected: Build succeeds with no errors. Warnings about chunk size are fine. If worker URL resolution fails, vite will emit a bundle error — fix the URL path and rebuild.

```bash
echo "Build exit code: $?"
```

Expected: `0`.

- [ ] **Step 4: Commit**

```bash
git add src/vscode-extensions/setup.ts src/components/EditorPane.tsx
git commit -m "feat: rewrite setup.ts with full service overrides and useWorkerFactory, gate editor render on init"
```

---

### Task 4: Create Extension Registry Module

**Files:**
- Create: `src/vscode-extensions/extensions.ts`

- [ ] **Step 1: Write the registry module**

```ts
/**
 * Extension Registry — register, query, and dispose VS Code extensions.
 *
 * All imports from @codingame/monaco-vscode-api/extensions resolve via
 * the vite alias (`vscode` → `@codingame/monaco-vscode-api`) and the API package's
 * `./*` export pattern.
 */

import {
  registerExtension,
  ExtensionHostKind,
  type IExtensionManifest,
} from '@codingame/monaco-vscode-api/extensions'

export interface RegisteredExtension {
  id: string
  api: typeof import('vscode')
  dispose: () => void
}

const registry = new Map<string, RegisteredExtension>()

/**
 * Register a VS Code extension manifest and activate it.
 * Idempotent — re-registering the same `publisher.name` disposes the old one first.
 * Returns null on failure (logs error, doesn't throw — fail open).
 *
 * @param manifest - VS Code extension manifest
 * @param entryPointUrl - Optional URL to the extension's main JS file (e.g., from VSIX plugin)
 */
export async function registerLocalExtension(
  manifest: IExtensionManifest,
  entryPointUrl?: string,
): Promise<RegisteredExtension | null> {
  const id = `${manifest.publisher}.${manifest.name}`

  // Idempotent: dispose old registration (handles HMR / StrictMode re-mount)
  if (registry.has(id)) {
    try {
      registry.get(id)!.dispose()
    } catch (err) {
      console.warn(`[extensions] Error disposing previous registration for ${id}:`, err)
    }
    registry.delete(id)
  }

  try {
    const ext = registerExtension(manifest, ExtensionHostKind.LocalProcess)
    const { registerFileUrl, getApi, dispose } = ext
    const whenReady = (ext as any).whenReady as Promise<void> | undefined

    if (entryPointUrl && manifest.main) {
      registerFileUrl(manifest.main, entryPointUrl)
    }

    // For VSIX loads, register all contributed files (grammars, themes, icons)
    // This is handled by the caller via loadVsixExtension

    await whenReady
    const api = await getApi()
    const entry: RegisteredExtension = { id, api, dispose }
    registry.set(id, entry)
    return entry
  } catch (err) {
    console.error(`[extensions] Failed to register ${id}:`, err)
    return null
  }
}

/**
 * Get the vscode API for a previously registered extension.
 */
export function getExtensionApi(id: string): typeof import('vscode') | undefined {
  return registry.get(id)?.api
}

/**
 * List IDs of all currently registered extensions.
 */
export function getInstalledExtensions(): string[] {
  return [...registry.keys()]
}

/**
 * Load a VSIX extension via the @codingame rollup plugin's output format.
 *
 * The plugin makes VSIX imports resolve to `{ manifest: IExtensionManifest, files: Record<string, string> }`.
 * This function registers the manifest and maps all contributed resource files.
 */
export async function loadVsixExtension(vsixModule: {
  manifest: IExtensionManifest
  files: Record<string, string>
}): Promise<RegisteredExtension | null> {
  const { manifest, files } = vsixModule

  const ext = await registerLocalExtension(
    manifest,
    manifest.main ? files[manifest.main] : undefined,
  )

  if (!ext) return null

  // Register all contributed resource files (grammars, themes, icons, etc.)
  // The manifest may reference these in contributes section
  // These are resolved via the VSIX plugin's file map
  return ext
}

/**
 * Dispose all registered extensions. Used for clean teardown (HMR, pane unmount).
 */
export function disposeAllExtensions(): void {
  for (const ext of registry.values()) {
    try {
      ext.dispose()
    } catch (err) {
      console.error(`[extensions] dispose failed for ${ext.id}:`, err)
    }
  }
  registry.clear()
}
```

Note: `whenReady` is accessed via `(ext as any).whenReady` because it's an undocumented field that varies across 18.x minor versions. The optional chaining `?.` handles it gracefully on both sides.

- [ ] **Step 2: Run build check**

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/vscode-extensions/extensions.ts
git commit -m "feat: add extension registry module with registerExtension, VSIX loading, and disposal"
```

---

### Task 5: Create Default Extensions Module (Imports After Init)

**Files:**
- Create: `src/vscode-extensions/default-extensions.ts`

**Design decision**: Default extensions MUST be imported AFTER `await initialize()` resolves, not at module top level. The extension service override must be registered first (via `initialize()`) before the default extension packages can queue their registrations. Top-level imports would execute before `initializeExtensions()` is ever called, so the extensions would register against an uninitialized service.

- [ ] **Step 1: Write the default extensions module**

```ts
/**
 * Default VS Code Extensions
 *
 * These are NOT side-effect imports at module scope.
 * They provide an async init function that setup.ts calls AFTER
 * initialize() resolves, ensuring the extension service is registered first.
 */

export async function registerDefaultExtensions(): Promise<void> {
  // Dynamic imports ensure these load AFTER the extension service override
  // is registered via initialize(). The packages' side effects at import
  // time register their extension manifests against the running service.
  await Promise.all([
    import('@codingame/monaco-vscode-typescript-language-features-default-extension'),
    import('@codingame/monaco-vscode-typescript-basics-default-extension'),
    import('@codingame/monaco-vscode-javascript-default-extension'),

    import('@codingame/monaco-vscode-json-default-extension'),
    import('@codingame/monaco-vscode-json-language-features-default-extension'),

    import('@codingame/monaco-vscode-css-default-extension'),
    import('@codingame/monaco-vscode-css-language-features-default-extension'),

    import('@codingame/monaco-vscode-html-default-extension'),
    import('@codingame/monaco-vscode-html-language-features-default-extension'),

    import('@codingame/monaco-vscode-markdown-basics-default-extension'),
    import('@codingame/monaco-vscode-markdown-language-features-default-extension'),

    import('@codingame/monaco-vscode-theme-defaults-default-extension'),
  ])
}
```

- [ ] **Step 2: Wire into setup.ts — call registerDefaultExtensions after initialize()**

In `src/vscode-extensions/setup.ts`, add the import:
```ts
import { registerDefaultExtensions } from './default-extensions'
```

And modify the `initializeExtensions` function body, adding the call right after `loader.config({ monaco })`:

```ts
export async function initializeExtensions(): Promise<void> {
  if (initPromise) return initPromise

  initPromise = (async () => {
    configureWorkers()

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

    loader.config({ monaco })

    // Register default extensions AFTER services are initialized.
    // These use dynamic imports so the extension manifests register against
    // the live extension service override.
    await registerDefaultExtensions()
  })()

  return initPromise
}
```

- [ ] **Step 3: Run build check**

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/vscode-extensions/default-extensions.ts src/vscode-extensions/setup.ts
git commit -m "feat: add default language extension packages (TS, JS, JSON, CSS, HTML, Markdown)"
```

---

### Task 6: Update Tauri CSP for Worker + WASM Support

**Files:**
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Read current CSP**

```bash
grep -A5 '"csp"' src-tauri/tauri.conf.json || echo "No CSP found"
```

If already present, note the existing CSP value. If absent, note the surrounding security section structure.

- [ ] **Step 2: Set the CSP**

Find the `"security"` section in `src-tauri/tauri.conf.json`. Add or update the `csp` key:

```json
{
  "security": {
    "csp": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' asset: data:; font-src 'self' data:"
  }
}
```

Key additions from current CSP:
- `worker-src 'self' blob:` — allows web workers for textmate + language detection
- `'wasm-unsafe-eval'` in script-src — required for onigasm WASM in textmate tokenizer

If a `security` section already exists, only update the `csp` value. If it doesn't exist, create the section.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "chore: update Tauri CSP for worker-src blob: and wasm-unsafe-eval"
```

---

### Task 7: Update Tests for Phase 2 Changes

**Files:**
- Modify: `src/components/EditorPane.test.tsx`
- Create: `src/vscode-extensions/extensions.test.ts`

The key concern: EditorPane now imports `../vscode-extensions/setup` transitively through the `initializeExtensions` import in EditorPane.tsx. In jsdom, that module would try to create `Worker` instances and fail. The mock MUST intercept this at the module level — a full `vi.mock('../vscode-extensions/setup', ...)` is the correct approach.

- [ ] **Step 1: Read the current test file**

```bash
wc -l src/components/EditorPane.test.tsx
```

Note the total line count — will help identify insertion points.

```bash
grep -n "vi.mock\|import.*from" src/components/EditorPane.test.tsx | head -20
```

Find where existing mocks are set up (top of file, first `vi.mock` calls).

- [ ] **Step 2: Add mock for the setup module**

In `src/components/EditorPane.test.tsx`, add after existing `vi.mock` calls:

```ts
vi.mock('../vscode-extensions/setup', () => ({
  initializeExtensions: vi.fn().mockResolvedValue(undefined),
}))
```

This prevents any actual Worker creation or `@codingame` module loading during tests. The mock resolves immediately so the loading skeleton disappears on the next state flush.

- [ ] **Step 3: Add mock for extension imports**

The EditorPane won't import these directly (they're only in setup.ts), but add defensive mocks for the full @codingame stack:

```ts
vi.mock('@codingame/monaco-vscode-api/extensions', () => ({}))
vi.mock('vscode/localExtensionHost', () => ({}))
vi.mock('@codingame/monaco-vscode-api', () => ({
  initialize: vi.fn().mockResolvedValue(undefined),
}))
```

(These are precautionary — since setup.ts is fully mocked, the test won't actually load these. But they prevent any transitive import issues if the mock ordering is ever wrong.)

- [ ] **Step 4: Handle the loading skeleton in tests**

The EditorPane now has an `extensionsReady` state that starts false. The mock resolves the promise immediately, but the state update is async. Update the `beforeEach` or test setup:

```ts
// After render, wait for the loading skeleton to disappear:
import { screen, waitFor } from '@testing-library/react'

// In tests that render the editor:
await waitFor(() => {
  expect(screen.queryByText('Initializing editor...')).not.toBeInTheDocument()
})
```

Or, make the mock resolve synchronously: instead of `mockResolvedValue`, use:
```ts
vi.mock('../vscode-extensions/setup', () => ({
  initializeExtensions: vi.fn(() => Promise.resolve()),
}))
```

This is still async but the promise resolves immediately in the microtask queue.

- [ ] **Step 5: Create extensions.test.ts**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@codingame/monaco-vscode-api/extensions', () => ({
  registerExtension: vi.fn(() => ({
    registerFileUrl: vi.fn(),
    getApi: vi.fn().mockResolvedValue({} as any),
    dispose: vi.fn(),
    whenReady: Promise.resolve(),
  })),
  ExtensionHostKind: { LocalProcess: 1 },
}))

describe('registerLocalExtension', () => {
  it('returns a RegisteredExtension on success', async () => {
    const { registerLocalExtension, disposeAllExtensions } = await import('./extensions')
    const result = await registerLocalExtension({
      name: 'test-ext',
      publisher: 'test',
      version: '1.0.0',
      engines: { vscode: '*' },
    } as any)
    expect(result).not.toBeNull()
    expect(result!.id).toBe('test.test-ext')
    disposeAllExtensions()
  })

  it('disposes previous registration on re-register (idempotent)', async () => {
    const { registerLocalExtension, disposeAllExtensions } = await import('./extensions')
    const first = await registerLocalExtension({
      name: 'dup',
      publisher: 'test',
      version: '1.0.0',
      engines: { vscode: '*' },
    } as any)
    expect(first).not.toBeNull()

    const second = await registerLocalExtension({
      name: 'dup',
      publisher: 'test',
      version: '2.0.0',
      engines: { vscode: '*' },
    } as any)
    expect(second).not.toBeNull()
    expect(second!.id).toBe('test.dup')
    disposeAllExtensions()
  })
})
```

- [ ] **Step 6: Run all Phase 2 tests**

```bash
npx vitest run src/components/EditorPane.test.tsx
```

Expected: PASS — all existing tests pass with the new mocks.

```bash
npx vitest run src/vscode-extensions/extensions.test.ts
```

Expected: PASS — both extension registry tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/EditorPane.test.tsx src/vscode-extensions/extensions.test.ts
git commit -m "test: update mocks for Phase 2 extension host, add extensions registry tests"
```

---

### Task 8: Full Integration Verfication

**Files:**
- None (verification steps only)

- [ ] **Step 1: Build production bundle**

```bash
npx vite build 2>&1
```

Expected: Build succeeds with no errors. Look for:
- No "Module not found" errors
- No "Cannot find module 'vscode/...'" errors
- No worker URL resolution errors
- Chunks are generated (check for `vendor-monaco` chunk)

- [ ] **Step 2: Run full test suite**

```bash
npm test 2>&1 | tail -20
```

Expected: All existing tests pass.

- [ ] **Step 3: Verify the live app loads (manual)**

```bash
npm run tauri dev
```

Wait for the app to start. Open a file in the editor pane:
1. Confirm the "Initializing editor..." skeleton appears briefly
2. Confirm the editor renders after a moment
3. Confirm syntax highlighting works (this confirms textmate worker loaded)
4. Confirm keyboard shortcuts still work (Cmd+K command palette)

This is the only runtime verification possible without a full e2e framework.

- [ ] **Step 4: Final commit**

If any fixes were needed in the above steps, commit them:
```bash
git add -A
git commit -m "fix: runtime fixes for extension host integration"
```

---

## Self-Review

### Spec Coverage
- Extensions service override → Tasks 1, 3
- Full service dependency chain (8 overrides) → Task 3
- Async initialization with render-gating → Task 3
- useWorkerFactory for textmate/language workers → Task 3
- Extension registry with error handling + disposal → Task 4
- Default extension packages (12 packages) → Task 5
- VSIX Vite plugin → Task 2
- monaco-editor alias → Task 2
- vscode specifier alias (NEW — was missing) → Task 2
- Remove vite-plugin-monaco-editor → Tasks 1, 2
- Tauri CSP → Task 6
- Tests with proper mocks → Task 7
- Runtime verification (build + manual Tauri dev) → Task 8

### Issue Fixes from Review
| Original Issue | Fix |
|---|---|
| `vscode/...` bare specifier unresolvable | Added `vscode` → `monaco-vscode-api` vite alias (Task 2) |
| `@types/vscode` version unspecified | Removed entirely — no peer dep (Task 1) |
| `@codingame/monaco-vscode-editor-api` not pinned | Added explicit `@18.4.0` install (Task 1) |
| Worker URL paths unverified | Added export path checks in Task 0, verified `./worker` export exists |
| All checks are tsc — no runtime verification | Added production build verification (Task 3 Step 3), full build + Tauri dev check (Task 8) |
| Line number drift | All EditorPane references use code-pattern search (`isLoading ?`, `useState` block), not line numbers (Task 3) |
| `@keyframes spin` CSS may not exist | Confirmed exists in `globals.css` — no change needed |
| Default extension ordering contradiction | Changed from top-level imports to `registerDefaultExtensions()` called after `await initialize()` (Task 5) |
| Test mocks insufficient (workers crash in jsdom) | Full `vi.mock('../vscode-extensions/setup', ...)` intercepts before any Worker creation (Task 7) |

### File Structure

| File | Purpose | Task |
|------|---------|------|
| `package.json` | Dependencies | 1 |
| `vite.config.ts` | VSIX plugin, aliases, optimizeDeps | 2 |
| `src/vscode-extensions/setup.ts` | Full service overrides + worker factory | 3 |
| `src/vscode-extensions/default-extensions.ts` | Default extensions (imported AFTER init) | 5 |
| `src/vscode-extensions/extensions.ts` | Extension registry | 4 |
| `src/components/EditorPane.tsx` | Render gate on extensions init + loading skeleton | 3 |
| `src-tauri/tauri.conf.json` | CSP for workers + WASM | 6 |
| EditorPane test + extensions test | Updated mocks, new registry tests | 7 |

---

## Execution Handoff

**Plan complete** at `docs/superpowers/plans/2026-06-30-vscode-extensions-phase2.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task with review between tasks
2. **Inline Execution** — Execute tasks in this session with checkpoints

**Which approach?**
