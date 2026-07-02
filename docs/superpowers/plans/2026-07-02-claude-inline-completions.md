# Claude Inline Completions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add manual-trigger inline (ghost-text) code completions in Termspace's Monaco editor, powered by one-shot `claude --print` calls, wired in as a formal first-party VS Code extension.

**Architecture:** A new Rust Tauri command (`complete_code`) spawns `claude --print` once per request and returns cleaned text. A new TS extension (`src/vscode-extensions/claude-completions/`) registers an `InlineCompletionItemProvider` via `registerLocalExtension`, hard-gated to only call the Rust command on `InlineCompletionTriggerKind.Invoke` (manual trigger).

**Tech Stack:** Tauri 2 / Rust (`tokio::process`), `@codingame/monaco-vscode-extension-api` (`vscode` namespace), Vitest, Cargo's built-in test harness.

## Global Constraints

- Manual trigger only — the provider MUST return `undefined`/no items for any `InlineCompletionContext.triggerKind` other than `InlineCompletionTriggerKind.Invoke` (numeric value `0`). This is a hard cost guard, not a preference.
- Prefix/suffix context sent to the backend is capped at 200 lines each side of the cursor.
- The `claude --print` call is wrapped in a 20-second timeout; on timeout the child process must be killed (no orphaned processes).
- Response cleanup (markdown-fence stripping + trim) happens exactly once, in Rust (`claude_completion.rs`). The TS side must not re-implement it.
- The new Rust module is separate from `claude_session_manager.rs` (long-lived interactive PTY sessions vs. this module's one-shot stateless request/response — different lifecycles, per the approved spec).
- Registered as a **formal extension** via `registerLocalExtension` (manifest + entry point), not a bare direct `vscode.languages.*` call — per explicit user choice in the spec.
- No custom keybinding contribution for v1 — rely on VS Code's built-in "Trigger Inline Suggestion" command.
- Per `CLAUDE.md`, `docs/dependency-map.md` must be regenerated in the same commit that adds the new `src/` files (Task 5).
- Spec reference: `docs/superpowers/specs/2026-07-02-claude-inline-completions-design.md`.

---

### Task 1: Rust — pure prompt-building and response-cleanup functions

**Files:**
- Create: `src-tauri/src/claude_completion.rs`
- Modify: `src-tauri/src/lib.rs:3` (add `mod claude_completion;`)

**Interfaces:**
- Produces: `pub(crate) fn build_completion_prompt(prefix: &str, suffix: &str, language: &str) -> String`
- Produces: `pub(crate) fn clean_completion_response(raw: &str) -> String`

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/claude_completion.rs` with just the test module (functions not yet implemented, so this won't compile — that's the "fails" state for this step; Step 2 confirms via `cargo test`, which will fail to *build*, which is an acceptable "fails" signal for a not-yet-implemented Rust function per this codebase's existing TDD style in `claude_session_manager.rs`):

```rust
#[cfg(test)]
mod tests {
    use super::{build_completion_prompt, clean_completion_response};

    #[test]
    fn prompt_includes_prefix_suffix_and_language() {
        let prompt = build_completion_prompt("fn add(a: i32, b: i32) {", "}", "rust");
        assert!(prompt.contains("Language: rust"));
        assert!(prompt.contains("fn add(a: i32, b: i32) {"));
        assert!(prompt.contains("}"));
        assert!(prompt.contains("<CURSOR>"));
        assert!(prompt.contains("No markdown fences"));
    }

    #[test]
    fn cleans_response_with_no_fence() {
        assert_eq!(clean_completion_response("  return a + b;  "), "return a + b;");
    }

    #[test]
    fn strips_fenced_response_with_language_tag() {
        let raw = "```rust\nreturn a + b;\n```";
        assert_eq!(clean_completion_response(raw), "return a + b;");
    }

    #[test]
    fn strips_fenced_response_without_language_tag() {
        let raw = "```\nreturn a + b;\n```";
        assert_eq!(clean_completion_response(raw), "return a + b;");
    }

    #[test]
    fn strips_fenced_multiline_response() {
        let raw = "```python\ndef add(a, b):\n    return a + b\n```";
        assert_eq!(clean_completion_response(raw), "def add(a, b):\n    return a + b");
    }

    #[test]
    fn empty_response_cleans_to_empty_string() {
        assert_eq!(clean_completion_response("   \n  "), "");
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test --lib claude_completion`
Expected: FAIL to compile — `cannot find function 'build_completion_prompt' in module` (and same for `clean_completion_response`).

- [ ] **Step 3: Write the minimal implementation**

Add above the test module in `src-tauri/src/claude_completion.rs`:

```rust
pub(crate) fn build_completion_prompt(prefix: &str, suffix: &str, language: &str) -> String {
    format!(
        "You are a code completion engine. Output ONLY the code to insert at <CURSOR>.\n\
         No explanation. No markdown fences.\n\
         \n\
         Language: {language}\n\
         \n\
         Code before cursor:\n\
         {prefix}\n\
         \n\
         <CURSOR>\n\
         \n\
         Code after cursor:\n\
         {suffix}\n"
    )
}

/// Strips a single leading/trailing markdown code fence (with or without a
/// language tag) if present, then trims whitespace. Models are told not to
/// use fences but don't always comply.
pub(crate) fn clean_completion_response(raw: &str) -> String {
    let mut text = raw.trim();

    if let Some(rest) = text.strip_prefix("```") {
        if let Some(first_newline) = rest.find('\n') {
            text = &rest[first_newline + 1..];
        } else {
            text = rest;
        }
        text = text.trim_end();
        if let Some(stripped) = text.strip_suffix("```") {
            text = stripped;
        }
    }

    text.trim().to_string()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test --lib claude_completion`
Expected: `test result: ok. 6 passed; 0 failed`

- [ ] **Step 5: Register the module**

In `src-tauri/src/lib.rs`, add `mod claude_completion;` alphabetically among the existing `mod` declarations (after `mod browser_pane_manager;`, before `mod claude_session_manager;`):

```rust
mod agent_hook;
mod audio;
mod browser_pane_manager;
mod claude_completion;
mod claude_session_manager;
mod commands;
```

- [ ] **Step 6: Verify the whole crate still compiles**

Run: `cd src-tauri && cargo check --lib`
Expected: no errors (a `dead_code` warning on the two new `pub(crate)` functions is expected and fine at this point — Task 2 uses them).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/claude_completion.rs src-tauri/src/lib.rs
git commit -m "feat: add pure prompt-building and response-cleanup for Claude completions"
```

---

### Task 2: Rust — wire the `complete_code` Tauri command

**Files:**
- Modify: `src-tauri/Cargo.toml` (add `tokio` dependency)
- Modify: `src-tauri/src/claude_session_manager.rs:152` and `:188` (make two helpers `pub(crate)`)
- Modify: `src-tauri/src/claude_completion.rs` (add the real command, uses Task 1's functions)
- Modify: `src-tauri/src/commands.rs` (add thin command wrapper)
- Modify: `src-tauri/src/lib.rs` (register the command in `invoke_handler`)

**Interfaces:**
- Consumes: `build_completion_prompt`, `clean_completion_response` from Task 1 (same file, no import needed).
- Consumes: `crate::claude_session_manager::resolve_claude_binary_from(path_var: &str, home: Option<&Path>) -> Result<PathBuf, String>` and `crate::claude_session_manager::claude_child_path(path_var: &str, home: Option<&Path>) -> String` — both currently private `fn`, made `pub(crate) fn` in this task.
- Produces: `pub(crate) async fn complete_code(prefix: String, suffix: String, language: String) -> Result<String, String>` in `claude_completion.rs`, wrapped by `#[tauri::command] pub async fn complete_code(...)` in `commands.rs`.

- [ ] **Step 1: Add the `tokio` dependency**

In `src-tauri/Cargo.toml`, add to `[dependencies]` (alphabetically, after `tauri-plugin-single-instance`):

```toml
tokio = { version = "1", features = ["process", "time"] }
```

- [ ] **Step 2: Make the two helper functions `pub(crate)`**

In `src-tauri/src/claude_session_manager.rs`, change:

```rust
fn resolve_claude_binary_from(path_var: &str, home: Option<&Path>) -> Result<PathBuf, String> {
```
to
```rust
pub(crate) fn resolve_claude_binary_from(path_var: &str, home: Option<&Path>) -> Result<PathBuf, String> {
```

and change:
```rust
fn claude_child_path(path_var: &str, home: Option<&Path>) -> String {
```
to
```rust
pub(crate) fn claude_child_path(path_var: &str, home: Option<&Path>) -> String {
```

- [ ] **Step 3: Note on testing `complete_code` itself**

`complete_code` reads real process env (`PATH`, `HOME`) and spawns a real
subprocess — it has no deterministic sub-behavior left to unit-test after
Task 1 already extracted and tested the pure parts (prompt building,
response cleaning). This matches the existing convention in
`claude_session_manager.rs`: `ClaudeSessionManager::spawn` (which also reads
real env and spawns a real process) has no unit test of its own either —
only its pure, explicitly-parameterized helpers (`resolve_claude_binary_from`,
`claude_candidate_paths`, `resolved_working_directory`) are tested directly,
each called with literal `path_var`/`home` arguments instead of real env.

Concretely: do **not** write a test that mutates `PATH` and calls
`complete_code` expecting a "binary not found" error — `resolve_claude_binary_from`
also falls back to `home.join(".local/bin/claude")`, `/usr/local/bin/claude`,
and `/opt/homebrew/bin/claude` regardless of `PATH`, so on any machine with
`claude` installed at one of those fixed locations (this dev machine has it
at `~/.local/bin/claude`), that test would silently pass through to the real
binary instead of failing — flaky by construction, not a real test.

The real end-to-end behavior (does a live `complete_code` call actually
return a usable completion) is validated by the manual QA step in Task 5,
against the real running app — not by a Rust unit test here.

- [ ] **Step 4: Implement `complete_code`**

Add to `src-tauri/src/claude_completion.rs` (above the test module), with the needed imports at the top of the file:

```rust
use crate::claude_session_manager::{claude_child_path, resolve_claude_binary_from};
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

const COMPLETION_TIMEOUT: Duration = Duration::from_secs(20);
```

```rust
/// One-shot, stateless code completion: spawns `claude --print` fresh for
/// each call. Separate from `claude_session_manager`'s long-lived
/// interactive PTY sessions — this has no persistent state.
pub(crate) async fn complete_code(
    prefix: String,
    suffix: String,
    language: String,
) -> Result<String, String> {
    let path_var = std::env::var("PATH").unwrap_or_default();
    let home = std::env::var("HOME").ok().map(PathBuf::from);
    let claude_binary = resolve_claude_binary_from(&path_var, home.as_deref())?;
    let child_path = claude_child_path(&path_var, home.as_deref());
    let prompt = build_completion_prompt(&prefix, &suffix, &language);

    let mut cmd = Command::new(claude_binary);
    cmd.args(["--print", "--output-format", "text", &prompt])
        .env("PATH", child_path)
        .kill_on_drop(true)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = match timeout(COMPLETION_TIMEOUT, cmd.output()).await {
        Ok(Ok(output)) => output,
        Ok(Err(e)) => return Err(format!("Claude CLI not found or failed to start: {e}")),
        Err(_) => return Err("completion timed out".to_string()),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("claude --print exited with {}", output.status)
        } else {
            stderr
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    Ok(clean_completion_response(&stdout))
}
```

- [ ] **Step 5: Verify Task 1's tests still pass with the new code in place**

Run: `cd src-tauri && cargo test --lib claude_completion`
Expected: `test result: ok. 6 passed; 0 failed` (the same 6 from Task 1 — `complete_code` itself isn't unit-tested, per Step 3's note).

- [ ] **Step 6: Add the thin Tauri command wrapper**

Append to the end of `src-tauri/src/commands.rs` (after `close_claude_session`, currently the last item in the file):

```rust
#[tauri::command]
pub async fn complete_code(prefix: String, suffix: String, language: String) -> Result<String, String> {
    crate::claude_completion::complete_code(prefix, suffix, language).await
}
```

- [ ] **Step 7: Register the command**

In `src-tauri/src/lib.rs`, add `commands::complete_code,` to the `invoke_handler(tauri::generate_handler![...])` list, after `commands::close_claude_session,` (currently the last entry):

```rust
            commands::spawn_claude_session,
            commands::write_claude_session,
            commands::stop_claude_session,
            commands::close_claude_session,
            commands::complete_code,
        ])
```

- [ ] **Step 8: Verify the whole crate builds and all tests pass**

Run: `cd src-tauri && cargo check --lib && cargo test --lib`
Expected: no build errors, all tests pass (no `dead_code` warnings remaining for the Task 1 functions, since they're now used).

- [ ] **Step 9: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/claude_session_manager.rs src-tauri/src/claude_completion.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: wire complete_code Tauri command via one-shot claude --print"
```

---

### Task 3: TS — pure completion-window guard function

**Files:**
- Create: `src/vscode-extensions/claude-completions/completionRequest.ts`
- Create: `src/vscode-extensions/claude-completions/completionRequest.test.ts`

**Interfaces:**
- Produces: `export interface LineWindow { prefixStartLine: number; suffixEndLine: number }`
- Produces: `export function computeCompletionWindow(triggerKind: number, invokeTriggerKind: number, cursorLine: number, lineCount: number, contextLines?: number): LineWindow | null`

This function takes no dependency on the `vscode` module at all (plain numbers in, plain object or `null` out), so it can be unit-tested directly without mocking `@codingame/monaco-vscode-extension-api` — matching the codebase's existing pattern of keeping pure logic (e.g. `claudeOutputParser.ts`) separate from the vscode-facing wiring.

- [ ] **Step 1: Write the failing test**

Create `src/vscode-extensions/claude-completions/completionRequest.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeCompletionWindow } from './completionRequest'

const INVOKE = 0
const AUTOMATIC = 1

describe('computeCompletionWindow', () => {
  it('returns null for a non-Invoke trigger kind (the cost guard)', () => {
    expect(computeCompletionWindow(AUTOMATIC, INVOKE, 10, 100)).toBeNull()
  })

  it('returns a window for an Invoke trigger kind', () => {
    const result = computeCompletionWindow(INVOKE, INVOKE, 10, 100)
    expect(result).not.toBeNull()
  })

  it('clamps prefixStartLine at 0 near the top of the file', () => {
    const result = computeCompletionWindow(INVOKE, INVOKE, 5, 500, 200)
    expect(result).toEqual({ prefixStartLine: 0, suffixEndLine: 205 })
  })

  it('clamps suffixEndLine at lineCount - 1 near the bottom of the file', () => {
    const result = computeCompletionWindow(INVOKE, INVOKE, 490, 500, 200)
    expect(result).toEqual({ prefixStartLine: 290, suffixEndLine: 499 })
  })

  it('uses a 200-line default context window', () => {
    const result = computeCompletionWindow(INVOKE, INVOKE, 300, 1000)
    expect(result).toEqual({ prefixStartLine: 100, suffixEndLine: 500 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/vscode-extensions/claude-completions/completionRequest.test.ts`
Expected: FAIL — `Failed to resolve import "./completionRequest"`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/vscode-extensions/claude-completions/completionRequest.ts`:

```ts
export interface LineWindow {
  prefixStartLine: number
  suffixEndLine: number
}

const DEFAULT_CONTEXT_LINES = 200

/**
 * Decides whether a completion should be requested at all (hard-gated to
 * the Invoke trigger kind — see Global Constraints in the plan) and, if so,
 * the line range to send as prefix/suffix context.
 */
export function computeCompletionWindow(
  triggerKind: number,
  invokeTriggerKind: number,
  cursorLine: number,
  lineCount: number,
  contextLines: number = DEFAULT_CONTEXT_LINES,
): LineWindow | null {
  if (triggerKind !== invokeTriggerKind) return null

  return {
    prefixStartLine: Math.max(0, cursorLine - contextLines),
    suffixEndLine: Math.min(lineCount - 1, cursorLine + contextLines),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/vscode-extensions/claude-completions/completionRequest.test.ts`
Expected: `Test Files  1 passed (1)` / `Tests  5 passed (5)`

- [ ] **Step 5: Commit**

```bash
git add src/vscode-extensions/claude-completions/completionRequest.ts src/vscode-extensions/claude-completions/completionRequest.test.ts
git commit -m "feat: add pure completion-window guard for Claude inline completions"
```

---

### Task 4: TS — extension manifest and registration

**Files:**
- Create: `src/vscode-extensions/claude-completions/manifest.ts`
- Create: `src/vscode-extensions/claude-completions/index.ts`
- Create: `src/vscode-extensions/claude-completions/index.test.ts`

**Interfaces:**
- Consumes: `registerLocalExtension(manifest: IExtensionManifest, entryPointUrl?: string): Promise<RegisteredExtension | null>` from `../extensions` (existing, `src/vscode-extensions/extensions.ts`).
- Produces: `export const claudeCompletionsManifest: IExtensionManifest` (in `manifest.ts`).
- Produces: `export async function registerClaudeCompletionExtension(): Promise<void>` (in `index.ts`) — used by Task 5's `setup.ts` wiring.

- [ ] **Step 1: Write the failing test**

Create `src/vscode-extensions/claude-completions/index.test.ts`. This mocks `../extensions` directly (not `@codingame/monaco-vscode-api/extensions`) since `index.ts` only ever talks to our own registry module, never to the raw vscode-api package:

```ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('../extensions', () => ({
  registerLocalExtension: vi.fn().mockResolvedValue({ id: 'termspace.claude-completions', api: {}, dispose: vi.fn() }),
}))

describe('registerClaudeCompletionExtension', () => {
  it('registers the claude-completions manifest with an entry point URL', async () => {
    const { registerClaudeCompletionExtension } = await import('./index')
    const { registerLocalExtension } = await import('../extensions')

    await registerClaudeCompletionExtension()

    expect(registerLocalExtension).toHaveBeenCalledTimes(1)
    const [manifestArg, entryPointArg] = (registerLocalExtension as any).mock.calls[0]
    expect(manifestArg).toMatchObject({
      name: 'claude-completions',
      publisher: 'termspace',
      main: './extension.js',
    })
    expect(typeof entryPointArg).toBe('string')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/vscode-extensions/claude-completions/index.test.ts`
Expected: FAIL — `Failed to resolve import "./index"` (neither `manifest.ts` nor `index.ts` exist yet).

- [ ] **Step 3: Write the manifest**

Create `src/vscode-extensions/claude-completions/manifest.ts`:

```ts
import type { IExtensionManifest } from '@codingame/monaco-vscode-api/extensions'

export const claudeCompletionsManifest: IExtensionManifest = {
  name: 'claude-completions',
  publisher: 'termspace',
  version: '0.0.1',
  engines: { vscode: '^1.94.0' },
  main: './extension.js',
  activationEvents: ['onStartupFinished'],
}
```

- [ ] **Step 4: Write the registration function**

Create `src/vscode-extensions/claude-completions/index.ts`:

```ts
import { registerLocalExtension } from '../extensions'
import { claudeCompletionsManifest } from './manifest'

/**
 * Registers the first-party Claude inline-completions extension. Called
 * once from setup.ts's initializeExtensions(), after the language default
 * extensions are registered.
 */
export async function registerClaudeCompletionExtension(): Promise<void> {
  const entryPointUrl = new URL('./extension.ts', import.meta.url).toString()
  await registerLocalExtension(claudeCompletionsManifest, entryPointUrl)
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/vscode-extensions/claude-completions/index.test.ts`
Expected: `Test Files  1 passed (1)` / `Tests  1 passed (1)`

Note: `extension.ts` doesn't exist as a real file yet at this point in the plan — that's fine for this test, since `new URL('./extension.ts', import.meta.url)` only constructs a URL string; it does not import or execute the file. Task 5 creates `extension.ts` before this is exercised for real.

- [ ] **Step 6: Commit**

```bash
git add src/vscode-extensions/claude-completions/manifest.ts src/vscode-extensions/claude-completions/index.ts src/vscode-extensions/claude-completions/index.test.ts
git commit -m "feat: add Claude completions extension manifest and registration"
```

---

### Task 5: TS — the real extension entry point and setup.ts wiring

**Files:**
- Create: `src/vscode-extensions/claude-completions/extension.ts`
- Modify: `src/vscode-extensions/setup.ts` (call `registerClaudeCompletionExtension()`)
- Modify: `docs/dependency-map.md` (regenerate — required by `CLAUDE.md` whenever `src/` files are added)

**Interfaces:**
- Consumes: `computeCompletionWindow` from `./completionRequest` (Task 3).
- Consumes: `invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>` from `../../utils/tauri` (existing).
- Consumes: the `complete_code` Tauri command from Task 2 (invoked as `invoke<string>('complete_code', { prefix, suffix, language })`).
- Produces: `export function activate(context: vscode.ExtensionContext): void` — the manifest's `main` entry point, loaded by the extension host at `onStartupFinished`.

This file imports the real `vscode` module (aliased to `@codingame/monaco-vscode-extension-api`, a heavy package) — per the plan's file-list rationale, it is **not** unit-tested (see Global Constraints / spec: this is validated by manual QA, not automated tests, to avoid pulling the real vscode-api runtime into Vitest).

- [ ] **Step 1: Write `extension.ts`**

Create `src/vscode-extensions/claude-completions/extension.ts`:

```ts
import * as vscode from 'vscode'
import { invoke } from '../../utils/tauri'
import { computeCompletionWindow } from './completionRequest'

export function activate(_context: vscode.ExtensionContext): void {
  vscode.languages.registerInlineCompletionItemProvider('*', {
    async provideInlineCompletionItems(document, position, context) {
      const window = computeCompletionWindow(
        context.triggerKind,
        vscode.InlineCompletionTriggerKind.Invoke,
        position.line,
        document.lineCount,
      )
      if (!window) return undefined

      const prefix = document.getText(
        new vscode.Range(new vscode.Position(window.prefixStartLine, 0), position),
      )
      const suffixEndLine = document.lineAt(window.suffixEndLine)
      const suffix = document.getText(new vscode.Range(position, suffixEndLine.range.end))

      let result: string
      try {
        result = await invoke<string>('complete_code', {
          prefix,
          suffix,
          language: document.languageId,
        })
      } catch (err) {
        console.error('[claude-completions] complete_code failed:', err)
        return undefined
      }

      if (!result) return undefined

      return [new vscode.InlineCompletionItem(result)]
    },
  })
}
```

- [ ] **Step 2: Wire it into `setup.ts`**

In `src/vscode-extensions/setup.ts`, add the import near the existing `registerDefaultExtensions` import:

```ts
import { registerDefaultExtensions } from './default-extensions'
import { registerClaudeCompletionExtension } from './claude-completions'
```

Then in `initializeExtensions()`, call it right after `registerDefaultExtensions()`:

```ts
    // Register default extensions AFTER services are initialized.
    // Dynamic imports ensure the extension manifests register against
    // the live extension service override.
    await registerDefaultExtensions()
    await registerClaudeCompletionExtension()
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full existing test suite to confirm nothing broke**

Run: `npx vitest run`
Expected: same pass/fail counts as before this plan (the pre-existing `FileTree.test.tsx` / `NativeTerminalPane.test.tsx` / `typing-performance.test.ts` failures are unrelated and pre-date this work — see prior session notes; do not attempt to fix them here), plus all new tests from Tasks 3 and 4 passing.

- [ ] **Step 5: Regenerate the dependency map**

Per `CLAUDE.md`, this is required in the same commit that adds new `src/` files:

```bash
node scripts/gen-dep-map.js
```

- [ ] **Step 6: Manual QA (cannot be automated — see spec)**

1. Run `npm run tauri dev`.
2. Open a file in an `EditorPane`.
3. Place the cursor somewhere in the code.
4. Open the command palette and run "Trigger Inline Suggestion" (VS Code's built-in command, default keybinding — check your OS's default, e.g. `Alt+\` on some layouts, or use the command palette if unsure).
5. Confirm: ghost text appears at the cursor within a few seconds (the `claude --print` round trip), and pressing `Tab` accepts it into the document.
6. Confirm: typing normally (without invoking the command) does **not** trigger any completion or backend call — check this by watching for `complete_code` activity (e.g. temporarily add a `console.log` before the `invoke` call if needed for local verification, then remove it before committing).

- [ ] **Step 7: Commit**

```bash
git add src/vscode-extensions/claude-completions/extension.ts src/vscode-extensions/setup.ts docs/dependency-map.md
git commit -m "feat: activate Claude inline completions in the Monaco editor"
```

---

## Post-Plan Notes

- Selection-aware actions ("Explain", "Fix", "Ask Claude about this") are explicitly out of scope for this plan — a future spec/plan, per the approved design doc.
- No settings-UI toggle exists yet to disable this feature; if the manual-trigger cost turns out to matter in practice, that's a follow-up, not part of this plan.
