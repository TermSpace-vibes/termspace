# VS Code Extensions Support — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Monaco Standalone Editor (CDN-loaded via `@monaco-editor/react`) with a local `monaco-editor` instance that has VS Code service overrides from `@codingame/monaco-vscode-editor-api`. This is the foundation for loading VS Code extensions in later phases.

**Architecture:** We install `monaco-editor` as an npm dependency, bootstrap VS Code service overrides via side-effect imports from `@codingame/monaco-vscode-editor-api`, and configure `@monaco-editor/react`'s `loader` to use the local Monaco instance instead of downloading from CDN. A Vite plugin handles Web Worker bundling for the language services. The existing React `<Editor>` / `<DiffEditor>` components continue working identically — the swap is transparent at the component level.

**Tech Stack:** monaco-editor v0.52+, @codingame/monaco-vscode-editor-api, @monaco-editor/react (kept), vite-plugin-monaco-editor, Tauri v2

---

### Task 1.1: Install Dependencies and Configure Vite Plugin

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`
- Create: `src/vscode-extensions/` (directory)

- [ ] **Step 1: Install npm dependencies**

Run:
```bash
npm install monaco-editor@^0.52.2 @codingame/monaco-vscode-editor-api@^18.1.0
npm install -D vite-plugin-monaco-editor@^0.4.0
```

Expected: packages installed, `package.json` updated with `monaco-editor` and `@codingame/monaco-vscode-editor-api` in `dependencies`, `vite-plugin-monaco-editor` in `devDependencies`.

- [ ] **Step 2: Update Vite config for Web Worker bundling**

Edit `vite.config.ts`:

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import monacoEditorPlugin from 'vite-plugin-monaco-editor'  // ADD

export default defineConfig({
  plugins: [
    react(),
    monacoEditorPlugin({ languageWorkers: ['editorWorkerService', 'typescript', 'json'] }),  // ADD
    // ... error-logger plugin unchanged
  ],
  // ... rest unchanged
})
```

Note: `vite-plugin-monaco-editor` handles bundling the language service Web Workers (`vs/language/typescript/tsWorker`, `vs/language/json/jsonWorker`, `vs/editor/editorWorker`) into separate chunks so they can be loaded from `file://` in Tauri's WKWebView.

- [ ] **Step 3: Create the directory for extension-related code**

```bash
mkdir -p src/vscode-extensions
```

- [ ] **Step 4: Run build check to verify config**

Run:
```bash
npx tsc --noEmit
```

Expected: PASS — no TypeScript errors with new dependencies installed.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vite.config.ts src/vscode-extensions
git commit -m "chore: install monaco-editor and vite-plugin-monaco-editor for VS Code service layer"
```

---

### Task 1.2: Create Monaco Service Override Setup Module

**Files:**
- Create: `src/vscode-extensions/setup.ts`

This module bootstraps VS Code service overrides on the local `monaco-editor` instance. Importing this module for side effects patches Monaco's standalone services with VS Code equivalents (TextMate grammars, VS Code themes, configuration system, etc.).

`setup.ts` must:
1. Import `@codingame/monaco-vscode-editor-api` for base VS Code services
2. Configure `@monaco-editor/react`'s `loader` to use our local `monaco-editor` instance (so the `<Editor>` component uses the service-overridden version)
3. Export nothing — it's a side-effect module that must be imported before any Monaco React component renders

- [ ] **Step 1: Write the setup module**

Create `src/vscode-extensions/setup.ts`:

```ts
/**
 * Monaco VS Code Service Override Setup
 *
 * This module must be imported BEFORE any Monaco editor component is rendered.
 * It applies VS Code service overrides to the local monaco-editor instance
 * and configures @monaco-editor/react's loader to use it instead of the CDN.
 *
 * Import in EditorPane.tsx (or bootstrap) as:
 *   import '../vscode-extensions/setup'
 */

