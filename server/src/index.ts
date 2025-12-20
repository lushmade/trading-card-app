import { Hono, type MiddlewareHandler } from 'hono'
import { Resource } from 'sst'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { text as streamToText } from 'node:stream/consumers'
import JSZip from 'jszip'
import { createPresignedPost } from '@aws-sdk/s3-presigned-post'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb'
import type { ApiResponse, Card, CardStatus, CardType, CropRect, RenderMeta, TournamentConfig, TournamentListEntry } from 'shared'
import {
  ALLOWED_RENDER_TYPES as ALLOWED_RENDER_TYPES_LIST,
  ALLOWED_UPLOAD_TYPES as ALLOWED_UPLOAD_TYPES_LIST,
  JERSEY_PATTERN,
  MAX_CAPTION_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PHOTOGRAPHER_LENGTH,
  MAX_POSITION_LENGTH,
  MAX_TEAM_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_UPLOAD_BYTES,
  USQC_2025_CONFIG,
  USQC_2025_TOURNAMENT,
} from 'shared'

const app = new Hono()

// Note: CORS is handled by Lambda Function URL configuration, not Hono middleware

const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 180
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const adminAuthFailures = new Map<string, { count: number; resetAt: number }>()

const getClientIp = (c: { req: { header: (name: string) => string | undefined } }) =>
  c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
  c.req.header('cf-connecting-ip') ||
  c.req.header('x-real-ip') ||
  'unknown'

const shouldRateLimit = (method: string) =>
  method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE'

const s3 = new S3Client({})
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))

const ALLOWED_UPLOAD_TYPES: Set<string> = new Set(ALLOWED_UPLOAD_TYPES_LIST)
const ALLOWED_RENDER_TYPES: Set<string> = new Set(ALLOWED_RENDER_TYPES_LIST)
const RENDER_EXTENSION = 'png'
const CONFIG_LIST_KEY = 'config/tournaments.json'
const CONFIG_PREFIX = 'config/tournaments'

const MAX_TEMPLATE_LENGTH = 32
const EDIT_TOKEN_HEADER = 'x-edit-token'
const ADMIN_AUTH_WINDOW_MS = 10 * 60_000
const ADMIN_AUTH_MAX_FAILURES = 24

const CARD_TYPES: CardType[] = [
  'player',
  'team-staff',
  'media',
  'official',
  'tournament-staff',
  'rare',
]

type PresignKind = 'original' | 'crop' | 'render'

type PresignRequest = {
  cardId: string
  contentType: string
  contentLength: number
  kind: PresignKind
}

