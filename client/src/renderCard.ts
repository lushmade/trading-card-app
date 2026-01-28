import {
  CARD_HEIGHT,
  CARD_WIDTH,
  TRIM_BOX,
  USQC26_COLORS,
  USQC26_LAYOUT,
  findTemplate,
  resolveTemplateId,
  type Card,
  type CropRect,
  type RenderMeta,
  type TemplateDefinition,
  type TemplateFlags,
  type TemplateTheme,
  type TournamentConfig,
} from 'shared'

// Camera icon for bottom bar
import cameraIconUrl from './assets/icons/camera.png'

// Font family for USQC26 design
const FONT_AMIFER = '"Amifer", "Avenir Next", "Helvetica Neue", sans-serif'

// Frame dimensions from Figma (node 6:44 SVG path)
const FRAME = {
  outerRadius: 0, // Full bleed, no outer radius
  innerX: 56,
  innerY: 91,
  innerWidth: 713,
  innerHeight: 937,
  innerRadius: 29,
}

const BASE_THEME: TemplateTheme = {
  gradientStart: 'rgba(15, 23, 42, 0)',
  gradientEnd: 'rgba(15, 23, 42, 0.85)',
  border: 'rgba(255, 255, 255, 0.1)',
  accent: 'rgba(255, 255, 255, 0.5)',
  label: '#ffffff',
  nameColor: '#ffffff',
  meta: '#ffffff',
  watermark: 'rgba(255, 255, 255, 0.12)',
}

const FALLBACK_TEMPLATES: Record<string, TemplateDefinition> = {
  usqc26: {
    id: 'usqc26',
    label: 'USQC26',
  },
  classic: {
    id: 'classic',
    label: 'Classic',
  },
}

const DEFAULT_TEMPLATE_FLAGS: TemplateFlags = {
  showGradient: false,
  showBorders: false,
  showWatermarkJersey: false,
}

export type RenderCardInput = {
  card: Card
  config: TournamentConfig
  imageUrl: string
  resolveAssetUrl: (key: string) => string
  templateId?: string
}

export const resolveTemplateSnapshot = (input: {
  card: Card
  config: TournamentConfig
  templateId?: string
}): { templateId: string; templateSnapshot: RenderMeta['templateSnapshot'] } => {
  const effectiveTemplateId = resolveTemplateId(
    { templateId: input.templateId ?? input.card.templateId, cardType: input.card.cardType },
    input.config
  )
  const template =
    findTemplate(input.config, effectiveTemplateId) ??
    FALLBACK_TEMPLATES[effectiveTemplateId] ??
    FALLBACK_TEMPLATES.usqc26

  const theme = { ...BASE_THEME, ...(template.theme ?? {}) }
  const flags = { ...DEFAULT_TEMPLATE_FLAGS, ...(template.flags ?? {}) }
  const overlayPlacement = template.overlayPlacement ?? 'belowText'

  return {
    templateId: effectiveTemplateId,
    templateSnapshot: {
      overlayKey: template.overlayKey,
      theme,
      flags,
      overlayPlacement,
    },
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = url
  })
}

async function loadImageSafe(url?: string | null) {
  if (!url) return null
  try {
    return await loadImage(url)
  } catch {
    return null
  }
}

function drawCroppedImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  crop: CropRect,
  destX: number,
  destY: number,
  destW: number,
  destH: number
) {
  const { x, y, w, h, rotateDeg } = crop

  const srcX = x * img.naturalWidth
  const srcY = y * img.naturalHeight
  const srcW = w * img.naturalWidth
  const srcH = h * img.naturalHeight

  ctx.save()

  const centerX = destX + destW / 2
  const centerY = destY + destH / 2
  ctx.translate(centerX, centerY)
  ctx.rotate((rotateDeg * Math.PI) / 180)
  ctx.translate(-centerX, -centerY)

  ctx.drawImage(img, srcX, srcY, srcW, srcH, destX, destY, destW, destH)

  ctx.restore()
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + width - radius, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius)
  ctx.lineTo(x + width, y + height - radius)
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
  ctx.lineTo(x + radius, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

function drawFrame(ctx: CanvasRenderingContext2D) {
  // Draw the frame overlay (white border with inner cutout)
  ctx.save()

  // Create the frame path (outer rectangle minus inner rounded rectangle)
  ctx.beginPath()
  // Outer rectangle (full card)
  ctx.rect(0, 0, CARD_WIDTH, CARD_HEIGHT)

  // Inner rounded rectangle (cutout) - draw counter-clockwise
  const { innerX, innerY, innerWidth, innerHeight, innerRadius } = FRAME
  ctx.moveTo(innerX + innerRadius, innerY)
  ctx.lineTo(innerX + innerWidth - innerRadius, innerY)
  ctx.quadraticCurveTo(innerX + innerWidth, innerY, innerX + innerWidth, innerY + innerRadius)
  ctx.lineTo(innerX + innerWidth, innerY + innerHeight - innerRadius)
  ctx.quadraticCurveTo(innerX + innerWidth, innerY + innerHeight, innerX + innerWidth - innerRadius, innerY + innerHeight)
  ctx.lineTo(innerX + innerRadius, innerY + innerHeight)
  ctx.quadraticCurveTo(innerX, innerY + innerHeight, innerX, innerY + innerHeight - innerRadius)
  ctx.lineTo(innerX, innerY + innerRadius)
  ctx.quadraticCurveTo(innerX, innerY, innerX + innerRadius, innerY)
  ctx.closePath()

  ctx.fillStyle = USQC26_COLORS.white
  ctx.fill('evenodd')

  ctx.restore()
}

function drawEventBadge(ctx: CanvasRenderingContext2D, text: string) {
  const { x, y, width, height, borderRadius, borderWidth, fontSize, textYOffset } = USQC26_LAYOUT.eventBadge

  ctx.save()

  // Badge background
  roundedRect(ctx, x, y, width, height, borderRadius)
  ctx.fillStyle = USQC26_COLORS.secondary
  ctx.fill()

  // Badge border
  ctx.strokeStyle = USQC26_COLORS.primary
  ctx.lineWidth = borderWidth
  ctx.stroke()

  // Badge text
  ctx.font = `700 ${fontSize}px ${FONT_AMIFER}`
  ctx.fillStyle = USQC26_COLORS.primary
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + width / 2, y + height / 2 + textYOffset)

  ctx.restore()
}

function drawPositionNumber(ctx: CanvasRenderingContext2D, position: string, number?: string) {
  const {
    centerX,
    topY,
    positionFontSize,
    numberFontSize,
    positionLetterSpacing,
    numberLetterSpacing,
    positionStrokeWidth,
    numberStrokeWidth,
    numberXOffset,
  } = USQC26_LAYOUT.positionNumber

  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.lineJoin = 'miter'
  ctx.miterLimit = 2

  // Position label - #1B4278 fill with #FFFFFF stroke
  ctx.font = `500 ${positionFontSize}px ${FONT_AMIFER}`
  ctx.letterSpacing = `${positionLetterSpacing}px`
  // Draw stroke first (underneath)
  ctx.strokeStyle = USQC26_COLORS.white
  ctx.lineWidth = positionStrokeWidth
  ctx.strokeText(position.toUpperCase(), centerX, topY)
  // Then fill
  ctx.fillStyle = USQC26_COLORS.primary
  ctx.fillText(position.toUpperCase(), centerX, topY)

  // Only draw jersey number if provided
  if (number) {
    // Calculate number Y position (below position text)
    const numberY = topY + positionFontSize

    // Jersey number - #FFFFFF 67% opaque fill with #1B4278 stroke
    ctx.font = `500 ${numberFontSize}px ${FONT_AMIFER}`
    ctx.letterSpacing = `${numberLetterSpacing}px`
    // Draw stroke first (underneath)
    ctx.strokeStyle = USQC26_COLORS.primary
    ctx.lineWidth = numberStrokeWidth
    ctx.strokeText(number, centerX + numberXOffset, numberY)
    // Then fill with white 67% opacity
    ctx.fillStyle = 'rgba(255, 255, 255, 0.67)'
    ctx.fillText(number, centerX + numberXOffset, numberY)
  }

  ctx.restore()
}

