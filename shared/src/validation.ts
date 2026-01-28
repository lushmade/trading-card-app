export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024

export const ALLOWED_UPLOAD_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

export const ALLOWED_RENDER_TYPES = ['image/png'] as const

export const MAX_NAME_LENGTH = 50
export const MAX_TITLE_LENGTH = 48
export const MAX_CAPTION_LENGTH = 120
export const MAX_PHOTOGRAPHER_LENGTH = 48
export const MAX_TEAM_LENGTH = 64
export const MAX_POSITION_LENGTH = 32
export const MAX_JERSEY_LENGTH = 2

export const JERSEY_PATTERN = /^\d{1,2}$/
