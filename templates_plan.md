# Templates & Print Guides Implementation Plan

## Summary

Add print guides in crop UI, templates as first-class objects with overlay PNGs, and post-submission admin re-rendering.

**Key decisions confirmed:**
- Overlays drawn below text by default
- Cropped images are derived (canonical: `originalKey` + `cropRect`)
- **Remove cropKey upload entirely** (breaking change)
- JSON-only template editing for v1
- **Guides default ON** when user first opens crop
- **Start with Phase 1 + 2 in parallel**

---

## Phase 1: Print Guides (Visual Only)

### Files to modify:
- `shared/src/constants.ts` — add guide constants
- `client/src/components/CropGuides.tsx` — new component
- `client/src/App.tsx` — integrate guides overlay + toggle

### Changes:
1. Add constants: `TRIM_INSET_PX = 37.5`, `SAFE_INSET_PX = 75`, percentage-based guide positions
2. Create `CropGuides` component with toggleable Trim (red solid) and Safe (blue dashed) overlays
3. Position absolutely inside crop container, uses CSS percentages for responsiveness
4. Add toggle button near Zoom/Reset controls
5. **Default state: ON** — guides visible when user first opens crop

### Constants to add:
```typescript
// Print geometry at 300 DPI
export const BLEED_W = 825;
export const BLEED_H = 1125;

// 1/8" at 300dpi = 37.5px
export const TRIM_INSET_PX = 37.5;
export const SAFE_INSET_PX = 75; // 2 × 37.5

export const TRIM_BOX = { x: 37.5, y: 37.5, w: 750, h: 1050 };
export const SAFE_BOX = { x: 75, y: 75, w: 675, h: 975 };

// Percentages for responsive overlay
export const GUIDE_PERCENTAGES = {
  trim: { left: 4.545, top: 3.333, right: 4.545, bottom: 3.333 },
  safe: { left: 9.091, top: 6.667, right: 9.091, bottom: 6.667 },
};
```

---

## Phase 2: Template Types + Rendering

### Files to modify:
- `shared/src/types/index.ts` — add `TemplateDefinition`, `TemplateDefaults`, `RenderMeta`; extend `TournamentConfig`, `CardBase`
- `shared/src/templates.ts` — new file with `resolveTemplateId()`, `findTemplate()`
- `shared/src/tournaments/usqc-2025.ts` — add `templates` array + `defaultTemplates`
- `client/src/renderCard.ts` — refactor to use template resolution, add overlay loading
- `client/src/App.tsx` — dynamic template dropdown from config

### New types:
```typescript
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

export type TemplateDefinition = {
  id: string;           // stable identifier (lowercase alphanum + hyphen)
  label: string;        // UI display name
  overlayKey?: string;  // S3 key under config/tournaments/.../overlays/...
  theme?: Partial<TemplateTheme>;
  flags?: Partial<{
    showGradient: boolean;
    showBorders: boolean;
    showWatermarkJersey: boolean;
  }>;
  overlayPlacement?: 'belowText' | 'aboveText'; // default: belowText
};

export type TemplateDefaults = {
  fallback: string;
  byCardType?: Partial<Record<CardType, string>>;
};

export type RenderMeta = {
  key: string;
  templateId: string;
  renderedAt: string;
  // Store fully resolved template at render time for reproducibility
  templateSnapshot: {
    overlayKey?: string;
    theme: TemplateTheme;  // fully merged theme (base + overrides)
    flags: {
      showGradient: boolean;
      showBorders: boolean;
      showWatermarkJersey: boolean;
    };
    overlayPlacement: 'belowText' | 'aboveText';
  };
};
```

### Template resolution logic:
```typescript
effectiveTemplateId = card.templateId ?? config.defaultTemplates?.byCardType?.[card.cardType] ?? config.defaultTemplates?.fallback ?? 'classic'
```