type CardInput = Partial<Card> & {
  firstName?: string
  lastName?: string
  title?: string
  caption?: string
  teamId?: string
  teamName?: string
  position?: string
  jerseyNumber?: string
  templateId?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const nowIso = () => new Date().toISOString()

const isCardStatus = (value: unknown): value is CardStatus =>
  value === 'draft' || value === 'submitted' || value === 'rendered'

// Validate IDs used in S3 paths to prevent path traversal and URL issues
const SAFE_ID_PATTERN = /^[a-z0-9-]{3,64}$/
const isSafeId = (value: unknown): value is string =>
  typeof value === 'string' && SAFE_ID_PATTERN.test(value)

const isCardType = (value: unknown): value is CardType =>
  typeof value === 'string' && CARD_TYPES.includes(value as CardType)

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

const normalizeString = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

const ensureMaxLength = (value: string, max: number, label: string) => {
  if (value.length > max) {
    return `${label} must be ${max} characters or fewer`
  }
  return null
}

const buildStatusCreatedAt = (status: CardStatus, createdAt: string) => `${status}#${createdAt}`

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

const pickPhoto = (value: unknown): Card['photo'] | undefined => {
  if (!isRecord(value)) return undefined

  const photo: Card['photo'] = {}

  const originalKey = normalizeString(value.originalKey)
  const cropKey = normalizeString(value.cropKey)
  if (originalKey) photo.originalKey = originalKey
  if (cropKey) photo.cropKey = cropKey

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

const validatePhotoKeys = (cardId: string, photo?: Card['photo']) => {
  if (!photo) return null

  if (photo.originalKey && !photo.originalKey.startsWith(`uploads/original/${cardId}/`)) {
    return 'originalKey must belong to this card'
  }

  if (photo.cropKey && !photo.cropKey.startsWith(`uploads/crop/${cardId}/`)) {
    return 'cropKey must belong to this card'
  }

  return null
}

const TEMPLATE_THEME_KEYS = [
  'gradientStart',
  'gradientEnd',
  'border',
  'accent',
  'label',
  'nameColor',
  'meta',
  'watermark',
] as const

const TEMPLATE_FLAG_KEYS = [
  'showGradient',
  'showBorders',
  'showWatermarkJersey',
] as const

const parseRenderMeta = (value: unknown, renderKey: string): RenderMeta | string => {
  if (!isRecord(value)) return 'renderMeta must be an object'

  const templateId = normalizeString(value.templateId)
  if (!templateId) return 'renderMeta.templateId is required'

  const renderedAt = normalizeString(value.renderedAt)
  if (!renderedAt) return 'renderMeta.renderedAt is required'

  const key = normalizeString(value.key) ?? renderKey
  if (key !== renderKey) return 'renderMeta.key must match renderKey'

  if (!isRecord(value.templateSnapshot)) return 'renderMeta.templateSnapshot is required'
  const snapshot = value.templateSnapshot

  const overlayKey = normalizeString(snapshot.overlayKey)

  if (!isRecord(snapshot.theme)) return 'renderMeta.templateSnapshot.theme is required'
  const themeSource = snapshot.theme
  const theme = {} as RenderMeta['templateSnapshot']['theme']
  for (const field of TEMPLATE_THEME_KEYS) {
    const raw = normalizeString(themeSource[field])
    if (!raw) return `renderMeta.templateSnapshot.theme.${field} is required`
    theme[field] = raw
  }

  if (!isRecord(snapshot.flags)) return 'renderMeta.templateSnapshot.flags is required'
  const flagsSource = snapshot.flags
  const flags = {} as RenderMeta['templateSnapshot']['flags']
  for (const field of TEMPLATE_FLAG_KEYS) {
    const raw = flagsSource[field]
    if (typeof raw !== 'boolean') {
      return `renderMeta.templateSnapshot.flags.${field} must be a boolean`
    }
    flags[field] = raw
  }

  const overlayPlacement = normalizeString(snapshot.overlayPlacement)
  if (overlayPlacement !== 'belowText' && overlayPlacement !== 'aboveText') {
    return 'renderMeta.templateSnapshot.overlayPlacement is invalid'
  }

  return {
    key,
    templateId,
    renderedAt,
    templateSnapshot: {
      overlayKey: overlayKey ?? undefined,
      theme,
      flags,
      overlayPlacement,
    },
  }
}

const validateCardFields = (card: CardInput) => {
  if (card.firstName) {
    const error = ensureMaxLength(card.firstName, MAX_NAME_LENGTH, 'firstName')
    if (error) return error
  }
  if (card.lastName) {
    const error = ensureMaxLength(card.lastName, MAX_NAME_LENGTH, 'lastName')
    if (error) return error
  }
  if (card.title) {
    const error = ensureMaxLength(card.title, MAX_TITLE_LENGTH, 'title')
    if (error) return error
  }
  if (card.caption) {
    const error = ensureMaxLength(card.caption, MAX_CAPTION_LENGTH, 'caption')
    if (error) return error
  }
  if (card.photographer) {
    const error = ensureMaxLength(card.photographer, MAX_PHOTOGRAPHER_LENGTH, 'photographer')
    if (error) return error
  }
  if (card.teamName) {
    const error = ensureMaxLength(card.teamName, MAX_TEAM_LENGTH, 'teamName')
    if (error) return error
  }
  if (card.teamId) {
    const error = ensureMaxLength(card.teamId, MAX_TEAM_LENGTH, 'teamId')
    if (error) return error
  }
  if (card.position) {
    const error = ensureMaxLength(card.position, MAX_POSITION_LENGTH, 'position')
    if (error) return error
  }
  if (card.templateId) {
    const error = ensureMaxLength(card.templateId, MAX_TEMPLATE_LENGTH, 'templateId')
    if (error) return error
  }
  if (card.jerseyNumber && !JERSEY_PATTERN.test(card.jerseyNumber)) {
    return 'jerseyNumber must be 1-2 digits'
  }

  return null
}

const getSubmitValidationError = (card: Card) => {
  if (!card.tournamentId) return 'tournamentId is required before submitting'
  if (!card.cardType || !isCardType(card.cardType)) {
    return 'cardType is required before submitting'
  }

  const fieldError = validateCardFields(card)
  if (fieldError) return fieldError

  const photo = card.photo
  if (!photo) return 'photo is required before submitting'
  if (!photo.originalKey) return 'photo.originalKey is required before submitting'
  if (!isValidDimension(photo.width) || !isValidDimension(photo.height)) {
    return 'photo dimensions are required before submitting'
  }
  if (!isValidCropRect(photo.crop)) return 'photo.crop is required before submitting'

  switch (card.cardType) {
    case 'rare':
      if (!card.title) return 'title is required before submitting'
      break
    default:
      if (!card.firstName) return 'firstName is required before submitting'
      if (!card.lastName) return 'lastName is required before submitting'
      if (!card.position) return 'position is required before submitting'
      break
  }

  if (card.cardType === 'player' || card.cardType === 'team-staff') {
    if (!card.teamId && !card.teamName) {
      return 'team is required before submitting'
    }
  }

  return null
}

const pickCardInput = (
  input: Record<string, unknown>,
  options?: { allowStatus?: boolean }
): CardInput => {
  const data: CardInput = {}

  const cardType = normalizeString(input.cardType) ?? normalizeString(input.type)
  if (cardType && isCardType(cardType)) data.cardType = cardType
  const tournamentId = normalizeString(input.tournamentId)
  if (tournamentId) data.tournamentId = tournamentId
  const templateId = normalizeString(input.templateId)
  if (templateId) data.templateId = templateId

  const teamId = normalizeString(input.teamId)
  if (teamId) data.teamId = teamId
  const teamName = normalizeString(input.teamName)
  if (teamName) data.teamName = teamName
  const position = normalizeString(input.position)
  if (position) data.position = position
  const jerseyNumber = normalizeString(input.jerseyNumber)
  if (jerseyNumber) data.jerseyNumber = jerseyNumber
  const firstName = normalizeString(input.firstName)
  if (firstName) data.firstName = firstName
  const lastName = normalizeString(input.lastName)
  if (lastName) data.lastName = lastName
  const photographer = normalizeString(input.photographer)
  if (photographer) data.photographer = photographer
  const title = normalizeString(input.title)
  if (title) data.title = title
  const caption = normalizeString(input.caption)
  if (caption) data.caption = caption

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
  if (key.startsWith('renders/')) {
    return `/r/${key.slice('renders/'.length)}`
  }

  if (key.startsWith('config/')) {
    return `/c/${key.slice('config/'.length)}`
  }

  return null
}

const toPublicCard = (card: Card) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { photo, editToken, ...rest } = card

  if (!photo?.crop) {
    return rest
  }

  return {
    ...rest,
    photo: {
      crop: photo.crop,
    },
  }
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

const bodyToString = async (body: unknown) => {
  if (!body) return ''
  if (typeof body === 'string') return body
  if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8')
  if (body instanceof ArrayBuffer) return Buffer.from(new Uint8Array(body)).toString('utf8')
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer).toString('utf8')
  if (body && typeof (body as { transformToString?: () => Promise<string> }).transformToString === 'function') {
    return (body as { transformToString: () => Promise<string> }).transformToString()
  }
  if (body instanceof Readable) {
    return streamToText(body)
  }
  return ''
}

const readJsonFromS3 = async <T>(key: string): Promise<T | null> => {
  try {
    const result = await s3.send(
      new GetObjectCommand({
        Bucket: Resource.Media.name,
        Key: key,
      })
    )
    const text = await bodyToString(result.Body)
    return text ? (JSON.parse(text) as T) : null
  } catch (err) {
    const name = isRecord(err) ? String(err.name ?? '') : ''
    if (name === 'NoSuchKey' || name === 'NotFound') return null
    throw err
  }
}

const writeJsonToS3 = async (key: string, value: unknown, options?: { cacheControl?: string }) => {
  await s3.send(
    new PutObjectCommand({
      Bucket: Resource.Media.name,
      Key: key,
      Body: JSON.stringify(value, null, 2),
      ContentType: 'application/json',
      CacheControl: options?.cacheControl ?? 'no-store',
    })
  )
}

const getConfigKey = (tournamentId: string, stage: 'draft' | 'published') =>
  `${CONFIG_PREFIX}/${tournamentId}/${stage}/config.json`

type UpdateDraft = {
  set: Record<string, unknown>
  remove: string[]
}

const pushSet = (draft: UpdateDraft, path: string, value: unknown) => {
  draft.set[path] = value
  draft.remove = draft.remove.filter((entry) => entry !== path)
}

const pushRemove = (draft: UpdateDraft, path: string) => {
  if (!draft.remove.includes(path)) {
    draft.remove.push(path)
  }
  delete draft.set[path]
}

const applyStringUpdate = (
  draft: UpdateDraft,
  value: unknown,
  path: string,
  maxLength: number,
  label: string
) => {
  if (value === undefined) return null
  if (value === null) {
    pushRemove(draft, path)
    return null
  }
  if (typeof value !== 'string') return `${label} must be a string`
  const trimmed = value.trim()
  if (!trimmed) {
    pushRemove(draft, path)
    return null
  }
  const error = ensureMaxLength(trimmed, maxLength, label)
  if (error) return error
  pushSet(draft, path, trimmed)
  return null
}

app.use('*', async (c, next) => {
  if (shouldRateLimit(c.req.method) || c.req.path.startsWith('/admin/')) {
    const ip = getClientIp(c)
    const now = Date.now()
    const entry = rateLimitMap.get(ip)
    if (!entry || now > entry.resetAt) {
      rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    } else {
      entry.count += 1
      if (entry.count > RATE_LIMIT_MAX) {
        return c.json({ error: 'Too many requests' }, 429)
      }
    }
  }

  await next()
})

// Admin auth middleware - requires Bearer token matching AdminPassword secret
const requireAdmin: MiddlewareHandler = async (c, next) => {
  const auth = c.req.header('Authorization')
  const expected = `Bearer ${Resource.AdminPassword.value}`
  const ip = getClientIp(c)
  const now = Date.now()
  const failure = adminAuthFailures.get(ip)

  if (failure && now <= failure.resetAt && failure.count > ADMIN_AUTH_MAX_FAILURES) {
    return c.json({ error: 'Too many attempts' }, 429)
  }

  if (auth !== expected) {
    const entry = adminAuthFailures.get(ip)
    if (!entry || now > entry.resetAt) {
      adminAuthFailures.set(ip, { count: 1, resetAt: now + ADMIN_AUTH_WINDOW_MS })
    } else {
      entry.count += 1
      if (entry.count > ADMIN_AUTH_MAX_FAILURES) {
        return c.json({ error: 'Too many attempts' }, 429)
      }
    }
    return c.json({ error: 'Unauthorized' }, 401)
  }

  adminAuthFailures.delete(ip)
  await next()
}

// Protect all admin routes
app.use('/admin/*', requireAdmin)

const FALLBACK_TOURNAMENTS: TournamentListEntry[] = [USQC_2025_TOURNAMENT]
const FALLBACK_CONFIGS: Record<string, TournamentConfig> = {
  [USQC_2025_CONFIG.id]: USQC_2025_CONFIG,
}

app.get('/', (c) => c.text('Hello Hono!'))

app.get('/hello', (c) => {
  const data: ApiResponse = {
    message: 'Hello BHVR!',
    success: true,
  }

  return c.json(data, 200)
})

app.get('/tournaments', async (c) => {
  const list = (await readJsonFromS3<TournamentListEntry[]>(CONFIG_LIST_KEY)) ?? FALLBACK_TOURNAMENTS
  // Only return published tournaments to public
  return c.json(list.filter((t) => t.published))
})

app.get('/tournaments/:id', async (c) => {
  const id = c.req.param('id')
  const config =
    (await readJsonFromS3<TournamentConfig>(getConfigKey(id, 'published'))) ??
    FALLBACK_CONFIGS[id]

  if (!config) {
    return c.json({ error: 'Tournament not found' }, 404)
  }

  return c.json(config)
})

app.get('/tournaments/:id/teams', async (c) => {
  const id = c.req.param('id')
  const config =
    (await readJsonFromS3<TournamentConfig>(getConfigKey(id, 'published'))) ??
    FALLBACK_CONFIGS[id]

  if (!config) {
    return c.json({ error: 'Tournament not found' }, 404)
  }

  return c.json(config.teams)
})

app.get('/admin/tournaments', async (c) => {
  const list = (await readJsonFromS3<TournamentListEntry[]>(CONFIG_LIST_KEY)) ?? FALLBACK_TOURNAMENTS
  return c.json(list)
})

app.get('/admin/tournaments/:id', async (c) => {
  const id = c.req.param('id')
  const draft = await readJsonFromS3<TournamentConfig>(getConfigKey(id, 'draft'))
  if (draft) return c.json(draft)

  const published = await readJsonFromS3<TournamentConfig>(getConfigKey(id, 'published'))
  if (published) return c.json(published)

  const fallback = FALLBACK_CONFIGS[id]
  if (fallback) return c.json(fallback)

  return c.json({ error: 'Tournament not found' }, 404)
})

app.post('/admin/tournaments', async (c) => {
  const body = await getJsonBody(c)
  if (!isRecord(body)) return badRequest(c, 'Invalid request body')

  const id = normalizeString(body.id)
  const name = normalizeString(body.name)
  const year = toNumber(body.year)

  if (!id) return badRequest(c, 'id is required')
  if (!isSafeId(id)) return badRequest(c, 'id must be 3-64 lowercase alphanumeric characters or hyphens')
  if (!name) return badRequest(c, 'name is required')
  if (!year || year < 2000) return badRequest(c, 'year is required')

  const now = nowIso()
  const baseConfig = JSON.parse(JSON.stringify(USQC_2025_CONFIG)) as TournamentConfig
  baseConfig.id = id
  baseConfig.name = name
  baseConfig.year = Math.floor(year)
  baseConfig.branding = {
    tournamentLogoKey: `config/tournaments/${id}/logos/tournament.png`,
    orgLogoKey: `config/tournaments/${id}/logos/org.png`,
    primaryColor: baseConfig.branding.primaryColor,
  }
  baseConfig.teams = []
  baseConfig.createdAt = now
  baseConfig.updatedAt = now

  await writeJsonToS3(getConfigKey(id, 'draft'), baseConfig)

  const list = (await readJsonFromS3<TournamentListEntry[]>(CONFIG_LIST_KEY)) ?? FALLBACK_TOURNAMENTS
  const nextList = list.filter((entry) => entry.id !== id)
  nextList.push({ id, name, year: Math.floor(year), published: false })
  await writeJsonToS3(CONFIG_LIST_KEY, nextList, { cacheControl: 'public, max-age=60' })

  return c.json(baseConfig, 201)
})

app.put('/admin/tournaments/:id', async (c) => {
  const id = c.req.param('id')
  const body = await getJsonBody(c)
  if (!isRecord(body)) return badRequest(c, 'Invalid request body')

  const now = nowIso()
  const config = body as TournamentConfig
  if (!config.name || !config.year) {
    return badRequest(c, 'name and year are required')
  }

  const existingConfig =
    (await readJsonFromS3<TournamentConfig>(getConfigKey(id, 'draft'))) ??
    (await readJsonFromS3<TournamentConfig>(getConfigKey(id, 'published'))) ??
    FALLBACK_CONFIGS[id] ??
    null
  const existingTeamIds = new Set(existingConfig?.teams?.map((team) => team.id) ?? [])

  // Validate team IDs to prevent path traversal in S3 keys
  for (const team of config.teams ?? []) {
    if (!isSafeId(team.id)) {
      if (!existingTeamIds.has(team.id)) {
        return badRequest(
          c,
          `Team id "${team.id}" must be 3-64 lowercase alphanumeric characters or hyphens`
        )
      }
    }
  }

  config.id = id
  config.updatedAt = now
  config.createdAt = config.createdAt ?? now

  await writeJsonToS3(getConfigKey(id, 'draft'), config)

  return c.json(config)
})

// Team logos ZIP upload - upload multiple team logos at once
// ZIP structure: team-id.png files at root level
app.post('/admin/tournaments/:id/logos-zip', async (c) => {
  const id = c.req.param('id')

  const draft =
    (await readJsonFromS3<TournamentConfig>(getConfigKey(id, 'draft'))) ??
    (await readJsonFromS3<TournamentConfig>(getConfigKey(id, 'published'))) ??
    FALLBACK_CONFIGS[id]

  if (!draft) {
    return c.json({ error: 'Tournament not found' }, 404)
  }

  const arrayBuffer = await c.req.arrayBuffer()
  if (arrayBuffer.byteLength === 0) {
    return badRequest(c, 'Empty request body')
  }

  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(arrayBuffer)
  } catch {
    return badRequest(c, 'Invalid ZIP file')
  }

  const teamIds = new Set(draft.teams.map((t) => t.id))
  const results: {
    uploaded: string[]
    skipped: Array<{ filename: string; reason: string }>
    missingLogos: string[]
  } = {
    uploaded: [],
    skipped: [],
    missingLogos: [],
  }

  const uploadPromises: Promise<void>[] = []

  zip.forEach((relativePath, file) => {
    // Skip directories and hidden files
    if (file.dir || relativePath.startsWith('__MACOSX') || relativePath.startsWith('.')) {
      return
    }

    // Get just the filename (handle nested paths)
    const filename = relativePath.split('/').pop() ?? relativePath
    if (!filename.toLowerCase().endsWith('.png')) {
      results.skipped.push({ filename, reason: 'Not a PNG file' })
      return
    }

    const teamId = filename.slice(0, -4) // Remove .png
    if (!teamIds.has(teamId)) {
      results.skipped.push({ filename, reason: `No team with ID "${teamId}" in config` })
      return
    }

    uploadPromises.push(
      (async () => {
        const data = await file.async('nodebuffer')
        const key = `config/tournaments/${id}/teams/${teamId}.png`
        await s3.send(
          new PutObjectCommand({
            Bucket: Resource.Media.name,
            Key: key,
            Body: data,
            ContentType: 'image/png',
          })
        )
        results.uploaded.push(teamId)
      })()
    )
  })

  await Promise.all(uploadPromises)

  // Find teams still missing logos
  const uploadedSet = new Set(results.uploaded)
  for (const team of draft.teams) {
    if (!uploadedSet.has(team.id)) {
      // Check if logo already exists in S3
      try {
        await s3.send(
          new HeadObjectCommand({
            Bucket: Resource.Media.name,
            Key: `config/tournaments/${id}/teams/${team.id}.png`,
          })
        )
      } catch {
        results.missingLogos.push(team.id)
      }
    }
  }

  return c.json(results)
})