function drawLogo(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  maxWidth: number,
  maxHeight: number
) {
  const ratio = Math.min(maxWidth / img.naturalWidth, maxHeight / img.naturalHeight, 1)
  const width = img.naturalWidth * ratio
  const height = img.naturalHeight * ratio

  ctx.save()

  // Draw 1px white outside stroke by drawing the logo slightly larger in white first
  // Using an offscreen canvas to create the stroke effect
  const strokeWidth = 1
  const offscreen = document.createElement('canvas')
  offscreen.width = Math.ceil(width + strokeWidth * 2)
  offscreen.height = Math.ceil(height + strokeWidth * 2)
  const offCtx = offscreen.getContext('2d')

  if (offCtx) {
    // Draw the logo at center of offscreen canvas
    offCtx.drawImage(img, strokeWidth, strokeWidth, width, height)

    // Create white stroke by drawing the logo's silhouette
    offCtx.globalCompositeOperation = 'source-in'
    offCtx.fillStyle = USQC26_COLORS.white
    offCtx.fillRect(0, 0, offscreen.width, offscreen.height)

    // Draw the white silhouette offset in all directions to create stroke effect
    for (let dx = -strokeWidth; dx <= strokeWidth; dx++) {
      for (let dy = -strokeWidth; dy <= strokeWidth; dy++) {
        if (dx !== 0 || dy !== 0) {
          ctx.drawImage(offscreen, x - strokeWidth + dx, y - strokeWidth + dy)
        }
      }
    }
  }

  // Draw the actual logo on top
  ctx.drawImage(img, x, y, width, height)

  ctx.restore()
}

// Max width for name text before wrapping to second line
const NAME_MAX_WIDTH = 550

// Helper to wrap text into lines that fit within maxWidth
// Handles spaces, hyphens, and forces breaks on long single words
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  // First check if the entire text fits
  if (ctx.measureText(text).width <= maxWidth) {
    return [text]
  }

  // Split on spaces and hyphens, keeping the delimiter
  const parts = text.split(/(\s+|-)/);
  const lines: string[] = []
  let currentLine = ''

  for (const part of parts) {
    if (!part) continue

    const testLine = currentLine + part
    const testWidth = ctx.measureText(testLine).width

    if (testWidth > maxWidth && currentLine) {
      // Current line is full, start a new line
      lines.push(currentLine.trim())
      // If part is a hyphen, keep it with the previous line
      if (part === '-') {
        lines[lines.length - 1] += '-'
        currentLine = ''
      } else {
        currentLine = part
      }
    } else {
      currentLine = testLine
    }
  }

  if (currentLine.trim()) {
    lines.push(currentLine.trim())
  }

  // If we still have a single line that's too long (no break points), force a character break
  if (lines.length === 1 && ctx.measureText(lines[0]).width > maxWidth) {
    const longText = lines[0]
    let breakPoint = longText.length
    for (let i = 1; i < longText.length; i++) {
      if (ctx.measureText(longText.slice(0, i)).width > maxWidth) {
        breakPoint = i - 1
        break
      }
    }
    if (breakPoint > 0 && breakPoint < longText.length) {
      return [longText.slice(0, breakPoint), longText.slice(breakPoint)].slice(0, 2)
    }
  }

  // Limit to 2 lines max
  return lines.slice(0, 2)
}

