import { useEffect, useMemo, useState } from 'react'
import JSZip from 'jszip'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { resolveTemplateId, type Card, type TournamentConfig, type TournamentListEntry } from 'shared'
import { api, assetUrlForKey } from './api'
import { renderCard, resolveTemplateSnapshot } from './renderCard'
import TemplateEditor from './components/TemplateEditor'

type LogosZipResult = {
  uploaded: string[]
  skipped: Array<{ filename: string; reason: string }>
  missingLogos: string[]
}

type BundleImportResult = {
  tournament: TournamentConfig
  results: {
    configSaved: boolean
    assetsUploaded: string[]
    assetsSkipped: string[]
  }
}

type PresignResponse = {
  uploadUrl: string
  key: string
  method: 'POST' | 'PUT'
  headers?: Record<string, string>
  fields?: Record<string, string>
}

const MAX_UPLOAD_RETRIES = 1

const cardDisplayName = (card: Card) => {
  if (card.cardType === 'rare') {
    return card.title ?? 'Untitled rare card'
  }
  const fullName = [card.firstName, card.lastName].filter(Boolean).join(' ')
  return fullName || 'Unnamed card'
}

// Sanitize filenames for ZIP entries to prevent Zip Slip attacks
const safeZipName = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[/\\]/g, '-')           // kill path separators
    .replace(/\.\./g, '.')            // kill traversal
    .replace(/[^a-zA-Z0-9._ -]/g, '') // strip weird chars
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60) || 'card'

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
  const uploadOnce = async () => {
    if (presign.method === 'POST') {
      if (!presign.fields) {
        throw new Error('Upload fields are missing')
      }
      const formData = new FormData()
      for (const [key, value] of Object.entries(presign.fields)) {
        formData.append(key, value)
      }
      formData.append('file', toUploadFile(data, presign.key))
      const res = await fetch(presign.uploadUrl, { method: 'POST', body: formData })
      if (!res.ok) throw new Error('Upload failed')
      return
    }

    const res = await fetch(presign.uploadUrl, {
      method: presign.method,
      headers: presign.headers,
      body: data,
    })
    if (!res.ok) throw new Error('Upload failed')
  }

  let lastError: unknown = null
  for (let attempt = 0; attempt <= MAX_UPLOAD_RETRIES; attempt++) {
    try {
      await uploadOnce()
      return
    } catch (err) {
      lastError = err
    }
  }

  if (lastError instanceof Error) throw lastError
  throw new Error('Upload failed')
}

