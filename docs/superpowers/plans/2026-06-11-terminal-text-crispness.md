# Terminal Text Rendering Crispness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate sub-pixel interpolation blur in both WebGL and Canvas 2D terminal renderers by enforcing that every physical dimension (cell size, canvas size, glyph atlas slot size) is an exact integer number of device pixels.

**Architecture:** Integer-snap all physical pixel quantities at the point they're derived from DPR using `Math.ceil(logicalSize * dpr)` everywhere. Switch the WebGL glyph atlas texture filter from `LINEAR` to `NEAREST` so sampling is exact at 1:1 texel-to-pixel scale. Derive canvas backing-store size from `cols × pCellW` (integer × integer) to avoid 1px drift at edges.

**Tech Stack:** TypeScript, Canvas 2D, WebGL2, React, Tauri webview

---

## File Map

| File | Change |
|------|--------|
| `src/components/WorkspaceView/renderers/GlyphAtlas.ts` | `LINEAR` → `NEAREST` texture filter; expose `slotW`/`slotH` public getters |
| `src/components/WorkspaceView/renderers/WebGLRenderer.ts` | Pass `Math.ceil` physical sizes to GlyphAtlas ctor; use integer pCellW/pCellH in `render()` |
| `src/components/WorkspaceView/renderers/CanvasRenderer.ts` | Integer canvas size from `cols * Math.ceil(cellW * dpr)`; add `imageSmoothingEnabled = false` |
| `src/components/WorkspaceView/NativeTerminalPane.tsx` | ResizeObserver: use `devicePixelContentBoxSize` when available; dev-mode integer assertion |
| `src/components/WorkspaceView/renderers/CanvasRenderer.test.ts` | New test: canvas backing-store width equals `cols * Math.ceil(cellW * dpr)` |

---

## Task 1: GlyphAtlas — Switch to NEAREST filtering

**Files:**
- Modify: `src/components/WorkspaceView/renderers/GlyphAtlas.ts:106-107`

The atlas uses `gl.LINEAR` filtering (lines 106–107). With `NEAREST`, sampling is exact when each glyph quad maps 1:1 to atlas texels. The existing `pad = 1` gutter (line 62) already prevents bleeding — no change needed there. The integer invariant on `this.cellW` is guaranteed by Task 2 (WebGLRenderer constructor will pass pre-ceiled integer values).

**Invariant:** `NEAREST` is only correct when quad physical size === atlas slot physical size. Both are `Math.ceil(cellW * dpr)` after Task 2. Never scale glyph quads independently.

- [ ] **Step 1: Expose atlas slot dimensions as public getters**

The `cellW`/`cellH` constructor parameters in `GlyphAtlas` are `private`. Task 2 needs to read them from `WebGLRenderer.render()` for the NEAREST invariant guard. Add two public getters **before** `getOrInsert` (after line 53):

```typescript
// Add after line 53 (end of constructor), before getOrInsert:
/** Physical pixel width of each atlas slot — equals Math.ceil(logicalCellW × dpr) */
get slotW(): number { return this.cellW }
/** Physical pixel height of each atlas slot — equals Math.ceil(logicalCellH × dpr) */
get slotH(): number { return this.cellH }
```

- [ ] **Step 2: Change LINEAR to NEAREST in `upload()`**

In `GlyphAtlas.ts`, replace lines 106–107:

```typescript
// Before:
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

// After:
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
```

- [ ] **Step 3: Run existing tests**

```bash
npm run test -- --run 2>&1 | tail -20
```

Expected: all tests pass (no type or import regressions).

- [ ] **Step 4: Commit**

```bash
git add src/components/WorkspaceView/renderers/GlyphAtlas.ts
git commit -m "fix(atlas): NEAREST filter + expose slotW/slotH for invariant guard"
```

---

## Task 2: WebGLRenderer — Integer physical cell sizes in constructor and render()

**Files:**
- Modify: `src/components/WorkspaceView/renderers/WebGLRenderer.ts:213-214` (constructor)
- Modify: `src/components/WorkspaceView/renderers/WebGLRenderer.ts:308-313` (render method)

