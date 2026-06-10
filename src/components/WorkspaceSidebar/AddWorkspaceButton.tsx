interface Props {
  isCollapsed?: boolean
  onClick: () => void 
}

export function AddWorkspaceButton({ isCollapsed, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      aria-label="new workspace"
      title={isCollapsed ? "New workspace" : undefined}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: isCollapsed ? 'center' : 'flex-start',
        gap: 8, width: '100%',
        padding: isCollapsed ? '8px 0' : '6px 12px', background: 'none',
        border: 'none', borderRadius: 4,
        cursor: 'pointer', color: 'var(--text-inactive)', fontSize: 13,
        transition: 'all 0.15s ease'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = 'var(--text-active)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = 'var(--text-inactive)'
      }}
    >
      <div style={{ width: 12, height: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-item-active)', borderRadius: 3, flexShrink: 0 }}>
        <span style={{ fontSize: 10, lineHeight: 1, marginTop: -1 }}>+</span>
      </div>
      {!isCollapsed && <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>New Workspace</span>}
    </button>
  )
}