function drawAngledNameBoxes(
  ctx: CanvasRenderingContext2D,
  firstName: string,
  lastName: string
) {
  const {
    rotation,
    firstNameBox,
    lastNameBox,
    firstNameSize,
    lastNameSize,
    anchorX,
    anchorY,
    letterSpacing,
    leftPadding,
    rightPadding,
    boxExtension,
    textYOffset,
  } = USQC26_LAYOUT.name
  const radians = (rotation * Math.PI) / 180

  ctx.save()

  // Measure and wrap text for last name
  ctx.font = `500 italic ${lastNameSize}px ${FONT_AMIFER}`
  ctx.letterSpacing = `${letterSpacing.lastName}px`
  const lastNameText = lastName.toUpperCase()
  const lastNameLines = wrapText(ctx, lastNameText, NAME_MAX_WIDTH)
  const lastNameMaxWidth = Math.max(...lastNameLines.map(line => ctx.measureText(line).width))
  const lnBoxWidth = lastNameMaxWidth + leftPadding + rightPadding + boxExtension
  const lnLineHeight = lastNameSize * 1.1
  const lnBoxHeight = lastNameBox.height + (lastNameLines.length - 1) * lnLineHeight

  // Measure and wrap text for first name
  ctx.font = `500 italic ${firstNameSize}px ${FONT_AMIFER}`
  ctx.letterSpacing = `${letterSpacing.firstName}px`
  const firstNameText = firstName.toUpperCase()
  const firstNameLines = wrapText(ctx, firstNameText, NAME_MAX_WIDTH)
  const firstNameMaxWidth = Math.max(...firstNameLines.map(line => ctx.measureText(line).width))
  const fnBoxWidth = firstNameMaxWidth + leftPadding + rightPadding + boxExtension
  const fnLineHeight = firstNameSize * 1.1
  const fnBoxHeight = firstNameBox.height + (firstNameLines.length - 1) * fnLineHeight

  // Position at anchor point (right edge of boxes) and rotate
  ctx.translate(anchorX, anchorY)
  ctx.rotate(radians)

  // X-offset adjustments for fine-tuning positions (box and text separately)
  const fnBoxXOffset = 8   // First name box offset (12 - 4 = 8)
  const fnTextXOffset = 12 // First name text offset (unchanged)
  const lnBoxXOffset = 3   // Last name box offset (10 - 7 = 3)
  const lnTextXOffset = 10 // Last name text offset (unchanged)

  // Last name box Y position (top edge stays fixed at original position)
  // Original: lnBoxY = -lastNameBox.height / 2
  const lnBoxY = -lastNameBox.height / 2

  // First name box Y position (bottom-justified: bottom edge stays fixed)
  // Original bottom edge was at: -lastNameBox.height / 2
  // So fnBoxY = lnBoxY - fnBoxHeight (box extends upward)
  const fnBoxY = lnBoxY - fnBoxHeight

  // Draw first name box FIRST (light blue with white border) - so last name box overlaps on top
  ctx.fillStyle = USQC26_COLORS.secondary
  ctx.fillRect(-fnBoxWidth + boxExtension + fnBoxXOffset, fnBoxY, fnBoxWidth, fnBoxHeight)
  ctx.strokeStyle = USQC26_COLORS.white
  ctx.lineWidth = firstNameBox.borderWidth
  ctx.strokeRect(-fnBoxWidth + boxExtension + fnBoxXOffset, fnBoxY, fnBoxWidth, fnBoxHeight)

  // Draw first name text (dark blue with white stroke)
  // Bottom-justified: text lines are positioned from the bottom up
  ctx.font = `500 italic ${firstNameSize}px ${FONT_AMIFER}`
  ctx.letterSpacing = `${letterSpacing.firstName}px`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'miter'
  ctx.miterLimit = 2

  // Calculate Y positions for first name lines (bottom-justified)
  // Bottom of box is at fnBoxY + fnBoxHeight
  // Last line should be at bottom, first line above it
  const fnBoxBottom = fnBoxY + fnBoxHeight
  const fnTextPadding = firstNameBox.height / 2 // Padding from bottom edge to last line center

  for (let i = 0; i < firstNameLines.length; i++) {
    const lineIndex = firstNameLines.length - 1 - i // Reverse order for bottom-up positioning
    const lineY = fnBoxBottom - fnTextPadding - (i * fnLineHeight) + textYOffset
    const lineText = firstNameLines[lineIndex]

    // Draw white stroke first
    ctx.strokeStyle = USQC26_COLORS.white
    ctx.lineWidth = firstNameBox.strokeWidth
    ctx.strokeText(lineText, -rightPadding + fnTextXOffset, lineY)
    // Then fill with primary color
    ctx.fillStyle = USQC26_COLORS.primary
    ctx.fillText(lineText, -rightPadding + fnTextXOffset, lineY)
  }

  // Draw last name box ON TOP (white with light blue border)
  ctx.fillStyle = USQC26_COLORS.white
  ctx.fillRect(-lnBoxWidth + boxExtension + lnBoxXOffset, lnBoxY, lnBoxWidth, lnBoxHeight)
  ctx.strokeStyle = USQC26_COLORS.secondary
  ctx.lineWidth = lastNameBox.borderWidth
  ctx.strokeRect(-lnBoxWidth + boxExtension + lnBoxXOffset, lnBoxY, lnBoxWidth, lnBoxHeight)

  // Draw last name text (white with #1B4278 stroke)
  // Top-justified: text lines are positioned from the top down
  ctx.font = `500 italic ${lastNameSize}px ${FONT_AMIFER}`
  ctx.letterSpacing = `${letterSpacing.lastName}px`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'miter'
  ctx.miterLimit = 2

  // Calculate Y positions for last name lines (top-justified)
  // Top of box is at lnBoxY
  // First line at top, subsequent lines below
  const lnTextPadding = lastNameBox.height / 2 // Padding from top edge to first line center

  for (let i = 0; i < lastNameLines.length; i++) {
    const lineY = lnBoxY + lnTextPadding + (i * lnLineHeight) + textYOffset
    const lineText = lastNameLines[i]

    // Draw primary color stroke first
    ctx.strokeStyle = USQC26_COLORS.primary
    ctx.lineWidth = lastNameBox.strokeWidth
    ctx.strokeText(lineText, -rightPadding + lnTextXOffset, lineY)
    // Then fill with white
    ctx.fillStyle = USQC26_COLORS.white
    ctx.fillText(lineText, -rightPadding + lnTextXOffset, lineY)
  }

  ctx.restore()
}