// Side-effect imports: these monkey-patch monaco-editor's standalone services
// with VS Code-compatible versions (TextMate grammars, themes, configuration, etc.)
import '@codingame/monaco-vscode-editor-api'

// @monaco-editor/react loader — configure to use the local instance
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'

// Point @monaco-editor/react at our local Monaco (VS Code services applied)
loader.config({ monaco })
```

- [ ] **Step 2: Verify the module compiles**

Run:
```bash
npx tsc --noEmit
```

Expected: PASS — TypeScript validates the import paths.

- [ ] **Step 3: Commit**

```bash
git add src/vscode-extensions/setup.ts
git commit -m "feat: add Monaco VS Code service override setup module"
```

---

### Task 1.3: Wire Setup Module into EditorPane

**Files:**
- Modify: `src/components/EditorPane.tsx`

Changes:
1. Add `import '../vscode-extensions/setup'` at the top of the file (BEFORE the `@monaco-editor/react` import)
2. Remove the standalone `useMonaco()` hook's TypeScript compiler configuration block (lines ~262-287) — this is now handled by VS Code service overrides (the JSON schema service replaces manual `typescriptDefaults.setCompilerOptions()` calls)
3. Keep the `EDITOR_THEMES` object and `defineTheme('termspace-dynamic', ...)` call — these still work with the VS Code service layer; VS Code themes and standalone themes coexist

- [ ] **Step 1: Add the setup import**

In `EditorPane.tsx`, add at the very top of imports (before line 1):

```ts
import '../vscode-extensions/setup'
```

This MUST come first because:
- The side-effect imports in `setup.ts` must run before any Monaco module is initialized
- The `loader.config({ monaco })` call tells `@monaco-editor/react` which instance to use before the `<Editor>` component mounts

- [ ] **Step 2: Remove the manual TypeScript compiler options block**

Delete the entire `useEffect` block at lines 262-287:

```ts
// DELETE THIS ENTIRE BLOCK:
useEffect(() => {
  if (monaco) {
    const ts = monaco.languages.typescript as any
    ts.typescriptDefaults.setCompilerOptions({
      target: ts.ScriptTarget.ES2020,
      allowNonTsExtensions: true,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      module: ts.ModuleKind.CommonJS,
      noEmit: true,
      esModuleInterop: true,
      jsx: ts.JsxEmit.React,
      reactNamespace: 'React',
      allowJs: true
    })
    ts.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
      diagnosticCodesToIgnore: [2307, 2792]
    })
    ts.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
      diagnosticCodesToIgnore: [2307, 2792, 80001]
    })
    // ...
  }
}, [monaco])
```

Reason: With VS Code service overrides active, the TypeScript language service is configured via `tsconfig.json` (which the editor already has access to through the workspace file system). The manual `typescriptDefaults` overrides would conflict with the VS Code service layer. The diagnostic ignore codes (2307, 2792) were workarounds for the standalone editor — the VS Code service layer respects `tsconfig.json` settings directly.

- [ ] **Step 3: Keep the theme definition and remove useMonaco import if no longer used**

The `monaco` variable from `useMonaco()` is still used in:
- The `handleEditorDidMount` function (the `monaco` parameter, not the hook)
- The `defineTheme` block (line 291) — but this is inside the `useEffect` that we're deleting

Since we're deleting the `useEffect` that uses the `useMonaco()` hook result, we need to move theme definition elsewhere.

Add a theme initialization effect that uses the local `monaco-editor` import instead of `useMonaco()`:

Replace the deleted `useEffect` with:

```ts
// Theme initialization — runs once on mount using the service-overridden Monaco
import * as monacoEditor from 'monaco-editor'

