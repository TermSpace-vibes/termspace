# Native Terminal Backend Design

**Date:** 2026-06-07  
**Status:** Approved

## Overview

Replace xterm.js with a fully native, in-process terminal backend. The VT state machine moves to Rust (`alacritty_terminal` crate), which maintains a parsed cell grid and emits serialized snapshots to the frontend via Tauri events. The frontend renders with a custom Canvas 2D renderer (Phase 1), then a WebGL instanced renderer (Phase 2). No external JS terminal library.

## Why

The previous approach (xterm.js + raw PTY bytes → frontend) worked but kept all terminal intelligence in JavaScript. Moving the VT parser to Rust means:
- Rust can inspect terminal content (enables future: AI features, semantic command detection, server-side search)
- Clean architecture: PTY I/O + VT state in Rust, pure rendering in the frontend
- Full ownership of the rendering pipeline for WebGL optimisation

## What Gets Reverted First

All 10 Ghostty-embedding commits are reverted before any new code is written:

```
8c348e9  fix: load CGSDefaultConnection and CGSSetWindowGeometry via dlsym
6210d9e  feat: add Terminal Engine selector to Settings → Application tab
afb5999  feat: wire GhosttyPane into layout rendering and new-pane flow
8352f13  fix: add ghostty command stubs to mock Tauri invoke
87a0021  feat: add GhosttyPane transparent placeholder component
1672bc1  feat: register GhosttyManager and five Ghostty Tauri commands
d2435c9  feat: add GhosttyManager with macOS window embedding
37e3a1b  feat: add ghosttyPanesByWorkspace store slice
501ede1  fix: add ghostty to leaf-type guards in layout helpers
0310393  feat: add GhosttyPane type and layout helpers
```

Files deleted by revert: `ghostty_manager.rs`, `GhosttyPane.tsx`, ghostty layout helpers, ghostty store slice, Ghostty commands in `lib.rs` / `commands.rs`, `core-graphics` / `core-foundation` Cargo deps, `defaultTerminalType` setting.

## Architecture

```
PTY bytes
   │
   ▼
portable-pty reader thread
   │
   ▼
alacritty_terminal::Term::process()
   │  (maintains cell grid, cursor, scrollback)
   ▼
serialize visible grid → TerminalSnapshot
   │
   ▼  (Tauri event: native-terminal-update-{id})
NativeTerminalPane.tsx
   │
   ▼
Canvas 2D renderer (Phase 1) → WebGL renderer (Phase 2)
```

## Rust — `NativeTerminalManager`

**File:** `src-tauri/src/native_terminal_manager.rs`  
**Replaces:** `src-tauri/src/pty_manager.rs` (deleted)

### Per-terminal handle

```rust
struct NativeTerminalHandle {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    term:   Arc<Mutex<Term<TermEventSender>>>,
    child:  Box<dyn portable_pty::Child + Send + Sync>,
    cwd:    Arc<Mutex<String>>,
    title:  Arc<Mutex<String>>,
}

pub struct NativeTerminalManager {
    handles: Mutex<HashMap<String, NativeTerminalHandle>>,
}
```

### Event listener

```rust
struct TermEventSender {
    terminal_id: String,
    app_handle:  AppHandle,
    cwd:         Arc<Mutex<String>>,
    title:       Arc<Mutex<String>>,
}

impl EventListener for TermEventSender {
    fn send_event(&self, event: Event) {
        match event {
            Event::Title(t) => { *self.title.lock().unwrap() = t; }
            Event::Bell     => { /* emit bell event to frontend */ }
            _               => {}
        }
    }
}
```

OSC 7 (CWD) and OSC 99 (notifications) are handled by scanning raw PTY bytes for `\x1b]7;` and `\x1b]99;` sequences in the reader thread before forwarding bytes to `Term::process()`. This avoids implementing a secondary OSC parser and keeps both handlers consistent.

### Spawn flow

