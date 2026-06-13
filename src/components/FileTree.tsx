import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { ChevronRight, ChevronDown, File, Folder, FileJson, FileText, FileCode, Image, FileType, FileTerminal, FileArchive, Settings, Server, Monitor, Book, Ship, Package, ScrollText, Database, Layout, FlaskConical, Code2, GitBranch, Workflow, Wrench, Boxes, AppWindow, Type, Palette } from 'lucide-react'
import { AnimatePresence } from 'framer-motion'
import { FileNode, fetchDirectoryTree } from '../utils/fs'
import { useAppStore } from '../store/useAppStore'
import { useFileTreeContextMenu } from '../hooks/useFileTreeContextMenu'
import { useFileTreeOperations } from '../hooks/useFileTreeOperations'
import { FileTreeContextMenu } from './FileTreeContextMenu'
import { FileTreeInlineInput } from './FileTreeInlineInput'
import { ConfirmModal } from './ConfirmModal/ConfirmModal'

interface FileTreeProps {
  workspaceId: string
  rootPath: string
  onFileSelect: (path: string) => void
}

interface FlatNode {
  path: string
  name: string
  depth: number
  isDirectory: boolean
  isOpen: boolean
  isLoading: boolean
  status?: string
}

type FlatItem =
  | { kind: 'node'; data: FlatNode; index: number }
  | { kind: 'inline-input'; depth: number; mode: 'create-file' | 'create-folder' | 'rename' | 'duplicate'; prefill: string; index: number }

const getStatusColor = (status?: string) => {
  switch (status) {
    case 'M': return '#FBC02D' // Modified - yellow
    case 'A': return '#4CAF50' // Added - green
    case 'D': return '#F44336' // Deleted - red
    case '??': return '#2196F3' // Untracked - blue
    default: return undefined
  }
}

const getIconForFile = (filename: string, iconTheme: 'plain' | 'colorful' | 'filled') => {
  const ext = filename.split('.').pop()?.toLowerCase()
  const name = filename.toLowerCase()

  const isFilled = iconTheme === 'filled'
  const isPlain = iconTheme === 'plain'

  const renderIcon = (Icon: React.FC<any>, color: string) => {
    const finalColor = isPlain ? "#90A4AE" : color
    return <Icon size={14} color={finalColor} fill={isFilled ? finalColor : "transparent"} />
  }

  if (name === 'package.json' || name === 'tsconfig.json') return renderIcon(FileJson, "#FBC02D")
  if (name.includes('config') || name.includes('settings')) return renderIcon(Settings, "#607D8B")
  if (name.startsWith('.')) return renderIcon(Settings, "#9E9E9E")

  switch (ext) {
    case 'ts':
    case 'tsx': return renderIcon(FileType, "#0288D1")
    case 'js':
    case 'jsx': return renderIcon(FileCode, "#FDD835")
    case 'html': return renderIcon(FileCode, "#E65100")
    case 'css': return renderIcon(FileCode, "#0277BD")
    case 'json': return renderIcon(FileJson, "#FBC02D")
    case 'md': return renderIcon(FileText, "#B0BEC5")
    case 'rs': return renderIcon(FileCode, "#FF5722")
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'svg':
    case 'ico': return renderIcon(Image, "#4DB6AC")
    case 'sh':
    case 'bash': return renderIcon(FileTerminal, "#4CAF50")
    case 'zip':
    case 'tar':
    case 'gz': return renderIcon(FileArchive, "#F44336")
    default: return renderIcon(File, "#90A4AE")
  }
}

