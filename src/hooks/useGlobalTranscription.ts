import { useCallback, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useAppStore } from '../store/useAppStore'
import { useDictation } from './useDictation'

interface GlobalInsertionResult {
  inserted: boolean
  copied: boolean
  clipboardRestored: boolean
  fallbackReason: string | null
  permissionRequired: string | null
}

export function useGlobalTranscription() {
  const settings = useAppStore((s) => s.settings)
  const addToast = useAppStore((s) => s.addToast)

  const handleResult = useCallback(async (text: string) => {
    if (!text.trim()) {
      addToast('Dictation was empty.', 'info')
      return
    }

    try {
      const currentSettings = useAppStore.getState().settings
      const result = await invoke<GlobalInsertionResult>('insert_text_into_active_app', {
        text,
        options: {
          autoPaste: currentSettings.globalDictationAutoPaste ?? true,
          restoreClipboard: currentSettings.globalDictationRestoreClipboard ?? true,
          pasteDelayMs: currentSettings.globalDictationPasteDelayMs ?? 120,
        },
      })

      if (result.inserted) {
        addToast(
          result.clipboardRestored
            ? 'Dictation inserted.'
            : 'Dictation inserted; clipboard kept as transcript.',
          'success'
        )
      } else if (result.permissionRequired === 'accessibility') {
        addToast(result.fallbackReason || 'Transcript copied. Enable Accessibility for auto-paste.', 'info', {
          label: 'Open Settings',
          onClick: () => {
            invoke('open_accessibility_settings').catch(console.error)
          },
        })
      } else {
        addToast(result.fallbackReason || 'Transcript copied.', 'info')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addToast(message, 'error')
    }
  }, [addToast])

  const handleError = useCallback((error: string) => {
    addToast(error, 'error')
  }, [addToast])

  const dictation = useDictation({
    onResult: handleResult,
    onError: handleError,
    listenForGlobalToggle: false,
  })

  const toggleListeningRef = useRef(dictation.toggleListening)
  const isProcessingRef = useRef(dictation.isProcessing)

  useEffect(() => {
    toggleListeningRef.current = dictation.toggleListening
    isProcessingRef.current = dictation.isProcessing
  }, [dictation.toggleListening, dictation.isProcessing])

  useEffect(() => {
    if (!settings.globalDictationEnabled) {
      invoke('unregister_global_dictation_shortcut').catch(console.error)
      return
    }

    invoke('register_global_dictation_shortcut', {
      shortcut: settings.globalDictationHotkey || 'CmdOrCtrl+Shift+M',
    }).catch((error) => {
      addToast(`Global dictation hotkey failed: ${error}`, 'error')
    })
  }, [addToast, settings.globalDictationEnabled, settings.globalDictationHotkey])

  useEffect(() => {
    const unlistenPromise = listen('global-dictation-toggle', () => {
      if (!useAppStore.getState().settings.globalDictationEnabled) return
      if (isProcessingRef.current) return
      void toggleListeningRef.current()
    })

    return () => {
      unlistenPromise.then((unlisten) => unlisten()).catch(console.error)
    }
  }, [])

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('termspace:global-dictation-state', {
      detail: dictation,
    }))
  }, [dictation])

  return dictation
}
