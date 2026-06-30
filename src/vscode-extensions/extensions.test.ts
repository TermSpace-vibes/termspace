import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@codingame/monaco-vscode-api/extensions', () => ({
  registerExtension: vi.fn(() => ({
    registerFileUrl: vi.fn(),
    getApi: vi.fn().mockResolvedValue({} as any),
    dispose: vi.fn(),
  })),
  ExtensionHostKind: { LocalProcess: 1 },
}))

describe('registerLocalExtension', () => {
  beforeEach(() => {
    // Reset the module registry between tests
    vi.resetModules()
  })

  it('returns a RegisteredExtension on success', async () => {
    const { registerLocalExtension, disposeAllExtensions } = await import('./extensions')
    const result = await registerLocalExtension({
      name: 'test-ext',
      publisher: 'test',
      version: '1.0.0',
      engines: { vscode: '*' },
    } as any)
    expect(result).not.toBeNull()
    expect(result!.id).toBe('test.test-ext')
    disposeAllExtensions()
  })

  it('disposes previous registration on re-register (idempotent)', async () => {
    const { registerLocalExtension, disposeAllExtensions } = await import('./extensions')
    const first = await registerLocalExtension({
      name: 'dup',
      publisher: 'test',
      version: '1.0.0',
      engines: { vscode: '*' },
    } as any)
    expect(first).not.toBeNull()

    const second = await registerLocalExtension({
      name: 'dup',
      publisher: 'test',
      version: '2.0.0',
      engines: { vscode: '*' },
    } as any)
    expect(second).not.toBeNull()
    expect(second!.id).toBe('test.dup')
    expect(first!.dispose).toHaveBeenCalled()
    disposeAllExtensions()
  })

  it('handles registration failure gracefully (fail open)', async () => {
    // Override mock for this test
    const extModule = await import('@codingame/monaco-vscode-api/extensions')
    ;(extModule.registerExtension as any).mockImplementationOnce(() => {
      throw new Error('simulated failure')
    })

    const { registerLocalExtension, disposeAllExtensions } = await import('./extensions')
    const result = await registerLocalExtension({
      name: 'bad-ext',
      publisher: 'test',
      version: '1.0.0',
      engines: { vscode: '*' },
    } as any)
    expect(result).toBeNull()
    disposeAllExtensions()
  })
})