app.post('/admin/tournaments/:id/assets/presign', async (c) => {
  const id = c.req.param('id')
  const body = await getJsonBody(c)
  if (!isRecord(body)) return badRequest(c, 'Invalid request body')

  const kind = normalizeString(body.kind)
  const contentType = normalizeString(body.contentType)
  const teamId = normalizeString(body.teamId)
  const templateId = normalizeString(body.templateId)

  if (!kind) return badRequest(c, 'kind is required')
  if (!contentType) return badRequest(c, 'contentType is required')
  if (kind === 'templateOverlay' && contentType !== 'image/png') {
    return badRequest(c, 'templateOverlay must be image/png')
  }

  const ext = getExtension(contentType)
  if (!ext) return badRequest(c, 'Unsupported contentType')

  let key: string | null = null
  if (kind === 'tournamentLogo') {
    key = `config/tournaments/${id}/logos/tournament.${ext}`
  } else if (kind === 'orgLogo') {
    key = `config/tournaments/${id}/logos/org.${ext}`
  } else if (kind === 'teamLogo') {
    if (!teamId) return badRequest(c, 'teamId is required')
    key = `config/tournaments/${id}/teams/${teamId}.${ext}`
  } else if (kind === 'templateOverlay') {
    if (!templateId) return badRequest(c, 'templateId is required')
    if (!isSafeId(templateId)) return badRequest(c, 'templateId is invalid')
    const uploadId = randomUUID().slice(0, 8)
    key = `config/tournaments/${id}/overlays/${templateId}/${uploadId}.${ext}`
  }

  if (!key) return badRequest(c, 'kind is invalid')

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
  const response: Record<string, unknown> = {
    uploadUrl: url,
    key,
    method: 'POST',
    fields,
  }
  if (publicUrl) response.publicUrl = publicUrl

  return c.json(response)
})