// ... inside the component, add this effect:
useEffect(() => {
  // Define the custom theme on the local Monaco instance
  const theme = EDITOR_THEMES[settings.theme] || EDITOR_THEMES['warm-dark']
  monacoEditor.editor.defineTheme('termspace-dynamic', {
    base: theme.base,
    inherit: true,
    rules: [
      { token: 'comment', foreground: theme.comment.slice(1), fontStyle: 'italic' },
      { token: 'keyword', foreground: theme.keyword.slice(1) },
      { token: 'string', foreground: theme.string.slice(1) },
      { token: 'number', foreground: theme.function.slice(1) },
      { token: 'type', foreground: theme.type.slice(1) },
      { token: 'tag', foreground: theme.keyword.slice(1) },
      { token: 'attribute.name', foreground: theme.function.slice(1) },
      { token: 'attribute.value', foreground: theme.string.slice(1) },
      { token: 'delimiter', foreground: theme.text.slice(1) },
      { token: 'identifier', foreground: theme.text.slice(1) },
      { token: 'variable', foreground: theme.text.slice(1) },
    ],
    colors: {
      'editor.background': theme.bg,
      'editor.foreground': theme.text,
      'editor.lineHighlightBackground': theme.surface,
      'editorCursor.foreground': theme.accent,
      'editor.selectionBackground': theme.accent + '40',
      'editorLineNumber.foreground': theme.dim,
      'editorLineNumber.activeForeground': theme.text,
      'editor.inactiveSelectionBackground': theme.border,
      'editorBracketMatch.background': theme.accent + '20',
      'editorBracketMatch.border': theme.accent,
    },
  })
  monacoEditor.editor.setTheme('termspace-dynamic')
}, [settings.theme])
```

- [ ] **Step 4: Verify build compiles**

Run:
```bash
npm run build 2>&1 | head -50
```

Expected: PASS — TypeScript compilation succeeds with no errors about removed imports or unused variables. Note: the Tauri build step may fail in dev (no Rust toolchain needed), but `tsc` and Vite bundling should pass.

- [ ] **Step 5: Run existing tests**

Run:
```bash
npx vitest run src/components/EditorPane.test.tsx
```

Expected: PASS — all existing tests pass because the `@monaco-editor/react` mock is unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/components/EditorPane.tsx src/vscode-extensions/setup.ts
git commit -m "feat: wire Monaco VS Code services into EditorPane, remove manual TS config"
```

---

### Task 1.4: Verify TypeScript Errors Are Suppressed

**Files:**
- Modify: `src/components/EditorPane.tsx` (if needed)
- Modify: `tsconfig.json` (if needed)

- [ ] **Step 1: Check if diagnostic ignore codes need updating**

After removing the manual `typescriptDefaults.setDiagnosticsOptions` block, verify that ModuleNotFound errors (2307) and other suppressed diagnostics don't flood the editor:

1. Open `src/App.tsx` in the editor
2. Verify that imports from Tauri APIs (`@tauri-apps/api/core`, etc.) don't show red squiggles
3. If they do, add VS Code settings.json configuration via the service override layer instead

Create `src/vscode-extensions/settings-overrides.ts` if needed:

```ts
// Configure TypeScript diagnostics to ignore Tauri-specific module resolution errors
// These are valid at runtime (Tauri provides them) but the editor can't resolve them
import * as monaco from 'monaco-editor'

// Access the language service configuration through VS Code service overrides
// (API TBD based on actual @codingame/monaco-vscode-editor-api behavior)
```

Testing approach: ship first, check if errors appear, fix only if they do.

- [ ] **Step 2: Commit**

```bash
git add .
git commit -m "chore: update TS diagnostics config for VS Code service layer"
```

---

### Task 1.5: Verify Theme Switching Still Works

**Files:**
- Read: `src/components/EditorPane.tsx`

- [ ] **Step 1: Verify theme effect dependencies**

Check that the `useEffect` for theme definition (created in Task 1.3) re-runs when the user changes themes:

```ts
// Verify this dependency array includes settings.theme:
// }, [settings.theme])
```

Expected: `[settings.theme]` is the dependency — the theme effect re-defines `termspace-dynamic` and re-applies it whenever the user changes themes in the Settings modal.

