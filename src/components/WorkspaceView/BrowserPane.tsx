import { useEffect, useRef, useState, useLayoutEffect, useCallback } from 'react'
import { Shield, ShieldCheck, Smartphone, Tablet, Monitor } from 'lucide-react'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '../../utils/tauri'
import { useAppStore } from '../../store/useAppStore'
import { useBrowserMediaStore } from '../../store/useBrowserMediaStore'
import { useBrowserStartupMediaGate } from '../../hooks/useBrowserStartupMediaGate'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { deleteSqliteUiState, getSqliteUiState, setSqliteUiState } from '../../utils/sqliteUiState'
import {
  browserPaneTabsStateKey,
  normalizePersistedBrowserTabs,
} from '../../utils/browserPaneTabsState'
import type { BrowserPaneTabsSnapshot, BrowserPaneTabState } from '../../utils/browserPaneTabsState'

const EMPTY_ARRAY: any[] = []

interface Props {
  workspaceId: string
  tabId: string
  browserPaneId: string
  initialUrl: string
  isActive: boolean
  isMaximized: boolean
  isHidden?: boolean
  onFocus: () => void
  onClose: () => void
  onSplit: (direction: 'horizontal' | 'vertical', initialUrl?: string) => void
  onToggleMaximize: () => void
}

const HEADER_HEIGHT = 72 // 28 (tab bar) + 44 (url bar)