app.post('/admin/tournaments/:id/publish', async (c) => {
  const id = c.req.param('id')
  const draftKey = getConfigKey(id, 'draft')
  const publishedKey = getConfigKey(id, 'published')

  const draft = await readJsonFromS3<TournamentConfig>(draftKey)
  if (!draft) {
    return c.json({ error: 'Draft config not found' }, 404)
  }

  // Write published config with short cache (allows CloudFront to cache but still refreshes)
  await writeJsonToS3(publishedKey, draft, { cacheControl: 'public, max-age=60' })

  const list = (await readJsonFromS3<TournamentListEntry[]>(CONFIG_LIST_KEY)) ?? FALLBACK_TOURNAMENTS
  const nextList = list.map((entry) =>
    entry.id === id ? { ...entry, published: true } : entry
  )
  await writeJsonToS3(CONFIG_LIST_KEY, nextList, { cacheControl: 'public, max-age=60' })

  return c.json({ success: true })
})

// Export tournament bundle as ZIP
// Contains: config.json, tournament-logo.png, org-logo.png, teams/<team-id>.png
app.get('/admin/tournaments/:id/bundle', async (c) => {
  const id = c.req.param('id')

  const config =
    (await readJsonFromS3<TournamentConfig>(getConfigKey(id, 'draft'))) ??
    (await readJsonFromS3<TournamentConfig>(getConfigKey(id, 'published'))) ??
    FALLBACK_CONFIGS[id]

  if (!config) {
    return c.json({ error: 'Tournament not found' }, 404)
  }

  const zip = new JSZip()

  // Add config.json
  zip.file('config.json', JSON.stringify(config, null, 2))

  // Helper to fetch and add file to zip
  const addAsset = async (key: string, zipPath: string) => {
    try {
      const result = await s3.send(
        new GetObjectCommand({
          Bucket: Resource.Media.name,
          Key: key,
        })
      )
      if (result.Body) {
        const data = await result.Body.transformToByteArray()
        zip.file(zipPath, data)
        return true
      }
    } catch {
      // File doesn't exist, skip
    }
    return false
  }

  // Add tournament logo
  await addAsset(config.branding.tournamentLogoKey, 'tournament-logo.png')

  // Add org logo
  if (config.branding.orgLogoKey) {
    await addAsset(config.branding.orgLogoKey, 'org-logo.png')
  }

  // Add team logos
  const teamPromises = config.teams.map((team) =>
    addAsset(team.logoKey, `teams/${team.id}.png`)
  )
  await Promise.all(teamPromises)

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })

  return new Response(zipBuffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${id}-bundle.zip"`,
    },
  })
})

