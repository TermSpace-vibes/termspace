# Claude Inline Completions — Design

## Goal

Provide Claude-powered inline (ghost-text) code completions inside Termspace's
Monaco editor, triggered manually — not the real Anthropic "Claude Code" VS
Code extension (confirmed incompatible: it's Node-only, `require("child_process")`
/`require("fs")`/`require("net")`, no `browser` entry point, and the app's
extension host (`ExtensionHostKind.LocalProcess`) is a main-thread browser
sandbox with no real Node process behind it) but a first-party feature built
directly against the `vscode`/Monaco APIs the extension host already exposes.

## Background

Termspace already has:
- A working VS Code extension host (`src/vscode-extensions/setup.ts`,
  `extensions.ts`) built on `@codingame/monaco-vscode-api@25.1.2`, used today
  for language/theme default-extensions.
- A native, fully interactive Claude Code integration (`ClaudePane.tsx` +
  `claude_session_manager.rs`) that spawns the real `claude` CLI via a PTY.
  That integration is for chat-style interactive sessions and is intentionally
  *not* reused here — inline completions need a fast, stateless, one-shot
  request/response shape, not a running conversational session.

## Scope (v1)

- Inline ghost-text completions only, **manual trigger only** (no
  debounced/automatic-as-you-type firing). Every trigger costs one real
  `claude --print` invocation against the user's Claude Code usage/quota, so
  v1 deliberately avoids background/automatic triggering.
- Selection-aware actions ("Explain", "Fix", "Ask Claude about this") are an
  intentionally deferred follow-up — not designed here. This spec only covers
  inline completions.

## Architecture

```
setup.ts (initializeExtensions)
  └─ after registerDefaultExtensions() ──► registerClaudeCompletionExtension()

src/vscode-extensions/claude-completions/
  ├─ manifest.ts   — IExtensionManifest:
  │                  { name: 'claude-completions', publisher: 'termspace',
  │                    version: '0.0.1', engines: { vscode: '^1.94.0' },
  │                    main: './extension.js', activationEvents: ['onStartupFinished'] }
  ├─ extension.ts  — activate(context): the real VS Code extension entry point,
  │                  runs inside the LocalProcess extension host
  └─ index.ts      — registerClaudeCompletionExtension(): calls
                     registerLocalExtension(manifest, entryPointUrl) where
                     entryPointUrl = new URL('./extension.ts', import.meta.url)
                     — same registration shape as the Phase 2 loadVsixExtension
                     path, just first-party code instead of a foreign .vsix.
```

This is registered as a **formal extension** (manifest + `registerLocalExtension`),
not a bare direct API call, per explicit choice — it fits the extension-host
architecture already built in Phase 1/2, even though the feature itself only
ever needs a single instance.

### `extension.ts` — `activate(context)`

```
vscode.languages.registerInlineCompletionItemProvider('*', provider)
```

### Provider: `provideInlineCompletionItems(document, position, context, token)`

```
if context.triggerKind !== vscode.InlineCompletionTriggerKind.Invoke:
    return undefined   // hard gate — manual-only. Guards against any
                        // automatic-trigger call burning a CLI invocation,
                        // even if editor.inlineSuggest auto-trigger is on.

else:
    prefix   = text before cursor, truncated to last ~200 lines
    suffix   = text after cursor, truncated to next ~200 lines
    language = document.languageId

    result = await invoke('complete_code', { prefix, suffix, language })
    cleaned = stripMarkdownFences(result).trim()

    if cleaned is empty: return undefined
    return [ one InlineCompletionItem with cleaned as insertText ]
```

Triggering happens via VS Code's existing built-in "Trigger Inline Suggestion"
command (default keybinding, core editor functionality) — no custom keybinding
contribution needed for v1.

## Rust Backend

New module `src-tauri/src/claude_completion.rs` (kept separate from
`claude_session_manager.rs`, which owns long-lived interactive PTY sessions —
this is a different lifecycle: one-shot, stateless, request/response).

```rust
#[tauri::command]
pub async fn complete_code(prefix: String, suffix: String, language: String) -> Result<String, String>
```

**Prompt construction** (pure function, unit-testable):

```
You are a code completion engine. Output ONLY the code to insert at <CURSOR>.
No explanation. No markdown fences.

Language: {language}

Code before cursor:
{prefix}

<CURSOR>

Code after cursor:
{suffix}
```

**Execution:**
- `tokio::process::Command::new(claude_binary).args(["--print", "--output-format", "text", &prompt])`.
- Reuses the existing `resolve_claude_binary_from` / `claude_child_path`
  PATH-resolution helpers already in `claude_session_manager.rs` — no need to
  reimplement binary discovery.
- Wrapped in `tokio::time::timeout(Duration::from_secs(20), child.wait_with_output())`.
  On timeout: kill the child, return `Err("completion timed out")`.

**Response cleanup** (pure function, unit-testable): strip a leading/trailing
` ```lang ` / ` ``` ` markdown fence if present (models don't always obey the
"no markdown fences" instruction), then trim whitespace.

## Error Handling

- `claude` binary not found → same "Claude CLI not found or failed to start"
  error path already used by `claude_session_manager.rs`.
- Timeout (20s) → kill child, `Err("completion timed out")`.
- Empty/whitespace-only response after fence-stripping → treated as "no
  completion" (`Ok(String::new())`), not an error.
- Non-`Invoke` trigger kind → provider returns immediately, no Rust call at
  all (the cost guard).
- Any `Err` or empty string reaching the TS provider → returns `undefined`/no
  items. Fails open: worst case nothing happens, never a crash or stuck
  ghost-text.

## Testing

- **Rust:** prompt-building and response-cleanup are kept as small pure
  functions, unit-tested directly (same pattern as the codebase's existing
  `claude_session_manager.rs` tests). Actual CLI process spawning is not
  unit-tested (external binary dependency) — only the pure logic around it.
- **TS:** a focused test on the provider's trigger-kind guard, confirming it
  returns `undefined` for anything but `Invoke` — this is the one guard
  standing between this feature and silently burning CLI calls on every
  keystroke pause, so it gets explicit coverage.
- **Manual QA** after implementation: place the cursor in `EditorPane`, run
  "Trigger Inline Suggestion" from the command palette, confirm ghost text
  appears and Tab accepts it. This can't be meaningfully automated and follows
  the project's existing verification approach (drive the real feature, not
  just tests).

## Explicitly Out of Scope (v1)

- Automatic/debounced triggering.
- Selection-aware actions (Explain/Fix/Ask Claude) — deferred follow-up.
- Streaming partial completions (the `--print` CLI call returns once, no
  token-by-token streaming into the ghost text).
- A settings UI toggle to enable/disable the feature (can be added later if
  the manual-trigger cost turns out to matter in practice).
