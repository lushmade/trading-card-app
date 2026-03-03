import {
  CARD_HEIGHT,
  CARD_WIDTH,
  TRIM_BOX,
  findTemplate,
  resolveTemplateId,
  resolveTemplateLayout,
  type Card,
  type CropRect,
  type RenderMeta,
  type TemplateDefinition,
  type TemplateFlags,
  type TemplateTheme,
  type TournamentConfig,
  type TemplateLayout,
  type Usqc26LayoutV1,
} from 'shared'

// Camera icon for bottom bar
import cameraIconUrl from './assets/icons/camera.png'
// Super rare symbol (two gold stars)
import superRareSymbolUrl from './assets/icons/super-rare-symbol.png'

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
  imageUrl?: string
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
  const layout = resolveTemplateLayout(template)

  return {
    templateId: effectiveTemplateId,
    templateSnapshot: {
      overlayKey: template.overlayKey,
      theme,
      flags,
      overlayPlacement,
      layout,
    },
  }
}

/** Shift a hex color's lightness by `amount` (negative = darker). */
function shiftColor(hex: string, amount: number): string {
  const c = hex.replace('#', '')
  const num = parseInt(c.length === 3 ? c.split('').map((ch) => ch + ch).join('') : c, 16)
  const r = Math.max(0, Math.min(255, ((num >> 16) & 0xff) + amount))
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + amount))
  const b = Math.max(0, Math.min(255, (num & 0xff) + amount))
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
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

const asUsqc26Layout = (layout: TemplateLayout | undefined): Usqc26LayoutV1 | null => {
  if (!layout || layout.kind !== 'usqc26-v1') {
    return null
  }
  return layout
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

function drawFrame(ctx: CanvasRenderingContext2D, layout: Usqc26LayoutV1) {
  const { frame, palette } = layout
  // Draw the frame overlay (white border with inner cutout)
  ctx.save()

  // Create the frame path (outer rectangle minus inner rounded rectangle)
  ctx.beginPath()
  // Outer rectangle (full card)
  ctx.rect(0, 0, CARD_WIDTH, CARD_HEIGHT)

  // Inner rounded rectangle (cutout) - draw counter-clockwise
  const { innerX, innerY, innerWidth, innerHeight, innerRadius } = frame
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

  ctx.fillStyle = palette.white
  ctx.fill('evenodd')

  ctx.restore()
}

function drawEventBadge(ctx: CanvasRenderingContext2D, text: string, layout: Usqc26LayoutV1) {
  const { eventBadge, palette, typography } = layout
  const { x, y, width, height, borderRadius, borderWidth, fontSize, textYOffset } = eventBadge

  ctx.save()

  // Badge background
  roundedRect(ctx, x, y, width, height, borderRadius)
  ctx.fillStyle = palette.secondary
  ctx.fill()

  // Badge border
  ctx.strokeStyle = palette.primary
  ctx.lineWidth = borderWidth
  ctx.stroke()

  // Badge text
  ctx.font = `700 ${fontSize}px ${typography.fontFamily}`
  ctx.fillStyle = palette.primary
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + width / 2, y + height / 2 + textYOffset)

  ctx.restore()
}

function drawPositionNumber(ctx: CanvasRenderingContext2D, position: string, number: string | undefined, layout: Usqc26LayoutV1) {
  const { positionNumber, palette, typography } = layout
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
  } = positionNumber

  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  // Use round joins to prevent artifacts at character edges with negative letter spacing
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  // Position label - #1B4278 fill with #FFFFFF stroke
  ctx.font = `500 ${positionFontSize}px ${typography.fontFamily}`
  ctx.letterSpacing = `${positionLetterSpacing}px`
  // Draw stroke first (underneath)
  ctx.strokeStyle = palette.white
  ctx.lineWidth = positionStrokeWidth
  ctx.strokeText(position.toUpperCase(), centerX, topY)
  // Then fill
  ctx.fillStyle = palette.primary
  ctx.fillText(position.toUpperCase(), centerX, topY)

  // Only draw jersey number if provided
  if (number) {
    // Calculate number Y position using actual text metrics for cross-browser consistency
    // Safari may calculate font metrics differently, so we use measureText for accuracy
    const positionMetrics = ctx.measureText(position.toUpperCase())
    // Use actualBoundingBox if available (modern browsers), fallback to font size
    const actualPositionHeight = (positionMetrics.actualBoundingBoxAscent !== undefined && positionMetrics.actualBoundingBoxDescent !== undefined)
      ? positionMetrics.actualBoundingBoxAscent + positionMetrics.actualBoundingBoxDescent
      : positionFontSize
    // Use measured height plus a small gap for consistent spacing
    const numberY = topY + actualPositionHeight + 2

    // Jersey number - #FFFFFF 67% opaque fill with #1B4278 outer-only stroke
    // Use offscreen canvas to create outer-only stroke effect:
    // 1. Draw stroke on offscreen canvas
    // 2. Cut out the inside with destination-out
    // 3. Composite outer stroke onto main canvas
    // 4. Draw fill directly on main canvas (blends with actual background)
    ctx.font = `500 ${numberFontSize}px ${typography.fontFamily}`
    ctx.letterSpacing = `${numberLetterSpacing}px`

    // Create offscreen canvas for the outer-only stroke
    const offCanvas = document.createElement('canvas')
    offCanvas.width = CARD_WIDTH
    offCanvas.height = CARD_HEIGHT
    const offCtx = offCanvas.getContext('2d')

    if (offCtx) {
      // Copy font settings to offscreen context
      offCtx.font = ctx.font
      offCtx.letterSpacing = ctx.letterSpacing
      offCtx.textAlign = 'center'
      offCtx.textBaseline = 'top'
      offCtx.lineJoin = 'round'
      offCtx.lineCap = 'round'

      // Draw the full stroke on offscreen canvas
      offCtx.strokeStyle = palette.primary
      offCtx.lineWidth = numberStrokeWidth
      offCtx.strokeText(number, centerX + numberXOffset, numberY)

      // Cut out the inside of the text (where fill will go)
      // This leaves only the outer half of the stroke
      offCtx.globalCompositeOperation = 'destination-out'
      offCtx.fillStyle = '#000000' // Color doesn't matter for cutout
      offCtx.fillText(number, centerX + numberXOffset, numberY)

      // Composite the outer-only stroke onto main canvas
      ctx.drawImage(offCanvas, 0, 0)
    }

    // Draw the 67% white fill directly on main canvas
    // This blends with the actual background, not the stroke
    ctx.fillStyle = palette.numberOverlay
    ctx.fillText(number, centerX + numberXOffset, numberY)
  }

  ctx.restore()
}

