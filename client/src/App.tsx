import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type MouseEvent } from 'react'
import Cropper, { type Area, type MediaSize, type Point } from 'react-easy-crop'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  ALLOWED_UPLOAD_TYPES as ALLOWED_UPLOAD_TYPES_LIST,
  CARD_ASPECT,
  JERSEY_PATTERN,
  MAX_CAPTION_LENGTH,
  MAX_JERSEY_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PHOTOGRAPHER_LENGTH,
  MAX_POSITION_LENGTH,
  MAX_TEAM_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_UPLOAD_BYTES,
  TRIM_ASPECT,
  resolveTemplateId,
  type ApiResponse,
  type Card,
  type CardType,
  type CropRect,
  type TournamentConfig,
  type TournamentListEntry,
  USQC_2025_CONFIG,
  USQC_2025_TOURNAMENT,
  USQC_2026_TOURNAMENT,
} from 'shared'
import { renderPreviewTrim } from './renderCard'
import { api, assetUrlForKey, media, writeHeaders } from './api'
import { saveDraft, loadDraft, clearDraft, type SavedDraft } from './draftStorage'
import CropGuides from './components/CropGuides'

// Step definitions for progress tracker
const STEPS = [
  { id: 'type', label: 'Type' },
  { id: 'photo', label: 'Photo' },
  { id: 'crop', label: 'Crop' },
  { id: 'details', label: 'Details' },
  { id: 'submit', label: 'Submit' },
] as const

type StepId = typeof STEPS[number]['id']

const ALLOWED_UPLOAD_TYPES: Set<string> = new Set(ALLOWED_UPLOAD_TYPES_LIST)
const MAX_UPLOAD_RETRIES = 1
const MAX_IMAGE_DIMENSION = 2600

type FormState = {
  tournamentId: string
  cardType: CardType | ''
  teamId: string
  position: string
  jerseyNumber: string
  firstName: string
  lastName: string
  title: string
  caption: string
  photographer: string
  templateId: string
}

type PhotoState = {
  file: File
  localUrl: string
  width: number
  height: number
}

type UploadedPhoto = {
  key: string
  publicUrl?: string
  width: number
  height: number
}

type SavePayload = {
  tournamentId?: string
  cardType?: CardType
  templateId?: string
  teamId?: string
  teamName?: string
  position?: string
  jerseyNumber?: string
  firstName?: string
  lastName?: string
  title?: string
  caption?: string
  photographer?: string
  photo?: {
    originalKey?: string
    width?: number
    height?: number
    crop?: CropRect
  }
}

type Rotation = CropRect['rotateDeg']

type PresignResponse = {
  uploadUrl: string
  key: string
  publicUrl?: string
  method: 'POST' | 'PUT'
  headers?: Record<string, string>
  fields?: Record<string, string>
}

type UploadProgress = {
  kind: 'original'
  percent: number
}

const initialForm: FormState = {
  tournamentId: '',
  cardType: '',
  teamId: '',
  position: '',
  jerseyNumber: '',
  firstName: '',
  lastName: '',
  title: '',
  caption: '',
  photographer: '',
  templateId: '',
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

const toOptional = (value: string) => {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

const buildDefaultCrop = (size: MediaSize, rotateDeg: Rotation): CropRect => {
  const imageAspect = size.naturalWidth / size.naturalHeight
  let w = 1
  let h = 1

  if (imageAspect > CARD_ASPECT) {
    w = CARD_ASPECT / imageAspect
  } else {
    h = imageAspect / CARD_ASPECT
  }

  const x = clamp((1 - w) / 2, 0, 1)
  const y = clamp((1 - h) / 2, 0, 1)

  return {
    x,
    y,
    w: clamp(w, 0.001, 1),
    h: clamp(h, 0.001, 1),
    rotateDeg,
  }
}

async function fetchHello(): Promise<ApiResponse> {
  const res = await fetch(api('/hello'))
  if (!res.ok) {
    throw new Error('API request failed')
  }
  return res.json()
}

async function fetchTournaments(): Promise<TournamentListEntry[]> {
  const res = await fetch(api('/tournaments'))
  if (!res.ok) {
    throw new Error('Could not load tournaments')
  }
  return res.json()
}

async function fetchTournamentConfig(id: string): Promise<TournamentConfig> {
  const res = await fetch(api(`/tournaments/${id}`))
  if (!res.ok) {
    throw new Error('Could not load tournament config')
  }
  return res.json()
}

const editHeadersFor = (editToken: string): HeadersInit => ({
  'Content-Type': 'application/json',
  ...writeHeaders,
  'X-Edit-Token': editToken,
})

async function createCard(payload: SavePayload): Promise<Card> {
  const res = await fetch(api('/cards'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...writeHeaders },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    throw new Error('Could not create card')
  }

  return res.json()
}

async function updateCard(id: string, payload: SavePayload, editToken: string): Promise<Card> {
  const res = await fetch(api(`/cards/${id}`), {
    method: 'PATCH',
    headers: editHeadersFor(editToken),
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    throw new Error('Could not update card')
  }

  return res.json()
}

async function requestPresignFor(
  cardId: string,
  data: Blob,
  kind: 'original',
  editToken: string
): Promise<PresignResponse> {
  const res = await fetch(api('/uploads/presign'), {
    method: 'POST',
    headers: editHeadersFor(editToken),
    body: JSON.stringify({
      cardId,
      contentType: data.type,
      contentLength: data.size,
      kind,
    }),
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({}))
    throw new Error(error.error ?? 'Could not get upload URL')
  }

  return res.json()
}

const getUploadFilename = (key: string) => {
  const lastSegment = key.split('/').pop()
  return lastSegment && lastSegment.length > 0 ? lastSegment : 'upload'
}

const toUploadFile = (data: Blob, key: string) =>
  data instanceof File
    ? data
    : new File([data], getUploadFilename(key), {
        type: data.type || 'application/octet-stream',
      })

async function uploadToS3(
  presign: PresignResponse,
  data: Blob,
  onProgress?: (percent: number) => void
): Promise<void> {
  const uploadOnce = () =>
    new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open(presign.method, presign.uploadUrl)

      if (presign.method !== 'POST' && presign.headers) {
        for (const [key, value] of Object.entries(presign.headers)) {
          xhr.setRequestHeader(key, value)
        }
      }

      if (xhr.upload && onProgress) {
        xhr.upload.onprogress = (event) => {
          const total = event.total || data.size
          if (!total) return
          const percent = Math.round((event.loaded / total) * 100)
          onProgress(Math.min(100, Math.max(0, percent)))
        }
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress?.(100)
          resolve()
        } else {
          reject(new Error('Upload failed'))
        }
      }
      xhr.onerror = () => reject(new Error('Upload failed'))
      xhr.onabort = () => reject(new Error('Upload aborted'))

      if (presign.method === 'POST') {
        if (!presign.fields) {
          reject(new Error('Upload fields are missing'))
          return
        }

        const formData = new FormData()
        for (const [key, value] of Object.entries(presign.fields)) {
          formData.append(key, value)
        }
        formData.append('file', toUploadFile(data, presign.key))
        xhr.send(formData)
        return
      }

      xhr.send(data)
    })

  let lastError: unknown = null
  for (let attempt = 0; attempt <= MAX_UPLOAD_RETRIES; attempt++) {
    try {
      await uploadOnce()
      return
    } catch (err) {
      lastError = err
      if (attempt < MAX_UPLOAD_RETRIES) {
        onProgress?.(0)
      }
    }
  }

  if (lastError instanceof Error) throw lastError
  throw new Error('Upload failed')
}

