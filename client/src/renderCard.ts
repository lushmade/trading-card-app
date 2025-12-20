import {
  CARD_HEIGHT,
  CARD_WIDTH,
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

const FONT_SANS = '"Sora", "Avenir Next", "Helvetica Neue", system-ui, sans-serif'
const FONT_DISPLAY = '"Fraunces", "Iowan Old Style", serif'

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
  classic: {
    id: 'classic',
    label: 'Classic',
  },
  noir: {
    id: 'noir',
    label: 'Noir',
    theme: {
      gradientStart: 'rgba(10, 10, 15, 0)',
      gradientEnd: 'rgba(10, 10, 15, 0.92)',
      border: 'rgba(255, 255, 255, 0.18)',
      accent: 'rgba(255, 255, 255, 0.7)',
      label: '#ffffff',
      nameColor: '#ffffff',
      meta: '#ffffff',
      watermark: 'rgba(248, 250, 252, 0.2)',
    },
  },
}

const DEFAULT_TEMPLATE_FLAGS: TemplateFlags = {
  showGradient: true,
  showBorders: true,
  showWatermarkJersey: true,
}

const overlayCache = new Map<string, Promise<HTMLImageElement | null>>()

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
    FALLBACK_TEMPLATES.classic

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

async function loadOverlay(
  overlayKey: string | undefined,
  resolveAssetUrl: (key: string) => string
) {
  if (!overlayKey) return null
  const url = resolveAssetUrl(overlayKey)
  const cached = overlayCache.get(url)
  if (cached) return cached
  const promise = loadImage(url).catch(() => null)
  overlayCache.set(url, promise)
  return promise
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

function drawOutlinedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  strokeWidth = 3
) {
  ctx.strokeStyle = 'black'
  ctx.lineWidth = strokeWidth
  ctx.lineJoin = 'round'
  ctx.strokeText(text, x, y)
  ctx.fillText(text, x, y)
}

function fillTextWithLetterSpacing(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  spacingPx: number,
  strokeWidth = 2
) {
  ctx.strokeStyle = 'black'
  ctx.lineWidth = strokeWidth
  ctx.lineJoin = 'round'
  let cursor = x
  for (const ch of text) {
    ctx.strokeText(ch, cursor, y)
    ctx.fillText(ch, cursor, y)
    cursor += ctx.measureText(ch).width + spacingPx
  }
}

