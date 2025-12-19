import { Hono } from 'hono'
import { Resource } from 'sst'
import { randomUUID } from 'node:crypto'
import { createPresignedPost } from '@aws-sdk/s3-presigned-post'
import { S3Client } from '@aws-sdk/client-s3'
import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import type { ApiResponse, CardDesign, CardStatus, CropRect } from 'shared'

const app = new Hono()

// Note: CORS is handled by Lambda Function URL configuration, not Hono middleware

const s3 = new S3Client({})
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024
const ALLOWED_UPLOAD_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const ALLOWED_RENDER_TYPES = new Set(['image/png'])
const RENDER_EXTENSION = 'png'

type PresignKind = 'original' | 'crop' | 'render'

type PresignRequest = {
  cardId: string
  contentType: string
  contentLength: number
  kind: PresignKind
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const nowIso = () => new Date().toISOString()

const isCardStatus = (value: unknown): value is CardStatus =>
  value === 'draft' || value === 'submitted' || value === 'rendered'

const toNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  return undefined
}

const toRotateDeg = (value: unknown): CropRect['rotateDeg'] | undefined => {
  const numeric = toNumber(value)

  if (numeric === 0 || numeric === 90 || numeric === 180 || numeric === 270) {
    return numeric
  }

  return undefined
}

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max)

const pickCrop = (value: unknown): CropRect | undefined => {
  if (!isRecord(value)) return undefined

  const rawX = toNumber(value.x)
  const rawY = toNumber(value.y)
  const rawW = toNumber(value.w)
  const rawH = toNumber(value.h)

  if (rawX === undefined || rawY === undefined || rawW === undefined || rawH === undefined) {
    return undefined
  }

  // Clamp values to valid ranges
  // x, y: 0 to 1
  // w, h: > 0 to 1
  const x = clamp(rawX, 0, 1)
  const y = clamp(rawY, 0, 1)
  const w = clamp(rawW, 0.001, 1) // minimum 0.1% width
  const h = clamp(rawH, 0.001, 1) // minimum 0.1% height

  // Ensure crop doesn't extend beyond image bounds
  const clampedW = Math.min(w, 1 - x)
  const clampedH = Math.min(h, 1 - y)

  const rotateDeg = toRotateDeg(value.rotateDeg) ?? 0

  return { x, y, w: clampedW, h: clampedH, rotateDeg }
}

const pickPhoto = (value: unknown): CardDesign['photo'] | undefined => {
  if (!isRecord(value)) return undefined

  const photo: CardDesign['photo'] = {}

  if (typeof value.originalKey === 'string') photo.originalKey = value.originalKey
  if (typeof value.cropKey === 'string') photo.cropKey = value.cropKey

  const width = toNumber(value.width)
  const height = toNumber(value.height)

  if (width !== undefined) photo.width = width
  if (height !== undefined) photo.height = height

  const crop = pickCrop(value.crop)
  if (crop) photo.crop = crop

  return Object.keys(photo).length > 0 ? photo : undefined
}

const isValidDimension = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

const isValidCropRect = (crop?: CropRect) => {
  if (!crop) return false

  const { x, y, w, h, rotateDeg } = crop

  if (![x, y, w, h].every((value) => typeof value === 'number' && Number.isFinite(value))) {
    return false
  }

  const rotateOk = rotateDeg === 0 || rotateDeg === 90 || rotateDeg === 180 || rotateDeg === 270
  if (!rotateOk) return false

  if (x < 0 || y < 0 || x > 1 || y > 1) return false
  if (w <= 0 || h <= 0 || w > 1 || h > 1) return false
  if (x + w > 1 || y + h > 1) return false

  return true
}

const getSubmitValidationError = (card: CardDesign) => {
  const photo = card.photo

  if (!photo) return 'photo is required before submitting'
  if (!photo.originalKey) return 'photo.originalKey is required before submitting'
  if (!isValidDimension(photo.width) || !isValidDimension(photo.height)) {
    return 'photo dimensions are required before submitting'
  }
  if (!isValidCropRect(photo.crop)) return 'photo.crop is required before submitting'

  return null
}

const validatePhotoKeys = (cardId: string, photo?: CardDesign['photo']) => {
  if (!photo) return null

  if (photo.originalKey && !photo.originalKey.startsWith(`uploads/original/${cardId}/`)) {
    return 'originalKey must belong to this card'
  }

  if (photo.cropKey && !photo.cropKey.startsWith(`uploads/crop/${cardId}/`)) {
    return 'cropKey must belong to this card'
  }

  return null
}