The constructor passes `cellW * dpr` (potentially fractional) to GlyphAtlas (line 214). `render()` also uses `cellW * dpr` directly (line 308–309). Both must use `Math.ceil(cellW * dpr)` so the NEAREST invariant holds (quad size === atlas slot size).

Canvas size is currently `Math.round(cols * pCellW)` (line 312–313). With integer pCellW this should be `cols * pCellW` exactly — no rounding needed, no 1px drift at edges.

- [ ] **Step 1: Fix constructor to pass integer physical sizes to GlyphAtlas**

In `WebGLRenderer.ts`, replace line 214:

```typescript
// Before:
this.atlas = new GlyphAtlas(gl, cellW * dpr, cellH * dpr, fontSize * dpr, fontFamily)

// After:
this.atlas = new GlyphAtlas(
  gl,
  Math.ceil(cellW * dpr),
  Math.ceil(cellH * dpr),
  Math.ceil(fontSize * dpr),
  fontFamily,
)
```

- [ ] **Step 2: Fix render() to use integer pCellW/pCellH, exact canvas size, and correct CSS size**

The existing code at lines 308–320 computes `pCellW`, `w`/`h`, and then sets `canvas.style.width`. Replace lines 308–320 in full so the CSS style assignment is visible and confirmed correct:

```typescript
// Before (lines 308–320):
const pCellW = cellW * dpr
const pCellH = cellH * dpr

const w = Math.round(cols * pCellW)
const h = Math.round(rows * pCellH)
if (canvas.width !== w || canvas.height !== h) {
  canvas.width = w
  canvas.height = h
  if ('style' in canvas) {
    canvas.style.width = `${w / dpr}px`
    canvas.style.height = `${h / dpr}px`
  }
}

// After:
const pCellW = Math.ceil(cellW * dpr)   // integer physical pixels per cell
const pCellH = Math.ceil(cellH * dpr)

// Canvas size from cells × integer cell size — exact, no rounding drift.
const w = cols * pCellW
const h = rows * pCellH
if (canvas.width !== w || canvas.height !== h) {
  canvas.width = w
  canvas.height = h
  // CSS size must match exactly — w/dpr gives back the exact logical size, so the
  // compositor doesn't rescale the backing store (which would defeat NEAREST filtering).
  if ('style' in canvas) {
    canvas.style.width = `${w / dpr}px`
    canvas.style.height = `${h / dpr}px`
  }
}
```

**Why this matters for NEAREST:** If `style.width` doesn't match the backing-store CSS size, the browser compositor scales the canvas bitmap. At scale != 1:1, `NEAREST` produces jagged / dropped-row artifacts — worse than the original `LINEAR` blur. The `w / dpr` formula ensures logical CSS size × dpr = integer backing-store size exactly.

**CSS length quantization note:** `${w / dpr}px` at DPR=1.5 produces e.g. `693.3333...px`. Chromium quantizes CSS lengths to 1/64 CSS px internally, giving ~0.008 physical px of round-trip error across a 1040px canvas — far below the threshold where `NEAREST` would flip a texel. Do not "fix" this by re-rounding the CSS value to a whole number; that would introduce a real rescale.

- [ ] **Step 3: Add dev-mode NEAREST invariant guard in `render()`**

If the window moves to a monitor with a different DPR, `render()` recomputes `pCellW = Math.ceil(cellW * newDpr)` but the atlas still has slots sized for the old DPR — breaking the 1:1 invariant silently. Add this guard immediately after the `const pCellH` line:

```typescript
// After:
const pCellW = Math.ceil(cellW * dpr)
const pCellH = Math.ceil(cellH * dpr)

// Add here:
if (import.meta.env.DEV && (pCellW !== this.atlas.slotW || pCellH !== this.atlas.slotH)) {
  console.warn(
    `[WebGL] pCell ${pCellW}×${pCellH} !== atlas slot ${this.atlas.slotW}×${this.atlas.slotH}` +
    ` — DPR changed without renderer reconstruction. Expect jagged glyphs.`
  )
}
```

- [ ] **Step 4: Verify the DPR-change path reconstructs the WebGLRenderer**

