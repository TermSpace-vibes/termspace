import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor, fireEvent } from '@testing-library/react'
import { NativeTerminalPane } from './NativeTerminalPane'
import { readText } from '@tauri-apps/plugin-clipboard-manager'
import { invoke } from '../../utils/tauri'

const tauriMock = vi.hoisted(() => ({
  listeners: {} as Record<string, (event: any) => void>,
}))

// Mock Tauri invoke and listen
vi.mock('../../utils/tauri', () => ({
  invoke: vi.fn().mockImplementation((cmd) => {
    if (cmd === 'process_pasted_image') return Promise.resolve(null)
    if (cmd === 'get_terminal_text') return Promise.resolve('mock text')
    return Promise.resolve([])
  }),
  listen: vi.fn().mockImplementation((event: string, callback: (event: any) => void) => {
    tauriMock.listeners[event] = callback
    return Promise.resolve(() => {
      delete tauriMock.listeners[event]
    })
  }),
}))

// Mock clipboard manager
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: vi.fn().mockResolvedValue(undefined),
  readText: vi.fn().mockResolvedValue('test pasted text'),
}))

// Mock Zustand store
vi.mock('../../store/useAppStore', () => ({
  useAppStore: Object.assign(
    vi.fn((selector) => {
      return selector({
        settings: { fontSize: 14, fontFamily: 'monospace' },
        terminalsByTab: { 'ws-1': [{ id: 't-1' }] },
        setTerminalNotification: vi.fn(),
        renameTerminal: vi.fn(),
        setDraggedTerminalId: vi.fn(),
      })
    }),
    {
      getState: () => ({
        settings: { smoothCaret: false },
        addToast: vi.fn(),
        terminalsByTab: { 'ws-1': [{ id: 't-1', notificationCount: 0 }] },
      })
    }
  )
}))

// Mock keybindings handler
vi.mock('../../hooks/useGlobalKeybindings', () => ({
  useKeybindingHandler: () => vi.fn().mockReturnValue(false)
}))

describe('NativeTerminalPane copy/paste', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(), // deprecated
        removeListener: vi.fn(), // deprecated
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })

    // Mock ResizeObserver
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as any

    global.Worker = class {
      postMessage() {}
      addEventListener() {}
      removeEventListener() {}
      terminate() {}
    } as any

    // Mock Canvas context to avoid render errors
    global.OffscreenCanvas = class {
      constructor(width: number, height: number) {}
      getContext() {
        return {
          measureText: () => ({ width: 8 }),
          fillRect: vi.fn(),
          fillText: vi.fn(),
        }
      }
    } as any

    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      measureText: () => ({ width: 8 }),
      fillRect: vi.fn(),
      fillText: vi.fn(),
    }) as any

    HTMLCanvasElement.prototype.transferControlToOffscreen = vi.fn().mockReturnValue(new global.OffscreenCanvas(8, 8)) as any
  })

  it('handles paste by reading the native clipboard and writing to terminal', async () => {
    vi.mocked(readText).mockResolvedValueOnce('pasted text')
    const { container } = render(
      <NativeTerminalPane
        terminalId="t-1"
        workspaceId="ws-1"
        isActive={true}
        isMaximized={false}
        onFocus={vi.fn()}
        onToggleMaximize={vi.fn()}
        onClose={vi.fn()}
        onSplit={vi.fn()}
      />
    )

    const canvas = container.querySelector('canvas')!
    
    // Native paste event provides clipboardData synchronously
    const pasteEvent = new Event('paste', { bubbles: true }) as any
    pasteEvent.clipboardData = {
      getData: vi.fn().mockReturnValue('pasted text')
    }
    
    fireEvent(canvas, pasteEvent)

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('write_terminal', {
        terminalId: 't-1',
        data: '\x1b[200~pasted text\x1b[201~'
      })
    })
  })

  it('pastes clipboard text into terminal on Cmd+V keydown', async () => {
    const { container } = render(
      <NativeTerminalPane
        terminalId="t-1"
        workspaceId="ws-1"
        isActive={true}
        isMaximized={false}
        onFocus={vi.fn()}
        onToggleMaximize={vi.fn()}
        onClose={vi.fn()}
        onSplit={vi.fn()}
      />
    )

    const canvas = container.querySelector('canvas')!
    fireEvent.keyDown(canvas, { key: 'v', metaKey: true })

    await waitFor(() => {
      expect(readText).toHaveBeenCalled()
      expect(invoke).toHaveBeenCalledWith('write_terminal', {
        terminalId: 't-1',
        data: '\x1b[200~test pasted text\x1b[201~'
      })
    })
  })

  it('does not write anything to the PTY on Cmd+C keydown', async () => {
    const { container } = render(
      <NativeTerminalPane
        terminalId="t-1"
        workspaceId="ws-1"
        isActive={true}
        isMaximized={false}
        onFocus={vi.fn()}
        onToggleMaximize={vi.fn()}
        onClose={vi.fn()}
        onSplit={vi.fn()}
      />
    )

    const canvas = container.querySelector('canvas')!
    fireEvent.keyDown(canvas, { key: 'c', metaKey: true })

    // flush microtask input batch
    await new Promise(r => setTimeout(r, 10))

    expect(invoke).not.toHaveBeenCalledWith('write_terminal', expect.anything())
  })

  it('reports active and inactive focus state to the detector', async () => {
    const props = {
      terminalId: 't-1',
      workspaceId: 'ws-1',
      isMaximized: false,
      onFocus: vi.fn(),
      onToggleMaximize: vi.fn(),
      onClose: vi.fn(),
      onSplit: vi.fn(),
    }
    const { rerender } = render(<NativeTerminalPane {...props} isActive />)
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('set_agent_target_focus', {
        targetId: 't-1',
        focused: true,
      })
    })

    rerender(<NativeTerminalPane {...props} isActive={false} />)
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('set_agent_target_focus', {
        targetId: 't-1',
        focused: false,
      })
    })
  })
})

