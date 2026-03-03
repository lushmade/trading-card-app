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

// USQC26 Design System Layout (from Figma measurements)
export const USQC26_LAYOUT_V1 = {
  kind: 'usqc26-v1',
  palette: {
    primary: '#1b4278',
    secondary: '#c8d7e9',
    white: '#ffffff',
    numberOverlay: 'rgba(255, 255, 255, 0.67)',
  },
  typography: {
    fontFamily: '"Amifer", "Avenir Next", "Helvetica Neue", sans-serif',
  },
  frame: {
    outerRadius: 0,
    innerX: 56,
    innerY: 91,
    innerWidth: 713,
    innerHeight: 937,
    innerRadius: 29,
  },
  name: {
    rotation: -6, // degrees
    maxWidth: 550,
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
    anchorX: 754,
    anchorY: 844,
    firstNameSize: 43,
    lastNameSize: 60,
    letterSpacing: {
      firstName: 4.3,
      lastName: 6,
    },
    leftPadding: 8,
    rightPadding: 8,
    boxExtension: 100,
    textYOffset: 2,
    boxOffsets: {
      firstName: 8,
      lastName: 3,
    },
    textOffsets: {
      firstName: 12,
      lastName: 10,
    },
  },
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
  teamLogo: {
    x: 75,
    y: 64,
    maxWidth: 101,
    maxHeight: 100,
    strokeWidth: 1,
    strokeColor: '#ffffff',
  },
  bottomBar: {
    y: 1036,
    height: 26,
    textYOffset: 14,
    cameraIcon: { x: 74, y: 1040, width: 22, height: 15 },
    photographerX: 107,
    rarityX: 403,
    raritySize: 20,
    rarityGap: 4,
    teamNameX: 750,
    fontSize: 20,
    letterSpacing: {
      photographer: 0.8,
      teamName: 0.6,
    },
  },
  rareCard: {
    rotation: -6,
    anchorX: 754,
    anchorY: 794,
    maxWidth: 678,
    titleTextOffsetX: 10,
    captionTextOffsetX: 12,
    titleLetterSpacing: 0,
    captionLetterSpacing: 0,
  },
  superRare: {
    centerX: CARD_WIDTH / 2,
    firstNameY: 885,
    lastNameY: 954,
    firstNameSize: 40,
    lastNameSize: 83,
    firstNameFontFamily: '"Amifer", sans-serif',
    lastNameFontFamily: '"Cinema Script", cursive',
    firstNameStrokeWidth: 8,
    lastNameStrokeWidth: 10,
    nameGap: 6,
    bottomBarOffset: 94,
  },
  nationalTeam: {
    rotation: -6,
    anchorX: 180,
    anchorY: 78,
    boxWidth: 500,
    boxHeight: 50,
    boxBorderWidth: 3,
    textPaddingX: 16,
    nameFontSize: 49,
    logo: {
      x: 75,
      y: 64,
      maxWidth: 101,
      maxHeight: 100,
    },
  },
} as const

// QC National Championships 2026 Layout
export const QCN26_LAYOUT_V1: import('./types').Usqc26LayoutV1 = {
  kind: 'usqc26-v1',
  palette: {
    primary: '#1f1f1f',
    secondary: '#8a1f2f',
    white: '#ffffff',
    numberOverlay: 'rgba(255, 255, 255, 0.67)',
  },
  typography: {
    fontFamily: '"Amifer", "Avenir Next", "Helvetica Neue", sans-serif',
  },
  frame: {
    outerRadius: 0,
    innerX: 56,
    innerY: 91,
    innerWidth: 713,
    innerHeight: 937,
    innerRadius: 0,
  },
  name: {
    rotation: -6,
    maxWidth: 550,
    firstNameBox: { width: 1000, height: 46, borderWidth: 3, strokeWidth: 8 },
    lastNameBox: { width: 1000, height: 80, borderWidth: 3, strokeWidth: 8 },
    anchorX: 754,
    anchorY: 844,
    firstNameSize: 43,
    lastNameSize: 60,
    letterSpacing: { firstName: 4.3, lastName: 6 },
    leftPadding: 8,
    rightPadding: 8,
    boxExtension: 100,
    textYOffset: 2,
    boxOffsets: { firstName: 8, lastName: 3 },
    textOffsets: { firstName: 12, lastName: 10 },
  },
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
  teamLogo: {
    x: 75,
    y: 64,
    maxWidth: 101,
    maxHeight: 100,
    strokeWidth: 1,
    strokeColor: '#ffffff',
  },
  bottomBar: {
    y: 1036,
    height: 26,
    textYOffset: 14,
    cameraIcon: { x: 74, y: 1040, width: 22, height: 15 },
    photographerX: 107,
    rarityX: 403,
    raritySize: 20,
    rarityGap: 4,
    teamNameX: 750,
    fontSize: 20,
    letterSpacing: { photographer: 0.8, teamName: 0.6 },
  },
  rareCard: {
    rotation: -6,
    anchorX: 754,
    anchorY: 794,
    maxWidth: 678,
    titleTextOffsetX: 10,
    captionTextOffsetX: 12,
    titleLetterSpacing: 0,
    captionLetterSpacing: 0,
  },
  superRare: {
    centerX: CARD_WIDTH / 2,
    firstNameY: 853,
    lastNameY: 914,
    firstNameSize: 56,
    lastNameSize: 81,
    firstNameFontFamily: '"Amifer", sans-serif',
    lastNameFontFamily: '"Cinema Script", cursive',
    firstNameStrokeWidth: 3,
    lastNameStrokeWidth: 4,
    nameGap: 6,
    bottomBarOffset: 46,
  },
  nationalTeam: {
    rotation: -6,
    anchorX: 180,
    anchorY: 78,
    boxWidth: 500,
    boxHeight: 50,
    boxBorderWidth: 3,
    textPaddingX: 16,
    nameFontSize: 49,
    logo: { x: 75, y: 64, maxWidth: 101, maxHeight: 100 },
  },
  headerBar: {
    height: 92,
    color: '#a81f1f',
    fontSize: 48,
    fontStyle: '700',
    textColor: '#ffffff',
    textY: 50,
    paddingX: 80,
    notchSize: 34,
  },
  footerBar: {
    y: 998,
    height: 127,
    color: '#a81f1f',
    fontSize: 52,
    fontStyle: '700',
    textColor: '#ffffff',
    textY: 62,
    paddingX: 80,
    notchSize: 36,
  },
  positionStripes: {
    style: 'diagonal' as const,
    stripeWidth: 18,
    stripeGap: 4,
    inset: 38,
    topY: 998,
    colors: ['#ffffff', '#000000', '#00a651', '#ffd700'],
    mapping: [
      { position: 'Chaser', color: '#ffffff' },
      { position: 'Keeper', color: '#00a651' },
      { position: 'Beater', color: '#000000' },
      { position: 'Seeker', color: '#ffd700' },
    ],
  },
  photographerCredit: {
    x: 34,
    y: 984,
    fontSize: 20,
    fontStyle: '400',
    color: 'rgba(229, 229, 229, 0.9)',
    textAlign: 'left' as const,
  },
  cardBorder: {
    width: 4,
    color: '#000000',
  },
}