type LogoPlacement = {
  x: number
  y: number
  maxWidth: number
  maxHeight: number
  strokeWidth: number
  strokeColor: string
}

function drawLogo(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  placement: LogoPlacement
) {
  const { x, y, maxWidth, maxHeight, strokeWidth, strokeColor } = placement
  const ratio = Math.min(maxWidth / img.naturalWidth, maxHeight / img.naturalHeight, 1)
  const width = img.naturalWidth * ratio
  const height = img.naturalHeight * ratio

  ctx.save()

  // Draw 1px white outside stroke by drawing the logo slightly larger in white first
  // Using an offscreen canvas to create the stroke effect
  const offscreen = document.createElement('canvas')
  offscreen.width = Math.ceil(width + strokeWidth * 2)
  offscreen.height = Math.ceil(height + strokeWidth * 2)
  const offCtx = offscreen.getContext('2d')

  if (offCtx) {
    // Draw the logo at center of offscreen canvas
    offCtx.drawImage(img, strokeWidth, strokeWidth, width, height)

    // Create white stroke by drawing the logo's silhouette
    offCtx.globalCompositeOperation = 'source-in'
    offCtx.fillStyle = strokeColor
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

// Helper to wrap text into lines that fit within maxWidth
// Handles spaces, hyphens, and forces breaks on long single words
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number = 2
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

  // If we still have a single line that's too long (no break points), force character breaks
  const result: string[] = []
  for (const line of lines) {
    if (ctx.measureText(line).width > maxWidth) {
      // Force character breaks for this long line
      let remaining = line
      while (remaining && result.length < maxLines) {
        let breakPoint = remaining.length
        for (let i = 1; i < remaining.length; i++) {
          if (ctx.measureText(remaining.slice(0, i)).width > maxWidth) {
            breakPoint = Math.max(1, i - 1)
            break
          }
        }
        result.push(remaining.slice(0, breakPoint))
        remaining = remaining.slice(breakPoint)
      }
    } else {
      result.push(line)
    }
    if (result.length >= maxLines) break
  }

  return result.slice(0, maxLines)
}

function drawAngledNameBoxes(
  ctx: CanvasRenderingContext2D,
  firstName: string,
  lastName: string,
  layout: Usqc26LayoutV1
) {
  const { name, palette, typography } = layout
  const {
    rotation,
    maxWidth,
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
    boxOffsets,
    textOffsets,
  } = name
  const radians = (rotation * Math.PI) / 180

  ctx.save()

  // Measure and wrap text for last name
  ctx.font = `500 italic ${lastNameSize}px ${typography.fontFamily}`
  ctx.letterSpacing = `${letterSpacing.lastName}px`
  const lastNameText = lastName.toUpperCase()
  const lastNameLines = wrapText(ctx, lastNameText, maxWidth)
  const lastNameMaxWidth = Math.max(...lastNameLines.map(line => ctx.measureText(line).width))
  const lnBoxWidth = lastNameMaxWidth + leftPadding + rightPadding + boxExtension
  const lnLineHeight = lastNameSize * 1.1
  const lnBoxHeight = lastNameBox.height + (lastNameLines.length - 1) * lnLineHeight

  // Measure and wrap text for first name
  ctx.font = `500 italic ${firstNameSize}px ${typography.fontFamily}`
  ctx.letterSpacing = `${letterSpacing.firstName}px`
  const firstNameText = firstName.toUpperCase()
  const firstNameLines = wrapText(ctx, firstNameText, maxWidth)
  const firstNameMaxWidth = Math.max(...firstNameLines.map(line => ctx.measureText(line).width))
  const fnBoxWidth = firstNameMaxWidth + leftPadding + rightPadding + boxExtension
  const fnLineHeight = firstNameSize * 1.1
  const fnBoxHeight = firstNameBox.height + (firstNameLines.length - 1) * fnLineHeight

  // Position at anchor point (right edge of boxes) and rotate
  ctx.translate(anchorX, anchorY)
  ctx.rotate(radians)

  // X-offset adjustments for fine-tuning positions (box and text separately)
  const fnBoxXOffset = boxOffsets.firstName
  const lnBoxXOffset = boxOffsets.lastName
  const fnTextXOffset = textOffsets.firstName
  const lnTextXOffset = textOffsets.lastName

  // Last name box Y position (top edge stays fixed at original position)
  // Original: lnBoxY = -lastNameBox.height / 2
  const lnBoxY = -lastNameBox.height / 2

  // First name box Y position (bottom-justified: bottom edge stays fixed)
  // Original bottom edge was at: -lastNameBox.height / 2
  // So fnBoxY = lnBoxY - fnBoxHeight (box extends upward)
  const fnBoxY = lnBoxY - fnBoxHeight

  // Draw first name box FIRST (light blue with white border) - so last name box overlaps on top
  ctx.fillStyle = palette.secondary
  ctx.fillRect(-fnBoxWidth + boxExtension + fnBoxXOffset, fnBoxY, fnBoxWidth, fnBoxHeight)
  ctx.strokeStyle = palette.white
  ctx.lineWidth = firstNameBox.borderWidth
  ctx.strokeRect(-fnBoxWidth + boxExtension + fnBoxXOffset, fnBoxY, fnBoxWidth, fnBoxHeight)

  // Draw first name text (dark blue with white stroke)
  // Bottom-justified: text lines are positioned from the bottom up
  ctx.font = `500 italic ${firstNameSize}px ${typography.fontFamily}`
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
    ctx.strokeStyle = palette.white
    ctx.lineWidth = firstNameBox.strokeWidth
    ctx.strokeText(lineText, -rightPadding + fnTextXOffset, lineY)
    // Then fill with primary color
    ctx.fillStyle = palette.primary
    ctx.fillText(lineText, -rightPadding + fnTextXOffset, lineY)
  }

  // Draw last name box ON TOP (white with light blue border)
  ctx.fillStyle = palette.white
  ctx.fillRect(-lnBoxWidth + boxExtension + lnBoxXOffset, lnBoxY, lnBoxWidth, lnBoxHeight)
  ctx.strokeStyle = palette.secondary
  ctx.lineWidth = lastNameBox.borderWidth
  ctx.strokeRect(-lnBoxWidth + boxExtension + lnBoxXOffset, lnBoxY, lnBoxWidth, lnBoxHeight)

  // Draw last name text (white with #1B4278 stroke)
  // Top-justified: text lines are positioned from the top down
  ctx.font = `500 italic ${lastNameSize}px ${typography.fontFamily}`
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
    ctx.strokeStyle = palette.primary
    ctx.lineWidth = lastNameBox.strokeWidth
    ctx.strokeText(lineText, -rightPadding + lnTextXOffset, lineY)
    // Then fill with white
    ctx.fillStyle = palette.white
    ctx.fillText(lineText, -rightPadding + lnTextXOffset, lineY)
  }

  ctx.restore()
}

