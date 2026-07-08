/**
 * Pure geometry for the coachmark card: viewport-clamped top/left placement
 * (no CSS transforms — framer-motion's `animate` owns `transform`).
 */
export interface TargetRect {
  top: number
  left: number
  width: number
  height: number
}

export interface CardPlacement {
  top: number
  left: number
  below: boolean
  arrowLeft: number
  width: number
}

const GAP = 14
const MARGIN = 12
const MAX_W = 330

export function computeCoachmarkLayout(
  rect: TargetRect | null,
  vw: number,
  vh: number,
  cardH: number,
): CardPlacement {
  const width = Math.min(MAX_W, vw - MARGIN * 2)
  if (!rect) {
    return { top: MARGIN, left: MARGIN, below: true, arrowLeft: width / 2, width }
  }
  const cx = rect.left + rect.width / 2
  const fitsBelow = rect.top + rect.height + GAP + cardH + MARGIN <= vh
  const fitsAbove = rect.top - GAP - cardH >= MARGIN
  const below = fitsBelow || !fitsAbove
  let top = below ? rect.top + rect.height + GAP : rect.top - GAP - cardH
  top = Math.min(Math.max(MARGIN, top), Math.max(MARGIN, vh - cardH - MARGIN))
  const left = Math.min(Math.max(MARGIN, cx - width / 2), Math.max(MARGIN, vw - width - MARGIN))
  const arrowLeft = Math.min(Math.max(18, cx - left - 7), width - 18)
  return { top, left, below, arrowLeft, width }
}
