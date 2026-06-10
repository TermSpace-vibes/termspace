import { describe, it, expect } from 'vitest'
import {
  viewportRowToAbs,
  absSelToViewport,
  absRowToLineIndex,
  extractTextFromLines,
  normalizeAbsSel,
} from './selectionUtils'

describe('viewportRowToAbs', () => {
  it('bottom row at no scroll = absRow 0', () => {
    expect(viewportRowToAbs(23, 0, 24)).toBe(0)
  })
  it('top row at no scroll = absRow rows-1', () => {
    expect(viewportRowToAbs(0, 0, 24)).toBe(23)
  })
  it('bottom row at displayOffset=5 = absRow 5', () => {
    expect(viewportRowToAbs(23, 5, 24)).toBe(5)
  })
  it('top row at displayOffset=5 = absRow 28', () => {
    expect(viewportRowToAbs(0, 5, 24)).toBe(28)
  })
})

describe('absSelToViewport', () => {
  const rows = 24, cols = 80

  it('single-row selection fully in viewport', () => {
    const sel = { startAbsRow: 5, startCol: 3, endAbsRow: 5, endCol: 10 }
    const vp = absSelToViewport(sel, 0, rows, cols)
    expect(vp).toEqual({ startRow: 18, startCol: 3, endRow: 18, endCol: 10 })
  })

  it('normalises reversed col order on same row', () => {
    const sel = { startAbsRow: 5, startCol: 10, endAbsRow: 5, endCol: 3 }
    const vp = absSelToViewport(sel, 0, rows, cols)
    expect(vp).toEqual({ startRow: 18, startCol: 3, endRow: 18, endCol: 10 })
  })

  it('multi-row selection in viewport', () => {
    // absRow 10 → vpRow 13; absRow 5 → vpRow 18 (at displayOffset=0)
    const sel = { startAbsRow: 10, startCol: 2, endAbsRow: 5, endCol: 7 }
    const vp = absSelToViewport(sel, 0, rows, cols)
    expect(vp).toEqual({ startRow: 13, startCol: 2, endRow: 18, endCol: 7 })
  })

  it('returns null when entirely above viewport', () => {
    // absRow 100 → vpRow = 23-(100-0) = -77 (off screen above)
    const sel = { startAbsRow: 100, startCol: 0, endAbsRow: 90, endCol: 10 }
    expect(absSelToViewport(sel, 0, rows, cols)).toBeNull()
  })

  it('returns null when entirely below viewport', () => {
    // At displayOffset=50, absRow 10 → vpRow = 23-(10-50) = 63 (below screen)
    const sel = { startAbsRow: 10, startCol: 0, endAbsRow: 5, endCol: 10 }
    expect(absSelToViewport(sel, 50, rows, cols)).toBeNull()
  })

  it('clamps top when selection starts above viewport', () => {
    // absRow 30 → vpRow = 23-(30-0) = -7 (above screen); absRow 5 → vpRow 18
    const sel = { startAbsRow: 30, startCol: 5, endAbsRow: 5, endCol: 7 }
    const vp = absSelToViewport(sel, 0, rows, cols)
    expect(vp?.startRow).toBe(0)
    expect(vp?.startCol).toBe(0)  // clamped to col 0 when top is off-screen
    expect(vp?.endRow).toBe(18)
    expect(vp?.endCol).toBe(7)
  })

  it('clamps bottom when selection ends below viewport', () => {
    // At displayOffset=10: absRow 25 → vpRow = 23-(25-10) = 8; absRow 3 → vpRow = 23-(3-10) = 30 (below)
    const sel = { startAbsRow: 25, startCol: 2, endAbsRow: 3, endCol: 5 }
    const vp = absSelToViewport(sel, 10, rows, cols)
    expect(vp?.endRow).toBe(rows - 1)
    expect(vp?.endCol).toBe(cols)  // clamped to cols when bottom is off-screen
  })
})

describe('absRowToLineIndex', () => {
  it('newest row (absRow=0) = last line index', () => {
    expect(absRowToLineIndex(0, 100, 24)).toBe(123)
  })
  it('oldest row (absRow=totalHistory+rows-1) = line index 0', () => {
    expect(absRowToLineIndex(123, 100, 24)).toBe(0)
  })
})

describe('normalizeAbsSel', () => {
  it('keeps start as top (higher absRow) when already ordered', () => {
    const sel = { startAbsRow: 20, startCol: 3, endAbsRow: 5, endCol: 7 }
    const n = normalizeAbsSel(sel)
    expect(n).toEqual({ absTop: 20, cTop: 3, absBottom: 5, cBottom: 7 })
  })

  it('swaps when end is actually above start', () => {
    const sel = { startAbsRow: 5, startCol: 3, endAbsRow: 20, endCol: 7 }
    const n = normalizeAbsSel(sel)
    expect(n).toEqual({ absTop: 20, cTop: 7, absBottom: 5, cBottom: 3 })
  })

  it('same row: cTop < cBottom', () => {
    const sel = { startAbsRow: 10, startCol: 7, endAbsRow: 10, endCol: 3 }
    const n = normalizeAbsSel(sel)
    expect(n.absTop).toBe(10)
    expect(n.cTop).toBe(3)
    expect(n.cBottom).toBe(7)
  })

  it('same row zero-width (cTop === cBottom): absTop === absBottom and cTop === cBottom', () => {
    const sel = { startAbsRow: 10, startCol: 5, endAbsRow: 10, endCol: 5 }
    const n = normalizeAbsSel(sel)
    expect(n.absTop).toBe(10)
    expect(n.absBottom).toBe(10)
    expect(n.cTop).toBe(5)
    expect(n.cBottom).toBe(5)
  })
})

describe('extractTextFromLines', () => {
  const lines = ['line0', 'line1', 'line2', 'line3', 'line4']
  // totalHistory=0, rows=5: lineIndex = 0+5-1-absRow = 4-absRow
  // absRow 4 → lineIndex 0 (oldest), absRow 0 → lineIndex 4 (newest)

  it('single-row extract', () => {
    // absTop=absBottom=3 → lineIndex 1 = 'line1'
    expect(extractTextFromLines(lines, 3, 2, 3, 5, 0, 5)).toBe('ne1')
  })

  it('multi-row extract', () => {
    // absTop=3→lineIndex 1='line1', absBottom=1→lineIndex 3='line3'
    const result = extractTextFromLines(lines, 3, 0, 1, 5, 0, 5)
    expect(result).toBe('line1\nline2\nline3')
  })

  it('trims trailing spaces on middle lines', () => {
    const spaced = ['aaa   ', 'bbb   ', 'ccc   ']
    // totalHistory=0, rows=3: lineIndex=2-absRow
    // absTop=2→lineIndex 0, absBottom=0→lineIndex 2
    const result = extractTextFromLines(spaced, 2, 0, 0, 3, 0, 3)
    expect(result).toBe('aaa\nbbb   \nccc')
  })

  it('clamps out-of-range indices', () => {
    expect(extractTextFromLines(lines, 99, 0, 99, 5, 0, 5)).toBe('line0')
  })
})
