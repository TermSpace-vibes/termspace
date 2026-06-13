import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { BrowserPane as BrowserPaneType, LayoutNode } from '../../types'

const EMPTY_BROWSER_PANES: BrowserPaneType[] = []

import { NativeTerminalPane } from './NativeTerminalPane'
import { TerminalPane } from './TerminalPane'
import { BrowserPane } from './BrowserPane'
import { EditorPaneComponent } from '../EditorPane'
import { KubernetesPaneComponent } from './KubernetesPaneComponent'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { useAppStore } from '../../store/useAppStore'

interface Props {
  workspaceId: string
  activeTerminalId: string | null
  onFocus: (terminalId: string) => void
  onClose: (terminalId: string) => void
  onSplit: (terminalId: string, direction: 'horizontal' | 'vertical') => void
  onCloseBrowserPane: (browserPaneId: string) => void
  onSplitBrowserPane: (browserPaneId: string, direction: 'horizontal' | 'vertical', initialUrl?: string) => void
}

const getFlatNodes = (node: LayoutNode | null): LayoutNode[] => {
  if (!node) return []
  if (node.type === 'split') return node.children.flatMap(getFlatNodes)
  return [node]
}

const MemoizedSplitGroup = React.memo(({ node, onLayoutChange, children }: any) => {
  const handleLayout = React.useCallback((sizes: number[]) => {
    onLayoutChange(node.id, sizes)
  }, [node.id, onLayoutChange])

  return (
    <Group 
      orientation={node.direction} 
      id={node.id} 
      // @ts-ignore: onLayout takes number[]
      onLayout={handleLayout} 
      style={{ width: '100%', height: '100%' }}
    >
      {children}
    </Group>
  )
})