const getIconForFolder = (dirname: string, isOpen: boolean, iconTheme: 'plain' | 'colorful' | 'filled') => {
  const name = dirname.toLowerCase()
  const isFilled = iconTheme === 'filled'

  if (iconTheme === 'plain') {
    return <Folder size={14} color="#90A4AE" fill={isOpen || isFilled ? "#90A4AE" : "transparent"} />
  }

  const renderIcon = (Icon: React.FC<any>, color: string) => (
    <Icon size={14} color={color} fill={isFilled ? color : "transparent"} />
  )

  if (name.includes('hook')) return renderIcon(Workflow, "#E91E63")
  if (name.includes('util') || name.includes('helper') || name.includes('shared')) return renderIcon(Wrench, "#795548")
  if (name.includes('store') || name.includes('context') || name.includes('state') || name.includes('provider')) return renderIcon(Boxes, "#673AB7")
  if (name.includes('page') || name.includes('route') || name.includes('screen')) return renderIcon(AppWindow, "#009688")
  if (name.includes('type') || name.includes('interface')) return renderIcon(Type, "#0288D1")
  if (name.includes('style') || name.includes('css') || name.includes('theme')) return renderIcon(Palette, "#E91E63")
  if (name.includes('backend') || name.includes('services') || name.includes('api') || name.includes('server')) return renderIcon(Server, "#4CAF50")
  if (name.includes('frontend') || name.includes('client') || name.includes('web') || name.includes('app')) return renderIcon(Monitor, "#2196F3")
  if (name.includes('docs') || name.includes('documentation')) return renderIcon(Book, "#9E9E9E")
  if (name.includes('k8s') || name.includes('kubernetes') || name.includes('docker')) return renderIcon(Ship, "#326CE5")
  if (name.includes('vendor') || name.includes('node_modules')) return renderIcon(Package, "#8D6E63")
  if (name.includes('log')) return renderIcon(ScrollText, "#607D8B")
  if (name.includes('model') || name.includes('db') || name.includes('database')) return renderIcon(Database, "#FF9800")
  if (name.includes('component') || name.includes('ui') || name.includes('view')) return renderIcon(Layout, "#9C27B0")
  if (name.includes('assets') || name.includes('public') || name.includes('image') || name.includes('static')) return renderIcon(Image, "#00BCD4")
  if (name.includes('test') || name.includes('spec')) return renderIcon(FlaskConical, "#F44336")
  if (name === 'src' || name === 'lib' || name === 'source') return renderIcon(Code2, "#FFC107")
  if (name.includes('git')) return renderIcon(GitBranch, "#F4511E")
  if (name.includes('exchange')) return <Folder size={14} color="#E91E63" fill={isOpen || isFilled ? "#E91E63" : "transparent"} />

  return <Folder size={14} color="#90A4AE" fill={isOpen || isFilled ? "#90A4AE" : "transparent"} />
}

const flattenNodes = (
  nodes: FileNode[],
  depth: number,
  expandedPaths: Set<string>,
  loadedChildren: Record<string, FileNode[]>,
  loadingPaths: Set<string>,
  gitStatus: Record<string, string> | undefined,
  rootPath: string
): FlatNode[] => {
  let result: FlatNode[] = []
  for (const node of nodes) {
    const isOpen = expandedPaths.has(node.path)
    const isLoading = loadingPaths.has(node.path)
    const relativePath = node.path.replace(rootPath + '/', '')
    
    result.push({
      path: node.path,
      name: node.name,
      depth,
      isDirectory: node.isDirectory,
      isOpen,
      isLoading,
      status: gitStatus ? gitStatus[relativePath] : undefined
    })

    if (node.isDirectory && isOpen && loadedChildren[node.path]) {
      result = result.concat(
        flattenNodes(
          loadedChildren[node.path],
          depth + 1,
          expandedPaths,
          loadedChildren,
          loadingPaths,
          gitStatus,
          rootPath
        )
      )
    }
  }
  return result
}

const ITEM_HEIGHT = 28 // Approximate height of each row

