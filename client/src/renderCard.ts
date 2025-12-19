import { CARD_WIDTH, CARD_HEIGHT, type CropRect } from 'shared'

const FONT_SANS = '"Sora", "Avenir Next", "Helvetica Neue", system-ui, sans-serif'
const FONT_DISPLAY = '"Fraunces", "Iowan Old Style", serif'

export type RenderCardInput = {
  imageUrl: string
  crop: CropRect
  firstName: string
  lastName: string
  position: string
  team: string
  jerseyNumber: string
  photographer: string
}

/**
 * Load an image from a URL
 */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = url
  })
}

/**
 * Apply crop and rotation to get the cropped region
 * Crop values are normalized (0-1), rotateDeg is 0/90/180/270
 */
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

  // Calculate source rectangle in image pixels
  const srcX = x * img.naturalWidth
  const srcY = y * img.naturalHeight
  const srcW = w * img.naturalWidth
  const srcH = h * img.naturalHeight

  ctx.save()

  // Move to destination center for rotation
  const centerX = destX + destW / 2
  const centerY = destY + destH / 2
  ctx.translate(centerX, centerY)
  ctx.rotate((rotateDeg * Math.PI) / 180)
  ctx.translate(-centerX, -centerY)

  // Draw the cropped region
  ctx.drawImage(img, srcX, srcY, srcW, srcH, destX, destY, destW, destH)

  ctx.restore()
}

function fillTextWithLetterSpacing(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  spacingPx: number
) {
  let cursor = x
  for (const ch of text) {
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

/**
 * Render a trading card to a canvas and return as PNG blob
 */
export async function renderCard(input: RenderCardInput): Promise<Blob> {
  const { imageUrl, crop, firstName, lastName, position, team, jerseyNumber, photographer } = input

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

  // Load and draw the player photo full-bleed
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  const img = await loadImage(imageUrl)
  drawCroppedImage(ctx, img, crop, 0, 0, CARD_WIDTH, CARD_HEIGHT)

  // Gradient overlay at bottom for text readability
  const overlayGradient = ctx.createLinearGradient(0, CARD_HEIGHT - 350, 0, CARD_HEIGHT)
  overlayGradient.addColorStop(0, 'rgba(15, 23, 42, 0)')
  overlayGradient.addColorStop(1, 'rgba(15, 23, 42, 0.85)')
  ctx.fillStyle = overlayGradient
  ctx.fillRect(0, CARD_HEIGHT - 350, CARD_WIDTH, 350)

  // Card border
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)'
  ctx.lineWidth = 2
  ctx.strokeRect(20, 20, CARD_WIDTH - 40, CARD_HEIGHT - 40)

  // Inner accent line
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)'
  ctx.lineWidth = 1
  ctx.strokeRect(30, 30, CARD_WIDTH - 60, CARD_HEIGHT - 60)

  // Top badge/label
  ctx.font = `14px ${FONT_SANS}`
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
  ctx.textAlign = 'left'
  fillTextWithLetterSpacing(ctx, 'TRADING CARD', 50, 45, 3)

  // Jersey number (large watermark, top right)
  if (jerseyNumber) {
    ctx.font = `bold 140px ${FONT_SANS}`
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)'
    ctx.textAlign = 'right'
    ctx.fillText(jerseyNumber, CARD_WIDTH - 40, 150)
  }

  // Player name (bottom area, over gradient)
  const fullName = `${firstName} ${lastName}`.trim()
  const nameText = fullName || 'Player Name'
  const nameFontSize = fitText(ctx, nameText, CARD_WIDTH - 100, 56, 34, FONT_DISPLAY)
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'left'
  ctx.font = `bold ${nameFontSize}px ${FONT_DISPLAY}`
  ctx.fillText(nameText, 50, CARD_HEIGHT - 180)

  // Position and team
  const positionTeam = [position, team].filter(Boolean).join(' / ')
  ctx.font = `28px ${FONT_SANS}`
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
  ctx.fillText(positionTeam || 'Position / Team', 50, CARD_HEIGHT - 130)

  // Jersey number (small, below position)
  if (jerseyNumber) {
    ctx.font = `bold 36px ${FONT_SANS}`
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
    ctx.fillText(`#${jerseyNumber}`, 50, CARD_HEIGHT - 80)
  }

  // Photographer credit (bottom right)
  if (photographer) {
    ctx.font = `18px ${FONT_SANS}`
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'
    ctx.textAlign = 'right'
    ctx.fillText(`Photo: ${photographer}`, CARD_WIDTH - 50, CARD_HEIGHT - 40)
  }

  // Convert to blob
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
