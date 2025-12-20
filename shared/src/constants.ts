// Card render dimensions - single source of truth
export const CARD_WIDTH = 825
export const CARD_HEIGHT = 1125
export const CARD_ASPECT = CARD_WIDTH / CARD_HEIGHT // ~0.7333

// Print geometry at 300 DPI (1/8" = 37.5px)
export const TRIM_INSET_PX = 37.5
export const SAFE_INSET_PX = 75

export const TRIM_BOX = { x: 37.5, y: 37.5, w: 750, h: 1050 }
export const SAFE_BOX = { x: 75, y: 75, w: 675, h: 975 }

// Percentages for responsive overlay
export const GUIDE_PERCENTAGES = {
  trim: { left: 4.545, top: 3.333, right: 4.545, bottom: 3.333 },
  safe: { left: 9.091, top: 6.667, right: 9.091, bottom: 6.667 },
}