function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  initialSize: number,
  minSize: number,
  fontFamily: string,
  fontWeight = 'bold'
) {
  let size = initialSize
  while (size > minSize) {
    ctx.font = `${fontWeight} ${size}px ${fontFamily}`
    if (ctx.measureText(text).width <= maxWidth) {
      return size
    }
    size -= 2
  }
  ctx.font = `${fontWeight} ${minSize}px ${fontFamily}`
  return minSize
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

function getCardTypeLabel(card: Card, config: TournamentConfig) {
  const entry = config.cardTypes.find((type) => type.type === card.cardType)
  return entry?.label ?? card.cardType
}

function getCardTypeConfig(card: Card, config: TournamentConfig) {
  return config.cardTypes.find((type) => type.type === card.cardType)
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
  const { card, config, imageUrl, resolveAssetUrl, templateId } = input
  const { templateSnapshot } = resolveTemplateSnapshot({ card, config, templateId })
  const { theme, flags, overlayKey, overlayPlacement } = templateSnapshot

  if (document.fonts?.ready) {
    await document.fonts.ready
  }

  const canvas = document.createElement('canvas')
  canvas.width = CARD_WIDTH
  canvas.height = CARD_HEIGHT
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    throw new Error('Could not get canvas context')
  }

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  const img = await loadImage(imageUrl)
  const crop = card.photo?.crop ?? { x: 0, y: 0, w: 1, h: 1, rotateDeg: 0 }
  drawCroppedImage(ctx, img, crop, 0, 0, CARD_WIDTH, CARD_HEIGHT)

  if (flags.showGradient) {
    const overlayGradient = ctx.createLinearGradient(0, CARD_HEIGHT - 350, 0, CARD_HEIGHT)
    overlayGradient.addColorStop(0, theme.gradientStart)
    overlayGradient.addColorStop(1, theme.gradientEnd)
    ctx.fillStyle = overlayGradient
    ctx.fillRect(0, CARD_HEIGHT - 350, CARD_WIDTH, 350)
  }

  if (flags.showBorders) {
    ctx.strokeStyle = theme.border
    ctx.lineWidth = 2
    ctx.strokeRect(20, 20, CARD_WIDTH - 40, CARD_HEIGHT - 40)

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)'
    ctx.lineWidth = 1
    ctx.strokeRect(30, 30, CARD_WIDTH - 60, CARD_HEIGHT - 60)
  }

  const overlayImg = await loadOverlay(overlayKey, resolveAssetUrl)
  if (overlayImg && overlayPlacement !== 'aboveText') {
    if (overlayImg.naturalWidth !== CARD_WIDTH || overlayImg.naturalHeight !== CARD_HEIGHT) {
      console.warn('Overlay is not 825x1125; scaling to fit.', overlayImg.naturalWidth, overlayImg.naturalHeight)
    }
    ctx.drawImage(overlayImg, 0, 0, CARD_WIDTH, CARD_HEIGHT)
  }

  const cardLabel = getCardTypeLabel(card, config).toUpperCase()
  ctx.font = `13px ${FONT_SANS}`
  ctx.fillStyle = theme.label
  ctx.textAlign = 'left'
  fillTextWithLetterSpacing(ctx, cardLabel, 50, 45, 2.5)

  const cardTypeConfig = getCardTypeConfig(card, config)
  const team = getTeamInfo(card, config)
  const logoKey =
    card.cardType === 'player' || card.cardType === 'team-staff'
      ? team?.logoKey
      : card.cardType === 'tournament-staff' || card.cardType === 'rare'
        ? config.branding.tournamentLogoKey
        : cardTypeConfig?.logoOverrideKey ?? config.branding.orgLogoKey

  const logoImg = await loadImageSafe(logoKey ? resolveAssetUrl(logoKey) : null)
  if (logoImg) {
    drawLogo(ctx, logoImg, CARD_WIDTH - 170, 40, 120, 80)
  }

  if (
    flags.showWatermarkJersey &&
    card.cardType !== 'rare' &&
    cardTypeConfig?.showJerseyNumber &&
    card.jerseyNumber
  ) {
    ctx.font = `bold 130px ${FONT_SANS}`
    ctx.fillStyle = theme.watermark
    ctx.textAlign = 'right'
    ctx.fillText(card.jerseyNumber, CARD_WIDTH - 50, 155)
  }

  if (card.cardType === 'rare') {
    const title = card.title ?? 'Rare Card'
    const caption = card.caption ?? ''

    ctx.strokeStyle = theme.accent
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(120, CARD_HEIGHT / 2 - 40)
    ctx.lineTo(CARD_WIDTH - 120, CARD_HEIGHT / 2 - 40)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(120, CARD_HEIGHT / 2 + 40)
    ctx.lineTo(CARD_WIDTH - 120, CARD_HEIGHT / 2 + 40)
    ctx.stroke()

    const titleSize = fitText(ctx, title, CARD_WIDTH - 200, 52, 28, FONT_DISPLAY)
    ctx.font = `bold ${titleSize}px ${FONT_DISPLAY}`
    ctx.fillStyle = theme.nameColor
    ctx.textAlign = 'center'
    drawOutlinedText(ctx, title, CARD_WIDTH / 2, CARD_HEIGHT / 2 - 5, 4)

    if (caption) {
      ctx.font = `20px ${FONT_SANS}`
      ctx.fillStyle = theme.meta
      drawOutlinedText(ctx, caption, CARD_WIDTH / 2, CARD_HEIGHT / 2 + 30, 2)
    }
  } else {
    const fullName = [card.firstName, card.lastName].filter(Boolean).join(' ').trim()
    const nameText = fullName || 'Player Name'
    const nameFontSize = fitText(ctx, nameText, CARD_WIDTH - 100, 56, 34, FONT_DISPLAY)
    ctx.fillStyle = theme.nameColor
    ctx.textAlign = 'left'
    ctx.font = `bold ${nameFontSize}px ${FONT_DISPLAY}`
    drawOutlinedText(ctx, nameText, 50, CARD_HEIGHT - 180, 4)

    const positionTeam = [card.position, team?.name].filter(Boolean).join(' / ')
    ctx.font = `28px ${FONT_SANS}`
    ctx.fillStyle = theme.meta
    drawOutlinedText(ctx, positionTeam || 'Position / Team', 50, CARD_HEIGHT - 130, 2)

    if (cardTypeConfig?.showJerseyNumber && card.jerseyNumber) {
      ctx.font = `bold 36px ${FONT_SANS}`
      ctx.fillStyle = theme.meta
      drawOutlinedText(ctx, `#${card.jerseyNumber}`, 50, CARD_HEIGHT - 80, 3)
    }
  }

  if (card.photographer) {
    ctx.font = `18px ${FONT_SANS}`
    ctx.fillStyle = theme.label
    ctx.textAlign = 'right'
    drawOutlinedText(ctx, `Photo: ${card.photographer}`, CARD_WIDTH - 50, CARD_HEIGHT - 40, 2)
  }

  if (overlayImg && overlayPlacement === 'aboveText') {
    if (overlayImg.naturalWidth !== CARD_WIDTH || overlayImg.naturalHeight !== CARD_HEIGHT) {
      console.warn('Overlay is not 825x1125; scaling to fit.', overlayImg.naturalWidth, overlayImg.naturalHeight)
    }
    ctx.drawImage(overlayImg, 0, 0, CARD_WIDTH, CARD_HEIGHT)
  }

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