describe('NativeTerminalPane selection drag', () => {
  let postedMessages: any[]
  let createdWorker: any

  beforeEach(() => {
    vi.clearAllMocks()
    postedMessages = []
    createdWorker = null
    tauriMock.listeners = {}

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(query => ({
        matches: false, media: query, onchange: null,
        addListener: vi.fn(), removeListener: vi.fn(),
        addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
      })),
    })
    global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as any
    const posted = postedMessages
    global.Worker = class {
      onmessage: ((event: MessageEvent) => void) | null = null
      constructor() {
        createdWorker = this
      }
      postMessage(msg: any) { posted.push(msg) }
      addEventListener() {}
      removeEventListener() {}
      terminate() {}
    } as any
    global.OffscreenCanvas = class {
      constructor() {}
      getContext() { return { measureText: () => ({ width: 8 }), fillRect: vi.fn(), fillText: vi.fn() } }
    } as any
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      measureText: () => ({ width: 8 }), fillRect: vi.fn(), fillText: vi.fn(),
    }) as any
    HTMLCanvasElement.prototype.transferControlToOffscreen = vi.fn().mockReturnValue(new global.OffscreenCanvas()) as any
    HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
      left: 0, top: 0, right: 800, bottom: 400, width: 800, height: 400, x: 0, y: 0, toJSON: () => ({}),
    }) as any
  })

  it('keeps extending the selection while dragging within the top edge zone', () => {
    const { container } = render(
      <NativeTerminalPane
        terminalId="t-1"
        workspaceId="ws-1"
        isActive={true}
        isMaximized={false}
        onFocus={vi.fn()}
        onToggleMaximize={vi.fn()}
        onClose={vi.fn()}
        onSplit={vi.fn()}
      />
    )

    const canvas = container.querySelector('canvas')!
    // cellW is 8px (mocked measureText). Drag along y=10 — inside the canvas
    // but within the old 30px inner edge-scroll band that froze selection.
    fireEvent.mouseDown(canvas, { button: 0, clientX: 4, clientY: 10 })
    fireEvent.mouseMove(window, { clientX: 100, clientY: 10 })
    fireEvent.mouseMove(window, { clientX: 200, clientY: 10 })

    const selections = postedMessages.filter(m => m.type === 'selection' && m.selection)
    expect(selections.length).toBeGreaterThan(0)
    const last = selections[selections.length - 1].selection
    // 200px / 8px per cell = col 25
    expect(Math.max(last.startCol, last.endCol)).toBe(25)
  })

  it('moves an existing selection when worker metadata reports scroll offset changes', () => {
    const { container } = render(
      <NativeTerminalPane
        terminalId="t-1"
        workspaceId="ws-1"
        isActive={true}
        isMaximized={false}
        onFocus={vi.fn()}
        onToggleMaximize={vi.fn()}
        onClose={vi.fn()}
        onSplit={vi.fn()}
      />
    )

    createdWorker.onmessage?.({ data: { type: 'ready' } } as MessageEvent)

    const canvas = container.querySelector('canvas')!
    fireEvent.mouseDown(canvas, { button: 0, clientX: 4, clientY: 200 })
    fireEvent.mouseMove(window, { clientX: 100, clientY: 200 })

    const beforeScrollSelections = postedMessages.filter(m => m.type === 'selection' && m.selection)
    const before = beforeScrollSelections[beforeScrollSelections.length - 1].selection

    createdWorker.onmessage?.({
      data: {
        type: 'metadata',
        cwd: null,
        title: null,
        displayOffset: 5,
        totalHistory: 100,
        isAlternate: false,
      },
    } as MessageEvent)

    const afterScrollSelections = postedMessages.filter(m => m.type === 'selection' && m.selection)
    expect(afterScrollSelections.length).toBeGreaterThan(beforeScrollSelections.length)

    const after = afterScrollSelections[afterScrollSelections.length - 1].selection
    expect(after.startRow).toBe(before.startRow + 5)
    expect(after.endRow).toBe(before.endRow + 5)
  })

  it('clears a stale selection instead of leaving it frozen when paging on the alt screen', () => {
    const { container } = render(
      <NativeTerminalPane
        terminalId="t-1"
        workspaceId="ws-1"
        isActive={true}
        isMaximized={false}
        onFocus={vi.fn()}
        onToggleMaximize={vi.fn()}
        onClose={vi.fn()}
        onSplit={vi.fn()}
      />
    )

    createdWorker.onmessage?.({ data: { type: 'ready' } } as MessageEvent)

    // Enter the alt screen (e.g. vim/less/a full-screen TUI) via metadata,
    // matching how the real worker reports it after a snapshot.
    createdWorker.onmessage?.({
      data: {
        type: 'metadata',
        cwd: null,
        title: null,
        displayOffset: 0,
        totalHistory: 0,
        isAlternate: true,
      },
    } as MessageEvent)

    const canvas = container.querySelector('canvas')!
    fireEvent.mouseDown(canvas, { button: 0, clientX: 4, clientY: 200 })
    fireEvent.mouseMove(window, { clientX: 100, clientY: 200 })
    fireEvent.mouseUp(window, { clientX: 100, clientY: 200 })

    const selectionsBeforePage = postedMessages.filter(m => m.type === 'selection')
    expect(selectionsBeforePage[selectionsBeforePage.length - 1].selection).toBeTruthy()

    // displayOffset never moves on the alt screen — the wheel/page tick is
    // forwarded to the child app instead (see native_terminal_manager.rs).
    // Without a clear, the old selection would stay frozen on screen while
    // the app's own redraw scrolls unrelated content underneath it.
    fireEvent.keyDown(canvas, { key: 'PageDown' })

    const selectionsAfterPage = postedMessages.filter(m => m.type === 'selection')
    expect(selectionsAfterPage[selectionsAfterPage.length - 1].selection).toBeNull()
  })

  it('forwards initial snapshots to the worker before the worker ready message', async () => {
    render(
      <NativeTerminalPane
        terminalId="t-1"
        workspaceId="ws-1"
        isActive={true}
        isMaximized={false}
        onFocus={vi.fn()}
        onToggleMaximize={vi.fn()}
        onClose={vi.fn()}
        onSplit={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(tauriMock.listeners['native-terminal-update-t-1']).toBeDefined()
    })

    tauriMock.listeners['native-terminal-update-t-1']({
      payload: {
        cells_b64: '',
        cols: 80,
        rows: 24,
        cursorCol: 8,
        cursorRow: 0,
        cursorVisible: true,
        cwd: '~',
        title: null,
        displayOffset: 0,
        totalHistory: 0,
        isAlternate: false,
      },
    })

    expect(postedMessages.some(m => m.type === 'snapshot')).toBe(true)
  })

  it('requests a fresh snapshot after terminal update listeners are attached', async () => {
    render(
      <NativeTerminalPane
        terminalId="t-1"
        workspaceId="ws-1"
        isActive={true}
        isMaximized={false}
        onFocus={vi.fn()}
        onToggleMaximize={vi.fn()}
        onClose={vi.fn()}
        onSplit={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(tauriMock.listeners['native-terminal-update-t-1']).toBeDefined()
    })

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('refresh_terminal_snapshot', { terminalId: 't-1' })
    })
  })

  it('flushes wheel scroll on the next animation frame instead of waiting for idle polling', async () => {
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      cb(performance.now())
      return 1
    })

    try {
      const { container } = render(
        <NativeTerminalPane
          terminalId="t-1"
          workspaceId="ws-1"
          isActive={true}
          isMaximized={false}
          onFocus={vi.fn()}
          onToggleMaximize={vi.fn()}
          onClose={vi.fn()}
          onSplit={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(tauriMock.listeners['native-terminal-update-t-1']).toBeDefined()
      })

      vi.mocked(invoke).mockClear()
      rafSpy.mockClear()

      fireEvent.wheel(containerRef(container), { deltaY: 80, deltaMode: 0 })

      await waitFor(() => {
        expect(rafSpy).toHaveBeenCalled()
        expect(invoke).toHaveBeenCalledWith('scroll_terminal', expect.objectContaining({ terminalId: 't-1' }))
      })
    } finally {
      rafSpy.mockRestore()
    }
  })
})

function containerRef(container: HTMLElement): HTMLElement {
  const canvas = container.querySelector('canvas')
  const parent = canvas?.parentElement
  if (!parent) throw new Error('Native terminal canvas container not found')
  return parent
}