1. Open PTY pair via `native_pty_system().openpty(PtySize { cols, rows, .. })`
2. Spawn shell command (same env: `TERM=xterm-256color`, `-l` login flag)
3. Create `SizeInfo` and `Term<TermEventSender>` with default `Config`
4. Take PTY reader; spawn background thread:
   ```
   loop:
     read up to 4 KB from PTY
     term.lock().process(bytes)
     mark dirty = true
     if idle for 8 ms OR dirty buffer > threshold:
       emit snapshot event
       dirty = false
   ```
5. Store handle in map

### `TerminalSnapshot` (emitted as JSON via Tauri event)

```rust
#[derive(Serialize)]
pub struct TerminalSnapshot {
    pub cols:           u16,
    pub rows:           u16,
    pub cursor_col:     u16,
    pub cursor_row:     u16,
    pub cursor_visible: bool,
    pub cells:          Vec<SnapshotCell>,  // row-major, visible grid only (cols × rows)
    pub cwd:            Option<String>,
    pub title:          Option<String>,
}

#[derive(Serialize)]
pub struct SnapshotCell {
    pub ch:    String,  // character; empty string = space
    pub fg:    u32,     // packed 0xAARRGGBB
    pub bg:    u32,     // packed 0xAARRGGBB
    pub flags: u8,      // BOLD=1, ITALIC=2, UNDERLINE=4, STRIKETHROUGH=8, DIM=16
}
```

Total payload for 80×24: ~1920 cells × ~20 bytes ≈ 38 KB JSON. Acceptable for local IPC; can be optimised to binary MessagePack in a future pass if needed.

### Tauri commands

| Command | Args | Replaces |
|---|---|---|
| `spawn_terminal` | `id, shell, cwd, cols, rows` | `spawn_terminal` + `start_terminal` (merged — no two-step) |
| `write_terminal` | `id, data: String` | `write_pty` |
| `resize_terminal` | `id, cols, rows` | `resize_pty` |
| `kill_terminal` | `id` | `close_terminal` |
| `search_terminal` | `id, query: String` → `Vec<SearchMatch>` | new |
| `scroll_terminal` | `id, delta: i32` | new |
| `get_terminal_cwd` | `id` → `String` | derived from OSC 7 |

`SearchMatch` = `{ row: u16, col_start: u16, col_end: u16 }`. Search scans the full scrollback grid in Rust.

### Scrollback

`alacritty_terminal` maintains its own scrollback buffer (configurable line count, default 10 000). `scroll_terminal(id, delta)` calls `term.scroll_display(Scroll::Delta(delta))`, then emits a new snapshot. No frontend-side scrollback cache needed.

### OSC 7 and OSC 99 (CWD + notifications)

The PTY reader thread scans raw bytes for `\x1b]7;file://` (CWD) and `\x1b]99;NeedsAttention=` (notifications) before forwarding to `Term::process()`. On OSC 7 match: update the `cwd` Arc and include it in the next snapshot. On OSC 99 match: emit `native-terminal-notification-{id}` Tauri event to frontend.

## Frontend — `NativeTerminalPane.tsx`

**File:** `src/components/WorkspaceView/NativeTerminalPane.tsx`  
**Replaces:** `src/components/WorkspaceView/TerminalPane.tsx` (deleted after migration)

### Props (identical interface to `TerminalPane`)

```ts
interface Props {
  terminalId:      string
  workspaceId:     string
  isActive:        boolean
  isMaximized:     boolean
  onFocus:         () => void
  onToggleMaximize:() => void
  onClose:         () => void
  onSplit:         (dir: 'horizontal' | 'vertical') => void
  isDragOver?:     boolean
}
```

### State and refs

```ts
const canvasRef   = useRef<HTMLCanvasElement>(null)
const cellBuf     = useRef<SnapshotCell[][]>([])  // [row][col]
const cursor      = useRef({ col: 0, row: 0, visible: true })
const cellW       = useRef(0)
const cellH       = useRef(0)
const frameQueued = useRef(false)
const renderer    = useRef<CanvasRenderer | WebGLRenderer | null>(null)
```