### Overlay rendering order (draw overlay exactly once):
1. Draw cropped photo
2. Draw gradient (if `showGradient !== false`)
3. Draw borders (if `showBorders !== false`)
4. If `overlayPlacement !== 'aboveText'`: **draw overlay PNG**
5. Draw text + logos
6. If `overlayPlacement === 'aboveText'`: **draw overlay PNG**

> **Important:** Overlay is drawn exactly once, not twice. Drawing twice would compound alpha, darken colors, and create hard-to-debug visual differences.

---

## Phase 3: Decouple Submit from Render

### Files to modify:
- `server/src/index.ts` — POST /cards/:id/submit endpoint (lines 1559-1586)
- `client/src/App.tsx` — submit flow

### Server changes:
- Remove required renderKey validation (lines 1559-1562)
- Make renderKey optional: if provided, validate + store; if not, skip
- Still validate canonical requirements (photo, crop, required fields)

### Client changes:
- Submit with `{}` instead of requiring render upload
- Keep live preview for user feedback

### cropKey deprecation (not a hard break):
**Do now:**
- Stop uploading `cropKey` (remove `uploadCrop()` calls in App.tsx)
- Stop relying on it anywhere — always use `originalKey + cropRect`
- Keep `cropKey` field in types (tolerate if present, ignore it)

**Do later (optional cleanup):**
- Remove `cropKey` from types/API once confident nothing reads it
- Optionally delete old S3 objects via lifecycle rule

> This avoids breaking existing cards in DynamoDB that have `cropKey` populated.

---

## Phase 4: Admin Re-Render Tooling

### Files to modify:
- `server/src/index.ts` — add 3 new admin endpoints
- `client/src/Admin.tsx` — add template override + render button

### New endpoints (split for safety):
1. `GET /admin/cards/:id/photo-url` — presigned GET for original photo
2. `POST /admin/cards/:id/renders/presign` — presigned POST for render upload (no editToken required)
3. `PATCH /admin/cards/:id` — set **only** `templateId` (or null to clear override)
4. `POST /admin/cards/:id/renders/commit` — set `renderKey` + `renderMeta` after S3 HeadObject validation

> Splitting mutation gives cleaner validation paths and prevents accidental overwrites. Render commits always verify the uploaded object exists before writing.

### Admin UI additions:
- Per-card template override dropdown (config templates + "Use defaults")
  - Show "Default (Classic)" when `card.templateId` is null to make it obvious
- "Render" button workflow:
  1. `GET /admin/cards/:id/photo-url`
  2. Resolve effective templateId + build full template snapshot
  3. Call `renderCard()` with originalUrl + resolved template
  4. `POST /admin/cards/:id/renders/presign`
  5. Upload PNG to S3
  6. `POST /admin/cards/:id/renders/commit` with `{ renderKey, renderMeta }`

### Performance: Overlay image caching
Add in-memory cache for overlay loads in `renderCard.ts`:
```typescript
const overlayCache = new Map<string, Promise<HTMLImageElement>>();
```
Prevents repeated fetches when admin re-renders multiple cards with same template.

---

## Phase 5: Overlay Uploads

### Files to modify:
- `server/src/index.ts` — extend assets/presign with `kind: 'templateOverlay'`
- `client/src/Admin.tsx` — overlay upload UI + copy key button

### Key pattern:
`config/tournaments/{id}/overlays/{templateId}/{uploadId}.png`

Immutable keys ensure reproducibility.

---

## Phase 6: Template Admin UI

### Files to modify:
- `client/src/Admin.tsx` — add dedicated template management section
- `client/src/components/TemplateEditor.tsx` — new component
- `client/src/components/TemplatePreview.tsx` — new component

### Features:

**Template List View**
- Visual grid of templates with overlay thumbnail previews
- Shows template id, label, and active status
- Add/Edit/Delete actions
- Drag-drop reordering (optional)

