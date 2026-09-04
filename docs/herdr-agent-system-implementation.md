# Herdr-Style Agent Observability & State Tracking System

## Overview

Termspace incorporates a native, real-time AI coding agent observability system modeled after **Herdr** (`github.com/herdrdev/herdr`) agent lifecycle and orchestration concepts. 

Unlike external orchestrators that require third-party background daemons or wrappers, Termspace implements this natively inside its Tauri Rust core (`src-tauri/src/agent_detection/`) and React frontend (`src/components/WorkspaceSidebar/AgentsSidebarSection.tsx`).

The system delivers:
1. **Zero-overhead agent discovery**: Automatically detects running Claude Code sessions and subagents across all workspaces and panes.
2. **Sub-300ms state detection**: Tracks active thinking, tool execution, user prompts, permission requests, and turn completions directly from the terminal screen buffer.
3. **Multi-source arbitration**: Combines terminal screen detection (primary live authority), HTTP lifecycle hooks (provisional low-latency), and filesystem JSONL transcripts (recovery/reconciliation).
4. **Presentation vs. Semantic separation**: Separates underlying semantic states (`working`, `blocked`, `idle`, `unknown`) from transient presentation states (latched `done` completion badge).
5. **Cross-workspace navigation**: 1-click focus handshake from sidebar agent cards directly into the owning workspace, tab, and terminal pane.

---

