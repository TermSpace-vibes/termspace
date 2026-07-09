import React from 'react'
import { useAppStore } from '../../store/useAppStore'
import { WorkspaceTab } from '../../types'

const EMPTY_TABS: WorkspaceTab[] = []

export const WorkspaceTabBar: React.FC<{ workspaceId: string }> = ({ workspaceId }) => {
  const tabs = useAppStore(s => s.tabsByWorkspace[workspaceId] || EMPTY_TABS)
  const activeTabId = useAppStore(s => s.activeTabIds[workspaceId])
  const setActiveTabId = useAppStore(s => s.setActiveTabId)
  const createTab = useAppStore(s => s.createTab)
  const removeTab = useAppStore(s => s.removeTab)
  const renameTab = useAppStore(s => s.renameTab)
  const renderTabs = React.useMemo(() => {
    if (!activeTabId || tabs.some((tab) => tab.id === activeTabId)) return tabs
    return [{ id: activeTabId, workspaceId, name: 'Tab 1', position: 0, createdAt: 0 }]
  }, [activeTabId, tabs, workspaceId])
  const [editingTabId, setEditingTabId] = React.useState<string | null>(null)
  const [editingName, setEditingName] = React.useState('')

  return (
    <div style={{
      display: 'flex',
      backgroundColor: 'var(--bg-sidebar, #221e18)',
      padding: '8px',
      overflowX: 'auto',
      borderBottom: '1px solid var(--border-inactive, #2a2420)',
      gap: '8px',
      alignItems: 'center'
    }}>
      {renderTabs.map(tab => {
        const isActive = tab.id === activeTabId
        return (
          <button 
            key={tab.id}
            onDoubleClick={() => {
              setEditingTabId(tab.id)
              setEditingName(tab.name)
            }}
            onClick={() => setActiveTabId(workspaceId, tab.id)}
            style={{
              padding: '4px 12px 4px 16px',
              display: 'flex',
              alignItems: 'center',
              borderRadius: '6px',
              fontSize: '13px',
              transition: 'all 0.2s',
              border: 'none',
              cursor: 'pointer',
              backgroundColor: isActive ? 'var(--accent, #e8a045)' : 'var(--bg-terminal, #161310)',
              color: isActive ? 'var(--bg-main, #161310)' : 'var(--text-inactive, #5a5040)',
              fontWeight: isActive ? 600 : 400,
            }}
            onMouseEnter={e => {
              if (!isActive) {
                e.currentTarget.style.color = 'var(--accent, #e8a045)'
              }
            }}
            onMouseLeave={e => {
              if (!isActive) {
                e.currentTarget.style.color = 'var(--text-inactive, #5a5040)'
              }
            }}
          >
            {editingTabId === tab.id ? (
              <input
                autoFocus
                value={editingName}
                onChange={e => setEditingName(e.target.value)}
                onBlur={() => {
                  if (editingName.trim() && editingName !== tab.name) {
                    renameTab(workspaceId, tab.id, editingName.trim())
                  }
                  setEditingTabId(null)
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur()
                  } else if (e.key === 'Escape') {
                    setEditingTabId(null)
                  }
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'inherit',
                  font: 'inherit',
                  width: `${Math.max(editingName.length, 1)}ch`,
                  minWidth: '30px',
                  outline: 'none',
                  padding: 0,
                  margin: 0
                }}
              />
            ) : (
              tab.name
            )}
            {renderTabs.length > 1 && (
              <span
                onClick={(e) => {
                  e.stopPropagation()
                  removeTab(workspaceId, tab.id)
                }}
                style={{
                  marginLeft: '8px',
                  opacity: isActive ? 0.8 : 0.5,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '50%',
                  width: '16px',
                  height: '16px',
                  fontSize: '10px',
                  transition: 'background 0.2s, opacity 0.2s',
                  pointerEvents: 'auto'
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(255, 0, 0, 0.2)'
                  e.currentTarget.style.color = '#ff6b6b'
                  e.currentTarget.style.opacity = '1'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.color = 'inherit'
                  e.currentTarget.style.opacity = isActive ? '0.8' : '0.5'
                }}
              >
                ✕
              </span>
            )}
          </button>
        )
      })}
      <button 
        onClick={() => {
          const maxNum = renderTabs.reduce((max, tab) => {
            const match = tab.name.match(/^Tab (\d+)$/);
            return match ? Math.max(max, parseInt(match[1], 10)) : max;
          }, 0);
          createTab(workspaceId, `Tab ${maxNum + 1}`);
        }}
        style={{
          padding: '0 12px',
          color: 'var(--text-inactive, #5a5040)',
          fontSize: '18px',
          fontWeight: 'bold',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          transition: 'color 0.2s'
        }}
        onMouseEnter={e => e.currentTarget.style.color = 'var(--accent, #e8a045)'}
        onMouseLeave={e => e.currentTarget.style.color = 'var(--text-inactive, #5a5040)'}
      >
        +
      </button>
    </div>
  )
}
