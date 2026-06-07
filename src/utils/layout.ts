import { LayoutNode, LayoutDirection } from '../types'

const ROOT_SPLIT_ID = 'root'

export function addTerminalToLayout(
  root: LayoutNode | null,
  terminalId: string,
  targetId?: string,
  direction: LayoutDirection = 'horizontal'
): LayoutNode {
  const newPane: LayoutNode = { type: 'pane', id: `pane-${terminalId}`, terminalId }

  if (!root) {
    // Always wrap in a split from the start so the Group component tree is stable.
    return {
      type: 'split',
      id: ROOT_SPLIT_ID,
      direction: 'horizontal',
      sizes: [100],
      children: [newPane],
    }
  }

  // If no targetId, we just split the root.
  if (!targetId) {
    if (root.type === 'pane' || root.type === 'browser' || root.type === 'editor' || root.type === 'ghostty') {
      return {
        type: 'split',
        id: ROOT_SPLIT_ID,
        direction,
        sizes: [50, 50],
        children: [root, newPane],
      }
    } else {
      // Root is already a split — append to its children to keep the Group alive.
      const count = root.children.length + 1
      const newSizes = root.children.map(() => 100 / count)
      newSizes.push(100 / count)
      return {
        ...root,
        id: ROOT_SPLIT_ID,
        children: [...root.children, newPane],
        sizes: newSizes,
      }
    }
  }

  // Recursive function to find target and replace with split
  function traverseAndAdd(node: LayoutNode): LayoutNode {
    const splitChildren = [node, newPane]
    const splitId = `split-${splitChildren.map(c => c.id).join('|')}`

    if (node.type === 'pane') {
      if (node.terminalId === targetId) {
        return {
          type: 'split',
          id: splitId,
          direction,
          sizes: [50, 50],
          children: splitChildren,
        }
      }
      return node
    }

    if (node.type === 'browser') {
      if (node.browserPaneId === targetId) {
        return { type: 'split', id: splitId, direction, sizes: [50, 50], children: splitChildren }
      }
      return node
    }
    
    if (node.type === 'editor') {
      if (node.editorPaneId === targetId) {
        return { type: 'split', id: splitId, direction, sizes: [50, 50], children: splitChildren }
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
      // Don't collapse 1-child splits — keeps react-resizable-panels component tree stable
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
        return { ...node, id: `pane-${targetTerminalId}`, terminalId: targetTerminalId }
      }
      if (node.terminalId === targetTerminalId) {
        return { ...node, id: `pane-${sourceTerminalId}`, terminalId: sourceTerminalId }
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
  const newNode: LayoutNode = { type: 'browser', id: `browser-${browserPaneId}`, browserPaneId }

  if (!root) {
    return { type: 'split', id: ROOT_SPLIT_ID, direction: 'horizontal', sizes: [100], children: [newNode] }
  }

  if (!targetId) {
    if (root.type === 'pane' || root.type === 'browser' || root.type === 'editor' || root.type === 'ghostty') {
      return { type: 'split', id: ROOT_SPLIT_ID, direction, sizes: [50, 50], children: [root, newNode] }
    }
    // Already a split — append
    const count = root.children.length + 1
    const newSizes = root.children.map(() => 100 / count)
    newSizes.push(100 / count)
    return { ...root, id: ROOT_SPLIT_ID, children: [...root.children, newNode], sizes: newSizes }
  }

  function traverseAndAdd(node: LayoutNode): LayoutNode {
    const splitChildren = [node, newNode]
    const splitId = `split-${splitChildren.map(c => c.id).join('|')}`

    if (node.type === 'pane') {
      if (node.terminalId === targetId) {
        return { type: 'split', id: splitId, direction, sizes: [50, 50], children: splitChildren }
      }
      return node
    }
    if (node.type === 'browser') {
      if (node.browserPaneId === targetId) {
        return { type: 'split', id: splitId, direction, sizes: [50, 50], children: splitChildren }
      }
      return node
    }
    if (node.type === 'editor') {
      if (node.editorPaneId === targetId) {
        return { type: 'split', id: splitId, direction, sizes: [50, 50], children: splitChildren }
      }
      return node
    }
    if (node.type === 'ghostty') {
      if (node.ghosttyPaneId === targetId) {
        return { type: 'split', id: splitId, direction, sizes: [50, 50], children: splitChildren }
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
      // Don't collapse 1-child splits — keeps react-resizable-panels component tree stable
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
  const newNode: LayoutNode = { type: 'editor', id: `editor-${editorPaneId}`, editorPaneId }

  if (!root) {
    return { type: 'split', id: ROOT_SPLIT_ID, direction: 'horizontal', sizes: [100], children: [newNode] }
  }

  if (!targetId) {
    if (root.type === 'pane' || root.type === 'browser' || root.type === 'editor' || root.type === 'ghostty') {
      return { type: 'split', id: ROOT_SPLIT_ID, direction, sizes: [50, 50], children: [root, newNode] }
    }
    // Already a split — append
    const count = root.children.length + 1
    const newSizes = root.children.map(() => 100 / count)
    newSizes.push(100 / count)
    return { ...root, id: ROOT_SPLIT_ID, children: [...root.children, newNode], sizes: newSizes }
  }

  function traverseAndAdd(node: LayoutNode): LayoutNode {
    const splitChildren = [node, newNode]
    const splitId = `split-${splitChildren.map(c => c.id).join('|')}`

    if (node.type === 'pane') {
      if (node.terminalId === targetId) {
        return { type: 'split', id: splitId, direction, sizes: [50, 50], children: splitChildren }
      }
      return node
    }
    if (node.type === 'browser') {
      if (node.browserPaneId === targetId) {
        return { type: 'split', id: splitId, direction, sizes: [50, 50], children: splitChildren }
      }
      return node
    }
    if (node.type === 'editor') {
      if (node.editorPaneId === targetId) {
        return { type: 'split', id: splitId, direction, sizes: [50, 50], children: splitChildren }
      }
      return node
    }
    if (node.type === 'ghostty') {
      if (node.ghosttyPaneId === targetId) {
        return { type: 'split', id: splitId, direction, sizes: [50, 50], children: splitChildren }
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
      // Don't collapse 1-child splits — keeps react-resizable-panels component tree stable
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

export function addGhosttyPaneToLayout(
  root: LayoutNode | null,
  ghosttyPaneId: string,
  targetId?: string,
  direction: LayoutDirection = 'horizontal'
): LayoutNode {
  const newNode: LayoutNode = { type: 'ghostty', id: `ghostty-${ghosttyPaneId}`, ghosttyPaneId }

  if (!root) {
    return { type: 'split', id: ROOT_SPLIT_ID, direction: 'horizontal', sizes: [100], children: [newNode] }
  }

  if (!targetId) {
    if (root.type === 'pane' || root.type === 'browser' || root.type === 'editor' || root.type === 'ghostty') {
      return { type: 'split', id: ROOT_SPLIT_ID, direction, sizes: [50, 50], children: [root, newNode] }
    }
    const count = root.children.length + 1
    const newSizes = root.children.map(() => 100 / count)
    newSizes.push(100 / count)
    return { ...root, id: ROOT_SPLIT_ID, children: [...root.children, newNode], sizes: newSizes }
  }

  function traverseAndAdd(node: LayoutNode): LayoutNode {
    const splitChildren = [node, newNode]
    const splitId = `split-${splitChildren.map(c => c.id).join('|')}`
    if (node.type === 'pane') {
      if (node.terminalId === targetId) return { type: 'split', id: splitId, direction, sizes: [50, 50], children: splitChildren }
      return node
    }
    if (node.type === 'browser') {
      if (node.browserPaneId === targetId) return { type: 'split', id: splitId, direction, sizes: [50, 50], children: splitChildren }
      return node
    }
    if (node.type === 'editor') {
      if (node.editorPaneId === targetId) return { type: 'split', id: splitId, direction, sizes: [50, 50], children: splitChildren }
      return node
    }
    if (node.type === 'ghostty') {
      if (node.ghosttyPaneId === targetId) return { type: 'split', id: splitId, direction, sizes: [50, 50], children: splitChildren }
      return node
    }
    if (node.type === 'split') return { ...node, children: node.children.map(traverseAndAdd) }
    return node
  }

  return traverseAndAdd(root)
}

export function removeGhosttyPaneFromLayout(root: LayoutNode | null, ghosttyPaneId: string): LayoutNode | null {
  if (!root) return null

  function traverseAndRemove(node: LayoutNode): LayoutNode | null {
    if (node.type === 'ghostty') return node.ghosttyPaneId === ghosttyPaneId ? null : node
    if (node.type === 'pane' || node.type === 'browser' || node.type === 'editor') return node
    if (node.type === 'split') {
      const newChildren = node.children.map(traverseAndRemove).filter(Boolean) as LayoutNode[]
      if (newChildren.length === 0) return null
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
