import { describe, expect, it } from 'vitest'
import { normalizePersistedBrowserTabs } from './browserPaneTabsState'

describe('normalizePersistedBrowserTabs', () => {
  it('restores saved browser tabs and active tab for a browser pane', () => {
    const normalized = normalizePersistedBrowserTabs('pane-1', 'https://initial.test', {
      activeTabId: 'tab-2',
      tabs: [
        { id: 'pane-1', url: 'https://youtube.com/watch?v=1', title: 'Video' },
        { id: 'tab-2', url: 'https://example.com', title: 'Docs' },
      ],
    })

    expect(normalized.activeTabId).toBe('tab-2')
    expect(normalized.tabs).toEqual([
      { id: 'pane-1', url: 'https://youtube.com/watch?v=1', title: 'Video' },
      { id: 'tab-2', url: 'https://example.com', title: 'Docs' },
    ])
  })

  it('falls back to the primary tab when saved state is missing or invalid', () => {
    const normalized = normalizePersistedBrowserTabs('pane-1', 'https://initial.test', {
      activeTabId: 'missing',
      tabs: [{ id: '', url: '', title: '' }],
    })

    expect(normalized).toEqual({
      activeTabId: 'pane-1',
      tabs: [{ id: 'pane-1', url: 'https://initial.test', title: 'New Tab' }],
    })
  })
})
