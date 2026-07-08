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

function isEditableElement(element: Element | null): element is HTMLInputElement | HTMLTextAreaElement | HTMLElement {
  if (!element || !(element instanceof HTMLElement)) return false
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return !element.disabled && !element.readOnly
  }
  return element.isContentEditable
}

function insertIntoEditableElement(element: HTMLElement, text: string) {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const start = element.selectionStart ?? element.value.length
    const end = element.selectionEnd ?? start
    element.setRangeText(text, start, end, 'end')
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: text,
    }))
    return true
  }

  if (!element.isContentEditable) return false

  element.focus()
  const selection = window.getSelection()
  if (!selection) return false

  const range = selection.rangeCount > 0
    ? selection.getRangeAt(0)
    : document.createRange()

  if (selection.rangeCount === 0) {
    range.selectNodeContents(element)
    range.collapse(false)
  }

  range.deleteContents()
  const node = document.createTextNode(text)
  range.insertNode(node)
  range.setStartAfter(node)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
  element.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    inputType: 'insertText',
    data: text,
  }))
  return true
}

function hasKnownTerminal(terminalId: string | null) {
  if (!terminalId) return false
  const { terminalsByTab } = useAppStore.getState()
  return Object.values(terminalsByTab).some((terminals) =>
    terminals.some((terminal) => terminal.id === terminalId)
  )
}

export function useGlobalTranscription() {
  const settings = useAppStore((s) => s.settings)
  const addToast = useAppStore((s) => s.addToast)
  const lastEditableElementRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const handleFocusIn = (event: FocusEvent) => {
      if (isEditableElement(event.target as Element | null)) {
        lastEditableElementRef.current = event.target as HTMLElement
      }
    }

    window.addEventListener('focusin', handleFocusIn)
    return () => window.removeEventListener('focusin', handleFocusIn)
  }, [])

  const handleResult = useCallback(async (text: string) => {
    if (!text.trim()) {
      addToast('Dictation was empty.', 'info')
      return
    }

    try {
      const currentSettings = useAppStore.getState().settings
      const termspaceHasFocus = document.hasFocus()
      const activeElement = document.activeElement

      if (termspaceHasFocus) {
        const editableTarget = isEditableElement(activeElement)
          ? activeElement
          : lastEditableElementRef.current

        if (editableTarget && insertIntoEditableElement(editableTarget, text)) {
          addToast('Dictation inserted.', 'success')
          return
        }

        const activeTerminalId = useAppStore.getState().activeTerminalId
        if (hasKnownTerminal(activeTerminalId)) {
          await invoke('write_terminal', {
            terminalId: activeTerminalId,
            data: text,
          })
          addToast('Dictation inserted.', 'success')
          return
        }
      }

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
      invoke('hide_tray_icon').catch(console.error)
      return
    }

    invoke('register_global_dictation_shortcut', {
      shortcut: settings.globalDictationHotkey || 'CmdOrCtrl+Shift+M',
    }).catch((error) => {
      addToast(`Global dictation hotkey failed: ${error}`, 'error')
    })
    invoke('show_tray_icon').catch((error) => {
      addToast(`Tray icon failed: ${error}`, 'error')
    })
  }, [addToast, settings.globalDictationEnabled, settings.globalDictationHotkey])

  useEffect(() => {
    if (!settings.globalDictationEnabled) return
    const state = dictation.isProcessing
      ? 'processing'
      : dictation.isListening
        ? 'listening'
        : 'idle'
    invoke('set_tray_dictation_state', { dictationState: state }).catch(console.error)
  }, [dictation.isListening, dictation.isProcessing, settings.globalDictationEnabled])

  const requestToggle = useCallback(() => {
    if (!useAppStore.getState().settings.globalDictationEnabled) return
    if (isProcessingRef.current) return
    void toggleListeningRef.current()
  }, [])

  useEffect(() => {
    const unlistenPromise = listen('global-dictation-toggle', () => {
      requestToggle()
    })

    const handleDomToggle = () => {
      if (!useAppStore.getState().settings.globalDictationEnabled) return
      requestToggle()
    }
    window.addEventListener('termspace:toggle-global-dictation', handleDomToggle)

    return () => {
      window.removeEventListener('termspace:toggle-global-dictation', handleDomToggle)
      unlistenPromise.then((unlisten) => unlisten()).catch(console.error)
    }
  }, [requestToggle])

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('termspace:global-dictation-state', {
      detail: dictation,
    }))
  }, [dictation])

  useEffect(() => {
    const unlistenPromise = listen('open-dictation-settings', () => {
      window.dispatchEvent(new CustomEvent('termspace:open-settings'))
    })

    return () => {
      unlistenPromise.then((unlisten) => unlisten()).catch(console.error)
    }
  }, [])

  return dictation
}
