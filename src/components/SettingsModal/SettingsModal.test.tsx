import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SettingsModal } from './SettingsModal'
import { useAppStore } from '../../store/useAppStore'

const invokeMock = vi.fn()
let progressHandler: ((event: { payload: unknown }) => void) | null = null

vi.mock('../../utils/tauri', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  listen: vi.fn((_event: string, handler: (event: { payload: unknown }) => void) => {
    progressHandler = handler
    return Promise.resolve(vi.fn())
  }),
}))

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(),
}))

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn(() => Promise.resolve('0.7.1')),
}))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const baseStatus = {
  state: 'missing',
  source: null,
  downloadedPath: null,
  bundledPath: null,
  sizeBytes: null,
  expectedSizeBytes: 147964211,
  error: null,
}

async function openApplicationTab() {
  await act(async () => {
    screen.getByRole('button', { name: 'Application' }).click()
  })
}

describe('SettingsModal dictation model controls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    progressHandler = null
    useAppStore.setState({
      settings: {
        ...useAppStore.getState().settings,
        dictationProvider: 'local',
      },
      toasts: [],
    })
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_dictation_model_status') return Promise.resolve(baseStatus)
      return Promise.resolve({})
    })
  })

  it('shows local dictation model status and download button', async () => {
    render(<SettingsModal onClose={vi.fn()} />)
    await openApplicationTab()

    expect(await screen.findByText('Local Model')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download Local Model' })).toBeInTheDocument()
  })

  it('updates progress from model download events', async () => {
    render(<SettingsModal onClose={vi.fn()} />)
    await openApplicationTab()
    await screen.findByText('Local Model')

    await act(async () => {
      progressHandler?.({
        payload: {
          downloadedBytes: 73_982_105,
          totalBytes: 147_964_211,
          progress: 0.5,
        },
      })
    })

    expect(screen.getByText('50%')).toBeInTheDocument()
  })

  it('shows retry after a failed download', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_dictation_model_status') return Promise.resolve(baseStatus)
      if (command === 'download_dictation_model') return Promise.reject(new Error('network failed'))
      return Promise.resolve({})
    })

    render(<SettingsModal onClose={vi.fn()} />)
    await openApplicationTab()

    await act(async () => {
      screen.getByRole('button', { name: 'Download Local Model' }).click()
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Retry Download' })).toBeInTheDocument()
    })
    expect(screen.getByText('network failed')).toBeInTheDocument()
  })

  it('loads an existing downloaded model from settings', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_dictation_model_status') {
        return Promise.resolve({
          ...baseStatus,
          state: 'downloaded',
          source: 'downloaded',
          downloadedPath: '/app/models/ggml-base.en.bin',
          sizeBytes: 147964211,
        })
      }
      if (command === 'load_dictation_model') {
        return Promise.resolve({
          ...baseStatus,
          state: 'loaded',
          source: 'downloaded',
          downloadedPath: '/app/models/ggml-base.en.bin',
          sizeBytes: 147964211,
        })
      }
      return Promise.resolve({})
    })

    render(<SettingsModal onClose={vi.fn()} />)
    await openApplicationTab()
    await screen.findByRole('button', { name: 'Load Model' })

    await act(async () => {
      screen.getByRole('button', { name: 'Load Model' }).click()
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Model Loaded' })).toBeInTheDocument()
    })
    expect(invokeMock).toHaveBeenCalledWith('load_dictation_model', { language: 'en' })
  })

  it('renders and saves system-wide dictation settings', async () => {
    useAppStore.setState({
      settings: {
        ...useAppStore.getState().settings,
        dictationProvider: 'local',
        globalDictationEnabled: false,
        globalDictationHotkey: 'CmdOrCtrl+Shift+M',
        globalDictationAutoPaste: true,
        globalDictationRestoreClipboard: true,
        globalDictationPasteDelayMs: 120,
      },
    })

    render(<SettingsModal onClose={vi.fn()} />)
    await openApplicationTab()

    fireEvent.click(screen.getByLabelText('Enable system-wide dictation'))
    fireEvent.change(screen.getByLabelText('Hold-to-dictate key'), {
      target: { value: 'CmdOrCtrl+Shift+D' },
    })
    fireEvent.click(screen.getByLabelText('Auto-paste into active app'))
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))

    expect(useAppStore.getState().settings).toMatchObject({
      globalDictationEnabled: true,
      globalDictationHotkey: 'CmdOrCtrl+Shift+D',
      globalDictationAutoPaste: false,
      globalDictationRestoreClipboard: true,
      globalDictationPasteDelayMs: 120,
    })
  })

  it('shows a paste permission gateway and requests accessibility permission', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_dictation_model_status') return Promise.resolve(baseStatus)
      if (command === 'get_global_dictation_permission_status') {
        return Promise.resolve({
          platform: 'macos',
          accessibilityGranted: false,
          accessibilityPromptSupported: true,
          accessibilitySettingsSupported: true,
          autoPasteSupported: true,
          message: 'Accessibility permission is needed for automatic paste.',
        })
      }
      if (command === 'request_accessibility_permission') {
        return Promise.resolve({
          platform: 'macos',
          accessibilityGranted: false,
          accessibilityPromptSupported: true,
          accessibilitySettingsSupported: true,
          autoPasteSupported: true,
          message: 'Approve Termspace in Accessibility, then return here.',
        })
      }
      return Promise.resolve({})
    })

    useAppStore.setState({
      settings: {
        ...useAppStore.getState().settings,
        dictationProvider: 'local',
        globalDictationEnabled: true,
        globalDictationAutoPaste: true,
      },
    })

    render(<SettingsModal onClose={vi.fn()} />)
    await openApplicationTab()

    expect(await screen.findByText('Paste Permission')).toBeInTheDocument()
    expect(screen.getByText('Accessibility permission is needed for automatic paste.')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Allow Paste Control' }))
    })

    expect(invokeMock).toHaveBeenCalledWith('request_accessibility_permission')
    expect(await screen.findByText('Approve Termspace in Accessibility, then return here.')).toBeInTheDocument()
  })
})
