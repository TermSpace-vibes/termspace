import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFileTreeContextMenu } from './useFileTreeContextMenu'

const mockNode = {
  path: '/project/src/index.ts',
  name: 'index.ts',
  isDirectory: false,
  depth: 2,
}

describe('useFileTreeContextMenu', () => {
  it('menu is null initially', () => {
    const { result } = renderHook(() => useFileTreeContextMenu())
    expect(result.current.menu).toBeNull()
  })

  it('openMenu sets x, y, and node from the event', () => {
    const { result } = renderHook(() => useFileTreeContextMenu())
    const fakeEvent = { preventDefault: () => {}, clientX: 100, clientY: 200 } as any
    act(() => result.current.openMenu(fakeEvent, mockNode))
    expect(result.current.menu).toEqual({ x: 100, y: 200, node: mockNode })
  })

  it('closeMenu resets menu to null', () => {
    const { result } = renderHook(() => useFileTreeContextMenu())
    const fakeEvent = { preventDefault: () => {}, clientX: 100, clientY: 200 } as any
    act(() => result.current.openMenu(fakeEvent, mockNode))
    act(() => result.current.closeMenu())
    expect(result.current.menu).toBeNull()
  })
})
