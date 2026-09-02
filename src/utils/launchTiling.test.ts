import { describe, it, expect } from 'vitest'
import { tileSlots } from './launchTiling'

describe('tileSlots', () => {
  it('n=0 and n=1 produce no steps and no rebalances', () => {
    expect(tileSlots(0)).toEqual({ steps: [], rebalances: [] })
    expect(tileSlots(1)).toEqual({ steps: [], rebalances: [] })
  })

  it('n=2 is a single horizontal split targeting slot 0, no rebalance', () => {
    expect(tileSlots(2)).toEqual({
      steps: [{ targetIndex: 0, direction: 'horizontal' }],
      rebalances: [],
    })
  })

  it('n=3 builds a row (0<-1, 1<-2) and rebalances the outer split to even thirds', () => {
    expect(tileSlots(3)).toEqual({
      steps: [
        { targetIndex: 0, direction: 'horizontal' },
        { targetIndex: 1, direction: 'horizontal' },
      ],
      rebalances: [{ pairIndices: [0, 1], sizes: [33.33, 66.67] }],
    })
  })

  it('n=4 builds a 2x2 grid by targeting column anchors 0 and 1, no rebalance needed', () => {
    expect(tileSlots(4)).toEqual({
      steps: [
        { targetIndex: 0, direction: 'horizontal' },
        { targetIndex: 0, direction: 'vertical' },
        { targetIndex: 1, direction: 'vertical' },
      ],
      rebalances: [],
    })
  })

  it('n=5 builds three columns (2+2+1) and rebalances the row split', () => {
    expect(tileSlots(5)).toEqual({
      steps: [
        { targetIndex: 0, direction: 'horizontal' },
        { targetIndex: 1, direction: 'horizontal' },
        { targetIndex: 0, direction: 'vertical' },
        { targetIndex: 1, direction: 'vertical' },
      ],
      rebalances: [{ pairIndices: [0, 1], sizes: [33.33, 66.67] }],
    })
  })

  it('n=6 builds a 3x2 grid and rebalances the row split', () => {
    expect(tileSlots(6)).toEqual({
      steps: [
        { targetIndex: 0, direction: 'horizontal' },
        { targetIndex: 1, direction: 'horizontal' },
        { targetIndex: 0, direction: 'vertical' },
        { targetIndex: 1, direction: 'vertical' },
        { targetIndex: 2, direction: 'vertical' },
      ],
      rebalances: [{ pairIndices: [0, 1], sizes: [33.33, 66.67] }],
    })
  })

  it('clamps any n above 6 down to the n=6 plan', () => {
    expect(tileSlots(9)).toEqual(tileSlots(6))
  })
})
