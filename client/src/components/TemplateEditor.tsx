import { useEffect, useMemo, useState } from 'react'
import type { CardType, TemplateDefinition, TemplateTheme, TournamentConfig } from 'shared'
import TemplatePreview from './TemplatePreview'
import { assetUrlForKey } from '../api'

const SAFE_ID_PATTERN = /^[a-z0-9-]{3,64}$/

const BASE_THEME: TemplateTheme = {
  gradientStart: 'rgba(15, 23, 42, 0)',
  gradientEnd: 'rgba(15, 23, 42, 0.85)',
  border: 'rgba(255, 255, 255, 0.1)',
  accent: 'rgba(255, 255, 255, 0.5)',
  label: '#ffffff',
  nameColor: '#ffffff',
  meta: '#ffffff',
  watermark: 'rgba(255, 255, 255, 0.12)',
}

const THEME_FIELDS: Array<keyof TemplateTheme> = [
  'gradientStart',
  'gradientEnd',
  'border',
  'accent',
  'label',
  'nameColor',
  'meta',
  'watermark',
]

const FLAG_FIELDS = [
  'showGradient',
  'showBorders',
  'showWatermarkJersey',
] as const

type TemplateEditorProps = {
  config: TournamentConfig
  onChange: (next: TournamentConfig) => void
  uploadOverlay: (templateId: string, file: File) => Promise<string>
  onSave?: () => void
  isSaving?: boolean
}

const toHex = (value: string) => {
  const trimmed = value.trim()
  const shortHex = /^#([0-9a-f]{3})$/i.exec(trimmed)
  if (shortHex) {
    const expanded = shortHex[1]
      .split('')
      .map((ch) => `${ch}${ch}`)
      .join('')
    return `#${expanded.toLowerCase()}`
  }
  const fullHex = /^#([0-9a-f]{6})$/i.exec(trimmed)
  if (fullHex) return `#${fullHex[1].toLowerCase()}`

  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(trimmed)
  if (!rgb) return null
  const [r, g, b] = rgb.slice(1, 4).map((part) => Math.min(255, Math.max(0, Number(part))))
  const toHexPart = (n: number) => n.toString(16).padStart(2, '0')
  return `#${toHexPart(r)}${toHexPart(g)}${toHexPart(b)}`
}

