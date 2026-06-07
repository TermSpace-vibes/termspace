import { LayoutNode, LayoutDirection } from '../types'

function generateId() {
  return Math.random().toString(36).substring(2, 9)
}

export function addTerminalToLayout(
  root: LayoutNode | null,
  terminalId: string,
  targetId?: string,
  direction: LayoutDirection = 'horizontal'
): LayoutNode {
  const newPane: LayoutNode = { type: 'pane', id: generateId(), terminalId }

  if (!root) {
    return newPane
  }

  // If no targetId, we just split the root.
  if (!targetId) {
    if (root.type === 'pane') {
      return {
        type: 'split',
        id: generateId(),
        direction,
        sizes: [50, 50],
        children: [root, newPane],
      }
    } else {
      // It's a split. Just add to it if it's the same direction, else wrap it?
      // Actually, standard is to split the root node.
      return {
        type: 'split',
        id: generateId(),
        direction,
        sizes: [50, 50],
        children: [root, newPane],
      }
    }
  }

  // Recursive function to find target and replace with split
  function traverseAndAdd(node: LayoutNode): LayoutNode {
    if (node.type === 'pane') {
      if (node.terminalId === targetId) {
        return {
          type: 'split',
          id: generateId(),
          direction,
          sizes: [50, 50],
          children: [node, newPane],
        }
      }
      return node
    }

    if (node.type === 'browser') {
      if (node.browserPaneId === targetId) {
        return { type: 'split', id: generateId(), direction, sizes: [50, 50], children: [node, newPane] }
      }
      return node
    }
    
    if (node.type === 'editor') {
      if (node.editorPaneId === targetId) {
        return { type: 'split', id: generateId(), direction, sizes: [50, 50], children: [node, newPane] }
      }
      return node
    }

    if (node.type === 'split') {
      return {
        ...node,
        children: node.children.map(traverseAndAdd)
      }
    }
    return node
  }

  return traverseAndAdd(root)
}

export function removeTerminalFromLayout(root: LayoutNode | null, terminalId: string): LayoutNode | null {
  if (!root) return null

  function traverseAndRemove(node: LayoutNode): LayoutNode | null {
    if (node.type === 'pane') {
      if (node.terminalId === terminalId) return null
      return node
    }

    if (node.type === 'browser' || node.type === 'editor') return node

    if (node.type === 'split') {
      const newChildren = node.children.map(traverseAndRemove).filter(Boolean) as LayoutNode[]
      if (newChildren.length === 0) return null
      if (newChildren.length === 1) return newChildren[0] // Collapse split
      const removedCount = node.children.length - newChildren.length
      if (removedCount === 0) return { ...node, children: newChildren }
      const removedIndices = new Set(
        node.children
          .map((child, i) => ({ child, i }))
          .filter(({ child }) => !newChildren.includes(child))
          .map(({ i }) => i)
      )
      const survivingOriginalSizes = node.sizes.filter((_, i) => !removedIndices.has(i))
      const total = survivingOriginalSizes.reduce((a, b) => a + b, 0)
      const normalizedSizes = survivingOriginalSizes.map(s => total > 0 ? (s / total) * 100 : 100 / newChildren.length)
      return { ...node, children: newChildren, sizes: normalizedSizes }
    }
    return node
  }

  return traverseAndRemove(root)
}

export function swapTerminalsInLayout(root: LayoutNode | null, sourceTerminalId: string, targetTerminalId: string): LayoutNode | null {
  if (!root) return null

  function traverseAndSwap(node: LayoutNode): LayoutNode {
    if (node.type === 'pane') {
      if (node.terminalId === sourceTerminalId) {
        return { ...node, terminalId: targetTerminalId }
      }
      if (node.terminalId === targetTerminalId) {
        return { ...node, terminalId: sourceTerminalId }
      }
      return node
    }
    if (node.type === 'browser' || node.type === 'editor') return node
    if (node.type === 'split') {
      return { ...node, children: node.children.map(traverseAndSwap) }
    }
    return node
  }

  return traverseAndSwap(root)
}

export function updateSplitSizes(root: LayoutNode | null, splitId: string, sizes: number[]): LayoutNode | null {
  if (!root) return null

  function traverseAndUpdate(node: LayoutNode): LayoutNode {
    if (node.type === 'pane') return node
    if (node.type === 'browser' || node.type === 'editor') return node
    if (node.type === 'split') {
      if (node.id === splitId) {
        return { ...node, sizes, children: node.children.map(traverseAndUpdate) }
      }
      return { ...node, children: node.children.map(traverseAndUpdate) }
    }
    return node
  }

  return traverseAndUpdate(root)
}