const pickCardInput = (
  input: Record<string, unknown>,
  options?: { allowStatus?: boolean }
): Partial<CardDesign> => {
  const data: Partial<CardDesign> = {}

  if (typeof input.templateId === 'string') data.templateId = input.templateId
  if (typeof input.type === 'string') data.type = input.type
  if (typeof input.teamName === 'string') data.teamName = input.teamName
  if (typeof input.position === 'string') data.position = input.position
  if (typeof input.jerseyNumber === 'string') data.jerseyNumber = input.jerseyNumber
  if (typeof input.firstName === 'string') data.firstName = input.firstName
  if (typeof input.lastName === 'string') data.lastName = input.lastName
  if (typeof input.photographer === 'string') data.photographer = input.photographer

  const photo = pickPhoto(input.photo)
  if (photo) data.photo = photo

  if (options?.allowStatus && isCardStatus(input.status)) {
    data.status = input.status
  }

  return data
}

const getExtension = (contentType: string) => {
  switch (contentType) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    default:
      return null
  }
}

const getUploadKey = (cardId: string, kind: PresignKind, contentType: string) => {
  const uploadId = randomUUID().slice(0, 8)

  if (kind === 'render') {
    return `renders/${cardId}/${uploadId}.${RENDER_EXTENSION}`
  }

  const ext = getExtension(contentType)
  if (!ext) return null

  const prefix = kind === 'original' ? 'uploads/original' : 'uploads/crop'
  return `${prefix}/${cardId}/${uploadId}.${ext}`
}

const getPublicPath = (key: string) => {
  if (key.startsWith('uploads/')) {
    return `/u/${key.slice('uploads/'.length)}`
  }

  if (key.startsWith('renders/')) {
    return `/r/${key.slice('renders/'.length)}`
  }

  return `/${key}`
}

const getJsonBody = async (c: { req: { json: () => Promise<unknown> } }) => {
  try {
    return await c.req.json()
  } catch {
    return null
  }
}

const badRequest = (c: { json: (data: unknown, status?: number) => Response }, message: string) =>
  c.json({ error: message }, 400)

app.get('/', (c) => c.text('Hello Hono!'))

app.get('/hello', (c) => {
  const data: ApiResponse = {
    message: 'Hello BHVR!',
    success: true,
  }

  return c.json(data, 200)
})

app.post('/uploads/presign', async (c) => {
  const body = await getJsonBody(c)
  if (!isRecord(body)) return badRequest(c, 'Invalid request body')

  const { cardId, contentType, contentLength, kind } = body as PresignRequest

  if (typeof cardId !== 'string' || cardId.trim() === '') {
    return badRequest(c, 'cardId is required')
  }

  if (typeof contentType !== 'string') {
    return badRequest(c, 'contentType is required')
  }

  if (kind !== 'original' && kind !== 'crop' && kind !== 'render') {
    return badRequest(c, 'kind is invalid')
  }

  // Verify card exists before issuing presigned URL (prevents orphan uploads)
  const existingCard = await ddb.send(
    new GetCommand({
      TableName: Resource.Cards.name,
      Key: { id: cardId },
    })
  )

  if (!existingCard.Item) {
    return c.json({ error: 'Card not found' }, 404)
  }

  const length = typeof contentLength === 'number' ? contentLength : Number(contentLength)

  if (!Number.isFinite(length) || length <= 0) {
    return badRequest(c, 'contentLength must be a positive number')
  }

  if (length > MAX_UPLOAD_BYTES) {
    return badRequest(c, 'File is too large')
  }

  const allowedTypes = kind === 'render' ? ALLOWED_RENDER_TYPES : ALLOWED_UPLOAD_TYPES

  if (!allowedTypes.has(contentType)) {
    return badRequest(c, 'contentType is not allowed')
  }

  const key = getUploadKey(cardId, kind, contentType)

  if (!key) {
    return badRequest(c, 'Unsupported contentType for this upload kind')
  }

  const { url, fields } = await createPresignedPost(s3, {
    Bucket: Resource.Media.name,
    Key: key,
    Fields: {
      'Content-Type': contentType,
    },
    Conditions: [
      ['content-length-range', 1, MAX_UPLOAD_BYTES],
      ['eq', '$Content-Type', contentType],
    ],
    Expires: 900,
  })
  const publicUrl = getPublicPath(key)

  return c.json({
    uploadUrl: url,
    key,
    publicUrl,
    method: 'POST',
    fields,
  })
})

