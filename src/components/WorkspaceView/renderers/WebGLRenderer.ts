import type { CursorState, SearchMatch, TerminalRenderer, SelectionRange } from './types'
import { FLAG_BOLD, FLAG_ITALIC, FLAG_DIM } from './types'
import { GlyphAtlas } from './GlyphAtlas'


// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

/**
 * Vertex shader for the glyph pass.
 * Uses instanced rendering — one instance per cell that contains a character.
 *
 * Instance layout (8 floats × 4 bytes = 32 bytes per instance):
 *   location 1: col       (1f) — grid column
 *   location 2: row       (1f) — grid row
 *   location 3: uv_min    (2f) — atlas UV top-left
 *   location 4: uv_max    (2f) — atlas UV bottom-right
 *   location 5: fg        (1f) — foreground colour bit-cast as float
 *   location 6: bg        (1f) — background colour bit-cast as float
 *
 * Colours are packed as 0xAARRGGBB and bit-cast to float32 on the JS side so
 * the value survives the float buffer upload without numeric conversion.
 * The shader recovers the individual channels via `floatBitsToUint`.
 */
const VS = `#version 300 es
layout(location=0) in vec2  a_quad;    // unit quad corner [0,1]^2
layout(location=1) in float a_col;     // grid column (instance)
layout(location=2) in float a_row;     // grid row (instance)
layout(location=3) in vec2  a_uv_min;  // atlas UV top-left (instance)
layout(location=4) in vec2  a_uv_max;  // atlas UV bottom-right (instance)
layout(location=5) in uint a_fg;      // fg color (instance)
layout(location=6) in uint a_bg;      // bg color (instance)
uniform vec2 u_cell;    // (cellW, cellH) in pixels
uniform vec2 u_canvas;  // canvas (width, height) in pixels
out vec2 v_uv;
flat out vec4 v_fg;
flat out vec4 v_bg;
vec4 unpack(uint u) {
  return vec4(float((u>>16u)&255u),float((u>>8u)&255u),float(u&255u),float((u>>24u)&255u))/255.0;
}
void main() {
  vec2 pos = (vec2(a_col,a_row) + a_quad) * u_cell;
  gl_Position = vec4((pos/u_canvas)*2.0-1.0, 0.0, 1.0);
  gl_Position.y = -gl_Position.y;
  v_uv = mix(a_uv_min, a_uv_max, a_quad);
  v_fg = unpack(a_fg);
  v_bg = unpack(a_bg);
}`

/**
 * Fragment shader for the glyph pass.
 * Samples the atlas red channel as a coverage mask and blends fg over bg.
 */
const FS = `#version 300 es
precision mediump float;
uniform sampler2D u_atlas;
in vec2 v_uv;
flat in vec4 v_fg;
flat in vec4 v_bg;
out vec4 out_color;
void main() {
  float a = texture(u_atlas, v_uv).a;
  out_color = mix(v_bg, v_fg, a);
}`

/**
 * Vertex shader for the background colour pass.
 * Draws a solid-coloured quad for each cell, covering the full grid.
 *
 * Instance layout (3 floats × 4 bytes = 12 bytes per instance):
 *   location 1: col   (1f)
 *   location 2: row   (1f)
 *   location 3: color (1f) — packed 0xAARRGGBB bit-cast as float
 */
const BG_VS = `#version 300 es
layout(location=0) in vec2  a_quad;
layout(location=1) in float a_col;
layout(location=2) in float a_row;
layout(location=3) in uint a_color;
layout(location=4) in uint a_fg;
layout(location=5) in uint a_flags;
uniform vec2 u_cell;
uniform vec2 u_canvas;
out vec2 v_quad;
flat out vec4 v_color;
flat out vec4 v_fg;
flat out uint v_flags;
vec4 unpack(uint u) {
  return vec4(float((u>>16u)&255u),float((u>>8u)&255u),float(u&255u),float((u>>24u)&255u))/255.0;
}
void main() {
  vec2 pos = (vec2(a_col,a_row) + a_quad) * u_cell;
  gl_Position = vec4((pos/u_canvas)*2.0-1.0, 0.0, 1.0);
  gl_Position.y = -gl_Position.y;
  v_quad = a_quad;
  v_color = unpack(a_color);
  v_fg = unpack(a_fg);
  v_flags = a_flags;
}`