async function submitCard(id: string, editToken: string): Promise<Card> {
  const res = await fetch(api(`/cards/${id}/submit`), {
    method: 'POST',
    headers: editHeadersFor(editToken),
    body: JSON.stringify({}),
  })

  if (!res.ok) {
    throw new Error('Could not submit card')
  }

  return res.json()
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()

    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image'))
    }

    img.src = url
  })
}

async function resizeImageIfNeeded(file: File): Promise<{ file: File; width: number; height: number }> {
  const img = await loadImageFromFile(file)
  const width = img.naturalWidth
  const height = img.naturalHeight
  const maxDim = Math.max(width, height)

  if (maxDim <= MAX_IMAGE_DIMENSION) {
    return { file, width, height }
  }

  const scale = MAX_IMAGE_DIMENSION / maxDim
  const targetWidth = Math.max(1, Math.round(width * scale))
  const targetHeight = Math.max(1, Math.round(height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return { file, width, height }
  }

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight)

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (result) resolve(result)
        else reject(new Error('Failed to resize image'))
      },
      file.type || 'image/jpeg',
      0.92
    )
  })

  const resizedFile = new File([blob], file.name, { type: blob.type })
  return { file: resizedFile, width: targetWidth, height: targetHeight }
}

// Icon components
const IconUpload = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
)

const IconZoomIn = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
    <line x1="11" y1="8" x2="11" y2="14" />
    <line x1="8" y1="11" x2="14" y2="11" />
  </svg>
)

const IconZoomOut = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
    <line x1="8" y1="11" x2="14" y2="11" />
  </svg>
)

const IconReset = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
  </svg>
)

const IconGrid = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
  </svg>
)

const IconCheck = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

const IconInfo = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
)

const IconDownload = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
)

const IconCheckSmall = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

