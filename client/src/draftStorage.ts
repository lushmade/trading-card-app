/**
 * localStorage persistence for card drafts.
 * Stores cardId, editToken, and form data so users can resume after refresh.
 */

const STORAGE_KEY = 'trading-card-draft'

export type SavedDraft = {
  cardId: string
  editToken: string
  tournamentId: string
  cardType: string
  form: {
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
  photo?: {
    key: string
    width: number
    height: number
    crop?: {
      x: number
      y: number
      w: number
      h: number
      rotateDeg: 0 | 90 | 180 | 270
    }
  }
  savedAt: string
}

export function saveDraft(draft: SavedDraft): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft))
  } catch {
    // localStorage might be full or disabled - fail silently
  }
}

export function loadDraft(): SavedDraft | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return null

    const draft = JSON.parse(stored) as SavedDraft

    // Basic validation
    if (!draft.cardId || !draft.editToken || !draft.tournamentId) {
      clearDraft()
      return null
    }

    return draft
  } catch {
    clearDraft()
    return null
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // fail silently
  }
}
