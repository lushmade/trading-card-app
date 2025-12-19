import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type DragEvent } from 'react'
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
  type ApiResponse,
  type Card,
  type CardType,
  type CropRect,
  type TournamentConfig,
  type TournamentListEntry,
  USQC_2025_CONFIG,
  USQC_2025_TOURNAMENT,
} from 'shared'
import { renderCard, renderCropBlob } from './renderCard'
import { api, assetUrlForKey, media, writeHeaders } from './api'

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
  cropKey?: string
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
    cropKey?: string
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
  kind: 'original' | 'crop' | 'render'
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
  templateId: 'classic',
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
  kind: 'original' | 'crop' | 'render',
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

async function submitCard(id: string, renderKey: string, editToken: string): Promise<Card> {
  const res = await fetch(api(`/cards/${id}/submit`), {
    method: 'POST',
    headers: editHeadersFor(editToken),
    body: JSON.stringify({ renderKey }),
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

function App() {
  const [form, setForm] = useState<FormState>(initialForm)
  const [selectedTournamentId, setSelectedTournamentId] = useState('')
  const [photo, setPhoto] = useState<PhotoState | null>(null)
  const [uploadedPhoto, setUploadedPhoto] = useState<UploadedPhoto | null>(null)
  const [uploadedCropKey, setUploadedCropKey] = useState<string | null>(null)
  const [mediaSize, setMediaSize] = useState<MediaSize | null>(null)
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState<Rotation>(0)
  const [normalizedCrop, setNormalizedCrop] = useState<CropRect | null>(null)
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
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'rendering' | 'uploading' | 'submitting' | 'done' | 'error'>('idle')
  const [hasEdited, setHasEdited] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  const helloQuery = useQuery({
    queryKey: ['hello'],
    queryFn: fetchHello,
    enabled: false,
  })

  const tournamentsQuery = useQuery({
    queryKey: ['tournaments'],
    queryFn: fetchTournaments,
    initialData: [USQC_2025_TOURNAMENT],
  })

  useEffect(() => {
    if (!selectedTournamentId && tournamentsQuery.data.length > 0) {
      setSelectedTournamentId(tournamentsQuery.data[0].id)
    }
  }, [selectedTournamentId, tournamentsQuery.data])

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

  const selectedTeam = useMemo(() => {
    if (!tournamentConfig) return null
    return tournamentConfig.teams.find((team) => team.id === form.teamId) ?? null
  }, [form.teamId, tournamentConfig])

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
    cropValue: CropRect | null,
    cropKey?: string | null
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

    if (cropKey) {
      payload.cropKey = cropKey
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

  const uploadCroppedPhoto = async (
    currentCardId: string,
    imageUrl: string,
    currentEditToken: string
  ) => {
    if (!normalizedCrop) return null

    setUploadProgress({ kind: 'crop', percent: 0 })
    try {
      const cropBlob = await renderCropBlob({ imageUrl, crop: normalizedCrop })
      const presign = await requestPresignFor(currentCardId, cropBlob, 'crop', currentEditToken)
      await uploadToS3(presign, cropBlob, (percent) =>
        setUploadProgress({ kind: 'crop', percent })
      )
      setUploadedCropKey(presign.key)
      return presign.key
    } catch {
      throw new Error('Crop upload failed. Please try again.')
    } finally {
      setUploadProgress(null)
    }
  }

  const hasPhoto = Boolean(photo || uploadedPhoto)

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
      | 'jerseyNumber',
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

    return errors
  }, [
    form.caption,
    form.cardType,
    form.firstName,
    form.jerseyNumber,
    form.lastName,
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
        photoPayload = buildPhotoPayload(uploaded, normalizedCrop, uploadedCropKey)
      } else if (uploadedPhoto) {
        // Photo already uploaded, just update crop
        photoPayload = buildPhotoPayload(uploadedPhoto, normalizedCrop, uploadedCropKey)
      } else if (normalizedCrop) {
        // Just crop, no photo
        photoPayload = buildPhotoPayload(null, normalizedCrop, uploadedCropKey)
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

      const uploadedUrl = uploaded.publicUrl ? media(uploaded.publicUrl) : null
      const imageUrl = photo?.localUrl ?? uploadedUrl
      if (!imageUrl) {
        throw new Error('Photo source is unavailable. Please re-upload your photo.')
      }
      const cropKey = uploadedCropKey ?? (await uploadCroppedPhoto(currentCardId, imageUrl, currentEditToken))

      const photoPayload = buildPhotoPayload(uploaded, normalizedCrop, cropKey)
      if (photoPayload) {
        payload.photo = photoPayload
      }

      await updateCard(currentCardId, buildUpdatePayload(payload), currentEditToken)

      // Step 1: Render the card
      setSubmitStatus('rendering')
      let blob: Blob
      try {
        const now = new Date().toISOString()
        const cardForRender = buildCardForRender(now)
        if (!cardForRender) {
          throw new Error('Card type and tournament are required')
        }
        cardForRender.id = currentCardId

        blob = await renderCard({
          card: cardForRender,
          config: tournamentConfig,
          imageUrl,
          resolveAssetUrl: assetUrlForKey,
          templateId: form.templateId,
        })
      } catch {
        throw new Error('Failed to render the card. Please try again.')
      }

      // Step 2: Upload rendered PNG
      setSubmitStatus('uploading')
      const presign = await requestPresignFor(currentCardId, blob, 'render', currentEditToken)
      setUploadProgress({ kind: 'render', percent: 0 })
      try {
        await uploadToS3(presign, blob, (percent) =>
          setUploadProgress({ kind: 'render', percent })
        )
      } catch {
        throw new Error('Render upload failed. Please try again.')
      } finally {
        setUploadProgress(null)
      }

      // Step 3: Submit the card
      setSubmitStatus('submitting')
      const submitted = await submitCard(currentCardId, presign.key, currentEditToken)

      // Store the rendered card URL for display
      setRenderedCardUrl(assetUrlForKey(presign.key))
      setSubmitStatus('done')

      return submitted
    },
    onSuccess: (data) => {
      setSavedCard(data)
      if (data.editToken) setEditToken(data.editToken)
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

  const inputClass = (hasError: boolean) =>
    `mt-2 w-full rounded-xl border ${
      hasError ? 'border-rose-500/60' : 'border-white/10'
    } bg-slate-950/60 px-3 py-2 text-sm text-white`

  const statusIndicator = useMemo(() => {
    const errorMessage = error ?? (helloQuery.error instanceof Error ? helloQuery.error.message : null)
    if (errorMessage) return { message: errorMessage, tone: 'error' as const }

    if (submitStatus === 'rendering') return { message: 'Rendering card...', tone: 'warning' as const }
    if (submitStatus === 'uploading') return { message: 'Uploading render...', tone: 'warning' as const }
    if (submitStatus === 'submitting') return { message: 'Submitting card...', tone: 'warning' as const }
    if (submitStatus === 'done') return { message: 'Card submitted!', tone: 'success' as const }

    if (saveMutation.isPending) {
      if (uploadStatus === 'uploading') return { message: 'Uploading photo...', tone: 'warning' as const }
      return { message: 'Saving draft...', tone: 'warning' as const }
    }

    if (saveMutation.isSuccess) return { message: 'Draft saved', tone: 'success' as const }
    if (hasEdited && Object.keys(validationErrors).length > 0) {
      return { message: 'Complete required fields to submit.', tone: 'error' as const }
    }

    return { message: 'Draft not saved yet', tone: 'neutral' as const }
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

  const statusToneClass = {
    neutral: 'text-slate-400',
    warning: 'text-amber-400',
    success: 'text-emerald-400',
    error: 'text-rose-300',
  }[statusIndicator.tone]

  const saveButtonLabel = saveMutation.isPending
    ? uploadStatus === 'uploading'
      ? 'Uploading...'
      : 'Saving...'
    : 'Save Draft'

  const submitButtonLabel = submitMutation.isPending
    ? submitStatus === 'rendering'
      ? 'Rendering...'
      : submitStatus === 'uploading'
        ? 'Uploading...'
        : submitStatus === 'submitting'
          ? 'Submitting...'
          : 'Submitting...'
    : 'Submit Card'

  const isRenderInProgress =
    submitStatus === 'rendering' || submitStatus === 'uploading' || submitStatus === 'submitting'

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
      setUploadedCropKey(null)

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
    setUploadedCropKey(null)
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
      templateId: prev.templateId || 'classic',
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
        const blob = await renderCard({
          card,
          config: tournamentConfig,
          imageUrl: cropperImageUrl,
          resolveAssetUrl: assetUrlForKey,
          templateId: form.templateId,
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

  return (
    <div className="app-shell min-h-screen">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-12">
        <header className="flex flex-col gap-4">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
            Trading Card Studio
          </p>
          <div className="space-y-2">
            <h1 className="font-display text-4xl text-white md:text-5xl">
              Build and submit your trading card
            </h1>
            <p className="max-w-2xl text-base text-slate-300">
              Upload a photo, drag to frame the shot, and submit when it looks right.
              We save a draft automatically as part of submission.
            </p>
          </div>
        </header>

        {!form.tournamentId ? (
          <section className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-white">Select a tournament</h2>
                <p className="text-sm text-slate-400">
                  Choose a tournament to load teams, positions, and branding.
                </p>
              </div>
              <span className="text-xs text-slate-400">
                {tournamentsQuery.isFetching ? 'Loading…' : `${tournamentsQuery.data.length} available`}
              </span>
            </div>
            <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end">
              <label className="flex-1 text-xs uppercase tracking-wide text-slate-400">
                Tournament
                <select
                  value={selectedTournamentId}
                  onChange={(event) => setSelectedTournamentId(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
                >
                  <option value="">Select tournament</option>
                  {tournamentsQuery.data.map((tournament) => (
                    <option key={tournament.id} value={tournament.id}>
                      {tournament.name} {tournament.year}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={handleTournamentContinue}
                disabled={!selectedTournamentId}
                className="rounded-full bg-emerald-500 px-6 py-2 text-xs font-semibold text-white transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Continue →
              </button>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Admins can publish new tournaments from the admin panel.
            </p>
          </section>
        ) : (
          <div className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr]">
            <section className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">Card Details</h2>
                  <p className="text-sm text-slate-400">
                    Draft ID: {cardId ?? 'Auto-created on submit'}
                  </p>
                  <p className="text-xs text-slate-500">Fields marked * are required.</p>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-400">
                  <button
                    type="button"
                    onClick={() => helloQuery.refetch()}
                    className="rounded-full border border-white/15 px-3 py-1 text-xs text-white transition hover:border-white/40"
                  >
                    Ping API
                  </button>
                  <span>{helloQuery.data ? 'Connected' : 'Idle'}</span>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-xs text-slate-300">
                <div>
                  <span className="uppercase tracking-[0.2em] text-slate-500">Tournament</span>
                  <div className="mt-1 text-sm text-white">
                    {tournamentConfig?.name ?? form.tournamentId}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleTournamentReset}
                  className="rounded-full border border-white/20 px-3 py-1 text-[11px] text-white transition hover:border-white/40"
                >
                  Change
                </button>
              </div>
              {!tournamentConfig ? (
                <p className="mt-2 text-xs text-rose-300">
                  Tournament config failed to load. Refresh or reselect the tournament.
                </p>
              ) : null}

              <form
                className="mt-6 grid gap-4 sm:grid-cols-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  setHasEdited(true)
                  if (canSubmit) submitMutation.mutate()
                }}
              >
                <label className="text-xs uppercase tracking-wide text-slate-400">
                  Card Type <span className="text-rose-400">*</span>
                  <select
                    value={form.cardType}
                    onChange={handleCardTypeChange}
                    disabled={!tournamentConfig}
                    className={inputClass(hasEdited && Boolean(validationErrors.cardType))}
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
                  {hasEdited && validationErrors.cardType ? (
                    <span className="mt-1 block text-[11px] text-rose-300">
                      {validationErrors.cardType}
                    </span>
                  ) : null}
                </label>

                <label className="text-xs uppercase tracking-wide text-slate-400">
                  Card Style
                  <select
                    value={form.templateId}
                    onChange={handleFieldChange('templateId')}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
                  >
                    <option value="classic">Classic</option>
                    <option value="noir">Noir</option>
                  </select>
                </label>

                {form.cardType === 'rare' ? (
                  <>
                    <label className="text-xs uppercase tracking-wide text-slate-400 sm:col-span-2">
                      Title <span className="text-rose-400">*</span>
                      <input
                        value={form.title}
                        onChange={handleFieldChange('title')}
                        maxLength={MAX_TITLE_LENGTH}
                        className={inputClass(hasEdited && Boolean(validationErrors.title))}
                        placeholder="Championship MVP"
                      />
                      {hasEdited && validationErrors.title ? (
                        <span className="mt-1 block text-[11px] text-rose-300">
                          {validationErrors.title}
                        </span>
                      ) : null}
                    </label>
                    <label className="text-xs uppercase tracking-wide text-slate-400 sm:col-span-2">
                      Caption
                      <textarea
                        value={form.caption}
                        onChange={handleFieldChange('caption')}
                        maxLength={MAX_CAPTION_LENGTH}
                        rows={2}
                        className={inputClass(hasEdited && Boolean(validationErrors.caption))}
                        placeholder="Awarded to the tournament MVP"
                      />
                      {hasEdited && validationErrors.caption ? (
                        <span className="mt-1 block text-[11px] text-rose-300">
                          {validationErrors.caption}
                        </span>
                      ) : null}
                    </label>
                  </>
                ) : (
                  <>
                    {cardTypeConfig?.showTeamField ? (
                      <label className="text-xs uppercase tracking-wide text-slate-400">
                        Team <span className="text-rose-400">*</span>
                        <select
                          value={form.teamId}
                          onChange={handleFieldChange('teamId')}
                          className={inputClass(hasEdited && Boolean(validationErrors.teamId))}
                        >
                          <option value="">Select team</option>
                          {tournamentConfig?.teams.map((team) => (
                            <option key={team.id} value={team.id}>
                              {team.name}
                            </option>
                          ))}
                        </select>
                        {hasEdited && validationErrors.teamId ? (
                          <span className="mt-1 block text-[11px] text-rose-300">
                            {validationErrors.teamId}
                          </span>
                        ) : null}
                        {selectedTeam?.logoKey ? (
                          <img
                            src={assetUrlForKey(selectedTeam.logoKey)}
                            alt={`${selectedTeam.name} logo`}
                            className="mt-2 h-10 w-10 rounded-lg border border-white/10 object-contain"
                          />
                        ) : null}
                      </label>
                    ) : null}

                    <label className="text-xs uppercase tracking-wide text-slate-400">
                      Position <span className="text-rose-400">*</span>
                      {cardTypeConfig?.positions && cardTypeConfig.positions.length > 0 ? (
                        <select
                          value={form.position}
                          onChange={handleFieldChange('position')}
                          className={inputClass(hasEdited && Boolean(validationErrors.position))}
                        >
                          <option value="">Select position</option>
                          {cardTypeConfig.positions.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={form.position}
                          onChange={handleFieldChange('position')}
                          maxLength={MAX_POSITION_LENGTH}
                          className={inputClass(hasEdited && Boolean(validationErrors.position))}
                          placeholder="Keeper"
                        />
                      )}
                      {hasEdited && validationErrors.position ? (
                        <span className="mt-1 block text-[11px] text-rose-300">
                          {validationErrors.position}
                        </span>
                      ) : null}
                    </label>

                    {cardTypeConfig?.showJerseyNumber ? (
                      <label className="text-xs uppercase tracking-wide text-slate-400">
                        Jersey Number
                        <input
                          value={form.jerseyNumber}
                          onChange={handleFieldChange('jerseyNumber')}
                          maxLength={MAX_JERSEY_LENGTH}
                          inputMode="numeric"
                          pattern="\\d*"
                          className={inputClass(hasEdited && Boolean(validationErrors.jerseyNumber))}
                          placeholder="15"
                        />
                        {hasEdited && validationErrors.jerseyNumber ? (
                          <span className="mt-1 block text-[11px] text-rose-300">
                            {validationErrors.jerseyNumber}
                          </span>
                        ) : (
                          <span className="mt-1 block text-[11px] text-slate-500">
                            Numbers only, up to 2 digits.
                          </span>
                        )}
                      </label>
                    ) : null}

                    <label className="text-xs uppercase tracking-wide text-slate-400">
                      First Name <span className="text-rose-400">*</span>
                      <input
                        value={form.firstName}
                        onChange={handleFieldChange('firstName')}
                        maxLength={MAX_NAME_LENGTH}
                        className={inputClass(hasEdited && Boolean(validationErrors.firstName))}
                        placeholder="Brandon"
                      />
                      {hasEdited && validationErrors.firstName ? (
                        <span className="mt-1 block text-[11px] text-rose-300">
                          {validationErrors.firstName}
                        </span>
                      ) : null}
                    </label>

                    <label className="text-xs uppercase tracking-wide text-slate-400">
                      Last Name <span className="text-rose-400">*</span>
                      <input
                        value={form.lastName}
                        onChange={handleFieldChange('lastName')}
                        maxLength={MAX_NAME_LENGTH}
                        className={inputClass(hasEdited && Boolean(validationErrors.lastName))}
                        placeholder="Williams"
                      />
                      {hasEdited && validationErrors.lastName ? (
                        <span className="mt-1 block text-[11px] text-rose-300">
                          {validationErrors.lastName}
                        </span>
                      ) : null}
                    </label>
                  </>
                )}

                <label className="text-xs uppercase tracking-wide text-slate-400 sm:col-span-2">
                  Photo Credit
                  <input
                    value={form.photographer}
                    onChange={handleFieldChange('photographer')}
                    maxLength={MAX_PHOTOGRAPHER_LENGTH}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
                    placeholder="Paul Schiopu"
                  />
                </label>
              </form>

              <div className="mt-6">
                <label className="text-xs uppercase tracking-wide text-slate-400">
                  Card Photo <span className="text-rose-400">*</span>
                </label>
                <label
                  className={`mt-3 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-6 py-8 text-center text-sm text-slate-300 transition ${
                    isDragging ? 'border-emerald-400/70 bg-emerald-500/10' : 'border-white/15 bg-slate-950/40'
                  }`}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                >
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    onChange={handleFileChange}
                  />
                  <div className="flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-slate-400">
                    Drop photo here
                  </div>
                  <p className="text-xs text-slate-500">
                    or click to upload (JPG, PNG, WebP · max 15MB)
                  </p>
                  {photo ? (
                    <p className="text-xs text-emerald-300">
                      {photo.file.name} · {photo.width} x {photo.height} px
                    </p>
                  ) : (
                    <p className="text-xs text-slate-500">Auto-resized to {MAX_IMAGE_DIMENSION}px max</p>
                  )}
                </label>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                  <span>{photo ? photo.file.name : 'No file selected'}</span>
                  {uploadedPhoto && <span className="text-emerald-400">Uploaded</span>}
                </div>
                {photoError ? (
                  <p className="mt-2 text-xs text-rose-300">{photoError}</p>
                ) : hasEdited && validationErrors.photo ? (
                  <p className="mt-2 text-xs text-rose-300">{validationErrors.photo}</p>
                ) : null}
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={handleSaveDraft}
                  disabled={saveMutation.isPending}
                  className="rounded-full bg-white px-5 py-2 text-xs font-semibold text-slate-900 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {saveButtonLabel}
                </button>
                <button
                  type="button"
                  onClick={() => submitMutation.mutate()}
                  disabled={!canSubmit}
                  className="rounded-full bg-emerald-500 px-5 py-2 text-xs font-semibold text-white transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitButtonLabel}
                </button>
                <span className="text-xs text-slate-500">
                  Submit saves a draft automatically.
                </span>
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <span className={statusToneClass}>{statusIndicator.message}</span>
                  {uploadProgress ? (
                    <div className="flex items-center gap-2">
                      <div
                        className="h-1 w-24 overflow-hidden rounded-full bg-white/10"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={uploadProgress.percent}
                      >
                        <div
                          className="h-full rounded-full bg-emerald-400 transition-all"
                          style={{ width: `${uploadProgress.percent}%` }}
                        />
                      </div>
                      <span className="text-[11px] text-slate-400">
                        {uploadProgress.kind === 'original'
                          ? 'Photo'
                          : uploadProgress.kind === 'crop'
                            ? 'Crop'
                            : 'Render'}{' '}
                        {uploadProgress.percent}%
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
            </section>

            <section className="space-y-6">
              <div
                className={`rounded-3xl border border-emerald-500/30 bg-emerald-950/20 p-6 backdrop-blur ${
                  submitStatus === 'done' ? 'celebrate' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm uppercase tracking-[0.2em] text-emerald-400">
                    {renderedCardUrl ? 'Rendered Card' : 'Live Preview'}
                  </h3>
                  {previewUrl && !renderedCardUrl ? (
                    <span className="text-xs text-emerald-200/70">Updating preview</span>
                  ) : null}
                </div>
                {renderedCardUrl ? (
                  <>
                    <div className="mt-4">
                      <img
                        src={renderedCardUrl}
                        alt="Rendered trading card"
                        className="w-full rounded-2xl shadow-lg"
                      />
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <a
                        href={renderedCardUrl}
                        download="trading-card.png"
                        className="rounded-full border border-emerald-500/30 px-4 py-2 text-xs text-emerald-400 transition hover:border-emerald-500/60 hover:bg-emerald-500/10"
                      >
                        Download PNG
                      </a>
                      <span className="text-xs text-slate-400">
                        Status: {savedCard?.status ?? 'unknown'}
                      </span>
                    </div>
                  </>
                ) : previewUrl ? (
                  <div className="mt-4">
                    <img
                      src={previewUrl}
                      alt="Live preview trading card"
                      className="w-full rounded-2xl shadow-lg"
                    />
                    <p className="mt-2 text-xs text-slate-400">
                      Preview updates as you edit. Submit to generate the final PNG.
                    </p>
                  </div>
                ) : (
                  <div className="mt-4">
                    <div className="flex aspect-[825/1125] w-full items-center justify-center rounded-2xl border border-dashed border-emerald-500/30 bg-slate-950/50 text-xs text-emerald-200/70">
                      {isRenderInProgress ? (
                        <div className="flex flex-col items-center gap-3 text-emerald-200/70">
                          <div className="h-10 w-10 animate-spin rounded-full border border-emerald-400/40 border-t-transparent" />
                          <span className="text-[11px] uppercase tracking-[0.2em]">
                            Building render
                          </span>
                        </div>
                      ) : previewError ? (
                        previewError
                      ) : (
                        'Upload a photo and crop to see the live preview.'
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
                <div>
                  <h2 className="text-lg font-semibold text-white">Live Crop</h2>
                  <p className="text-sm text-slate-400">
                    Drag the image to frame it. Scroll or pinch to zoom.
                  </p>
                </div>

                <div className="mt-5">
                  <div className="relative aspect-[825/1125] w-full overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/60 shadow-[0_20px_60px_rgba(3,7,18,0.6)]">
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
                      <div className="flex h-full w-full items-center justify-center text-sm text-slate-400">
                        Upload a photo to start cropping
                      </div>
                    )}
                  </div>
                  {hasEdited && validationErrors.crop ? (
                    <p className="mt-2 text-xs text-rose-300">{validationErrors.crop}</p>
                  ) : null}
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => handleZoom(0.2)}
                    className="rounded-full border border-white/15 px-3 py-1 text-xs text-white transition hover:border-white/40"
                  >
                    Zoom In
                  </button>
                  <button
                    type="button"
                    onClick={() => handleZoom(-0.2)}
                    className="rounded-full border border-white/15 px-3 py-1 text-xs text-white transition hover:border-white/40"
                  >
                    Zoom Out
                  </button>
                  <button
                    type="button"
                    onClick={handleResetCrop}
                    className="rounded-full border border-white/15 px-3 py-1 text-xs text-white transition hover:border-white/40"
                  >
                    Reset
                  </button>
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
                <h3 className="text-sm uppercase tracking-[0.2em] text-slate-400">
                  Preview Meta
                </h3>
                <div className="mt-4 space-y-3">
                  <div className="font-display text-2xl text-white">{displayName}</div>
                  <div className="text-sm text-slate-300">
                    {form.cardType === 'rare'
                      ? form.caption || 'Caption'
                      : [form.position || 'Position', selectedTeam?.name || (cardTypeConfig?.showTeamField ? 'Team' : '')]
                          .filter(Boolean)
                          .join(' / ')}
                  </div>
                  <div className="text-xs text-slate-400">
                    Crop: {normalizedCrop ? `${normalizedCrop.w.toFixed(2)} x ${normalizedCrop.h.toFixed(2)}` : '-'}
                  </div>
                  {uploadedPhoto && (
                    <div className="text-xs text-slate-400">
                      Photo: <span className="text-emerald-400">{uploadedPhoto.key}</span>
                    </div>
                  )}
                  {savedCard ? (
                    <div className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-xs text-slate-300">
                      Saved as <span className="text-white">{savedCard.id}</span>
                    </div>
                  ) : null}
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
