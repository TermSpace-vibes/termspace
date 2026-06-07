import type { SnapshotCell, CursorState, SearchMatch, TerminalRenderer } from './types'
import { FLAG_BOLD, FLAG_ITALIC } from './types'
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
layout(location=5) in float a_fg;      // fg color bit-cast as float (instance)
layout(location=6) in float a_bg;      // bg color bit-cast as float (instance)
uniform vec2 u_cell;    // (cellW, cellH) in pixels
uniform vec2 u_canvas;  // canvas (width, height) in pixels
out vec2 v_uv;
flat out vec4 v_fg;
flat out vec4 v_bg;
vec4 unpack(float f) {
  uint u = floatBitsToUint(f);
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
  float a = texture(u_atlas, v_uv).r;
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
layout(location=3) in float a_color;
uniform vec2 u_cell;
uniform vec2 u_canvas;
flat out vec4 v_color;
vec4 unpack(float f) {
  uint u = floatBitsToUint(f);
  return vec4(float((u>>16u)&255u),float((u>>8u)&255u),float(u&255u),float((u>>24u)&255u))/255.0;
}
void main() {
  vec2 pos = (vec2(a_col,a_row) + a_quad) * u_cell;
  gl_Position = vec4((pos/u_canvas)*2.0-1.0, 0.0, 1.0);
  gl_Position.y = -gl_Position.y;
  v_color = unpack(a_color);
}`

const BG_FS = `#version 300 es
precision mediump float;
flat in vec4 v_color;
out vec4 out_color;
void main() { out_color = v_color; }`

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

// ---------------------------------------------------------------------------
// Instance buffer layout constants
// ---------------------------------------------------------------------------

/** Floats per glyph instance: col, row, u0, v0, u1, v1, fg, bg = 8 */
const GLYPH_STRIDE = 8

/** Floats per background instance: col, row, color = 3 */
const BG_STRIDE = 3

// ---------------------------------------------------------------------------
// Colour bit-cast helper
// ---------------------------------------------------------------------------

/**
 * Packs an 0xAARRGGBB unsigned integer into the float32 bit pattern that the
 * GLSL `floatBitsToUint` instruction will recover correctly.
 *
 * We CANNOT just write `packedColor` into a Float32Array directly because that
 * would perform a numeric integer→float conversion (e.g. 0xFF161310 becomes
 * ~4.28e9 in float, losing precision). Instead we reinterpret the raw bytes so
 * the bit pattern is preserved exactly.
 */
const _colorBuf = new ArrayBuffer(4)
const _colorU32 = new Uint32Array(_colorBuf)
const _colorF32 = new Float32Array(_colorBuf)
function packColorBits(argb: number): number {
  _colorU32[0] = argb >>> 0
  return _colorF32[0]
}

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

  constructor(
    canvas: HTMLCanvasElement,
    cellW: number,
    cellH: number,
    fontSize: number,
    fontFamily: string,
  ) {
    const gl = canvas.getContext('webgl2')
    if (!gl) throw new Error('WebGL2 not available')
    this.gl = gl

    this.atlas = new GlyphAtlas(gl, cellW, cellH, fontSize, fontFamily)

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

    // [location, componentCount, byteOffset]
    const glyphAttribs: [number, number, number][] = [
      [1, 1, 0],   // a_col     (1f @ offset  0)
      [2, 1, 4],   // a_row     (1f @ offset  4)
      [3, 2, 8],   // a_uv_min  (2f @ offset  8)
      [4, 2, 16],  // a_uv_max  (2f @ offset 16)
      [5, 1, 24],  // a_fg      (1f @ offset 24)
      [6, 1, 28],  // a_bg      (1f @ offset 28)
    ]
    for (const [loc, size, offset] of glyphAttribs) {
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, gs, offset)
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
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, bs, 8);  gl.vertexAttribDivisor(3, 1)

    gl.bindVertexArray(null)

    // Standard alpha blending: glyph coverage blends over background.
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
  }

  render(
    canvas: HTMLCanvasElement,
    cells: SnapshotCell[],
    cols: number,
    rows: number,
    cursor: CursorState,
    cellW: number,
    cellH: number,
    _highlights: SearchMatch[],
  ): void {
    const gl = this.gl

    // Resize canvas backing store to match the logical terminal grid.
    const w = Math.floor(cols * cellW)
    const h = Math.floor(rows * cellH)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    gl.viewport(0, 0, w, h)

    // Clear to terminal background colour.
    gl.clearColor(0x16 / 255, 0x13 / 255, 0x10 / 255, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)

    const count = cols * rows
    const bgData    = new Float32Array(count * BG_STRIDE)
    // Allocate for worst case (every cell has a glyph). We'll slice on upload.
    const glyphData = new Float32Array(count * GLYPH_STRIDE)
    let gi = 0, bi = 0, glyphCount = 0

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const cell = cells[row * cols + col]
        const bg = cell?.bg ?? 0xFF161310

        // Background instance.
        bgData[bi++] = col
        bgData[bi++] = row
        bgData[bi++] = packColorBits(bg)

        // Glyph instance — only emit when the cell has content.
        if (cell?.ch) {
          const bold   = (cell.flags & FLAG_BOLD)   !== 0
          const italic = (cell.flags & FLAG_ITALIC) !== 0
          const uv = this.atlas.getOrInsert(cell.ch, bold, italic)

          glyphData[gi++] = col
          glyphData[gi++] = row
          glyphData[gi++] = uv.u0
          glyphData[gi++] = uv.v0
          glyphData[gi++] = uv.u1
          glyphData[gi++] = uv.v1
          glyphData[gi++] = packColorBits(cell.fg)
          glyphData[gi++] = packColorBits(bg)
          glyphCount++
        }
      }
    }

    // Handle cursor: draw it as an amber block glyph on top of whatever is there.
    // We do this by emitting a synthetic background-coloured "█" glyph entry.
    if (cursor.visible && cursor.col < cols && cursor.row < rows) {
      const ci = cursor.row * cols + cursor.col
      const cell = cells[ci]
      // Draw cursor block character with amber fg.
      const uv = this.atlas.getOrInsert('█', false, false)
      glyphData[gi++] = cursor.col
      glyphData[gi++] = cursor.row
      glyphData[gi++] = uv.u0
      glyphData[gi++] = uv.v0
      glyphData[gi++] = uv.u1
      glyphData[gi++] = uv.v1
      glyphData[gi++] = packColorBits(0xFFE8A045)  // amber
      glyphData[gi++] = packColorBits(cell?.bg ?? 0xFF161310)
      glyphCount++

      // Re-draw the character under the cursor in a dark contrast colour.
      if (cell?.ch) {
        const bold   = (cell.flags & FLAG_BOLD)   !== 0
        const italic = (cell.flags & FLAG_ITALIC) !== 0
        const charUv = this.atlas.getOrInsert(cell.ch, bold, italic)
        glyphData[gi++] = cursor.col
        glyphData[gi++] = cursor.row
        glyphData[gi++] = charUv.u0
        glyphData[gi++] = charUv.v0
        glyphData[gi++] = charUv.u1
        glyphData[gi++] = charUv.v1
        glyphData[gi++] = packColorBits(0xFF161310)  // dark fg over amber cursor
        glyphData[gi++] = packColorBits(0x00000000)  // transparent bg (cursor block already drawn)
        glyphCount++
      }
    }

    // Upload any new glyphs to the atlas texture.
    this.atlas.upload()

    // ── Pass 1: Background ──────────────────────────────────────────────────
    gl.useProgram(this.bgProg)
    gl.uniform2f(gl.getUniformLocation(this.bgProg, 'u_cell'),   cellW, cellH)
    gl.uniform2f(gl.getUniformLocation(this.bgProg, 'u_canvas'), w,     h)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bgInstBuf)
    gl.bufferData(gl.ARRAY_BUFFER, bgData, gl.DYNAMIC_DRAW)
    gl.bindVertexArray(this.bgVao)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count)

    // ── Pass 2: Glyphs ──────────────────────────────────────────────────────
    if (glyphCount > 0) {
      gl.useProgram(this.glyphProg)
      gl.uniform2f(gl.getUniformLocation(this.glyphProg, 'u_cell'),   cellW, cellH)
      gl.uniform2f(gl.getUniformLocation(this.glyphProg, 'u_canvas'), w,     h)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, this.atlas.texture)
      gl.uniform1i(gl.getUniformLocation(this.glyphProg, 'u_atlas'), 0)
      gl.bindBuffer(gl.ARRAY_BUFFER, this.glyphInstBuf)
      gl.bufferData(gl.ARRAY_BUFFER, glyphData.subarray(0, glyphCount * GLYPH_STRIDE), gl.DYNAMIC_DRAW)
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
  }
}
