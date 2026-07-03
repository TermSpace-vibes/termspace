import { LayoutNode, LayoutDirection } from '../types'

const ROOT_SPLIT_ID = 'root'

function isLeafNode(node: LayoutNode): boolean {
  return node.type === 'pane' || node.type === 'browser' || node.type === 'editor' || node.type === 'kubernetes' || node.type === 'docker' || node.type === 'claude'
}

function addToSplit(root: LayoutNode & { type: 'split' }, newPane: LayoutNode): LayoutNode {
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

function wrapWithSplit(root: LayoutNode, newPane: LayoutNode, direction: LayoutDirection): LayoutNode {
  return {
    type: 'split',
    id: ROOT_SPLIT_ID,
    direction,
    sizes: [50, 50],
    children: [root, newPane],
  }
}

function addToExistingSplitOrWrap(root: LayoutNode, newPane: LayoutNode, direction: LayoutDirection, targetId?: string): LayoutNode {
  if (!targetId) {
    if (isLeafNode(root)) {
      return wrapWithSplit(root, newPane, direction)
    }
    return addToSplit(root as { type: 'split'; id: string; direction: LayoutDirection; sizes: number[]; children: LayoutNode[] }, newPane)
  }

  function matchTarget(node: LayoutNode): boolean {
    if (node.type === 'pane') return node.terminalId === targetId
    if (node.type === 'browser') return node.browserPaneId === targetId
    if (node.type === 'editor') return node.editorPaneId === targetId
    if (node.type === 'kubernetes') return node.kubernetesPaneId === targetId
    if (node.type === 'docker') return node.dockerPaneId === targetId
    return false
  }

  function traverseAndAdd(node: LayoutNode): LayoutNode {
    const splitChildren = [node, newPane]
    const splitId = `split-${splitChildren.map(c => c.id).join('|')}`

    if (matchTarget(node)) {
      return { type: 'split', id: splitId, direction, sizes: [50, 50], children: splitChildren }
    }

    if (node.type === 'split') {
      return { ...node, children: node.children.map(traverseAndAdd) }
    }
    return node
  }

  return traverseAndAdd(root)
}

// ---- Terminal ----

export function addTerminalToLayout(
  root: LayoutNode | null,
  terminalId: string,
  targetId?: string,
  direction: LayoutDirection = 'horizontal'
): LayoutNode {
  const newPane: LayoutNode = { type: 'pane', id: `pane-${terminalId}`, terminalId }
  if (!root) return { type: 'split', id: ROOT_SPLIT_ID, direction: 'horizontal', sizes: [100], children: [newPane] }
  return addToExistingSplitOrWrap(root, newPane, direction, targetId)
}

export function removeTerminalFromLayout(root: LayoutNode | null, terminalId: string): LayoutNode | null {
  if (!root) return null
  function traverseAndRemove(node: LayoutNode): LayoutNode | null {
    if (node.type === 'pane') return node.terminalId === terminalId ? null : node
    if (node.type === 'browser' || node.type === 'editor' || node.type === 'kubernetes' || node.type === 'docker' || node.type === 'claude') return node
    if (node.type === 'split') {
      const newChildren = node.children.map(traverseAndRemove).filter(Boolean) as LayoutNode[]
      if (newChildren.length === 0) return null
      const removedCount = node.children.length - newChildren.length
      if (removedCount === 0) return { ...node, children: newChildren }
      const removedIndices = new Set(node.children.map((_, i) => i).filter(i => !newChildren.includes(node.children[i])))
      const survivingOriginalSizes = node.sizes.filter((_, i) => !removedIndices.has(i))
      const total = survivingOriginalSizes.reduce((a, b) => a + b, 0)
      const normalizedSizes = survivingOriginalSizes.map(s => total > 0 ? (s / total) * 100 : 100 / newChildren.length)
      return { ...node, children: newChildren, sizes: normalizedSizes }
    }
    return node
  }
  return traverseAndRemove(root)
}

// ---- Browser ----

export function addBrowserPaneToLayout(
  root: LayoutNode | null,
  browserPaneId: string,
  targetId?: string,
  direction: LayoutDirection = 'horizontal'
): LayoutNode {
  const newNode: LayoutNode = { type: 'browser', id: `browser-${browserPaneId}`, browserPaneId }
  if (!root) return { type: 'split', id: ROOT_SPLIT_ID, direction: 'horizontal', sizes: [100], children: [newNode] }
  return addToExistingSplitOrWrap(root, newNode, direction, targetId)
}

export function removeBrowserPaneFromLayout(root: LayoutNode | null, browserPaneId: string): LayoutNode | null {
  if (!root) return null
  function traverseAndRemove(node: LayoutNode): LayoutNode | null {
    if (node.type === 'browser') return node.browserPaneId === browserPaneId ? null : node
    if (node.type === 'pane' || node.type === 'editor' || node.type === 'kubernetes' || node.type === 'docker' || node.type === 'claude') return node
    if (node.type === 'split') {
      const newChildren = node.children.map(traverseAndRemove).filter(Boolean) as LayoutNode[]
      if (newChildren.length === 0) return null
      const removedCount = node.children.length - newChildren.length
      if (removedCount === 0) return { ...node, children: newChildren }
      const removedIndices = new Set(node.children.map((_, i) => i).filter(i => !newChildren.includes(node.children[i])))
      const survivingOriginalSizes = node.sizes.filter((_, i) => !removedIndices.has(i))
      const total = survivingOriginalSizes.reduce((a, b) => a + b, 0)
      const normalizedSizes = survivingOriginalSizes.map(s => total > 0 ? (s / total) * 100 : 100 / newChildren.length)
      return { ...node, children: newChildren, sizes: normalizedSizes }
    }
    return node
  }
  return traverseAndRemove(root)
}

// ---- Editor ----

export function addEditorPaneToLayout(
  root: LayoutNode | null,
  editorPaneId: string,
  targetId?: string,
  direction: LayoutDirection = 'horizontal'
): LayoutNode {
  const newNode: LayoutNode = { type: 'editor', id: `editor-${editorPaneId}`, editorPaneId }
  if (!root) return { type: 'split', id: ROOT_SPLIT_ID, direction: 'horizontal', sizes: [100], children: [newNode] }
  return addToExistingSplitOrWrap(root, newNode, direction, targetId)
}

export function removeEditorPaneFromLayout(root: LayoutNode | null, editorPaneId: string): LayoutNode | null {
  if (!root) return null
  function traverseAndRemove(node: LayoutNode): LayoutNode | null {
    if (node.type === 'editor') return node.editorPaneId === editorPaneId ? null : node
    if (node.type === 'pane' || node.type === 'browser' || node.type === 'kubernetes' || node.type === 'docker' || node.type === 'claude') return node
    if (node.type === 'split') {
      const newChildren = node.children.map(traverseAndRemove).filter(Boolean) as LayoutNode[]
      if (newChildren.length === 0) return null
      const removedCount = node.children.length - newChildren.length
      if (removedCount === 0) return { ...node, children: newChildren }
      const removedIndices = new Set(node.children.map((_, i) => i).filter(i => !newChildren.includes(node.children[i])))
      const survivingOriginalSizes = node.sizes.filter((_, i) => !removedIndices.has(i))
      const total = survivingOriginalSizes.reduce((a, b) => a + b, 0)
      const normalizedSizes = survivingOriginalSizes.map(s => total > 0 ? (s / total) * 100 : 100 / newChildren.length)
      return { ...node, children: newChildren, sizes: normalizedSizes }
    }
    return node
  }
  return traverseAndRemove(root)
}

// ---- Kubernetes ----

export function addKubernetesPaneToLayout(
  root: LayoutNode | null,
  kubernetesPaneId: string,
  targetId?: string,
  direction: LayoutDirection = 'horizontal'
): LayoutNode {
  const newNode: LayoutNode = { type: 'kubernetes', id: `k8s-${kubernetesPaneId}`, kubernetesPaneId }
  if (!root) return { type: 'split', id: ROOT_SPLIT_ID, direction: 'horizontal', sizes: [100], children: [newNode] }
  return addToExistingSplitOrWrap(root, newNode, direction, targetId)
}

export function removeKubernetesPaneFromLayout(root: LayoutNode | null, kubernetesPaneId: string): LayoutNode | null {
  if (!root) return null
  function traverseAndRemove(node: LayoutNode): LayoutNode | null {
    if (node.type === 'kubernetes') return node.kubernetesPaneId === kubernetesPaneId ? null : node
    if (node.type === 'pane' || node.type === 'browser' || node.type === 'editor' || node.type === 'docker' || node.type === 'claude') return node
    if (node.type === 'split') {
      const newChildren = node.children.map(traverseAndRemove).filter(Boolean) as LayoutNode[]
      if (newChildren.length === 0) return null
      const removedCount = node.children.length - newChildren.length
      if (removedCount === 0) return { ...node, children: newChildren }
      const removedIndices = new Set(node.children.map((_, i) => i).filter(i => !newChildren.includes(node.children[i])))
      const survivingOriginalSizes = node.sizes.filter((_, i) => !removedIndices.has(i))
      const total = survivingOriginalSizes.reduce((a, b) => a + b, 0)
      const normalizedSizes = survivingOriginalSizes.map(s => total > 0 ? (s / total) * 100 : 100 / newChildren.length)
      return { ...node, children: newChildren, sizes: normalizedSizes }
    }
    return node
  }
  return traverseAndRemove(root)
}

// ---- Docker ----

export function addDockerPaneToLayout(
  root: LayoutNode | null,
  dockerPaneId: string,
  targetId?: string,
  direction: LayoutDirection = 'horizontal'
): LayoutNode {
  const newNode: LayoutNode = { type: 'docker', id: `docker-${dockerPaneId}`, dockerPaneId }
  if (!root) return { type: 'split', id: ROOT_SPLIT_ID, direction: 'horizontal', sizes: [100], children: [newNode] }
  return addToExistingSplitOrWrap(root, newNode, direction, targetId)
}

export function removeDockerPaneFromLayout(root: LayoutNode | null, dockerPaneId: string): LayoutNode | null {
  if (!root) return null
  function traverseAndRemove(node: LayoutNode): LayoutNode | null {
    if (node.type === 'docker') return node.dockerPaneId === dockerPaneId ? null : node
    if (node.type === 'pane' || node.type === 'browser' || node.type === 'editor' || node.type === 'kubernetes' || node.type === 'claude') return node
    if (node.type === 'split') {
      const newChildren = node.children.map(traverseAndRemove).filter(Boolean) as LayoutNode[]
      if (newChildren.length === 0) return null
      const removedCount = node.children.length - newChildren.length
      if (removedCount === 0) return { ...node, children: newChildren }
      const removedIndices = new Set(node.children.map((_, i) => i).filter(i => !newChildren.includes(node.children[i])))
      const survivingOriginalSizes = node.sizes.filter((_, i) => !removedIndices.has(i))
      const total = survivingOriginalSizes.reduce((a, b) => a + b, 0)
      const normalizedSizes = survivingOriginalSizes.map(s => total > 0 ? (s / total) * 100 : 100 / newChildren.length)
      return { ...node, children: newChildren, sizes: normalizedSizes }
    }
    return node
  }
  return traverseAndRemove(root)
}

// ---- Claude ----

export function addClaudePaneToLayout(
  root: LayoutNode | null,
  claudePaneId: string,
  targetId?: string,
  direction: LayoutDirection = 'horizontal'
): LayoutNode {
  const newNode: LayoutNode = { type: 'claude', id: `claude-${claudePaneId}`, claudePaneId }
  if (!root) return { type: 'split', id: ROOT_SPLIT_ID, direction: 'horizontal', sizes: [100], children: [newNode] }
  return addToExistingSplitOrWrap(root, newNode, direction, targetId)
}

export function removeClaudePaneFromLayout(root: LayoutNode | null, claudePaneId: string): LayoutNode | null {
  if (!root) return null
  function traverseAndRemove(node: LayoutNode): LayoutNode | null {
    if (node.type === 'claude') return node.claudePaneId === claudePaneId ? null : node
    if (isLeafNode(node)) return node
    if (node.type === 'split') {
      const newChildren = node.children.map(traverseAndRemove).filter(Boolean) as LayoutNode[]
      if (newChildren.length === 0) return null
      const removedCount = node.children.length - newChildren.length
      if (removedCount === 0) return { ...node, children: newChildren }
      const removedIndices = new Set(node.children.map((_, i) => i).filter(i => !newChildren.includes(node.children[i])))
      const survivingOriginalSizes = node.sizes.filter((_, i) => !removedIndices.has(i))
      const total = survivingOriginalSizes.reduce((a, b) => a + b, 0)
      const normalizedSizes = survivingOriginalSizes.map(s => total > 0 ? (s / total) * 100 : 100 / newChildren.length)
      return { ...node, children: newChildren, sizes: normalizedSizes }
    }
    return node
  }
  return traverseAndRemove(root)
}

// ---- Shared utilities ----

export function swapTerminalsInLayout(root: LayoutNode | null, sourceTerminalId: string, targetTerminalId: string): LayoutNode | null {
  if (!root) return null
  function traverseAndSwap(node: LayoutNode): LayoutNode {
    if (node.type === 'pane') {
      if (node.terminalId === sourceTerminalId) return { ...node, id: `pane-${targetTerminalId}`, terminalId: targetTerminalId }
      if (node.terminalId === targetTerminalId) return { ...node, id: `pane-${sourceTerminalId}`, terminalId: sourceTerminalId }
      return node
    }
    if (isLeafNode(node)) return node
    if (node.type === 'split') return { ...node, children: node.children.map(traverseAndSwap) }
    return node
  }
  return traverseAndSwap(root)
}

export function updateSplitSizes(root: LayoutNode | null, splitId: string, sizes: number[]): LayoutNode | null {
  if (!root) return null
  function traverseAndUpdate(node: LayoutNode): LayoutNode {
    if (isLeafNode(node)) return node
    if (node.type === 'split') {
      if (node.id === splitId) {
        const isSame = node.sizes && node.sizes.length === sizes.length && node.sizes.every((s, i) => Math.abs(s - sizes[i]) < 0.1)
        if (isSame) return node
        return { ...node, sizes, children: node.children }
      }
      let changed = false
      const newChildren = node.children.map(child => { const nc = traverseAndUpdate(child); if (nc !== child) changed = true; return nc })
      if (!changed) return node
      return { ...node, children: newChildren }
    }
    return node
  }
  return traverseAndUpdate(root)
}