const BG_FS = `#version 300 es
precision mediump float;
in vec2 v_quad;
flat in vec4 v_color;
flat in vec4 v_fg;
flat in uint v_flags;
out vec4 out_color;
void main() {
  vec4 color = v_color;
  if ((v_flags & 16u) != 0u && v_quad.y > 0.51 && v_quad.y < 0.59) {
    color = v_fg;
  }
  if ((v_flags & 8u) != 0u && v_quad.y > 0.81 && v_quad.y < 0.89) {
    color = v_fg;
  }
  out_color = color;
}`

// ---------------------------------------------------------------------------
// Shader helpers
// ---------------------------------------------------------------------------

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(s) ?? 'shader compile error')
  return s
}

function link(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram {
  const p = gl.createProgram()!
  gl.attachShader(p, vs)
  gl.attachShader(p, fs)
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(p) ?? 'shader link error')
  return p
}

function isCellSelected(row: number, col: number, sel?: SelectionRange | null): boolean {
  if (!sel) return false
  let r1 = sel.startRow, c1 = sel.startCol
  let r2 = sel.endRow, c2 = sel.endCol
  if (r1 > r2 || (r1 === r2 && c1 > c2)) {
    r1 = sel.endRow; c1 = sel.endCol
    r2 = sel.startRow; c2 = sel.startCol
  }
  if (row < r1 || row > r2) return false
  if (row === r1 && row === r2) return col >= c1 && col < c2
  if (row === r1) return col >= c1
  if (row === r2) return col < c2
  return true
}

// ---------------------------------------------------------------------------
// Instance buffer layout constants
// ---------------------------------------------------------------------------

/** Floats per glyph instance: col, row, u0, v0, u1, v1, fg, bg = 8 */
const GLYPH_STRIDE = 8

/** Floats per background instance: col, row, color, fg, flags = 5 */
const BG_STRIDE = 5



// ---------------------------------------------------------------------------
// WebGLRenderer
// ---------------------------------------------------------------------------

/**
 * WebGL2 instanced renderer for the terminal canvas.
 *
 * Rendering pipeline (two draw calls per frame):
 *   1. Background pass — solid-coloured quads for all cells (no atlas needed).
 *   2. Glyph pass     — textured quads for cells that contain a character,
 *                        blended over the background using the glyph atlas.
 *
 * Both passes use `drawArraysInstanced` with a shared unit-quad vertex buffer
 * so only two triangle strips are issued regardless of terminal size.
 */
export class WebGLRenderer implements TerminalRenderer {
  private gl: WebGL2RenderingContext
  private atlas: GlyphAtlas
  private glyphProg: WebGLProgram
  private bgProg: WebGLProgram
  private quadBuf: WebGLBuffer
  private glyphInstBuf: WebGLBuffer
  private bgInstBuf: WebGLBuffer
  private glyphVao: WebGLVertexArrayObject
  private bgVao: WebGLVertexArrayObject
  private accentColor: number
  private bgColor: number
  // Logical font config, kept so the atlas can be rebuilt when cell metrics
  // or DPR change after construction (see render()).
  private fontSize: number
  private fontFamily: string

  // Cached uniform locations — looked up once in the constructor.
  private uBgCell: WebGLUniformLocation | null = null
  private uBgCanvas: WebGLUniformLocation | null = null
  private uGlyphCell: WebGLUniformLocation | null = null
  private uGlyphCanvas: WebGLUniformLocation | null = null
  private uGlyphAtlas: WebGLUniformLocation | null = null

  // Pre-allocated instance buffers — resized only when the terminal grows.
  private bgBufData: ArrayBuffer | null = null
  private glyphBufData: ArrayBuffer | null = null
  private bgU8: Uint8Array | null = null
  private glyphU8: Uint8Array | null = null
  private instanceBufCap = 0  // capacity in cells (+ 2 for cursor glyphs)

