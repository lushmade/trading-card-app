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

export type LayoutColorPalette = {
  primary: string;
  secondary: string;
  white: string;
  numberOverlay: string;
};

export type LayoutTypography = {
  fontFamily: string;
};

export type Usqc26LayoutV1 = {
  kind: "usqc26-v1";
  palette: LayoutColorPalette;
  typography: LayoutTypography;
  frame: {
    outerRadius: number;
    innerX: number;
    innerY: number;
    innerWidth: number;
    innerHeight: number;
    innerRadius: number;
  };
  name: {
    rotation: number;
    maxWidth: number;
    firstNameBox: {
      width: number;
      height: number;
      borderWidth: number;
      strokeWidth: number;
    };
    lastNameBox: {
      width: number;
      height: number;
      borderWidth: number;
      strokeWidth: number;
    };
    anchorX: number;
    anchorY: number;
    firstNameSize: number;
    lastNameSize: number;
    letterSpacing: {
      firstName: number;
      lastName: number;
    };
    leftPadding: number;
    rightPadding: number;
    boxExtension: number;
    textYOffset: number;
    boxOffsets: {
      firstName: number;
      lastName: number;
    };
    textOffsets: {
      firstName: number;
      lastName: number;
    };
  };
  eventBadge: {
    x: number;
    y: number;
    width: number;
    height: number;
    borderRadius: number;
    borderWidth: number;
    fontSize: number;
    textYOffset: number;
  };
  positionNumber: {
    centerX: number;
    topY: number;
    positionFontSize: number;
    numberFontSize: number;
    positionLetterSpacing: number;
    numberLetterSpacing: number;
    positionStrokeWidth: number;
    numberStrokeWidth: number;
    numberXOffset: number;
  };
  teamLogo: {
    x: number;
    y: number;
    maxWidth: number;
    maxHeight: number;
    strokeWidth: number;
    strokeColor: string;
  };
  bottomBar: {
    y: number;
    height: number;
    textYOffset: number;
    cameraIcon: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    photographerX: number;
    rarityX: number;
    raritySize: number;
    rarityGap: number;
    teamNameX: number;
    fontSize: number;
    letterSpacing: {
      photographer: number;
      teamName: number;
    };
  };
  rareCard: {
    rotation: number;
    anchorX: number;
    anchorY: number;
    maxWidth: number;
    titleTextOffsetX: number;
    captionTextOffsetX: number;
    titleLetterSpacing: number;
    captionLetterSpacing: number;
  };
  superRare: {
    centerX: number;
    firstNameY: number;
    lastNameY: number;
    firstNameSize: number;
    lastNameSize: number;
  };
  nationalTeam: {
    rotation: number;
    anchorX: number;
    anchorY: number;
    boxWidth: number;
    boxHeight: number;
    boxBorderWidth: number;
    textPaddingX: number;
    nameFontSize: number;
    logo: {
      x: number;
      y: number;
      maxWidth: number;
      maxHeight: number;
    };
  };
  headerBar?: {
    height: number;
    color: string;
    fontSize: number;
    fontStyle: string;
    textColor: string;
    textY: number;
    paddingX: number;
    /** Size of diagonal notch at bottom corners (0 = rectangle, >0 = trapezoid) */
    notchSize?: number;
  };
  footerBar?: {
    y: number;
    height: number;
    color: string;
    fontSize: number;
    fontStyle: string;
    textColor: string;
    textY: number;
    paddingX: number;
    /** Size of diagonal notch at top corners (0 = rectangle, >0 = inverted trapezoid) */
    notchSize?: number;
  };
  positionStripes?: {
    x: number;
    width: number;
    topY: number;
    bottomY: number;
    gap: number;
    mapping: Array<{ position: string; color: string }>;
  } | {
    style: 'diagonal';
    stripeWidth: number;
    stripeGap: number;
    /** How far inward (horizontally) the stripes extend from the card edge */
    inset: number;
    /** Y coordinate of the top edge of the stripe zone (usually aligns with footer bar top) */
    topY: number;
    /** Fixed stripe colors from outermost to innermost */
    colors: string[];
    mapping: Array<{ position: string; color: string }>;
  };
  photographerCredit?: {
    x: number;
    y: number;
    fontSize: number;
    fontStyle?: string;
    color: string;
    textAlign: 'left' | 'right' | 'center';
  };
  cardBorder?: {
    width: number;
    color: string;
  };
};

export type TemplateLayout = Usqc26LayoutV1;

export type TemplateLayoutOverride =
  | ({ kind: "usqc26-v1" } & Partial<Omit<Usqc26LayoutV1, "kind">>);

export type TemplateDefinition = {
  id: string;
  label: string;
  overlayKey?: string;
  theme?: Partial<TemplateTheme>;
  flags?: Partial<TemplateFlags>;
  overlayPlacement?: "belowText" | "aboveText";
  layout?: TemplateLayoutOverride;
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
    layout: TemplateLayout;
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

export type ReviewStatus = 'new' | 'approved' | 'rejected' | 'duplicate' | 'need-sr' | 'fix-required' | 'done';

export type CardBase = {
  id: string;
  editToken?: string;
  tournamentId: string;
  cardType: CardType;
  rarity?: CardRarity;
  templateId?: string;
  status: CardStatus;
  reviewStatus?: ReviewStatus;
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
    defaultTeamName?: string;
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
    positionMultiSelect?: boolean;
    maxPositions?: number;
    showPositionField?: boolean;
    showPositionStripes?: boolean;
    teamFieldMode?: 'dropdown' | 'freetext';
    teamFieldLabel?: string;
    teamFieldDefault?: string;
    teamFieldMaxLength?: number;
  }>;
  templates?: TemplateDefinition[];
  defaultTemplates?: TemplateDefaults;
  createdAt: string;
  updatedAt: string;
};

export type CardDesign = Card;

export type FeedbackLogEntry = {
  at: string;
  event: string;
  data?: Record<string, unknown>;
};

export type FeedbackContext = {
  sessionId: string;
  url: string;
  path: string;
  app: {
    env: string;
    basePath?: string;
    apiBase?: string;
  };
  device: {
    userAgent: string;
    platform?: string;
    language?: string;
    languages?: readonly string[];
    timezone?: string;
    screen?: {
      width: number;
      height: number;
      pixelRatio: number;
    };
    viewport?: {
      width: number;
      height: number;
    };
    online?: boolean;
    deviceMemory?: number;
    hardwareConcurrency?: number;
  };
  draft?: {
    cardId?: string;
    tournamentId?: string;
    cardType?: string;
    hasPhoto?: boolean;
    savedAt?: string;
  };
  logs?: FeedbackLogEntry[];
};

export type FeedbackPayload = {
  message: string;
  context?: FeedbackContext;
};

export type FeedbackResponse = {
  success: true;
};
