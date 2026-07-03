import { describe, expect, it } from 'vitest'
import { addClaudePaneToLayout, addTerminalToLayout } from './layout'
import { LayoutNode } from '../types'

describe('layout utilities', () => {
  it('splits a terminal adjacent to a Claude pane target', () => {
    const root: LayoutNode = {
      type: 'claude',
      id: 'claude-c1',
      claudePaneId: 'c1',
    }

    const next = addTerminalToLayout(root, 't1', 'c1', 'vertical')

    expect(next).toMatchObject({
      type: 'split',
      direction: 'vertical',
      sizes: [50, 50],
      children: [
        { type: 'claude', claudePaneId: 'c1' },
        { type: 'pane', terminalId: 't1' },
      ],
    })
  })

  it('keeps existing terminal split behavior', () => {
    const root: LayoutNode = {
      type: 'pane',
      id: 'pane-t1',
      terminalId: 't1',
    }

    const next = addClaudePaneToLayout(root, 'c1', 't1', 'horizontal')

    expect(next).toMatchObject({
      type: 'split',
      direction: 'horizontal',
      sizes: [50, 50],
      children: [
        { type: 'pane', terminalId: 't1' },
        { type: 'claude', claudePaneId: 'c1' },
      ],
    })
  })
})
