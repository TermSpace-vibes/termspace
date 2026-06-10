export function matchShortcut(e: KeyboardEvent, shortcutStr: string): boolean {
  if (!shortcutStr) return false

  const parts = shortcutStr.toLowerCase().split('+').map(p => p.trim())
  
  const needsCtrlOrCmd = parts.includes('cmdorctrl')
  const needsCtrl = parts.includes('ctrl')
  const needsCmd = parts.includes('cmd') || parts.includes('meta')
  const needsShift = parts.includes('shift')
  const needsAlt = parts.includes('alt')
  
  // The actual key is the last part
  const keyPart = parts[parts.length - 1]

  const hasCtrl = e.ctrlKey
  const hasCmd = e.metaKey
  const hasCtrlOrCmd = hasCtrl || hasCmd
  
  if (needsCtrlOrCmd) {
    if (!hasCtrlOrCmd) return false
  } else {
    if (needsCtrl !== hasCtrl) return false
    if (needsCmd !== hasCmd) return false
  }

  if (needsShift !== e.shiftKey) return false
  if (needsAlt !== e.altKey) return false

  return e.key.toLowerCase() === keyPart
}