function drawBottomBar(
  ctx: CanvasRenderingContext2D,
  photographer: string,
  teamName: string,
  layout: Usqc26LayoutV1,
  rarity: 'common' | 'uncommon' | 'rare' | 'super-rare' = 'common',
  cameraImg?: HTMLImageElement | null
) {
  const { bottomBar, palette, typography } = layout
  const { y, textYOffset, cameraIcon, photographerX, rarityX, raritySize, rarityGap, teamNameX, fontSize, letterSpacing } = bottomBar
  const textY = y + textYOffset

  ctx.save()
  ctx.font = `500 ${fontSize}px ${typography.fontFamily}`
  ctx.fillStyle = palette.primary
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
      offCtx.fillStyle = palette.primary
      offCtx.fillRect(0, 0, cameraIcon.width, cameraIcon.height)
      // Draw the tinted icon onto the main canvas
      ctx.drawImage(offscreen, cameraIcon.x, cameraIcon.y)
    }
  } else {
    // Fallback rectangle if image not loaded
    ctx.fillStyle = palette.primary
    roundedRect(ctx, cameraIcon.x, cameraIcon.y, cameraIcon.width, cameraIcon.height, 2)
    ctx.fill()
  }

  // Photographer name
  ctx.fillStyle = palette.primary
  ctx.textAlign = 'left'
  ctx.letterSpacing = `${letterSpacing.photographer}px`
  ctx.fillText(photographer.toUpperCase(), photographerX, textY)

  // Rarity indicator
  ctx.fillStyle = palette.primary
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
      drawStar(ctx, rarityX + raritySize / 2 + raritySize + rarityGap, y + 13, raritySize / 2, 5)
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

/**
 * Draws a white-themed bottom bar for super-rare cards.
 * Uses white for all elements (camera icon, photographer, rarity, right info).
 */
function drawBottomBarSuperRare(
  ctx: CanvasRenderingContext2D,
  photographer: string,
  rightText: string,
  layout: Usqc26LayoutV1,
  cameraImg?: HTMLImageElement | null,
  superRareSymbolImg?: HTMLImageElement | null
) {
  const { bottomBar, superRare, typography } = layout
  const { cameraIcon, photographerX, teamNameX, fontSize, letterSpacing } = bottomBar
  // Use bottomBarOffset if provided, otherwise use default y
  const barY = superRare.bottomBarOffset ? (CARD_HEIGHT - superRare.bottomBarOffset) : bottomBar.y
  const textY = barY + bottomBar.textYOffset

  ctx.save()
  ctx.font = `500 ${fontSize}px ${typography.fontFamily}`
  ctx.fillStyle = '#ffffff' // White for super-rare
  ctx.textBaseline = 'middle'

  // Camera icon - use white (no tint needed since icon is already white)
  if (cameraImg) {
    const iconY = barY + (bottomBar.textYOffset - cameraIcon.height / 2) - 1
    ctx.drawImage(cameraImg, cameraIcon.x, iconY, cameraIcon.width, cameraIcon.height)
  } else {
    // Fallback rectangle
    ctx.fillStyle = '#ffffff'
    roundedRect(ctx, cameraIcon.x, barY + 3, cameraIcon.width, cameraIcon.height, 2)
    ctx.fill()
  }

  // Photographer name (white)
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'left'
  ctx.letterSpacing = `${letterSpacing.photographer}px`
  ctx.fillText(photographer.toUpperCase(), photographerX, textY)

  // Super rare symbol - centered horizontally
  if (superRareSymbolImg) {
    const symbolWidth = superRareSymbolImg.naturalWidth
    const symbolHeight = superRareSymbolImg.naturalHeight
    const symbolX = (CARD_WIDTH - symbolWidth) / 2
    const symbolY = barY + (bottomBar.textYOffset - symbolHeight / 2) - 12
    ctx.drawImage(superRareSymbolImg, symbolX, symbolY, symbolWidth, symbolHeight)
  }

  // Right text (white, right-aligned)
  ctx.textAlign = 'right'
  ctx.letterSpacing = `${letterSpacing.teamName}px`
  ctx.fillText(rightText.toUpperCase(), teamNameX, textY)

  ctx.restore()
}

function drawGradientOverlay(ctx: CanvasRenderingContext2D, theme: TemplateTheme) {
  ctx.save()
  const gradient = ctx.createLinearGradient(0, 0, 0, CARD_HEIGHT)
  gradient.addColorStop(0, theme.gradientStart)
  gradient.addColorStop(1, theme.gradientEnd)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)
  ctx.restore()
}

