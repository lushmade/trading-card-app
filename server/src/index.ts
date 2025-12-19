import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { Resource } from 'sst'
import { randomUUID } from 'node:crypto'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import type { ApiResponse, CardDesign, CardStatus, CropRect } from 'shared'

const app = new Hono()

app.use(cors())

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

const pickCrop = (value: unknown): CropRect | undefined => {
  if (!isRecord(value)) return undefined

  const x = toNumber(value.x)
  const y = toNumber(value.y)
  const w = toNumber(value.w)
  const h = toNumber(value.h)

  if (x === undefined || y === undefined || w === undefined || h === undefined) {
    return undefined
  }

  const rotateDeg = toRotateDeg(value.rotateDeg) ?? 0

  return { x, y, w, h, rotateDeg }
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

const pickCardInput = (
  input: Record<string, unknown>,
  options?: { allowStatus?: boolean }
): Partial<CardDesign> => {
  const data: Partial<CardDesign> = {}

  if (typeof input.templateId === 'string') data.templateId = input.templateId
  if (typeof input.type === 'string') data.type = input.type
  if (typeof input.teamId === 'string') data.teamId = input.teamId
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

  const command = new PutObjectCommand({
    Bucket: Resource.Media.name,
    Key: key,
    ContentType: contentType,
  })

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 900 })
  const publicUrl = getPublicPath(key)

  return c.json({
    uploadUrl,
    key,
    publicUrl,
    method: 'PUT',
    headers: { 'Content-Type': contentType },
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

  const body = await getJsonBody(c)
  if (body !== null && !isRecord(body)) return badRequest(c, 'Invalid request body')

  const now = nowIso()
  const next: CardDesign = {
    ...(existing.Item as CardDesign),
    renderKey:
      typeof body?.renderKey === 'string'
        ? body.renderKey
        : (existing.Item as CardDesign).renderKey,
    status: 'submitted',
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

app.notFound((c) => c.json({ error: 'Not Found' }, 404))

app.onError((err, c) => {
  console.error('Server error:', err)
  return c.json({ error: 'Internal Server Error' }, 500)
})

export default app
