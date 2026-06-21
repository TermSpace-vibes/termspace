import React from 'react'
import { useAppStore } from '../../store/useAppStore'

export const WorkspaceTabBar: React.FC<{ workspaceId: string }> = ({ workspaceId }) => {
  const tabs = useAppStore(s => s.tabsByWorkspace[workspaceId] || [])
  const activeTabId = useAppStore(s => s.activeTabIds[workspaceId])
  const setActiveTabId = useAppStore(s => s.setActiveTabId)
  const createTab = useAppStore(s => s.createTab)

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
      {tabs.map(tab => {
        const isActive = tab.id === activeTabId
        return (
          <button 
            key={tab.id}
            onClick={() => setActiveTabId(workspaceId, tab.id)}
            style={{
              padding: '4px 16px',
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
            {tab.name}
          </button>
        )
      })}
      <button 
        onClick={() => createTab(workspaceId, 'New Tab')}
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
