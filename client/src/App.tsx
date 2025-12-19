import { useCallback, useMemo, useState, type ChangeEvent } from 'react'
import Cropper, { type Area, type MediaSize, type Point } from 'react-easy-crop'
import { useMutation, useQuery } from '@tanstack/react-query'
import { CARD_ASPECT, type ApiResponse, type CardDesign, type CropRect } from 'shared'
import { renderCard } from './renderCard'

// In dev mode, use the Lambda URL directly. In production, use relative URLs (Router handles routing).
const API_BASE =
  import.meta.env.DEV && import.meta.env.VITE_API_URL
    ? import.meta.env.VITE_API_URL.replace(/\/$/, '') // Remove trailing slash
    : '/api'

// For media URLs (/u/*, /r/*), use Router URL in dev, relative in production
const MEDIA_BASE =
  import.meta.env.DEV && import.meta.env.VITE_ROUTER_URL
    ? import.meta.env.VITE_ROUTER_URL.replace(/\/$/, '')
    : ''

const api = (path: string) => `${API_BASE}${path}`
const media = (path: string) => `${MEDIA_BASE}${path}`

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024
const ALLOWED_UPLOAD_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_NAME_LENGTH = 24
const MAX_JERSEY_LENGTH = 3
const JERSEY_PATTERN = /^\d{1,3}$/
const MAX_UPLOAD_RETRIES = 1

type FormState = {
  cardType: string
  team: string
  position: string
  jerseyNumber: string
  firstName: string
  lastName: string
  photographer: string
}

type PhotoState = {
  file: File
  localUrl: string
  width: number
  height: number
}

type UploadedPhoto = {
  key: string
  publicUrl: string
  width: number
  height: number
}

type SavePayload = {
  type?: string
  teamName?: string
  position?: string
  jerseyNumber?: string
  firstName?: string
  lastName?: string
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
  publicUrl: string
  method: 'POST' | 'PUT'
  headers?: Record<string, string>
  fields?: Record<string, string>
}

type UploadProgress = {
  kind: 'original' | 'render'
  percent: number
}

