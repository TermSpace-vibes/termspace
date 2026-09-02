import { LayoutDirection } from '../types'

export interface TileStep {
  targetIndex: number | null
  direction: LayoutDirection
}

export interface RebalanceStep {
  pairIndices: [number, number]
  sizes: [number, number]
}

export interface TilePlan {
  steps: TileStep[]
  rebalances: RebalanceStep[]
}

const EMPTY_PLAN: TilePlan = { steps: [], rebalances: [] }
const ROW_REBALANCE: RebalanceStep = { pairIndices: [0, 1], sizes: [33.33, 66.67] }

/**
 * Maps a slot count to the deterministic pane-creation plan that produces an
 * even row/grid, given that addToExistingSplitOrWrap (layout.ts) only ever
 * wraps a single targeted leaf into a fresh [50,50] split — it never appends
 * a third sibling to a flat split. Column-building steps must therefore
 * target the anchor pane of that column (not "whichever pane was created
 * last"), and 3+-column rows need an explicit rebalance since the default
 * 50/50 wrap alone produces uneven nesting (50/25/25, not 33/33/33).
 */
export function tileSlots(n: number): TilePlan {
  const clamped = Math.max(0, Math.min(6, Math.floor(n)))
  switch (clamped) {
    case 0:
    case 1:
      return EMPTY_PLAN
    case 2:
      return { steps: [{ targetIndex: 0, direction: 'horizontal' }], rebalances: [] }
    case 3:
      return {
        steps: [
          { targetIndex: 0, direction: 'horizontal' },
          { targetIndex: 1, direction: 'horizontal' },
        ],
        rebalances: [ROW_REBALANCE],
      }
    case 4:
      return {
        steps: [
          { targetIndex: 0, direction: 'horizontal' },
          { targetIndex: 0, direction: 'vertical' },
          { targetIndex: 1, direction: 'vertical' },
        ],
        rebalances: [],
      }
    case 5:
      return {
        steps: [
          { targetIndex: 0, direction: 'horizontal' },
          { targetIndex: 1, direction: 'horizontal' },
          { targetIndex: 0, direction: 'vertical' },
          { targetIndex: 1, direction: 'vertical' },
        ],
        rebalances: [ROW_REBALANCE],
      }
    default: // 6
      return {
        steps: [
          { targetIndex: 0, direction: 'horizontal' },
          { targetIndex: 1, direction: 'horizontal' },
          { targetIndex: 0, direction: 'vertical' },
          { targetIndex: 1, direction: 'vertical' },
          { targetIndex: 2, direction: 'vertical' },
        ],
        rebalances: [ROW_REBALANCE],
      }
  }
}
