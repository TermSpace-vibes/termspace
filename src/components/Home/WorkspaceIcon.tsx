import type React from 'react'
import * as LucideIcons from 'lucide-react'

interface WorkspaceIconProps {
  emoji?: string
  color?: string
  size?: number
  className?: string
  style?: React.CSSProperties
}

/**
 * Renders workspace icon, correctly handling:
 * 1. Lucide icon names stored as string (e.g. 'TerminalSquare', 'Server', 'Rocket', 'Laptop')
 * 2. Unicode emoji characters (e.g. '💻', '🚀')
 * 3. Empty/undefined fallback to TerminalSquare
 */
export function WorkspaceIcon({
  emoji,
  color,
  size = 20,
  className,
  style,
}: WorkspaceIconProps) {
  if (!emoji || emoji.trim() === '') {
    return (
      <LucideIcons.TerminalSquare
        size={size}
        strokeWidth={2}
        className={className}
        style={{ color: color || 'currentColor', ...style }}
      />
    )
  }

  // Check if string matches any Lucide icon component name
  const LucideLookup = LucideIcons as unknown as Record<
    string,
    React.ComponentType<{ size?: number; strokeWidth?: number; className?: string; style?: React.CSSProperties }>
  >
  const hasIcon = Object.prototype.hasOwnProperty.call(LucideIcons, emoji)
  const IconComp = hasIcon ? LucideLookup[emoji] : undefined

  if (IconComp && (typeof IconComp === 'function' || typeof IconComp === 'object')) {
    return (
      <IconComp
        size={size}
        strokeWidth={2}
        className={className}
        style={{ color: color || 'currentColor', ...style }}
      />
    )
  }

  // Otherwise render unicode emoji or text character
  return (
    <span
      className={className}
      style={{
        fontSize: size,
        lineHeight: 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        userSelect: 'none',
        ...style,
      }}
    >
      {emoji}
    </span>
  )
}
