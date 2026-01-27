export type ApiResponse = {
  message: string;
  success: boolean;
};

export type CardType =
  | "player"
  | "team-staff"
  | "media"
  | "official"
  | "tournament-staff"
  | "rare"
  | "super-rare"
  | "national-team";

export type CardRarity = "common" | "uncommon" | "rare" | "super-rare";

export type CardStatus = "draft" | "submitted" | "rendered";

export type TemplateTheme = {
  gradientStart: string;
  gradientEnd: string;
  border: string;
  accent: string;
  label: string;
  nameColor: string;
  meta: string;
  watermark: string;
};

export type TemplateFlags = {
  showGradient: boolean;
  showBorders: boolean;
  showWatermarkJersey: boolean;
};

export type TemplateDefinition = {
  id: string;
  label: string;
  overlayKey?: string;
  theme?: Partial<TemplateTheme>;
  flags?: Partial<TemplateFlags>;
  overlayPlacement?: "belowText" | "aboveText";
};

export type TemplateDefaults = {
  fallback: string;
  byCardType?: Partial<Record<CardType, string>>;
};

export type RenderMeta = {
  key: string;
  templateId: string;
  renderedAt: string;
  templateSnapshot: {
    overlayKey?: string;
    theme: TemplateTheme;
    flags: TemplateFlags;
    overlayPlacement: "belowText" | "aboveText";
  };
};

export type CropRect = {
  x: number;
  y: number;
  w: number;
  h: number;
  rotateDeg: 0 | 90 | 180 | 270;
};

export type CardPhoto = {
  originalKey?: string;
  width?: number;
  height?: number;
  crop?: CropRect;
  cropKey?: string;
};

export type CardBase = {
  id: string;
  editToken?: string;
  tournamentId: string;
  cardType: CardType;
  rarity?: CardRarity;
  templateId?: string;
  status: CardStatus;
  photographer?: string;
  photo?: CardPhoto;
  renderKey?: string;
  renderMeta?: RenderMeta;
  createdAt: string;
  updatedAt: string;
  statusCreatedAt?: string;
};

export type StandardCard = CardBase & {
  cardType: Exclude<CardType, "rare" | "super-rare">;
  firstName?: string;
  lastName?: string;
  teamId?: string;
  teamName?: string;
  position?: string;
  jerseyNumber?: string;
};

export type RareCard = CardBase & {
  cardType: "rare" | "super-rare";
  title?: string;
  caption?: string;
  // Super-rare can optionally include player info for the centered name style
  firstName?: string;
  lastName?: string;
  // Super-rare also shows position and jersey number
  teamId?: string;
  teamName?: string;
  position?: string;
  jerseyNumber?: string;
};

export type Card = StandardCard | RareCard;

export type TournamentListEntry = {
  id: string;
  name: string;
  year: number;
  published?: boolean;
};

export type TournamentConfig = {
  id: string;
  name: string;
  year: number;
  branding: {
    tournamentLogoKey: string;
    orgLogoKey?: string;
    primaryColor?: string;
    eventIndicator?: string;
  };
  teams: Array<{
    id: string;
    name: string;
    logoKey: string;
  }>;
  cardTypes: Array<{
    type: CardType;
    enabled: boolean;
    label: string;
    showTeamField: boolean;
    showJerseyNumber: boolean;
    positions?: string[];
    logoOverrideKey?: string;
  }>;
  templates?: TemplateDefinition[];
  defaultTemplates?: TemplateDefaults;
  createdAt: string;
  updatedAt: string;
};

export type CardDesign = Card;