// Import tournament bundle from ZIP
// Expected structure: config.json (required), tournament-logo.png, org-logo.png, teams/<team-id>.png
app.post('/admin/tournaments/import-bundle', async (c) => {
  const arrayBuffer = await c.req.arrayBuffer()
  if (arrayBuffer.byteLength === 0) {
    return badRequest(c, 'Empty request body')
  }

  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(arrayBuffer)
  } catch {
    return badRequest(c, 'Invalid ZIP file')
  }

  // Find and parse config.json
  const configFile = zip.file('config.json')
  if (!configFile) {
    return badRequest(c, 'ZIP must contain config.json at root level')
  }

  let config: TournamentConfig
  try {
    const configText = await configFile.async('text')
    config = JSON.parse(configText) as TournamentConfig
  } catch {
    return badRequest(c, 'config.json is not valid JSON')
  }

  // Validate required fields
  if (!config.id || typeof config.id !== 'string') {
    return badRequest(c, 'config.json must have a valid id')
  }
  if (!isSafeId(config.id)) {
    return badRequest(c, 'config.id must be 3-64 lowercase alphanumeric characters or hyphens')
  }
  if (!config.name || typeof config.name !== 'string') {
    return badRequest(c, 'config.json must have a valid name')
  }
  if (!config.year || typeof config.year !== 'number') {
    return badRequest(c, 'config.json must have a valid year')
  }

  // Validate team IDs
  for (const team of config.teams ?? []) {
    if (!isSafeId(team.id)) {
      return badRequest(c, `Team id "${team.id}" must be 3-64 lowercase alphanumeric characters or hyphens`)
    }
  }

  const id = config.id
  const now = nowIso()

  // Ensure branding paths are set correctly for this tournament
  config.branding = config.branding ?? { tournamentLogoKey: '' }
  config.branding.tournamentLogoKey = `config/tournaments/${id}/logos/tournament.png`
  if (config.branding.orgLogoKey) {
    config.branding.orgLogoKey = `config/tournaments/${id}/logos/org.png`
  }

  // Update team logo keys to match tournament structure
  config.teams = (config.teams ?? []).map((team) => ({
    ...team,
    logoKey: `config/tournaments/${id}/teams/${team.id}.png`,
  }))

  config.updatedAt = now
  config.createdAt = config.createdAt ?? now

  const results: {
    configSaved: boolean
    assetsUploaded: string[]
    assetsSkipped: string[]
  } = {
    configSaved: false,
    assetsUploaded: [],
    assetsSkipped: [],
  }

  // Save config
  await writeJsonToS3(getConfigKey(id, 'draft'), config)
  results.configSaved = true

  // Upload tournament logo
  const tournamentLogo = zip.file('tournament-logo.png')
  if (tournamentLogo) {
    const data = await tournamentLogo.async('nodebuffer')
    await s3.send(
      new PutObjectCommand({
        Bucket: Resource.Media.name,
        Key: config.branding.tournamentLogoKey,
        Body: data,
        ContentType: 'image/png',
      })
    )
    results.assetsUploaded.push('tournament-logo.png')
  } else {
    results.assetsSkipped.push('tournament-logo.png (not found in ZIP)')
  }

  // Upload org logo
  const orgLogo = zip.file('org-logo.png')
  if (orgLogo) {
    const data = await orgLogo.async('nodebuffer')
    await s3.send(
      new PutObjectCommand({
        Bucket: Resource.Media.name,
        Key: `config/tournaments/${id}/logos/org.png`,
        Body: data,
        ContentType: 'image/png',
      })
    )
    config.branding.orgLogoKey = `config/tournaments/${id}/logos/org.png`
    results.assetsUploaded.push('org-logo.png')
  }

  // Upload team logos from teams/ folder
  const teamsFolder = zip.folder('teams')
  if (teamsFolder) {
    const teamPromises: Promise<void>[] = []
    teamsFolder.forEach((relativePath, file) => {
      if (file.dir || !relativePath.toLowerCase().endsWith('.png')) return

      const filename = relativePath.split('/').pop() ?? relativePath
      if (!filename.toLowerCase().endsWith('.png')) return

      const teamId = filename.slice(0, -4)
      if (!isSafeId(teamId)) {
        results.assetsSkipped.push(`teams/${filename} (invalid team id)`)
        return
      }

      teamPromises.push(
        (async () => {
          const data = await file.async('nodebuffer')
          await s3.send(
            new PutObjectCommand({
              Bucket: Resource.Media.name,
              Key: `config/tournaments/${id}/teams/${teamId}.png`,
              Body: data,
              ContentType: 'image/png',
            })
          )
          results.assetsUploaded.push(`teams/${teamId}.png`)
        })()
      )
    })
    await Promise.all(teamPromises)
  }

  // Update tournament list
  const list = (await readJsonFromS3<TournamentListEntry[]>(CONFIG_LIST_KEY)) ?? FALLBACK_TOURNAMENTS
  const existing = list.find((entry) => entry.id === id)
  if (!existing) {
    list.push({ id, name: config.name, year: config.year, published: false })
    await writeJsonToS3(CONFIG_LIST_KEY, list, { cacheControl: 'public, max-age=60' })
  }

  // Re-save config with potentially updated orgLogoKey
  await writeJsonToS3(getConfigKey(id, 'draft'), config)

  return c.json({ tournament: config, results })
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

  const editToken = normalizeString(c.req.header(EDIT_TOKEN_HEADER))
  if (!editToken) {
    return c.json({ error: 'Edit token is required' }, 401)
  }

  const card = existingCard.Item as Card
  if (!card.editToken || card.editToken !== editToken) {
    return c.json({ error: 'Invalid edit token' }, 403)
  }

  if (card.status !== 'draft') {
    return c.json({ error: 'Card is no longer editable' }, 409)
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
  const publicUrl = kind === 'render' ? getPublicPath(key) : null
  const response: Record<string, unknown> = {
    uploadUrl: url,
    key,
    method: 'POST',
    fields,
  }
  if (publicUrl) response.publicUrl = publicUrl

  return c.json(response)
})