const loadImageDimensions = (file: File): Promise<{ width: number; height: number }> =>
  new Promise((resolve, reject) => {
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

const normalizeDefaults = (
  templates: TemplateDefinition[],
  defaults: TournamentConfig['defaultTemplates']
) => {
  if (!templates.length) {
    return defaults
  }
  const templateIds = new Set(templates.map((template) => template.id))
  const fallback =
    (defaults?.fallback && templateIds.has(defaults.fallback) && defaults.fallback) ||
    templates[0]?.id ||
    'classic'
  const byCardType = Object.fromEntries(
    Object.entries(defaults?.byCardType ?? {}).filter(([, value]) => value && templateIds.has(value))
  )

  return {
    fallback,
    byCardType,
  }
}

export default function TemplateEditor({ config, onChange, uploadOverlay, onSave, isSaving }: TemplateEditorProps) {
  const templates = useMemo(() => config.templates ?? [], [config.templates])
  const [selectedId, setSelectedId] = useState(templates[0]?.id ?? '')
  const [isCreating, setIsCreating] = useState(false)
  const [newTemplateId, setNewTemplateId] = useState('')
  const [newTemplateLabel, setNewTemplateLabel] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [overlayFile, setOverlayFile] = useState<File | null>(null)
  const [overlayWarning, setOverlayWarning] = useState<string | null>(null)
  const [overlayStatus, setOverlayStatus] = useState<'idle' | 'uploading' | 'error'>('idle')
  const [overlayError, setOverlayError] = useState<string | null>(null)

  const defaults = useMemo(
    () => normalizeDefaults(templates, config.defaultTemplates),
    [config.defaultTemplates, templates]
  )

  useEffect(() => {
    if (!selectedId && templates[0]) {
      setSelectedId(templates[0].id)
      return
    }
    if (selectedId && !templates.some((template) => template.id === selectedId)) {
      setSelectedId(templates[0]?.id ?? '')
    }
  }, [selectedId, templates])

  const selectedTemplate = templates.find((template) => template.id === selectedId) ?? null

  const updateTemplates = (nextTemplates: TemplateDefinition[]) => {
    const nextDefaults = normalizeDefaults(nextTemplates, config.defaultTemplates)
    onChange({
      ...config,
      templates: nextTemplates,
      defaultTemplates: nextDefaults,
    })
  }

  const updateSelectedTemplate = (next: TemplateDefinition) => {
    if (!selectedTemplate) return
    updateTemplates(
      templates.map((template) => (template.id === selectedTemplate.id ? next : template))
    )
  }

  const setThemeField = (field: keyof TemplateTheme, rawValue: string) => {
    if (!selectedTemplate) return
    const value = rawValue.trim()
    const nextTheme = { ...(selectedTemplate.theme ?? {}) }

    if (!value) {
      delete nextTheme[field]
    } else {
      // Preserve original raw value (keeps rgba intact)
      nextTheme[field] = rawValue
    }

    updateSelectedTemplate({
      ...selectedTemplate,
      theme: Object.keys(nextTheme).length > 0 ? nextTheme : undefined,
    })
  }

  const handleCreateTemplate = () => {
    const id = newTemplateId.trim()
    const label = newTemplateLabel.trim()
    if (!id || !label) {
      setFormError('Template id and label are required')
      return
    }
    if (!SAFE_ID_PATTERN.test(id)) {
      setFormError('Template id must be lowercase letters, numbers, or hyphens')
      return
    }
    if (templates.some((template) => template.id === id)) {
      setFormError('Template id already exists')
      return
    }

    const nextTemplates = [...templates, { id, label }]
    updateTemplates(nextTemplates)
    setSelectedId(id)
    setNewTemplateId('')
    setNewTemplateLabel('')
    setFormError(null)
    setIsCreating(false)
  }

  const handleDeleteTemplate = () => {
    if (!selectedTemplate) return
    if (!window.confirm(`Delete template "${selectedTemplate.label}"?`)) return
    const nextTemplates = templates.filter((template) => template.id !== selectedTemplate.id)

    const nextDefaults = normalizeDefaults(nextTemplates, {
      fallback: defaults?.fallback ?? 'classic',
      byCardType: defaults?.byCardType,
    })

    onChange({
      ...config,
      templates: nextTemplates,
      defaultTemplates: nextDefaults,
    })

    setSelectedId(nextTemplates[0]?.id ?? '')
  }

  const handleOverlayFile = async (file: File | null) => {
    setOverlayFile(file)
    setOverlayWarning(null)
    setOverlayError(null)
    if (!file) return
    try {
      const { width, height } = await loadImageDimensions(file)
      if (width !== 825 || height !== 1125) {
        setOverlayWarning(`Overlay is ${width}×${height}px. Expected 825×1125.`)
      }
    } catch {
      setOverlayWarning('Could not read image dimensions.')
    }
  }

  const handleUploadOverlay = async () => {
    if (!selectedTemplate || !overlayFile) return
    setOverlayStatus('uploading')
    setOverlayError(null)
    try {
      const key = await uploadOverlay(selectedTemplate.id, overlayFile)
      updateSelectedTemplate({
        ...selectedTemplate,
        overlayKey: key,
      })
      setOverlayFile(null)
      setOverlayWarning(null)
      setOverlayStatus('idle')
    } catch (err) {
      setOverlayStatus('error')
      setOverlayError(err instanceof Error ? err.message : 'Upload failed')
    }
  }

  const usedByCardTypes = useMemo(() => {
    const entries = defaults?.byCardType ?? {}
    return new Map<string, CardType[]>(
      Object.entries(entries).reduce((acc, [type, id]) => {
        if (!id) return acc
        const next = acc.get(id) ?? []
        next.push(type as CardType)
        acc.set(id, next)
        return acc
      }, new Map<string, CardType[]>())
    )
  }, [defaults?.byCardType])

  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Templates</h2>
          <p className="text-sm text-slate-400">
            Build template styles, assign defaults, and preview renders.
          </p>
        </div>
        <div className="flex gap-2">
          {onSave && (
            <button
              type="button"
              onClick={onSave}
              disabled={isSaving}
              className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {isSaving ? 'Saving…' : 'Save Templates'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsCreating(true)}
            className="rounded-full border border-white/20 px-4 py-2 text-xs text-white hover:border-white/40"
          >
            Add Template
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            {templates.map((template) => {
              const isActive = template.id === selectedId
              const usedByFallback = defaults?.fallback === template.id
              const usedBy = usedByCardTypes.get(template.id) ?? []
              return (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => setSelectedId(template.id)}
                  className={`rounded-2xl border p-3 text-left transition ${
                    isActive ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-white/10 bg-slate-950/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm text-white">{template.label}</div>
                      <div className="text-[11px] text-slate-500">{template.id}</div>
                    </div>
                    {usedByFallback ? (
                      <span className="rounded-full border border-emerald-500/40 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-emerald-300">
                        Default
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-3 overflow-hidden rounded-xl border border-white/10 bg-slate-950/60">
                    {template.overlayKey ? (
                      <img
                        src={assetUrlForKey(template.overlayKey)}
                        alt={`${template.label} overlay`}
                        className="h-32 w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-32 items-center justify-center text-[11px] text-slate-500">
                        No overlay
                      </div>
                    )}
                  </div>
                  {usedBy.length > 0 ? (
                    <div className="mt-2 text-[11px] text-slate-500">
                      Used for: {usedBy.join(', ')}
                    </div>
                  ) : null}
                </button>
              )
            })}
          </div>

          {isCreating ? (
            <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
              <h3 className="text-sm font-semibold text-white">New Template</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-xs uppercase tracking-wide text-slate-400">
                  Template Id
                  <input
                    value={newTemplateId}
                    onChange={(event) => setNewTemplateId(event.target.value)}
                    placeholder="classic-alt"
                    className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
                  />
                </label>
                <label className="text-xs uppercase tracking-wide text-slate-400">
                  Label
                  <input
                    value={newTemplateLabel}
                    onChange={(event) => setNewTemplateLabel(event.target.value)}
                    placeholder="Classic Alt"
                    className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
                  />
                </label>
              </div>
              {formError ? (
                <p className="mt-2 text-xs text-rose-300">{formError}</p>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleCreateTemplate}
                  className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-slate-900"
                >
                  Create
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsCreating(false)
                    setFormError(null)
                  }}
                  className="rounded-full border border-white/20 px-4 py-2 text-xs text-slate-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {selectedTemplate ? (
            <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-white">Template Details</h3>
                  <p className="text-xs text-slate-500">
                    Update overlay, colors, and layout rules.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleDeleteTemplate}
                  className="rounded-full border border-rose-500/40 px-3 py-1 text-[11px] text-rose-300"
                >
                  Delete
                </button>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="text-xs uppercase tracking-wide text-slate-400">
                  Template Id
                  <input
                    value={selectedTemplate.id}
                    readOnly
                    className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-400"
                  />
                </label>
                <label className="text-xs uppercase tracking-wide text-slate-400">
                  Label
                  <input
                    value={selectedTemplate.label}
                    onChange={(event) =>
                      updateSelectedTemplate({
                        ...selectedTemplate,
                        label: event.target.value,
                      })
                    }
                    className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
                  />
                </label>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="text-xs uppercase tracking-wide text-slate-400">
                  Overlay Key
                  <input
                    value={selectedTemplate.overlayKey ?? ''}
                    onChange={(event) =>
                      updateSelectedTemplate({
                        ...selectedTemplate,
                        overlayKey: event.target.value.trim() || undefined,
                      })
                    }
                    placeholder="config/tournaments/.../overlays/..."
                    className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
                  />
                </label>
                <label className="text-xs uppercase tracking-wide text-slate-400">
                  Overlay Placement
                  <div className="mt-2 flex rounded-full border border-white/10 bg-slate-950/60 p-1 text-xs text-white">
                    {['belowText', 'aboveText'].map((placement) => {
                      const active = (selectedTemplate.overlayPlacement ?? 'belowText') === placement
                      return (
                        <button
                          key={placement}
                          type="button"
                          onClick={() =>
                            updateSelectedTemplate({
                              ...selectedTemplate,
                              overlayPlacement: placement as 'belowText' | 'aboveText',
                            })
                          }
                          className={`flex-1 rounded-full px-3 py-1 ${
                            active ? 'bg-white/10 text-white' : 'text-slate-400'
                          }`}
                        >
                          {placement === 'belowText' ? 'Below Text' : 'Above Text'}
                        </button>
                      )
                    })}
                  </div>
                </label>
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Overlay Upload</div>
                    <p className="mt-1 text-xs text-slate-500">PNG only · 825×1125 recommended.</p>
                  </div>
                  {selectedTemplate.overlayKey ? (
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(selectedTemplate.overlayKey ?? '')}
                      className="rounded-full border border-white/20 px-3 py-1 text-[11px] text-slate-200"
                    >
                      Copy Key
                    </button>
                  ) : null}
                </div>
                <input
                  type="file"
                  accept="image/png"
                  className="mt-3 text-xs text-slate-300"
                  onChange={(event) => handleOverlayFile(event.target.files?.[0] ?? null)}
                />
                {overlayWarning ? (
                  <p className="mt-2 text-xs text-amber-300">{overlayWarning}</p>
                ) : null}
                {overlayError ? (
                  <p className="mt-2 text-xs text-rose-300">{overlayError}</p>
                ) : null}
                <button
                  type="button"
                  onClick={handleUploadOverlay}
                  disabled={!overlayFile || overlayStatus === 'uploading'}
                  className="mt-3 rounded-full bg-white px-4 py-2 text-xs font-semibold text-slate-900 disabled:opacity-50"
                >
                  {overlayStatus === 'uploading' ? 'Uploading...' : 'Upload Overlay'}
                </button>
              </div>

              <div className="mt-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs uppercase tracking-[0.2em] text-slate-400">Theme Colors</h4>
                  <button
                    type="button"
                    onClick={() =>
                      updateSelectedTemplate({
                        ...selectedTemplate,
                        theme: undefined,
                      })
                    }
                    className="text-[11px] text-slate-400 hover:text-slate-200"
                  >
                    Reset Theme
                  </button>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {THEME_FIELDS.map((field) => {
                    const value = selectedTemplate.theme?.[field] ?? BASE_THEME[field]
                    const hexValue = toHex(value) ?? '#ffffff'
                    return (
                      <label key={field} className="text-xs uppercase tracking-wide text-slate-400">
                        {field}
                        <div className="mt-2 flex items-center gap-2">
                          <input
                            type="color"
                            value={hexValue}
                            onChange={(event) => setThemeField(field, event.target.value)}
                            className="h-9 w-9 rounded-md border border-white/10 bg-slate-950/60"
                          />
                          <input
                            value={value}
                            onChange={(event) => setThemeField(field, event.target.value)}
                            className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
                          />
                        </div>
                      </label>
                    )
                  })}
                </div>
              </div>

              <div className="mt-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs uppercase tracking-[0.2em] text-slate-400">Flags</h4>
                  <button
                    type="button"
                    onClick={() =>
                      updateSelectedTemplate({
                        ...selectedTemplate,
                        flags: undefined,
                      })
                    }
                    className="text-[11px] text-slate-400 hover:text-slate-200"
                  >
                    Reset Flags
                  </button>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {FLAG_FIELDS.map((flag) => {
                    const value = selectedTemplate.flags?.[flag] ?? true
                    return (
                      <label key={flag} className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-xs text-white">
                        <span>{flag}</span>
                        <input
                          type="checkbox"
                          checked={value}
                          onChange={(event) =>
                            updateSelectedTemplate({
                              ...selectedTemplate,
                              flags: {
                                ...selectedTemplate.flags,
                                [flag]: event.target.checked,
                              },
                            })
                          }
                        />
                      </label>
                    )
                  })}
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                <h4 className="text-xs uppercase tracking-[0.2em] text-slate-400">Default Assignments</h4>
                <label className="mt-3 block text-xs uppercase tracking-wide text-slate-400">
                  Fallback Template
                  <select
                    value={defaults?.fallback ?? ''}
                    onChange={(event) => {
                      const fallback = event.target.value
                      onChange({
                        ...config,
                        defaultTemplates: {
                          fallback,
                          byCardType: defaults?.byCardType ?? {},
                        },
                      })
                    }}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
                  >
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="mt-3 space-y-2">
                  {config.cardTypes.map((entry) => (
                    <div key={entry.type} className="flex items-center justify-between gap-3 text-xs text-slate-300">
                      <div>
                        <div className="text-white">{entry.label}</div>
                        <div className="text-[11px] text-slate-500">{entry.type}</div>
                      </div>
                      <select
                        value={defaults?.byCardType?.[entry.type] ?? ''}
                        onChange={(event) => {
                          const value = event.target.value
                          const nextByCardType = { ...(defaults?.byCardType ?? {}) }
                          if (!value) {
                            delete nextByCardType[entry.type]
                          } else {
                            nextByCardType[entry.type] = value
                          }
                          onChange({
                            ...config,
                            defaultTemplates: {
                              fallback: defaults?.fallback ?? templates[0]?.id ?? 'classic',
                              byCardType: nextByCardType,
                            },
                          })
                        }}
                        className="rounded-lg border border-white/10 bg-slate-950/60 px-2 py-1 text-xs text-white"
                      >
                        <option value="">Use fallback</option>
                        {templates.map((template) => (
                          <option key={template.id} value={template.id}>
                            {template.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4 text-xs text-slate-400">
              Add a template to start editing.
            </div>
          )}
        </div>

        <div className="lg:sticky lg:top-6 lg:self-start">
          {selectedTemplate ? (
            <TemplatePreview
              config={config}
              templateId={selectedTemplate.id}
              templateLabel={selectedTemplate.label}
            />
          ) : (
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-xs text-slate-400">
              Select a template to preview it.
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