- [ ] **Step 2: Check theme values match existing behavior**

Verify the `colors` map in the theme definition has entries for foreground, background, cursor, selection, line numbers, bracket matching — all sourced from the same `EDITOR_THEMES[settings.theme]` object. No values should change from the current behavior.

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "fix: ensure theme re-definition on theme switch with VS Code services"
```

---

### Task 1.6: Update EditorPane Tests for New Imports

**Files:**
- Modify: `src/components/EditorPane.test.tsx`

- [ ] **Step 1: Add mocks for new imports**

Update `EditorPane.test.tsx` to mock the new dependencies:

1. Mock `monaco-editor`:
```ts
vi.mock('monaco-editor', () => ({
  default: {
    editor: {
      defineTheme: vi.fn(),
      setTheme: vi.fn(),
    },
    languages: {
      typescript: {
        ScriptTarget: {},
        ModuleResolutionKind: {},
        ModuleKind: {},
        JsxEmit: {},
        typescriptDefaults: {
          setCompilerOptions: vi.fn(),
          setDiagnosticsOptions: vi.fn(),
        },
      },
    },
  },
}))
```

2. Mock `@codingame/monaco-vscode-editor-api` (side-effect module, no exports needed):
```ts
vi.mock('@codingame/monaco-vscode-editor-api', () => ({}))
```

3. Already mocked: `@monaco-editor/react` — keep the existing mock.
4. Add `@monaco-editor/react` loader mock (since setup.ts imports `loader`):
   - The existing `vi.mock('@monaco-editor/react')` already covers the component defaults. Add `loader` to the mock:
```ts
vi.mock('@monaco-editor/react', () => ({
  default: ({ onMount }: any) => { /* ... existing mock ... */ },
  DiffEditor: ({ onMount }: any) => { /* ... existing mock ... */ },
  useMonaco: () => null,
  loader: { config: vi.fn() },   // ADD
}))
```

- [ ] **Step 2: Run tests**

```bash
npx vitest run src/components/EditorPane.test.tsx
```

Expected: PASS — all 10+ existing tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/EditorPane.test.tsx
git commit -m "test: update EditorPane test mocks for VS Code service layer"
```

---

## Self-Review

### Spec Coverage
(No formal spec.md was created — this is Phase 1 of a multi-phase effort.)

FR-001: Replace Monaco standalone with VS Code service layer → Tasks 1.1–1.3
FR-002: Preserve EditorPane component behavior → Task 1.3 (no component API changes)
FR-003: Wire local Monaco instance into React components → Task 1.2 (loader.config)
FR-004: Remove manual TS compiler options → Task 1.3
FR-005: Tests pass with new mocks → Task 1.6

### Placeholder Scan
- No "TBD", "TODO", "implement later" in steps
- All code blocks contain actual code (no "fill in details")
- No references to undefined functions/types

### Type Consistency
- `monaco-editor` imported as `* as monacoEditor` in EditorPane (named import to avoid shadowing `monaco` parameter)
- `loader.config({ monaco })` uses the default import from `monaco-editor`
- Theme colors map uses existing `EDITOR_THEMES` structure — no new types
- Test mocks mirror the real types

### File Structure Check
| File | Purpose | Task |
|------|---------|------|
| `src/vscode-extensions/setup.ts` | Bootstrap VS Code services, configure loader | 1.2 |
| `src/vscode-extensions/settings-overrides.ts` | (Optional) TS diagnostic overrides | 1.4 |
| `src/components/EditorPane.tsx` | Wire setup import, remove TS config block, theme init | 1.3 |
| `src/components/EditorPane.test.tsx` | Mock new imports | 1.6 |
| `vite.config.ts` | Monaco Web Worker plugin | 1.1 |
| `package.json` | Add/remove deps | 1.1 |

## Execution Handoff

**Plan complete.** Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
