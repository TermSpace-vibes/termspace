# Dictation Model Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional post-install download support for the local Whisper dictation model while preserving the existing bundled-model behavior.

**Architecture:** Keep `transcribe_chunk` unchanged at the call site by continuing to read a single managed `WhisperState`. Add a small Rust model manager module that resolves downloaded-first then bundled fallback, validates files by size and SHA-256, downloads to a `.part` file, atomically installs the model, and hot-swaps the in-memory `WhisperContext`. Add Settings UI controls that query model status, start downloads, show progress, and retry failures.

**Tech Stack:** Tauri v2 Rust commands, `whisper-rs`, `reqwest`, `sha2`, React 19/TypeScript, Vitest.

---

### Task 1: Rust Model Manager

**Files:**
- Create: `src-tauri/src/dictation_model.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/commands.rs`
- Test: `cargo test dictation_model --lib`

- [ ] **Step 1: Write failing tests**

Add tests in `src-tauri/src/dictation_model.rs` for:
- Missing downloaded model reports `missing`.
- Valid downloaded model wins over bundled model.
- Invalid `.part` file is ignored.
- SHA mismatch reports corrupted.

- [ ] **Step 2: Run tests to verify failure**

Run: `cargo test dictation_model --lib`
Expected: FAIL before the module and functions exist.

- [ ] **Step 3: Implement model manager**

Create:
- `MODEL_FILE_NAME = "ggml-base.en.bin"`
- `MODEL_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"`
- `MODEL_SHA256 = "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002"`
- `MODEL_SIZE_BYTES = 147_951_465`
- path helpers for app data model directory
- `inspect_model_files(downloaded_path, bundled_path) -> DictationModelStatus`
- `load_whisper_context_from_path(path) -> Result<WhisperContext, String>`

- [ ] **Step 4: Run tests to verify pass**

Run: `cargo test dictation_model --lib`
Expected: PASS for all dictation model manager tests.

### Task 2: Tauri Commands

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add commands**

Add commands:
- `get_dictation_model_status(app: AppHandle) -> Result<DictationModelStatus, String>`
- `load_dictation_model(app: AppHandle, state: State<WhisperState>) -> Result<DictationModelStatus, String>`
- `download_dictation_model(app: AppHandle, state: State<WhisperState>) -> Result<DictationModelStatus, String>`

Download behavior:
- skip when final file already exists and checksum/size match
- remove stale `.part` before retry
- stream response to `.part`
- emit `dictation-model-download-progress` with `{ downloadedBytes, totalBytes, progress }`
- verify size and SHA
- rename `.part` to final file
- load downloaded model and replace `WhisperState`
- keep current context if load fails

- [ ] **Step 2: Register commands**

Add the three commands to `tauri::generate_handler!` in `src-tauri/src/lib.rs`.

- [ ] **Step 3: Verify Rust compile**

Run: `cargo test dictation_model --lib`
Expected: PASS.

### Task 3: Settings UI

**Files:**
- Modify: `src/components/SettingsModal/SettingsModal.tsx`
- Modify: `src/types/index.ts` only if shared types are needed
- Test: `src/components/SettingsModal/SettingsModal.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Add tests that mock Tauri invoke/listen and verify:
- local provider shows model status.
- missing downloaded model shows `Download Local Model`.
- progress event updates the progress label.
- failed download shows retry text.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- src/components/SettingsModal/SettingsModal.test.tsx`
Expected: FAIL before UI exists.

- [ ] **Step 3: Implement UI**

In Settings → Dictation:
- fetch `get_dictation_model_status` on mount
- listen for `dictation-model-download-progress`
- show source: downloaded, bundled fallback, missing, corrupted, downloading, or error
- call `download_dictation_model` from the button
- after success, show installed/downloaded state without restart

- [ ] **Step 4: Run UI tests**

Run: `npm test -- src/components/SettingsModal/SettingsModal.test.tsx`
Expected: PASS.

### Task 4: Integration Verification

**Files:**
- Modify only if tests reveal integration issues.

- [ ] **Step 1: Run focused frontend tests**

Run: `npm test -- src/components/SettingsModal/SettingsModal.test.tsx src/components/ui/DictationButton.test.tsx`
Expected: PASS.

- [ ] **Step 2: Run Rust tests**

Run: `cargo test --lib dictation_model`
Expected: PASS.

- [ ] **Step 3: Run production build**

Run: `npm run build`
Expected: PASS.

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: PASS.

### Self-Review

- Requirement coverage: downloaded model support, app data storage, pre-download existence checks, progress, retry, incomplete/corrupt download handling, hot load, bundled fallback, and no dictation call-site breakage are covered.
- Placeholder scan: no TBD/TODO placeholders.
- Type consistency: Rust status is serialized as camelCase; React consumes matching camelCase properties.
