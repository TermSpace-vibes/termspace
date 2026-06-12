import { useState, useCallback } from 'react'
import type { NodeRef } from './useFileTreeOperations'

export interface ContextMenuState {
  x: number
  y: number
  node: NodeRef
}

export function useFileTreeContextMenu() {
  const [menu, setMenu] = useState<ContextMenuState | null>(null)

  const openMenu = useCallback((e: React.MouseEvent, node: NodeRef) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, node })
  }, [])

  const closeMenu = useCallback(() => setMenu(null), [])

  return { menu, openMenu, closeMenu }
}
