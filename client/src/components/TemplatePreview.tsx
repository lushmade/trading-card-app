import { useEffect, useMemo, useState } from 'react'
import { CARD_ASPECT, TRIM_ASPECT, type Card, type CardType, type TournamentConfig } from 'shared'
import { renderCard, renderPreviewTrim } from '../renderCard'
import { assetUrlForKey } from '../api'
import CropGuides from './CropGuides'

type ViewMode = 'trim' | 'bleed'

const PREVIEW_IMAGE_URL = (() => {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="825" height="1125" viewBox="0 0 825 1125">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a" />
      <stop offset="55%" stop-color="#1e293b" />
      <stop offset="100%" stop-color="#020617" />
    </linearGradient>
    <radialGradient id="glow" cx="0.2" cy="0.2" r="0.9">
      <stop offset="0%" stop-color="#22c55e" stop-opacity="0.35" />
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0" />
    </radialGradient>
  </defs>
  <rect width="825" height="1125" fill="url(#bg)" />
  <rect width="825" height="1125" fill="url(#glow)" />
  <g opacity="0.25" fill="#38bdf8">
    <circle cx="690" cy="180" r="90" />
    <circle cx="520" cy="320" r="30" />
  </g>
  <g opacity="0.2" fill="#f97316">
    <circle cx="130" cy="860" r="140" />
  </g>
</svg>`

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
})()

const buildSampleCard = (config: TournamentConfig, cardType: CardType, templateId: string): Card => {
  const now = new Date().toISOString()
  const team = config.teams[0]
  const typeConfig = config.cardTypes.find((entry) => entry.type === cardType)
  const position = typeConfig?.positions?.[0] ?? 'Position'

  if (cardType === 'rare') {
    return {
      id: 'preview',
      tournamentId: config.id,
      cardType,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      templateId,
      title: 'Championship MVP',
      caption: 'Limited edition showcase',
      photographer: 'Sample Photographer',
      photo: { crop: { x: 0, y: 0, w: 1, h: 1, rotateDeg: 0 } },
    }
  }

  if (cardType === 'super-rare') {
    // Super-rare preview with player info (Dragon Wolves, Beater 12, Jordan Lopez)
    const dragonWolves = config.teams.find((t) => t.name.toLowerCase().includes('dragon wolves')) ?? team
    return {
      id: 'preview',
      tournamentId: config.id,
      cardType,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      templateId,
      firstName: 'Bao',
      lastName: 'Hoang',
      position: 'Beater',
      jerseyNumber: '12',
      teamId: dragonWolves?.id,
      teamName: dragonWolves?.name ?? 'Dragon Wolves',
      photographer: 'Photographer',
      photo: { crop: { x: 0, y: 0, w: 1, h: 1, rotateDeg: 0 } },
    }
  }

  return {
    id: 'preview',
    tournamentId: config.id,
    cardType,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    templateId,
    firstName: 'Jordan',
    lastName: 'Lopez',
    position,
    jerseyNumber: '12',
    teamId: typeConfig?.teamFieldMode === 'freetext' ? undefined : (cardType === 'player' || cardType === 'team-staff' ? team?.id : undefined),
    teamName: typeConfig?.teamFieldMode === 'freetext'
      ? (typeConfig.teamFieldDefault ?? typeConfig.teamFieldLabel ?? 'Volunteer')
      : (cardType === 'player' || cardType === 'team-staff' ? team?.name : undefined),
    photographer: 'Sample Photographer',
    photo: { crop: { x: 0, y: 0, w: 1, h: 1, rotateDeg: 0 } },
  }
}

type TemplatePreviewProps = {
  config: TournamentConfig
  templateId: string
  templateLabel: string
  /** When true, includes disabled card types like 'super-rare' in preview options */
  includeDisabledTypes?: boolean
}

export default function TemplatePreview({ config, templateId, templateLabel, includeDisabledTypes }: TemplatePreviewProps) {
  const enabledCardTypes = useMemo(
    () => config.cardTypes
      .filter((entry) => includeDisabledTypes || entry.enabled !== false)
      .map((entry) => entry.type),
    [config.cardTypes, includeDisabledTypes]
  )
  const [cardType, setCardType] = useState<CardType>(enabledCardTypes[0] ?? 'player')
  const [viewMode, setViewMode] = useState<ViewMode>('trim')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabledCardTypes.includes(cardType)) {
      setCardType(enabledCardTypes[0] ?? 'player')
    }
  }, [cardType, enabledCardTypes])

  useEffect(() => {
    if (!templateId) return

    let cancelled = false
    const run = async () => {
      try {
        const card = buildSampleCard(config, cardType, templateId)
        const renderInput = {
          card,
          config,
          imageUrl: PREVIEW_IMAGE_URL,
          resolveAssetUrl: assetUrlForKey,
          templateId,
        }
        const blob = viewMode === 'bleed'
          ? await renderCard(renderInput)
          : await renderPreviewTrim(renderInput)
        if (cancelled) return
        const url = URL.createObjectURL(blob)
        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev)
          return url
        })
        setError(null)
      } catch {
        if (!cancelled) {
          setError('Preview failed to render')
        }
      }
    }

    run()

    return () => {
      cancelled = true
    }
  }, [cardType, config, templateId, viewMode])

  const aspectRatio = viewMode === 'bleed' ? CARD_ASPECT : TRIM_ASPECT

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm uppercase tracking-[0.2em] text-slate-400">Live Preview</h3>
          <div className="mt-1 text-xs text-slate-500">
            {templateLabel} · {templateId}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {enabledCardTypes.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setCardType(type)}
              className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.2em] ${
                cardType === type
                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200'
                  : 'border-white/10 text-slate-400'
              }`}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => setViewMode('trim')}
          className={`rounded-full border px-3 py-1 text-[11px] ${
            viewMode === 'trim'
              ? 'border-sky-500/50 bg-sky-500/10 text-sky-200'
              : 'border-white/10 text-slate-400'
          }`}
        >
          Trim View
        </button>
        <button
          type="button"
          onClick={() => setViewMode('bleed')}
          className={`rounded-full border px-3 py-1 text-[11px] ${
            viewMode === 'bleed'
              ? 'border-sky-500/50 bg-sky-500/10 text-sky-200'
              : 'border-white/10 text-slate-400'
          }`}
        >
          Full Bleed
        </button>
      </div>

      <div className="mt-4">
        {previewUrl ? (
          <div
            className="relative w-full overflow-hidden rounded-2xl shadow-lg"
            style={{ aspectRatio: `${aspectRatio}` }}
          >
            <img
              src={previewUrl}
              alt="Template preview"
              className="h-full w-full"
            />
            {viewMode === 'bleed' ? (
              <CropGuides visible mode="both" basis="card" />
            ) : (
              <CropGuides visible mode="safe" basis="trim" />
            )}
          </div>
        ) : (
          <div
            className="flex items-center justify-center rounded-2xl border border-dashed border-white/10 text-xs text-slate-500"
            style={{ aspectRatio: `${aspectRatio}` }}
          >
            {error ?? 'Rendering preview...'}
          </div>
        )}
      </div>
      <p className="mt-3 text-xs text-slate-500">
        {viewMode === 'bleed'
          ? 'Full bleed view shows trim (red) and safe (blue) zones.'
          : 'Trim view shows what the cut card will look like. Safe zone (blue) marks guaranteed print area.'}
      </p>
    </div>
  )
}