function drawBorders(ctx: CanvasRenderingContext2D, theme: TemplateTheme) {
  ctx.save()
  ctx.strokeStyle = theme.border
  ctx.lineWidth = 1
  ctx.strokeRect(TRIM_BOX.x, TRIM_BOX.y, TRIM_BOX.w, TRIM_BOX.h)
  ctx.restore()
}

function drawOverlay(ctx: CanvasRenderingContext2D, overlayImg: HTMLImageElement) {
  ctx.save()
  ctx.drawImage(overlayImg, 0, 0, CARD_WIDTH, CARD_HEIGHT)
  ctx.restore()
}

function drawWatermarkJersey(
  ctx: CanvasRenderingContext2D,
  jerseyNumber: string | undefined,
  theme: TemplateTheme,
  layout: Usqc26LayoutV1
) {
  if (!jerseyNumber) return
  ctx.save()
  ctx.font = `700 240px ${layout.typography.fontFamily}`
  ctx.fillStyle = theme.watermark
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(jerseyNumber, CARD_WIDTH / 2, CARD_HEIGHT / 2)
  ctx.restore()
}

/**
 * Draws rare card content using name layout properties.
 *
 * NOTE: Rare cards intentionally reuse `name` layout properties (box sizes,
 * padding, text offsets) for visual consistency with player cards. The
 * `rareCard` layout section only contains rare-specific overrides:
 * - rotation, anchorX, anchorY, maxWidth (positioning)
 * - titleTextOffsetX, captionTextOffsetX (text alignment adjustments)
 * - titleLetterSpacing, captionLetterSpacing (spacing overrides)
 */
function drawRareCardContent(
  ctx: CanvasRenderingContext2D,
  title: string,
  caption: string,
  layout: Usqc26LayoutV1
) {
  const { rareCard, name, palette, typography } = layout
  const { rotation, anchorX, anchorY, maxWidth, titleTextOffsetX, captionTextOffsetX, titleLetterSpacing, captionLetterSpacing } = rareCard
  // Use name styling and positioning for consistent look
  const {
    lastNameSize,
    firstNameSize,
    lastNameBox,
    firstNameBox,
    leftPadding,
    rightPadding,
    boxExtension,
    textYOffset,
  } = name
  const radians = (rotation * Math.PI) / 180

  // Use same text offsets as name boxes
  ctx.save()

  // Measure and wrap title text (allow many lines, constrain to frame width)
  ctx.font = `500 italic ${lastNameSize}px ${typography.fontFamily}`
  ctx.letterSpacing = `${titleLetterSpacing}px`
  const titleLines = wrapText(ctx, title, maxWidth, 10)
  const titleMaxWidth = Math.max(...titleLines.map(line => ctx.measureText(line).width))
  const titleBoxWidth = titleMaxWidth + leftPadding + rightPadding + boxExtension
  const titleLineHeight = lastNameSize * 1.1
  const titleBoxHeight = lastNameBox.height + (titleLines.length - 1) * titleLineHeight

  // Measure and wrap caption text (if caption exists, allow many lines)
  let captionLines: string[] = []
  let captionBoxWidth = 0
  let captionLineHeight = 0
  let captionBoxHeight = firstNameBox.height
  if (caption) {
    ctx.font = `500 italic ${firstNameSize}px ${typography.fontFamily}`
    ctx.letterSpacing = `${captionLetterSpacing}px`
    captionLines = wrapText(ctx, caption, maxWidth, 10)
    const captionMaxWidth = Math.max(...captionLines.map(line => ctx.measureText(line).width))
    captionBoxWidth = captionMaxWidth + leftPadding + rightPadding + boxExtension
    captionLineHeight = firstNameSize * 1.1
    captionBoxHeight = firstNameBox.height + (captionLines.length - 1) * captionLineHeight
  }

  // Position: title on top (bottom edge fixed), caption below (top edge fixed)
  // The anchor Y represents where title bottom / caption top meet
  // Draw title box FIRST so caption overlaps on top
  ctx.save()
  ctx.translate(anchorX, anchorY)
  ctx.rotate(radians)

  // Title box (white with blue border - same as last name box)
  // Bottom-justified: box extends upward from bottom edge
  const titleBoxTop = -titleBoxHeight
  ctx.fillStyle = palette.white
  ctx.fillRect(-titleBoxWidth + boxExtension, titleBoxTop, titleBoxWidth, titleBoxHeight)
  ctx.strokeStyle = palette.secondary
  ctx.lineWidth = lastNameBox.borderWidth
  ctx.strokeRect(-titleBoxWidth + boxExtension, titleBoxTop, titleBoxWidth, titleBoxHeight)

  // Title text (styled like first name: bottom-justified, overflow up)
  ctx.font = `500 italic ${lastNameSize}px ${typography.fontFamily}`
  ctx.letterSpacing = `${titleLetterSpacing}px`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'miter'
  ctx.miterLimit = 2

  // Draw title lines bottom-justified (last line at bottom, first line above)
  const titleTextPadding = lastNameBox.height / 2
  for (let i = 0; i < titleLines.length; i++) {
    const lineIndex = titleLines.length - 1 - i
    const lineY = -titleTextPadding - (i * titleLineHeight) + textYOffset
    const lineText = titleLines[lineIndex]

    ctx.strokeStyle = palette.primary
    ctx.lineWidth = lastNameBox.strokeWidth
    ctx.strokeText(lineText, -rightPadding + titleTextOffsetX, lineY)
    ctx.fillStyle = palette.white
    ctx.fillText(lineText, -rightPadding + titleTextOffsetX, lineY)
  }

  ctx.restore()

  // Draw caption box ON TOP if caption exists
  if (caption) {
    ctx.save()
    ctx.translate(anchorX, anchorY)
    ctx.rotate(radians)

    // Caption box (light blue with white border - same as first name box)
    // Top-justified: box extends downward from top edge
    ctx.fillStyle = palette.secondary
    ctx.fillRect(-captionBoxWidth + boxExtension, 0, captionBoxWidth, captionBoxHeight)
    ctx.strokeStyle = palette.white
    ctx.lineWidth = firstNameBox.borderWidth
    ctx.strokeRect(-captionBoxWidth + boxExtension, 0, captionBoxWidth, captionBoxHeight)

    // Caption text (styled like last name: top-justified, overflow down)
    ctx.font = `500 italic ${firstNameSize}px ${typography.fontFamily}`
    ctx.letterSpacing = `${captionLetterSpacing}px`
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'miter'
    ctx.miterLimit = 2

    // Draw caption lines top-justified (first line at top, subsequent lines below)
    const captionTextPadding = firstNameBox.height / 2
    for (let i = 0; i < captionLines.length; i++) {
      const lineY = captionTextPadding + (i * captionLineHeight) + textYOffset
      const lineText = captionLines[i]

      ctx.strokeStyle = palette.white
      ctx.lineWidth = firstNameBox.strokeWidth
      ctx.strokeText(lineText, -rightPadding + captionTextOffsetX, lineY)
      ctx.fillStyle = palette.primary
      ctx.fillText(lineText, -rightPadding + captionTextOffsetX, lineY)
    }

    ctx.restore()
  }

  ctx.restore()
}