Read `NativeTerminalPane.tsx` lines 132–252 and confirm this chain fires on DPR change:

1. **Line 134**: `matchMedia` fires `updateDpr` → sets React state `dpr`.
2. **Line 252**: `useEffect` dep array includes `dpr`, so the effect re-runs.
3. **Lines 229–250**: On re-run, `sendFont(cellWRef.current, cellHRef.current, fontSize, fontFamily, newDpr)` is called (worker path), **and** the main-thread renderer is disposed and reconstructed with the new `cellW`/`cellH`.

The renderer reconstruction (lines 234–249) creates `new WebGLRenderer(canvas, cellWRef.current, cellHRef.current, ...)` with the freshly-snapped cellW/cellH for the new DPR. This means `atlas.slotW` will always match `pCellW` after a DPR change — the invariant guard in Step 3 should never fire in normal usage.

If the guard fires in practice, it means a code path is calling `render()` after a DPR change before the reconstruction useEffect has run. In that case, force a re-render after `sendFont` returns.

- [ ] **Step 5: Run tests**

```bash
npm run test -- --run 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/WorkspaceView/renderers/WebGLRenderer.ts
git commit -m "fix(webgl): integer-snap physical cell sizes and add NEAREST invariant guard"
```

---

## Task 3: CanvasRenderer — Integer canvas size and disable image smoothing

**Files:**
- Modify: `src/components/WorkspaceView/renderers/CanvasRenderer.ts:50-66`
- Modify: `src/components/WorkspaceView/renderers/CanvasRenderer.test.ts`

**Current state:** Canvas size uses `Math.round(cols * cellW * dpr)` (lines 54–55), which can be off by 1px due to fractional accumulation. Fix: `cols * Math.ceil(cellW * dpr)`.

**On draw positions:** `fillText` draws at logical coords (`col * cellW`). Since `cellW = Math.ceil(rawW * dpr) / dpr` (set in NativeTerminalPane:223–224), we have `col * cellW * dpr = col * Math.ceil(rawW * dpr)` — always an integer. No per-cell rounding needed.

**On `imageSmoothingEnabled`:** This only affects `drawImage`, not `fillText`. Set it anyway for defensive correctness.

- [ ] **Step 1: Write a failing test for integer-sized canvas backing store**

Add this test at the end of the `describe('CanvasRenderer', ...)` block in `CanvasRenderer.test.ts`.

**Critical:** Pass the **raw, unsnapped** `cellW = 8.4`, not a pre-snapped value. With the old code:
`Math.round(80 * 8.4 * 1.5) = Math.round(1008.0) = 1008`
With the new code:
`80 * Math.ceil(8.4 * 1.5) = 80 * 13 = 1040`

If you used a pre-snapped `cellW = Math.ceil(8.4 * 1.5) / 1.5 ≈ 8.6667` instead, old and new both produce 1040 and the test would pass before the fix — defeating TDD.

```typescript
it('canvas backing store width equals cols × Math.ceil(cellW × dpr)', () => {
  // Simulate DPR = 1.5 (Windows 150% scaling).
  // Pass the raw, unsnapped cellW so old code (Math.round) and new code (Math.ceil) differ.
  ;(globalThis as any).devicePixelRatio = 1.5
  try {
    const ctx = patchCanvas(canvas)
    Object.defineProperty(ctx, 'imageSmoothingEnabled', { writable: true, value: true })

    const cols = 80
    const rows = 24
    // Raw measurement — NOT pre-snapped. Old: Math.round(80*8.4*1.5)=1008. New: 80*ceil(8.4*1.5)=1040.
    const rawCellW = 8.4
    const cells = makeGrid(cols, rows)

    renderer.render(canvas, cells, cols, rows, { col: 0, row: 0, visible: false }, rawCellW, 19.6, [])

    const expectedW = cols * Math.ceil(rawCellW * 1.5)  // 80 * 13 = 1040
    expect(canvas.width).toBe(expectedW)
    expect(Number.isInteger(canvas.width)).toBe(true)
  } finally {
    // Always restore DPR — an assertion failure must not pollute subsequent tests.
    ;(globalThis as any).devicePixelRatio = 1
  }
})
```

