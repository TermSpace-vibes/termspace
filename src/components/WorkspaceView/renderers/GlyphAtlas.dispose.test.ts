import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GlyphAtlas } from './GlyphAtlas'

// Worker scopes have no DOM: HTMLCanvasElement is not defined there.
// dispose() must not reference it unguarded or the worker throws a
// ReferenceError mid-teardown, leaving the renderer broken (blank terminal).

function makeGlMock() {
  return {
    deleteTexture: vi.fn(),
  } as unknown as WebGL2RenderingContext
}

function makeOffscreenCanvasMock() {
  return class OffscreenCanvasMock {
    width: number
    height: number
    constructor(w: number, h: number) {
      this.width = w
      this.height = h
    }
    getContext() {
      return {
        clearRect: vi.fn(),
        fillText: vi.fn(),
        font: '',
        fillStyle: '',
      }
    }
  }
}

describe('GlyphAtlas.dispose in worker-like scope (no DOM)', () => {
  const savedDocument = globalThis.document
  const savedHTMLCanvasElement = (globalThis as any).HTMLCanvasElement
  const savedOffscreenCanvas = (globalThis as any).OffscreenCanvas

  beforeEach(() => {
    // Simulate dedicated-worker global scope
    delete (globalThis as any).document
    delete (globalThis as any).HTMLCanvasElement
    ;(globalThis as any).OffscreenCanvas = makeOffscreenCanvasMock()
  })

  afterEach(() => {
    ;(globalThis as any).document = savedDocument
    ;(globalThis as any).HTMLCanvasElement = savedHTMLCanvasElement
    ;(globalThis as any).OffscreenCanvas = savedOffscreenCanvas
  })

  it('does not throw when HTMLCanvasElement is undefined', () => {
    const atlas = new GlyphAtlas(makeGlMock(), 17, 40, 28, 'monospace')
    expect(() => atlas.dispose()).not.toThrow()
  })
})