function drawBottomBar(
  ctx: CanvasRenderingContext2D,
  photographer: string,
  teamName: string,
  rarity: 'common' | 'uncommon' | 'rare' | 'super-rare' = 'common',
  cameraImg?: HTMLImageElement | null
) {
  const { y, textYOffset, cameraIcon, photographerX, rarityX, raritySize, teamNameX, fontSize, letterSpacing } = USQC26_LAYOUT.bottomBar
  const textY = y + textYOffset

  ctx.save()
  ctx.font = `500 ${fontSize}px ${FONT_AMIFER}`
  ctx.fillStyle = USQC26_COLORS.primary
  ctx.textBaseline = 'middle'

  // Camera icon - tint white PNG to primary color
  if (cameraImg) {
    // Create offscreen canvas to tint the white icon
    const offscreen = document.createElement('canvas')
    offscreen.width = cameraIcon.width
    offscreen.height = cameraIcon.height
    const offCtx = offscreen.getContext('2d')
    if (offCtx) {
      // Draw the white icon
      offCtx.drawImage(cameraImg, 0, 0, cameraIcon.width, cameraIcon.height)
      // Tint it with the primary color using source-in composite
      offCtx.globalCompositeOperation = 'source-in'
      offCtx.fillStyle = USQC26_COLORS.primary
      offCtx.fillRect(0, 0, cameraIcon.width, cameraIcon.height)
      // Draw the tinted icon onto the main canvas
      ctx.drawImage(offscreen, cameraIcon.x, cameraIcon.y)
    }
  } else {
    // Fallback rectangle if image not loaded
    ctx.fillStyle = USQC26_COLORS.primary
    roundedRect(ctx, cameraIcon.x, cameraIcon.y, cameraIcon.width, cameraIcon.height, 2)
    ctx.fill()
  }

  // Photographer name
  ctx.fillStyle = USQC26_COLORS.primary
  ctx.textAlign = 'left'
  ctx.letterSpacing = `${letterSpacing.photographer}px`
  ctx.fillText(photographer.toUpperCase(), photographerX, textY)

  // Rarity indicator
  ctx.fillStyle = USQC26_COLORS.primary
  if (rarity === 'common' || rarity === 'uncommon') {
    // Circle for common/uncommon
    ctx.beginPath()
    ctx.arc(rarityX + raritySize / 2, y + 13, raritySize / 2, 0, Math.PI * 2)
    ctx.fill()
  } else {
    // Star for rare/super-rare
    drawStar(ctx, rarityX + raritySize / 2, y + 13, raritySize / 2, 5)
    ctx.fill()
    if (rarity === 'super-rare') {
      // Second star for super-rare
      drawStar(ctx, rarityX + raritySize / 2 + raritySize + 4, y + 13, raritySize / 2, 5)
      ctx.fill()
    }
  }

  // Team name (right-aligned)
  ctx.textAlign = 'right'
  ctx.letterSpacing = `${letterSpacing.teamName}px`
  ctx.fillText(teamName.toUpperCase(), teamNameX, textY)

  ctx.restore()
}

