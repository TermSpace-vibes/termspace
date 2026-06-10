export interface GlyphEntry {
  u0: number; v0: number  // atlas UV top-left
  u1: number; v1: number  // atlas UV bottom-right
}

const ATLAS_SIZE = 1024

/**
 * GlyphAtlas pre-renders character glyphs onto an off-screen Canvas 2D surface
 * and uploads the result as a WebGL texture.
 *
 * Characters are rasterised on demand and packed into a single 1024×1024 RGBA
 * texture using a simple shelf-packing algorithm. The atlas is re-uploaded
 * (`upload()`) only when new glyphs have been added (`dirty === true`).
 */
export class GlyphAtlas {
  private canvas: HTMLCanvasElement | OffscreenCanvas
  private ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  private map = new Map<string, GlyphEntry>()
  private cursorX = 0
  private cursorY = 0
  private rowHeight = 0
  texture: WebGLTexture | null = null
  dirty = false

  constructor(
    private gl: WebGL2RenderingContext,
    private cellW: number,
    private cellH: number,
    private fontSize: number,
    private fontFamily: string,
  ) {
    if (typeof OffscreenCanvas !== 'undefined' && typeof document === 'undefined') {
      this.canvas = new OffscreenCanvas(ATLAS_SIZE, ATLAS_SIZE)
    } else {
      const c = document.createElement('canvas')
      c.width = ATLAS_SIZE
      c.height = ATLAS_SIZE
      this.canvas = c
    }
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true }) as
      CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
    this.ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE)
  }

  /**
   * Returns the cached UV entry for a glyph, or rasterises the character and
   * inserts it into the atlas if not yet present.
   */
  getOrInsert(ch: string, bold: boolean, italic: boolean): GlyphEntry {
    const key = `${ch}:${bold ? 1 : 0}:${italic ? 1 : 0}`
    const existing = this.map.get(key)
    if (existing) return existing

    const w = Math.ceil(this.cellW)
    const h = Math.ceil(this.cellH)
    const pad = 1

    // Advance to the next shelf row when the current row is full.
    if (this.cursorX + w + pad * 2 > ATLAS_SIZE) {
      this.cursorX = 0
      this.cursorY += this.rowHeight
      this.rowHeight = 0
    }

    // Atlas exhausted — fall back to the very first slot rather than crashing.
    if (this.cursorY + h + pad * 2 > ATLAS_SIZE) {
      console.warn('GlyphAtlas: atlas full, reusing first slot')
      return { u0: 0, v0: 0, u1: w / ATLAS_SIZE, v1: h / ATLAS_SIZE }
    }

    const weight = bold ? 'bold' : 'normal'
    const style = italic ? 'italic' : 'normal'
    this.ctx.font = `${style} ${weight} ${this.fontSize}px ${this.fontFamily}`
    this.ctx.fillStyle = '#ffffff'
    this.ctx.fillText(ch, this.cursorX + pad, this.cursorY + pad + this.fontSize)

    const entry: GlyphEntry = {
      u0: (this.cursorX + pad) / ATLAS_SIZE,
      v0: (this.cursorY + pad) / ATLAS_SIZE,
      u1: (this.cursorX + pad + w) / ATLAS_SIZE,
      v1: (this.cursorY + pad + h) / ATLAS_SIZE,
    }
    this.map.set(key, entry)
    this.cursorX += w + pad * 2
    this.rowHeight = Math.max(this.rowHeight, h + pad * 2)
    this.dirty = true
    return entry
  }

  /**
   * Uploads the atlas canvas to the GPU if it has been modified since the last
   * upload. Call once per frame, after all `getOrInsert` calls.
   */
  upload(): void {
    if (!this.dirty) return
    const gl = this.gl
    if (!this.texture) {
      this.texture = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, this.texture)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    }
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.canvas)
    this.dirty = false
  }

  /** Releases the GPU texture. Call when the renderer is being torn down. */
  dispose(): void {
    if (this.texture) this.gl.deleteTexture(this.texture)
  }
}
