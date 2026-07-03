import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor, fireEvent } from '@testing-library/react'
import { NativeTerminalPane } from './NativeTerminalPane'
import { readText } from '@tauri-apps/plugin-clipboard-manager'
import { invoke } from '../../utils/tauri'

// Mock Tauri invoke and listen
vi.mock('../../utils/tauri', () => ({
  invoke: vi.fn().mockImplementation((cmd) => {
    if (cmd === 'process_pasted_image') return Promise.resolve(null)
    if (cmd === 'get_terminal_text') return Promise.resolve('mock text')
    return Promise.resolve([])
  }),
  listen: vi.fn().mockResolvedValue(() => {}),
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
})

describe('NativeTerminalPane selection drag', () => {
  let postedMessages: any[]

  beforeEach(() => {
    postedMessages = []

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
})