app.post('/cards', async (c) => {
  const body = await getJsonBody(c)
  if (!isRecord(body)) return badRequest(c, 'Invalid request body')

  const now = nowIso()
  const id = randomUUID()

  const record: CardDesign = {
    id,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    ...pickCardInput(body),
  }

  const createPhotoKeyError = validatePhotoKeys(id, record.photo)
  if (createPhotoKeyError) {
    return badRequest(c, createPhotoKeyError)
  }

  await ddb.send(
    new PutCommand({
      TableName: Resource.Cards.name,
      Item: record,
    })
  )

  return c.json(record, 201)
})

app.get('/cards/:id', async (c) => {
  const id = c.req.param('id')

  const result = await ddb.send(
    new GetCommand({
      TableName: Resource.Cards.name,
      Key: { id },
    })
  )

  if (!result.Item) {
    return c.json({ error: 'Card not found' }, 404)
  }

  return c.json(result.Item)
})

app.patch('/cards/:id', async (c) => {
  const id = c.req.param('id')

  const existing = await ddb.send(
    new GetCommand({
      TableName: Resource.Cards.name,
      Key: { id },
    })
  )

  if (!existing.Item) {
    return c.json({ error: 'Card not found' }, 404)
  }

  const body = await getJsonBody(c)
  if (!isRecord(body)) return badRequest(c, 'Invalid request body')

  const updates = pickCardInput(body)
  const photoKeyError = validatePhotoKeys(id, updates.photo)
  if (photoKeyError) {
    return badRequest(c, photoKeyError)
  }
  const now = nowIso()

  const next: CardDesign = {
    ...(existing.Item as CardDesign),
    ...updates,
    id,
    updatedAt: now,
  }

  await ddb.send(
    new PutCommand({
      TableName: Resource.Cards.name,
      Item: next,
    })
  )

  return c.json(next)
})

app.post('/cards/:id/submit', async (c) => {
  const id = c.req.param('id')

  const existing = await ddb.send(
    new GetCommand({
      TableName: Resource.Cards.name,
      Key: { id },
    })
  )

  if (!existing.Item) {
    return c.json({ error: 'Card not found' }, 404)
  }

  const card = existing.Item as CardDesign

  // Enforce status transition: only draft can be submitted (idempotent return)
  if (card.status !== 'draft') {
    return c.json(card)
  }

  const body = await getJsonBody(c)
  if (!isRecord(body)) return badRequest(c, 'Invalid request body')

  // Require renderKey
  if (typeof body.renderKey !== 'string' || body.renderKey.trim() === '') {
    return badRequest(c, 'renderKey is required')
  }

  const renderKey = body.renderKey as string

  // Validate renderKey format: must be renders/<cardId>/<id>.png
  const renderKeyPattern = new RegExp(`^renders/${id}/[a-f0-9-]+\\.png$`)
  if (!renderKeyPattern.test(renderKey)) {
    return badRequest(c, 'Invalid renderKey format')
  }

  const submitValidationError = getSubmitValidationError(card)
  if (submitValidationError) {
    return badRequest(c, submitValidationError)
  }

  const now = nowIso()
  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: Resource.Cards.name,
        Key: { id },
        UpdateExpression: 'SET #renderKey = :renderKey, #status = :status, #updatedAt = :updatedAt',
        ConditionExpression: '#status = :draft',
        ExpressionAttributeNames: {
          '#renderKey': 'renderKey',
          '#status': 'status',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':renderKey': renderKey,
          ':status': 'submitted',
          ':draft': 'draft',
          ':updatedAt': now,
        },
        ReturnValues: 'ALL_NEW',
      })
    )

    if (result.Attributes) {
      return c.json(result.Attributes)
    }

    const next: CardDesign = {
      ...card,
      renderKey,
      status: 'submitted',
      updatedAt: now,
    }
    return c.json(next)
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException || (isRecord(err) && err.name === 'ConditionalCheckFailedException')) {
      const latest = await ddb.send(
        new GetCommand({
          TableName: Resource.Cards.name,
          Key: { id },
        })
      )

      if (latest.Item) {
        return c.json(latest.Item)
      }

      return c.json({ error: 'Card not found' }, 404)
    }
    throw err
  }
})

app.notFound((c) => c.json({ error: 'Not Found' }, 404))

app.onError((err, c) => {
  console.error('Server error:', err)
  const message = err instanceof Error ? err.message : 'Internal Server Error'
  return c.json({ error: message }, 500)
})

export default app
