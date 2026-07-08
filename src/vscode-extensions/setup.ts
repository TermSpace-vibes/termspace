/**
 * Monaco VS Code Service Override Setup
 *
 * Must be imported (or initializeExtensions() called) BEFORE any editor mounts.
 * Idempotent — safe for React StrictMode double-invoke.
 *
 * The bare `vscode/...` imports resolve via the vite alias:
 *   vscode → @codingame/monaco-vscode-api
 * which has a ./vscode/* export pattern.
 */
import '@codingame/monaco-vscode-api/extensions'

import { initialize } from '@codingame/monaco-vscode-api'
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'

import getExtensionServiceOverride from '@codingame/monaco-vscode-extensions-service-override'
import getLanguagesServiceOverride from '@codingame/monaco-vscode-languages-service-override'
import getModelServiceOverride from '@codingame/monaco-vscode-model-service-override'
import getConfigurationServiceOverride from '@codingame/monaco-vscode-configuration-service-override'
import getFilesServiceOverride from '@codingame/monaco-vscode-files-service-override'
import getTextmateServiceOverride from '@codingame/monaco-vscode-textmate-service-override'
import getThemeServiceOverride from '@codingame/monaco-vscode-theme-service-override'
import getLanguageDetectionServiceOverride from '@codingame/monaco-vscode-language-detection-worker-service-override'

import { registerDefaultExtensions } from './default-extensions'
import { registerDynamicTheme, type DynamicThemeTokenColor } from './dynamic-theme'

export { registerDynamicTheme, type DynamicThemeTokenColor }

let initPromise: Promise<void> | null = null

interface MonacoEnvironment {
  getWorker?: (workerId: string, label: string) => Worker
  getWorkerUrl?: (workerId: string, label: string) => string
}

/**
 * Configure MonacoEditor workers via MonacoEnvironment.
 * In @codingame 18.x, `useWorkerFactory` is not available — workers are
 * configured via the standard MonacoEnvironment.getWorker pattern.
 *
 * The TextMate tokenizer runs inline (not worker-backed) in this version.
 */
function configureWorkers() {
  const env = (globalThis as any).MonacoEnvironment as MonacoEnvironment | undefined ?? {}
  if (!env.getWorker && !env.getWorkerUrl) {
    env.getWorker = (_workerId: string, label: string) => {
      return new Worker(
        new URL('@codingame/monaco-vscode-editor-api/esm/vs/editor/editor.worker.js', import.meta.url),
        { name: label, type: 'module' },
      )
    }
  }
  ;(globalThis as any).MonacoEnvironment = env
}

export async function initializeExtensions(): Promise<void> {
  if (initPromise) return initPromise

  initPromise = (async () => {
    configureWorkers()

    await initialize({
      ...getExtensionServiceOverride(),
      ...getLanguagesServiceOverride(),
      ...getModelServiceOverride(),
      ...getConfigurationServiceOverride(),
      ...getFilesServiceOverride(),
      ...getTextmateServiceOverride(),
      ...getThemeServiceOverride(),
      ...getLanguageDetectionServiceOverride(),
    })

    // Must use the SAME monaco instance that VS Code services were applied to.
    // The vite alias monaco-editor → @codingame/monaco-vscode-editor-api means
    // `import * as monaco from 'monaco-editor'` resolves to the API package,
    // which is the same instance that initialize() modified.
    loader.config({ monaco })

    // Register default extensions AFTER services are initialized.
    // Dynamic imports ensure the extension manifests register against
    // the live extension service override.
    await registerDefaultExtensions()
  })()

  return initPromise
}

