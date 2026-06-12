import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FileTreeContextMenu } from './FileTreeContextMenu'

const dirMenu = {
  x: 100,
  y: 200,
  node: { path: '/project/src', name: 'src', isDirectory: true, depth: 1 },
}
const fileMenu = {
  x: 100,
  y: 200,
  node: { path: '/project/index.ts', name: 'index.ts', isDirectory: false, depth: 0 },
}

const defaultProps = {
  menu: dirMenu,
  onClose: vi.fn(),
  onNewFile: vi.fn(),
  onNewFolder: vi.fn(),
  onRename: vi.fn(),
  onDelete: vi.fn(),
  onCopyPath: vi.fn(),
  onOpenInTerminal: vi.fn(),
}

describe('FileTreeContextMenu', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows folder-specific items for directories', () => {
    render(<FileTreeContextMenu {...defaultProps} />)
    expect(screen.getByText('New File')).toBeInTheDocument()
    expect(screen.getByText('New Folder')).toBeInTheDocument()
    expect(screen.getByText('Open in Terminal')).toBeInTheDocument()
  })

  it('hides New File, New Folder, Open in Terminal for files', () => {
    render(<FileTreeContextMenu {...defaultProps} menu={fileMenu} />)
    expect(screen.queryByText('New File')).not.toBeInTheDocument()
    expect(screen.queryByText('New Folder')).not.toBeInTheDocument()
    expect(screen.queryByText('Open in Terminal')).not.toBeInTheDocument()
  })

  it('shows Rename, Copy Path, Delete for files', () => {
    render(<FileTreeContextMenu {...defaultProps} menu={fileMenu} />)
    expect(screen.getByText('Rename')).toBeInTheDocument()
    expect(screen.getByText('Copy Path')).toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
  })

  it('calls onNewFile when New File clicked', () => {
    const onNewFile = vi.fn()
    render(<FileTreeContextMenu {...defaultProps} onNewFile={onNewFile} />)
    fireEvent.click(screen.getByText('New File'))
    expect(onNewFile).toHaveBeenCalledTimes(1)
  })

  it('calls onDelete when Delete clicked', () => {
    const onDelete = vi.fn()
    render(<FileTreeContextMenu {...defaultProps} onDelete={onDelete} />)
    fireEvent.click(screen.getByText('Delete'))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('calls onClose on Escape keydown', () => {
    const onClose = vi.fn()
    render(<FileTreeContextMenu {...defaultProps} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose on outside mousedown', () => {
    const onClose = vi.fn()
    render(<FileTreeContextMenu {...defaultProps} onClose={onClose} />)
    fireEvent.mouseDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('is positioned at menu coordinates', () => {
    const { container } = render(<FileTreeContextMenu {...defaultProps} />)
    const el = container.firstChild as HTMLElement
    expect(el.style.top).toBe('200px')
    expect(el.style.left).toBe('100px')
  })
})
