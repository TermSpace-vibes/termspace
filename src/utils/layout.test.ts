import { describe, it, expect } from 'vitest'
import {
  addBrowserPaneToLayout,
  removeBrowserPaneFromLayout,
  addGhosttyPaneToLayout,
  removeGhosttyPaneFromLayout,
} from './layout'
import { LayoutNode } from '../types'

describe('addBrowserPaneToLayout', () => {
  it('creates a single browser node wrapped in split when root is null', () => {
    const result = addBrowserPaneToLayout(null, 'bp-1')
    expect(result).toEqual({
      type: 'split', id: 'root', direction: 'horizontal', sizes: [100],
      children: [{ type: 'browser', id: 'browser-bp-1', browserPaneId: 'bp-1' }]
    })
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

  it('keeps split with 1 child when browser pane is removed (no collapse)', () => {
    const root: LayoutNode = {
      type: 'split', id: 's1', direction: 'horizontal', sizes: [50, 50],
      children: [
        { type: 'pane', id: 'p1', terminalId: 't-1' },
        { type: 'browser', id: 'b1', browserPaneId: 'bp-1' },
      ]
    }
    const result = removeBrowserPaneFromLayout(root, 'bp-1')
    expect(result).toEqual({
      type: 'split', id: 's1', direction: 'horizontal', sizes: [100],
      children: [{ type: 'pane', id: 'p1', terminalId: 't-1' }]
    })
  })

  it('returns root unchanged when browserPaneId is not found', () => {
    const root: LayoutNode = { type: 'browser', id: 'n1', browserPaneId: 'bp-1' }
    expect(removeBrowserPaneFromLayout(root, 'bp-NONEXISTENT')).toEqual(root)
  })
})

describe('addGhosttyPaneToLayout', () => {
  it('creates a root split when layout is null', () => {
    const result = addGhosttyPaneToLayout(null, 'g1')
    expect(result.type).toBe('split')
    if (result.type === 'split') {
      expect(result.children[0]).toEqual({ type: 'ghostty', id: 'ghostty-g1', ghosttyPaneId: 'g1' })
    }
  })

  it('wraps an existing pane node in a split', () => {
    const existing: LayoutNode = { type: 'pane', id: 'pane-t1', terminalId: 't1' }
    const result = addGhosttyPaneToLayout(existing, 'g1')
    expect(result.type).toBe('split')
    if (result.type === 'split') {
      expect(result.children).toHaveLength(2)
      expect(result.children[1].type).toBe('ghostty')
    }
  })

  it('splits at targetId in a nested split', () => {
    const root: LayoutNode = {
      type: 'split', id: 's1', direction: 'horizontal', sizes: [50, 50],
      children: [
        { type: 'pane', id: 'pane-t1', terminalId: 't1' },
        { type: 'pane', id: 'pane-t2', terminalId: 't2' },
      ]
    }
    const result = addGhosttyPaneToLayout(root, 'g1', 't1', 'vertical')
    expect(result.type).toBe('split')
    if (result.type === 'split') {
      expect(result.children[0].type).toBe('split')
    }
  })
})

describe('removeGhosttyPaneFromLayout', () => {
  it('returns null for null input', () => {
    expect(removeGhosttyPaneFromLayout(null, 'g1')).toBeNull()
  })

  it('removes a ghostty node from a split', () => {
    const layout: LayoutNode = {
      type: 'split', id: 'root', direction: 'horizontal', sizes: [50, 50],
      children: [
        { type: 'pane', id: 'pane-t1', terminalId: 't1' },
        { type: 'ghostty', id: 'ghostty-g1', ghosttyPaneId: 'g1' },
      ]
    }
    const result = removeGhosttyPaneFromLayout(layout, 'g1')
    expect(result?.type).toBe('split')
    if (result?.type === 'split') {
      expect(result.children).toHaveLength(1)
      expect(result.children[0].type).toBe('pane')
    }
  })
})
