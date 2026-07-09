import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, Music2, Pause, Play, SkipBack, SkipForward, Video } from 'lucide-react'
import { useBrowserMediaStore } from '../../store/useBrowserMediaStore'
import { invoke } from '../../utils/tauri'
import type { BrowserMediaSession } from '../../types'

interface Props {
  isCollapsed?: boolean
  onExpand?: () => void
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  return reduced
}

function preferRepresentativeSession(
  current: BrowserMediaSession | undefined,
  candidate: BrowserMediaSession
): BrowserMediaSession {
  if (!current) return candidate
  if (candidate.isPlaying !== current.isPlaying) {
    return candidate.isPlaying ? candidate : current
  }
  return candidate.lastActiveAt > current.lastActiveAt ? candidate : current
}

function collapseSessionsByBrowserTab(sessions: BrowserMediaSession[]): BrowserMediaSession[] {
  const byTab = new Map<string, BrowserMediaSession>()

  sessions.forEach((session) => {
    byTab.set(session.browserTabId, preferRepresentativeSession(byTab.get(session.browserTabId), session))
  })

  return Array.from(byTab.values()).sort((a, b) => b.lastActiveAt - a.lastActiveAt)
}

function isYouTubeSession(session: BrowserMediaSession): boolean {
  try {
    const host = new URL(session.pageUrl).hostname.toLowerCase()
    return host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be'
  } catch {
    return session.pageUrl.includes('youtube.com') || session.pageUrl.includes('youtu.be')
  }
}