function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, points: number) {
  const innerRadius = radius * 0.4
  ctx.beginPath()
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? radius : innerRadius
    const angle = (Math.PI / points) * i - Math.PI / 2
    const x = cx + r * Math.cos(angle)
    const y = cy + r * Math.sin(angle)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
}

function drawRareCardContent(
  ctx: CanvasRenderingContext2D,
  title: string,
  caption: string
) {
  const { titleAnchorX, titleAnchorY, captionAnchorX, captionAnchorY, titleFontSize, captionFontSize, rotation } = USQC26_LAYOUT.rareCard
  const radians = (rotation * Math.PI) / 180

  ctx.save()

  // Draw title box and text
  ctx.translate(titleAnchorX, titleAnchorY)
  ctx.rotate(radians)

  // Title box (white with blue border)
  const titleBoxWidth = 700
  const titleBoxHeight = 80
  ctx.fillStyle = USQC26_COLORS.white
  ctx.fillRect(0, -titleBoxHeight / 2, titleBoxWidth, titleBoxHeight)
  ctx.strokeStyle = USQC26_COLORS.secondary
  ctx.lineWidth = 3
  ctx.strokeRect(0, -titleBoxHeight / 2, titleBoxWidth, titleBoxHeight)

  // Title text
  ctx.font = `500 italic ${titleFontSize}px ${FONT_AMIFER}`
  ctx.fillStyle = USQC26_COLORS.white
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(title, 16, 0)

  ctx.restore()

  // Draw caption box and text
  ctx.save()
  ctx.translate(captionAnchorX, captionAnchorY)
  ctx.rotate(radians)

  // Caption box (light blue with white border)
  const captionBoxWidth = 500
  const captionBoxHeight = 50
  ctx.fillStyle = USQC26_COLORS.secondary
  ctx.fillRect(0, -captionBoxHeight / 2, captionBoxWidth, captionBoxHeight)
  ctx.strokeStyle = USQC26_COLORS.white
  ctx.lineWidth = 3
  ctx.strokeRect(0, -captionBoxHeight / 2, captionBoxWidth, captionBoxHeight)

  // Caption text
  ctx.font = `500 italic ${captionFontSize}px ${FONT_AMIFER}`
  ctx.fillStyle = USQC26_COLORS.primary
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(caption, 16, 0)

  ctx.restore()
}

function drawSuperRareName(
  ctx: CanvasRenderingContext2D,
  firstName: string,
  lastName: string
) {
  const { centerX, firstNameY, lastNameY, firstNameSize, lastNameSize } = USQC26_LAYOUT.superRare

  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // First name (smaller, above)
  ctx.font = `500 ${firstNameSize}px ${FONT_AMIFER}`
  ctx.fillStyle = USQC26_COLORS.white
  ctx.fillText(firstName.toUpperCase(), centerX, firstNameY)

  // Last name (larger, below) - with italic style
  ctx.font = `500 italic ${lastNameSize}px ${FONT_AMIFER}`
  ctx.fillStyle = USQC26_COLORS.white
  ctx.fillText(lastName, centerX, lastNameY)

  ctx.restore()
}

