import { describe, it, expect } from 'vitest'
import type { TerminalSnapshot } from './types'

describe('TerminalSnapshot type', () => {
  it('can be constructed with all required fields', () => {
    const snap: TerminalSnapshot = {
      cols: 80, rows: 24,
      cursorCol: 0, cursorRow: 0, cursorVisible: true,
      cells_b64: '',
      cwd: '/home/user',
      title: null,
    }
    expect(snap.cells_b64).toBe('')
  })
})
