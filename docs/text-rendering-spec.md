# Spec: Terminal Text Rendering Crispness (Integer Snapping)

**Date:** 2026-06-11
**Status:** Draft
**Topic:** Improving terminal text clarity by ensuring pixel-perfect alignment.

## 1. Problem Statement
The terminal text in Termspace is reported to be "not crisp" or blurry. This is likely due to fractional pixel offsets causing the GPU (in WebGL) or the Browser (in Canvas 2D) to interpolate glyphs across physical pixel boundaries. 

While the current implementation uses `devicePixelRatio`, it does not strictly enforce that the physical dimensions of cells and the internal atlas remain integer-aligned, leading to "sub-pixel blur" when `LINEAR` filtering is used.

## 2. Goals
- Eliminate sub-pixel interpolation blur in both WebGL and Canvas 2D renderers.
- Ensure terminal text remains crisp regardless of font size or zoom level.
- Maintain support for transparent backgrounds.
  - **Note on AA:** Using a transparent background limits the browser to grayscale anti-aliasing (disabling subpixel/ClearType). We aim for the highest possible crispness within this constraint.


## 3. Proposed Architecture (Approach A)

### 3.1. Physical Pixel Alignment
We will ensure that the "physical" size of a terminal cell is always an integer. 
- **Logical size:** `cellW`, `cellH`
- **Physical size:** `Math.ceil(cellW * dpr)`, `Math.ceil(cellH * dpr)` (Using `ceil` ensures we never round down to 0 or fractional sizes that clip the font).
- The `rawW` and `rawH` obtained from browser measurement will be treated as the minimum required floor; we redefine the logical size as `PhysicalSize / dpr` to ensure that multiplying by `dpr` always returns the exact integer physical size used for rendering.

### 3.2. WebGL Glyph Atlas Updates
- **Filtering:** Change `gl.TEXTURE_MIN_FILTER` and `gl.TEXTURE_MAG_FILTER` from `LINEAR` to `NEAREST`.
- **Packing:** Ensure `GlyphAtlas` packs glyphs at integer pixel coordinates within its internal canvas.
- **UV Alignment:** With `NEAREST` filtering, we must be precise with UV coordinates. If texture bleeding occurs, we will evaluate adding a 0.5 physical pixel offset to samples.
- **DPR Sizing:** The atlas internal canvas already uses `cellW * dpr` and `cellH * dpr`. We will ensure these inputs are integers.

### 3.3. Renderer Updates
- **CanvasRenderer:** Update `render()` to use `Math.ceil` for the canvas width/height and ensure `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` is used with integer-aligned logical coordinates. Set `ctx.imageSmoothingEnabled = false` to disable browser-level interpolation.
- **WebGLRenderer:** Update `render()` to ensure `u_cell` (physical cell size) and `u_canvas` (physical canvas size) are sent to the shader as integers.

### 3.4. Font Measurement
- The measurement logic in `NativeTerminalPane.tsx` will be updated to snap the resulting `cellW` and `cellH` such that their physical counterparts are integers using `Math.ceil`.

## 4. Implementation Details

### 4.1. `GlyphAtlas.ts`
- Ensure `this.cursorX`, `this.cursorY`, `w`, and `h` in `getOrInsert` are integers.
- Set `gl.NEAREST` in `upload()`.

### 4.2. `WebGLRenderer.ts`
- In `render()`, calculate `pCellW = Math.ceil(cellW * dpr)` and `pCellH = Math.ceil(cellH * dpr)`.
- Pass these integer physical values to the shaders via uniforms.

### 4.3. `NativeTerminalPane.tsx`
- In the font measurement `useEffect`, calculate `rawW` and `rawH`, then:
  ```typescript
  cellWRef.current = Math.ceil(rawW * dpr) / dpr;
  cellHRef.current = Math.ceil(rawH * dpr) / dpr;
  ```
- This ensures `cellW * dpr` is a whole number (the `ceil` handles the "physical" side).

## 5. Verification Plan
- **Visual Inspection:** Use the browser's zoom and high-DPI display to verify text edges are sharp.
- **Non-Retina Check:** Verify on standard (DPR=1) displays to ensure no layout regressions or "jitter".
- **Console Audit:** Log physical cell dimensions to verify they are integers.
- **Renderer Toggle:** Test both 'native' (WebGL) and 'xterm' (Canvas) renderers to ensure both benefit from alignment.