app.post('/cards', async (c) => {
  const body = await getJsonBody(c)
  if (!isRecord(body)) return badRequest(c, 'Invalid request body')

  const now = nowIso()
  const id = randomUUID()
  const editToken = randomUUID()
  const input = pickCardInput(body)
  const { cardType, tournamentId, ...rest } = input

  if (!cardType || !isCardType(cardType)) {
    return badRequest(c, 'cardType is required')
  }
  if (!tournamentId) {
    return badRequest(c, 'tournamentId is required')
  }

  const fieldError = validateCardFields(input)
  if (fieldError) {
    return badRequest(c, fieldError)
  }

  const record: Card = {
    id,
    editToken,
    tournamentId,
    cardType,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    statusCreatedAt: buildStatusCreatedAt('draft', now),
    ...rest,
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

app.get('/cards', async (c) => {
  const statusParam = c.req.query('status')
  if (!isCardStatus(statusParam)) {
    return badRequest(c, 'status query param is required')
  }

  // Don't expose draft cards publicly - use /admin/cards for drafts
  if (statusParam === 'draft') {
    return c.json({ error: 'Draft cards require admin access' }, 403)
  }

  const tournamentId = c.req.query('tournamentId')
  const limitParam = c.req.query('limit')
  const limit = Math.min(100, Math.max(1, limitParam ? Number(limitParam) : 50))

  if (tournamentId) {
    const result = await ddb.send(
      new QueryCommand({
        TableName: Resource.Cards.name,
        IndexName: 'byTournamentStatus',
        KeyConditionExpression:
          '#tournamentId = :tournamentId AND begins_with(#statusCreatedAt, :statusPrefix)',
        ExpressionAttributeNames: {
          '#tournamentId': 'tournamentId',
          '#statusCreatedAt': 'statusCreatedAt',
        },
        ExpressionAttributeValues: {
          ':tournamentId': tournamentId,
          ':statusPrefix': `${statusParam}#`,
        },
        ScanIndexForward: false,
        Limit: limit,
      })
    )

    const items = (result.Items ?? []) as Card[]
    return c.json(items.map(toPublicCard))
  }

  const result = await ddb.send(
    new QueryCommand({
      TableName: Resource.Cards.name,
      IndexName: 'byStatus',
      KeyConditionExpression: '#status = :status',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':status': statusParam,
      },
      ScanIndexForward: false,
      Limit: limit,
    })
  )

  const items = (result.Items ?? []) as Card[]
  return c.json(items.map(toPublicCard))
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

  return c.json(toPublicCard(result.Item as Card))
})

app.patch('/cards/:id', async (c) => {
  const id = c.req.param('id')
  const body = await getJsonBody(c)
  if (!isRecord(body)) return badRequest(c, 'Invalid request body')

  const editToken = normalizeString(c.req.header(EDIT_TOKEN_HEADER))
  if (!editToken) {
    return c.json({ error: 'Edit token is required' }, 401)
  }

  const now = nowIso()
  if ('cardType' in body || 'tournamentId' in body || 'type' in body) {
    return badRequest(c, 'cardType and tournamentId cannot be changed')
  }

  const draft: UpdateDraft = { set: {}, remove: [] }

  let error =
    applyStringUpdate(draft, body.teamId, 'teamId', MAX_TEAM_LENGTH, 'teamId') ||
    applyStringUpdate(draft, body.teamName, 'teamName', MAX_TEAM_LENGTH, 'teamName') ||
    applyStringUpdate(draft, body.position, 'position', MAX_POSITION_LENGTH, 'position') ||
    applyStringUpdate(draft, body.templateId, 'templateId', MAX_TEMPLATE_LENGTH, 'templateId') ||
    applyStringUpdate(draft, body.firstName, 'firstName', MAX_NAME_LENGTH, 'firstName') ||
    applyStringUpdate(draft, body.lastName, 'lastName', MAX_NAME_LENGTH, 'lastName') ||
    applyStringUpdate(draft, body.photographer, 'photographer', MAX_PHOTOGRAPHER_LENGTH, 'photographer') ||
    applyStringUpdate(draft, body.title, 'title', MAX_TITLE_LENGTH, 'title') ||
    applyStringUpdate(draft, body.caption, 'caption', MAX_CAPTION_LENGTH, 'caption')

  if (!error && body.jerseyNumber !== undefined) {
    if (body.jerseyNumber === null) {
      pushRemove(draft, 'jerseyNumber')
    } else if (typeof body.jerseyNumber === 'string') {
      const trimmed = body.jerseyNumber.trim()
      if (!trimmed) {
        pushRemove(draft, 'jerseyNumber')
      } else if (!JERSEY_PATTERN.test(trimmed)) {
        error = 'jerseyNumber must be 1-2 digits'
      } else {
        pushSet(draft, 'jerseyNumber', trimmed)
      }
    } else {
      error = 'jerseyNumber must be a string'
    }
  }

  if (!error && body.photo !== undefined) {
    if (body.photo === null) {
      pushRemove(draft, 'photo')
    } else if (isRecord(body.photo)) {
      const photoUpdate: Card['photo'] = {}
      if (body.photo.originalKey !== undefined && body.photo.originalKey !== null) {
        if (typeof body.photo.originalKey !== 'string') {
          error = 'photo.originalKey must be a string'
        } else {
          const trimmed = body.photo.originalKey.trim()
          if (trimmed) {
            const lengthError = ensureMaxLength(trimmed, 1024, 'photo.originalKey')
            if (lengthError) {
              error = lengthError
            } else {
              photoUpdate.originalKey = trimmed
            }
          }
        }
      }

      if (!error && body.photo.cropKey !== undefined && body.photo.cropKey !== null) {
        if (typeof body.photo.cropKey !== 'string') {
          error = 'photo.cropKey must be a string'
        } else {
          const trimmed = body.photo.cropKey.trim()
          if (trimmed) {
            const lengthError = ensureMaxLength(trimmed, 1024, 'photo.cropKey')
            if (lengthError) {
              error = lengthError
            } else {
              photoUpdate.cropKey = trimmed
            }
          }
        }
      }

      if (!error && body.photo.width !== undefined && body.photo.width !== null) {
        const width = toNumber(body.photo.width)
        if (width === undefined) {
          error = 'photo.width must be a number'
        } else {
          photoUpdate.width = width
        }
      }

      if (!error && body.photo.height !== undefined && body.photo.height !== null) {
        const height = toNumber(body.photo.height)
        if (height === undefined) {
          error = 'photo.height must be a number'
        } else {
          photoUpdate.height = height
        }
      }

      if (!error && body.photo.crop !== undefined && body.photo.crop !== null) {
        const crop = pickCrop(body.photo.crop)
        if (!crop) {
          error = 'photo.crop is invalid'
        } else {
          photoUpdate.crop = crop
        }
      }

      if (!error) {
        if (Object.keys(photoUpdate).length === 0) {
          error = 'photo must include at least one field'
        } else {
          const photoKeyError = validatePhotoKeys(id, photoUpdate)
          if (photoKeyError) {
            error = photoKeyError
          } else {
            // Update individual photo fields to preserve existing data
            // (avoids wiping out other photo fields when only updating e.g. crop)
            for (const [key, value] of Object.entries(photoUpdate)) {
              pushSet(draft, `photo.${key}`, value)
            }
          }
        }
      }
    } else {
      error = 'photo must be an object'
    }
  }

  if (error) {
    return badRequest(c, error)
  }

  pushSet(draft, 'updatedAt', now)

  const entries = Object.entries(draft.set)
  const sets: string[] = []
  const removes: string[] = []
  const names: Record<string, string> = {}
  const nameMap = new Map<string, string>()
  const values: Record<string, unknown> = {}

  let valueIndex = 0
  let nameIndex = 0
  const nameFor = (segment: string) => {
    const existing = nameMap.get(segment)
    if (existing) return existing
    const key = `#n${nameIndex++}`
    nameMap.set(segment, key)
    names[key] = segment
    return key
  }
  const pathToExpression = (path: string) =>
    path
      .split('.')
      .map((segment) => nameFor(segment))
      .join('.')

  for (const [path, value] of entries) {
    const placeholder = `:v${valueIndex++}`
    values[placeholder] = value
    sets.push(`${pathToExpression(path)} = ${placeholder}`)
  }

  for (const path of draft.remove) {
    removes.push(pathToExpression(path))
  }

  values[':draft'] = 'draft'
  values[':editToken'] = editToken

  const updateExpressions = []
  if (sets.length > 0) updateExpressions.push(`SET ${sets.join(', ')}`)
  if (removes.length > 0) updateExpressions.push(`REMOVE ${removes.join(', ')}`)

  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: Resource.Cards.name,
        Key: { id },
        UpdateExpression: updateExpressions.join(' '),
        ConditionExpression: 'attribute_exists(#id) AND #status = :draft AND #editToken = :editToken',
        ExpressionAttributeNames: {
          ...names,
          '#id': 'id',
          '#status': 'status',
          '#editToken': 'editToken',
        },
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      })
    )

    if (!result.Attributes) {
      return c.json({ error: 'Card not found' }, 404)
    }

    return c.json(result.Attributes)
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException || (isRecord(err) && err.name === 'ConditionalCheckFailedException')) {
      const latest = await ddb.send(
        new GetCommand({
          TableName: Resource.Cards.name,
          Key: { id },
        })
      )

      if (!latest.Item) {
        return c.json({ error: 'Card not found' }, 404)
      }

      const current = latest.Item as Card
      if (!current.editToken || current.editToken !== editToken) {
        return c.json({ error: 'Invalid edit token' }, 403)
      }

      return c.json({ error: 'Card is no longer editable' }, 409)
    }
    throw err
  }
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

  const card = existing.Item as Card
  const editToken = normalizeString(c.req.header(EDIT_TOKEN_HEADER))
  if (!editToken) {
    return c.json({ error: 'Edit token is required' }, 401)
  }
  if (!card.editToken || card.editToken !== editToken) {
    return c.json({ error: 'Invalid edit token' }, 403)
  }

  // Enforce status transition: only draft can be submitted (idempotent return)
  if (card.status !== 'draft') {
    return c.json(card)
  }

  const body = await getJsonBody(c)
  if (!isRecord(body)) return badRequest(c, 'Invalid request body')

  let renderKey: string | undefined
  if (body.renderKey !== undefined && body.renderKey !== null) {
    if (typeof body.renderKey !== 'string' || body.renderKey.trim() === '') {
      return badRequest(c, 'renderKey must be a non-empty string')
    }
    renderKey = body.renderKey.trim()
  }

  let renderMeta: RenderMeta | undefined
  if (body.renderMeta !== undefined) {
    if (!renderKey) return badRequest(c, 'renderMeta requires renderKey')
    const parsed = parseRenderMeta(body.renderMeta, renderKey)
    if (typeof parsed === 'string') return badRequest(c, parsed)
    renderMeta = parsed
  }

  const submitValidationError = getSubmitValidationError(card)
  if (submitValidationError) {
    return badRequest(c, submitValidationError)
  }

  if (renderKey) {
    // Validate renderKey format: must be renders/<cardId>/<id>.png
    const renderKeyPattern = new RegExp(`^renders/${id}/[a-f0-9-]+\\.png$`)
    if (!renderKeyPattern.test(renderKey)) {
      return badRequest(c, 'Invalid renderKey format')
    }

    try {
      await s3.send(
        new HeadObjectCommand({
          Bucket: Resource.Media.name,
          Key: renderKey,
        })
      )
    } catch {
      return badRequest(c, 'renderKey not found in storage')
    }
  }

  const now = nowIso()
  const statusCreatedAt = buildStatusCreatedAt('submitted', now)
  try {
    const setExpressions = ['#status = :status', '#updatedAt = :updatedAt', '#statusCreatedAt = :statusCreatedAt']
    const expressionAttributeNames: Record<string, string> = {
      '#status': 'status',
      '#updatedAt': 'updatedAt',
      '#statusCreatedAt': 'statusCreatedAt',
    }
    const expressionAttributeValues: Record<string, unknown> = {
      ':status': 'submitted',
      ':draft': 'draft',
      ':updatedAt': now,
      ':statusCreatedAt': statusCreatedAt,
    }

    if (renderKey) {
      setExpressions.push('#renderKey = :renderKey')
      expressionAttributeNames['#renderKey'] = 'renderKey'
      expressionAttributeValues[':renderKey'] = renderKey
    }

    if (renderMeta) {
      setExpressions.push('#renderMeta = :renderMeta')
      expressionAttributeNames['#renderMeta'] = 'renderMeta'
      expressionAttributeValues[':renderMeta'] = renderMeta
    }

    const result = await ddb.send(
      new UpdateCommand({
        TableName: Resource.Cards.name,
        Key: { id },
        UpdateExpression: `SET ${setExpressions.join(', ')}`,
        ConditionExpression: '#status = :draft',
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: 'ALL_NEW',
      })
    )

    if (result.Attributes) {
      return c.json(result.Attributes)
    }

    const next: Card = {
      ...card,
      renderKey: renderKey ?? card.renderKey,
      renderMeta: renderMeta ?? card.renderMeta,
      status: 'submitted',
      updatedAt: now,
      statusCreatedAt,
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

// Admin cards listing - allows all statuses including drafts
app.get('/admin/cards', async (c) => {
  const statusParam = c.req.query('status')
  if (!isCardStatus(statusParam)) {
    return badRequest(c, 'status query param is required')
  }

  const tournamentId = c.req.query('tournamentId')
  const limitParam = c.req.query('limit')
  const limit = Math.min(100, Math.max(1, limitParam ? Number(limitParam) : 50))

  if (tournamentId) {
    const result = await ddb.send(
      new QueryCommand({
        TableName: Resource.Cards.name,
        IndexName: 'byTournamentStatus',
        KeyConditionExpression:
          '#tournamentId = :tournamentId AND begins_with(#statusCreatedAt, :statusPrefix)',
        ExpressionAttributeNames: {
          '#tournamentId': 'tournamentId',
          '#statusCreatedAt': 'statusCreatedAt',
        },
        ExpressionAttributeValues: {
          ':tournamentId': tournamentId,
          ':statusPrefix': `${statusParam}#`,
        },
        ScanIndexForward: false,
        Limit: limit,
      })
    )
    return c.json(result.Items ?? [])
  }

  const result = await ddb.send(
    new QueryCommand({
      TableName: Resource.Cards.name,
      IndexName: 'byStatus',
      KeyConditionExpression: '#status = :status',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':status': statusParam,
      },
      ScanIndexForward: false,
      Limit: limit,
    })
  )
  return c.json(result.Items ?? [])
})

app.patch('/admin/cards/:id', async (c) => {
  const id = c.req.param('id')
  const body = await getJsonBody(c)
  if (!isRecord(body)) return badRequest(c, 'Invalid request body')

  const keys = Object.keys(body)
  if (keys.length === 0 || keys.some((key) => key !== 'templateId')) {
    return badRequest(c, 'Only templateId can be updated')
  }

  const templateIdInput = body.templateId
  let templateId: string | null = null
  let removeTemplateId = false

  if (templateIdInput === null) {
    removeTemplateId = true
  } else if (typeof templateIdInput === 'string') {
    const trimmed = templateIdInput.trim()
    if (!trimmed) {
      removeTemplateId = true
    } else {
      const error = ensureMaxLength(trimmed, MAX_TEMPLATE_LENGTH, 'templateId')
      if (error) return badRequest(c, error)
      templateId = trimmed
    }
  } else {
    return badRequest(c, 'templateId must be a string')
  }

  const now = nowIso()
  const setExpressions = ['#updatedAt = :updatedAt']
  const removeExpressions: string[] = []
  const names: Record<string, string> = {
    '#id': 'id',
    '#updatedAt': 'updatedAt',
    '#templateId': 'templateId',
  }
  const values: Record<string, unknown> = {
    ':updatedAt': now,
  }

  if (templateId) {
    setExpressions.push('#templateId = :templateId')
    values[':templateId'] = templateId
  } else if (removeTemplateId) {
    removeExpressions.push('#templateId')
  }

  const updateExpression = `SET ${setExpressions.join(', ')}${
    removeExpressions.length > 0 ? ` REMOVE ${removeExpressions.join(', ')}` : ''
  }`

  const result = await ddb.send(
    new UpdateCommand({
      TableName: Resource.Cards.name,
      Key: { id },
      UpdateExpression: updateExpression,
      ConditionExpression: 'attribute_exists(#id)',
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    })
  )

  if (!result.Attributes) {
    return c.json({ error: 'Card not found' }, 404)
  }

  return c.json(result.Attributes)
})

app.get('/admin/cards/:id/photo-url', async (c) => {
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

  const card = existing.Item as Card
  const originalKey = card.photo?.originalKey
  if (!originalKey) {
    return c.json({ error: 'Card has no original photo' }, 400)
  }

  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: Resource.Media.name,
      Key: originalKey,
    }),
    { expiresIn: 300 }
  )

  return c.json({ url })
})