No React state is updated on terminal output — all rendering goes through the canvas directly.

### Mount sequence

1. Measure cell dimensions with offscreen Canvas 2D:
   ```ts
   const ctx = document.createElement('canvas').getContext('2d')!
   ctx.font = `${fontSize}px "${fontFamily}"`
   cellW.current = ctx.measureText('M').width
   cellH.current = fontSize * 1.4
   ```
2. Detect WebGL2 support → instantiate `WebGLRenderer` or `CanvasRenderer`
3. `invoke('spawn_terminal', { id, shell, cwd, cols, rows })`
4. Listen for `native-terminal-update-{id}` → update `cellBuf` + cursor refs → queue rAF
5. Listen for `native-terminal-notification-{id}` → update store notification badge

### Phase 1 — `CanvasRenderer`

**File:** `src/components/WorkspaceView/renderers/CanvasRenderer.ts`

```ts
class CanvasRenderer {
  render(canvas: HTMLCanvasElement, cells: SnapshotCell[][], cursor: CursorState, cellW: number, cellH: number): void
}
```

Render passes (minimises Canvas state changes):

1. **Background pass:** iterate cells, group contiguous runs of same `bg` → one `fillRect` per run
2. **Text pass:** group cells by `(fg, flags)` key → one `fillStyle` + font change per group, then `fillText` per non-space cell
3. **Cursor pass:** `fillRect` at cursor position with accent color, XOR blend or clip for char visibility

### Phase 2 — `WebGLRenderer`

**File:** `src/components/WorkspaceView/renderers/WebGLRenderer.ts`

```ts
class WebGLRenderer {
  private gl:          WebGL2RenderingContext
  private atlas:       GlyphAtlas
  private program:     WebGLProgram
  private instanceBuf: WebGLBuffer

  render(cells: SnapshotCell[][], cursor: CursorState, cellW: number, cellH: number): void
}
```

#### GlyphAtlas

`src/components/WorkspaceView/renderers/GlyphAtlas.ts`

- Offscreen `<canvas>` sized 1024×1024 (expandable)
- On first encounter of `(ch, bold, italic)` → render glyph to atlas, record UV rect
- Upload atlas as `gl.RGBA` texture; re-upload only when new glyphs added
- `getUV(ch, flags): [u0, v0, u1, v1]`

#### Instance buffer layout (per cell, 8 × float32 = 32 bytes)

```
[col_f32, row_f32, atlas_u0_f32, atlas_v0_f32, atlas_u1_f32, atlas_v1_f32, fg_packed_f32, bg_packed_f32]
```

`fg_packed_f32` and `bg_packed_f32` store the packed ARGB `u32` bit-cast to `f32` (no value conversion — read back in the shader with `floatBitsToUint`).

Rebuilt every frame from `cellBuf`; uploaded via `gl.bufferSubData`.

#### Shaders

**Vertex shader** (quad instancing):
```glsl
#version 300 es
layout(location=0) in vec2  a_quad;       // unit quad corner [0,1]²  (non-instanced)
layout(location=1) in float a_col;        // instance: grid column
layout(location=2) in float a_row;        // instance: grid row
layout(location=3) in vec2  a_uv_min;     // instance: atlas UV top-left
layout(location=4) in vec2  a_uv_max;     // instance: atlas UV bottom-right
layout(location=5) in float a_fg_packed;  // instance: fg color as floatBitsToUint
layout(location=6) in float a_bg_packed;  // instance: bg color as floatBitsToUint

uniform vec2 u_cell_size;  // (cellW, cellH) in pixels
uniform vec2 u_canvas;     // canvas (width, height) in pixels

out vec2      v_uv;
flat out vec4 v_fg;
flat out vec4 v_bg;

vec4 unpackColor(float packed) {
  uint u = floatBitsToUint(packed);
  return vec4(float((u>>16)&0xFFu), float((u>>8)&0xFFu), float(u&0xFFu), float((u>>24)&0xFFu)) / 255.0;
}

void main() {
  vec2 pos = (vec2(a_col, a_row) + a_quad) * u_cell_size;
  gl_Position = vec4((pos / u_canvas) * 2.0 - 1.0, 0.0, 1.0);
  gl_Position.y = -gl_Position.y;
  v_uv = mix(a_uv_min, a_uv_max, a_quad);
  v_fg = unpackColor(a_fg_packed);
  v_bg = unpackColor(a_bg_packed);
}
```

