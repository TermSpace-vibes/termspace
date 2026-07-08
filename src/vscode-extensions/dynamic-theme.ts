/**
 * Registers a theme built at runtime (e.g. from user color settings) as a
 * proper VS Code theme extension contribution and activates it.
 *
 * Separated from setup.ts so it can be tested without importing the full
 * Monaco service-override stack.
 */
import { registerExtension, ExtensionHostKind } from '@codingame/monaco-vscode-api/extensions'
import { updateUserConfiguration } from '@codingame/monaco-vscode-configuration-service-override'

export interface DynamicThemeTokenColor {
  scope: string[]
  settings: { foreground: string; fontStyle?: string }
}

interface ThemeRegistrationEntry {
  refCount: number
  disposeUnderlying: () => void
}

const activeRegistrations = new Map<string, ThemeRegistrationEntry>()

/**
 * Registers a theme built at runtime (e.g. from user color settings) as a
 * proper VS Code theme extension contribution and activates it. Returns a
 * cleanup function that releases this caller's reference.
 *
 * Content for a given `themeId` is assumed identical across callers (it's
 * derived from the same static theme definitions), so concurrent callers
 * for the same `themeId` share one underlying registration rather than each
 * registering their own — registering the same extension file path twice
 * throws "file '.../dynamic-color-theme.json/' already exists". The
 * underlying registration is only disposed once every caller has released
 * its reference.
 *
 * Once the workbench theme service override is installed,
 * `monaco.editor.defineTheme()` no longer works — IStandaloneThemeService
 * stops backing it (throws "standaloneThemeService.defineTheme is not a
 * function"), so custom themes must be contributed the same way
 * @codingame/monaco-vscode-theme-defaults-default-extension ships its
 * built-in themes: a manifest with a `contributes.themes` entry, with the
 * theme JSON served here via a data: URL since it's generated at runtime.
 */
export function registerDynamicTheme(
  themeId: string,
  label: string,
  uiTheme: 'vs' | 'vs-dark',
  colors: Record<string, string>,
  tokenColors: DynamicThemeTokenColor[],
): () => void {
  const existing = activeRegistrations.get(themeId)
  if (existing) {
    existing.refCount += 1
    return () => releaseRegistration(themeId)
  }

  const themeJson = { name: label, colors, tokenColors }
  const manifest = {
    name: themeId,
    publisher: 'termspace',
    version: '0.0.0',
    engines: { vscode: '*' },
    contributes: {
      themes: [{ id: themeId, label, uiTheme, path: './themes/dynamic-color-theme.json' }],
    },
  }

  let cancelled = false
  const registration = registerExtension(manifest, ExtensionHostKind.LocalWebWorker)
  const themeFileUrl = `data:application/json,${encodeURIComponent(JSON.stringify(themeJson))}`
  const fileRegistration = registration.registerFileUrl('./themes/dynamic-color-theme.json', themeFileUrl)

  registration.whenReady()
    .then(() => {
      if (cancelled) return
      return updateUserConfiguration(JSON.stringify({ 'workbench.colorTheme': themeId }))
    })
    .catch(err => console.error('[vscode-extensions] failed to activate dynamic theme:', err))

  activeRegistrations.set(themeId, {
    refCount: 1,
    disposeUnderlying: () => {
      cancelled = true
      fileRegistration.dispose()
      void registration.dispose()
    },
  })

  return () => releaseRegistration(themeId)
}

function releaseRegistration(themeId: string): void {
  const entry = activeRegistrations.get(themeId)
  if (!entry) return

  entry.refCount -= 1
  if (entry.refCount <= 0) {
    activeRegistrations.delete(themeId)
    entry.disposeUnderlying()
  }
}