function drawSuperRareName(
  ctx: CanvasRenderingContext2D,
  firstName: string,
  lastName: string,
  layout: Usqc26LayoutV1
) {
  const { superRare, palette } = layout
  const {
    centerX,
    firstNameY,
    lastNameY,
    firstNameSize,
    lastNameSize,
    firstNameFontFamily,
    lastNameFontFamily,
    firstNameStrokeWidth,
    lastNameStrokeWidth,
  } = superRare

  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  // First name: Amifer, light blue (secondary) fill with dark blue (primary) stroke, ALL CAPS
  ctx.font = `500 ${firstNameSize}px ${firstNameFontFamily ?? '"Amifer", sans-serif'}`
  // Draw stroke first (underneath)
  ctx.strokeStyle = palette.primary
  ctx.lineWidth = firstNameStrokeWidth ?? 3
  ctx.strokeText(firstName.toUpperCase(), centerX, firstNameY)
  // Then fill with light blue (secondary)
  ctx.fillStyle = palette.secondary
  ctx.fillText(firstName.toUpperCase(), centerX, firstNameY)

  // Last name: Cinema Script, white fill with dark blue (primary) stroke
  ctx.font = `400 ${lastNameSize}px ${lastNameFontFamily ?? '"Cinema Script", cursive'}`
  // Draw stroke first
  ctx.strokeStyle = palette.primary
  ctx.lineWidth = lastNameStrokeWidth ?? 4
  ctx.strokeText(lastName, centerX, lastNameY)
  // Then fill with white
  ctx.fillStyle = palette.white
  ctx.fillText(lastName, centerX, lastNameY)

  ctx.restore()
}

function drawNationalTeamName(
  ctx: CanvasRenderingContext2D,
  fullName: string,
  layout: Usqc26LayoutV1
) {
  const { nationalTeam, palette, typography } = layout
  const {
    rotation,
    anchorX,
    anchorY,
    boxWidth,
    boxHeight,
    boxBorderWidth,
    textPaddingX,
    nameFontSize,
  } = nationalTeam

  ctx.save()

  // Draw name at top in angled box
  const radians = (rotation * Math.PI) / 180

  ctx.translate(anchorX, anchorY)
  ctx.rotate(radians)

  // Name box (white with blue border)
  ctx.fillStyle = palette.white
  ctx.fillRect(0, -boxHeight / 2, boxWidth, boxHeight)
  ctx.strokeStyle = palette.secondary
  ctx.lineWidth = boxBorderWidth
  ctx.strokeRect(0, -boxHeight / 2, boxWidth, boxHeight)

  // Name text
  ctx.font = `500 ${nameFontSize}px ${typography.fontFamily}`
  ctx.fillStyle = palette.primary
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(fullName.toUpperCase(), textPaddingX, 0)

  ctx.restore()
}

function drawHeaderBar(
  ctx: CanvasRenderingContext2D,
  firstName: string,
  lastName: string,
  jerseyNumber: string | undefined,
  layout: Usqc26LayoutV1
) {
  const headerBar = layout.headerBar
  if (!headerBar) return

  ctx.save()

  const notch = headerBar.notchSize ?? 0

  // Draw header bar as trapezoid (wider at top, angled bottom corners)
  ctx.beginPath()
  ctx.moveTo(0, 0) // top-left
  ctx.lineTo(CARD_WIDTH, 0) // top-right
  ctx.lineTo(CARD_WIDTH - notch, headerBar.height) // bottom-right (angled inward)
  ctx.lineTo(notch, headerBar.height) // bottom-left (angled inward)
  ctx.closePath()

  ctx.fillStyle = headerBar.color
  ctx.fill()

  // Add black outline to match Canva template styling
  const barStrokeColor = layout.cardBorder?.color ?? '#000000'
  const barStrokeWidth = Math.max(2, (layout.cardBorder?.width ?? 3) * 0.9)
  ctx.strokeStyle = barStrokeColor
  ctx.lineWidth = barStrokeWidth
  ctx.lineJoin = 'miter'
  ctx.miterLimit = 2
  ctx.stroke()

  // Draw name + number text
  const nameText = `${firstName} ${lastName}`.trim().toUpperCase()
  const displayText = jerseyNumber ? `${nameText} #${jerseyNumber}` : nameText

  ctx.font = `${headerBar.fontStyle} ${headerBar.fontSize}px ${layout.typography.fontFamily}`
  ctx.fillStyle = headerBar.textColor
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(displayText, CARD_WIDTH / 2, headerBar.textY)

  ctx.restore()
}