**Fragment shader:**
```glsl
#version 300 es
precision mediump float;

uniform sampler2D u_atlas;
in      vec2      v_uv;
flat in vec4      v_fg;
flat in vec4      v_bg;
out     vec4      out_color;

void main() {
  float alpha = texture(u_atlas, v_uv).r;
  out_color = mix(v_bg, v_fg, alpha);
}
```

Three draw calls per frame: background quads (no atlas), glyph quads, cursor quad.

### Input handling

Keyboard events on the canvas div:
- `onKeyDown` → synthesise escape sequences for arrows, F-keys, option combos → `invoke('write_terminal', { id, data })`
- Backspace / Option+Backspace / Cmd+Backspace → same codes as current TerminalPane
- Global keybinding handler forwarded via `keybindingHandlerRef` (identical pattern)

ResizeObserver → recalculate `cols = floor(width / cellW)`, `rows = floor(height / cellH)` → `invoke('resize_terminal', { id, cols, rows })`.

### Search

Cmd+F opens inline search bar → `invoke('search_terminal', { id, query })` → returns `SearchMatch[]` → renderer draws highlight rects on matched cells as a fourth draw pass (or Canvas 2D rect overlay).

### Scrollback navigation

PageUp / PageDown → `invoke('scroll_terminal', { id, delta: ±rows })` → Rust scrolls the `alacritty_terminal` display → emits new snapshot. Scroll position reset to 0 on any keypress.

## Feature Parity Checklist

| Feature | xterm.js (current) | Native (new) |
|---|---|---|
| VT100/VT220/xterm-256color | xterm.js parser | alacritty_terminal |
| WebGL rendering | xterm WebglAddon | Phase 2 WebGLRenderer |
| OSC 7 CWD tracking | xterm OSC handler | Rust PTY reader |
| OSC 99 notifications | xterm OSC handler | Rust PTY reader |
| Title (OSC 0/2) | xterm OSC handler | alacritty_terminal Event::Title |
| Scrollback (10 000 lines) | xterm scrollback | alacritty_terminal built-in |
| Search | xterm SearchAddon (frontend) | Rust grid scan |
| Web link detection | xterm WebLinksAddon | Phase 2 addition (Rust URL scan) |
| Serialization / restore | xterm SerializeAddon | Rust scrollback (no frontend cache) |
| Bell | xterm onBell | alacritty_terminal Event::Bell |
| Resize (SIGWINCH) | PTY resize ioctl | PTY resize ioctl (unchanged) |
| Drag-to-reorder | header drag | header drag (unchanged) |
| Title rename | double-click | double-click (unchanged) |

Web link click-to-open-browser is deferred to a follow-up (post-MVP).

## What Is NOT Changing

- Layout system (`LayoutNode`, split/resize, `TerminalGrid`) — new component slots in as a drop-in for `TerminalPane`
- Store shape (`terminalsByWorkspace`, `addTerminal`, `removeTerminal`) — same types
- Workspace switching / show-hide lifecycle — unchanged
- Database schema — terminals still ephemeral (no DB change)
- BrowserPane, EditorPane — untouched

## Out of Scope

- Image / Sixel graphics protocol
- Ligature rendering (font shaping requires HarfBuzz; deferred)
- Web link detection in Phase 1
- Cross-platform (Linux/Windows) — macOS first, same as today
- True 60 fps animation (cursor blink via CSS, not shader animation)