export function MediaWidget({ isCollapsed = false, onExpand }: Props) {
  const sessions = useBrowserMediaStore(s => s.sessions)
  const reducedMotion = usePrefersReducedMotion()

  const sorted = useMemo(
    () => collapseSessionsByBrowserTab(Object.values(sessions)),
    [sessions]
  )

  const [visibleId, setVisibleId] = useState<string | null>(sorted[0]?.id ?? null)
  const knownIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const currentIds = new Set(sorted.map(s => s.id))
    const latest = sorted[0]?.id ?? null
    const isNewSession = latest !== null && !knownIdsRef.current.has(latest)
    const visibleIsGone = visibleId !== null && !currentIds.has(visibleId)

    if (isNewSession || visibleIsGone) {
      setVisibleId(latest)
    }

    knownIdsRef.current = currentIds
  }, [sorted, visibleId])

  if (sorted.length === 0 || visibleId === null) return null

  const index = Math.max(0, sorted.findIndex(s => s.id === visibleId))
  const current = sorted[index] ?? sorted[0]

  if (isCollapsed) {
    const isPlaying = current.isPlaying
    const Icon = current.mediaType === 'video' ? Video : Music2
    const label = isPlaying
      ? `Playing: ${current.mediaTitle || current.pageTitle || current.pageUrl}`
      : `Paused: ${current.mediaTitle || current.pageTitle || current.pageUrl}`

    return (
      <div style={{ padding: '4px 0', flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
        <button
          onClick={onExpand}
          title={label}
          aria-label={label}
          style={{
            position: 'relative',
            width: 34,
            height: 34,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            border: 'none',
            borderRadius: 9,
            cursor: 'pointer',
            color: isPlaying ? 'var(--accent)' : 'var(--text-dim)',
            transition: 'background 0.15s ease, color 0.15s ease',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'var(--bg-item-active)'
            e.currentTarget.style.color = 'var(--text-active)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = isPlaying ? 'var(--accent)' : 'var(--text-dim)'
          }}
        >
          <Icon size={16} />
          {isPlaying ? (
            reducedMotion ? (
              <span style={dotStyle('#e8a045')} />
            ) : (
              <motion.span
                animate={{ opacity: [0.4, 1, 0.4], scale: [0.85, 1.1, 0.85] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                style={dotStyle('var(--accent)')}
              />
            )
          ) : (
            <span style={dotStyle('var(--text-dim)')} />
          )}
        </button>
      </div>
    )
  }

  const hasMultiple = sorted.length > 1

  const goTo = (delta: number) => {
    const next = (index + delta + sorted.length) % sorted.length
    setVisibleId(sorted[next].id)
  }

  const control = (action: 'play' | 'pause' | 'previoustrack' | 'nexttrack') => {
    const [browserTabId, mediaId] = current.id.split(':')
    invoke('browser_media_control', { id: browserTabId, mediaId, action }).catch(() => {})
  }

  const subtitle = current.pageTitle && current.pageTitle !== current.mediaTitle
    ? `${current.workspaceName} - ${current.pageTitle}`
    : current.workspaceName
  const hasYouTubeFallbackControls = isYouTubeSession(current)
  const showPrevTrack = current.canPrev || hasYouTubeFallbackControls
  const showNextTrack = current.canNext || hasYouTubeFallbackControls

  return (
    <div style={{ padding: '8px 10px', flexShrink: 0 }}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        background: 'linear-gradient(180deg, color-mix(in srgb, var(--accent) 7%, var(--bg-item)) 0%, var(--bg-item) 65%)',
        border: '1px solid var(--border-inactive)',
        borderRadius: 14,
        padding: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, overflow: 'hidden' }}>
            {current.isPlaying && !reducedMotion ? (
              <motion.span
                animate={{ opacity: [0.35, 1, 0.35] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }}
              />
            ) : (
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  background: current.isPlaying ? 'var(--accent)' : 'var(--text-dim)',
                  flexShrink: 0,
                }}
              />
            )}
            <span style={{
              fontSize: 10,
              letterSpacing: 1.2,
              color: 'var(--text-dim)',
              fontWeight: 600,
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {current.isPlaying ? 'Now Playing' : 'Paused'}
            </span>
          </div>
          <span style={{
            fontSize: 10,
            color: 'var(--text-dim)',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
            overflow: 'hidden',
            maxWidth: 100,
            flexShrink: 0,
            marginLeft: 6,
          }}>
            {current.pageTitle || current.pageUrl}
          </span>
        </div>

        <div style={{ position: 'relative', height: 68, overflow: 'hidden' }}>
          <AnimatePresence initial={false}>
            <motion.div
              key={current.id}
              initial={reducedMotion ? false : { opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reducedMotion ? { opacity: 0 } : { opacity: 0, x: -16 }}
              transition={{ duration: reducedMotion ? 0.01 : 0.2 }}
              style={{ display: 'flex', alignItems: 'flex-start', gap: 10, position: 'absolute', inset: 0 }}
            >
              {current.thumbnailUrl ? (
                <img
                  src={current.thumbnailUrl}
                  alt=""
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 10,
                    objectFit: 'cover',
                    flexShrink: 0,
                    border: '1px solid var(--border-inactive)',
                  }}
                  onError={(e) => { e.currentTarget.style.display = 'none' }}
                />
              ) : (
                <div style={{
                  width: 48,
                  height: 48,
                  borderRadius: 10,
                  background: 'var(--bg-main)',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px solid var(--border-inactive)',
                }}>
                  {current.mediaType === 'video'
                    ? <Video size={18} color="var(--text-dim)" />
                    : <Music2 size={18} color="var(--text-dim)" />}
                </div>
              )}
              <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                <div style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--text-active)',
                  lineHeight: '15px',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}>
                  {current.mediaTitle || current.pageTitle || current.pageUrl}
                </div>
                <div style={{
                  fontSize: 11,
                  color: 'var(--text-dim)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  marginTop: 3,
                }}>
                  {subtitle}
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <AnimatePresence>
            {showPrevTrack && (
              <motion.button
                key="skip-back"
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 26 }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.18 }}
                onClick={() => control('previoustrack')}
                aria-label="Previous track"
                style={ghostBtnStyle}
                onMouseEnter={ghostHoverIn}
                onMouseLeave={ghostHoverOut}
              >
                <SkipBack size={14} />
              </motion.button>
            )}
          </AnimatePresence>

          <button
            onClick={() => control(current.isPlaying ? 'pause' : 'play')}
            aria-label={current.isPlaying ? 'Pause' : 'Play'}
            style={playBtnStyle}
            onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.06)' }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
          >
            {current.isPlaying
              ? <Pause size={16} fill="var(--bg-sidebar)" />
              : <Play size={16} fill="var(--bg-sidebar)" style={{ marginLeft: 1 }} />}
          </button>

          <AnimatePresence>
            {showNextTrack && (
              <motion.button
                key="skip-fwd"
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 26 }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.18 }}
                onClick={() => control('nexttrack')}
                aria-label="Next track"
                style={ghostBtnStyle}
                onMouseEnter={ghostHoverIn}
                onMouseLeave={ghostHoverOut}
              >
                <SkipForward size={14} />
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        {hasMultiple && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
            <button
              onClick={() => goTo(-1)}
              aria-label="Previous media source"
              style={switcherBtnStyle}
              onMouseEnter={ghostHoverIn}
              onMouseLeave={ghostHoverOut}
            >
              <ChevronLeft size={12} />
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, justifyContent: 'center' }}>
              {sorted.map((s, i) => (
                <button
                  key={s.id}
                  onClick={() => setVisibleId(s.id)}
                  aria-label={`Switch to ${s.mediaTitle || s.pageTitle || 'media source'}`}
                  title={s.mediaTitle || s.pageTitle || s.pageUrl}
                  style={{
                    width: i === index ? 14 : 5,
                    height: 5,
                    borderRadius: 3,
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                    transition: 'width 0.2s ease, background 0.2s ease',
                    background: i === index
                      ? (s.isPlaying ? 'var(--accent)' : 'var(--text-inactive)')
                      : 'var(--border-inactive)',
                    flexShrink: 0,
                  }}
                />
              ))}
            </div>

            <button
              onClick={() => goTo(1)}
              aria-label="Next media source"
              style={switcherBtnStyle}
              onMouseEnter={ghostHoverIn}
              onMouseLeave={ghostHoverOut}
            >
              <ChevronRight size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function dotStyle(color: string): CSSProperties {
  return {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: color,
    boxShadow: '0 0 0 1.5px var(--bg-sidebar)',
  }
}

const ghostBtnStyle: CSSProperties = {
  width: 26,
  height: 26,
  background: 'transparent',
  border: 'none',
  borderRadius: 7,
  color: 'var(--text-dim)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  transition: 'background 0.15s ease, color 0.15s ease',
  overflow: 'hidden',
}

const switcherBtnStyle: CSSProperties = {
  width: 22,
  height: 22,
  background: 'transparent',
  border: 'none',
  borderRadius: 6,
  color: 'var(--text-dim)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  transition: 'background 0.15s ease, color 0.15s ease',
}

function ghostHoverIn(e: MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.background = 'var(--bg-item-active)'
  e.currentTarget.style.color = 'var(--text-active)'
}

function ghostHoverOut(e: MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.background = 'transparent'
  e.currentTarget.style.color = 'var(--text-dim)'
}

const playBtnStyle: CSSProperties = {
  width: 34,
  height: 34,
  background: 'var(--accent)',
  border: 'none',
  borderRadius: '50%',
  color: 'var(--bg-sidebar)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  boxShadow: '0 2px 10px -2px color-mix(in srgb, var(--accent) 60%, transparent)',
  transition: 'transform 0.15s ease',
}