const TreeNode = React.memo<{
  node: FlatNode
  isFocused: boolean
  isSelected: boolean
  isDragOver: boolean
  iconTheme: 'plain' | 'colorful' | 'filled'
  onToggle: (node: FlatNode) => void
  onFocus: (node: FlatNode) => void
  onContextMenu: (e: React.MouseEvent, node: FlatNode) => void
  onDragStart: (e: React.DragEvent, node: FlatNode) => void
  onDragOver: (e: React.DragEvent, node: FlatNode) => void
  onDragLeave: (e: React.DragEvent, node: FlatNode) => void
  onDrop: (e: React.DragEvent, node: FlatNode) => void
  style?: React.CSSProperties
}>(({ node, isFocused, isSelected, isDragOver, iconTheme, onToggle, onFocus, onContextMenu, onDragStart, onDragOver, onDragLeave, onDrop, style }) => {
  const [isHovered, setIsHovered] = React.useState(false)
  const statusColor = getStatusColor(node.status)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isFocused && ref.current && typeof ref.current.scrollIntoView === 'function') {
      ref.current.scrollIntoView({ block: 'nearest' })
    }
  }, [isFocused])

  return (
    <div 
      ref={ref}
      role="treeitem"
      aria-expanded={node.isDirectory ? node.isOpen : undefined}
      aria-selected={isSelected}
      tabIndex={isFocused ? 0 : -1}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => {
        onFocus(node)
        onToggle(node)
      }}
      onContextMenu={(e) => onContextMenu(e, node)}
      draggable={true}
      onDragStart={(e) => onDragStart(e, node)}
      onDragOver={(e) => onDragOver(e, node)}
      onDragLeave={(e) => onDragLeave(e, node)}
      onDrop={(e) => onDrop(e, node)}
      style={{
        display: 'flex',
        alignItems: 'center',
        paddingRight: '8px',
        paddingLeft: `${node.depth * 14 + 12}px`,
        cursor: 'pointer',
        backgroundColor: isDragOver ? 'var(--bg-item-active)' : (isFocused || isHovered ? 'var(--bg-item-active)' : 'transparent'),
        boxShadow: isDragOver ? 'inset 0 0 0 1px var(--accent)' : 'none',
        transition: 'background-color 0.1s ease',
        userSelect: 'none',
        position: 'absolute',
        left: 0,
        right: 0,
        height: ITEM_HEIGHT,
        outline: 'none',
        ...style
      }}
    >
      <div 
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: '2px',
          backgroundColor: isSelected ? 'var(--accent)' : 'var(--border-active)',
          transition: 'opacity 0.1s ease',
          opacity: isSelected || isFocused || isHovered ? 1 : 0
        }} 
      />
      
      <span 
        style={{ 
          marginRight: '6px', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          width: 16,
          color: isHovered ? 'var(--text-active)' : 'var(--text-inactive)',
          transition: 'color 0.15s ease'
        }}
      >
        {node.isDirectory ? (
          node.isLoading ? (
            <div 
              style={{ 
                width: '10px', 
                height: '10px', 
                borderRadius: '50%', 
                border: '1px solid var(--text-dim)', 
                borderTopColor: 'transparent', 
                animation: 'spin 1s linear infinite'
              }} 
            />
          ) : (
            node.isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />
          )
        ) : (
           getIconForFile(node.name, iconTheme)
        )}
      </span>
      
      {node.isDirectory && (
        <span style={{ marginRight: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#90A4AE' }}>
          {getIconForFolder(node.name, node.isOpen, iconTheme)}
        </span>
      )}

      <span 
        style={{ 
          fontSize: '13px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          letterSpacing: '0.025em',
          fontFamily: 'Inter, system-ui, sans-serif',
          color: statusColor || (node.isDirectory ? 'var(--text-active)' : (isHovered ? 'var(--text-active)' : 'var(--text-inactive)')),
          transition: 'color 0.15s ease'
        }}
      >
        {node.name}
      </span>
      
      {node.status && (
        <span style={{ 
          marginLeft: 'auto', 
          fontSize: '10px', 
          fontWeight: 'bold', 
          color: statusColor,
          opacity: 0.8
        }}>
          {node.status === '??' ? 'U' : node.status}
        </span>
      )}
    </div>
  )
})