function drawFooterBar(
  ctx: CanvasRenderingContext2D,
  teamName: string,
  layout: Usqc26LayoutV1
) {
  const footerBar = layout.footerBar
  if (!footerBar) return

  ctx.save()

  const notch = footerBar.notchSize ?? 0

  // Draw footer bar as inverted trapezoid (wider at bottom, angled top corners)
  ctx.beginPath()
  ctx.moveTo(notch, footerBar.y) // top-left (angled inward)
  ctx.lineTo(CARD_WIDTH - notch, footerBar.y) // top-right (angled inward)
  ctx.lineTo(CARD_WIDTH, footerBar.y + footerBar.height) // bottom-right
  ctx.lineTo(0, footerBar.y + footerBar.height) // bottom-left
  ctx.closePath()

  ctx.fillStyle = footerBar.color
  ctx.fill()

  // Add black outline to match Canva template styling
  const barStrokeColor = layout.cardBorder?.color ?? '#000000'
  const barStrokeWidth = Math.max(2, (layout.cardBorder?.width ?? 3) * 0.9)
  ctx.strokeStyle = barStrokeColor
  ctx.lineWidth = barStrokeWidth
  ctx.lineJoin = 'miter'
  ctx.miterLimit = 2
  ctx.stroke()

  // Draw team name text
  ctx.font = `${footerBar.fontStyle} ${footerBar.fontSize}px ${layout.typography.fontFamily}`
  ctx.fillStyle = footerBar.textColor
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(teamName.toUpperCase(), CARD_WIDTH / 2, footerBar.y + footerBar.textY)

  ctx.restore()
}

function drawPositionStripesQc(
  ctx: CanvasRenderingContext2D,
  _positionString: string,
  layout: Usqc26LayoutV1
) {
  const stripes = layout.positionStripes
  if (!stripes) return

  // Diagonal stripe style - position-based side stripes
  if ('style' in stripes && stripes.style === 'diagonal') {
    const { stripeWidth, stripeGap, mapping } = stripes
    const footerBar = layout.footerBar
    if (!footerBar) return

    // Build stripe colors from selected positions (mapping order defines display order)
    const selectedPositions = _positionString.split(',').map(p => p.trim()).filter(Boolean)
    const stripeColors: string[] = []
    for (const m of mapping) {
      if (selectedPositions.includes(m.position)) {
        stripeColors.push(m.color)
      }
    }
    // Fallback: if no positions selected, use the colors array for preview
    const colors = stripeColors.length > 0 ? stripeColors : (stripes.colors ?? [])
    if (colors.length === 0) return

    const notch = footerBar.notchSize ?? 0
    const fbHeight = footerBar.height
    const fbY = footerBar.y
    const bottomY = fbY + fbHeight // bottom of footer bar = bottom of card

    // Derive angle from footer bar's trapezoid: notch pixels horizontal over fbHeight vertical
    const slopeX = notch / fbHeight

    // Stripes extend from card bottom to exactly the footer bar top edge
    const topY = fbY
    const stripeHeight = bottomY - topY

    // Total horizontal inset at the top of the stripe zone (based on footer bar angle)
    const totalInsetAtTop = slopeX * stripeHeight

    const step = stripeWidth + stripeGap
    const strokeWidth = 2

    ctx.save()

    // LEFT side - outermost stripe starts at card edge
    for (let i = 0; i < colors.length; i++) {
      const offset = i * step

      // Bottom: stripe starts at offset from left edge
      const bLeft = offset
      const bRight = offset + stripeWidth

      // Top: shifted inward by totalInsetAtTop (same angle as footer bar)
      const tLeft = offset + totalInsetAtTop
      const tRight = offset + stripeWidth + totalInsetAtTop

      ctx.beginPath()
      ctx.moveTo(bLeft, bottomY)
      ctx.lineTo(bRight, bottomY)
      ctx.lineTo(tRight, topY)
      ctx.lineTo(tLeft, topY)
      ctx.closePath()
      ctx.fillStyle = colors[i]
      ctx.fill()

      // Black outline on each stripe
      ctx.strokeStyle = '#000000'
      ctx.lineWidth = strokeWidth
      ctx.lineJoin = 'miter'
      ctx.miterLimit = 3
      ctx.stroke()
    }

    // RIGHT side (mirrored)
    for (let i = 0; i < colors.length; i++) {
      const offset = i * step

      const bLeft = CARD_WIDTH - offset
      const bRight = CARD_WIDTH - offset - stripeWidth

      const tLeft = CARD_WIDTH - offset - totalInsetAtTop
      const tRight = CARD_WIDTH - offset - stripeWidth - totalInsetAtTop

      ctx.beginPath()
      ctx.moveTo(bLeft, bottomY)
      ctx.lineTo(bRight, bottomY)
      ctx.lineTo(tRight, topY)
      ctx.lineTo(tLeft, topY)
      ctx.closePath()
      ctx.fillStyle = colors[i]
      ctx.fill()

      ctx.strokeStyle = '#000000'
      ctx.lineWidth = strokeWidth
      ctx.lineJoin = 'miter'
      ctx.miterLimit = 3
      ctx.stroke()
    }

    ctx.restore()
    return
  }

  // Legacy vertical stripe style - narrow type by checking for 'x' property
  if (!('x' in stripes)) return
  const verticalStripes = stripes

  const selectedPositions = _positionString.split(',').map(p => p.trim()).filter(Boolean)
  if (selectedPositions.length === 0) return

  const totalHeight = verticalStripes.bottomY - verticalStripes.topY
  const totalGaps = (selectedPositions.length - 1) * verticalStripes.gap
  const stripeHeight = (totalHeight - totalGaps) / selectedPositions.length

  selectedPositions.forEach((pos, i) => {
    const mapping = verticalStripes.mapping.find(m => m.position === pos)
    if (!mapping) return

    const y = verticalStripes.topY + i * (stripeHeight + verticalStripes.gap)

    ctx.save()
    ctx.fillStyle = mapping.color
    ctx.fillRect(verticalStripes.x, y, verticalStripes.width, stripeHeight)
    ctx.restore()
  })
}