app.post('/admin/cards/:id/renders/presign', async (c) => {
  const id = c.req.param('id')
  const body = await getJsonBody(c)
  if (!isRecord(body)) return badRequest(c, 'Invalid request body')

  const existing = await ddb.send(
    new GetCommand({
      TableName: Resource.Cards.name,
      Key: { id },
    })
  )

  if (!existing.Item) {
    return c.json({ error: 'Card not found' }, 404)
  }

  const card = existing.Item as Card
  if (card.status === 'draft') {
    return badRequest(c, 'Draft cards cannot be rendered')
  }

  const contentType = normalizeString(body.contentType)
  if (!contentType) return badRequest(c, 'contentType is required')

  const length = typeof body.contentLength === 'number' ? body.contentLength : Number(body.contentLength)
  if (!Number.isFinite(length) || length <= 0) {
    return badRequest(c, 'contentLength must be a positive number')
  }

  if (length > MAX_UPLOAD_BYTES) {
    return badRequest(c, 'File is too large')
  }

  if (!ALLOWED_RENDER_TYPES.has(contentType)) {
    return badRequest(c, 'contentType is not allowed')
  }

  const key = getUploadKey(id, 'render', contentType)
  if (!key) return badRequest(c, 'Unsupported contentType for render upload')

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

  return c.json({
    uploadUrl: url,
    key,
    method: 'POST',
    fields,
  })
})