- [ ] **Step 2: Run the new test to verify it fails**

```bash
npm run test -- --run CanvasRenderer 2>&1 | tail -30
```

Expected: the new test **fails** with `Expected: 1040, Received: 1008` — the old `Math.round` path produces a different value from the new `cols * Math.ceil` path.

- [ ] **Step 3: Fix CanvasRenderer canvas sizing and add imageSmoothingEnabled**

In `CanvasRenderer.ts`, replace lines 50–66 (from `render(` through `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)`):

```typescript
render(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  cells: Uint32Array,
  cols: number,
  rows: number,
  cursor: CursorState,
  cellW: number,
  cellH: number,
  highlights: SearchMatch[],
  selection?: SelectionRange | null,
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const dpr = globalThis.devicePixelRatio ?? 1

  // Integer physical cell size — matches how NativeTerminalPane snaps cellW.
  const pCellW = Math.ceil(cellW * dpr)
  const pCellH = Math.ceil(cellH * dpr)

  // Backing store size from cells × integer physical cell size — no rounding drift.
  const w = cols * pCellW
  const h = rows * pCellH
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
    if ('style' in canvas) {
      canvas.style.width = `${w / dpr}px`
      canvas.style.height = `${h / dpr}px`
    }
  }

  // Scale context so we can draw in logical coordinates.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  // Disable drawImage smoothing (defensive; does not affect fillText).
  ctx.imageSmoothingEnabled = false
```

- [ ] **Step 4: Run tests to verify new test passes**

```bash
npm run test -- --run CanvasRenderer 2>&1 | tail -30
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/WorkspaceView/renderers/CanvasRenderer.ts \
        src/components/WorkspaceView/renderers/CanvasRenderer.test.ts
git commit -m "fix(canvas): integer canvas size and disable image smoothing for crisp text rendering"
```

---

## Task 4: NativeTerminalPane — Physical-pixel ResizeObserver + dev assertion

**Files:**
- Modify: `src/components/WorkspaceView/NativeTerminalPane.tsx:439-450` (ResizeObserver)
- Modify: `src/components/WorkspaceView/NativeTerminalPane.tsx:225` (after console.log in font effect)

**Already correct (no change needed):**
- Lines 223–224: `Math.ceil(rawW * dpr) / dpr` snapping ✓
- Lines 132–138: `matchMedia` DPR change listener ✓

**What's missing:**

1. The ResizeObserver (lines 440–449) uses `contentRect.width` (CSS logical px). On fractional-DPR displays, `devicePixelContentBoxSize` gives the exact physical box size — more robust than converting back from logical.

2. A dev-mode assertion that physical cell sizes are integers catches any regression immediately in the console.

- [ ] **Step 1: Add dev-mode assertion after the snapping log in the font measurement effect**

In `NativeTerminalPane.tsx`, after line 225 (the `console.log` line), add:

```typescript
if (import.meta.env.DEV) {
  const pW = Math.round(cellWRef.current * dpr * 1e6) / 1e6
  const pH = Math.round(cellHRef.current * dpr * 1e6) / 1e6
  if (!Number.isInteger(pW) || !Number.isInteger(pH)) {
    console.warn(`[Terminal] physical cell size not integer: ${pW}×${pH} at dpr=${dpr}`)
  }
}
```

- [ ] **Step 2: Update ResizeObserver to use devicePixelContentBoxSize when available**

`devicePixelContentBoxSize` is supported in Chromium (WebView2 on Windows — the platform where fractional DPR matters most) but **not** in WKWebView (Tauri on macOS). The fallback path will always run on macOS; that's acceptable because macOS DPR is always 1× or exactly 2×.

When physical pixels are available directly, compute `cols = Math.floor(physW / pCellW)` in physical space rather than round-tripping to logical units — one fewer FP division.

In `NativeTerminalPane.tsx`, replace lines 439–450:

```typescript
useEffect(() => {
  if (!containerRef.current) return
  const ro = new ResizeObserver(entries => {
    const entry = entries[0]
    if (!entry) return

    // devicePixelContentBoxSize: supported in Chromium/WebView2 (Windows fractional DPR).
    // NOT supported in WKWebView (macOS) — fallback path runs there.
    if ('devicePixelContentBoxSize' in entry && (entry as any).devicePixelContentBoxSize.length > 0) {
      const physW = (entry as any).devicePixelContentBoxSize[0].inlineSize as number
      const physH = (entry as any).devicePixelContentBoxSize[0].blockSize as number
      if (physW === 0) return
      // Compute in physical space — avoids a round-trip through logical units.
      const dpr = window.devicePixelRatio || 1
      const pCellW = Math.ceil(cellWRef.current * dpr)
      const pCellH = Math.ceil(cellHRef.current * dpr)
      const newCols = Math.max(1, Math.floor(physW / pCellW))
      const newRows = Math.max(1, Math.floor(physH / pCellH))
      invoke('resize_terminal', { terminalId, cols: newCols, rows: newRows }).catch(console.error)
    } else {
      const rect = entry.contentRect
      if (rect.width === 0) return
      const newCols = Math.max(1, Math.floor(rect.width / cellWRef.current))
      const newRows = Math.max(1, Math.floor(rect.height / cellHRef.current))
      invoke('resize_terminal', { terminalId, cols: newCols, rows: newRows }).catch(console.error)
    }
  })
  ro.observe(containerRef.current)
  return () => ro.disconnect()
}, [terminalId])
```

- [ ] **Step 3: Run tests**

```bash
npm run test -- --run 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/WorkspaceView/NativeTerminalPane.tsx
git commit -m "fix(terminal): use devicePixelContentBoxSize in ResizeObserver and add integer-pixel assertion"
```

---

## Task 5: Verification — Visual and console audit

No file changes; verification steps only.

- [ ] **Step 1: Build and run**

```bash
npm run tauri dev
```

Wait for the Tauri window to open.

- [ ] **Step 2: Console check — integer dimensions**

Open DevTools (right-click → Inspect, or Tauri debug menu). Look for:

```
[Terminal] snapped metrics: physical=NxN, dpr=N
```

Both physical dimensions must be whole numbers (e.g. `physical=13x28, dpr=2`).

If you see a `[Terminal] physical cell size not integer` warning, there is a regression in the snapping logic — investigate before proceeding.

- [ ] **Step 3: Visual inspection — general crispness**

Open a terminal pane and run `ls -la`. Verify:
- Text edges are sharp with no halo or blurring
- Cursor block has clean edges
- No horizontal bands of blended pixels between rows

- [ ] **Step 4: NEAREST edge-pixel check**

With `NEAREST` filtering, FP error in UV interpolation at quad edges can clip the outermost texel column of a glyph (manifests as a 1px shaved edge on `M`, `|`, or box-drawing characters like `─ │ ┌`). Run `echo "M | ─ │ ┌ └ ┐ ┘"` in the terminal and zoom the browser to 150–200%. If any character shows a missing left or right edge column, the prescribed fix is to inset UVs by 0.5 / ATLAS_SIZE in `GlyphAtlas.getOrInsert`:

```typescript
// Replace the entry construction in getOrInsert:
const entry: GlyphEntry = {
  u0: (this.cursorX + pad + 0.5) / ATLAS_SIZE,
  v0: (this.cursorY + pad + 0.5) / ATLAS_SIZE,
  u1: (this.cursorX + pad + w - 0.5) / ATLAS_SIZE,
  v1: (this.cursorY + pad + h - 0.5) / ATLAS_SIZE,
}
```

This half-texel inset ensures sampling lands on texel centers, not edges. Only apply if the edge-clip artifact is observed.

- [ ] **Step 5: DPR=1 regression check**

Emulate DPR=1 using Chrome/WebView DevTools: open DevTools → toggle device emulation (Ctrl+Shift+M) → set device pixel ratio to 1. Verify no character clipping or layout jitter. Disable device emulation when done.

- [ ] **Step 6: Fractional DPR (if accessible)**

On Windows at 125% or 150% display scaling, or via DevTools device emulation (set DPR to 1.25 or 1.5), verify text remains sharp and the console shows integer physical dimensions.

