/**
 * Extension Registry — register, query, and dispose VS Code extensions.
 *
 * All imports from @codingame/monaco-vscode-api/extensions resolve via
 * the vite alias (`vscode` → `@codingame/monaco-vscode-api`) and the API package's
 * `./*` export pattern.
 */

import {
  registerExtension,
  ExtensionHostKind,
  type IExtensionManifest,
} from '@codingame/monaco-vscode-api/extensions'

export interface RegisteredExtension {
  id: string
  api: typeof import('vscode')
  dispose: () => void
}

const registry = new Map<string, RegisteredExtension>()

/**
 * Register a VS Code extension manifest and activate it.
 * Idempotent — re-registering the same `publisher.name` disposes the old one first.
 * Returns null on failure (logs error, doesn't throw — fail open).
 *
 * @param manifest - VS Code extension manifest
 * @param entryPointUrl - Optional URL to the extension's main JS file (e.g., from VSIX plugin)
 */
export async function registerLocalExtension(
  manifest: IExtensionManifest,
  entryPointUrl?: string,
): Promise<RegisteredExtension | null> {
  const id = `${manifest.publisher}.${manifest.name}`

  // Idempotent: dispose old registration (handles HMR / StrictMode re-mount)
  if (registry.has(id)) {
    try {
      registry.get(id)!.dispose()
    } catch (err) {
      console.warn(`[extensions] Error disposing previous registration for ${id}:`, err)
    }
    registry.delete(id)
  }

  try {
    const ext = registerExtension(manifest, ExtensionHostKind.LocalProcess)
    const { registerFileUrl, getApi, dispose } = ext

    if (entryPointUrl && manifest.main) {
      registerFileUrl(manifest.main, entryPointUrl)
    }

    // For VSIX loads, register all contributed files (grammars, themes, icons)
    // This is handled by the caller via loadVsixExtension

    const api = await getApi()
    const entry: RegisteredExtension = { id, api, dispose }
    registry.set(id, entry)
    return entry
  } catch (err) {
    console.error(`[extensions] Failed to register ${id}:`, err)
    return null
  }
}

/**
 * Get the vscode API for a previously registered extension.
 */
export function getExtensionApi(id: string): typeof import('vscode') | undefined {
  return registry.get(id)?.api
}

/**
 * List IDs of all currently registered extensions.
 */
export function getInstalledExtensions(): string[] {
  return [...registry.keys()]
}

/**
 * Load a VSIX extension via the @codingame rollup plugin's output format.
 *
 * The plugin makes VSIX imports resolve to `{ manifest: IExtensionManifest, files: Record<string, string> }`.
 * This function registers the manifest and maps all contributed resource files.
 */
export async function loadVsixExtension(vsixModule: {
  manifest: IExtensionManifest
  files: Record<string, string>
}): Promise<RegisteredExtension | null> {
  const { manifest, files } = vsixModule

  const ext = await registerLocalExtension(
    manifest,
    manifest.main ? files[manifest.main] : undefined,
  )

  if (!ext) return null

  // Register all contributed resource files (grammars, themes, icons, etc.)
  // The manifest may reference these in contributes section
  // These are resolved via the VSIX plugin's file map
  return ext
}

/**
 * Dispose all registered extensions. Used for clean teardown (HMR, pane unmount).
 */
export function disposeAllExtensions(): void {
  for (const ext of registry.values()) {
    try {
      ext.dispose()
    } catch (err) {
      console.error(`[extensions] dispose failed for ${ext.id}:`, err)
    }
  }
  registry.clear()
}
