import type { SelectionRange } from './renderers/types'

export interface AbsSelection {
  startAbsRow: number
  startCol: number
  endAbsRow: number
  endCol: number
}

/** Convert a viewport row to an absolute (offset-from-bottom) row. */
export function viewportRowToAbs(vpRow: number, displayOffset: number, rows: number): number {
  return displayOffset + (rows - 1 - vpRow)
}

/**
 * Convert an AbsSelection to a viewport-relative SelectionRange for the renderer.
 * Returns null when the entire selection is outside the current viewport.
 * Clamps partial overlap: rows scrolled off-screen expand to full-row boundaries.
 */
export function absSelToViewport(
  sel: AbsSelection,
  displayOffset: number,
  rows: number,
  cols: number,
): SelectionRange | null {
  const toVp = (abs: number) => (rows - 1) - (abs - displayOffset)

  let vpR1 = toVp(sel.startAbsRow), c1 = sel.startCol
  let vpR2 = toVp(sel.endAbsRow),   c2 = sel.endCol

  // Normalise top-to-bottom (vpR1 <= vpR2)
  if (vpR1 > vpR2) {
    ;[vpR1, vpR2] = [vpR2, vpR1]
    ;[c1, c2] = [c2, c1]
  } else if (vpR1 === vpR2 && c1 > c2) {
    ;[c1, c2] = [c2, c1]
  }

  if (vpR2 < 0 || vpR1 >= rows) return null

  return {
    startRow: Math.max(0, vpR1),
    startCol: vpR1 < 0 ? 0 : c1,
    endRow:   Math.min(rows - 1, vpR2),
    endCol:   vpR2 >= rows ? cols : c2,
  }
}

/**
 * Map an absolute row to a 0-based line index in the `get_terminal_text` output.
 * get_terminal_text returns lines oldest-first, so absRow 0 (newest) maps to
 * the last index, and the oldest content maps to index 0.
 */
export function absRowToLineIndex(absRow: number, totalHistory: number, rows: number): number {
  return totalHistory + rows - 1 - absRow
}

export interface NormalizedSel {
  absTop: number    // older / higher on screen (larger absRow)
  cTop: number
  absBottom: number // newer / lower on screen (smaller absRow)
  cBottom: number
}

/**
 * Normalise an AbsSelection so absTop >= absBottom (reading order: top-to-bottom).
 * For same-row selections, cTop <= cBottom (left-to-right).
 */
export function normalizeAbsSel(sel: AbsSelection): NormalizedSel {
  const { startAbsRow: sA, startCol: sC, endAbsRow: eA, endCol: eC } = sel
  if (sA > eA || (sA === eA && sC <= eC)) {
    return { absTop: sA, cTop: sC, absBottom: eA, cBottom: eC }
  }
  return { absTop: eA, cTop: eC, absBottom: sA, cBottom: sC }
}

/**
 * Extract text from a `get_terminal_text` line array using absolute selection coords.
 * Precondition: absTop >= absBottom (call normalizeAbsSel first).
 *
 * @param lines       Output of `get_terminal_text` split on '\n' (oldest first).
 * @param absTop      Abs row of selection top (older, higher abs value).
 * @param cTop        Column where the top line begins.
 * @param absBottom   Abs row of selection bottom (newer, lower abs value).
 * @param cBottom     Column where the bottom line ends (exclusive).
 * @param totalHistory Number of scrollback history lines.
 * @param rows        Number of visible terminal rows.
 */
export function extractTextFromLines(
  lines: string[],
  absTop: number,
  cTop: number,
  absBottom: number,
  cBottom: number,
  totalHistory: number,
  rows: number,
): string {
  const i1 = Math.max(0, Math.min(lines.length - 1, absRowToLineIndex(absTop, totalHistory, rows)))
  const i2 = Math.max(0, Math.min(lines.length - 1, absRowToLineIndex(absBottom, totalHistory, rows)))
  if (i1 > i2) return ''

  const selected = lines.slice(i1, i2 + 1)
  if (selected.length === 1) {
    return (selected[0] ?? '').slice(cTop, cBottom)
  }
  // multi-row: build from sliced+trimmed parts
  const parts = selected.map((l, i) => {
    const s = l ?? ''
    if (i === 0) return s.slice(cTop).trimEnd()
    if (i === selected.length - 1) {
      const sliced = s.slice(0, cBottom)
      // only trim if selection goes to end of line (user didn't explicitly select trailing spaces)
      return cBottom >= s.length ? sliced.trimEnd() : sliced
    }
    return s.trimEnd()
  })
  return parts.join('\n')
}