export function addBrowserPaneToLayout(
  root: LayoutNode | null,
  browserPaneId: string,
  targetId?: string,
  direction: LayoutDirection = 'horizontal'
): LayoutNode {
  const newNode: LayoutNode = { type: 'browser', id: generateId(), browserPaneId }

  if (!root) return newNode

  if (!targetId) {
    return { type: 'split', id: generateId(), direction, sizes: [50, 50], children: [root, newNode] }
  }

  function traverseAndAdd(node: LayoutNode): LayoutNode {
    if (node.type === 'pane') {
      if (node.terminalId === targetId) {
        return { type: 'split', id: generateId(), direction, sizes: [50, 50], children: [node, newNode] }
      }
      return node
    }
    if (node.type === 'browser') {
      if (node.browserPaneId === targetId) {
        return { type: 'split', id: generateId(), direction, sizes: [50, 50], children: [node, newNode] }
      }
      return node
    }
    if (node.type === 'split') {
      return { ...node, children: node.children.map(traverseAndAdd) }
    }
    return node
  }

  return traverseAndAdd(root)
}

export function removeBrowserPaneFromLayout(root: LayoutNode | null, browserPaneId: string): LayoutNode | null {
  if (!root) return null

  function traverseAndRemove(node: LayoutNode): LayoutNode | null {
    if (node.type === 'browser') {
      return node.browserPaneId === browserPaneId ? null : node
    }
    if (node.type === 'pane' || node.type === 'editor') return node
    if (node.type === 'split') {
      const newChildren = node.children.map(traverseAndRemove).filter(Boolean) as LayoutNode[]
      if (newChildren.length === 0) return null
      if (newChildren.length === 1) return newChildren[0]
      const removedCount = node.children.length - newChildren.length
      if (removedCount === 0) return { ...node, children: newChildren }
      const removedIndices = new Set(
        node.children
          .map((child, i) => ({ child, i }))
          .filter(({ child }) => !newChildren.includes(child))
          .map(({ i }) => i)
      )
      const survivingOriginalSizes = node.sizes.filter((_, i) => !removedIndices.has(i))
      const total = survivingOriginalSizes.reduce((a, b) => a + b, 0)
      const normalizedSizes = survivingOriginalSizes.map(s => total > 0 ? (s / total) * 100 : 100 / newChildren.length)
      return { ...node, children: newChildren, sizes: normalizedSizes }
    }
    return node
  }

  return traverseAndRemove(root)
}

export function addEditorPaneToLayout(
  root: LayoutNode | null,
  editorPaneId: string,
  targetId?: string,
  direction: LayoutDirection = 'horizontal'
): LayoutNode {
  const newNode: LayoutNode = { type: 'editor', id: generateId(), editorPaneId }

  if (!root) return newNode

  if (!targetId) {
    return { type: 'split', id: generateId(), direction, sizes: [50, 50], children: [root, newNode] }
  }

  function traverseAndAdd(node: LayoutNode): LayoutNode {
    if (node.type === 'pane') {
      if (node.terminalId === targetId) {
        return { type: 'split', id: generateId(), direction, sizes: [50, 50], children: [node, newNode] }
      }
      return node
    }
    if (node.type === 'browser') {
      if (node.browserPaneId === targetId) {
        return { type: 'split', id: generateId(), direction, sizes: [50, 50], children: [node, newNode] }
      }
      return node
    }
    if (node.type === 'editor') {
      if (node.editorPaneId === targetId) {
        return { type: 'split', id: generateId(), direction, sizes: [50, 50], children: [node, newNode] }
      }
      return node
    }
    if (node.type === 'split') {
      return { ...node, children: node.children.map(traverseAndAdd) }
    }
    return node
  }

  return traverseAndAdd(root)
}

export function removeEditorPaneFromLayout(root: LayoutNode | null, editorPaneId: string): LayoutNode | null {
  if (!root) return null

  function traverseAndRemove(node: LayoutNode): LayoutNode | null {
    if (node.type === 'editor') {
      return node.editorPaneId === editorPaneId ? null : node
    }
    if (node.type === 'pane' || node.type === 'browser') return node
    if (node.type === 'split') {
      const newChildren = node.children.map(traverseAndRemove).filter(Boolean) as LayoutNode[]
      if (newChildren.length === 0) return null
      if (newChildren.length === 1) return newChildren[0]
      const removedCount = node.children.length - newChildren.length
      if (removedCount === 0) return { ...node, children: newChildren }
      const removedIndices = new Set(
        node.children
          .map((child, i) => ({ child, i }))
          .filter(({ child }) => !newChildren.includes(child))
          .map(({ i }) => i)
      )
      const survivingOriginalSizes = node.sizes.filter((_, i) => !removedIndices.has(i))
      const total = survivingOriginalSizes.reduce((a, b) => a + b, 0)
      const normalizedSizes = survivingOriginalSizes.map(s => total > 0 ? (s / total) * 100 : 100 / newChildren.length)
      return { ...node, children: newChildren, sizes: normalizedSizes }
    }
    return node
  }

  return traverseAndRemove(root)
}