export function BrowserPane({
  workspaceId, tabId, browserPaneId, initialUrl, isActive, isMaximized: _isMaximized, isHidden,
  onFocus, onClose, onSplit, onToggleMaximize,
}: Props) {
  // Tabs state
  const [tabs, setTabs] = useState<BrowserPaneTabState[]>([
    { id: browserPaneId, url: initialUrl, title: 'New Tab' }
  ])
  const [activeTabId, setActiveTabId] = useState(browserPaneId)
  const [viewportMode, setViewportMode] = useState<'desktop' | 'mobile' | 'tablet'>('desktop')
  
  const browserHistory = useAppStore(s => s.browserHistory) || EMPTY_ARRAY as string[]
  const addToHistory = useAppStore(s => s.addToHistory)
  const addToast = useAppStore(s => s.addToast)
  const workspaceName = useAppStore(s => s.workspaces.find(w => w.id === workspaceId)?.name || '')
  const bookmarks = useAppStore(s => s.bookmarks) || EMPTY_ARRAY as { url: string; title: string; icon?: string }[]
  const addBookmark = useAppStore(s => s.addBookmark)
  const removeBookmark = useAppStore(s => s.removeBookmark)
  const showContextMenu = useAppStore(s => s.showContextMenu)
  
  const [showHistory, setShowHistory] = useState(false)
  const [showBookmarks, setShowBookmarks] = useState(false)
  // Tab-keyed store lookups must use tabId, not workspaceId
  const autoReload = useAppStore(s => s.browserPanesByTab[tabId]?.find(p => p.id === browserPaneId)?.autoReload ?? false)
  const updateBrowserPane = useAppStore(s => s.updateBrowserPane)
  const setAutoReload = (val: boolean) => updateBrowserPane(tabId, browserPaneId, { autoReload: val })
  const isModalOpen = useAppStore(s => s.isModalOpen)
  
  const adblockEnabled = useAppStore(s => s.settings?.adblockEnabled ?? true)
  const updateSettings = useAppStore(s => s.updateSettings)
  
  // The url/inputUrl now reflect the *active* tab
  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0]
  const [url, setUrl] = useState(activeTab?.url || initialUrl)
  const [inputUrl, setInputUrl] = useState(activeTab?.url || initialUrl)
  const [isEditingUrl, setIsEditingUrl] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const hiddenTabsRef = useRef<Set<string>>(new Set())
  const discardTimersRef = useRef<{ [id: string]: ReturnType<typeof setTimeout> }>({})
  const preconnectedUrlsRef = useRef<Set<string>>(new Set())
  const browserTabsRestoredRef = useRef(false)

  // Auto-pause media that starts playing in this (non-focused) pane during the
  // startup grace window; auto-resume it when the pane becomes focused.
  useBrowserStartupMediaGate({ isActive, tabIds: tabs.map((t) => t.id) })

  // Fetch suggestions
  useEffect(() => {
    if (!isEditingUrl || !inputUrl || inputUrl.length < 2) {
      setSuggestions(prev => prev.length === 0 ? prev : [])
      return
    }

    const historyMatches = browserHistory
      .filter(h => h.toLowerCase().includes(inputUrl.toLowerCase()))
      .slice(0, 3)

    setSuggestions(prev => {
      if (prev.length === historyMatches.length && prev.every((v, i) => v === historyMatches[i])) {
        return prev;
      }
      return historyMatches;
    })

    const timer = setTimeout(async () => {
      // 1. Preconnect to speed up navigation
      if (inputUrl.startsWith('http') || /^[a-zA-Z0-9\-\.]+\.[a-zA-Z]{2,6}/.test(inputUrl)) {
        const normalized = inputUrl.startsWith('http') ? inputUrl : `https://${inputUrl}`
        try {
          const { hostname } = new URL(normalized)
          if (!preconnectedUrlsRef.current.has(hostname)) {
            preconnectedUrlsRef.current.add(hostname)
            invoke('browser_preconnect', { url: normalized }).catch(() => {})
          }
        } catch (e) {}
      }

      // 2. Fetch suggestions
      try {
        const res = await fetch(`https://duckduckgo.com/ac/?q=${encodeURIComponent(inputUrl)}`)
        const data = await res.json()
        if (Array.isArray(data)) {
          const apiSuggestions = data.map((item: any) => item.phrase).slice(0, 5)
          
          if (!inputUrl.includes(' ') && !inputUrl.includes('.')) {
            apiSuggestions.unshift(`${inputUrl.toLowerCase()}.com`)
          }

          const combined = Array.from(new Set([...historyMatches, ...apiSuggestions])).slice(0, 8)
          setSuggestions(prev => {
            if (prev.length === combined.length && prev.every((v, i) => v === combined[i])) {
              return prev;
            }
            return combined;
          })
          setSelectedIndex(-1)
        }
      } catch (err) {
        console.error('Failed to fetch suggestions:', err)
      }
    }, 150)
    return () => clearTimeout(timer)
  }, [inputUrl, isEditingUrl, browserHistory])

  // Sync native webview position whenever the container bounds change.
  const syncBounds = useCallback(() => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    
    // If the component is hidden (e.g. by maximization of another pane) or too small,
    // or if a modal is open, we must move the native webview off-screen so it doesn't float over other UI.
    const isDropdownOpen = showBookmarks || showHistory
    const isNewTab = activeTab?.url === 'termspace://newtab'
    if (rect.width < 1 || rect.height <= HEADER_HEIGHT || isModalOpen || isHidden || isDropdownOpen || isNewTab) {
      invoke('hide_browser_pane', { id: activeTabId }).catch(() => {})
      return
    }
    // console.log(`[BrowserPane syncBounds] Showing pane! rect: ${rect.width}x${rect.height}`);

    // macOS native webviews with transparent windows have a coordinate offset 
    // where the Y position is shifted up by the height of the standard titlebar (28px).
    // We add 28px to compensate so it doesn't cover the URL panel.
    const MACOS_TITLEBAR_OFFSET = 28;

    let targetW = rect.width;
    let targetH = rect.height - HEADER_HEIGHT - MACOS_TITLEBAR_OFFSET;
    let targetX = rect.left;
    let targetY = rect.top + HEADER_HEIGHT + MACOS_TITLEBAR_OFFSET;

    if (viewportMode === 'mobile') {
      targetW = 390; // Standard mobile width
      targetH = 844;
    } else if (viewportMode === 'tablet') {
      targetW = 810; // Standard tablet width
      targetH = 1080;
    }

    if (viewportMode !== 'desktop') {
       // Clamp to available space with some padding
       const maxW = Math.max(1, rect.width - 32);
       const maxH = Math.max(1, rect.height - HEADER_HEIGHT - MACOS_TITLEBAR_OFFSET - 32);
       
       if (targetW > maxW) targetW = maxW;
       if (targetH > maxH) targetH = maxH;
       
       // Center the viewport
       targetX = rect.left + (rect.width - targetW) / 2;
       targetY = rect.top + HEADER_HEIGHT + MACOS_TITLEBAR_OFFSET + (rect.height - HEADER_HEIGHT - MACOS_TITLEBAR_OFFSET - targetH) / 2;
    }

    // Resize the active tab's webview to fit the hole
    invoke('show_browser_pane', { id: activeTabId }).catch(() => {})
    invoke('resize_browser_pane', {
      id: activeTabId,
      x: targetX,
      y: targetY,
      w: targetW,
      h: targetH,
    }).catch(() => {})
  }, [activeTabId, isModalOpen, isHidden, showBookmarks, showHistory, browserPaneId, activeTab?.url, viewportMode])

  useEffect(() => {
    let cancelled = false
    const restoreTabs = async () => {
      try {
        const saved = await getSqliteUiState<BrowserPaneTabsSnapshot>(browserPaneTabsStateKey(browserPaneId))
        if (cancelled) return
        const normalized = normalizePersistedBrowserTabs(browserPaneId, initialUrl, saved)
        const tabsToSpawn = normalized.tabs.filter(
          tab => tab.id !== browserPaneId && !tab.isDiscarded && tab.url !== 'termspace://newtab'
        )
        await Promise.all(tabsToSpawn.map(tab => invoke('spawn_ephemeral_browser_pane', {
          id: tab.id,
          url: tab.url,
          x: -10000,
          y: -10000,
          w: 800,
          h: 600,
          adblockEnabled,
        }).catch(console.error)))
        if (cancelled) return
        setTabs(normalized.tabs)
        setActiveTabId(normalized.activeTabId)
      } catch (err) {
        console.error('Failed to restore browser tabs:', err)
      } finally {
        browserTabsRestoredRef.current = true
      }
    }
    restoreTabs()
    return () => {
      cancelled = true
    }
  }, [browserPaneId, initialUrl, adblockEnabled])

  useEffect(() => {
    if (!browserTabsRestoredRef.current) return
    const snapshot: BrowserPaneTabsSnapshot = { tabs, activeTabId }
    const timer = setTimeout(() => {
      setSqliteUiState(browserPaneTabsStateKey(browserPaneId), snapshot).catch((err) => {
        console.error('Failed to persist browser tabs:', err)
      })
    }, 250)
    return () => clearTimeout(timer)
  }, [tabs, activeTabId, browserPaneId])

  // Handle hiding inactive tabs efficiently
  useEffect(() => {
    tabs.forEach(tab => {
      if (tab.id !== activeTabId && !tab.isDiscarded && !hiddenTabsRef.current.has(tab.id)) {
        invoke('hide_browser_pane', { id: tab.id }).catch(() => {})
        hiddenTabsRef.current.add(tab.id)
      }
    })

    const isNewTab = activeTab?.url === 'termspace://newtab'
    if (!isHidden && !isNewTab) {
      invoke('show_browser_pane', { id: activeTabId }).catch(() => {})
    } else {
      invoke('hide_browser_pane', { id: activeTabId }).catch(() => {})
    }
    hiddenTabsRef.current.delete(activeTabId)
  }, [activeTabId, tabs, isHidden, activeTab?.url])

  // Keep adblock setting synced with webview
  useEffect(() => {
    tabs.forEach(tab => {
        invoke('browser_toggle_adblock', { id: tab.id, enabled: adblockEnabled }).catch(() => {})
    })
  }, [adblockEnabled, tabs])

  // Sync when activeTabId changes or wake up discarded tab
  useEffect(() => {
    if (activeTab) {
      setUrl(activeTab.url)
      setInputUrl(activeTab.url)
      
      // Wake up discarded tab
      if (activeTab.isDiscarded) {
        invoke('spawn_ephemeral_browser_pane', {
          id: activeTab.id,
          url: activeTab.url,
          x: -10000, y: -10000, w: 800, h: 600,
          adblockEnabled,
        }).then(() => {
          setTabs(current => current.map(t => t.id === activeTab.id ? { ...t, isDiscarded: false } : t))
          setTimeout(syncBounds, 50)
        }).catch(err => {
          console.error('Failed to wake up tab:', err)
        })
      }
    }
    syncBounds()

    return () => {
      console.log(`[BrowserPane ${browserPaneId}] Unmounting, hiding native webview!`)
      invoke('resize_browser_pane', {
        id: activeTabId,
        x: -10000, y: -10000, w: 800, h: 600,
      }).catch(() => {})
    }
  }, [activeTabId, activeTab, syncBounds, browserPaneId])

  // Memory manager: discard inactive tabs after 2 minutes
  useEffect(() => {
    tabs.forEach(tab => {
      if (tab.id === activeTabId || tab.isDiscarded) {
        if (discardTimersRef.current[tab.id]) {
          clearTimeout(discardTimersRef.current[tab.id])
          delete discardTimersRef.current[tab.id]
        }
      } else {
        if (!discardTimersRef.current[tab.id]) {
          discardTimersRef.current[tab.id] = setTimeout(() => {
            setTabs(currentTabs => currentTabs.map(t => t.id === tab.id ? { ...t, isDiscarded: true } : t))

            // Clear media sessions for this tab before destroying the webview,
            // so stale sessions don't accumulate in the sidebar media widget.
            const mediaStore = useBrowserMediaStore.getState()
            mediaStore.removeSessionsForPane(tab.id)
            mediaStore.unregisterPane(tab.id)

            if (tab.id === browserPaneId) {
              invoke('hide_browser_pane', { id: tab.id }).catch(() => {})
            } else {
              invoke('destroy_ephemeral_browser_pane', { id: tab.id }).catch(() => {})
            }
          }, 2 * 60 * 1000)
        }
      }
    })

    // cleanup removed tabs
    const tabIds = new Set(tabs.map(t => t.id))
    Object.keys(discardTimersRef.current).forEach(id => {
      if (!tabIds.has(id)) {
        clearTimeout(discardTimersRef.current[id])
        delete discardTimersRef.current[id]
      }
    })
  }, [tabs, activeTabId, browserPaneId])

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(syncBounds)
    ro.observe(el)
    syncBounds()
    return () => ro.disconnect()
  }, [syncBounds])

  useEffect(() => {
    window.addEventListener('resize', syncBounds)
    return () => window.removeEventListener('resize', syncBounds)
  }, [syncBounds])

  useEffect(() => {
    syncBounds()
  }, [isModalOpen, syncBounds])

  // Listen for URL changes for *any* of our tabs
  useEffect(() => {
    const unlisten = listen<{ id: string; url: string }>('browser-pane-url-changed', (event) => {
      setTabs(currentTabs => {
        const tabExists = currentTabs.some(t => t.id === event.payload.id)
        if (!tabExists) return currentTabs
        
        return currentTabs.map(t => {
          if (t.id === event.payload.id) {
            return { ...t, url: event.payload.url }
          }
          return t
        })
      })

      if (event.payload.id === activeTabId) {
        setUrl(event.payload.url)
        setInputUrl(event.payload.url)
        addToHistory(event.payload.url)
      }
      
      // If it's the primary tab, save to DB
      if (event.payload.id === browserPaneId) {
        invoke('save_browser_pane_url', { id: browserPaneId, url: event.payload.url }).catch(() => {})
      }
    })

    const unlistenMetadata = listen<{ id: string; title: string; icon: string }>('browser-pane-metadata', (event) => {
      setTabs(currentTabs => {
        return currentTabs.map(t => {
          if (t.id === event.payload.id) {
            return { ...t, title: event.payload.title || t.title, icon: event.payload.icon || t.icon }
          }
          return t
        })
      })
    })


    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isActive) return
      const isDevToolsMac = e.metaKey && e.altKey && e.key.toLowerCase() === 'i'
      const isDevToolsWin = e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'i'
      if (isDevToolsMac || isDevToolsWin) {
        e.preventDefault()
        invoke('browser_open_devtools', { id: activeTabId }).catch(console.error)
      }
    }
    window.addEventListener('keydown', handleKeyDown)

    const unlistenDownloadReq = listen<{ id: string; url: string; path: string }>('browser-pane-download-requested', (event) => {
      const belongsToUs = tabsRef.current.some(t => t.id === event.payload.id)
      if (belongsToUs) {
        addToast(`Downloading to ${event.payload.path}...`, 'info')
      }
    })

    const unlistenDownloadFin = listen<{ id: string; url: string; path: string | null; success: boolean }>('browser-pane-download-finished', (event) => {
      const belongsToUs = tabsRef.current.some(t => t.id === event.payload.id)
      if (belongsToUs) {
        if (event.payload.success) {
          addToast(`Download complete: ${event.payload.path || 'Saved'}`, 'success')
        } else {
          addToast(`Download failed for ${event.payload.url}`, 'error')
        }
      }
    })

    const unlistenContextMenu = listen<{ id: string; url: string; mediaType?: string; x: number; y: number }>('browser-pane-context-menu', (event) => {
      const belongsToUs = tabsRef.current.some(t => t.id === event.payload.id)
      if (belongsToUs && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        const isVideo = event.payload.mediaType === 'video'
        showContextMenu(rect.left + event.payload.x, rect.top + HEADER_HEIGHT + event.payload.y, [
          {
            label: isVideo ? 'Open Video in New Tab' : 'Open Link in New Tab',
            onClick: () => handleAddTab(event.payload.url)
          },
          {
            label: isVideo ? 'Copy Video Address' : 'Copy Link Address',
            onClick: () => {
              writeText(event.payload.url)
              addToast(isVideo ? 'Video address copied' : 'Link copied to clipboard', 'success')
            }
          }
        ])
      }
    })
    
    return () => { 
      window.removeEventListener('keydown', handleKeyDown)
      unlisten.then(fn => fn()) 
      unlistenMetadata.then(fn => fn())
      unlistenDownloadReq.then(fn => fn())
      unlistenDownloadFin.then(fn => fn())
      unlistenContextMenu.then(fn => fn())
    }
  }, [activeTabId, browserPaneId]) // Removed tabs dependency to avoid redefining listeners constantly

  // tabId is used for tab-keyed store lookups; workspaceId is for Rust watcher IPC
  const editorPanes = useAppStore(s => s.editorPanesByTab[tabId] || EMPTY_ARRAY) as import('../../types').EditorPane[];
  const terminals = useAppStore(s => s.terminalsByTab[tabId] || EMPTY_ARRAY) as import('../../types').Terminal[];
  const targetPath = editorPanes.length > 0 ? editorPanes[0].rootPath : (terminals.length > 0 ? terminals[0].cwd : '');

  useEffect(() => {
    if (!autoReload || !targetPath) return;

    invoke('start_workspace_watcher', { workspaceId: workspaceId, path: targetPath }).catch(console.error);

    const unlisten = listen<{ workspace_id: string }>('workspace-file-changed', (event) => {
      if (event.payload.workspace_id === workspaceId) {
        invoke('browser_reload', { id: activeTabId }).catch(() => {});
      }
    });

    return () => {
      unlisten.then(f => f());
      // Only stop the watcher if no other browser pane in this workspace has autoReload enabled
      const { browserPanesByTab } = useAppStore.getState();
      const otherPanesWithAutoReload = browserPanesByTab[tabId]?.filter(p => p.id !== browserPaneId && p.autoReload) || [];
      if (otherPanesWithAutoReload.length === 0) {
        invoke('stop_workspace_watcher', { workspaceId: workspaceId }).catch(console.error);
      }
    };
  }, [autoReload, targetPath, workspaceId, tabId, browserPaneId, activeTabId]);

  const tabsRef = useRef(tabs)
  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

  // Attribute every open browser-tab to its owning workspace/pane so the
  // sidebar media widget (which only sees bare pane ids in its events) can
  // resolve them back to a workspace/title for display.
  useEffect(() => {
    const { registerPane } = useBrowserMediaStore.getState()
    tabs.forEach(tab => {
      registerPane({
        workspaceId,
        workspaceName,
        browserTabId: tab.id,
        pageUrl: tab.url,
        pageTitle: tab.title,
      })
    })
  }, [tabs, workspaceId, workspaceName])

  // Hide main pane and destroy all ephemeral webviews on unmount
  useEffect(() => {
    return () => {
      const mediaStore = useBrowserMediaStore.getState()
      tabsRef.current.forEach(tab => {
        mediaStore.removeSessionsForPane(tab.id)
        mediaStore.unregisterPane(tab.id)
        if (!tab.isDiscarded) {
          if (tab.id === browserPaneId) {
            invoke('hide_browser_pane', { id: tab.id }).catch(() => {})
          } else {
            invoke('destroy_ephemeral_browser_pane', { id: tab.id }).catch(() => {})
          }
        }
      })
    }
  }, [browserPaneId]) // Only runs on unmount

  const handleNavigate = (target: string) => {
    const isUrl = /^[a-zA-Z0-9\-\.]+\.[a-zA-Z]{2,6}(:[0-9]{1,5})?(\/.*)?$/.test(target) || target.startsWith('http://') || target.startsWith('https://') || target.startsWith('localhost:') || target.startsWith('127.0.0.1:')
    const isLocalhost = target.startsWith('localhost') || target.startsWith('127.0.0.1')
    const normalized = isUrl 
      ? (target.startsWith('http') ? target : (isLocalhost ? `http://${target}` : `https://${target}`)) 
      : `https://www.google.com/search?q=${encodeURIComponent(target)}`
    
    setUrl(normalized)
    setInputUrl(normalized)
    setIsEditingUrl(false)
    addToHistory(normalized)
    
    setTabs(currentTabs => currentTabs.map(t => t.id === activeTabId ? { ...t, url: normalized } : t))
    invoke('navigate_browser_pane', { id: activeTabId, url: normalized }).catch(() => {})
  }
  
  const handleAddTab = async (targetUrl: string = 'termspace://newtab') => {
    const newTabId = `ephemeral-tab-${Date.now()}`
    try {
      await invoke('spawn_ephemeral_browser_pane', {
        id: newTabId,
        url: targetUrl,
        x: -10000, y: -10000, w: 800, h: 600,
        adblockEnabled,
      })
      setTabs(currentTabs => [...currentTabs, { id: newTabId, url: targetUrl, title: 'New Tab' }])
      setActiveTabId(newTabId)
    } catch (err) {
      console.error('Failed to spawn ephemeral tab:', err)
      alert(`Failed to spawn tab: ${err}\n\nDid you completely restart the terminal backend (Ctrl+C and npm run tauri dev) after I added the new commands?`)
    }
  }

  const handleCloseTab = async (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation()
    if (tabs.length === 1) {
      // If it's the last tab, close the whole pane
      deleteSqliteUiState(browserPaneTabsStateKey(browserPaneId)).catch(() => {})
      onClose()
      return
    }
    
    const idx = tabs.findIndex(t => t.id === tabId)
    const newTabs = tabs.filter(t => t.id !== tabId)
    setTabs(newTabs)
    
    if (activeTabId === tabId) {
      // Activate the previous tab, or the next one if it was the first
      const newActiveIdx = Math.max(0, idx - 1)
      setActiveTabId(newTabs[newActiveIdx].id)
    }
    
    if (tabId === browserPaneId) {
      invoke('hide_browser_pane', { id: tabId }).catch(() => {})
    } else {
      invoke('destroy_ephemeral_browser_pane', { id: tabId }).catch(() => {})
    }

    const mediaStore = useBrowserMediaStore.getState()
    mediaStore.removeSessionsForPane(tabId)
    mediaStore.unregisterPane(tabId)
  }

  const borderColor = isActive ? 'var(--accent, #4a7aff)' : 'var(--border-inactive, #333)'

  return (
    <div
      ref={containerRef}
      style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', minWidth: 0, minHeight: 0, backgroundColor: viewportMode === 'desktop' ? 'transparent' : '#0a0a0c' }}
      onClick={() => {
        onFocus()
        if (showBookmarks) setShowBookmarks(false)
        if (showHistory) setShowHistory(false)
        // Mark this pane focused so its media is allowed to play (mirrors
        // clicking a browser tab). Clicks in the video hole also grant focus
        // directly via the injected gesture listener in the webview.
        invoke('browser_set_focused', { id: activeTabId }).catch(() => {})
      }}
    >
      {/* Tab Bar */}
      <div style={{
        height: 28, display: 'flex', background: '#111214', overflowX: 'auto',
        borderBottom: `1px solid ${borderColor}`, padding: '0 8px 0 8px', gap: 2, alignItems: 'flex-end',
        flexShrink: 0,
      }}>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            onClick={() => setActiveTabId(tab.id)}
            style={{
              height: 24, minWidth: 120, maxWidth: 200, padding: '0 8px',
              background: activeTabId === tab.id ? '#202124' : 'transparent',
              color: activeTabId === tab.id ? '#e8eaed' : '#9aa0a6',
              opacity: tab.isDiscarded ? 0.6 : 1,
              borderTopLeftRadius: 6, borderTopRightRadius: 6,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              cursor: 'pointer',
              borderLeft: activeTabId === tab.id ? `1px solid ${borderColor}` : 'none',
              borderRight: activeTabId === tab.id ? `1px solid ${borderColor}` : 'none',
              borderTop: activeTabId === tab.id ? `1px solid ${borderColor}` : 'none',
            }}
          >
            <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
              {tab.isDiscarded && <span style={{ opacity: 0.6 }}>💤</span>}
              {tab.icon && !tab.isDiscarded && <img src={tab.icon} alt="" style={{ width: 14, height: 14, borderRadius: 2 }} onError={(e) => e.currentTarget.style.display = 'none'} />}
              {tab.title && tab.title !== 'New Tab' ? tab.title : (tab.url.replace(/^https?:\/\//, '').replace(/^www\./, '') || 'New Tab')}
            </span>
            <div 
              onClick={(e) => handleCloseTab(e, tab.id)}
              style={{ padding: 2, borderRadius: 4, cursor: 'pointer', display: 'flex', opacity: 0.6 }}
              onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
              onMouseLeave={(e) => e.currentTarget.style.opacity = '0.6'}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </div>
          </div>
        ))}
        <div 
          onClick={() => handleAddTab()}
          style={{ 
            height: 20, width: 20, margin: '0 4px 2px 4px', display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: '#9aa0a6', borderRadius: 4
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = '#2a2b2f'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
        </div>
      </div>

      {/* Traditional Browser Header */}
      <div style={{
        height: 44, display: 'flex', alignItems: 'center', padding: '0 12px', gap: 8,
        background: '#202124', borderBottom: `1px solid ${borderColor}`,
        flexShrink: 0,
      }}>
        {/* Navigation Buttons */}
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={(e) => { e.stopPropagation(); invoke('browser_go_back', { id: activeTabId }) }} style={navBtnStyle} title="Back">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
          <button onClick={(e) => { e.stopPropagation(); invoke('browser_go_forward', { id: activeTabId }) }} style={navBtnStyle} title="Forward">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </button>
          <button onClick={(e) => { e.stopPropagation(); invoke('browser_reload', { id: activeTabId }) }} style={navBtnStyle} title="Reload">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
          </button>
        </div>

        {/* Address Bar */}
        <div style={{
          flex: 1, height: 28, background: '#171717', borderRadius: 14,
          display: 'flex', alignItems: 'center', padding: '0 16px', gap: 8,
          border: '1px solid #333', minWidth: 0, position: 'relative'
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9aa0a6" strokeWidth="2" style={{ flexShrink: 0 }}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
          {isEditingUrl ? (
            <>
              <input
                autoFocus
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (selectedIndex >= 0 && suggestions[selectedIndex]) {
                      handleNavigate(suggestions[selectedIndex])
                    } else {
                      handleNavigate(inputUrl)
                    }
                  }
                  if (e.key === 'Escape') { setIsEditingUrl(false); setInputUrl(url) }
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setSelectedIndex(s => Math.min(s + 1, suggestions.length - 1))
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setSelectedIndex(s => Math.max(s - 1, -1))
                  }
                }}
                onBlur={() => { 
                  // Short delay so click events on suggestions don't fire after unmount
                  setTimeout(() => { setIsEditingUrl(false); setInputUrl(url) }, 150) 
                }}
                style={{
                  flex: 1, background: 'transparent', border: 'none',
                  color: '#e8eaed', fontSize: 13, outline: 'none', minWidth: 0,
                }}
              />
              {suggestions.length > 0 && (
                <div style={{
                  position: 'absolute', top: 34, left: 0, right: 0,
                  background: '#202124', border: '1px solid #333',
                  borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                  zIndex: 1000, overflow: 'hidden', padding: '4px 0'
                }}>
                  {suggestions.map((suggestion, idx) => (
                    <div
                      key={idx}
                      onClick={() => handleNavigate(suggestion)}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      style={{
                        padding: '8px 16px', fontSize: 13, color: '#e8eaed',
                        background: idx === selectedIndex ? '#303134' : 'transparent',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9aa0a6" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
                      {suggestion}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div
              onClick={(e) => { e.stopPropagation(); setIsEditingUrl(true) }}
              style={{ flex: 1, cursor: 'text', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              <span style={{ fontSize: 13, color: '#e8eaed' }}>
                {url === 'termspace://newtab' ? '' : (url || 'termspace://newtab')}
              </span>
            </div>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation()
              updateSettings({ adblockEnabled: !adblockEnabled })
            }}
            style={{ ...navBtnStyle, width: 24, height: 24, color: adblockEnabled ? '#e8eaed' : '#9aa0a6' }}
            title={adblockEnabled ? "Disable Adblock" : "Enable Adblock"}
          >
            {adblockEnabled ? <ShieldCheck size={14} /> : <Shield size={14} />}
          </button>
          <button 
            onClick={(e) => {
              e.stopPropagation()
              const isBookmarked = bookmarks.some(b => b.url === activeTab.url)
              if (isBookmarked) removeBookmark(activeTab.url)
              else addBookmark(activeTab.url, activeTab.title || activeTab.url, activeTab.icon)
            }}
            style={{ ...navBtnStyle, width: 24, height: 24, color: bookmarks.some(b => b.url === activeTab.url) ? '#fbbc04' : '#9aa0a6' }}
            title="Bookmark this tab"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill={bookmarks.some(b => b.url === activeTab.url) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setAutoReload(!autoReload)
            }}
            style={{ ...navBtnStyle, width: 24, height: 24, color: autoReload ? '#4a7aff' : '#9aa0a6' }}
            title={autoReload ? "Disable Auto-Reload" : "Enable Auto-Reload"}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></svg>
          </button>
        </div>

        <div style={{ position: 'relative' }}>
          <button onClick={(e) => { e.stopPropagation(); setShowBookmarks(!showBookmarks); setShowHistory(false) }} style={{ ...navBtnStyle, color: showBookmarks ? '#e8eaed' : '#9aa0a6' }} title="Bookmarks">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          </button>
          {showBookmarks && (
            <div style={{
              position: 'absolute', top: 32, right: 0, width: 280, maxHeight: 400, overflowY: 'auto',
              background: '#202124', border: '1px solid #333', borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.5)', zIndex: 1000, padding: 8
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#9aa0a6', padding: '4px 8px 8px' }}>Bookmarks</div>
              {bookmarks.length === 0 ? (
                <div style={{ padding: 8, fontSize: 13, color: '#9aa0a6', textAlign: 'center' }}>No bookmarks yet</div>
              ) : (
                bookmarks.map((b, i) => (
                  <div key={i} onClick={() => { handleNavigate(b.url); setShowBookmarks(false) }} style={{
                    padding: '8px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer'
                  }} onMouseEnter={e => e.currentTarget.style.background = '#303134'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    {b.icon ? <img src={b.icon} alt="" style={{ width: 14, height: 14, borderRadius: 2 }} /> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9aa0a6" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>}
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <div style={{ fontSize: 13, color: '#e8eaed', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{b.title}</div>
                      <div style={{ fontSize: 11, color: '#9aa0a6', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{b.url}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        
        <div style={{ position: 'relative' }}>
          <button onClick={(e) => { e.stopPropagation(); setShowHistory(!showHistory); setShowBookmarks(false) }} style={{ ...navBtnStyle, color: showHistory ? '#e8eaed' : '#9aa0a6' }} title="History">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </button>
          {showHistory && (
            <div style={{
              position: 'absolute', top: 32, right: 0, width: 280, maxHeight: 400, overflowY: 'auto',
              background: '#202124', border: '1px solid #333', borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.5)', zIndex: 1000, padding: 8
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#9aa0a6', padding: '4px 8px 8px' }}>History</div>
              {browserHistory.length === 0 ? (
                <div style={{ padding: 8, fontSize: 13, color: '#9aa0a6', textAlign: 'center' }}>No history yet</div>
              ) : (
                browserHistory.map((h, i) => (
                  <div key={i} onClick={() => { handleNavigate(h); setShowHistory(false) }} style={{
                    padding: '8px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer'
                  }} onMouseEnter={e => e.currentTarget.style.background = '#303134'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9aa0a6" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <div style={{ fontSize: 13, color: '#e8eaed', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{h}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 4 }}>
          {/* Viewport Toggles */}
          <div style={{ display: 'flex', background: '#171717', borderRadius: 6, padding: 2, marginRight: 4 }}>
            <button onClick={(e) => { e.stopPropagation(); setViewportMode('desktop') }} style={{ ...navBtnStyle, width: 24, height: 24, background: viewportMode === 'desktop' ? '#333' : 'transparent', color: viewportMode === 'desktop' ? '#e8eaed' : '#9aa0a6' }} title="Desktop View">
              <Monitor size={14} />
            </button>
            <button onClick={(e) => { e.stopPropagation(); setViewportMode('tablet') }} style={{ ...navBtnStyle, width: 24, height: 24, background: viewportMode === 'tablet' ? '#333' : 'transparent', color: viewportMode === 'tablet' ? '#e8eaed' : '#9aa0a6' }} title="Tablet View">
              <Tablet size={14} />
            </button>
            <button onClick={(e) => { e.stopPropagation(); setViewportMode('mobile') }} style={{ ...navBtnStyle, width: 24, height: 24, background: viewportMode === 'mobile' ? '#333' : 'transparent', color: viewportMode === 'mobile' ? '#e8eaed' : '#9aa0a6' }} title="Mobile View">
              <Smartphone size={14} />
            </button>
          </div>

          <button onClick={(e) => { e.stopPropagation(); invoke('browser_open_devtools', { id: activeTabId }) }} style={navBtnStyle} title="Open DevTools (Cmd+Option+I)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 14.66V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5.34"></path><polygon points="18 2 22 6 12 16 8 16 8 12 18 2"></polygon></svg>
          </button>
          <div style={{ width: 1, height: 16, background: '#333', margin: 'auto 4px' }} />
          <button onClick={(e) => { e.stopPropagation(); onSplit('horizontal') }} style={navBtnStyle} title="Split right">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><path d="M12 3v18"/></svg>
          </button>
          <button onClick={(e) => { e.stopPropagation(); onSplit('vertical') }} style={navBtnStyle} title="Split down">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><path d="M3 12h18"/></svg>
          </button>
          <button onClick={(e) => { e.stopPropagation(); onToggleMaximize() }} style={navBtnStyle} title="Maximize">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3H5a2 2 0 00-2 2v3M21 8V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3M16 21h3a2 2 0 002-2v-3"/></svg>
          </button>
          <button onClick={(e) => { e.stopPropagation(); onClose() }} style={{ ...navBtnStyle, color: '#e06c75' }} title="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </div>

      {/* Transparent hole — native webview floats here, positioned via containerRef + HEADER_HEIGHT offset */}
      <div style={{ flex: 1, minHeight: 0, minWidth: 0, background: 'transparent', position: 'relative' }}>
        {activeTab?.url === 'termspace://newtab' && (
          <NewTabPage onNavigate={handleNavigate} />
        )}
      </div>
    </div>
  )
}

const navBtnStyle: React.CSSProperties = {
  width: 28, height: 28, background: 'transparent', border: 'none',
  borderRadius: 6, color: '#9aa0a6', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
}

function NewTabPage({ onNavigate }: { onNavigate: (url: string) => void }) {
  const [search, setSearch] = useState('')
  const shortcuts = [
    { name: 'YouTube', url: 'https://www.youtube.com/', icon: 'https://www.youtube.com/favicon.ico' },
    { name: 'GitHub', url: 'https://github.com/', icon: 'https://github.com/favicon.ico' },
    { name: 'ChatGPT', url: 'https://chatgpt.com/', icon: 'https://chatgpt.com/favicon.ico' },
    { name: 'X', url: 'https://x.com/', icon: 'https://x.com/favicon.ico' },
    { name: 'Reddit', url: 'https://www.reddit.com/', icon: 'https://www.redditstatic.com/shreddit/assets/favicon/192x192.png' },
    { name: 'Notion', url: 'https://www.notion.so/', icon: 'https://www.notion.so/images/favicon.ico' },
  ]
  
  return (
    <div style={{
      position: 'absolute', inset: 0, background: 'var(--bg-main, #1a1612)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '10vh',
      color: '#e8eaed', zIndex: 10
    }}>
      <div style={{ fontSize: 48, fontWeight: 700, marginBottom: 40, background: 'linear-gradient(45deg, #e8a045, #fbbc04)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
        Termspace
      </div>
      
      <form 
        onSubmit={e => { e.preventDefault(); if (search) onNavigate(search) }}
        style={{ width: '100%', maxWidth: 600, position: 'relative', marginBottom: 60 }}
      >
        <input 
          autoFocus
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search the web or enter a URL"
          style={{
            width: '100%', padding: '16px 24px', fontSize: 16,
            background: '#221e18', border: '1px solid #3d3528',
            borderRadius: 30, color: '#e8eaed', outline: 'none',
            boxShadow: '0 4px 20px rgba(0,0,0,0.2)'
          }}
        />
      </form>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24, maxWidth: 600 }}>
        {shortcuts.map(s => (
          <div 
            key={s.name}
            onClick={() => onNavigate(s.url)}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
              padding: 16, borderRadius: 12, cursor: 'pointer',
              transition: 'background 0.2s', width: 100
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#221e18'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <div style={{ 
              width: 48, height: 48, borderRadius: 24, background: '#2a2420',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <img src={s.icon} alt="" style={{ width: 24, height: 24, borderRadius: 4 }} onError={e => e.currentTarget.style.display = 'none'} />
            </div>
            <span style={{ fontSize: 13, color: '#9aa0a6' }}>{s.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
