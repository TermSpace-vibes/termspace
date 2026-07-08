export interface BrowserPaneTabState {
  id: string
  url: string
  title: string
  icon?: string
  isDiscarded?: boolean
}

export interface BrowserPaneTabsSnapshot {
  tabs: BrowserPaneTabState[]
  activeTabId: string
}

export function browserPaneTabsStateKey(browserPaneId: string): string {
  return `browser-pane-tabs-v1:${browserPaneId}`
}

export function normalizePersistedBrowserTabs(
  browserPaneId: string,
  initialUrl: string,
  snapshot: BrowserPaneTabsSnapshot | null | undefined
): BrowserPaneTabsSnapshot {
  const fallbackTab = { id: browserPaneId, url: initialUrl, title: 'New Tab' }
  const validTabs = (snapshot?.tabs ?? [])
    .filter((tab) => tab.id && tab.url)
    .map((tab) => ({
      id: tab.id,
      url: tab.url,
      title: tab.title || 'New Tab',
      ...(tab.icon ? { icon: tab.icon } : {}),
      ...(tab.isDiscarded ? { isDiscarded: true } : {}),
    }))

  if (!validTabs.some((tab) => tab.id === browserPaneId)) {
    validTabs.unshift(fallbackTab)
  }

  const tabs = validTabs.length > 0 ? validTabs : [fallbackTab]
  const activeTabId = tabs.some((tab) => tab.id === snapshot?.activeTabId)
    ? snapshot!.activeTabId
    : browserPaneId

  return { tabs, activeTabId }
}