function drawNationalTeamName(
  ctx: CanvasRenderingContext2D,
  fullName: string
) {
  const { nameY, nameFontSize } = USQC26_LAYOUT.nationalTeam

  ctx.save()

  // Draw name at top in angled box
  const rotation = -6
  const radians = (rotation * Math.PI) / 180

  ctx.translate(180, nameY + 25)
  ctx.rotate(radians)

  // Name box (white with blue border)
  const boxWidth = 500
  const boxHeight = 50
  ctx.fillStyle = USQC26_COLORS.white
  ctx.fillRect(0, -boxHeight / 2, boxWidth, boxHeight)
  ctx.strokeStyle = USQC26_COLORS.secondary
  ctx.lineWidth = 3
  ctx.strokeRect(0, -boxHeight / 2, boxWidth, boxHeight)

  // Name text
  ctx.font = `500 ${nameFontSize}px ${FONT_AMIFER}`
  ctx.fillStyle = USQC26_COLORS.primary
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(fullName.toUpperCase(), 16, 0)

  ctx.restore()
}

function getTeamInfo(card: Card, config: TournamentConfig) {
  if ('teamId' in card && card.teamId) {
    const team = config.teams.find((entry) => entry.id === card.teamId)
    if (team) return team
  }
  if ('teamName' in card && card.teamName) {
    return { id: 'custom', name: card.teamName, logoKey: '' }
  }
  return null
}

const DEFAULT_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1, rotateDeg: 0 }

async function renderCardFrame(
  input: RenderCardInput,
  ctx: CanvasRenderingContext2D,
  crop: CropRect
) {
  const { card, config, imageUrl, resolveAssetUrl } = input

  // Explicitly load Amifer font before rendering to ensure it's available for canvas
  if (document.fonts?.load) {
    await Promise.all([
      document.fonts.load('500 24px "Amifer"'),
      document.fonts.load('500 84px "Amifer"'),
      document.fonts.load('500 italic 43px "Amifer"'),
      document.fonts.load('500 italic 60px "Amifer"'),
    ])
  }

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  // 1. Draw the photo (full bleed)
  const img = await loadImage(imageUrl)
  drawCroppedImage(ctx, img, crop, 0, 0, CARD_WIDTH, CARD_HEIGHT)

  // 2. For standard player cards, draw name boxes BEFORE the frame (so frame covers them)
  const isStandardPlayer = card.cardType !== 'rare' && card.cardType !== 'super-rare' && card.cardType !== 'national-team'
  if (isStandardPlayer) {
    const firstName = 'firstName' in card ? card.firstName ?? '' : ''
    const lastName = 'lastName' in card ? card.lastName ?? '' : ''
    if (firstName || lastName) {
      drawAngledNameBoxes(ctx, firstName, lastName)
    }
  }

  // 3. Draw the frame overlay
  drawFrame(ctx)

  // 4. Draw team logo (or override logo for certain card types like media/official)
  const team = getTeamInfo(card, config)
  const cardTypeConfig = config.cardTypes.find((ct) => ct.type === card.cardType)
  const logoKey = cardTypeConfig?.logoOverrideKey || team?.logoKey || config.branding.tournamentLogoKey
  const logoImg = await loadImageSafe(logoKey ? resolveAssetUrl(logoKey) : null)
  if (logoImg) {
    const { x, y, maxWidth, maxHeight } = USQC26_LAYOUT.teamLogo
    drawLogo(ctx, logoImg, x, y, maxWidth, maxHeight)
  }

  // 5. Draw event indicator badge (if configured)
  const eventIndicator = config.branding.eventIndicator
  if (eventIndicator) {
    drawEventBadge(ctx, eventIndicator)
  }

  // 6. Load camera icon for bottom bar
  const cameraImg = await loadImageSafe(cameraIconUrl)

  // 7. Draw card-type-specific content
  if (card.cardType === 'rare') {
    // Rare card: centered title/caption
    const title = 'title' in card ? card.title ?? 'Rare Card' : 'Rare Card'
    const caption = 'caption' in card ? card.caption ?? '' : ''
    drawRareCardContent(ctx, title, caption)

    // Bottom bar for rare card
    const photographer = card.photographer ?? ''
    drawBottomBar(ctx, photographer, 'RARE CARD', 'rare', cameraImg)

  } else if (card.cardType === 'super-rare') {
    // Super rare: centered name style
    const firstName = 'firstName' in card ? card.firstName ?? '' : ''
    const lastName = 'lastName' in card ? card.lastName ?? '' : ''
    drawSuperRareName(ctx, firstName, lastName)

    // Position and number for super-rare
    if ('position' in card && card.position && 'jerseyNumber' in card && card.jerseyNumber) {
      drawPositionNumber(ctx, card.position, card.jerseyNumber)
    }

    // Bottom bar
    const photographer = card.photographer ?? ''
    const teamName = team?.name ?? ''
    drawBottomBar(ctx, photographer, teamName, 'super-rare', cameraImg)

  } else if (card.cardType === 'national-team') {
    // National team (uncommon): name at top
    const firstName = 'firstName' in card ? card.firstName ?? '' : ''
    const lastName = 'lastName' in card ? card.lastName ?? '' : ''
    const fullName = `${firstName} ${lastName}`.trim()
    drawNationalTeamName(ctx, fullName)

    // Bottom bar with team name and jersey number
    const photographer = card.photographer ?? ''
    const teamName = team?.name ?? 'USA QUADBALL'
    const jerseyNumber = 'jerseyNumber' in card ? card.jerseyNumber ?? '' : ''
    const bottomText = jerseyNumber ? `${teamName} #${jerseyNumber}` : teamName
    drawBottomBar(ctx, photographer, bottomText, 'uncommon', cameraImg)

  } else {
    // Standard player card (includes team-staff, media, official, tournament-staff)
    // Note: Name boxes are drawn earlier (before frame) so they appear underneath

    const photographer = card.photographer ?? ''
    const position = 'position' in card ? card.position ?? '' : ''
    const rarity = card.rarity ?? 'common'

    // For media, official, and tournament-staff: show position in bottom bar instead of top-right
    const isPositionInBottomBar = card.cardType === 'media' || card.cardType === 'official' || card.cardType === 'tournament-staff'

    if (isPositionInBottomBar) {
      // Position goes in bottom bar (where team name normally is)
      drawBottomBar(ctx, photographer, position, rarity, cameraImg)
    } else {
      // Position and number in top-right (jersey number is optional for some card types like team-staff)
      if (position) {
        const jerseyNumber = 'jerseyNumber' in card ? card.jerseyNumber : undefined
        drawPositionNumber(ctx, position, jerseyNumber)
      }

      // Bottom bar with team name
      const teamName = team?.name ?? ''
      drawBottomBar(ctx, photographer, teamName, rarity, cameraImg)
    }
  }
}

