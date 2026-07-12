import { describe, expect, it } from 'vitest'
import {
  addAgentStudioPaneToLayout,
  addClaudePaneToLayout,
  addEditorPaneToLayout,
  addTerminalToLayout,
  removeAgentStudioPaneFromLayout,
} from './layout'
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

  it('adds and removes an agent studio leaf without removing an editor leaf', () => {
    const root = addEditorPaneToLayout(null, 'editor-1')
    const withAgent = addAgentStudioPaneToLayout(root, 'agent-1')

    expect(withAgent).toMatchObject({
      type: 'split',
      children: expect.arrayContaining([
        expect.objectContaining({ type: 'agent-studio', agentStudioPaneId: 'agent-1' }),
      ]),
    })
    expect(removeAgentStudioPaneFromLayout(withAgent, 'agent-1')).toEqual(root)
  })
})