**Template Edit Form**
- `id` (readonly after creation, validated as safe-id)
- `label` (text input)
- `overlayKey` (drag-drop upload zone + current preview thumbnail)
- Theme colors (color pickers for all 8 theme properties)
- Flags (toggle switches for showGradient, showBorders, showWatermarkJersey)
- `overlayPlacement` (segmented control: Below Text / Above Text)

**Live Preview Panel**
- Real-time card preview using `renderCard()` with sample data
- Updates instantly as admin changes theme colors, flags, or overlay
- Toggle between card types (player, rare, etc.) to preview each

**Default Assignment Matrix**
- Table: rows = CardType, columns = Template dropdown
- Visual indicator for which templates are used as defaults
- Fallback template selector at top

**Workflow**
1. Admin creates new template or selects existing
2. Uploads overlay via drag-drop (immutable key generated)
3. Adjusts theme colors with pickers, sees live preview
4. Toggles flags, sees immediate effect
5. Saves → auto-updates tournament config draft
6. Sets defaults in assignment matrix
7. Publishes when ready

**UI/UX Notes**
- Use same design language as existing Admin.tsx (slate colors, subtle borders)
- Color pickers should show current value + allow hex input
- Overlay upload shows progress, validates 825x1125 dimensions (warning if not)
- Preview panel is sticky/fixed so it's always visible while editing
- Unsaved changes indicator with save/discard buttons

---

## Implementation Order

### V1 Scope (Phases 1-5)
| Phase | Scope | Independent |
|-------|-------|-------------|
| 1 | Print guides | Yes |
| 2 | Template types + rendering | Yes |
| 3 | Decouple submit | Depends on Phase 2 types |
| 4 | Admin re-render | Depends on Phase 2-3 |
| 5 | Overlay uploads | Depends on Phase 4 |

**Phases 1 and 2 will be done in parallel.** Phases 3-5 are sequential after that.

### V2 Scope (Phase 6)
| Phase | Scope | Independent |
|-------|-------|-------------|
| 6 | Template admin UI | Depends on Phase 5 |

> V1 = functional system with JSON-based template editing. V2 = polished admin UI with color pickers, live preview, etc.

---

## Key Files Summary

| File | Phase | Changes |
|------|-------|---------|
| `shared/src/constants.ts` | 1 | Guide constants |
| `shared/src/types/index.ts` | 2 | Template types, extend TournamentConfig/CardBase |
| `shared/src/templates.ts` | 2 | New: resolution functions |
| `shared/src/tournaments/usqc-2025.ts` | 2 | Add templates + defaults |
| `client/src/components/CropGuides.tsx` | 1 | New: guide overlay component |
| `client/src/App.tsx` | 1,2,3 | Guides, dynamic selector, submit flow |
| `client/src/renderCard.ts` | 2 | Template resolution, overlay loading |
| `server/src/index.ts` | 3,4,5 | Submit changes, 4 admin endpoints (photo-url, presign, patch, commit) |
| `client/src/Admin.tsx` | 4,5,6 | Override dropdown, render button, template section |
| `client/src/components/TemplateEditor.tsx` | 6 | New: template edit form with color pickers |
| `client/src/components/TemplatePreview.tsx` | 6 | New: live preview panel |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| CORS + Canvas tainting | S3 already configured for CORS; ensure `img.crossOrigin = "anonymous"` before setting src |
| Template ID collisions | Use same safe ID rules as tournament/team (lowercase alphanum + hyphen) |
| Overlay dimension mismatch | Console.warn if not 825×1125; still render (scale to fit) |
| Bulk rendering performance | Browser-based is fine for low traffic; add overlay cache; server-side renderer if needed later |
| Fractional pixel guides (37.5px) | Expected to look slightly soft on responsive divs; use 2px stroke to reduce perceived blur |
| Template reproducibility | Store full `templateSnapshot` in RenderMeta so prior renders can be recreated even if config changes |