  constructor(
    canvas: HTMLCanvasElement | OffscreenCanvas,
    cellW: number,
    cellH: number,
    fontSize: number,
    fontFamily: string,
    accentColor = 0xFFE8A045,
    bgColor = 0xFF161310,
  ) {
    this.accentColor = accentColor
    this.bgColor = bgColor
    this.fontSize = fontSize
    this.fontFamily = fontFamily
    const gl = canvas.getContext('webgl2')
    if (!gl) throw new Error('WebGL2 not available')
    this.gl = gl

    const dpr = globalThis.devicePixelRatio ?? 1
    this.atlas = new GlyphAtlas(
      gl,
      Math.ceil(cellW * dpr),
      Math.ceil(cellH * dpr),
      Math.ceil(fontSize * dpr),
      fontFamily,
    )

    // Compile and link both shader programs.
    const glyphVs = compile(gl, gl.VERTEX_SHADER, VS)
    const glyphFs = compile(gl, gl.FRAGMENT_SHADER, FS)
    this.glyphProg = link(gl, glyphVs, glyphFs)

    const bgVs = compile(gl, gl.VERTEX_SHADER, BG_VS)
    const bgFs = compile(gl, gl.FRAGMENT_SHADER, BG_FS)
    this.bgProg = link(gl, bgVs, bgFs)

    // Shared unit quad: (0,0) (1,0) (0,1) (1,1) for TRIANGLE_STRIP.
    this.quadBuf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)

    this.glyphInstBuf = gl.createBuffer()!
    this.bgInstBuf = gl.createBuffer()!

    // ── Glyph VAO ────────────────────────────────────────────────────────────
    // Attrib 0: unit quad corner (non-instanced, 2 floats).
    // Attribs 1-6: per-instance data from glyphInstBuf.
    this.glyphVao = gl.createVertexArray()!
    gl.bindVertexArray(this.glyphVao)

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

    gl.bindBuffer(gl.ARRAY_BUFFER, this.glyphInstBuf)
    const gs = GLYPH_STRIDE * 4  // stride in bytes