- [ ] **Step 7: Split-pane fractional offset check**

Drag a pane splitter to several non-round positions to put the canvas `left` edge at a fractional CSS pixel (e.g., 412.37px logical). Verify text stays sharp. **Note:** This is a documented residual risk — `devicePixelContentBoxSize` fixes measurement, not placement. Chromium typically snaps layer boundaries for you; WKWebView behavior varies. If text is blurry after dragging, the fix is a `translate3d` sub-pixel correction on the canvas container (not in scope for this plan).

---

## Self-Review: Spec Coverage

| Spec Requirement | Task |
|---|---|
| `Math.ceil(cellW * dpr)` physical sizing | Task 2 (WebGL), Task 3 (Canvas) |
| Logical size = `PhysicalSize / dpr` | Already in NativeTerminalPane:223–224 |
| `NEAREST` texture filter | Task 1 |
| Integer glyph slot dims in GlyphAtlas | Task 2 (integer passed to ctor; `Math.ceil` on integer is no-op) |
| NEAREST invariant guard (pCellW === atlas.slotW) | Task 1 (exposes `slotW`/`slotH`), Task 2 Step 3 (guard), Task 2 Step 4 (DPR-path verification) |
| Atlas padding to prevent bleeding | Existing `pad=1` in GlyphAtlas:62 — unchanged |
| `imageSmoothingEnabled = false` | Task 3 |
| Integer draw positions for `fillText` | Guaranteed by snapped cellW; analyzed in Task 3 |
| `setTransform(dpr, ...)` preserved | Already in CanvasRenderer; preserved in Task 3 rewrite |
| Font measurement snapping | Already in NativeTerminalPane:223–224 |
| DPR change re-measurement | Already in NativeTerminalPane:132–138 |
| Canvas size = `cols × pCellW` (not independently rounded) | Task 2 (WebGL), Task 3 (Canvas) |
| ResizeObserver `devicePixelContentBoxSize` | Task 4 |
| Dev-mode integer assertion | Task 4 |
| Verification: visual + DPR checks | Task 5 |

**Spec review issues status:**
- Issue #1 (canvas element position): **Documented residual risk.** `devicePixelContentBoxSize` (Task 4) fixes col/row measurement from physical pixels. It does not fix fractional pane placement after splitter drag. Chromium typically snaps layer boundaries; WKWebView varies. Task 5 Step 7 verifies this empirically. Sub-pixel transform correction is out of scope.
- Issue #2 (NEAREST invariant): Stated in Task 1. Quad size and atlas slot both use `Math.ceil(cellW * dpr)`. Task 1 exposes `slotW`/`slotH` getters. Task 2 adds a dev guard that fires if they diverge (e.g., after a DPR change before renderer reconstruction) and verifies the DPR-change path (matchMedia → setDpr → useEffect → renderer rebuild) keeps them in sync. Task 2 also explicitly shows the CSS size assignment and notes the quantization behaviour.
- Issue #3 (atlas padding): Existing `pad=1` is the primary bleeding mitigation. Task 5 Step 4 adds verification for the NEAREST edge-pixel failure mode; half-texel UV inset is the prescribed fix if observed.
- Issue #4 (`imageSmoothingEnabled` vs `fillText`): Clarified in Task 3. Crispness comes from integer physical positions.
- Issue #5 (DPR change handling): Already present in NativeTerminalPane:132–138; no new code needed.
- Issue #6 (canvas size from cells): Fixed in Tasks 2 and 3.
- `Math.ceil(fontSize * dpr)` in Task 2: The atlas renders glyphs at physical `fontSize * dpr` px. Ceiling ensures the font size is a whole number of device pixels, matching the integer cell slot. Logical `fontSize` is unchanged and is what the Canvas renderer uses under `setTransform(dpr,...)`; the two renderers use different draw calls so a sub-pixel difference in font size between them is acceptable.
- `devicePixelContentBoxSize` on macOS: Not supported in WKWebView (Tauri/macOS). The fallback `contentRect` path always runs on macOS. This is acceptable — macOS DPR is always 1× or exactly 2×, so `contentRect` is lossless there.