const initialForm: FormState = {
  cardType: '',
  team: '',
  position: '',
  jerseyNumber: '',
  firstName: '',
  lastName: '',
  photographer: '',
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

async function createCard(payload: SavePayload): Promise<CardDesign> {
  const res = await fetch(api('/cards'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    throw new Error('Could not create card')
  }

  return res.json()
}

async function updateCard(id: string, payload: SavePayload): Promise<CardDesign> {
  const res = await fetch(api(`/cards/${id}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
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
  kind: 'original' | 'crop' | 'render'
): Promise<PresignResponse> {
  const res = await fetch(api('/uploads/presign'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

async function submitCard(id: string, renderKey: string): Promise<CardDesign> {
  const res = await fetch(api(`/cards/${id}/submit`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ renderKey }),
  })

  if (!res.ok) {
    throw new Error('Could not submit card')
  }

  return res.json()
}

function loadImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()

    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image'))
    }

    img.src = url
  })
}

function App() {
  const [form, setForm] = useState<FormState>(initialForm)
  const [photo, setPhoto] = useState<PhotoState | null>(null)
  const [uploadedPhoto, setUploadedPhoto] = useState<UploadedPhoto | null>(null)
  const [mediaSize, setMediaSize] = useState<MediaSize | null>(null)
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState<Rotation>(0)
  const [normalizedCrop, setNormalizedCrop] = useState<CropRect | null>(null)
  const [cardId, setCardId] = useState<string | null>(null)
  const [savedCard, setSavedCard] = useState<CardDesign | null>(null)
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'uploaded' | 'error'>('idle')
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [renderedCardUrl, setRenderedCardUrl] = useState<string | null>(null)
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'rendering' | 'uploading' | 'submitting' | 'done' | 'error'>('idle')
  const [hasEdited, setHasEdited] = useState(false)

  const helloQuery = useQuery({
    queryKey: ['hello'],
    queryFn: fetchHello,
    enabled: false,
  })

  const buildPayload = (): SavePayload => ({
    type: toOptional(form.cardType),
    teamName: toOptional(form.team),
    position: toOptional(form.position),
    jerseyNumber: toOptional(form.jerseyNumber),
    firstName: toOptional(form.firstName),
    lastName: toOptional(form.lastName),
    photographer: toOptional(form.photographer),
  })

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

  const ensureCardId = async (payload: SavePayload) => {
    if (cardId) return cardId

    const card = await createCard(payload)
    setCardId(card.id)
    setSavedCard(card)
    return card.id
  }

  const uploadOriginalPhoto = async (currentCardId: string) => {
    if (!photo) {
      throw new Error('Please upload a photo before submitting')
    }

    setUploadStatus('uploading')
    setUploadProgress({ kind: 'original', percent: 0 })

    try {
      const presign = await requestPresignFor(currentCardId, photo.file, 'original')
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

  const getValidationErrors = useCallback(() => {
    const errors: Partial<Record<'firstName' | 'lastName' | 'team' | 'position' | 'photo' | 'crop' | 'jerseyNumber', string>> = {}

    const firstName = form.firstName.trim()
    const lastName = form.lastName.trim()
    const team = form.team.trim()
    const position = form.position.trim()
    const jerseyNumber = form.jerseyNumber.trim()

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

    if (!team) errors.team = 'Team is required'
    if (!position) errors.position = 'Position is required'

    if (jerseyNumber && !JERSEY_PATTERN.test(jerseyNumber)) {
      errors.jerseyNumber = 'Jersey number must be 1-3 digits'
    }

    if (!hasPhoto) errors.photo = 'Photo is required'
    if (!normalizedCrop) errors.crop = 'Crop is required'

    return errors
  }, [form.firstName, form.lastName, form.position, form.team, form.jerseyNumber, hasPhoto, normalizedCrop])

  const saveMutation = useMutation({
    mutationFn: async () => {
      setError(null)

      const payload = buildPayload()

      // Step 1: Create or get card ID
      const currentCardId = await ensureCardId(payload)

      // Step 2: Upload photo if we have a new one that hasn't been uploaded
      let photoPayload: SavePayload['photo'] = undefined

      if (photo && !uploadedPhoto) {
        const uploaded = await uploadOriginalPhoto(currentCardId)
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
      const updatedCard = await updateCard(currentCardId, payload)
      return updatedCard
    },
    onSuccess: (data) => {
      setSavedCard(data)
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

      const payload = buildPayload()
      const currentCardId = await ensureCardId(payload)
      const uploaded = uploadedPhoto ?? (photo ? await uploadOriginalPhoto(currentCardId) : null)

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

      await updateCard(currentCardId, payload)

      // Step 1: Render the card
      setSubmitStatus('rendering')
      const imageUrl = photo?.localUrl ?? media(uploaded.publicUrl)
      let blob: Blob
      try {
        blob = await renderCard({
          imageUrl,
          crop: normalizedCrop,
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          position: form.position.trim(),
          team: form.team.trim(),
          jerseyNumber: form.jerseyNumber.trim(),
          photographer: form.photographer.trim(),
        })
      } catch {
        throw new Error('Failed to render the card. Please try again.')
      }

      // Step 2: Upload rendered PNG
      setSubmitStatus('uploading')
      const presign = await requestPresignFor(currentCardId, blob, 'render')
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
      const submitted = await submitCard(currentCardId, presign.key)

      // Store the rendered card URL for display
      setRenderedCardUrl(media(presign.publicUrl))
      setSubmitStatus('done')

      return submitted
    },
    onSuccess: (data) => {
      setSavedCard(data)
    },
    onError: (err) => {
      setSubmitStatus('error')
      setError(err instanceof Error ? err.message : 'Submission failed')
    },
  })

  const validationErrors = useMemo(() => getValidationErrors(), [getValidationErrors])
  const canSubmit =
    !submitMutation.isPending && !photoError && Object.keys(validationErrors).length === 0

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
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setHasEdited(true)
      setError(null)
      setForm((prev) => ({ ...prev, [key]: event.target.value }))
    }

  const handleFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setHasEdited(true)
    setError(null)

    if (!ALLOWED_UPLOAD_TYPES.has(file.type)) {
      setPhotoError('Unsupported file type. Use JPG, PNG, or WebP.')
      event.target.value = ''
      return
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      setPhotoError('File is too large. Max size is 15MB.')
      event.target.value = ''
      return
    }

    setPhotoError(null)

    try {
      const dimensions = await loadImageDimensions(file)
      const localUrl = URL.createObjectURL(file)

      setPhoto((prev) => {
        if (prev) URL.revokeObjectURL(prev.localUrl)
        return {
          file,
          localUrl,
          width: dimensions.width,
          height: dimensions.height,
        }
      })

      // Reset upload state when new photo is selected
      setUploadedPhoto(null)
      setUploadStatus('idle')
      setUploadProgress(null)
      setRenderedCardUrl(null)
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

  const handleSaveDraft = () => {
    setHasEdited(true)
    saveMutation.mutate()
  }

  const displayName = useMemo(() => {
    const first = form.firstName.trim()
    const last = form.lastName.trim()
    const full = [first, last].filter(Boolean).join(' ')
    return full.length > 0 ? full : 'Player Name'
  }, [form.firstName, form.lastName])

  // Use S3 URL if uploaded, otherwise local blob URL
  const cropperImageUrl = photo?.localUrl ?? (uploadedPhoto ? media(uploadedPhoto.publicUrl) : null)

  return (
    <div className="app-shell min-h-screen">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-12">
        <header className="flex flex-col gap-4">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
            Trading Card Studio
          </p>
          <div className="space-y-2">
            <h1 className="font-display text-4xl text-white md:text-5xl">
              Build your card from a single crop
            </h1>
            <p className="max-w-2xl text-base text-slate-300">
              Upload a photo, drag to frame the shot, and submit when it looks right.
              We save a draft automatically as part of submission.
            </p>
          </div>
        </header>

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
                <span>
                  {helloQuery.data ? 'Connected' : 'Idle'}
                </span>
              </div>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="text-xs uppercase tracking-wide text-slate-400">
                Card Type
                <select
                  value={form.cardType}
                  onChange={handleFieldChange('cardType')}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
                >
                  <option value="">Select type</option>
                  <option value="player">Player</option>
                  <option value="staff">Staff</option>
                  <option value="media">Media</option>
                  <option value="official">Official</option>
                </select>
              </label>
              <label className="text-xs uppercase tracking-wide text-slate-400">
                Team <span className="text-rose-400">*</span>
                <input
                  value={form.team}
                  onChange={handleFieldChange('team')}
                  className={inputClass(hasEdited && Boolean(validationErrors.team))}
                  placeholder="Bay Area Breakers"
                />
                {hasEdited && validationErrors.team ? (
                  <span className="mt-1 block text-[11px] text-rose-300">
                    {validationErrors.team}
                  </span>
                ) : null}
              </label>
              <label className="text-xs uppercase tracking-wide text-slate-400">
                Position <span className="text-rose-400">*</span>
                <input
                  value={form.position}
                  onChange={handleFieldChange('position')}
                  className={inputClass(hasEdited && Boolean(validationErrors.position))}
                  placeholder="Keeper"
                />
                {hasEdited && validationErrors.position ? (
                  <span className="mt-1 block text-[11px] text-rose-300">
                    {validationErrors.position}
                  </span>
                ) : null}
              </label>
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
                    Numbers only, up to 3 digits.
                  </span>
                )}
              </label>
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
              <label className="text-xs uppercase tracking-wide text-slate-400 sm:col-span-2">
                Photo Credit
                <input
                  value={form.photographer}
                  onChange={handleFieldChange('photographer')}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
                  placeholder="Paul Schiopu"
                />
              </label>
            </div>

            <div className="mt-6">
              <label className="text-xs uppercase tracking-wide text-slate-400">
                Player Photo <span className="text-rose-400">*</span>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <label className="flex cursor-pointer items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-xs text-white transition hover:border-white/40">
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      onChange={handleFileChange}
                    />
                    Upload
                  </label>
                  <span className="text-xs text-slate-400">
                    {photo ? photo.file.name : 'No file selected'}
                  </span>
                  {uploadedPhoto && (
                    <span className="text-xs text-emerald-400">Uploaded</span>
                  )}
                </div>
                {photo && (
                  <p className="mt-1 text-xs text-slate-500">
                    {photo.width} x {photo.height} px
                  </p>
                )}
                {photoError ? (
                  <p className="mt-1 text-xs text-rose-300">{photoError}</p>
                ) : hasEdited && validationErrors.photo ? (
                  <p className="mt-1 text-xs text-rose-300">{validationErrors.photo}</p>
                ) : null}
              </label>
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
                      {uploadProgress.kind === 'original' ? 'Photo' : 'Render'} {uploadProgress.percent}%
                    </span>
                  </div>
                ) : null}
              </div>
        </div>
      </section>

      <section className="space-y-6">
        <div className="rounded-3xl border border-emerald-500/30 bg-emerald-950/20 p-6 backdrop-blur">
          <h3 className="text-sm uppercase tracking-[0.2em] text-emerald-400">
            Rendered Card
          </h3>
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
                ) : (
                  'Submit your card to generate the final render.'
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
                {/* Aspect ratio matches CARD_ASPECT (825:1125) */}
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
                {/* Rotation disabled for v1 - math needs fixing for 90°/270° */}
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
                <div className="font-display text-2xl text-white">
                  {displayName}
                </div>
                <div className="text-sm text-slate-300">
                  {form.position || 'Position'} / {form.team || 'Team'}
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
      </div>
    </div>
  )
}

export default App