export const TerminalGrid = React.memo(function TerminalGrid({ workspaceId, activeTerminalId, onFocus, onClose, onSplit, onCloseBrowserPane, onSplitBrowserPane }: Props) {
  const [maximizedTerminalId, setMaximizedTerminalId] = useState<string | null>(null)
  const reorderTerminals = useAppStore((s) => s.reorderTerminals)
  const updateLayoutSizes = useAppStore((s) => s.updateLayoutSizes)
  const layout = useAppStore((s) => s.layoutsByWorkspace[workspaceId])
  const browserPanes = useAppStore((s) => s.browserPanesByWorkspace[workspaceId] ?? EMPTY_BROWSER_PANES)
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId)
  const terminalRenderer = useAppStore((s) => s.settings.terminalRenderer) || 'native'
  
  // DRAG STATE IS NOW FULLY REACTIVE VIA ZUSTAND
  const draggedTerminalId = useAppStore((s) => s.draggedTerminalId)

  const containerRef = useRef<HTMLDivElement>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const elementsRef = useRef<Set<Element>>(new Set())
  const [rects, setRects] = useState<Record<string, { x: number, y: number, width: number, height: number }>>({})

  useEffect(() => {
    const obs = new ResizeObserver((entries) => {
      if (!containerRef.current) return
      const containerRect = containerRef.current.getBoundingClientRect()
      
      setRects(prev => {
        const next = { ...prev }
        let changed = false
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.nodeId
          if (id) {
            const rect = entry.target.getBoundingClientRect()
            const relative = {
              x: rect.left - containerRect.left,
              y: rect.top - containerRect.top,
              width: rect.width,
              height: rect.height
            }
            const p = next[id]
            if (!p || Math.abs(p.x - relative.x) > 1 || Math.abs(p.y - relative.y) > 1 || Math.abs(p.width - relative.width) > 1 || Math.abs(p.height - relative.height) > 1) {
               next[id] = relative
               changed = true
            }
          }
        }
        return changed ? next : prev
      })
    })
    
    observerRef.current = obs
    elementsRef.current.forEach(el => obs.observe(el))
    
    return () => {
      obs.disconnect()
      observerRef.current = null
    }
  }, [])

  const flatNodes = useMemo(() => getFlatNodes(layout), [layout])

  if (!layout) return null

  const isMaximized = maximizedTerminalId !== null

  const containsMaximized = (n: LayoutNode): boolean => {
    if (!maximizedTerminalId) return false
    if (n.type === 'pane' && n.terminalId === maximizedTerminalId) return true
    if (n.type === 'browser' && n.browserPaneId === maximizedTerminalId) return true
    if (n.type === 'editor' && n.editorPaneId === maximizedTerminalId) return true
    if (n.type === 'kubernetes' && n.kubernetesPaneId === maximizedTerminalId) return true
    if (n.type === 'split') return n.children.some(containsMaximized)
    return false
  }

  const handleToggleMaximize = useCallback((id: string) => {
    setMaximizedTerminalId(prev => prev === id ? null : id)
  }, [])

  const maximizedRef = useRef(maximizedTerminalId)
  useEffect(() => {
    maximizedRef.current = maximizedTerminalId
  }, [maximizedTerminalId])

  const layoutUpdateTimeoutRef = useRef<Record<string, number>>({})

  const handleLayoutChange = useCallback((id: string, sizes: number[]) => {
    if (maximizedRef.current !== null) return
    
    if (layoutUpdateTimeoutRef.current[id]) {
      clearTimeout(layoutUpdateTimeoutRef.current[id])
    }
    
    layoutUpdateTimeoutRef.current[id] = window.setTimeout(() => {
      updateLayoutSizes(workspaceId, id, sizes)
    }, 100)
  }, [workspaceId, updateLayoutSizes])

  const handleCloseTerminal = useCallback((id: string) => {
    setMaximizedTerminalId(prev => prev === id ? null : prev)
    onClose(id)
  }, [onClose])

  const renderTerminal = (terminalId: string) => {
    return (
      <div style={{ width: '100%', height: '100%' }}>
        {terminalRenderer === 'xterm' ? (
          <TerminalPane
            terminalId={terminalId}
            workspaceId={workspaceId}
            isActive={terminalId === activeTerminalId}
            isDragOver={draggedTerminalId === terminalId}
            isMaximized={maximizedTerminalId === terminalId}
            onFocus={onFocus}
            onSplit={onSplit}
            onToggleMaximize={handleToggleMaximize}
            onClose={handleCloseTerminal}
          />
        ) : (
          <NativeTerminalPane
            terminalId={terminalId}
            workspaceId={workspaceId}
            isActive={terminalId === activeTerminalId}
            isDragOver={draggedTerminalId === terminalId}
            isMaximized={maximizedTerminalId === terminalId}
            onFocus={onFocus}
            onSplit={onSplit}
            onToggleMaximize={handleToggleMaximize}
            onClose={handleCloseTerminal}
          />
        )}
      </div>
    )
  }

  const renderBrowserPane = (browserPaneId: string) => {
    const pane = browserPanes.find(p => p.id === browserPaneId)
    if (!pane) {
      return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-main)', height: '100%' }}>
          <div style={{ height: 36, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 8px', background: '#1e1e1e', borderBottom: '1px solid #333' }}>
            <button onClick={() => onCloseBrowserPane(browserPaneId)} style={{ width: 22, height: 22, background: 'transparent', border: '1px solid #333', borderRadius: 4, color: '#e06c75', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>&#x2715;</button>
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: 14 }}>
            Ghost pane (not found in DB)
          </div>
        </div>
      )
    }
    return (
      <div style={{ width: '100%', height: '100%', minWidth: 0, minHeight: 0 }}>
        <BrowserPane
          workspaceId={workspaceId}
          browserPaneId={pane.id}
          initialUrl={pane.url}
          isActive={pane.id === activeTerminalId}
          isMaximized={maximizedTerminalId === pane.id}
          isHidden={(isMaximized && maximizedTerminalId !== pane.id) || workspaceId !== activeWorkspaceId}
          onFocus={() => onFocus(pane.id)}
          onClose={() => {
            if (maximizedTerminalId === pane.id) setMaximizedTerminalId(null)
            onCloseBrowserPane(pane.id)
          }}
          onSplit={(direction, initialUrl) => onSplitBrowserPane(pane.id, direction, initialUrl)}
          onToggleMaximize={() => setMaximizedTerminalId(maximizedTerminalId === pane.id ? null : pane.id)}
        />
      </div>
    )
  }

  const renderEditorPane = (editorPaneId: string) => {
    return (
      <div onMouseDownCapture={() => onFocus(editorPaneId)} style={{ width: '100%', height: '100%', minWidth: 0, minHeight: 0 }}>
        <EditorPaneComponent
          workspaceId={workspaceId}
          editorPaneId={editorPaneId}
          isActive={editorPaneId === activeTerminalId}
        />
      </div>
    )
  }

  const renderKubernetesPane = (kubernetesPaneId: string) => {
    return (
      <div onMouseDownCapture={() => onFocus(kubernetesPaneId)} style={{ width: '100%', height: '100%', minWidth: 0, minHeight: 0 }}>
        <KubernetesPaneComponent
          workspaceId={workspaceId}
          paneId={kubernetesPaneId}
          isActive={kubernetesPaneId === activeTerminalId}
        />
      </div>
    )
  }

  const renderLayoutPlaceholder = (node: LayoutNode): React.ReactNode => {
    if (node.type === 'pane' || node.type === 'browser' || node.type === 'editor' || node.type === 'kubernetes') {
      return (
        <div
          data-node-id={node.id}
          ref={(el) => {
            if (el) {
              elementsRef.current.add(el)
              if (observerRef.current) observerRef.current.observe(el)
            }
          }}
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
          }}
          onDragEnter={(e) => {
            e.preventDefault()
            const sourceId = draggedTerminalId
            if (sourceId && node.type === 'pane' && sourceId !== node.terminalId) {
              reorderTerminals(workspaceId, sourceId, node.terminalId)
            }
          }}
          // By dynamically toggling pointer-events based on draggedTerminalId state,
          // the drop-zones become active ONLY when dragging!
          style={{ width: '100%', height: '100%', pointerEvents: draggedTerminalId ? 'auto' : 'none' }}
        />
      )
    }

    if (node.type === 'split') {
      return (
        <MemoizedSplitGroup 
          node={node}
          onLayoutChange={handleLayoutChange}
        >
          {node.children.flatMap((child, idx) => {
            const hasMaximized = containsMaximized(child)
            const shouldHide = isMaximized && !hasMaximized
            
            const elements = []
            
            if (idx > 0 && !isMaximized) {
              elements.push(
                <Separator
                  key={`handle-${node.id}-${idx}`}
                  id={`handle-${node.id}-${idx}`}
                  style={{
                    width: node.direction === 'horizontal' ? '2px' : '100%',
                    height: node.direction === 'vertical' ? '2px' : '100%',
                    cursor: node.direction === 'horizontal' ? 'col-resize' : 'row-resize',
                    background: 'var(--border-inactive)',
                    pointerEvents: 'auto',
                  }}
                />
              )
            }
            
            const savedSize = node.sizes?.[idx]
            const safeSize = (typeof savedSize === 'number' && !Number.isNaN(savedSize) && savedSize > 0) ? savedSize : (100 / node.children.length)

            elements.push(
              <Panel
                key={`panel-${child.id}`}
                id={child.id}
                defaultSize={safeSize}
                minSize={0}
                // @ts-ignore
                data-hidden-panel={shouldHide ? "true" : undefined}
                data-maximized-panel={isMaximized && !shouldHide ? "true" : undefined}
              >
                {renderLayoutPlaceholder(child)}
              </Panel>
            )

            return elements
          })}
        </MemoizedSplitGroup>
      )
    }

    return null
  }

  const getNodeKey = (node: LayoutNode) => {
    if (node.type === 'pane') return `pane-${node.terminalId}`
    if (node.type === 'browser') return `browser-${node.browserPaneId}`
    if (node.type === 'editor') return `editor-${node.editorPaneId}`
    if (node.type === 'kubernetes') return `kubernetes-${node.kubernetesPaneId}`
    return node.id
  }

  const renderAbsoluteNode = (node: LayoutNode) => {
    const isNodeMaximized = (node.type === 'pane' && node.terminalId === maximizedTerminalId) ||
                            (node.type === 'browser' && node.browserPaneId === maximizedTerminalId) ||
                            (node.type === 'editor' && node.editorPaneId === maximizedTerminalId) ||
                            (node.type === 'kubernetes' && node.kubernetesPaneId === maximizedTerminalId)
    
    if (isMaximized && !isNodeMaximized) return null

    const rect = rects[node.id]

    let styleObj: React.CSSProperties = { 
      position: 'absolute'
    }

    if (isNodeMaximized) {
      styleObj = { ...styleObj, top: 0, left: 0, width: '100%', height: '100%', zIndex: 10, opacity: 1 }
    } else if (rect) {
      styleObj = { ...styleObj, top: rect.y, left: rect.x, width: rect.width, height: rect.height, opacity: 1 }
    } else {
      styleObj = { ...styleObj, opacity: 0, pointerEvents: 'none' }
    }

    return (
      <div
        key={getNodeKey(node)}
        style={{ ...styleObj, overflow: 'hidden', pointerEvents: 'auto' }}
      >
        {node.type === 'pane' && renderTerminal(node.terminalId)}
        {node.type === 'browser' && renderBrowserPane(node.browserPaneId)}
        {node.type === 'editor' && renderEditorPane(node.editorPaneId)}
        {node.type === 'kubernetes' && renderKubernetesPane(node.kubernetesPaneId)}
      </div>
    )
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', flex: 1, padding: 0, minHeight: 0, minWidth: 0, overflow: 'hidden' }}>
      <style>{`
        [data-hidden-panel="true"] { display: none !important; }
        [data-maximized-panel="true"] { flex-basis: 100% !important; flex-grow: 1 !important; max-width: 100% !important; max-height: 100% !important; }
      `}</style>
      
      {/* 1. Absolute Floating Panes Layer (Behind) */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none', zIndex: 1 }}>
         {flatNodes.map(renderAbsoluteNode)}
      </div>

      {/* 2. Layout Grid Layer (In Front) - invisible drop zones and separators */}
      <div style={{ width: '100%', height: '100%', zIndex: 2, position: 'relative', pointerEvents: 'none' }}>
         <div style={{ width: '100%', height: '100%' }}>
            {renderLayoutPlaceholder(layout)}
         </div>
      </div>
    </div>
  )
}, (prev, next) => {
  return prev.workspaceId === next.workspaceId &&
         prev.activeTerminalId === next.activeTerminalId &&
         true
})
