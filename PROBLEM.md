# Trading Card Builder: Print Guides + Template Rendering

## Terminology
- Bleed canvas: Full print file delivered to printer (825x1125 px).
- Trim line: Intended cut line; keep critical content inside the safe zone due to cut tolerance.
- Safe zone: Inner area for critical text and logos.
- Template (Design): Render recipe (layout + optional overlay asset + theme params).
- Overlay asset: PNG frame art referenced by a template (not a first-class entity yet).

## User Requirements (Session Notes)
- Support multiple designs and allow toggling between them.
- Admins can upload and change overlays after submissions; they can mix and match saved images with different overlays and download renders later.
- `download.jpeg` is design inspiration (multiple possible designs), not a UI requirement for tilted previews.
- Crop guides like `crops.jpeg` (safe/trim/bleed) are visual only; they do not constrain the crop.
- Crop always fills the full bleed canvas; guides are for alignment and safety only.
- Trim line is the intended cut; printers have tolerance, so keep critical elements inside the safe zone.
- The print file must be exactly 825x1125 pixels (full bleed).
- Trim line target is 64x89 mm (roughly 2.5x3.5 inches).
- Blue dotted line is guidance only; pushing beyond the safe zone has been acceptable.
- Users often create designs in Canva or Photoshop.
- Do not lock in a single render at submission time; allow re-rendering with newer templates.

## Crop Behavior and Guides
- Guides are toggleable overlays (safe/trim/bleed) only.
- Stored crop values always map to the full 825x1125 bleed canvas.
- Guides should not prevent the user from cropping outside the safe zone.

## Print Geometry (Exact 1/8" Bleed)
Assuming 825x1125 px equals 2.75x3.75 inches at 300 DPI:
- Bleed (full file): 825x1125 px.
- Trim line: inset 1/8" (37.5 px) from each edge.
  - Trim box: x=37.5, y=37.5, w=750, h=1050.
  - This equals 2.5x3.5 inches (63.5x88.9 mm), approximately 64x89 mm as quoted.
- Safe zone: inset another 1/8" inside trim.
  - Safe box: x=75, y=75, w=675, h=975.
- Bleed zone ring: the 37.5 px band between the trim line and the full 825x1125 canvas.

## Design Model (Template vs Overlay)
- Treat Template (Design) as the first-class object.
- Overlay is just an asset referenced by the template.
- Template can start minimal: overlay PNG + theme overrides + existing layout rules.
- More complex layout rules can be added later if needed.

## Design Selection Rules (Default + Override)
At render time:
- effectiveTemplateId = card.templateId ?? config.defaultTemplates.byCardType[card.cardType] ?? config.defaultTemplates.fallback
- card.templateId is an optional override, not a locked-in selection at submission time.
- Defaults live in TournamentConfig so admins can change them post-submission.

## Versioning and Reproducibility
- Overlay assets should be immutable (unique keys per upload).
- Updating a design should create a new template id or versioned overlay key, then update defaults.
- Store render metadata (template id used) so prior print runs can be reproduced.

## Canonical vs Derived Data
- Canonical: original upload, crop data, card fields, template selection (override), tournament templates.
- Derived: cropped image and rendered PNGs; these can be regenerated with the effective template.

## Current Behavior (Repo Findings)
- Monorepo with `client/` (React + Vite + TanStack), `server/` (Hono API on Lambda), `shared/` types.
- Card size constants are fixed at 825x1125 in `shared/src/constants.ts`.
- Crop data uses normalized 0-1 values (`CropRect`) stored on the card; rotation exists in type but rotation is disabled in UI.
- `client/src/App.tsx` uses `react-easy-crop` to capture a single crop rectangle and uploads:
  - Original image to S3 (`uploads/original/<cardId>/<uploadId>.<ext>`).
  - Optional cropped image to S3 (`uploads/crop/<cardId>/<uploadId>.<ext>`).
- `client/src/renderCard.ts` renders the final 825x1125 PNG client-side, then uploads it to S3 (`renders/<cardId>/<renderId>.png`).
- `templateId` currently switches between two built-in themes (`classic` and `noir`) inside `renderCard.ts`; there is no design spec or overlay support yet.
- Admin UI (`client/src/Admin.tsx`) can edit tournament config JSON, upload team logos, import/export bundles, and download renders via `renderKey`.
- Server (`server/src/index.ts`) stores `renderKey` on submit. Presigned uploads for renders require draft status and edit tokens, so admins cannot re-render submitted cards.

## Gaps to Address
- Add template definitions to TournamentConfig (including overlay references and defaults).
- Add admin uploads for overlay assets and template specs, plus immutable asset keys.
- Implement guide overlays in the crop UI (safe/trim/bleed).
- Update render flow to support post-submission rendering with effective templates.
- Provide an admin render upload path for submitted cards or a server-side renderer.

## Reference Assets Mentioned
- `~/Downloads/download.jpeg` (design inspiration for multiple templates).
- `~/Downloads/crops.jpeg` (safe zone / trim line / bleed zone guide).
- `~/dev/usqc2025` reference app (trim line toggle).
