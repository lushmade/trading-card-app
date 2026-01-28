// Shared API utilities for client-side requests.

// Base path for subpath deployments (e.g., /trading-cards)
const BASE_PATH = import.meta.env.VITE_BASE_PATH ?? '';

const API_BASE =
  import.meta.env.DEV && import.meta.env.VITE_API_URL
    ? import.meta.env.VITE_API_URL.replace(/\/$/, '')
    : `${BASE_PATH}/api`

const MEDIA_BASE =
  import.meta.env.DEV && import.meta.env.VITE_ROUTER_URL
    ? import.meta.env.VITE_ROUTER_URL.replace(/\/$/, '')
    : BASE_PATH

export const api = (path: string) => `${API_BASE}${path}`
export const media = (path: string) => `${MEDIA_BASE}${path}`
export const writeHeaders: HeadersInit = {}

export const publicPathForKey = (key: string) => {
  if (key.startsWith('renders/')) return `/r/${key.slice('renders/'.length)}`
  if (key.startsWith('config/')) return `/c/${key.slice('config/'.length)}`
  return `/${key}`
}

export const assetUrlForKey = (key: string) => media(publicPathForKey(key))