function App() {
  const [form, setForm] = useState<FormState>(initialForm)
  const [selectedTournamentId, setSelectedTournamentId] = useState('')
  const [photo, setPhoto] = useState<PhotoState | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadedPhoto, setUploadedPhoto] = useState<UploadedPhoto | null>(null)
  const [mediaSize, setMediaSize] = useState<MediaSize | null>(null)
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState<Rotation>(0)
  const [normalizedCrop, setNormalizedCrop] = useState<CropRect | null>(null)
  const [showGuides, setShowGuides] = useState(true)
  const [showGuidesHelp, setShowGuidesHelp] = useState(false)
  const [cardId, setCardId] = useState<string | null>(null)
  const [editToken, setEditToken] = useState<string | null>(null)
  const [savedCard, setSavedCard] = useState<Card | null>(null)
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'uploaded' | 'error'>('idle')
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [renderedCardUrl, setRenderedCardUrl] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle')
  const [hasEdited, setHasEdited] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [pendingDraft, setPendingDraft] = useState<SavedDraft | null>(null)
  const [teamSearch, setTeamSearch] = useState('')

  // Refs for progress tracker scroll-to-section
  const sectionRefs = useRef<Record<StepId, HTMLElement | null>>({
    type: null,
    photo: null,
    crop: null,
    details: null,
    submit: null,
  })
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({})

  const helloQuery = useQuery({
    queryKey: ['hello'],
    queryFn: fetchHello,
    enabled: false,
  })

  const tournamentsQuery = useQuery({
    queryKey: ['tournaments'],
    queryFn: fetchTournaments,
    initialData: [USQC_2025_TOURNAMENT, USQC_2026_TOURNAMENT],
  })

  useEffect(() => {
    if (!selectedTournamentId && tournamentsQuery.data.length > 0) {
      setSelectedTournamentId(tournamentsQuery.data[0].id)
    }
  }, [selectedTournamentId, tournamentsQuery.data])

  // Check for existing draft on mount
  useEffect(() => {
    const draft = loadDraft()
    if (draft) {
      setPendingDraft(draft)
    }
  }, [])

  const tournamentQuery = useQuery({
    queryKey: ['tournament', form.tournamentId],
    queryFn: () => fetchTournamentConfig(form.tournamentId),
    enabled: Boolean(form.tournamentId),
  })

  const tournamentConfig =
    tournamentQuery.data ??
    (form.tournamentId === USQC_2025_CONFIG.id ? USQC_2025_CONFIG : null)

  const cardTypeConfig = useMemo(
    () => tournamentConfig?.cardTypes.find((entry) => entry.type === form.cardType),
    [form.cardType, tournamentConfig]
  )
  const templateOptions = useMemo(() => {
    if (tournamentConfig?.templates && tournamentConfig.templates.length > 0) {
      return tournamentConfig.templates
    }
    return [
      { id: 'classic', label: 'Classic' },
      { id: 'noir', label: 'Noir' },
    ]
  }, [tournamentConfig])

  const defaultTemplateId = useMemo(
    () =>
      resolveTemplateId(
        {
          cardType: form.cardType || undefined,
        },
        tournamentConfig ?? undefined
      ),
    [form.cardType, tournamentConfig]
  )

  const defaultTemplateLabel = useMemo(
    () => templateOptions.find((template) => template.id === defaultTemplateId)?.label ?? defaultTemplateId,
    [defaultTemplateId, templateOptions]
  )

  const hasUnknownTemplate = Boolean(form.templateId) && !templateOptions.some((template) => template.id === form.templateId)

  const selectedTeam = useMemo(() => {
    if (!tournamentConfig) return null
    return tournamentConfig.teams.find((team) => team.id === form.teamId) ?? null
  }, [form.teamId, tournamentConfig])

  const filteredTeams = useMemo(() => {
    if (!tournamentConfig?.teams) return []
    if (!teamSearch.trim()) return tournamentConfig.teams
    const search = teamSearch.toLowerCase().trim()
    return tournamentConfig.teams.filter((team) =>
      team.name.toLowerCase().includes(search)
    )
  }, [tournamentConfig?.teams, teamSearch])

  useEffect(() => {
    if (!cardTypeConfig?.positions || cardTypeConfig.positions.length === 0) return
    if (!form.position) return
    if (!cardTypeConfig.positions.includes(form.position)) {
      setForm((prev) => ({ ...prev, position: '' }))
    }
  }, [cardTypeConfig?.positions, form.position])

  const buildPayload = (): SavePayload => ({
    tournamentId: toOptional(form.tournamentId),
    cardType: form.cardType || undefined,
    templateId: toOptional(form.templateId),
    teamId: toOptional(form.teamId),
    teamName: selectedTeam?.name,
    position: toOptional(form.position),
    jerseyNumber: toOptional(form.jerseyNumber),
    firstName: toOptional(form.firstName),
    lastName: toOptional(form.lastName),
    title: toOptional(form.title),
    caption: toOptional(form.caption),
    photographer: toOptional(form.photographer),
  })

  const buildUpdatePayload = (payload: SavePayload): SavePayload => {
    const rest = { ...payload }
    delete rest.tournamentId
    delete rest.cardType
    return rest
  }

  const buildPhotoPayload = (
    source: UploadedPhoto | null,
    cropValue: CropRect | null
  ): SavePayload['photo'] | undefined => {
    if (!source && !cropValue) return undefined

    const payload: SavePayload['photo'] = {}

    if (source) {
      payload.originalKey = source.key
      payload.width = source.width
      payload.height = source.height
    }

    if (cropValue) {
      payload.crop = cropValue
    }

    return payload
  }

  const ensureCard = async (payload: SavePayload) => {
    if (cardId && editToken) return { id: cardId, editToken }
    if (cardId && !editToken) {
      throw new Error('Edit token is missing. Please refresh and try again.')
    }

    if (!payload.tournamentId || !payload.cardType) {
      throw new Error('Select a tournament and card type before saving')
    }

    const card = await createCard(payload)
    if (!card.editToken) {
      throw new Error('Edit token is missing. Please refresh and try again.')
    }
    setCardId(card.id)
    setEditToken(card.editToken)
    setSavedCard(card)

    // Persist draft to localStorage for resume on refresh
    saveDraft({
      cardId: card.id,
      editToken: card.editToken,
      tournamentId: payload.tournamentId,
      cardType: payload.cardType,
      form: {
        teamId: form.teamId,
        position: form.position,
        jerseyNumber: form.jerseyNumber,
        firstName: form.firstName,
        lastName: form.lastName,
        title: form.title,
        caption: form.caption,
        photographer: form.photographer,
        templateId: form.templateId,
      },
      savedAt: new Date().toISOString(),
    })

    return { id: card.id, editToken: card.editToken }
  }

  const uploadOriginalPhoto = async (currentCardId: string, currentEditToken: string) => {
    if (!photo) {
      throw new Error('Please upload a photo before submitting')
    }

    setUploadStatus('uploading')
    setUploadProgress({ kind: 'original', percent: 0 })

    try {
      const presign = await requestPresignFor(currentCardId, photo.file, 'original', currentEditToken)
      await uploadToS3(presign, photo.file, (percent) =>
        setUploadProgress({ kind: 'original', percent })
      )

      const uploaded: UploadedPhoto = {
        key: presign.key,
        publicUrl: presign.publicUrl,
        width: photo.width,
        height: photo.height,
      }

      setUploadedPhoto(uploaded)
      setUploadStatus('uploaded')
      setUploadProgress(null)
      return uploaded
    } catch {
      setUploadStatus('error')
      setUploadProgress(null)
      throw new Error('Photo upload failed. Please try again.')
    }
  }

  const hasPhoto = Boolean(photo || uploadedPhoto)

  // Calculate current step for progress tracker
  const currentStep = useMemo(() => {
    if (!form.cardType) return 0
    if (!hasPhoto) return 1
    if (!normalizedCrop) return 2
    const hasRequiredDetails = form.cardType === 'rare'
      ? form.title.trim() && form.photographer.trim()
      : form.firstName.trim() && form.lastName.trim() && form.position.trim() && form.photographer.trim()
    if (!hasRequiredDetails) return 3
    return 4
  }, [form.cardType, hasPhoto, normalizedCrop, form.firstName, form.lastName, form.position, form.title, form.photographer])

  // Get first incomplete field for a given step
  const getFirstIncompleteField = useCallback((stepId: StepId): HTMLElement | null => {
    switch (stepId) {
      case 'type':
        if (!form.cardType) return fieldRefs.current.cardType || null
        break
      case 'photo':
        if (!hasPhoto) return fieldRefs.current.uploadZone || null
        break
      case 'crop':
        if (!normalizedCrop) return sectionRefs.current.crop || null
        break
      case 'details':
        if (form.cardType === 'rare') {
          if (!form.title.trim()) return fieldRefs.current.title || null
          if (!form.photographer.trim()) return fieldRefs.current.photographer || null
        } else {
          if (!form.firstName.trim()) return fieldRefs.current.firstName || null
          if (!form.lastName.trim()) return fieldRefs.current.lastName || null
          if (!form.position.trim()) return fieldRefs.current.position || null
          if (!form.photographer.trim()) return fieldRefs.current.photographer || null
        }
        break
    }
    return null
  }, [form.cardType, form.firstName, form.lastName, form.photographer, form.position, form.title, hasPhoto, normalizedCrop])

  // Handler for step click - scrolls to section and focuses first incomplete field
  const handleStepClick = useCallback((stepIndex: number) => {
    const step = STEPS[stepIndex]
    const section = sectionRefs.current[step.id]

    section?.scrollIntoView({ behavior: 'smooth', block: 'start' })

    // Focus first incomplete field after scroll completes
    setTimeout(() => {
      const field = getFirstIncompleteField(step.id)
      if (field && 'focus' in field && typeof field.focus === 'function') {
        field.focus()
      }
    }, 400)
  }, [getFirstIncompleteField])

  const getValidationErrors = useCallback(() => {
    const errors: Partial<Record<
      | 'tournamentId'
      | 'cardType'
      | 'firstName'
      | 'lastName'
      | 'teamId'
      | 'position'
      | 'title'
      | 'caption'
      | 'photo'
      | 'crop'
      | 'jerseyNumber'
      | 'photographer',
      string
    >> = {}

    const firstName = form.firstName.trim()
    const lastName = form.lastName.trim()
    const position = form.position.trim()
    const jerseyNumber = form.jerseyNumber.trim()
    const title = form.title.trim()
    const caption = form.caption.trim()

    if (!form.tournamentId) {
      errors.tournamentId = 'Tournament is required'
    }

    if (!form.cardType) {
      errors.cardType = 'Card type is required'
    }

    if (form.cardType === 'rare') {
      if (!title) {
        errors.title = 'Title is required'
      } else if (title.length > MAX_TITLE_LENGTH) {
        errors.title = `Title must be ${MAX_TITLE_LENGTH} characters or fewer`
      }
      if (caption && caption.length > MAX_CAPTION_LENGTH) {
        errors.caption = `Caption must be ${MAX_CAPTION_LENGTH} characters or fewer`
      }
    } else {
      if (!firstName) {
        errors.firstName = 'First name is required'
      } else if (firstName.length > MAX_NAME_LENGTH) {
        errors.firstName = `First name must be ${MAX_NAME_LENGTH} characters or fewer`
      }

      if (!lastName) {
        errors.lastName = 'Last name is required'
      } else if (lastName.length > MAX_NAME_LENGTH) {
        errors.lastName = `Last name must be ${MAX_NAME_LENGTH} characters or fewer`
      }

      if (!position) {
        errors.position = 'Position is required'
      } else if (position.length > MAX_POSITION_LENGTH) {
        errors.position = `Position must be ${MAX_POSITION_LENGTH} characters or fewer`
      }

      if (cardTypeConfig?.showTeamField && !form.teamId) {
        errors.teamId = 'Team is required'
      }
    }

    if (form.teamId && selectedTeam?.name && selectedTeam.name.length > MAX_TEAM_LENGTH) {
      errors.teamId = `Team name must be ${MAX_TEAM_LENGTH} characters or fewer`
    }

    if (jerseyNumber && !JERSEY_PATTERN.test(jerseyNumber)) {
      errors.jerseyNumber = 'Jersey number must be 1-2 digits'
    }

    if (!hasPhoto) errors.photo = 'Photo is required'
    if (!normalizedCrop) errors.crop = 'Crop is required'

    const photographer = form.photographer.trim()
    if (!photographer) {
      errors.photographer = 'Photo credit is required'
    } else if (photographer.length > MAX_PHOTOGRAPHER_LENGTH) {
      errors.photographer = `Photo credit must be ${MAX_PHOTOGRAPHER_LENGTH} characters or fewer`
    }

    return errors
  }, [
    form.caption,
    form.cardType,
    form.firstName,
    form.jerseyNumber,
    form.lastName,
    form.photographer,
    form.position,
    form.teamId,
    form.title,
    form.tournamentId,
    hasPhoto,
    normalizedCrop,
    cardTypeConfig,
    selectedTeam,
  ])

  const saveMutation = useMutation({
    mutationFn: async () => {
      setError(null)

      const payload = buildPayload()

      // Step 1: Create or get card ID
      const { id: currentCardId, editToken: currentEditToken } = await ensureCard(payload)

      // Step 2: Upload photo if we have a new one that hasn't been uploaded
      let photoPayload: SavePayload['photo'] = undefined

      if (photo && !uploadedPhoto) {
        const uploaded = await uploadOriginalPhoto(currentCardId, currentEditToken)
        photoPayload = buildPhotoPayload(uploaded, normalizedCrop)
      } else if (uploadedPhoto) {
        // Photo already uploaded, just update crop
        photoPayload = buildPhotoPayload(uploadedPhoto, normalizedCrop)
      } else if (normalizedCrop) {
        // Just crop, no photo
        photoPayload = buildPhotoPayload(null, normalizedCrop)
      }

      if (photoPayload) {
        payload.photo = photoPayload
      }

      // Step 3: Update card with all data
      const updatedCard = await updateCard(currentCardId, buildUpdatePayload(payload), currentEditToken)
      return updatedCard
    },
    onSuccess: (data) => {
      setSavedCard(data)
      if (data.editToken) setEditToken(data.editToken)

      // Update draft in localStorage with latest form data
      if (data.id && data.editToken && form.tournamentId && form.cardType) {
        saveDraft({
          cardId: data.id,
          editToken: data.editToken,
          tournamentId: form.tournamentId,
          cardType: form.cardType,
          form: {
            teamId: form.teamId,
            position: form.position,
            jerseyNumber: form.jerseyNumber,
            firstName: form.firstName,
            lastName: form.lastName,
            title: form.title,
            caption: form.caption,
            photographer: form.photographer,
            templateId: form.templateId,
          },
          savedAt: new Date().toISOString(),
        })
      }
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    },
  })

  const submitMutation = useMutation({
    mutationFn: async () => {
      setHasEdited(true)

      const validationErrors = getValidationErrors()
      if (photoError || Object.keys(validationErrors).length > 0) {
        throw new Error('Please complete the required fields before submitting')
      }

      setError(null)

      if (!tournamentConfig) {
        throw new Error('Tournament config is not available')
      }

      const payload = buildPayload()
      const { id: currentCardId, editToken: currentEditToken } = await ensureCard(payload)
      const uploaded = uploadedPhoto ?? (photo ? await uploadOriginalPhoto(currentCardId, currentEditToken) : null)

      if (!uploaded) {
        throw new Error('Please upload a photo before submitting')
      }

      if (!normalizedCrop) {
        throw new Error('Please set a crop before submitting')
      }

      const photoPayload = buildPhotoPayload(uploaded, normalizedCrop)
      if (photoPayload) {
        payload.photo = photoPayload
      }

      await updateCard(currentCardId, buildUpdatePayload(payload), currentEditToken)

      // Submit the card
      setSubmitStatus('submitting')
      const submitted = await submitCard(currentCardId, currentEditToken)
      setSubmitStatus('done')

      return submitted
    },
    onSuccess: (data) => {
      setSavedCard(data)
      if (data.editToken) setEditToken(data.editToken)
      // Clear draft from localStorage after successful submit
      clearDraft()
    },
    onError: (err) => {
      setSubmitStatus('error')
      setError(err instanceof Error ? err.message : 'Submission failed')
    },
  })

  const validationErrors = useMemo(() => getValidationErrors(), [getValidationErrors])
  const canSubmit =
    !submitMutation.isPending &&
    !photoError &&
    Object.keys(validationErrors).length === 0 &&
    Boolean(tournamentConfig)

  const statusIndicator = useMemo(() => {
    const errorMessage = error ?? (helloQuery.error instanceof Error ? helloQuery.error.message : null)
    if (errorMessage) return { message: errorMessage, tone: 'error' as const }

    if (submitStatus === 'submitting') return { message: 'Submitting card...', tone: 'warning' as const }
    if (submitStatus === 'done') return { message: 'Card submitted successfully!', tone: 'success' as const }

    if (saveMutation.isPending) {
      if (uploadStatus === 'uploading') return { message: 'Uploading photo...', tone: 'warning' as const }
      return { message: 'Saving draft...', tone: 'warning' as const }
    }

    if (saveMutation.isSuccess) return { message: 'Draft saved', tone: 'success' as const }
    if (hasEdited && Object.keys(validationErrors).length > 0) {
      return { message: 'Complete required fields to submit', tone: 'error' as const }
    }

    return { message: 'Ready to create', tone: 'neutral' as const }
  }, [
    error,
    helloQuery.error,
    submitStatus,
    saveMutation.isPending,
    saveMutation.isSuccess,
    uploadStatus,
    hasEdited,
    validationErrors,
  ])

  const saveButtonLabel = saveMutation.isPending
    ? uploadStatus === 'uploading'
      ? 'Uploading...'
      : 'Saving...'
    : 'Save Draft'

  const submitButtonLabel = submitMutation.isPending ? 'Submitting...' : 'Submit Card'

  const isSubmitInProgress = submitStatus === 'submitting'

  const handleFieldChange = (key: keyof FormState) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      setHasEdited(true)
      setError(null)
      setForm((prev) => ({ ...prev, [key]: event.target.value }))
    }

  const handleCardTypeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value as CardType | ''
    setHasEdited(true)
    setError(null)
    setForm((prev) => {
      const next = { ...prev, cardType: value }
      if (value === 'rare') {
        return {
          ...next,
          teamId: '',
          position: '',
          jerseyNumber: '',
          firstName: '',
          lastName: '',
        }
      }
      return {
        ...next,
        title: '',
        caption: '',
        teamId: value === 'player' || value === 'team-staff' ? next.teamId : '',
        jerseyNumber: value === 'player' ? next.jerseyNumber : '',
      }
    })
  }

  const handleResumeDraft = useCallback(() => {
    if (!pendingDraft) return

    // Restore card identifiers
    setCardId(pendingDraft.cardId)
    setEditToken(pendingDraft.editToken)

    // Restore form data
    setForm({
      tournamentId: pendingDraft.tournamentId,
      cardType: pendingDraft.cardType as CardType | '',
      ...pendingDraft.form,
    })
    setSelectedTournamentId(pendingDraft.tournamentId)

    // Close the modal
    setPendingDraft(null)
  }, [pendingDraft])

  const handleDismissDraft = useCallback(() => {
    clearDraft()
    setPendingDraft(null)
  }, [])

  const handleFileSelect = useCallback(async (file: File) => {
    setHasEdited(true)
    setError(null)

    if (!ALLOWED_UPLOAD_TYPES.has(file.type)) {
      setPhotoError('Unsupported file type. Use JPG, PNG, or WebP.')
      return
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      setPhotoError('File is too large. Max size is 15MB.')
      return
    }

    setPhotoError(null)

    try {
      const resized = await resizeImageIfNeeded(file)
      const localUrl = URL.createObjectURL(resized.file)

      setPhoto((prev) => {
        if (prev) URL.revokeObjectURL(prev.localUrl)
        return {
          file: resized.file,
          localUrl,
          width: resized.width,
          height: resized.height,
        }
      })

      // Reset upload state when new photo is selected
      setUploadedPhoto(null)
      setUploadStatus('idle')
      setUploadProgress(null)
      setRenderedCardUrl(null)
      setPreviewUrl(null)
      setPreviewError(null)
      setSubmitStatus('idle')
      setMediaSize(null)

      // Reset crop
      setCrop({ x: 0, y: 0 })
      setZoom(1)
      setRotation(0)
      setNormalizedCrop(null)
    } catch {
      setError('Failed to load image')
    }
  }, [])

  const handleFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    void handleFileSelect(file)
    event.target.value = ''
  }, [handleFileSelect])

  const handleUploadClick = useCallback((event: MouseEvent<HTMLElement>) => {
    event.preventDefault()
    const input = fileInputRef.current
    if (!input) {
      return
    }
    try {
      if ('showPicker' in input && typeof (input as HTMLInputElement & { showPicker?: () => void }).showPicker === 'function') {
        ;(input as HTMLInputElement & { showPicker: () => void }).showPicker()
      } else {
        input.click()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const handleDrop = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setIsDragging(false)
    const file = event.dataTransfer.files?.[0]
    if (file) {
      void handleFileSelect(file)
    }
  }, [handleFileSelect])

  const handleDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    if (!isDragging) {
      setIsDragging(true)
    }
  }, [isDragging])

  const handleDragLeave = useCallback(() => {
    setIsDragging(false)
  }, [])

  // react-easy-crop onCropComplete: (croppedArea, croppedAreaPixels)
  // 1st arg = percentages (0-100), 2nd arg = pixels
  const handleCropComplete = useCallback((croppedAreaPercent: Area) => {
    const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
    setNormalizedCrop({
      x: clamp01(Number((croppedAreaPercent.x / 100).toFixed(4))),
      y: clamp01(Number((croppedAreaPercent.y / 100).toFixed(4))),
      w: clamp01(Number((croppedAreaPercent.width / 100).toFixed(4))),
      h: clamp01(Number((croppedAreaPercent.height / 100).toFixed(4))),
      rotateDeg: rotation,
    })
  }, [rotation])

  const handleMediaLoaded = useCallback((size: MediaSize) => {
    setMediaSize(size)
    setNormalizedCrop((prev) => prev ?? buildDefaultCrop(size, rotation))
  }, [rotation])

  const handleZoom = (delta: number) => {
    setZoom((prev) => clamp(Number((prev + delta).toFixed(2)), 1, 3))
  }

  const handleResetCrop = () => {
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setRotation(0)
    if (mediaSize) {
      setNormalizedCrop(buildDefaultCrop(mediaSize, 0))
    } else {
      setNormalizedCrop(null)
    }
  }

  const resetSession = useCallback(() => {
    setCardId(null)
    setEditToken(null)
    setSavedCard(null)
    setUploadedPhoto(null)
    setUploadStatus('idle')
    setUploadProgress(null)
    setRenderedCardUrl(null)
    setPreviewUrl(null)
    setPreviewError(null)
    setSubmitStatus('idle')
    setHasEdited(false)
    setError(null)
    setPhotoError(null)
    setNormalizedCrop(null)
    setMediaSize(null)
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setRotation(0)
    setPhoto((prev) => {
      if (prev) URL.revokeObjectURL(prev.localUrl)
      return null
    })
  }, [])

  const handleTournamentContinue = () => {
    if (!selectedTournamentId) return
    resetSession()
    setForm((prev) => ({
      ...initialForm,
      tournamentId: selectedTournamentId,
      templateId: prev.templateId,
    }))
  }

  const handleTournamentReset = () => {
    resetSession()
    setForm(initialForm)
  }

  const handleSaveDraft = () => {
    setHasEdited(true)
    saveMutation.mutate()
  }

  const displayName = useMemo(() => {
    if (form.cardType === 'rare') {
      const title = form.title.trim()
      return title.length > 0 ? title : 'Rare Card'
    }

    const first = form.firstName.trim()
    const last = form.lastName.trim()
    const full = [first, last].filter(Boolean).join(' ')
    return full.length > 0 ? full : 'Player Name'
  }, [form.cardType, form.firstName, form.lastName, form.title])

  // Use S3 URL if uploaded, otherwise local blob URL
  const uploadedCropperUrl = uploadedPhoto?.publicUrl ? media(uploadedPhoto.publicUrl) : null
  const cropperImageUrl = photo?.localUrl ?? uploadedCropperUrl

  const buildCardForRender = useCallback(
    (timestamp: string): Card | null => {
      if (!form.cardType || !form.tournamentId) return null

      return {
        id: cardId ?? 'preview',
        tournamentId: form.tournamentId,
        cardType: form.cardType as CardType,
        status: savedCard?.status ?? 'draft',
        createdAt: savedCard?.createdAt ?? timestamp,
        updatedAt: timestamp,
        templateId: toOptional(form.templateId),
        photographer: toOptional(form.photographer),
        photo: normalizedCrop ? { crop: normalizedCrop } : undefined,
        firstName: toOptional(form.firstName),
        lastName: toOptional(form.lastName),
        position: toOptional(form.position),
        teamId: toOptional(form.teamId),
        teamName: selectedTeam?.name,
        jerseyNumber: toOptional(form.jerseyNumber),
        title: toOptional(form.title),
        caption: toOptional(form.caption),
      }
    },
    [
      cardId,
      form.caption,
      form.cardType,
      form.firstName,
      form.jerseyNumber,
      form.lastName,
      form.photographer,
      form.position,
      form.teamId,
      form.templateId,
      form.title,
      form.tournamentId,
      normalizedCrop,
      savedCard?.createdAt,
      savedCard?.status,
      selectedTeam,
    ]
  )

  useEffect(() => {
    if (!tournamentConfig || !cropperImageUrl || !normalizedCrop || !form.cardType) {
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      setPreviewError(null)
      return
    }

    let cancelled = false
    const timeout = setTimeout(async () => {
      try {
        const timestamp = new Date().toISOString()
        const card = buildCardForRender(timestamp)
        if (!card) return
        const blob = await renderPreviewTrim({
          card,
          config: tournamentConfig,
          imageUrl: cropperImageUrl,
          resolveAssetUrl: assetUrlForKey,
          templateId: toOptional(form.templateId),
        })
        if (cancelled) return
        const url = URL.createObjectURL(blob)
        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev)
          return url
        })
        setPreviewError(null)
      } catch {
        if (!cancelled) {
          setPreviewError('Preview failed to render')
        }
      }
    }, 500)

    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [buildCardForRender, cropperImageUrl, form.cardType, form.templateId, normalizedCrop, tournamentConfig])

  // Status badge styling
  const getStatusBadgeClass = (tone: string) => {
    switch (tone) {
      case 'success': return 'status-badge status-badge-success'
      case 'warning': return 'status-badge status-badge-warning'
      case 'error': return 'status-badge status-badge-error'
      default: return 'status-badge status-badge-neutral'
    }
  }

  return (
    <div className="app-shell min-h-screen">
      {/* Resume Draft Modal */}
      {pendingDraft && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <h2 className="modal-title">Resume your draft?</h2>
            <p className="modal-description">
              You have an unsaved draft from {new Date(pendingDraft.savedAt).toLocaleString()}.
              Would you like to continue where you left off?
            </p>
            <p className="mt-3 text-xs text-[var(--text-muted)]">
              Note: You will need to re-upload your photo.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                onClick={handleResumeDraft}
                className="studio-btn studio-btn-primary flex-1"
              >
                Resume Draft
              </button>
              <button
                onClick={handleDismissDraft}
                className="studio-btn studio-btn-secondary flex-1"
              >
                Start Fresh
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="studio-header">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-bold text-[var(--text-primary)]">Card Studio</h1>
            <span className="hidden text-sm text-[var(--text-muted)] sm:inline">Create your trading card</span>
          </div>

          {/* Horizontal Progress Stepper - Desktop */}
          {form.tournamentId && (
            <div className="hidden items-center gap-1 md:flex">
              {STEPS.map((step, index) => (
                <button
                  key={step.id}
                  onClick={() => handleStepClick(index)}
                  className={`step-button ${
                    index < currentStep
                      ? 'step-button-completed'
                      : index === currentStep
                        ? 'step-button-current'
                        : 'step-button-pending'
                  }`}
                >
                  <span className={`step-number ${
                    index < currentStep
                      ? 'step-number-completed'
                      : index === currentStep
                        ? 'step-number-current'
                        : 'step-number-pending'
                  }`}>
                    {index < currentStep ? <IconCheckSmall /> : index + 1}
                  </span>
                  <span className="hidden lg:inline">{step.label}</span>
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-3">
            <span className={`hidden sm:inline-flex ${getStatusBadgeClass(statusIndicator.tone)}`}>
              {statusIndicator.tone === 'success' && <IconCheck />}
              {statusIndicator.message}
            </span>
            {uploadProgress && (
              <div className="flex items-center gap-2">
                <div className="progress-bar w-24">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${uploadProgress.percent}%` }}
                  />
                </div>
                <span className="text-xs text-[var(--text-muted)]">{uploadProgress.percent}%</span>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Mobile Progress Indicator */}
      {form.tournamentId && (
        <div className="sticky top-[57px] z-20 md:hidden bg-[var(--bg-surface)] border-b border-[var(--border-light)]">
          <div className="flex items-center justify-between px-2 py-3">
            {STEPS.map((step, index) => (
              <button
                key={step.id}
                onClick={() => handleStepClick(index)}
                className={`flex flex-col items-center gap-1 px-1 transition
                  ${index < currentStep
                    ? 'text-[var(--accent-primary)]'
                    : index === currentStep
                      ? 'text-[var(--accent-secondary)]'
                      : 'text-[var(--text-muted)]'
                  }`}
                aria-label={step.label}
              >
                <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium
                  ${index < currentStep
                    ? 'bg-[var(--accent-primary)] text-white'
                    : index === currentStep
                      ? 'bg-[var(--accent-secondary)] text-white'
                      : 'bg-[var(--bg-tertiary)]'
                  }`}>
                  {index < currentStep ? '✓' : index + 1}
                </span>
                <span className="text-[10px] font-medium">{step.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <main className="mx-auto max-w-7xl px-6 py-8">
        {!form.tournamentId ? (
          /* Tournament Selection */
          <div className="mx-auto max-w-lg">
            <div className="studio-panel p-8">
              <h2 className="text-xl font-bold text-[var(--text-primary)]">Get Started</h2>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">
                Select a tournament to load teams, positions, and branding.
              </p>

              <div className="mt-8">
                <label className="studio-label">
                  Tournament
                </label>
                <select
                  value={selectedTournamentId}
                  onChange={(event) => setSelectedTournamentId(event.target.value)}
                  className="studio-input studio-select"
                >
                  <option value="">Select a tournament</option>
                  {tournamentsQuery.data.map((tournament) => (
                    <option key={tournament.id} value={tournament.id}>
                      {tournament.name.includes(String(tournament.year))
                        ? tournament.name
                        : `${tournament.name} ${tournament.year}`}
                    </option>
                  ))}
                </select>
                <p className="studio-hint">
                  {tournamentsQuery.isFetching ? 'Loading...' : `${tournamentsQuery.data.length} tournaments available`}
                </p>
              </div>

              <button
                type="button"
                onClick={handleTournamentContinue}
                disabled={!selectedTournamentId}
                className="studio-btn studio-btn-primary mt-6 w-full"
              >
                Continue
              </button>
            </div>
          </div>
        ) : (
          /* Main Studio Layout */
          <div className="grid gap-8 lg:grid-cols-[400px_1fr]">
            {/* Canvas Area */}
            <div className="space-y-6 lg:order-2 order-2">
              {/* Toolbar */}
              <div className="studio-panel flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[var(--text-primary)]">
                    {tournamentConfig?.name ?? form.tournamentId}
                  </span>
                  <button
                    type="button"
                    onClick={handleTournamentReset}
                    className="studio-btn studio-btn-ghost studio-btn-sm"
                  >
                    Change
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSaveDraft}
                    disabled={saveMutation.isPending}
                    className="studio-btn studio-btn-secondary studio-btn-sm"
                  >
                    {saveButtonLabel}
                  </button>
                  <button
                    type="button"
                    onClick={() => submitMutation.mutate()}
                    disabled={!canSubmit}
                    className="studio-btn studio-btn-success studio-btn-sm"
                  >
                    {submitButtonLabel}
                  </button>
                </div>
              </div>

              {/* Preview Card */}
              <div className={`studio-panel p-6 ${submitStatus === 'done' ? 'celebrate' : ''}`}>
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                    {renderedCardUrl ? 'Rendered Card' : 'Live Preview'}
                  </h3>
                  {previewUrl && !renderedCardUrl && (
                    <span className="text-xs text-[var(--text-muted)]">Auto-updating</span>
                  )}
                </div>

                <div className="canvas-wrapper">
                  {renderedCardUrl ? (
                    <div className="canvas-frame">
                      <img
                        src={renderedCardUrl}
                        alt="Rendered trading card"
                        className="w-full max-w-[300px]"
                      />
                    </div>
                  ) : previewUrl ? (
                    <div className="canvas-frame" style={{ aspectRatio: `${TRIM_ASPECT}` }}>
                      <img
                        src={previewUrl}
                        alt="Live preview"
                        className="h-full w-full max-w-[300px]"
                      />
                    </div>
                  ) : (
                    <div
                      className="flex items-center justify-center rounded-lg border-2 border-dashed border-[var(--border-light)] bg-white text-center text-sm text-[var(--text-muted)]"
                      style={{ aspectRatio: `${TRIM_ASPECT}`, width: '300px' }}
                    >
                      {isSubmitInProgress ? (
                        <div className="flex flex-col items-center gap-3">
                          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--accent-primary)] border-t-transparent" />
                          <span className="text-xs font-medium">Submitting...</span>
                        </div>
                      ) : previewError ? (
                        <span className="text-[var(--accent-error)]">{previewError}</span>
                      ) : (
                        <span>Upload a photo to see preview</span>
                      )}
                    </div>
                  )}
                </div>

                {renderedCardUrl && (
                  <div className="mt-4 flex items-center justify-center gap-3">
                    <a
                      href={renderedCardUrl}
                      download="trading-card.png"
                      className="studio-btn studio-btn-secondary studio-btn-sm"
                    >
                      <IconDownload />
                      Download
                    </a>
                  </div>
                )}
              </div>

              {/* Crop Tool */}
              <div
                ref={(el) => { sectionRefs.current.crop = el }}
                className="studio-panel scroll-mt-20 p-6"
              >
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">Frame Your Shot</h3>
                    <p className="text-xs text-[var(--text-muted)]">Drag to position, scroll to zoom</p>
                  </div>

                  {/* Zoom Controls */}
                  <div className="zoom-controls">
                    <button
                      type="button"
                      onClick={() => handleZoom(-0.2)}
                      className="zoom-btn tooltip"
                      aria-label="Zoom out"
                    >
                      <IconZoomOut />
                      <span className="tooltip-content">Zoom Out</span>
                    </button>
                    <span className="zoom-value">{Math.round(zoom * 100)}%</span>
                    <button
                      type="button"
                      onClick={() => handleZoom(0.2)}
                      className="zoom-btn tooltip"
                      aria-label="Zoom in"
                    >
                      <IconZoomIn />
                      <span className="tooltip-content">Zoom In</span>
                    </button>
                    <div className="mx-1 h-4 w-px bg-[var(--border-light)]" />
                    <button
                      type="button"
                      onClick={handleResetCrop}
                      className="zoom-btn tooltip"
                      aria-label="Reset"
                    >
                      <IconReset />
                      <span className="tooltip-content">Reset</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowGuides((prev) => !prev)}
                      className={`zoom-btn tooltip ${showGuides ? 'bg-[var(--bg-muted)]' : ''}`}
                      aria-label="Toggle guides"
                    >
                      <IconGrid />
                      <span className="tooltip-content">{showGuides ? 'Hide Guides' : 'Show Guides'}</span>
                    </button>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setShowGuidesHelp((prev) => !prev)}
                        className="zoom-btn"
                        aria-label="Guide help"
                      >
                        <IconInfo />
                      </button>
                      {showGuidesHelp && (
                        <div className="absolute right-0 top-full z-20 mt-2 w-64 rounded-xl border border-[var(--border-light)] bg-white p-4 shadow-lg">
                          <div className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Print Guides</div>
                          <ul className="space-y-2 text-xs text-[var(--text-secondary)]">
                            <li className="flex items-start gap-2">
                              <span className="mt-0.5 h-3 w-3 shrink-0 rounded-sm border-2 border-dashed border-sky-400" />
                              <span><span className="font-medium text-sky-500">Blue</span> - Safe zone. Content here prints.</span>
                            </li>
                            <li className="flex items-start gap-2">
                              <span className="mt-0.5 h-3 w-3 shrink-0 rounded-sm border-2 border-rose-400" />
                              <span><span className="font-medium text-rose-500">Red</span> - Trim line. Where the card is cut.</span>
                            </li>
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="relative aspect-[825/1125] w-full overflow-hidden rounded-xl bg-[var(--bg-muted)]">
                  {cropperImageUrl ? (
                    <Cropper
                      image={cropperImageUrl}
                      crop={crop}
                      zoom={zoom}
                      rotation={0}
                      aspect={CARD_ASPECT}
                      onCropChange={setCrop}
                      onZoomChange={setZoom}
                      onCropComplete={handleCropComplete}
                      onMediaLoaded={handleMediaLoaded}
                      showGrid={false}
                      classes={{
                        containerClassName: 'cropper-container',
                        cropAreaClassName: 'cropper-area',
                      }}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-sm text-[var(--text-muted)]">
                      Upload a photo to start cropping
                    </div>
                  )}
                  <CropGuides visible={showGuides} mode="trim" />
                </div>
                {hasEdited && validationErrors.crop && (
                  <p className="studio-error">{validationErrors.crop}</p>
                )}
              </div>
            </div>

            {/* Sidebar - Form First */}
            <div className="studio-panel overflow-hidden lg:order-1 order-1">
              {/* Card Type Section */}
              <div
                ref={(el) => { sectionRefs.current.type = el }}
                className="sidebar-section scroll-mt-20"
              >
                <h3 className="sidebar-section-title">Card Type</h3>
                <div className="space-y-4">
                  <div>
                    <label className="studio-label">
                      Type <span className="studio-label-required">*</span>
                    </label>
                    <select
                      ref={(el) => { fieldRefs.current.cardType = el }}
                      value={form.cardType}
                      onChange={handleCardTypeChange}
                      disabled={!tournamentConfig}
                      className={`studio-input studio-select ${hasEdited && validationErrors.cardType ? 'has-error' : ''}`}
                    >
                      <option value="">Select type</option>
                      {tournamentConfig?.cardTypes
                        .filter((entry) => entry.enabled)
                        .map((entry) => (
                          <option key={entry.type} value={entry.type}>
                            {entry.label}
                          </option>
                        ))}
                    </select>
                    {hasEdited && validationErrors.cardType && (
                      <p className="studio-error">{validationErrors.cardType}</p>
                    )}
                  </div>

                  {/* Style - only show when multiple templates available */}
                  {(templateOptions.length > 1 || hasUnknownTemplate) && (
                    <div>
                      <label className="studio-label">Style</label>
                      <select
                        value={form.templateId}
                        onChange={handleFieldChange('templateId')}
                        className="studio-input studio-select"
                      >
                        <option value="">{`Default (${defaultTemplateLabel})`}</option>
                        {hasUnknownTemplate && (
                          <option value={form.templateId}>{`Custom (${form.templateId})`}</option>
                        )}
                        {templateOptions.map((template) => (
                          <option key={template.id} value={template.id}>
                            {template.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>

              {/* Details Section */}
              <div
                ref={(el) => { sectionRefs.current.details = el }}
                className="sidebar-section scroll-mt-20"
              >
                <h3 className="sidebar-section-title">
                  {form.cardType === 'rare' ? 'Card Details' : 'Player Details'}
                </h3>

                <div className="space-y-4">
                  {form.cardType === 'rare' ? (
                    <>
                      <div>
                        <label className="studio-label">
                          Title <span className="studio-label-required">*</span>
                        </label>
                        <input
                          ref={(el) => { fieldRefs.current.title = el }}
                          value={form.title}
                          onChange={handleFieldChange('title')}
                          maxLength={MAX_TITLE_LENGTH}
                          className={`studio-input ${hasEdited && validationErrors.title ? 'has-error' : ''}`}
                          placeholder="Championship MVP"
                        />
                        {hasEdited && validationErrors.title && (
                          <p className="studio-error">{validationErrors.title}</p>
                        )}
                      </div>
                      <div>
                        <label className="studio-label">Caption</label>
                        <textarea
                          value={form.caption}
                          onChange={handleFieldChange('caption')}
                          maxLength={MAX_CAPTION_LENGTH}
                          rows={2}
                          className={`studio-input ${hasEdited && validationErrors.caption ? 'has-error' : ''}`}
                          placeholder="Awarded to the tournament MVP"
                        />
                        {hasEdited && validationErrors.caption && (
                          <p className="studio-error">{validationErrors.caption}</p>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="studio-label">
                            First Name <span className="studio-label-required">*</span>
                          </label>
                          <input
                            ref={(el) => { fieldRefs.current.firstName = el }}
                            value={form.firstName}
                            onChange={handleFieldChange('firstName')}
                            maxLength={MAX_NAME_LENGTH}
                            className={`studio-input ${hasEdited && validationErrors.firstName ? 'has-error' : ''}`}
                            placeholder="Brandon"
                          />
                          {hasEdited && validationErrors.firstName && (
                            <p className="studio-error">{validationErrors.firstName}</p>
                          )}
                        </div>
                        <div>
                          <label className="studio-label">
                            Last Name <span className="studio-label-required">*</span>
                          </label>
                          <input
                            ref={(el) => { fieldRefs.current.lastName = el }}
                            value={form.lastName}
                            onChange={handleFieldChange('lastName')}
                            maxLength={MAX_NAME_LENGTH}
                            className={`studio-input ${hasEdited && validationErrors.lastName ? 'has-error' : ''}`}
                            placeholder="Williams"
                          />
                          {hasEdited && validationErrors.lastName && (
                            <p className="studio-error">{validationErrors.lastName}</p>
                          )}
                        </div>
                      </div>

                      {cardTypeConfig?.showTeamField && (
                        <div>
                          <label className="studio-label">
                            Team <span className="studio-label-required">*</span>
                          </label>
                          <input
                            type="text"
                            value={teamSearch}
                            onChange={(e) => setTeamSearch(e.target.value)}
                            placeholder="Search teams..."
                            className="studio-input mb-2"
                          />
                          <select
                            value={form.teamId}
                            onChange={(e) => {
                              handleFieldChange('teamId')(e)
                              setTeamSearch('')
                            }}
                            className={`studio-input studio-select ${hasEdited && validationErrors.teamId ? 'has-error' : ''}`}
                          >
                            <option value="">
                              Select team{teamSearch ? ` (${filteredTeams.length} matches)` : ''}
                            </option>
                            {filteredTeams.map((team) => (
                              <option key={team.id} value={team.id}>
                                {team.name}
                              </option>
                            ))}
                          </select>
                          {hasEdited && validationErrors.teamId && (
                            <p className="studio-error">{validationErrors.teamId}</p>
                          )}
                          {selectedTeam?.logoKey && (
                            <img
                              src={assetUrlForKey(selectedTeam.logoKey)}
                              alt={`${selectedTeam.name} logo`}
                              className="team-logo mt-2"
                            />
                          )}
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="studio-label">
                            Position <span className="studio-label-required">*</span>
                          </label>
                          {cardTypeConfig?.positions && cardTypeConfig.positions.length > 0 ? (
                            <select
                              ref={(el) => { fieldRefs.current.position = el }}
                              value={form.position}
                              onChange={handleFieldChange('position')}
                              className={`studio-input studio-select ${hasEdited && validationErrors.position ? 'has-error' : ''}`}
                            >
                              <option value="">Select</option>
                              {cardTypeConfig.positions.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              ref={(el) => { fieldRefs.current.position = el }}
                              value={form.position}
                              onChange={handleFieldChange('position')}
                              maxLength={MAX_POSITION_LENGTH}
                              className={`studio-input ${hasEdited && validationErrors.position ? 'has-error' : ''}`}
                              placeholder="Keeper"
                            />
                          )}
                          {hasEdited && validationErrors.position && (
                            <p className="studio-error">{validationErrors.position}</p>
                          )}
                        </div>

                        {cardTypeConfig?.showJerseyNumber && (
                          <div>
                            <label className="studio-label">Jersey #</label>
                            <input
                              value={form.jerseyNumber}
                              onChange={handleFieldChange('jerseyNumber')}
                              maxLength={MAX_JERSEY_LENGTH}
                              inputMode="numeric"
                              pattern="\\d*"
                              className={`studio-input ${hasEdited && validationErrors.jerseyNumber ? 'has-error' : ''}`}
                              placeholder="15"
                            />
                            {hasEdited && validationErrors.jerseyNumber ? (
                              <p className="studio-error">{validationErrors.jerseyNumber}</p>
                            ) : (
                              <p className="studio-hint">1-2 digits</p>
                            )}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Photo Section */}
              <div
                ref={(el) => { sectionRefs.current.photo = el }}
                className="sidebar-section scroll-mt-20"
              >
                <h3 className="sidebar-section-title">Photo</h3>

                <div
                  ref={(el) => { fieldRefs.current.uploadZone = el }}
                  tabIndex={0}
                  className={`upload-zone ${isDragging ? 'is-dragging' : ''}`}
                  onClick={handleUploadClick}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                >
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    onChange={handleFileChange}
                    ref={fileInputRef}
                  />
                  <div className="upload-zone-icon">
                    <IconUpload />
                  </div>
                  <div className="upload-zone-title">
                    {photo ? 'Replace photo' : 'Drop photo here'}
                  </div>
                  <div className="upload-zone-hint">
                    or click to browse (JPG, PNG, WebP)
                  </div>
                  {photo && (
                    <div className="upload-zone-file">
                      {photo.file.name} - {photo.width} x {photo.height}px
                    </div>
                  )}
                </div>

                {photoError && <p className="studio-error">{photoError}</p>}
                {hasEdited && validationErrors.photo && !photoError && (
                  <p className="studio-error">{validationErrors.photo}</p>
                )}

                <div className="mt-4">
                  <label className="studio-label">
                    Photo Credit <span className="studio-label-required">*</span>
                  </label>
                  <input
                    ref={(el) => { fieldRefs.current.photographer = el }}
                    value={form.photographer}
                    onChange={handleFieldChange('photographer')}
                    maxLength={MAX_PHOTOGRAPHER_LENGTH}
                    className={`studio-input ${hasEdited && validationErrors.photographer ? 'has-error' : ''}`}
                    placeholder="Photographer name"
                  />
                  {hasEdited && validationErrors.photographer && (
                    <p className="studio-error">{validationErrors.photographer}</p>
                  )}
                </div>
              </div>

              {/* Submit Section */}
              <div
                ref={(el) => { sectionRefs.current.submit = el }}
                className="sidebar-section scroll-mt-20"
              >
                <h3 className="sidebar-section-title">Submit</h3>
                <p className="mb-4 text-sm text-[var(--text-secondary)]">
                  Ready to create your card? Review the preview and submit.
                </p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={handleSaveDraft}
                    disabled={saveMutation.isPending}
                    className="studio-btn studio-btn-secondary flex-1"
                  >
                    {saveButtonLabel}
                  </button>
                  <button
                    type="button"
                    onClick={() => submitMutation.mutate()}
                    disabled={!canSubmit}
                    className="studio-btn studio-btn-success flex-1"
                  >
                    {submitButtonLabel}
                  </button>
                </div>
              </div>

              {/* Preview Meta */}
              <div className="sidebar-section">
                <h3 className="sidebar-section-title">Preview</h3>
                <div className="preview-meta">
                  <div className="preview-meta-name">{displayName}</div>
                  <div className="preview-meta-detail">
                    {form.cardType === 'rare'
                      ? form.caption || 'Caption'
                      : [form.position || 'Position', selectedTeam?.name || (cardTypeConfig?.showTeamField ? 'Team' : '')]
                          .filter(Boolean)
                          .join(' / ')}
                  </div>
                  {normalizedCrop && (
                    <div className="mt-2 text-xs text-[var(--text-muted)]">
                      Crop: {normalizedCrop.w.toFixed(2)} x {normalizedCrop.h.toFixed(2)}
                    </div>
                  )}
                  {savedCard && (
                    <div className="mt-3 rounded-lg bg-white px-3 py-2 text-xs text-[var(--text-secondary)]">
                      Draft ID: <span className="font-mono font-medium">{savedCard.id}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
