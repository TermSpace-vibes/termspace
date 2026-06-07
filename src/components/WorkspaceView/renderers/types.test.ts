import { describe, it, expect } from 'vitest'
import type { TerminalSnapshot, SnapshotCell, CursorState, SearchMatch } from './types'

describe('TerminalSnapshot type', () => {
  it('can be constructed with all required fields', () => {
    const cell: SnapshotCell = { ch: 'A', fg: 0xFFFFFFFF, bg: 0xFF000000, flags: 0 }
    const snap: TerminalSnapshot = {
      cols: 80, rows: 24,
      cursorCol: 0, cursorRow: 0, cursorVisible: true,
      cells: [cell],
      cwd: '/home/user',
      title: null,
    }
    expect(snap.cells).toHaveLength(1)
    expect(snap.cells[0].ch).toBe('A')
  })
})
