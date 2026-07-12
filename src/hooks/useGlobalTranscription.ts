import { useCallback, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { useAppStore } from '../store/useAppStore'
import { GLOBAL_DICTATION_AUDIO_LEVELS_EVENT } from '../utils/constants'
import {
  useDictation,
  type DictationError,
} from './useDictation'

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

// Scoped to the tab the user is actually looking at — checking across every
// tab (as the old implementation did) meant a terminal in a background tab
// still counted as a valid target, so dictation could silently land in a
// pane the user can no longer see while still reporting success.
function isTerminalInActiveTab(terminalId: string | null) {
  if (!terminalId) return false
  const { activeWorkspaceId, activeTabIds, terminalsByTab } = useAppStore.getState()
  const activeTabId = activeWorkspaceId ? activeTabIds[activeWorkspaceId] : undefined
  if (!activeTabId) return false
  return (terminalsByTab[activeTabId] ?? []).some((terminal) => terminal.id === terminalId)
}

function focusedTerminalId(element: Element | null): string | null {
  if (!(element instanceof HTMLElement)) return null
  return element.dataset.terminalId ?? null
}

export function useGlobalTranscription() {
  const settings = useAppStore((s) => s.settings)
  const addToast = useAppStore((s) => s.addToast)
  const lastEditableElementRef = useRef<HTMLElement | null>(null)
  const lastFocusedTerminalIdRef = useRef<string | null>(null)

  useEffect(() => {
    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target as Element | null
      if (isEditableElement(target)) {
        lastEditableElementRef.current = target as HTMLElement
      }
      const terminalId = focusedTerminalId(target)
      if (terminalId) {
        lastFocusedTerminalIdRef.current = terminalId
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

        // Fall back to the last-focused terminal the same way the editable
        // branch above falls back to lastEditableElementRef — clicking the
        // in-app dictation button moves DOM focus to that button/nothing, so
        // requiring literal current focus here would break the common "focus
        // terminal, then dictate" flow. Still scoped to the active tab so a
        // background tab's terminal can't be silently targeted (see
        // isTerminalInActiveTab).
        const targetTerminalId = focusedTerminalId(activeElement) ?? lastFocusedTerminalIdRef.current
        if (targetTerminalId && isTerminalInActiveTab(targetTerminalId)) {
          await invoke('write_terminal', {
            terminalId: targetTerminalId,
            data: text,
          })
          addToast('Dictation inserted.', 'success')
          return
        }

        // Termspace has focus but nothing recognizable is focused inside it —
        // sending a synthetic Cmd+V to ourselves here has no reliable target,
        // so just copy the transcript instead of falsely claiming insertion.
        await writeText(text)
        addToast('Transcript copied. Click into a text field or terminal to paste.', 'info')
        return
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

  const handleEmpty = useCallback(() => {
    addToast('Dictation was empty.', 'info')
  }, [addToast])

  const handleError = useCallback((error: DictationError) => {
    addToast(error.message, 'error')
  }, [addToast])

  const syncTrayDictationState = useCallback((state: { isListening: boolean; isProcessing: boolean }) => {
    if (!useAppStore.getState().settings.globalDictationEnabled) return
    const dictationState = state.isProcessing
      ? 'processing'
      : state.isListening
        ? 'listening'
        : 'idle'
    invoke('set_tray_dictation_state', { dictationState }).catch(console.error)
  }, [])

  const handleAudioLevels = useCallback((levels: number[]) => {
    window.dispatchEvent(new CustomEvent(GLOBAL_DICTATION_AUDIO_LEVELS_EVENT, { detail: levels }))
  }, [])

  const dictation = useDictation({
    onResult: handleResult,
    onEmpty: handleEmpty,
    onError: handleError,
    onStateChange: syncTrayDictationState,
    onAudioLevels: handleAudioLevels,
    listenForGlobalToggle: false,
  })

  const toggleListeningRef = useRef(dictation.toggleListening)
  const cancelPendingStartRef = useRef(dictation.cancelPendingStart)
  const isListeningRef = useRef(dictation.isListening)
  const isProcessingRef = useRef(dictation.isProcessing)

  useEffect(() => {
    toggleListeningRef.current = dictation.toggleListening
    cancelPendingStartRef.current = dictation.cancelPendingStart
    isListeningRef.current = dictation.isListening
    isProcessingRef.current = dictation.isProcessing
  }, [dictation.cancelPendingStart, dictation.isListening, dictation.toggleListening, dictation.isProcessing])

  useEffect(() => {
    if (!settings.globalDictationEnabled) {
      invoke('unregister_global_dictation_shortcut').catch(console.error)
      invoke('hide_tray_icon').catch(console.error)
      return
    }

    invoke('register_global_dictation_shortcut', {
      shortcut: settings.globalDictationHotkey || '`',
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

  const requestPress = useCallback(() => {
    if (!useAppStore.getState().settings.globalDictationEnabled) return
    if (isListeningRef.current || isProcessingRef.current) return
    void toggleListeningRef.current()
  }, [])

  const requestRelease = useCallback(() => {
    if (!useAppStore.getState().settings.globalDictationEnabled) return
    if (isListeningRef.current) {
      void toggleListeningRef.current()
      return
    }
    cancelPendingStartRef.current()
  }, [])

  useEffect(() => {
    const unlistenPromise = listen('global-dictation-toggle', () => {
      requestToggle()
    })
    const unlistenPressPromise = listen('global-dictation-press', () => {
      requestPress()
    })
    const unlistenReleasePromise = listen('global-dictation-release', () => {
      requestRelease()
    })

    const handleDomToggle = () => {
      if (!useAppStore.getState().settings.globalDictationEnabled) return
      requestToggle()
    }
    window.addEventListener('termspace:toggle-global-dictation', handleDomToggle)

    return () => {
      window.removeEventListener('termspace:toggle-global-dictation', handleDomToggle)
      unlistenPromise.then((unlisten) => unlisten()).catch(console.error)
      unlistenPressPromise.then((unlisten) => unlisten()).catch(console.error)
      unlistenReleasePromise.then((unlisten) => unlisten()).catch(console.error)
    }
  }, [requestPress, requestRelease, requestToggle])

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
