/**
 * Formats a timestamp into a clean relative time string.
 */
export function formatRelativeTime(timestamp?: number | null): string {
  if (!timestamp) return 'Never opened'
  const now = Date.now()
  const diff = now - timestamp
  if (diff < 0) return 'Just now'

  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'Just now'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`

  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Shortens a filesystem path for clean display, replacing home directory with '~'
 */
export function formatPath(path?: string): string {
  if (!path || path.trim() === '') return ''
  return path.replace(/^\/Users\/[^/]+/, '~')
}

/**
 * Generates an inspiring greeting based on the time of day.
 */
export function getGreeting(username?: string | null): { greeting: string; userLabel: string } {
  const hour = new Date().getHours()
  let greeting = 'Good morning'
  if (hour >= 12 && hour < 17) {
    greeting = 'Good afternoon'
  } else if (hour >= 17 || hour < 4) {
    greeting = 'Good evening'
  }

  const userLabel = username && username.trim() !== '' ? username : 'Developer'
  return { greeting, userLabel }
}
