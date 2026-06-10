import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { FileTree } from './FileTree'
import { useAppStore } from '../store/useAppStore'
import { fetchDirectoryTree } from '../utils/fs'

// Mock dependencies
vi.mock('../utils/fs', () => ({
  fetchDirectoryTree: vi.fn(),
  sortNodes: vi.fn((nodes) => [...nodes].sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1
    if (!a.isDirectory && b.isDirectory) return 1
    return a.name.localeCompare(b.name)
  }))
}))

vi.mock('../store/useAppStore', () => ({
  useAppStore: Object.assign(
    (selector: any) => selector(useAppStore.getState()),
    {
      getState: vi.fn(() => ({
        gitStatusByWorkspace: {},
        activeFileByWorkspace: {},
        settings: { iconTheme: 'colorful' }
      })),
      setState: vi.fn(),
      subscribe: vi.fn()
    }
  )
}))

describe('FileTree', () => {
  const workspaceId = 'ws-1'
  const rootPath = '/project'
  const mockRootNodes = [
    { name: 'src', path: '/project/src', isDirectory: true },
    { name: 'README.md', path: '/project/README.md', isDirectory: false },
    { name: 'package.json', path: '/project/package.json', isDirectory: false },
  ]
  const mockSrcNodes = [
    { name: 'index.ts', path: '/project/src/index.ts', isDirectory: false },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fetchDirectoryTree).mockImplementation(async (path) => {
      if (path === rootPath) return mockRootNodes
      if (path === '/project/src') return mockSrcNodes
      return []
    })
  })

  it('renders root directory name and nodes', async () => {
    render(<FileTree workspaceId={workspaceId} rootPath={rootPath} onFileSelect={() => {}} />)
    
    expect(screen.getByText('Scanning...')).toBeInTheDocument()
    
    await waitFor(() => {
      expect(screen.getByText('project')).toBeInTheDocument()
      expect(screen.getByText('src')).toBeInTheDocument()
      expect(screen.getByText('README.md')).toBeInTheDocument()
      expect(screen.getByText('package.json')).toBeInTheDocument()
    })
  })

  it('expands a directory on click', async () => {
    render(<FileTree workspaceId={workspaceId} rootPath={rootPath} onFileSelect={() => {}} />)
    
    await waitFor(() => screen.getByText('src'))
    fireEvent.click(screen.getByText('src'))
    
    await waitFor(() => {
      expect(screen.getByText('index.ts')).toBeInTheDocument()
    })
  })

  it('supports keyboard navigation - ArrowDown and ArrowUp', async () => {
    render(<FileTree workspaceId={workspaceId} rootPath={rootPath} onFileSelect={() => {}} />)
    
    await waitFor(() => screen.getByText('src'))
    
    const tree = screen.getByRole('tree')
    
    // Focus the tree first
    fireEvent.keyDown(tree, { key: 'ArrowDown' })
    
    // After first ArrowDown, 'src' should be focused
    const srcItem = screen.getByText('src').closest('[role="treeitem"]')
    expect(srcItem).toHaveAttribute('tabindex', '0')

    // ArrowDown again to 'README.md'
    fireEvent.keyDown(tree, { key: 'ArrowDown' })
    const readmeItem = screen.getByText('README.md').closest('[role="treeitem"]')
    expect(readmeItem).toHaveAttribute('tabindex', '0')
    expect(srcItem).toHaveAttribute('tabindex', '-1')

    // ArrowUp back to 'src'
    fireEvent.keyDown(tree, { key: 'ArrowUp' })
    expect(srcItem).toHaveAttribute('tabindex', '0')
  })

  it('supports keyboard navigation - ArrowRight to expand and ArrowLeft to collapse', async () => {
    render(<FileTree workspaceId={workspaceId} rootPath={rootPath} onFileSelect={() => {}} />)
    
    await waitFor(() => screen.getByText('src'))
    const tree = screen.getByRole('tree')

    // Select src
    fireEvent.keyDown(tree, { key: 'ArrowDown' })
    
    // Expand src
    fireEvent.keyDown(tree, { key: 'ArrowRight' })
    await waitFor(() => expect(screen.getByText('index.ts')).toBeInTheDocument())
    
    // Collapse src
    fireEvent.keyDown(tree, { key: 'ArrowLeft' })
    await waitFor(() => expect(screen.queryByText('index.ts')).not.toBeInTheDocument())
  })

  it('calls onFileSelect when Enter is pressed on a file', async () => {
    const onFileSelect = vi.fn()
    render(<FileTree workspaceId={workspaceId} rootPath={rootPath} onFileSelect={onFileSelect} />)
    
    await waitFor(() => screen.getByText('README.md'))
    const tree = screen.getByRole('tree')

    // Navigate to README.md (Down twice: first to src, then to README.md)
    fireEvent.keyDown(tree, { key: 'ArrowDown' })
    fireEvent.keyDown(tree, { key: 'ArrowDown' })
    
    fireEvent.keyDown(tree, { key: 'Enter' })
    
    expect(onFileSelect).toHaveBeenCalledWith('/project/README.md')
  })
})
