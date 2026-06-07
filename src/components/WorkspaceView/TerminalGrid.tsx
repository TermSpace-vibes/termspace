import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { Terminal as TerminalType, BrowserPane as BrowserPaneType, LayoutNode } from '../../types'

const EMPTY_BROWSER_PANES: BrowserPaneType[] = []
import { NativeTerminalPane } from './NativeTerminalPane'
import { BrowserPane } from './BrowserPane'
import { EditorPaneComponent } from '../EditorPane'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { useAppStore } from '../../store/useAppStore'

interface Props {
  workspaceId: string
  terminals: TerminalType[]
  activeTerminalId: string | null
  onFocus: (terminalId: string) => void
  onClose: (terminalId: string) => void
  onSplit: (terminalId: string, direction: 'horizontal' | 'vertical') => void
  onCloseBrowserPane: (browserPaneId: string) => void
  onSplitBrowserPane: (browserPaneId: string, direction: 'horizontal' | 'vertical', initialUrl?: string) => void
}

const CustomResizeHandle = ({ id, direction }: { id: string, direction: 'horizontal' | 'vertical' }) => {
  return (
    <Separator
      id={id}
      style={{
        width: direction === 'horizontal' ? '2px' : '100%',
        height: direction === 'vertical' ? '2px' : '100%',
        cursor: direction === 'horizontal' ? 'col-resize' : 'row-resize',
        background: 'var(--border-inactive)',
      }}
    />
  )
}

export function TerminalGrid({ workspaceId, terminals, activeTerminalId, onFocus, onClose, onSplit, onCloseBrowserPane, onSplitBrowserPane }: Props) {
  const [maximizedTerminalId, setMaximizedTerminalId] = useState<string | null>(null)
  const [dragOverTerminalId, setDragOverTerminalId] = useState<string | null>(null)
  const reorderTerminals = useAppStore((s) => s.reorderTerminals)
  const updateLayoutSizes = useAppStore((s) => s.updateLayoutSizes)
  const layout = useAppStore((s) => s.layoutsByWorkspace[workspaceId])
  const browserPanes = useAppStore((s) => s.browserPanesByWorkspace[workspaceId] ?? EMPTY_BROWSER_PANES)
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId)

  if ((terminals.length === 0 && browserPanes.length === 0) || !layout) return null

  const isMaximized = maximizedTerminalId !== null

  const containsMaximized = (n: LayoutNode): boolean => {
    if (!maximizedTerminalId) return false
    if (n.type === 'pane' && n.terminalId === maximizedTerminalId) return true
    if (n.type === 'browser' && n.browserPaneId === maximizedTerminalId) return true
    if (n.type === 'editor' && n.editorPaneId === maximizedTerminalId) return true
    if (n.type === 'split') return n.children.some(containsMaximized)
    return false
  }

  const renderTerminal = (terminalId: string) => {
    const t = terminals.find(t => t.id === terminalId)
    if (!t) return null
    return (
      <motion.div
        key={t.id}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2 }}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          if (dragOverTerminalId !== t.id) setDragOverTerminalId(t.id)
        }}
        onDragLeave={() => {
          if (dragOverTerminalId === t.id) setDragOverTerminalId(null)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDragOverTerminalId(null)
          const sourceId = e.dataTransfer.getData('application/terminal-id')
          if (sourceId && sourceId !== t.id) {
            reorderTerminals(workspaceId, sourceId, t.id)
          }
        }}
        style={{
          display: isMaximized && maximizedTerminalId !== t.id ? 'none' : 'flex',
          width: '100%',
          height: '100%',
          minWidth: 0,
          minHeight: 0,
        }}
      >
        <NativeTerminalPane
          terminalId={t.id}
          workspaceId={workspaceId}
          isActive={t.id === activeTerminalId}
          isDragOver={dragOverTerminalId === t.id}
          isMaximized={maximizedTerminalId === t.id}
          onFocus={() => onFocus(t.id)}
          onSplit={(direction) => onSplit(t.id, direction)}
          onToggleMaximize={() => setMaximizedTerminalId(maximizedTerminalId === t.id ? null : t.id)}
          onClose={() => {
            if (maximizedTerminalId === t.id) setMaximizedTerminalId(null)
            onClose(t.id)
          }}
        />
      </motion.div>
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
      <div
        key={pane.id}
        style={{
          display: isMaximized && maximizedTerminalId !== pane.id ? 'none' : 'flex',
          width: '100%', height: '100%', minWidth: 0, minHeight: 0,
        }}
      >
        <BrowserPane
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
      <div
        key={editorPaneId}
        onMouseDownCapture={() => onFocus(editorPaneId)}
        style={{
          display: isMaximized && maximizedTerminalId !== editorPaneId ? 'none' : 'flex',
          width: '100%', height: '100%', minWidth: 0, minHeight: 0,
        }}
      >
        <EditorPaneComponent
          workspaceId={workspaceId}
          editorPaneId={editorPaneId}
          isActive={editorPaneId === activeTerminalId}
        />
      </div>
    )
  }

  const renderLayoutNode = (node: LayoutNode): React.ReactNode => {
    if (node.type === 'pane') {
      return renderTerminal(node.terminalId)
    }

    if (node.type === 'browser') {
      return renderBrowserPane(node.browserPaneId)
    }

    if (node.type === 'editor') {
      return renderEditorPane(node.editorPaneId)
    }

    if (node.type === 'split') {
      return (
        <Group 
          orientation={node.direction} 
          id={node.id}
          autoSave={node.id}
          // @ts-ignore: onLayout takes number[]
          onLayout={(sizes: number[]) => {
            if (!isMaximized) {
              updateLayoutSizes(workspaceId, node.id, sizes)
            }
          }}
          style={{ width: '100%', height: '100%' }}
        >
          {node.children.map((child, idx) => {
            const hasMaximized = containsMaximized(child)
            const shouldHide = isMaximized && !hasMaximized

            return (
              <React.Fragment key={child.id}>
                {idx > 0 && !isMaximized && <CustomResizeHandle id={`handle-${node.id}-${idx}`} direction={node.direction} />}
                <Panel
                  id={child.id}
                  defaultSize={node.sizes[idx] ?? (100 / node.children.length)}
                  // @ts-ignore: data-* attributes are passed to the outer div
                  data-hidden-panel={shouldHide ? "true" : undefined}
                  data-maximized-panel={isMaximized && !shouldHide ? "true" : undefined}
                >
                  {renderLayoutNode(child)}
                </Panel>
              </React.Fragment>
            )
          })}
        </Group>
      )
    }

    return null
  }

  return (
    <div style={{ flex: 1, padding: 0, minHeight: 0, minWidth: 0, overflow: 'hidden' }}>
      <style>{`
        [data-hidden-panel="true"] { display: none !important; }
        [data-maximized-panel="true"] { flex-basis: 100% !important; flex-grow: 1 !important; max-width: 100% !important; max-height: 100% !important; }
      `}</style>
      {renderLayoutNode(layout)}
    </div>
  )
}
