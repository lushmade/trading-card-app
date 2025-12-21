// Card render dimensions - single source of truth
export const CARD_WIDTH = 825
export const CARD_HEIGHT = 1125
export const CARD_ASPECT = CARD_WIDTH / CARD_HEIGHT // ~0.7333

// Print geometry at 300 DPI (1/8" = 37.5px)
export const TRIM_INSET_PX = 37.5
export const SAFE_INSET_PX = 75

// Derive boxes from insets (no magic number duplication)
export const TRIM_BOX = {
  x: TRIM_INSET_PX,
  y: TRIM_INSET_PX,
  w: CARD_WIDTH - 2 * TRIM_INSET_PX,
  h: CARD_HEIGHT - 2 * TRIM_INSET_PX,
}

export const SAFE_BOX = {
  x: SAFE_INSET_PX,
  y: SAFE_INSET_PX,
  w: CARD_WIDTH - 2 * SAFE_INSET_PX,
  h: CARD_HEIGHT - 2 * SAFE_INSET_PX,
}

export const TRIM_WIDTH = TRIM_BOX.w
export const TRIM_HEIGHT = TRIM_BOX.h
export const TRIM_ASPECT = TRIM_WIDTH / TRIM_HEIGHT // ~0.7143

// Helper to convert box to inset percentages relative to a container
const toGuidePercent = (value: number, total: number) =>
  Math.round(((value / total) * 100 + Number.EPSILON) * 1000) / 1000

const boxToInsetPercents = (
  box: { x: number; y: number; w: number; h: number },
  containerW: number,
  containerH: number
) => ({
  left: toGuidePercent(box.x, containerW),
  top: toGuidePercent(box.y, containerH),
  right: toGuidePercent(containerW - (box.x + box.w), containerW),
  bottom: toGuidePercent(containerH - (box.y + box.h), containerH),
})

// Percentages for responsive overlay guides (derived, not magic numbers)
export const GUIDE_PERCENTAGES = {
  // Trim box as percentage of full bleed card
  trim: boxToInsetPercents(TRIM_BOX, CARD_WIDTH, CARD_HEIGHT),
  // Safe box as percentage of full bleed card
  safe: boxToInsetPercents(SAFE_BOX, CARD_WIDTH, CARD_HEIGHT),
  // Safe box as percentage of trim box (for trim-basis containers)
  safeWithinTrim: boxToInsetPercents(
    {
      x: SAFE_BOX.x - TRIM_BOX.x,
      y: SAFE_BOX.y - TRIM_BOX.y,
      w: SAFE_BOX.w,
      h: SAFE_BOX.h,
    },
    TRIM_BOX.w,
    TRIM_BOX.h
  ),
}