export async function renderCropBlob(input: { imageUrl: string; crop: CropRect }): Promise<Blob> {
  const { imageUrl, crop } = input
  const img = await loadImage(imageUrl)

  const srcW = crop.w * img.naturalWidth
  const srcH = crop.h * img.naturalHeight
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(srcW))
  canvas.height = Math.max(1, Math.round(srcH))
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    throw new Error('Could not get canvas context')
  }

  drawCroppedImage(ctx, img, crop, 0, 0, canvas.width, canvas.height)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Failed to create blob'))
      },
      'image/png',
      1.0
    )
  })
}

export async function renderCard(input: RenderCardInput): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = CARD_WIDTH
  canvas.height = CARD_HEIGHT
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    throw new Error('Could not get canvas context')
  }

  const crop = input.card.photo?.crop ?? DEFAULT_CROP
  await renderCardFrame(input, ctx, crop)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob)
        } else {
          reject(new Error('Failed to create blob'))
        }
      },
      'image/png',
      1.0
    )
  })
}

export async function renderPreviewTrim(input: RenderCardInput): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = TRIM_BOX.w
  canvas.height = TRIM_BOX.h
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    throw new Error('Could not get canvas context')
  }

  const crop = input.card.photo?.crop ?? DEFAULT_CROP
  ctx.save()
  ctx.translate(-TRIM_BOX.x, -TRIM_BOX.y)
  await renderCardFrame(input, ctx, crop)
  ctx.restore()

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob)
        } else {
          reject(new Error('Failed to create blob'))
        }
      },
      'image/png',
      1.0
    )
  })
}