    const glyphAttribs: [number, number, number][] = [
      [1, 1, 0],   // a_col     (1f @ offset  0)
      [2, 1, 4],   // a_row     (1f @ offset  4)
      [3, 2, 8],   // a_uv_min  (2f @ offset  8)
      [4, 2, 16],  // a_uv_max  (2f @ offset 16)
      [5, 1, 24],  // a_fg      (1ui @ offset 24)
      [6, 1, 28],  // a_bg      (1ui @ offset 28)
    ]
    for (const [loc, size, offset] of glyphAttribs) {
      gl.enableVertexAttribArray(loc)
      if (loc >= 5) {
        gl.vertexAttribIPointer(loc, size, gl.UNSIGNED_INT, gs, offset)
      } else {
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, gs, offset)
      }
      gl.vertexAttribDivisor(loc, 1)
    }

    // ── Background VAO ───────────────────────────────────────────────────────
    // Attrib 0: unit quad corner (non-instanced).
    // Attribs 1-3: per-instance data from bgInstBuf.
    this.bgVao = gl.createVertexArray()!
    gl.bindVertexArray(this.bgVao)

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

    gl.bindBuffer(gl.ARRAY_BUFFER, this.bgInstBuf)
    const bs = BG_STRIDE * 4
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, bs, 0);  gl.vertexAttribDivisor(1, 1)
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, bs, 4);  gl.vertexAttribDivisor(2, 1)
    gl.enableVertexAttribArray(3); gl.vertexAttribIPointer(3, 1, gl.UNSIGNED_INT, bs, 8); gl.vertexAttribDivisor(3, 1)
    gl.enableVertexAttribArray(4); gl.vertexAttribIPointer(4, 1, gl.UNSIGNED_INT, bs, 12); gl.vertexAttribDivisor(4, 1)
    gl.enableVertexAttribArray(5); gl.vertexAttribIPointer(5, 1, gl.UNSIGNED_INT, bs, 16); gl.vertexAttribDivisor(5, 1)

    gl.bindVertexArray(null)

    // Standard alpha blending: glyph coverage blends over background.
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    // Cache uniform locations once — calling getUniformLocation every frame
    // adds unnecessary GPU driver overhead at 60fps.
    this.uBgCell   = gl.getUniformLocation(this.bgProg, 'u_cell')
    this.uBgCanvas = gl.getUniformLocation(this.bgProg, 'u_canvas')
    this.uGlyphCell   = gl.getUniformLocation(this.glyphProg, 'u_cell')
    this.uGlyphCanvas = gl.getUniformLocation(this.glyphProg, 'u_canvas')
    this.uGlyphAtlas  = gl.getUniformLocation(this.glyphProg, 'u_atlas')
  }

  updateTheme(accentColor: number, bgColor: number) {
    this.accentColor = accentColor
    this.bgColor = bgColor
  }

  render(
    canvas: HTMLCanvasElement | OffscreenCanvas,
    cells: Uint32Array,
    cols: number,
    rows: number,
    cursor: CursorState,
    cellW: number,
    cellH: number,
    _highlights: SearchMatch[],
    selection?: SelectionRange | null,
  ): void {
    const gl = this.gl
    const dpr = globalThis.devicePixelRatio ?? 1

    const pCellW = Math.ceil(cellW * dpr)   // integer physical pixels per cell
    const pCellH = Math.ceil(cellH * dpr)

    // pCellW must equal atlas slot size or NEAREST filtering produces jagged
    // glyphs (happens when cell metrics or DPR change after construction —
    // e.g. the renderer was built from pre-measurement default metrics).
    // Self-heal: rebuild the atlas with current metrics; glyphs re-rasterize
    // lazily via getOrInsert, so this is a one-time cost per metric change.
    if (pCellW !== this.atlas.slotW || pCellH !== this.atlas.slotH) {
      if (import.meta.env.DEV) {
        console.warn(
          `[WebGL] pCell ${pCellW}×${pCellH} !== atlas slot ${this.atlas.slotW}×${this.atlas.slotH}` +
          ` — rebuilding glyph atlas with current metrics.`
        )
      }
      this.atlas.dispose()
      this.atlas = new GlyphAtlas(
        gl,
        pCellW,
        pCellH,
        Math.ceil(this.fontSize * dpr),
        this.fontFamily,
      )
    }

    // Canvas size from cells × integer cell size — exact, no rounding drift.
    const w = cols * pCellW
    const h = rows * pCellH
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
      // CSS size must match exactly: w/dpr gives back the exact logical size so the compositor
      // doesn't rescale the backing store (which would defeat NEAREST filtering).
      // Note: w/dpr at fractional DPR (e.g. 1.5) produces a repeating decimal like 693.333...px.
      // Chromium quantizes to 1/64 CSS px, giving ~0.008px physical error — far below one texel.
      // Do NOT round this value to a whole number; that would introduce a real compositor rescale.
      if ('style' in canvas) {
        canvas.style.width = `${w / dpr}px`
        canvas.style.height = `${h / dpr}px`
      }
    }
    gl.viewport(0, 0, w, h)

    // Clear to transparent so CSS background shows through.
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    const count = cols * rows
    // +2 headroom for the two extra cursor glyph instances.
    const needed = count + 2
    if (needed > this.instanceBufCap) {
      this.bgBufData    = new ArrayBuffer(needed * BG_STRIDE * 4)
      this.glyphBufData = new ArrayBuffer(needed * GLYPH_STRIDE * 4)
      this.bgU8         = new Uint8Array(this.bgBufData)
      this.glyphU8      = new Uint8Array(this.glyphBufData)
      this.instanceBufCap = needed
    }
    const bgBuf   = this.bgBufData!
    const glyphBuf = this.glyphBufData!
    const bgF32 = new Float32Array(bgBuf)
    const bgU32 = new Uint32Array(bgBuf)
    const glyphF32 = new Float32Array(glyphBuf)
    const glyphU32 = new Uint32Array(glyphBuf)
    let gi = 0, bi = 0, glyphCount = 0

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const base = (row * cols + col) * 4
        const chU32 = cells[base]
        let bg = cells[base + 2] ?? 0x00000000
        let fgPacked = cells[base + 1] ?? 0xFF000000
        const flags = cells[base + 3] ?? 0

        const selected = isCellSelected(row, col, selection)
        if (selected) {
          bg = 0xFFFFFFFF
          fgPacked = 0xFF000000
        } else if ((flags & FLAG_DIM) !== 0) {
          const r = Math.floor(((fgPacked >>> 16) & 0xFF) * 0.45)
          const g = Math.floor(((fgPacked >>> 8) & 0xFF) * 0.45)
          const b = Math.floor((fgPacked & 0xFF) * 0.45)
          fgPacked = (0xFF000000 | (r << 16) | (g << 8) | b) >>> 0
        }

        // Background instance.
        bgF32[bi++] = col
        bgF32[bi++] = row
        bgU32[bi++] = bg
        bgU32[bi++] = fgPacked
        bgU32[bi++] = flags

        // Glyph instance — only emit when the cell has content.
        if (chU32 !== undefined && chU32 !== 0 && chU32 !== 32 && chU32 <= 0x10FFFF) {
          const ch = String.fromCodePoint(chU32)
          const bold   = (flags & FLAG_BOLD)   !== 0
          const italic = (flags & FLAG_ITALIC) !== 0
          const uv = this.atlas.getOrInsert(ch, bold, italic)

          glyphF32[gi++] = col
          glyphF32[gi++] = row
          glyphF32[gi++] = uv.u0
          glyphF32[gi++] = uv.v0
          glyphF32[gi++] = uv.u1
          glyphF32[gi++] = uv.v1
          glyphU32[gi++] = fgPacked
          glyphU32[gi++] = bg
          glyphCount++
        }
      }
    }

    // Handle cursor: draw it as an amber block glyph on top of whatever is there.
    // We do this by emitting a synthetic background-coloured "█" glyph entry.
    if (cursor.visible && cursor.col < cols && cursor.row < rows) {
      const ci = cursor.row * cols + cursor.col
      const base = ci * 4
      const chU32 = cells[base]
      const flags = cells[base + 3] ?? 0
      // Draw cursor block character with amber fg.
      const uv = this.atlas.getOrInsert('█', false, false)
      glyphF32[gi++] = cursor.col
      glyphF32[gi++] = cursor.row
      glyphF32[gi++] = uv.u0
      glyphF32[gi++] = uv.v0
      glyphF32[gi++] = uv.u1
      glyphF32[gi++] = uv.v1
      const accent = this.accentColor
      const bg = this.bgColor
      glyphU32[gi++] = accent  // accent
      glyphU32[gi++] = cells[base + 2] ?? 0x00000000
      glyphCount++

      // Re-draw the character under the cursor in a dark contrast colour.
      if (chU32 !== undefined && chU32 !== 0 && chU32 !== 32 && chU32 <= 0x10FFFF) {
        const ch = String.fromCodePoint(chU32)
        const bold   = (flags & FLAG_BOLD)   !== 0
        const italic = (flags & FLAG_ITALIC) !== 0
        const charUv = this.atlas.getOrInsert(ch, bold, italic)
        glyphF32[gi++] = cursor.col
        glyphF32[gi++] = cursor.row
        glyphF32[gi++] = charUv.u0
        glyphF32[gi++] = charUv.v0
        glyphF32[gi++] = charUv.u1
        glyphF32[gi++] = charUv.v1
        glyphU32[gi++] = bg  // dark fg over amber cursor
        glyphU32[gi++] = 0x00000000  // transparent bg (cursor block already drawn)
        glyphCount++
      }
    }

    // Upload any new glyphs to the atlas texture.
    this.atlas.upload()

    // ── Pass 1: Background ──────────────────────────────────────────────────
    gl.useProgram(this.bgProg)
    gl.uniform2f(this.uBgCell,   pCellW, pCellH)
    gl.uniform2f(this.uBgCanvas, w,     h)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bgInstBuf)
    gl.bufferData(gl.ARRAY_BUFFER, this.bgU8!.subarray(0, count * BG_STRIDE * 4), gl.DYNAMIC_DRAW)
    gl.bindVertexArray(this.bgVao)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count)

    // ── Pass 2: Glyphs ──────────────────────────────────────────────────────
    if (glyphCount > 0) {
      gl.useProgram(this.glyphProg)
      gl.uniform2f(this.uGlyphCell,   pCellW, pCellH)
      gl.uniform2f(this.uGlyphCanvas, w,     h)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, this.atlas.texture)
      gl.uniform1i(this.uGlyphAtlas, 0)
      gl.bindBuffer(gl.ARRAY_BUFFER, this.glyphInstBuf)
      gl.bufferData(gl.ARRAY_BUFFER, this.glyphU8!.subarray(0, glyphCount * GLYPH_STRIDE * 4), gl.DYNAMIC_DRAW)
      gl.bindVertexArray(this.glyphVao)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, glyphCount)
    }

    gl.bindVertexArray(null)
  }

  /** Releases all GPU resources: atlas texture, buffers, VAOs, shader programs. */
  dispose(): void {
    this.atlas.dispose()
    const gl = this.gl
    gl.deleteBuffer(this.quadBuf)
    gl.deleteBuffer(this.glyphInstBuf)
    gl.deleteBuffer(this.bgInstBuf)
    gl.deleteVertexArray(this.glyphVao)
    gl.deleteVertexArray(this.bgVao)
    gl.deleteProgram(this.glyphProg)
    gl.deleteProgram(this.bgProg)
    this.bgBufData = null
    this.glyphBufData = null
    this.bgU8 = null
    this.glyphU8 = null
    this.instanceBufCap = 0
  }
}
