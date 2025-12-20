import { useEffect, useMemo, useState } from 'react'
import { CARD_ASPECT, type Card, type CardType, type TournamentConfig } from 'shared'
import { renderCard } from '../renderCard'
import { assetUrlForKey } from '../api'

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
      cardType: 'rare',
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
    teamId: cardType === 'player' || cardType === 'team-staff' ? team?.id : undefined,
    teamName: cardType === 'player' || cardType === 'team-staff' ? team?.name : undefined,
    photographer: 'Sample Photographer',
    photo: { crop: { x: 0, y: 0, w: 1, h: 1, rotateDeg: 0 } },
  }
}

type TemplatePreviewProps = {
  config: TournamentConfig
  templateId: string
  templateLabel: string
}

export default function TemplatePreview({ config, templateId, templateLabel }: TemplatePreviewProps) {
  const enabledCardTypes = useMemo(
    () => config.cardTypes.filter((entry) => entry.enabled).map((entry) => entry.type),
    [config.cardTypes]
  )
  const [cardType, setCardType] = useState<CardType>(enabledCardTypes[0] ?? 'player')
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
        const blob = await renderCard({
          card,
          config,
          imageUrl: PREVIEW_IMAGE_URL,
          resolveAssetUrl: assetUrlForKey,
          templateId,
        })
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
  }, [cardType, config, templateId])

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

      <div className="mt-4">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt="Template preview"
            className="w-full rounded-2xl shadow-lg"
            style={{ aspectRatio: `${CARD_ASPECT}` }}
          />
        ) : (
          <div className="flex aspect-[825/1125] items-center justify-center rounded-2xl border border-dashed border-white/10 text-xs text-slate-500">
            {error ?? 'Rendering preview...'}
          </div>
        )}
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Preview uses sample data and a placeholder photo.
      </p>
    </div>
  )
}
