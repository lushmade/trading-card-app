import type { CardType, TemplateDefinition, TournamentConfig } from "./types"

export const DEFAULT_TEMPLATE_ID = "classic"

export const resolveTemplateId = (
  input: { templateId?: string | null; cardType?: CardType },
  config?: TournamentConfig | null
) => {
  const direct = typeof input.templateId === "string" ? input.templateId.trim() : ""
  if (direct) return direct

  const cardType = input.cardType
  const byType = cardType ? config?.defaultTemplates?.byCardType?.[cardType] : undefined
  if (byType) return byType

  const fallback = config?.defaultTemplates?.fallback
  if (fallback) return fallback

  return DEFAULT_TEMPLATE_ID
}

export const findTemplate = (
  config: TournamentConfig | null | undefined,
  templateId: string | null | undefined
): TemplateDefinition | null => {
  if (!config?.templates || !templateId) return null
  return config.templates.find((template) => template.id === templateId) ?? null
}