export default function Admin() {
  const queryClient = useQueryClient()
  const [passwordInput, setPasswordInput] = useState('')
  const [adminPassword, setAdminPassword] = useState(() => sessionStorage.getItem('adminPassword') ?? '')
  const [activeTournamentId, setActiveTournamentId] = useState('')
  const [configDraft, setConfigDraft] = useState('')
  const [statusFilter, setStatusFilter] = useState('submitted')
  const [logosZipFile, setLogosZipFile] = useState<File | null>(null)
  const [logosZipResult, setLogosZipResult] = useState<LogosZipResult | null>(null)
  const [bundleFile, setBundleFile] = useState<File | null>(null)
  const [bundleResult, setBundleResult] = useState<BundleImportResult | null>(null)
  const [renderingCardId, setRenderingCardId] = useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false)
  const [activeTab, setActiveTab] = useState<'cards' | 'config' | 'assets'>('cards')

  // Check if admin auth is enabled on the server
  const authConfigQuery = useQuery({
    queryKey: ['admin-auth-config'],
    queryFn: async () => {
      const res = await fetch(api('/admin-config'))
      if (!res.ok) throw new Error('Failed to fetch admin config')
      return res.json() as Promise<{ authEnabled: boolean }>
    },
    staleTime: Infinity, // Auth config doesn't change during a session
  })

  const authEnabled = authConfigQuery.data?.authEnabled ?? true // Default to enabled if unknown

  // Save password to sessionStorage when it changes
  useEffect(() => {
    if (adminPassword) {
      sessionStorage.setItem('adminPassword', adminPassword)
    }
  }, [adminPassword])

  const handleLogin = () => {
    if (passwordInput.trim()) {
      setAdminPassword(passwordInput.trim())
    }
  }

  // Auth headers for admin API calls (only include Authorization when auth is enabled)
  const adminHeaders = useMemo(() => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (authEnabled && adminPassword) {
      headers['Authorization'] = `Bearer ${adminPassword}`
    }
    return headers
  }, [adminPassword, authEnabled])

  // Helper for requests that only need auth header (no Content-Type)
  const authOnlyHeaders = useMemo((): Record<string, string> => {
    if (authEnabled && adminPassword) {
      return { 'Authorization': `Bearer ${adminPassword}` }
    }
    return {}
  }, [adminPassword, authEnabled])

  const tournamentsQuery = useQuery({
    queryKey: ['admin-tournaments', adminPassword, authEnabled],
    queryFn: async () => {
      const res = await fetch(api('/admin/tournaments'), { headers: adminHeaders })
      if (!res.ok) throw new Error('Request failed')
      return res.json() as Promise<TournamentListEntry[]>
    },
    // Run when auth is disabled OR when a password is provided
    enabled: authConfigQuery.isSuccess && (!authEnabled || Boolean(adminPassword)),
  })

  useEffect(() => {
    if (!activeTournamentId && tournamentsQuery.data?.length) {
      setActiveTournamentId(tournamentsQuery.data[0].id)
    }
  }, [activeTournamentId, tournamentsQuery.data])

  const configQuery = useQuery({
    queryKey: ['admin-config', activeTournamentId, adminPassword, authEnabled],
    queryFn: async () => {
      const res = await fetch(api(`/admin/tournaments/${activeTournamentId}`), { headers: adminHeaders })
      if (!res.ok) throw new Error('Request failed')
      return res.json() as Promise<TournamentConfig>
    },
    enabled: Boolean(activeTournamentId) && (!authEnabled || Boolean(adminPassword)),
  })

  useEffect(() => {
    if (configQuery.data) {
      setConfigDraft(JSON.stringify(configQuery.data, null, 2))
    }
  }, [configQuery.data])

  const configParsed = useMemo(() => {
    try {
      return JSON.parse(configDraft) as TournamentConfig
    } catch {
      return null
    }
  }, [configDraft])

  const activeConfig = configParsed ?? configQuery.data ?? null

  const templateOptions = useMemo(() => {
    if (activeConfig?.templates && activeConfig.templates.length > 0) {
      return activeConfig.templates
    }
    return [
      { id: 'classic', label: 'Classic' },
      { id: 'noir', label: 'Noir' },
    ]
  }, [activeConfig])

  const templateLabelFor = (templateId: string) =>
    templateOptions.find((template) => template.id === templateId)?.label ?? templateId

  const uploadOverlay = async (templateId: string, file: File) => {
    if (!activeTournamentId) {
      throw new Error('Select a tournament first')
    }
    if (!adminPassword) {
      throw new Error('Admin password is required')
    }
    const res = await fetch(api(`/admin/tournaments/${activeTournamentId}/assets/presign`), {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        kind: 'templateOverlay',
        templateId,
        contentType: file.type,
      }),
    })
    if (!res.ok) {
      const error = await res.json().catch(() => ({}))
      throw new Error(error.error ?? 'Presign failed')
    }
    const presign = await res.json() as PresignResponse
    await uploadToS3(presign, file)
    return presign.key
  }

  const cardsQuery = useQuery({
    queryKey: ['admin-cards', statusFilter, activeTournamentId, adminPassword, authEnabled],
    queryFn: async () => {
      const params = new URLSearchParams({ status: statusFilter })
      if (activeTournamentId) params.set('tournamentId', activeTournamentId)
      const res = await fetch(api(`/admin/cards?${params}`), { headers: adminHeaders })
      if (!res.ok) throw new Error('Request failed')
      return res.json() as Promise<Card[]>
    },
    enabled: !authEnabled || Boolean(adminPassword),
  })

  const saveConfigMutation = useMutation({
    mutationFn: async () => {
      const parsed = JSON.parse(configDraft) as TournamentConfig
      const res = await fetch(api(`/admin/tournaments/${activeTournamentId}`), {
        method: 'PUT',
        headers: adminHeaders,
        body: JSON.stringify(parsed),
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.error ?? 'Request failed')
      }
      return res.json() as Promise<TournamentConfig>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-config', activeTournamentId] })
    },
  })

  const publishMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(api(`/admin/tournaments/${activeTournamentId}/publish`), {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.error ?? 'Request failed')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-tournaments'] })
    },
  })

  const logosZipMutation = useMutation({
    mutationFn: async () => {
      if (!logosZipFile) throw new Error('Select a ZIP file')
      const res = await fetch(api(`/admin/tournaments/${activeTournamentId}/logos-zip`), {
        method: 'POST',
        headers: authOnlyHeaders,
        body: logosZipFile,
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.error ?? 'Upload failed')
      }
      return res.json() as Promise<LogosZipResult>
    },
    onSuccess: (data) => {
      setLogosZipResult(data)
      setLogosZipFile(null)
    },
  })

  const bundleImportMutation = useMutation({
    mutationFn: async () => {
      if (!bundleFile) throw new Error('Select a ZIP file')
      const res = await fetch(api('/admin/tournaments/import-bundle'), {
        method: 'POST',
        headers: authOnlyHeaders,
        body: bundleFile,
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.error ?? 'Import failed')
      }
      return res.json() as Promise<BundleImportResult>
    },
    onSuccess: (data) => {
      setBundleResult(data)
      setBundleFile(null)
      setActiveTournamentId(data.tournament.id)
      queryClient.invalidateQueries({ queryKey: ['admin-tournaments'] })
      queryClient.invalidateQueries({ queryKey: ['admin-config'] })
    },
  })

  const templateMutation = useMutation({
    mutationFn: async ({ id, templateId }: { id: string; templateId: string | null }) => {
      const res = await fetch(api(`/admin/cards/${id}`), {
        method: 'PATCH',
        headers: adminHeaders,
        body: JSON.stringify({ templateId }),
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.error ?? 'Request failed')
      }
      return res.json()
    },
    onMutate: async ({ id, templateId }) => {
      const queryKey = ['admin-cards', statusFilter, activeTournamentId, adminPassword] as const
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<Card[]>(queryKey)
      queryClient.setQueryData<Card[]>(queryKey, (cards) =>
        (cards ?? []).map((c) =>
          c.id === id ? { ...c, templateId: templateId ?? undefined } : c
        )
      )
      return { previous, queryKey }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.queryKey, context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-cards', statusFilter, activeTournamentId] })
    },
  })

  const renderMutation = useMutation({
    mutationFn: async (card: Card) => {
      if (!activeConfig) {
        throw new Error('Tournament config is not available')
      }

      const photoRes = await fetch(api(`/admin/cards/${card.id}/photo-url`), {
        headers: authOnlyHeaders,
      })
      if (!photoRes.ok) {
        const error = await photoRes.json().catch(() => ({}))
        throw new Error(error.error ?? 'Photo request failed')
      }
      const photoData = await photoRes.json() as { url: string }

      const { templateId, templateSnapshot } = resolveTemplateSnapshot({
        card,
        config: activeConfig,
      })

      const blob = await renderCard({
        card,
        config: activeConfig,
        imageUrl: photoData.url,
        resolveAssetUrl: assetUrlForKey,
        templateId,
      })

      const presignRes = await fetch(api(`/admin/cards/${card.id}/renders/presign`), {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          contentType: blob.type || 'image/png',
          contentLength: blob.size,
        }),
      })
      if (!presignRes.ok) {
        const error = await presignRes.json().catch(() => ({}))
        throw new Error(error.error ?? 'Render presign failed')
      }
      const presign = await presignRes.json() as PresignResponse

      await uploadToS3(presign, blob)

      const renderMeta = {
        key: presign.key,
        templateId,
        renderedAt: new Date().toISOString(),
        templateSnapshot,
      }

      const commitRes = await fetch(api(`/admin/cards/${card.id}/renders/commit`), {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ renderKey: presign.key, renderMeta }),
      })
      if (!commitRes.ok) {
        const error = await commitRes.json().catch(() => ({}))
        throw new Error(error.error ?? 'Render commit failed')
      }
      return commitRes.json()
    },
    onMutate: (card) => {
      setRenderingCardId(card.id)
    },
    onSettled: () => {
      setRenderingCardId(null)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-cards', statusFilter, activeTournamentId] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(api(`/admin/cards/${id}`), {
        method: 'DELETE',
        headers: authOnlyHeaders,
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.error ?? 'Delete failed')
      }
      return res.json()
    },
    onSuccess: () => {
      setPendingDeleteId(null)
      queryClient.invalidateQueries({ queryKey: ['admin-cards', statusFilter, activeTournamentId] })
    },
  })

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.allSettled(
        ids.map(async (id) => {
          const res = await fetch(api(`/admin/cards/${id}`), {
            method: 'DELETE',
            headers: authOnlyHeaders,
          })
          if (!res.ok) throw new Error('Delete failed')
          return id
        })
      )
      const deleted = results.filter((r) => r.status === 'fulfilled').length
      const failed = results.filter((r) => r.status === 'rejected').length
      return { deleted, failed }
    },
    onSuccess: () => {
      setShowBulkDeleteConfirm(false)
      queryClient.invalidateQueries({ queryKey: ['admin-cards', statusFilter, activeTournamentId] })
    },
  })

  // Show loading state while checking auth config
  if (authConfigQuery.isPending) {
    return (
      <div className="app-shell min-h-screen">
        <div className="mx-auto flex max-w-md flex-col items-center justify-center px-6 py-24">
          <div className="w-full rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
            <h1 className="font-display text-3xl text-white text-center">Admin Console</h1>
            <p className="mt-2 text-sm text-slate-400 text-center">
              Loading...
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Show loading state while verifying password
  if (authEnabled && adminPassword && tournamentsQuery.isPending) {
    return (
      <div className="app-shell min-h-screen">
        <div className="mx-auto flex max-w-md flex-col items-center justify-center px-6 py-24">
          <div className="w-full rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
            <h1 className="font-display text-3xl text-white text-center">Admin Console</h1>
            <p className="mt-2 text-sm text-slate-400 text-center">
              Verifying credentials...
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Show login screen when auth is enabled and no password entered
  if (authEnabled && !adminPassword) {
    return (
      <div className="app-shell min-h-screen">
        <div className="mx-auto flex max-w-md flex-col items-center justify-center px-6 py-24">
          <div className="w-full rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
            <h1 className="font-display text-3xl text-white text-center">Admin Console</h1>
            <p className="mt-2 text-sm text-slate-400 text-center">
              Enter the admin password to continue.
            </p>
            <form
              className="mt-6"
              onSubmit={(e) => {
                e.preventDefault()
                handleLogin()
              }}
            >
              <label htmlFor="admin-password" className="block text-xs text-slate-400 mb-2">
                Password
              </label>
              <input
                id="admin-password"
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="Enter admin password"
                className="w-full rounded-xl border border-white/20 bg-slate-950/50 px-4 py-3 text-sm text-white placeholder:text-slate-500"
                autoFocus
              />
              <button
                type="submit"
                disabled={!passwordInput.trim()}
                className="mt-4 w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-900 disabled:opacity-50"
              >
                Sign In
              </button>
            </form>
          </div>
        </div>
      </div>
    )
  }

  // Show error state if password is wrong (only when auth is enabled)
  if (authEnabled && tournamentsQuery.isError) {
    return (
      <div className="app-shell min-h-screen">
        <div className="mx-auto flex max-w-md flex-col items-center justify-center px-6 py-24">
          <div className="w-full rounded-3xl border border-rose-500/20 bg-rose-500/5 p-8 backdrop-blur">
            <h1 className="font-display text-3xl text-white text-center">Access Denied</h1>
            <p className="mt-2 text-sm text-rose-400 text-center">
              Invalid password. Please try again.
            </p>
            <form
              className="mt-6"
              onSubmit={(e) => {
                e.preventDefault()
                handleLogin()
              }}
            >
              <label htmlFor="admin-password" className="block text-xs text-slate-400 mb-2">
                Password
              </label>
              <input
                id="admin-password"
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="Enter admin password"
                className="w-full rounded-xl border border-white/20 bg-slate-950/50 px-4 py-3 text-sm text-white placeholder:text-slate-500"
                autoFocus
              />
              <button
                type="submit"
                disabled={!passwordInput.trim()}
                className="mt-4 w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-900 disabled:opacity-50"
              >
                Sign In
              </button>
            </form>
            <button
              type="button"
              onClick={() => {
                setAdminPassword('')
                setPasswordInput('')
                sessionStorage.removeItem('adminPassword')
                queryClient.invalidateQueries({ queryKey: ['admin-tournaments'] })
              }}
              className="mt-4 w-full rounded-xl border border-white/20 px-4 py-2 text-xs text-slate-400 hover:bg-white/5"
            >
              Clear and try again
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell min-h-screen">
      {/* Header */}
      <header className="studio-header">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold text-[var(--text-primary)]">Admin Console</h1>
            <select
              value={activeTournamentId}
              onChange={(event) => setActiveTournamentId(event.target.value)}
              className="rounded-lg border border-[var(--border-light)] bg-[var(--bg-surface)] px-3 py-1.5 text-sm text-[var(--text-primary)]"
            >
              {tournamentsQuery.data?.map((tournament) => (
                <option key={tournament.id} value={tournament.id}>
                  {tournament.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-3">
            {authEnabled ? (
              <>
                <span className="flex items-center gap-1.5 text-xs text-[var(--accent-success)]">
                  <span className="h-2 w-2 rounded-full bg-[var(--accent-success)]" />
                  Authenticated
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setAdminPassword('')
                    setPasswordInput('')
                    sessionStorage.removeItem('adminPassword')
                    queryClient.invalidateQueries({ queryKey: ['admin-tournaments'] })
                  }}
                  className="studio-btn studio-btn-ghost studio-btn-sm"
                >
                  Sign out
                </button>
              </>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-[var(--accent-warning)]">
                <span className="h-2 w-2 rounded-full bg-[var(--accent-warning)]" />
                Auth Disabled
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="border-b border-[var(--border-light)] bg-[var(--bg-surface)]">
        <div className="mx-auto flex max-w-6xl gap-1 px-6">
          {[
            { id: 'cards' as const, label: 'Cards', count: cardsQuery.data?.length },
            { id: 'config' as const, label: 'Tournament Config' },
            { id: 'assets' as const, label: 'Assets' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'text-[var(--accent-primary)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-xs ${
                  activeTab === tab.id
                    ? 'bg-[var(--accent-primary)] text-white'
                    : 'bg-[var(--bg-muted)] text-[var(--text-muted)]'
                }`}>
                  {tab.count}
                </span>
              )}
              {activeTab === tab.id && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--accent-primary)]" />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-6">

        {/* Cards Tab */}
        {activeTab === 'cards' && (
          <section className="studio-panel p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">Card Review</h2>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={async () => {
                    const cardsWithRenders = cardsQuery.data?.filter((c) => c.renderKey) ?? []
                    if (cardsWithRenders.length === 0) return

                    const zip = new JSZip()

                    for (const card of cardsWithRenders) {
                      const name = card.cardType === 'rare'
                        ? (card.title ?? 'rare-card')
                        : [card.firstName, card.lastName].filter(Boolean).join('-') || 'card'
                      const filename = `${safeZipName(name)}-${card.id.slice(0, 8)}.png`

                      const res = await fetch(api(`/admin/cards/${card.id}/download-url`), {
                        headers: authOnlyHeaders,
                      })
                      if (res.ok) {
                        const { url: downloadUrl } = await res.json()
                        const imageRes = await fetch(downloadUrl)
                        if (imageRes.ok) {
                          const blob = await imageRes.blob()
                          zip.file(filename, blob)
                        }
                      }
                    }

                    const zipBlob = await zip.generateAsync({ type: 'blob' })
                    const url = URL.createObjectURL(zipBlob)
                    const link = document.createElement('a')
                    link.href = url
                    link.download = `cards-${statusFilter}-${new Date().toISOString().slice(0, 10)}.zip`
                    link.click()
                    URL.revokeObjectURL(url)
                  }}
                  disabled={!cardsQuery.data?.some((c) => c.renderKey)}
                  className="studio-btn studio-btn-secondary studio-btn-sm disabled:opacity-50"
                >
                  Download All
                </button>
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className="rounded-lg border border-[var(--border-light)] bg-[var(--bg-surface)] px-3 py-1.5 text-sm text-[var(--text-primary)]"
                >
                  <option value="draft">Draft</option>
                  <option value="submitted">Submitted</option>
                  <option value="rendered">Rendered</option>
                </select>
                {statusFilter === 'draft' && cardsQuery.data && cardsQuery.data.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowBulkDeleteConfirm(true)}
                    className="studio-btn studio-btn-sm border-[var(--accent-error)] text-[var(--accent-error)] hover:bg-red-50"
                  >
                    Delete All ({cardsQuery.data.length})
                  </button>
                )}
              </div>
            </div>

            {/* Bulk Delete Confirmation Dialog */}
            {showBulkDeleteConfirm && cardsQuery.data && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                <div className="mx-4 w-full max-w-md rounded-xl border border-[var(--border-light)] bg-[var(--bg-surface)] p-6 shadow-xl">
                  <h3 className="text-lg font-semibold text-[var(--text-primary)]">Delete All Drafts?</h3>
                  <p className="mt-2 text-sm text-[var(--text-secondary)]">
                    This will permanently delete {cardsQuery.data.length} draft card{cardsQuery.data.length === 1 ? '' : 's'}. This action cannot be undone.
                  </p>
                  <div className="mt-6 flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setShowBulkDeleteConfirm(false)}
                      className="studio-btn studio-btn-secondary"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => bulkDeleteMutation.mutate(cardsQuery.data.map((c) => c.id))}
                      disabled={bulkDeleteMutation.isPending}
                      className="studio-btn bg-[var(--accent-error)] text-white hover:opacity-90 disabled:opacity-50"
                    >
                      {bulkDeleteMutation.isPending ? 'Deleting...' : 'Delete All'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Single Delete Confirmation Dialog */}
            {pendingDeleteId && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                <div className="mx-4 w-full max-w-md rounded-xl border border-[var(--border-light)] bg-[var(--bg-surface)] p-6 shadow-xl">
                  <h3 className="text-lg font-semibold text-[var(--text-primary)]">Delete Draft?</h3>
                  <p className="mt-2 text-sm text-[var(--text-secondary)]">
                    This will permanently delete this draft card. This action cannot be undone.
                  </p>
                  <div className="mt-6 flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setPendingDeleteId(null)}
                      className="studio-btn studio-btn-secondary"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteMutation.mutate(pendingDeleteId)}
                      disabled={deleteMutation.isPending}
                      className="studio-btn bg-[var(--accent-error)] text-white hover:opacity-90 disabled:opacity-50"
                    >
                      {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {renderMutation.isError && (
              <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-[var(--accent-error)]">
                {renderMutation.error instanceof Error ? renderMutation.error.message : 'Render failed'}
              </div>
            )}

            {cardsQuery.data?.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="text-4xl mb-3">📭</div>
                <p className="text-[var(--text-secondary)]">No {statusFilter} cards found</p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {cardsQuery.data?.map((card) => {
                  const defaultTemplateId = resolveTemplateId(
                    { cardType: card.cardType },
                    activeConfig ?? undefined
                  )
                  const defaultTemplateLabel = templateLabelFor(defaultTemplateId)
                  const hasUnknownTemplate =
                    Boolean(card.templateId) &&
                    !templateOptions.some((template) => template.id === card.templateId)
                  const isRendering = renderingCardId === card.id

                  return (
                    <div key={card.id} className="rounded-xl border border-[var(--border-light)] bg-[var(--bg-surface)] p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <span className="inline-block rounded-full bg-[var(--bg-muted)] px-2 py-0.5 text-xs font-medium text-[var(--text-secondary)] capitalize">
                            {card.cardType}
                          </span>
                          <h3 className="mt-1 font-medium text-[var(--text-primary)]">
                            {cardDisplayName(card)}
                          </h3>
                          <p className="text-xs text-[var(--text-muted)] font-mono">
                            {card.id.slice(0, 8)}...
                          </p>
                        </div>
                      </div>

                      <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                        Template
                      </label>
                      <select
                        value={card.templateId ?? ''}
                        onChange={(event) =>
                          templateMutation.mutate({
                            id: card.id,
                            templateId: event.target.value ? event.target.value : null,
                          })
                        }
                        className="w-full rounded-lg border border-[var(--border-light)] bg-[var(--bg-surface)] px-2 py-1.5 text-sm text-[var(--text-primary)]"
                      >
                        <option value="">{`Default (${defaultTemplateLabel})`}</option>
                        {hasUnknownTemplate ? (
                          <option value={card.templateId ?? ''}>{`Custom (${card.templateId})`}</option>
                        ) : null}
                        {templateOptions.map((template) => (
                          <option key={template.id} value={template.id}>
                            {template.label}
                          </option>
                        ))}
                      </select>

                      {card.renderKey ? (
                        <img
                          src={assetUrlForKey(card.renderKey)}
                          alt="Rendered card"
                          className="mt-3 w-full rounded-lg border border-[var(--border-light)]"
                        />
                      ) : (
                        <div className="mt-3 flex aspect-[825/1125] items-center justify-center rounded-lg border border-dashed border-[var(--border-medium)] bg-[var(--bg-muted)] text-xs text-[var(--text-muted)]">
                          No render
                        </div>
                      )}

                      <div className="mt-3 flex flex-wrap gap-2">
                        {card.status !== 'draft' ? (
                          <button
                            type="button"
                            onClick={() => renderMutation.mutate(card)}
                            disabled={isRendering || renderMutation.isPending}
                            className="studio-btn studio-btn-primary studio-btn-sm disabled:opacity-50"
                          >
                            {isRendering ? 'Rendering...' : 'Render'}
                          </button>
                        ) : null}
                        {card.status === 'draft' ? (
                          <button
                            type="button"
                            onClick={() => setPendingDeleteId(card.id)}
                            className="studio-btn studio-btn-sm text-[var(--accent-error)] border-[var(--accent-error)] hover:bg-red-50"
                          >
                            Delete
                          </button>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        )}

        {/* Config Tab */}
        {activeTab === 'config' && (
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="studio-panel p-6">
              <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Tournament JSON</h2>
              <textarea
                value={configDraft}
                onChange={(event) => setConfigDraft(event.target.value)}
                className="h-96 w-full rounded-lg border border-[var(--border-light)] bg-[var(--bg-muted)] px-4 py-3 text-xs font-mono text-[var(--text-primary)]"
              />
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => saveConfigMutation.mutate()}
                  disabled={saveConfigMutation.isPending}
                  className="studio-btn studio-btn-primary"
                >
                  {saveConfigMutation.isPending ? 'Saving...' : 'Save Draft'}
                </button>
                <button
                  type="button"
                  onClick={() => publishMutation.mutate()}
                  disabled={publishMutation.isPending}
                  className="studio-btn studio-btn-success"
                >
                  {publishMutation.isPending ? 'Publishing...' : 'Publish'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!configParsed) return
                    const blob = new Blob([JSON.stringify(configParsed, null, 2)], { type: 'application/json' })
                    const url = URL.createObjectURL(blob)
                    const link = document.createElement('a')
                    link.href = url
                    link.download = `${activeTournamentId}-config.json`
                    link.click()
                    URL.revokeObjectURL(url)
                  }}
                  className="studio-btn studio-btn-secondary"
                >
                  Download JSON
                </button>
              </div>
              {saveConfigMutation.isError && (
                <p className="mt-2 text-sm text-[var(--accent-error)]">
                  {saveConfigMutation.error instanceof Error ? saveConfigMutation.error.message : 'Save failed'}
                </p>
              )}
              {publishMutation.isError && (
                <p className="mt-2 text-sm text-[var(--accent-error)]">
                  {publishMutation.error instanceof Error ? publishMutation.error.message : 'Publish failed'}
                </p>
              )}
            </section>

            {activeConfig && (
              <TemplateEditor
                config={activeConfig}
                onChange={(next) => setConfigDraft(JSON.stringify(next, null, 2))}
                uploadOverlay={uploadOverlay}
                onSave={() => saveConfigMutation.mutate()}
                isSaving={saveConfigMutation.isPending}
              />
            )}
          </div>
        )}

        {/* Assets Tab */}
        {activeTab === 'assets' && (
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="studio-panel p-6">
              <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">Upload Team Logos</h2>
              <p className="mt-2 text-xs text-[var(--text-secondary)]">
                Upload a ZIP file containing team logos. Each PNG file should be named with the team ID
                (e.g., <code className="text-[var(--accent-primary)] font-medium">boston-kraken.png</code>).
              </p>
              <div className="mt-4 rounded-xl border border-dashed border-[var(--border-light)] bg-[var(--bg-muted)] p-4">
                <p className="text-xs text-[var(--text-tertiary)] mb-2">Expected structure:</p>
                <pre className="text-xs text-[var(--text-secondary)] font-mono">
{`logos.zip
├── team-id-1.png
├── team-id-2.png
└── ...`}
                </pre>
              </div>
              <input
                type="file"
                accept=".zip"
                className="mt-4 text-xs text-[var(--text-primary)]"
                onChange={(event) => {
                  setLogosZipFile(event.target.files?.[0] ?? null)
                  setLogosZipResult(null)
                }}
              />
              <button
                type="button"
                onClick={() => logosZipMutation.mutate()}
                disabled={!logosZipFile || logosZipMutation.isPending}
                className="studio-btn studio-btn-primary mt-3"
              >
                {logosZipMutation.isPending ? 'Uploading...' : 'Upload Logos ZIP'}
              </button>
              {logosZipMutation.isError && (
                <p className="mt-2 text-xs text-[var(--accent-error)]">
                  {logosZipMutation.error instanceof Error ? logosZipMutation.error.message : 'Upload failed'}
                </p>
              )}
              {logosZipResult && (
                <div className="mt-4 space-y-2 text-xs">
                  <p className="text-[var(--accent-success)]">
                    Uploaded: {logosZipResult.uploaded.length} logos
                  </p>
                  {logosZipResult.skipped.length > 0 && (
                    <div className="text-[var(--accent-warning)]">
                      <p>Skipped {logosZipResult.skipped.length} files:</p>
                      <ul className="mt-1 ml-4 list-disc text-[var(--text-secondary)]">
                        {logosZipResult.skipped.slice(0, 5).map((s, i) => (
                          <li key={i}>{s.filename}: {s.reason}</li>
                        ))}
                        {logosZipResult.skipped.length > 5 && (
                          <li>...and {logosZipResult.skipped.length - 5} more</li>
                        )}
                      </ul>
                    </div>
                  )}
                  {logosZipResult.missingLogos.length > 0 && (
                    <div className="text-[var(--accent-error)]">
                      <p>Teams still missing logos: {logosZipResult.missingLogos.length}</p>
                      <ul className="mt-1 ml-4 list-disc text-[var(--text-secondary)]">
                        {logosZipResult.missingLogos.slice(0, 5).map((id) => (
                          <li key={id}>{id}</li>
                        ))}
                        {logosZipResult.missingLogos.length > 5 && (
                          <li>...and {logosZipResult.missingLogos.length - 5} more</li>
                        )}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className="studio-panel p-6">
              <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">Tournament Bundle</h2>
              <p className="mt-2 text-xs text-[var(--text-secondary)]">
                Import or export a complete tournament as a ZIP bundle including config and all assets.
              </p>
              <div className="mt-4 rounded-xl border border-dashed border-[var(--border-light)] bg-[var(--bg-muted)] p-4">
                <p className="text-xs text-[var(--text-tertiary)] mb-2">Bundle structure:</p>
                <pre className="text-xs text-[var(--text-secondary)] font-mono">
{`tournament.zip
├── config.json          (required)
├── tournament-logo.png  (optional)
├── org-logo.png         (optional)
└── teams/               (optional)
    ├── team-id-1.png
    └── ...`}
                </pre>
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={async () => {
                    const res = await fetch(api(`/admin/tournaments/${activeTournamentId}/bundle`), {
                      headers: authOnlyHeaders,
                    })
                    if (!res.ok) return
                    const blob = await res.blob()
                    const url = URL.createObjectURL(blob)
                    const link = document.createElement('a')
                    link.href = url
                    link.download = `${activeTournamentId}-bundle.zip`
                    link.click()
                    URL.revokeObjectURL(url)
                  }}
                  className="studio-btn studio-btn-secondary"
                >
                  Export Bundle
                </button>
              </div>
              <div className="mt-4 border-t border-[var(--border-light)] pt-4">
                <p className="text-xs text-[var(--text-tertiary)] mb-2">Import a new tournament:</p>
                <input
                  type="file"
                  accept=".zip"
                  className="text-xs text-[var(--text-primary)]"
                  onChange={(event) => {
                    setBundleFile(event.target.files?.[0] ?? null)
                    setBundleResult(null)
                  }}
                />
                <button
                  type="button"
                  onClick={() => bundleImportMutation.mutate()}
                  disabled={!bundleFile || bundleImportMutation.isPending}
                  className="studio-btn studio-btn-primary mt-3"
                >
                  {bundleImportMutation.isPending ? 'Importing...' : 'Import Bundle'}
                </button>
                {bundleImportMutation.isError && (
                  <p className="mt-2 text-xs text-[var(--accent-error)]">
                    {bundleImportMutation.error instanceof Error ? bundleImportMutation.error.message : 'Import failed'}
                  </p>
                )}
                {bundleResult && (
                  <div className="mt-4 space-y-2 text-xs">
                    <p className="text-[var(--accent-success)]">
                      Imported tournament: {bundleResult.tournament.name}
                    </p>
                    <p className="text-[var(--text-secondary)]">
                      Assets uploaded: {bundleResult.results.assetsUploaded.length}
                    </p>
                    {bundleResult.results.assetsSkipped.length > 0 && (
                      <p className="text-[var(--accent-warning)]">
                        Skipped: {bundleResult.results.assetsSkipped.join(', ')}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