function drawPhotographerCreditQc(
  ctx: CanvasRenderingContext2D,
  photographer: string,
  layout: Usqc26LayoutV1
) {
  const credit = layout.photographerCredit
  if (!credit || !photographer) return

  ctx.save()
  const fontStyle = credit.fontStyle ?? '400'
  ctx.font = `${fontStyle} ${credit.fontSize}px ${layout.typography.fontFamily}`
  ctx.fillStyle = credit.color
  ctx.textAlign = credit.textAlign
  ctx.textBaseline = 'middle'
  ctx.fillText(photographer, credit.x, credit.y)
  ctx.restore()
}

function drawCardBorder(
  ctx: CanvasRenderingContext2D,
  layout: Usqc26LayoutV1
) {
  const border = layout.cardBorder
  if (!border) return

  ctx.save()
  ctx.strokeStyle = border.color
  ctx.lineWidth = border.width
  // Draw the border inset by half the line width so it's fully visible
  const half = border.width / 2
  ctx.strokeRect(half, half, CARD_WIDTH - border.width, CARD_HEIGHT - border.width)
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
  const { templateId: effectiveTemplateId, templateSnapshot } = resolveTemplateSnapshot({
    card,
    config,
    templateId: input.templateId,
  })
  const layout = asUsqc26Layout(templateSnapshot.layout)

  // Check if we should render as super-rare (either card type is super-rare OR template is super-rare)
  const eligibleForSuperRare = ['player', 'team-staff', 'media', 'official', 'tournament-staff', 'super-rare'].includes(card.cardType)
  const renderAsSuperRare = card.cardType === 'super-rare' || (eligibleForSuperRare && effectiveTemplateId === 'super-rare')
  if (!layout) {
    // Render error state for missing or invalid layout
    ctx.fillStyle = '#f87171'
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)
    ctx.fillStyle = '#ffffff'
    ctx.font = '24px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('Tournament not configured', CARD_WIDTH / 2, CARD_HEIGHT / 2 - 20)
    ctx.font = '16px sans-serif'
    ctx.fillText('Please contact support', CARD_WIDTH / 2, CARD_HEIGHT / 2 + 20)
    return
  }
  const { theme, flags, overlayKey, overlayPlacement } = templateSnapshot
  const isQcStyle = !!(layout.headerBar && layout.footerBar)

  // Explicitly load font before rendering to ensure it's available for canvas
  if (document.fonts?.load) {
    const fontFamily = layout.typography.fontFamily
    const fontLoads = new Set<string>([
      `500 ${layout.bottomBar.fontSize}px ${fontFamily}`,
      `500 ${layout.positionNumber.positionFontSize}px ${fontFamily}`,
      `500 ${layout.positionNumber.numberFontSize}px ${fontFamily}`,
      `500 italic ${layout.name.firstNameSize}px ${fontFamily}`,
      `500 italic ${layout.name.lastNameSize}px ${fontFamily}`,
      `500 ${layout.nationalTeam.nameFontSize}px ${fontFamily}`,
    ])
    // Super rare fonts (may use different font families)
    const srFirstNameFont = layout.superRare.firstNameFontFamily ?? fontFamily
    const srLastNameFont = layout.superRare.lastNameFontFamily ?? '"Cinema Script", cursive'
    fontLoads.add(`500 ${layout.superRare.firstNameSize}px ${srFirstNameFont}`)
    fontLoads.add(`400 ${layout.superRare.lastNameSize}px ${srLastNameFont}`)
    // Also load Cinema Script explicitly
    fontLoads.add(`400 ${layout.superRare.lastNameSize}px "Cinema Script"`)
    if (layout.headerBar) {
      fontLoads.add(`${layout.headerBar.fontStyle} ${layout.headerBar.fontSize}px ${fontFamily}`)
    }
    if (layout.footerBar) {
      fontLoads.add(`${layout.footerBar.fontStyle} ${layout.footerBar.fontSize}px ${fontFamily}`)
    }
    await Promise.all([...fontLoads].map((font) => document.fonts.load(font)))
  }

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  // 1. Draw the photo (full bleed) or placeholder gradient
  if (imageUrl) {
    const img = await loadImage(imageUrl)
    drawCroppedImage(ctx, img, crop, 0, 0, CARD_WIDTH, CARD_HEIGHT)
  } else {
    // Draw a placeholder gradient background
    const primaryColor = config.branding.primaryColor || '#1e3a5f'
    const grad = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT)
    grad.addColorStop(0, primaryColor)
    grad.addColorStop(0.5, shiftColor(primaryColor, -30))
    grad.addColorStop(1, shiftColor(primaryColor, -60))
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)
  }

  // 2. Draw template overlays below text
  if (flags.showGradient) {
    drawGradientOverlay(ctx, theme)
  }
  if (flags.showBorders) {
    drawBorders(ctx, theme)
  }

  if (flags.showWatermarkJersey) {
    const jerseyNumber = 'jerseyNumber' in card ? card.jerseyNumber : undefined
    drawWatermarkJersey(ctx, jerseyNumber, theme, layout)
  }

  const overlayImg = await loadImageSafe(overlayKey ? resolveAssetUrl(overlayKey) : null)

  if (isQcStyle) {
    // QC-style rendering path: header bar + footer bar + position stripes
    const team = getTeamInfo(card, config)
    const firstName = 'firstName' in card ? card.firstName ?? '' : ''
    const lastName = 'lastName' in card ? card.lastName ?? '' : ''
    const jerseyNumber = 'jerseyNumber' in card ? card.jerseyNumber : undefined
    const position = 'position' in card ? card.position ?? '' : ''
    const photographer = card.photographer ?? ''
    const teamName = team?.name ?? ''

    // Draw frame/bleed area (border with inner cutout for photo)
    drawFrame(ctx, layout)

    // Draw header bar with name + number (trapezoid)
    drawHeaderBar(ctx, firstName, lastName, jerseyNumber, layout)

    // Draw footer bar with team name (inverted trapezoid)
    drawFooterBar(ctx, teamName, layout)

    // Draw position stripes ON TOP of footer bar (matching footer bar angle)
    const cardTypeConfig = config.cardTypes.find((ct) => ct.type === card.cardType)
    if (cardTypeConfig?.showPositionStripes !== false) {
      drawPositionStripesQc(ctx, position, layout)
    }

    // Draw overlay
    if (overlayImg && overlayPlacement === 'belowText') {
      drawOverlay(ctx, overlayImg)
    }

    // Draw photographer credit (just above footer bar)
    drawPhotographerCreditQc(ctx, photographer, layout)

    if (overlayImg && overlayPlacement === 'aboveText') {
      drawOverlay(ctx, overlayImg)
    }

    // Draw thin card border on top of everything
    drawCardBorder(ctx, layout)
  } else {
    // Standard USQC-style rendering path

    // 3. Draw content boxes BEFORE the frame (so frame covers them)
    const isStandardPlayer = card.cardType !== 'rare' && !renderAsSuperRare && card.cardType !== 'national-team'
    if (isStandardPlayer) {
      const firstName = 'firstName' in card ? card.firstName ?? '' : ''
      const lastName = 'lastName' in card ? card.lastName ?? '' : ''
      if (firstName || lastName) {
        drawAngledNameBoxes(ctx, firstName, lastName, layout)
      }
    } else if (card.cardType === 'rare' && !renderAsSuperRare) {
      // Rare card: draw title/caption boxes before frame
      const title = 'title' in card ? card.title ?? 'Rare Card' : 'Rare Card'
      const caption = 'caption' in card ? card.caption ?? '' : ''
      drawRareCardContent(ctx, title, caption, layout)
    }
    // Note: super-rare content is drawn later, after overlay check

    // 4. Draw the frame overlay (skip for super-rare - full bleed)
    if (!renderAsSuperRare) {
      drawFrame(ctx, layout)
    }

    if (overlayImg && overlayPlacement === 'belowText') {
      drawOverlay(ctx, overlayImg)
    }

    // 5. Draw team logo (or override logo for certain card types like media/official)
    const team = getTeamInfo(card, config)
    const cardTypeConfig = config.cardTypes.find((ct) => ct.type === card.cardType)
    const logoKey = cardTypeConfig?.logoOverrideKey || team?.logoKey || config.branding.tournamentLogoKey
    const logoImg = await loadImageSafe(logoKey ? resolveAssetUrl(logoKey) : null)
    if (logoImg) {
      const basePlacement = card.cardType === 'national-team' ? layout.nationalTeam.logo : layout.teamLogo
      const placement: LogoPlacement = {
        ...basePlacement,
        strokeWidth: layout.teamLogo.strokeWidth,
        strokeColor: layout.teamLogo.strokeColor,
      }
      drawLogo(ctx, logoImg, placement)
    }

    // 6. Draw event indicator badge (if configured)
    const eventIndicator = config.branding.eventIndicator
    if (eventIndicator) {
      drawEventBadge(ctx, eventIndicator, layout)
    }

    // 7. Load camera icon for bottom bar
    const cameraImg = await loadImageSafe(cameraIconUrl)

    // 8. Draw card-type-specific content
    if (renderAsSuperRare) {
      // Super rare: full bleed (no frame), centered name style with Cinema Script
      // Can be triggered by cardType === 'super-rare' OR templateId === 'super-rare'
      // NOTE: Frame is skipped for super-rare - drawFrame is not called
      // NOTE: Position/number NOT shown in upper right for super-rare (only event badge)

      const firstName = 'firstName' in card ? card.firstName ?? '' : ''
      const lastName = 'lastName' in card ? card.lastName ?? '' : ''
      drawSuperRareName(ctx, firstName, lastName, layout)

      // Load super rare symbol
      const superRareSymbolImg = await loadImageSafe(superRareSymbolUrl)

      // White-themed bottom bar for super-rare
      const photographer = card.photographer ?? ''
      const position = 'position' in card ? card.position : undefined
      const jerseyNumber = 'jerseyNumber' in card ? card.jerseyNumber : undefined
      // Right text: "#[number] [position]" for player/team-staff, otherwise position
      let rightText = ''
      if (jerseyNumber && position) {
        rightText = `#${jerseyNumber} ${position}`
      } else if (position) {
        rightText = position
      }
      drawBottomBarSuperRare(ctx, photographer, rightText, layout, cameraImg, superRareSymbolImg)

    } else if (card.cardType === 'rare') {
      // Rare card: title/caption already drawn before frame
      // Just draw bottom bar
      const photographer = card.photographer ?? ''
      drawBottomBar(ctx, photographer, 'RARE CARD', layout, 'rare', cameraImg)

    } else if (card.cardType === 'national-team') {
      // National team (uncommon): name at top
      const firstName = 'firstName' in card ? card.firstName ?? '' : ''
      const lastName = 'lastName' in card ? card.lastName ?? '' : ''
      const fullName = `${firstName} ${lastName}`.trim()
      drawNationalTeamName(ctx, fullName, layout)

      // Bottom bar with team name and jersey number
      const photographer = card.photographer ?? ''
      const teamName = team?.name ?? config.branding?.defaultTeamName ?? 'NATIONAL TEAM'
      const jerseyNumber = 'jerseyNumber' in card ? card.jerseyNumber ?? '' : ''
      const bottomText = jerseyNumber ? `${teamName} #${jerseyNumber}` : teamName
      drawBottomBar(ctx, photographer, bottomText, layout, 'uncommon', cameraImg)

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
        drawBottomBar(ctx, photographer, position, layout, rarity, cameraImg)
      } else {
        // Position and number in top-right (jersey number is optional for some card types like team-staff)
        if (position) {
          const jerseyNumber = 'jerseyNumber' in card ? card.jerseyNumber : undefined
          drawPositionNumber(ctx, position, jerseyNumber, layout)
        }

        // Bottom bar with team name
        const teamName = team?.name ?? ''
        drawBottomBar(ctx, photographer, teamName, layout, rarity, cameraImg)
      }
    }

    if (overlayImg && overlayPlacement === 'aboveText') {
      drawOverlay(ctx, overlayImg)
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
