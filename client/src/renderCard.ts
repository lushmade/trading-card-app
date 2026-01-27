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

function drawPositionNumber(ctx: CanvasRenderingContext2D, position: string, number: string) {
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
  ctx.lineJoin = 'round'
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

  // Measure text widths to size boxes dynamically (with letter spacing)
  ctx.font = `500 italic ${lastNameSize}px ${FONT_AMIFER}`
  ctx.letterSpacing = `${letterSpacing.lastName}px`
  const lastNameText = lastName.toUpperCase()
  const lastNameWidth = ctx.measureText(lastNameText).width
  const lnBoxWidth = lastNameWidth + leftPadding + rightPadding + boxExtension

  ctx.font = `500 italic ${firstNameSize}px ${FONT_AMIFER}`
  ctx.letterSpacing = `${letterSpacing.firstName}px`
  const firstNameText = firstName.toUpperCase()
  const firstNameWidth = ctx.measureText(firstNameText).width
  const fnBoxWidth = firstNameWidth + leftPadding + rightPadding + boxExtension

  // Position at anchor point (right edge of boxes) and rotate
  ctx.translate(anchorX, anchorY)
  ctx.rotate(radians)

  // First name box Y position (above last name)
  const fnBoxY = -lastNameBox.height / 2 - firstNameBox.height

  // Draw first name box FIRST (light blue with white border) - so last name box overlaps on top
  ctx.fillStyle = USQC26_COLORS.secondary
  ctx.fillRect(-fnBoxWidth + boxExtension, fnBoxY, fnBoxWidth, firstNameBox.height)
  ctx.strokeStyle = USQC26_COLORS.white
  ctx.lineWidth = firstNameBox.borderWidth
  ctx.strokeRect(-fnBoxWidth + boxExtension, fnBoxY, fnBoxWidth, firstNameBox.height)

  // Draw first name text (dark blue with white stroke)
  ctx.font = `500 italic ${firstNameSize}px ${FONT_AMIFER}`
  ctx.letterSpacing = `${letterSpacing.firstName}px`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.miterLimit = 2
  const fnTextY = fnBoxY + firstNameBox.height / 2 + textYOffset
  // Draw white stroke first
  ctx.strokeStyle = USQC26_COLORS.white
  ctx.lineWidth = firstNameBox.strokeWidth
  ctx.strokeText(firstNameText, -rightPadding, fnTextY)
  // Then fill with primary color
  ctx.fillStyle = USQC26_COLORS.primary
  ctx.fillText(firstNameText, -rightPadding, fnTextY)

  // Last name box Y position (overlapping first name's bottom border)
  const lnBoxY = -lastNameBox.height / 2

  // Draw last name box ON TOP (white with light blue border)
  ctx.fillStyle = USQC26_COLORS.white
  ctx.fillRect(-lnBoxWidth + boxExtension, lnBoxY, lnBoxWidth, lastNameBox.height)
  ctx.strokeStyle = USQC26_COLORS.secondary
  ctx.lineWidth = lastNameBox.borderWidth
  ctx.strokeRect(-lnBoxWidth + boxExtension, lnBoxY, lnBoxWidth, lastNameBox.height)

  // Draw last name text (white with #1B4278 stroke)
  ctx.font = `500 italic ${lastNameSize}px ${FONT_AMIFER}`
  ctx.letterSpacing = `${letterSpacing.lastName}px`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.miterLimit = 2
  // Draw primary color stroke first
  ctx.strokeStyle = USQC26_COLORS.primary
  ctx.lineWidth = lastNameBox.strokeWidth
  ctx.strokeText(lastNameText, -rightPadding, textYOffset)
  // Then fill with white
  ctx.fillStyle = USQC26_COLORS.white
  ctx.fillText(lastNameText, -rightPadding, textYOffset)

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

  // 4. Draw team logo
  const team = getTeamInfo(card, config)
  const logoKey = team?.logoKey || config.branding.tournamentLogoKey
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
    // Standard player card
    // Note: Name boxes are drawn earlier (before frame) so they appear underneath

    // Position and number
    if ('position' in card && card.position && 'jerseyNumber' in card && card.jerseyNumber) {
      drawPositionNumber(ctx, card.position, card.jerseyNumber)
    }

    // Bottom bar
    const photographer = card.photographer ?? ''
    const teamName = team?.name ?? ''
    const rarity = card.rarity ?? 'common'
    drawBottomBar(ctx, photographer, teamName, rarity, cameraImg)
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