## Architecture & Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             TERMSPACE BACKEND (Rust)                        │
│                                                                             │
│  ┌───────────────────────┐  Terminal Output  ┌───────────────────────────┐  │
│  │ NativeTerminalManager │──────────────────>│ Alacritty Terminal Buffer │  │
│  │ DaemonClient (PTY)    │                   └─────────────┬─────────────┘  │
│  └───────────────────────┘                                 │                │
│                                            observe_screen_revision          │
│                                                            ▼                │
│  ┌───────────────────────┐  HTTP /hook       ┌───────────────────────────┐  │
│  │ Tiny-HTTP Hook Server │──────────────────>│                           │  │
│  └───────────────────────┘  provisional      │ AgentDetectionCoordinator │  │
│                                              │                           │  │
│  ┌───────────────────────┐  ~/.claude/*.json │ - Identity Resolver       │  │
│  │ ClaudeSessionWatcher  │──────────────────>│ - Screen Extractor (32r)  │  │
│  └───────────────────────┘  metadata/PID     │ - Manifest Gate Engine    │  │
│                                              │ - Monotonic Event Seq     │  │
│                                              │ - Latched State Machine   │  │
│                                              └─────────────┬─────────────┘  │
│                                                            │                │
│                                             app.emit("agent-state-changed") │
└────────────────────────────────────────────────────────────┼────────────────┘
                                                             │
                                                             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            TERMSPACE FRONTEND (React)                       │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                      AgentsSidebarSection.tsx                         │  │
│  │                                                                       │  │
│  │  - listen("agent-state-changed") stream processor                     │  │
│  │  - EventSequence deduplication & monotonic ordering                   │  │
│  │  - Status icons:                                                      │  │
│  │      * WORKING: Cyan rotating spinner ring                            │  │
│  │      * BLOCKED: Amber '?' badge (Needs Input / Permission)            │  │
│  │      * DONE: Green '✓' badge (latched completion)                     │  │
│  │      * IDLE: Muted slate-gray static ring                             │  │
│  │  - Metrics strip: Progress %, Duration, Tokens, Target Path           │  │
│  │  - onSelectAgent: Switches workspace, activates tab, focuses xterm    │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Breakdown

### 1. Provider Manifest Engine (`src-tauri/src/agent_detection/manifests/claude.toml`)

State detection is provider-neutral and declarative. Rules are compiled into optimized regular expressions and evaluated in descending priority order.

#### Compiled Rules:
| Priority | Rule ID | Region | State | Key Triggers / Patterns |
| :--- | :--- | :--- | :--- | :--- |
| **120** | `transcript-viewer` | `active` | `unknown` (preserve) | `(?i)transcript`, `press q to quit` |
| **110** | `permission` | `active` | `blocked` | `allow\|approve\|permission` + `1. yes\|allow` |
| **100** | `question` | `active` | `blocked` | `❯ \d+\.` + `\d+\.\s+` (interactive choices) |
| **90** | `background-work` | `active` | `working` | `(working\|running).*(background\|agent)` |
| **80** | `spinner` | `last:5` | `working` | `[✢✳✶✻✽✱✲]` stars, `+ <Action>...`, high-effort thinking phrases |
| **70** | `streaming` | `last:5` | `working` | `[•●] <text>` (active assistant markdown response streaming) |
| **50** | `input-prompt` | `active` | `idle` | `[>❯›]_? $` awaiting input + Claude footer identity |

#### Exclusions (`not` gates):
* Completion summaries (`\bfor \d+.*done|· done\b`) are explicitly excluded from the `spinner` and `streaming` rules.
* Active prompts (`[>❯›]_?$`) are excluded from `streaming` so an idle prompt is never misidentified as streaming.

---

### 2. Screen Extractor (`src-tauri/src/agent_detection/screen.rs`)

* Extracts up to **32 active rows** and at most **64 KiB** of text directly from the Alacritty terminal grid.
* Runs **outside the terminal mutex lock** to prevent blocking PTY reader threads.
* Strips trailing blank cells (`\0` and whitespace) and normalizes character boundaries.
* Supports targeted sub-regions (e.g. `last:5` for inspecting the active prompt and cursor area).

---

### 3. Identity Resolver & Process Ancestry (`src-tauri/src/agent_detection/process.rs`)

* Correlates Claude session UUIDs (`~/.claude/sessions/*.json`) with terminal targets.
* Inspects process tree ancestry (`sysinfo` process table):
  * Matches when Claude's PID is the terminal's foreground process group.
  * Matches when Claude is a direct or recursive descendant of the terminal's shell PID (`zsh`, `bash`, or daemon PTY).
* Supports remote targets over SSH/mosh via screen identity heuristics.

---

### 4. Coalescing Coordinator & State Machine (`src-tauri/src/agent_detection/tracker.rs`)

#### Semantic States:
* `unknown`: No agent currently identified.
* `working`: Claude is generating tokens, invoking tools, or executing commands.
* `blocked`: Claude is awaiting a user decision or interactive permission choice.
* `idle`: Claude is waiting for a user prompt.

#### Presentation States:
* `normal`: Standard display.
* `done`: Latched completion badge shown when transitioning from `working`/`blocked` $\rightarrow$ `idle`.
  * **Focused pane rule**: Cleared after **2000 ms** timeout or on next user keystroke.
  * **Unfocused pane rule**: Remains latched indefinitely until the user views/focuses the owning pane.

---

### 5. Frontend Visual Presentation (`src/components/WorkspaceSidebar/AgentsSidebarSection.tsx`)

#### Herdr-Style Status Badges:
* **WORKING**: Blue container (`rgba(56, 189, 248, 0.15)`), text `#38bdf8`, with rotating cyan spinner ring (`#38bdf8`).
* **NEEDS INPUT**: Amber container (`rgba(245, 158, 11, 0.22)`), text `#fbbf24`, with amber question mark icon (`?`).
* **DONE**: Green container (`rgba(34, 197, 94, 0.15)`), text `#4ade80`, with green checkmark icon (`✓`).
* **IDLE**: Clean presentation (badge hidden, static muted slate-gray ring).

#### Real-Time Deduplication:
Updates arrive via Tauri events with monotonic `eventSequence` integers. Stale or out-of-order notifications are automatically dropped.

---

## Lessons Learned & Fixed Edge Cases

1. **JSONL Polling Lag**:
   * *Problem*: Claude Code buffers JSONL transcript writes, causing completion detection to lag by 1–5 seconds.
   * *Solution*: Replaced JSONL polling with direct Alacritty terminal grid screen detection (<300 ms visible latency).
2. **Completion Summary False-Positives**:
   * *Problem*: Claude Code prints summary lines starting with an asterisk (`* Worked for 1s · done 10:39 PM`, `* Churned for 27s`, `* Crunched for 2s`). The `spinner` rule's character class included `*`, permanently locking completed turns into `WORKING`.
   * *Solution*: Removed bare `*` from spinner glyphs and added `not = ["(?i)(\\bfor\\s+\\d+.*done|·\\s*done\\b)"]`.
3. **Dynamic Thinking & Tool Verbs**:
   * *Problem*: Sonnet 5 uses creative verbs (`+ Effecting...`, `✱ Harmonizing...`, `Cogitating...`, `Pondering...`) that failed fixed keyword matching.
   * *Solution*: Broadened to prefix syntax (`+ <Action>...`), Unicode star classes (`[✢✳✶✻✽✱✲·*]`), and effort phrases (`(?i)thinking with (high|medium|low) effort`).
4. **Scrolled Long Sessions**:
   * *Problem*: After multi-turn conversations, the initial `Claude Code v2.1.260` banner scrolls off the 32-row buffer, causing the identity gate to fail.
   * *Solution*: Added terminal footer indicators (`\[(Sonnet|Opus|Haiku|Claude)`, `auto mode on`, `What should Claude do instead?`) to the identity gate whitelist.
5. **Prompt with Underscores**:
   * *Problem*: Claude Code's interactive prompt uses `>_ `, which failed `[>❯]`.
   * *Solution*: Updated prompt regex to `(?m)^\s*[>❯›]_?\s*$`.
6. **Cargo Build Tracking**:
   * *Problem*: Cargo does not track embedded `.toml` files by default, causing edited manifests to be missed during rebuilds.
   * *Solution*: Added `println!("cargo:rerun-if-changed=src/agent_detection/manifests/claude.toml")` in `src-tauri/build.rs`.

---

## Verification & Automated Test Scenarios

The system is continuously protected by automated multi-layer test suites:

* **Rust Detection & Unit Suite**: 175 tests in `src-tauri` (`cargo test`)
* **Daemon PTY Suite**: 8 tests (`cargo test --bin termspace-daemon`)
* **Automated Agent Scenarios Runner**: `node scripts/test-agent-scenarios.js`
  1. *Scenario 1*: Rust backend state machine & path scoping unit tests.
  2. *Scenario 2*: Frontend sidebar agent state rendering & interaction tests.
  3. *Scenario 3*: Workspace navigation and terminal focus handshake on agent selection.
  4. *Scenario 4*: Full 46-file project regression test gate.
