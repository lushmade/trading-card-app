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

// USQC26 Design System Colors
export const USQC26_COLORS = {
  primary: '#1b4278',
  secondary: '#c8d7e9',
  white: '#ffffff',
  numberOverlay: 'rgba(255, 255, 255, 0.67)',
}

// USQC26 Design System Layout (from Figma measurements)
export const USQC26_LAYOUT = {
  // Name section - angled boxes
  name: {
    rotation: -6, // degrees
    firstNameBox: {
      width: 1000,
      height: 46,
      borderWidth: 3,
      strokeWidth: 8,
    },
    lastNameBox: {
      width: 1000,
      height: 80,
      borderWidth: 3,
      strokeWidth: 8,
    },
    // Anchor point for name section (right edge of last name)
    anchorX: 754,
    anchorY: 844,
    // Font sizes
    firstNameSize: 43,
    lastNameSize: 60,
    letterSpacing: {
      firstName: 4.3,
      lastName: 6,
    },
    // Text padding and positioning
    leftPadding: 8,
    rightPadding: 8,
    boxExtension: 100, // Extra width to extend boxes past frame edge
    textYOffset: 2, // Offset to lower text baseline
  },
  // Event indicator badge
  eventBadge: {
    x: 679,
    y: 64,
    width: 76,
    height: 20,
    borderRadius: 6,
    borderWidth: 2,
    fontSize: 17,
    textYOffset: 1,
  },
  // Position and number (top-right)
  positionNumber: {
    centerX: 698,
    topY: 111,
    positionFontSize: 24,
    numberFontSize: 85,
    positionLetterSpacing: 1.92,
    numberLetterSpacing: -1.68,
    positionStrokeWidth: 5,
    numberStrokeWidth: 8,
    numberXOffset: -2,
  },
  // Team logo
  teamLogo: {
    x: 75,
    y: 64,
    maxWidth: 101,
    maxHeight: 100,
  },
  // Bottom bar
  bottomBar: {
    y: 1036,
    height: 26,
    textYOffset: 14,
    cameraIcon: { x: 74, y: 1040, width: 22, height: 15 },
    photographerX: 107,
    rarityX: 403,
    raritySize: 20,
    teamNameX: 750, // right-aligned
    fontSize: 20,
    letterSpacing: {
      photographer: 0.8,
      teamName: 0.6,
    },
  },
  // Rare card title/caption
  rareCard: {
    titleAnchorX: 300,
    titleAnchorY: 810,
    captionAnchorX: 427,
    captionAnchorY: 869,
    titleFontSize: 60,
    captionFontSize: 43,
    rotation: -6,
  },
  // Super rare centered name
  superRare: {
    centerX: CARD_WIDTH / 2,
    firstNameY: 853,
    lastNameY: 914,
    firstNameSize: 56,
    lastNameSize: 81,
  },
  // National team (uncommon) - name at top
  nationalTeam: {
    nameY: 53,
    nameFontSize: 49,
    logoX: 80,
    logoY: 62,
    logoMaxHeight: 100,
  },
}
