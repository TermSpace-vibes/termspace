import { describe, it, expect } from 'vitest'
import {
  addBrowserPaneToLayout,
  removeBrowserPaneFromLayout,
} from './layout'
import { LayoutNode } from '../types'

describe('addBrowserPaneToLayout', () => {
  it('creates a single browser node when root is null', () => {
    const result = addBrowserPaneToLayout(null, 'bp-1')
    expect(result).toEqual({ type: 'browser', id: expect.any(String), browserPaneId: 'bp-1' })
  })

  it('splits an existing pane node with a browser node', () => {
    const root: LayoutNode = { type: 'pane', id: 'p1', terminalId: 't-1' }
    const result = addBrowserPaneToLayout(root, 'bp-1', 't-1', 'horizontal')
    expect(result.type).toBe('split')
    if (result.type === 'split') {
      expect(result.children[1]).toEqual({ type: 'browser', id: expect.any(String), browserPaneId: 'bp-1' })
    }
  })
})

describe('removeBrowserPaneFromLayout', () => {
  it('returns null when removing the only browser pane', () => {
    const root: LayoutNode = { type: 'browser', id: 'n1', browserPaneId: 'bp-1' }
    expect(removeBrowserPaneFromLayout(root, 'bp-1')).toBeNull()
  })

  it('collapses split when browser pane is removed', () => {
    const root: LayoutNode = {
      type: 'split', id: 's1', direction: 'horizontal', sizes: [50, 50],
      children: [
        { type: 'pane', id: 'p1', terminalId: 't-1' },
        { type: 'browser', id: 'b1', browserPaneId: 'bp-1' },
      ]
    }
    const result = removeBrowserPaneFromLayout(root, 'bp-1')
    expect(result).toEqual({ type: 'pane', id: 'p1', terminalId: 't-1' })
  })

  it('returns root unchanged when browserPaneId is not found', () => {
    const root: LayoutNode = { type: 'browser', id: 'n1', browserPaneId: 'bp-1' }
    expect(removeBrowserPaneFromLayout(root, 'bp-NONEXISTENT')).toEqual(root)
  })
})