export const FileTree: React.FC<FileTreeProps> = ({ workspaceId, rootPath, onFileSelect }) => {
  const [rootNodes, setRootNodes] = useState<FileNode[]>([])
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [loadedChildren, setLoadedChildren] = useState<Record<string, FileNode[]>>({})
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set())
  const [isLoadingRoot, setIsLoadingRoot] = useState(true)
  const [focusedPath, setFocusedPath] = useState<string | null>(null)
  const [dragOverPath, setDragOverPath] = useState<string | null>(null)
  
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const gitStatus = useAppStore(s => s.gitStatusByWorkspace[workspaceId])
  const activeFile = useAppStore(s => s.activeFileByWorkspace[workspaceId])
  const iconTheme = useAppStore(s => s.settings.iconTheme || 'colorful')

  const { menu, openMenu, closeMenu } = useFileTreeContextMenu()

  const handleRefreshDir = useCallback(async (dirPath: string) => {
    const children = await fetchDirectoryTree(dirPath)
    setLoadedChildren(prev => ({ ...prev, [dirPath]: children }))
    if (dirPath === rootPath) {
      setRootNodes(children)
    }
  }, [rootPath])

  const {
    inlineInput,
    pendingDelete,
    error,
    openCreateFile,
    openCreateFolder,
    openRename,
    openDuplicate,
    closeInlineInput,
    commitInlineInput,
    requestDelete,
    cancelDelete,
    confirmDelete,
    copyPath,
    openInTerminal,
    clearError,
  } = useFileTreeOperations({ workspaceId, onRefreshDir: handleRefreshDir })

  useEffect(() => {
    if (activeFile && !focusedPath) {
      setFocusedPath(activeFile)
    }
  }, [activeFile])

  useEffect(() => {
    const loadRoot = async () => {
      setIsLoadingRoot(true)
      const nodes = await fetchDirectoryTree(rootPath)
      setRootNodes(nodes)
      setIsLoadingRoot(false)
    }
    loadRoot()
  }, [rootPath])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleScroll = () => {
      setScrollTop(container.scrollTop)
    }

    const resizeObserver = new ResizeObserver(() => {
      if (containerRef.current) {
        setContainerHeight(containerRef.current.offsetHeight)
      }
    })

    container.addEventListener('scroll', handleScroll, { passive: true })
    resizeObserver.observe(container)
    
    // Initial height
    setContainerHeight(container.offsetHeight)

    return () => {
      container.removeEventListener('scroll', handleScroll)
      resizeObserver.disconnect()
    }
  }, [])

  const handleToggle = useCallback(async (node: FlatNode) => {
    if (!node.isDirectory) {
      onFileSelect(node.path)
      setFocusedPath(node.path)
      return
    }

    if (!node.isOpen) {
      // Expanding
      setExpandedPaths(prev => new Set(prev).add(node.path))
      
      if (!loadedChildren[node.path]) {
        setLoadingPaths(prev => new Set(prev).add(node.path))
        try {
          const children = await fetchDirectoryTree(node.path)
          setLoadedChildren(prev => ({ ...prev, [node.path]: children }))
        } finally {
          setLoadingPaths(prev => {
            const next = new Set(prev)
            next.delete(node.path)
            return next
          })
        }
      }
    } else {
      // Collapsing
      setExpandedPaths(prev => {
        const next = new Set(prev)
        next.delete(node.path)
        return next
      })
    }
  }, [loadedChildren, onFileSelect])

  const flatNodes = useMemo(() => {
    return flattenNodes(
      rootNodes,
      0,
      expandedPaths,
      loadedChildren,
      loadingPaths,
      gitStatus,
      rootPath
    )
  }, [rootNodes, expandedPaths, loadedChildren, loadingPaths, gitStatus, rootPath])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (flatNodes.length === 0) return

    const currentIndex = flatNodes.findIndex(n => n.path === focusedPath)
    const currentNode = currentIndex >= 0 ? flatNodes[currentIndex] : null

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        const nextIndex = Math.min(flatNodes.length - 1, currentIndex + 1)
        setFocusedPath(flatNodes[nextIndex].path)
        break
      case 'ArrowUp':
        e.preventDefault()
        const prevIndex = Math.max(0, currentIndex - 1)
        setFocusedPath(flatNodes[prevIndex].path)
        break
      case 'ArrowRight':
        e.preventDefault()
        if (currentNode?.isDirectory) {
          if (!currentNode.isOpen) {
            handleToggle(currentNode)
          } else if (currentIndex + 1 < flatNodes.length) {
            setFocusedPath(flatNodes[currentIndex + 1].path)
          }
        }
        break
      case 'ArrowLeft':
        e.preventDefault()
        if (currentNode?.isDirectory && currentNode.isOpen) {
          handleToggle(currentNode)
        } else if (currentIndex >= 0) {
          // Move to parent
          const parentDepth = currentNode ? currentNode.depth - 1 : -1
          if (parentDepth >= 0) {
            for (let i = currentIndex - 1; i >= 0; i--) {
              if (flatNodes[i].depth === parentDepth) {
                setFocusedPath(flatNodes[i].path)
                break
              }
            }
          }
        }
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (currentNode) {
          handleToggle(currentNode)
        }
        break
    }
  }, [flatNodes, focusedPath, handleToggle])

  const handleDragStart = useCallback((e: React.DragEvent, node: FlatNode) => {
    e.dataTransfer.setData('application/termspace-file-path', node.path)
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, node: FlatNode) => {
    if (node.isDirectory) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (dragOverPath !== node.path) {
        setDragOverPath(node.path)
      }
    }
  }, [dragOverPath])

  const handleDragLeave = useCallback((_e: React.DragEvent, node: FlatNode) => {
    if (dragOverPath === node.path) {
      setDragOverPath(null)
    }
  }, [dragOverPath])

  const handleDrop = useCallback(async (e: React.DragEvent, node: FlatNode) => {
    e.preventDefault()
    setDragOverPath(null)
    
    if (!node.isDirectory) return
    
    const sourcePath = e.dataTransfer.getData('application/termspace-file-path')
    if (!sourcePath || sourcePath === node.path || node.path.startsWith(sourcePath + '/')) return

    const sourceName = sourcePath.split('/').pop()
    if (!sourceName) return

    try {
      const { rename } = await import('@tauri-apps/plugin-fs')
      await rename(sourcePath, `${node.path}/${sourceName}`)
      
      const sourceParent = sourcePath.split('/').slice(0, -1).join('/')
      handleRefreshDir(sourceParent)
      handleRefreshDir(node.path)
    } catch (err) {
      console.error('Drop rename failed:', err)
    }
  }, [handleRefreshDir])

  const BUFFER = 10

  const flatItems = useMemo((): FlatItem[] => {
    const base: FlatItem[] = flatNodes.map((node, i) => ({ kind: 'node', data: node, index: i }))
    if (!inlineInput) return base

    if (inlineInput.mode === 'rename' && inlineInput.node) {
      const renameNode = inlineInput.node
      return base.map(item =>
        item.kind === 'node' && item.data.path === renameNode.path
          ? { kind: 'inline-input' as const, depth: item.data.depth, mode: inlineInput.mode, prefill: item.data.name, index: item.index }
          : item
      )
    }

    const isDuplicate = inlineInput.mode === 'duplicate'
    const prefillStr = isDuplicate && inlineInput.node ? `${inlineInput.node.name} - copy` : ''

    // create-file or create-folder or duplicate: insert one row after the parent directory
    const parentIdx = base.findIndex(
      item => item.kind === 'node' && item.data.path === inlineInput.parentPath
    )
    const insertAt = parentIdx >= 0 ? parentIdx + 1 : base.length
    const parentDepth = parentIdx >= 0 && base[parentIdx].kind === 'node'
      ? (base[parentIdx] as { kind: 'node'; data: FlatNode; index: number }).data.depth
      : -1
    const sentinel: FlatItem = {
      kind: 'inline-input',
      depth: parentDepth + 1,
      mode: inlineInput.mode,
      prefill: prefillStr,
      index: insertAt,
    }
    return [
      ...base.slice(0, insertAt),
      { ...sentinel, index: insertAt },
      ...base.slice(insertAt).map((item, i) => ({ ...item, index: insertAt + 1 + i })),
    ]
  }, [flatNodes, inlineInput])

  const visibleItems = useMemo(() => {
    const total = flatItems.length
    const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER)
    const endIndex = Math.min(total, Math.ceil((scrollTop + containerHeight) / ITEM_HEIGHT) + BUFFER)
    return flatItems.slice(startIndex, endIndex)
  }, [flatItems, scrollTop, containerHeight])

  const folderName = rootPath.split('/').pop() || 'Workspace'

  return (
    <div 
      style={{
        position: 'absolute',
        inset: 0,
        backgroundColor: 'var(--bg-sidebar)',
        borderRight: '1px solid var(--border-inactive)',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <div 
        style={{
          paddingLeft: '16px',
          paddingRight: '16px',
          paddingTop: '12px',
          paddingBottom: '12px',
          backgroundColor: 'var(--bg-sidebar)',
          zIndex: 10,
          borderBottom: '1px solid var(--border-inactive)'
        }}
      >
        <div 
          style={{
            fontSize: '10px',
            fontWeight: 'bold',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            color: 'var(--text-dim)',
            marginBottom: '4px'
          }}
        >
          Explorer
        </div>
        <div 
          style={{
            fontSize: '13px',
            fontWeight: 600,
            color: 'var(--text-active)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            display: 'flex',
            alignItems: 'center'
          }}
        >
          <Folder size={14} style={{ marginRight: '6px', color: 'var(--accent)' }} /> {folderName}
        </div>
      </div>
      
      <div 
        ref={containerRef}
        role="tree"
        aria-label="File Explorer"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        style={{ 
          flex: 1, 
          minHeight: 0,
          overflowY: 'auto', 
          position: 'relative',
          outline: 'none'
        }}
      >
        {isLoadingRoot ? (
          <div 
            style={{ 
              paddingLeft: '16px', 
              paddingRight: '16px', 
              paddingTop: '8px', 
              paddingBottom: '8px', 
              fontSize: '12px', 
              color: 'var(--text-dim)', 
              display: 'flex', 
              alignItems: 'center' 
            }}
          >
            <div 
              style={{ 
                width: '12px', 
                height: '12px', 
                borderRadius: '50%', 
                border: '2px solid var(--text-dim)', 
                borderTopColor: 'var(--accent)', 
                marginRight: '8px',
                animation: 'spin 1s linear infinite'
              }} 
            /> Scanning...
          </div>
        ) : rootNodes.length === 0 ? (
          <div style={{ paddingLeft: '16px', paddingRight: '16px', paddingTop: '8px', paddingBottom: '8px', fontSize: '12px', color: 'var(--text-dim)' }}>
            Folder is empty
          </div>
        ) : (
          <div style={{ height: flatItems.length * ITEM_HEIGHT, position: 'relative' }}>
            {visibleItems.map((item) => {
              if (item.kind === 'inline-input') {
                return (
                  <FileTreeInlineInput
                    key="inline-input"
                    mode={item.mode}
                    prefill={item.prefill}
                    depth={item.depth}
                    index={item.index}
                    onCommit={commitInlineInput}
                    onCancel={closeInlineInput}
                  />
                )
              }
              return (
                <TreeNode
                  key={item.data.path}
                  node={item.data}
                  isFocused={focusedPath === item.data.path}
                  isSelected={activeFile === item.data.path}
                  isDragOver={dragOverPath === item.data.path}
                  iconTheme={iconTheme}
                  onToggle={handleToggle}
                  onFocus={(n) => setFocusedPath(n.path)}
                  onContextMenu={openMenu}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  style={{ top: item.index * ITEM_HEIGHT }}
                />
              )
            })}
          </div>
        )}
      </div>

      {menu && (() => {
        const m = menu
        return (
          <FileTreeContextMenu
            menu={m}
            onClose={closeMenu}
            onNewFile={() => { openCreateFile(m.node.path); closeMenu() }}
            onNewFolder={() => { openCreateFolder(m.node.path); closeMenu() }}
            onRename={() => { openRename(m.node); closeMenu() }}
            onDuplicate={() => { openDuplicate(m.node); closeMenu() }}
            onDelete={() => { requestDelete(m.node); closeMenu() }}
            onCopyPath={() => { copyPath(m.node.path); closeMenu() }}
            onOpenInTerminal={() => { openInTerminal(m.node.path); closeMenu() }}
          />
        )
      })()}

      <AnimatePresence>
        {pendingDelete && (
          <ConfirmModal
            title={`Delete ${pendingDelete.isDirectory ? 'folder' : 'file'}`}
            message={`Are you sure you want to delete "${pendingDelete.name}"? This cannot be undone.`}
            confirmText="Delete"
            isDestructive
            onConfirm={confirmDelete}
            onCancel={cancelDelete}
          />
        )}
      </AnimatePresence>

      {error && (
        <div style={{
          position: 'absolute',
          bottom: 8,
          left: 8,
          right: 8,
          background: 'rgba(224, 123, 123, 0.15)',
          border: '1px solid #e07b7b',
          borderRadius: 4,
          padding: '6px 10px',
          fontSize: 12,
          color: '#e07b7b',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          zIndex: 10,
        }}>
          <span>{error}</span>
          <button
            onClick={clearError}
            style={{ background: 'none', border: 'none', color: '#e07b7b', cursor: 'pointer', fontSize: 14, padding: 0 }}
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}

