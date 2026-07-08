import { describe, it, expect, vi, beforeEach } from 'vitest'

const registerFileUrlMock = vi.fn(() => ({ dispose: vi.fn() }))
const disposeMock = vi.fn()
const whenReadyMock = vi.fn().mockResolvedValue(undefined)

vi.mock('@codingame/monaco-vscode-api/extensions', () => ({
  registerExtension: vi.fn(() => ({
    registerFileUrl: registerFileUrlMock,
    whenReady: whenReadyMock,
    dispose: disposeMock,
    isEnabled: vi.fn().mockResolvedValue(true),
  })),
  ExtensionHostKind: { LocalWebWorker: 2 },
}))

// @codingame/monaco-vscode-configuration-service-override is left to the
// project's global test stub (vite.config.ts stubs all @codingame/* imports
// to `export default {}` under Vitest) — updateUserConfiguration ends up
// undefined, and its call is inside a .then().catch(), so it doesn't affect
// these synchronous assertions.

describe('registerDynamicTheme', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('registers the extension once for a single consumer', async () => {
    const { registerDynamicTheme } = await import('./dynamic-theme')
    const extModule = await import('@codingame/monaco-vscode-api/extensions')

    registerDynamicTheme('termspace-dynamic-warm-dark', 'Termspace Dynamic', 'vs-dark', {}, [])

    expect(extModule.registerExtension).toHaveBeenCalledTimes(1)
  })

  it('shares one registration across concurrent consumers with the same themeId', async () => {
    const { registerDynamicTheme } = await import('./dynamic-theme')
    const extModule = await import('@codingame/monaco-vscode-api/extensions')

    // Simulates two EditorPane instances mounted at once, both on the
    // app's current global theme — this used to throw "file already
    // exists" because each call registered the same extension file path.
    registerDynamicTheme('termspace-dynamic-warm-dark', 'Termspace Dynamic', 'vs-dark', {}, [])
    registerDynamicTheme('termspace-dynamic-warm-dark', 'Termspace Dynamic', 'vs-dark', {}, [])

    expect(extModule.registerExtension).toHaveBeenCalledTimes(1)
    expect(registerFileUrlMock).toHaveBeenCalledTimes(1)
  })

  it('registers independently for different themeIds', async () => {
    const { registerDynamicTheme } = await import('./dynamic-theme')
    const extModule = await import('@codingame/monaco-vscode-api/extensions')

    registerDynamicTheme('termspace-dynamic-warm-dark', 'Termspace Dynamic', 'vs-dark', {}, [])
    registerDynamicTheme('termspace-dynamic-cool-light', 'Termspace Dynamic', 'vs', {}, [])

    expect(extModule.registerExtension).toHaveBeenCalledTimes(2)
  })

  it('does not dispose the underlying registration while another consumer still holds it', async () => {
    const { registerDynamicTheme } = await import('./dynamic-theme')

    const disposeFirst = registerDynamicTheme('termspace-dynamic-warm-dark', 'Termspace Dynamic', 'vs-dark', {}, [])
    registerDynamicTheme('termspace-dynamic-warm-dark', 'Termspace Dynamic', 'vs-dark', {}, [])

    disposeFirst()

    expect(disposeMock).not.toHaveBeenCalled()
  })

  it('disposes the underlying registration once every consumer has released it', async () => {
    const { registerDynamicTheme } = await import('./dynamic-theme')

    const disposeFirst = registerDynamicTheme('termspace-dynamic-warm-dark', 'Termspace Dynamic', 'vs-dark', {}, [])
    const disposeSecond = registerDynamicTheme('termspace-dynamic-warm-dark', 'Termspace Dynamic', 'vs-dark', {}, [])

    disposeFirst()
    disposeSecond()

    expect(disposeMock).toHaveBeenCalledTimes(1)
  })

  it('registers again after all consumers have released and disposed', async () => {
    const { registerDynamicTheme } = await import('./dynamic-theme')
    const extModule = await import('@codingame/monaco-vscode-api/extensions')

    const dispose = registerDynamicTheme('termspace-dynamic-warm-dark', 'Termspace Dynamic', 'vs-dark', {}, [])
    dispose()
    registerDynamicTheme('termspace-dynamic-warm-dark', 'Termspace Dynamic', 'vs-dark', {}, [])

    expect(extModule.registerExtension).toHaveBeenCalledTimes(2)
  })
})