app.post('/admin/cards/:id/renders/commit', async (c) => {
  const id = c.req.param('id')
  const body = await getJsonBody(c)
  if (!isRecord(body)) return badRequest(c, 'Invalid request body')

  const renderKey = normalizeString(body.renderKey)
  if (!renderKey) return badRequest(c, 'renderKey is required')

  if (body.renderMeta === undefined) {
    return badRequest(c, 'renderMeta is required')
  }

  const renderMeta = parseRenderMeta(body.renderMeta, renderKey)
  if (typeof renderMeta === 'string') {
    return badRequest(c, renderMeta)
  }

  // Validate renderKey format: must be renders/<cardId>/<id>.png
  const renderKeyPattern = new RegExp(`^renders/${id}/[a-f0-9-]+\\.png$`)
  if (!renderKeyPattern.test(renderKey)) {
    return badRequest(c, 'Invalid renderKey format')
  }

  const existing = await ddb.send(
    new GetCommand({
      TableName: Resource.Cards.name,
      Key: { id },
    })
  )

  if (!existing.Item) {
    return c.json({ error: 'Card not found' }, 404)
  }

  const card = existing.Item as Card
  if (card.status === 'draft') {
    return badRequest(c, 'Draft cards cannot be rendered')
  }

  try {
    await s3.send(
      new HeadObjectCommand({
        Bucket: Resource.Media.name,
        Key: renderKey,
      })
    )
  } catch {
    return badRequest(c, 'renderKey not found in storage')
  }

  const now = nowIso()
  const statusCreatedAt = buildStatusCreatedAt('rendered', now)
  const result = await ddb.send(
    new UpdateCommand({
      TableName: Resource.Cards.name,
      Key: { id },
      UpdateExpression:
        'SET #renderKey = :renderKey, #renderMeta = :renderMeta, #status = :status, #updatedAt = :updatedAt, #statusCreatedAt = :statusCreatedAt',
      ExpressionAttributeNames: {
        '#renderKey': 'renderKey',
        '#renderMeta': 'renderMeta',
        '#status': 'status',
        '#updatedAt': 'updatedAt',
        '#statusCreatedAt': 'statusCreatedAt',
      },
      ExpressionAttributeValues: {
        ':renderKey': renderKey,
        ':renderMeta': renderMeta,
        ':status': 'rendered',
        ':updatedAt': now,
        ':statusCreatedAt': statusCreatedAt,
      },
      ReturnValues: 'ALL_NEW',
    })
  )

  return c.json(result.Attributes ?? {
    ...card,
    renderKey,
    renderMeta,
    status: 'rendered',
    updatedAt: now,
    statusCreatedAt,
  })
})

app.post('/admin/cards/:id/render', async (c) => {
  const id = c.req.param('id')
  const now = nowIso()
  const existing = await ddb.send(
    new GetCommand({
      TableName: Resource.Cards.name,
      Key: { id },
    })
  )

  if (!existing.Item) {
    return c.json({ error: 'Card not found' }, 404)
  }

  const card = existing.Item as Card
  if (card.status !== 'submitted') {
    return badRequest(c, 'Only submitted cards can be marked rendered')
  }
  const statusCreatedAt = buildStatusCreatedAt('rendered', now)

  const result = await ddb.send(
    new UpdateCommand({
      TableName: Resource.Cards.name,
      Key: { id },
      UpdateExpression: 'SET #status = :status, #updatedAt = :updatedAt, #statusCreatedAt = :statusCreatedAt',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#updatedAt': 'updatedAt',
        '#statusCreatedAt': 'statusCreatedAt',
      },
      ExpressionAttributeValues: {
        ':status': 'rendered',
        ':updatedAt': now,
        ':statusCreatedAt': statusCreatedAt,
      },
      ReturnValues: 'ALL_NEW',
    })
  )

  return c.json(result.Attributes ?? card)
})

app.get('/admin/cards/:id/download-url', async (c) => {
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

  const card = existing.Item as Card
  if (!card.renderKey) {
    return c.json({ error: 'Card has no render' }, 400)
  }

  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: Resource.Media.name,
      Key: card.renderKey,
      ResponseContentDisposition: `attachment; filename="${id}.png"`,
    }),
    { expiresIn: 300 }
  )

  return c.json({ url })
})

app.delete('/admin/cards/:id', async (c) => {
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

  const card = existing.Item as Card
  if (card.status !== 'draft') {
    return badRequest(c, 'Only draft cards can be deleted')
  }

  await ddb.send(
    new DeleteCommand({
      TableName: Resource.Cards.name,
      Key: { id },
    })
  )
  return c.json({ success: true })
})

app.notFound((c) => c.json({ error: 'Not Found' }, 404))

app.onError((err, c) => {
  console.error('Server error:', err)
  const message = err instanceof Error ? err.message : 'Internal Server Error'
  return c.json({ error: message }, 500)
})

export default app
