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
  const { x, y, width, height, borderRadius, borderWidth, fontSize } = USQC26_LAYOUT.eventBadge

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
  ctx.fillText(text, x + width / 2, y + height / 2)

  ctx.restore()
}

function drawPositionNumber(ctx: CanvasRenderingContext2D, position: string, number: string) {
  const { centerX, positionY, numberY, positionFontSize, numberFontSize, positionLetterSpacing, numberLetterSpacing } = USQC26_LAYOUT.positionNumber

  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Position label
  ctx.font = `500 ${positionFontSize}px ${FONT_AMIFER}`
  ctx.fillStyle = USQC26_COLORS.primary
  ctx.letterSpacing = `${positionLetterSpacing}px`
  ctx.fillText(position.toUpperCase(), centerX, positionY)

  // Jersey number
  ctx.font = `500 ${numberFontSize}px ${FONT_AMIFER}`
  ctx.fillStyle = USQC26_COLORS.numberOverlay
  ctx.letterSpacing = `${numberLetterSpacing}px`
  ctx.fillText(number, centerX, numberY)

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
  ctx.drawImage(img, x, y, width, height)
}

function drawAngledNameBoxes(
  ctx: CanvasRenderingContext2D,
  firstName: string,
  lastName: string
) {
  const { rotation, firstNameBox, lastNameBox, firstNameSize, lastNameSize } = USQC26_LAYOUT.name
  const radians = (rotation * Math.PI) / 180

  // Anchor point - where the left edge of boxes meets the visible card area
  // Boxes extend to the RIGHT (off the card), text is left-aligned at this point
  const anchorX = 500
  const anchorY = 870

  ctx.save()

  // Position at anchor point and rotate
  ctx.translate(anchorX, anchorY)
  ctx.rotate(radians)

  // Draw last name box (white with light blue border) - extends to the right
  const lnBoxY = -lastNameBox.height / 2
  ctx.fillStyle = USQC26_COLORS.white
  ctx.fillRect(0, lnBoxY, lastNameBox.width, lastNameBox.height)
  ctx.strokeStyle = USQC26_COLORS.secondary
  ctx.lineWidth = lastNameBox.borderWidth
  ctx.strokeRect(0, lnBoxY, lastNameBox.width, lastNameBox.height)

  // Draw last name text (white with dark outline for visibility on white box)
  ctx.font = `500 italic ${lastNameSize}px ${FONT_AMIFER}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  const textPadding = 16
  // Draw thick outline first for visibility
  ctx.strokeStyle = USQC26_COLORS.primary
  ctx.lineWidth = 4
  ctx.lineJoin = 'round'
  ctx.miterLimit = 2
  ctx.strokeText(lastName.toUpperCase(), textPadding, 0)
  // Then fill with white
  ctx.fillStyle = USQC26_COLORS.white
  ctx.fillText(lastName.toUpperCase(), textPadding, 0)

  // Draw first name box (light blue with white border) - positioned above
  const fnBoxY = lnBoxY - firstNameBox.height - 8
  ctx.fillStyle = USQC26_COLORS.secondary
  ctx.fillRect(0, fnBoxY, firstNameBox.width, firstNameBox.height)
  ctx.strokeStyle = USQC26_COLORS.white
  ctx.lineWidth = firstNameBox.borderWidth
  ctx.strokeRect(0, fnBoxY, firstNameBox.width, firstNameBox.height)

  // Draw first name text (dark blue on light blue box)
  ctx.font = `500 italic ${firstNameSize}px ${FONT_AMIFER}`
  ctx.fillStyle = USQC26_COLORS.primary
  ctx.textAlign = 'left'
  const fnTextY = fnBoxY + firstNameBox.height / 2
  ctx.fillText(firstName.toUpperCase(), textPadding, fnTextY)

  ctx.restore()
}

function drawBottomBar(
  ctx: CanvasRenderingContext2D,
  photographer: string,
  teamName: string,
  rarity: 'common' | 'uncommon' | 'rare' | 'super-rare' = 'common'
) {
  const { y, cameraIcon, photographerX, rarityX, raritySize, teamNameX, fontSize, letterSpacing } = USQC26_LAYOUT.bottomBar
  const textY = y + 13 // Center text vertically in 26px bar

  ctx.save()
  ctx.font = `500 ${fontSize}px ${FONT_AMIFER}`
  ctx.fillStyle = USQC26_COLORS.primary
  ctx.textBaseline = 'middle'

  // Camera icon (simple rectangle placeholder - can be replaced with actual icon)
  ctx.fillStyle = USQC26_COLORS.primary
  roundedRect(ctx, cameraIcon.x, cameraIcon.y, cameraIcon.width, cameraIcon.height, 2)
  ctx.fill()

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

  if (document.fonts?.ready) {
    await document.fonts.ready
  }

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  // 1. Draw the photo (full bleed)
  const img = await loadImage(imageUrl)
  drawCroppedImage(ctx, img, crop, 0, 0, CARD_WIDTH, CARD_HEIGHT)

  // 2. Draw the frame overlay
  drawFrame(ctx)

  // 3. Draw team logo
  const team = getTeamInfo(card, config)
  const logoKey = team?.logoKey || config.branding.tournamentLogoKey
  const logoImg = await loadImageSafe(logoKey ? resolveAssetUrl(logoKey) : null)
  if (logoImg) {
    const { x, y, maxWidth, maxHeight } = USQC26_LAYOUT.teamLogo
    drawLogo(ctx, logoImg, x, y, maxWidth, maxHeight)
  }

  // 4. Draw event indicator badge (if configured)
  const eventIndicator = config.branding.eventIndicator
  if (eventIndicator) {
    drawEventBadge(ctx, eventIndicator)
  }

  // 5. Draw card-type-specific content
  if (card.cardType === 'rare') {
    // Rare card: centered title/caption
    const title = 'title' in card ? card.title ?? 'Rare Card' : 'Rare Card'
    const caption = 'caption' in card ? card.caption ?? '' : ''
    drawRareCardContent(ctx, title, caption)

    // Bottom bar for rare card
    const photographer = card.photographer ?? ''
    drawBottomBar(ctx, photographer, 'RARE CARD', 'rare')

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
    drawBottomBar(ctx, photographer, teamName, 'super-rare')

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
    drawBottomBar(ctx, photographer, bottomText, 'uncommon')

  } else {
    // Standard player card
    const firstName = 'firstName' in card ? card.firstName ?? '' : ''
    const lastName = 'lastName' in card ? card.lastName ?? '' : ''

    // Position and number
    if ('position' in card && card.position && 'jerseyNumber' in card && card.jerseyNumber) {
      drawPositionNumber(ctx, card.position, card.jerseyNumber)
    }

    // Angled name boxes
    if (firstName || lastName) {
      drawAngledNameBoxes(ctx, firstName, lastName)
    }

    // Bottom bar
    const photographer = card.photographer ?? ''
    const teamName = team?.name ?? ''
    const rarity = card.rarity ?? 'common'
    drawBottomBar(ctx, photographer, teamName, rarity)
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
