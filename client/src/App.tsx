import { useMemo, useState, type ChangeEvent } from 'react'
import Cropper, { type Area, type Point } from 'react-easy-crop'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { ApiResponse, CardDesign, CropRect } from 'shared'

type FormState = {
  cardType: string
  team: string
  position: string
  jerseyNumber: string
  firstName: string
  lastName: string
  photographer: string
}

type SavePayload = {
  type?: string
  teamId?: string
  position?: string
  jerseyNumber?: string
  firstName?: string
  lastName?: string
  photographer?: string
  photo?: {
    crop?: CropRect
  }
}

type Rotation = CropRect['rotateDeg']

type SaveDraftInput = {
  id?: string
  payload: SavePayload
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

const rotationSteps: Rotation[] = [0, 90, 180, 270]

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

async function fetchHello(): Promise<ApiResponse> {
  const res = await fetch('/api/hello')
  if (!res.ok) {
    throw new Error('API request failed')
  }
  return res.json()
}

async function saveDraft(input: SaveDraftInput): Promise<CardDesign> {
  const { id, payload } = input
  const endpoint = id ? `/api/cards/${id}` : '/api/cards'
  const method = id ? 'PATCH' : 'POST'

  const res = await fetch(endpoint, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    throw new Error('Could not save draft')
  }

  return res.json()
}

function App() {
  const [form, setForm] = useState<FormState>(initialForm)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [photoName, setPhotoName] = useState<string | null>(null)
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState<Rotation>(0)
  const [normalizedCrop, setNormalizedCrop] = useState<CropRect | null>(null)
  const [cardId, setCardId] = useState<string | null>(null)
  const [savedCard, setSavedCard] = useState<CardDesign | null>(null)

  const helloQuery = useQuery({
    queryKey: ['hello'],
    queryFn: fetchHello,
    enabled: false,
  })

  const saveMutation = useMutation({
    mutationFn: saveDraft,
    onSuccess: (data) => {
      setCardId(data.id)
      setSavedCard(data)
    },
  })

  const statusMessage = useMemo(() => {
    if (saveMutation.isPending) return 'Saving draft...'
    if (saveMutation.isSuccess) return 'Draft saved'
    return 'Not saved'
  }, [saveMutation.isPending, saveMutation.isSuccess])

  const errorMessage = useMemo(() => {
    const error = saveMutation.error ?? helloQuery.error
    if (!error) return null
    return error instanceof Error ? error.message : 'Something went wrong'
  }, [saveMutation.error, helloQuery.error])

  const handleFieldChange = (key: keyof FormState) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setForm((prev) => ({ ...prev, [key]: event.target.value }))
    }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const nextUrl = URL.createObjectURL(file)

    setPhotoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return nextUrl
    })

    setPhotoName(file.name)
  }

  const handleCropComplete = (area: Area) => {
    setNormalizedCrop({
      x: Number((area.x / 100).toFixed(4)),
      y: Number((area.y / 100).toFixed(4)),
      w: Number((area.width / 100).toFixed(4)),
      h: Number((area.height / 100).toFixed(4)),
      rotateDeg: rotation,
    })
  }

  const handleRotate = () => {
    setRotation((prev) => {
      const nextIndex = (rotationSteps.indexOf(prev) + 1) % rotationSteps.length
      return rotationSteps[nextIndex]
    })
  }

  const handleZoom = (delta: number) => {
    setZoom((prev) => clamp(Number((prev + delta).toFixed(2)), 1, 3))
  }

  const handleResetCrop = () => {
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setRotation(0)
  }

  const buildPayload = (): SavePayload => ({
    type: form.cardType || undefined,
    teamId: form.team || undefined,
    position: form.position || undefined,
    jerseyNumber: form.jerseyNumber || undefined,
    firstName: form.firstName || undefined,
    lastName: form.lastName || undefined,
    photographer: form.photographer || undefined,
    photo: normalizedCrop ? { crop: normalizedCrop } : undefined,
  })

  const handleSaveDraft = () => {
    saveMutation.mutate({ id: cardId ?? undefined, payload: buildPayload() })
  }

  const displayName = useMemo(() => {
    const full = `${form.firstName} ${form.lastName}`.trim()
    return full.length > 0 ? full : 'Player Name'
  }, [form.firstName, form.lastName])

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
              Upload a photo, drag to frame the shot, and save a draft. This is the
              starting point for the full render pipeline.
            </p>
          </div>
        </header>

        <div className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-white">Card Details</h2>
                <p className="text-sm text-slate-400">
                  Draft ID: {cardId ?? 'Not created'}
                </p>
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
                Team
                <input
                  value={form.team}
                  onChange={handleFieldChange('team')}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
                  placeholder="Bay Area Breakers"
                />
              </label>
              <label className="text-xs uppercase tracking-wide text-slate-400">
                Position
                <input
                  value={form.position}
                  onChange={handleFieldChange('position')}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
                  placeholder="Keeper"
                />
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
                First Name
                <input
                  value={form.firstName}
                  onChange={handleFieldChange('firstName')}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
                  placeholder="Brandon"
                />
              </label>
              <label className="text-xs uppercase tracking-wide text-slate-400">
                Last Name
                <input
                  value={form.lastName}
                  onChange={handleFieldChange('lastName')}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
                  placeholder="Williams"
                />
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
                Player Photo
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <label className="flex cursor-pointer items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-xs text-white transition hover:border-white/40">
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={handleFileChange}
                    />
                    Upload
                  </label>
                  <span className="text-xs text-slate-400">
                    {photoName ?? 'No file selected'}
                  </span>
                </div>
              </label>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={handleSaveDraft}
                disabled={saveMutation.isPending}
                className="rounded-full bg-white px-5 py-2 text-xs font-semibold text-slate-900 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {cardId ? 'Update Draft' : 'Create Draft'}
              </button>
              <span className="text-xs text-slate-400">{statusMessage}</span>
              {errorMessage ? (
                <span className="text-xs text-rose-300">{errorMessage}</span>
              ) : null}
            </div>
          </section>

          <section className="space-y-6">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">Live Crop</h2>
                  <p className="text-sm text-slate-400">
                    Drag the image to frame it. Scroll or pinch to zoom.
                  </p>
                </div>
                <div className="text-xs text-slate-400">
                  Rotation: {rotation} deg
                </div>
              </div>

              <div className="mt-5">
                <div className="relative aspect-[3/4] w-full overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/60 shadow-[0_20px_60px_rgba(3,7,18,0.6)]">
                  {photoUrl ? (
                    <Cropper
                      image={photoUrl}
                      crop={crop}
                      zoom={zoom}
                      rotation={rotation}
                      aspect={3 / 4}
                      onCropChange={setCrop}
                      onZoomChange={setZoom}
                      onCropComplete={handleCropComplete}
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
                  onClick={handleRotate}
                  className="rounded-full border border-white/15 px-3 py-1 text-xs text-white transition hover:border-white/40"
                >
                  Rotate 90 deg
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
                <div className="font-display text-2xl text-white">
                  {displayName}
                </div>
                <div className="text-sm text-slate-300">
                  {form.position || 'Position'} / {form.team || 'Team'}
                </div>
                <div className="text-xs text-slate-400">
                  Crop: {normalizedCrop ? `${normalizedCrop.w} x ${normalizedCrop.h}` : '-'}
                </div>
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
