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

async function uploadToS3(presign: PresignResponse, data: Blob): Promise<void> {
  if (presign.method === 'POST') {
    if (!presign.fields) {
      throw new Error('Upload fields are missing')
    }

    const formData = new FormData()
    for (const [key, value] of Object.entries(presign.fields)) {
      formData.append(key, value)
    }
    formData.append('file', toUploadFile(data, presign.key))

    const res = await fetch(presign.uploadUrl, {
      method: 'POST',
      body: formData,
    })

    if (!res.ok) {
      throw new Error('Upload failed')
    }

    return
  }

  const res = await fetch(presign.uploadUrl, {
    method: presign.method,
    headers: presign.headers,
    body: data,
  })

  if (!res.ok) {
    throw new Error('Upload failed')
  }
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
    type: form.cardType || undefined,
    teamName: form.team || undefined,
    position: form.position || undefined,
    jerseyNumber: form.jerseyNumber || undefined,
    firstName: form.firstName || undefined,
    lastName: form.lastName || undefined,
    photographer: form.photographer || undefined,
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

    try {
      const presign = await requestPresignFor(currentCardId, photo.file, 'original')
      await uploadToS3(presign, photo.file)

      const uploaded: UploadedPhoto = {
        key: presign.key,
        publicUrl: presign.publicUrl,
        width: photo.width,
        height: photo.height,
      }

      setUploadedPhoto(uploaded)
      setUploadStatus('uploaded')
      return uploaded
    } catch (err) {
      setUploadStatus('error')
      throw err
    }
  }

  const hasPhoto = Boolean(photo || uploadedPhoto)

  const getValidationErrors = useCallback(() => {
    const errors: Partial<Record<'firstName' | 'lastName' | 'team' | 'position' | 'photo' | 'crop', string>> = {}

    if (!form.firstName.trim()) errors.firstName = 'First name is required'
    if (!form.lastName.trim()) errors.lastName = 'Last name is required'
    if (!form.team.trim()) errors.team = 'Team is required'
    if (!form.position.trim()) errors.position = 'Position is required'
    if (!hasPhoto) errors.photo = 'Photo is required'
    if (!normalizedCrop) errors.crop = 'Crop is required'

    return errors
  }, [form.firstName, form.lastName, form.position, form.team, hasPhoto, normalizedCrop])

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
      const blob = await renderCard({
        imageUrl,
        crop: normalizedCrop,
        firstName: form.firstName,
        lastName: form.lastName,
        position: form.position,
        team: form.team,
        jerseyNumber: form.jerseyNumber,
        photographer: form.photographer,
      })

      // Step 2: Upload rendered PNG
      setSubmitStatus('uploading')
      const presign = await requestPresignFor(currentCardId, blob, 'render')
      await uploadToS3(presign, blob)

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

  const statusMessage = useMemo(() => {
    if (saveMutation.isPending) {
      if (uploadStatus === 'uploading') return 'Uploading photo...'
      return 'Saving draft...'
    }
    if (saveMutation.isSuccess) return 'Draft saved'
    return 'Draft not saved yet'
  }, [saveMutation.isPending, saveMutation.isSuccess, uploadStatus])

  const errorMessage = useMemo(() => {
    const err = error ?? (helloQuery.error instanceof Error ? helloQuery.error.message : null)
    return err
  }, [error, helloQuery.error])

  const handleFieldChange = (key: keyof FormState) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setHasEdited(true)
      setForm((prev) => ({ ...prev, [key]: event.target.value }))
    }

  const handleFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setHasEdited(true)

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
    const full = `${form.firstName} ${form.lastName}`.trim()
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
                  className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
                  placeholder="15"
                />
              </label>
              <label className="text-xs uppercase tracking-wide text-slate-400">
                First Name <span className="text-rose-400">*</span>
                <input
                  value={form.firstName}
                  onChange={handleFieldChange('firstName')}
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
                Save Draft
              </button>
              <button
                type="button"
                onClick={() => submitMutation.mutate()}
                disabled={!canSubmit}
                className="rounded-full bg-emerald-500 px-5 py-2 text-xs font-semibold text-white transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitMutation.isPending ? 'Submitting...' : 'Submit Card'}
              </button>
              <span className="text-xs text-slate-500">
                Submit saves a draft automatically.
              </span>
              <span className="text-xs text-slate-400">{statusMessage}</span>
              {submitStatus !== 'idle' && submitStatus !== 'done' && submitStatus !== 'error' && (
                <span className="text-xs text-amber-400">
                  {submitStatus === 'rendering' && 'Rendering card...'}
                  {submitStatus === 'uploading' && 'Uploading render...'}
                  {submitStatus === 'submitting' && 'Submitting...'}
                </span>
              )}
              {!submitMutation.isPending && hasEdited && Object.keys(validationErrors).length > 0 && (
                <span className="text-xs text-rose-300">
                  Complete required fields to submit.
                </span>
              )}
              {submitStatus === 'done' && (
                <span className="text-xs text-emerald-400">Card submitted!</span>
              )}
              {errorMessage ? (
                <span className="text-xs text-rose-300">{errorMessage}</span>
              ) : null}
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
                Submit your card to generate the final render.
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
