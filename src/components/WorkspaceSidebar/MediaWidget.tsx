import { useEffect, useMemo, useRef, useState, CSSProperties } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { useBrowserMediaStore } from '../../store/useBrowserMediaStore'
import { invoke } from '../../utils/tauri'

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

export function MediaWidget() {
  const sessions = useBrowserMediaStore(s => s.sessions)
  const reducedMotion = usePrefersReducedMotion()

  const sorted = useMemo(
    () => Object.values(sessions).sort((a, b) => b.lastActiveAt - a.lastActiveAt),
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

  const goTo = (delta: number) => {
    const next = (index + delta + sorted.length) % sorted.length
    setVisibleId(sorted[next].id)
  }

  const control = (action: 'play' | 'pause' | 'previoustrack' | 'nexttrack') => {
    const [browserTabId, mediaId] = current.id.split(':')
    invoke('browser_media_control', { id: browserTabId, mediaId, action }).catch(() => {})
  }

  return (
    <div style={{ padding: '8px 10px', flexShrink: 0 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-item-active)',
        borderRadius: 10, padding: 8, position: 'relative',
      }}>
        {sorted.length > 1 && (
          <button onClick={() => goTo(-1)} aria-label="Previous session" style={navBtnStyle}>
            <ChevronLeft size={14} />
          </button>
        )}

        <div style={{ flex: 1, minWidth: 0, position: 'relative', height: 36, overflow: 'hidden' }}>
          <AnimatePresence initial={false}>
            <motion.div
              key={current.id}
              initial={reducedMotion ? false : { opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reducedMotion ? { opacity: 0 } : { opacity: 0, x: -16 }}
              transition={{ duration: reducedMotion ? 0.01 : 0.18 }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'absolute', inset: 0 }}
            >
              {current.thumbnailUrl ? (
                <img
                  src={current.thumbnailUrl}
                  alt=""
                  style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }}
                  onError={(e) => { e.currentTarget.style.display = 'none' }}
                />
              ) : (
                <div style={{ width: 32, height: 32, borderRadius: 6, background: 'var(--bg-main)', flexShrink: 0 }} />
              )}
              <div style={{ minWidth: 0, overflow: 'hidden' }}>
                <div style={{ fontSize: 12, color: 'var(--text-active)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {current.mediaTitle || current.pageTitle || current.pageUrl}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {current.workspaceName}
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {current.canPrev && (
          <button onClick={() => control('previoustrack')} aria-label="Previous track" style={navBtnStyle}>
            <SkipBack size={14} />
          </button>
        )}
        <button
          onClick={() => control(current.isPlaying ? 'pause' : 'play')}
          aria-label={current.isPlaying ? 'Pause' : 'Play'}
          style={navBtnStyle}
        >
          {current.isPlaying ? <Pause size={14} /> : <Play size={14} />}
        </button>
        {current.canNext && (
          <button onClick={() => control('nexttrack')} aria-label="Next track" style={navBtnStyle}>
            <SkipForward size={14} />
          </button>
        )}

        {sorted.length > 1 && (
          <button onClick={() => goTo(1)} aria-label="Next session" style={navBtnStyle}>
            <ChevronRight size={14} />
          </button>
        )}
      </div>
    </div>
  )
}

const navBtnStyle: CSSProperties = {
  width: 24, height: 24, background: 'transparent', border: 'none', borderRadius: 6,
  color: 'var(--text-dim)', cursor: 'pointer', display: 'flex', alignItems: 'center',
  justifyContent: 'center', flexShrink: 0,
}
