# Trading Card App Plan (Vite + Hono + SST + pnpm)

## Goals
- Provide a public trading-card builder with drag-and-drop crop (no sliders).
- Upload original photo (normalized), crop metadata (and optional cropped derivative), form responses, and final rendered card image.
- Eliminate CORS/black-download issues by serving web + uploads + renders from the same CloudFront domain.
- Keep the stack simple, maintainable, and easy to reskin yearly.

## Current Baseline
- Repo scaffolded from `bun create bhvr@latest` (client/server/shared + Turbo) and converted to pnpm.
- `sst.config.ts` is wired with Router + S3 bucket + Dynamo table + Lambda URL + StaticSite, and Lambda entrypoint is implemented in `server/src/lambda.ts`.
- Server: Hono API with presign + cards CRUD + submit endpoints; uses AWS SDK + `sst` Resource for S3/Dynamo; dev server on port 3000.
- Client: Vite + React with TanStack Router/Query + Tailwind; builder UI with `react-easy-crop`; env vars for API/Router URLs.
- Shared types include `CardDesign`/`CropRect` and related metadata.

## Completed Work

### Phase 0: Infra Skeleton ✅
- Lambda entrypoint (`hono/aws-lambda`)
- Vite + TanStack Router + Query wiring
- SST Router + S3 bucket + DynamoDB + Lambda URL + StaticSite

### Phase 1: Card Builder UI ✅
- Form with all card fields (type, team, position, jersey, name, photo credit)
- Crop UI with `react-easy-crop` (drag-to-pan, scroll-to-zoom)
- Live preview with player name, position/team, crop dimensions
- Zoom In/Out, Rotate 90°, Reset controls

### Phase 2: AWS Uploads ✅
- Presigned upload API (`POST /api/uploads/presign`)
- Client uploads original photo to S3 on draft create
- Versioned S3 keys (`uploads/original/<cardId>/<uploadId>.<ext>`)
- Photo dimensions stored in card record
- CORS configured on Lambda Function URL and S3 bucket

### Phase 3: Submission Pipeline ✅
- Canvas render (`renderCard.ts`) - 825x1125 full-bleed card
- Image covers entire card with gradient overlay at bottom
- Text overlaid on image (name, position/team, jersey number, photo credit)
- Presigned upload for renders (`renders/<cardId>/<renderId>.png`)
- Submit endpoint stores `renderKey` and sets `status=submitted`
- Download PNG link displayed after submission

### Dev Workflow ✅
- Two terminals: `AWS_PROFILE=prod npx sst dev` + `cd client && pnpm dev`
- Environment variables in `client/.env.development` (VITE_API_URL, VITE_ROUTER_URL)
- Frontend calls Lambda URL directly in dev (CORS enabled)
- Media URLs use Router URL in dev (S3 via CloudFront)

### Security ✅
- PATCH endpoint cannot set `status` or `renderKey` (server-controlled)
- Presigned uploads with content-type + size validation (POST policy)
- Max upload size: 15MB
- Allowed types: JPEG, PNG, WebP (renders must be PNG)

### API/Server Hardening ✅
- Presign requires card exists - Verifies card ID before issuing presigned URL
- Submit requires renderKey - Rejects if `renderKey` missing or doesn't match `renders/${id}/...png`
- Enforce status transitions - Only allows `draft → submitted` (idempotent submit)
- Conditional submit write - Uses DynamoDB condition on `status = draft`
- Validate upload keys belong to card - Reject cross-card key updates
- Presigned POST upload policy - Enforces size/type via POST conditions
- Server-side crop validation - Clamps crop values to valid ranges

### Developer Experience ✅
- Pre-commit hooks with husky + lint-staged
- ESLint configured for all packages (client, server, shared)
- Type checking runs on every commit
- Root eslint.config.js for monorepo-wide linting

## Known Issues (Fixed)

### 1. Crop Values Are Wrong ✅ FIXED
**File:** `client/src/App.tsx:413`

Fixed `handleCropComplete` to use 1st argument (percentages) instead of 2nd (pixels), with clamping to 0-1 range.

### 2. Cropper Aspect Ratio Doesn't Match Render ✅ FIXED
**Files:** `shared/src/constants.ts`, `client/src/App.tsx`, `client/src/renderCard.ts`

Created shared constants (`CARD_WIDTH`, `CARD_HEIGHT`, `CARD_ASPECT`) and updated both cropper and render to use them. Container aspect ratio also updated from `aspect-[3/4]` to `aspect-[825/1125]`.

### 3. Rotation Rendering Is Broken for 90°/270° ✅ DISABLED FOR V1
**File:** `client/src/App.tsx`

Rotation UI controls removed and rotation hardcoded to 0. Rotation math needs proper safe-area implementation - deferred to future version.

### 4. Production URLs Bypass Router (Same-Origin Broken) ✅ FIXED
**File:** `client/src/App.tsx:7-17`

Now gates on `import.meta.env.DEV` so production uses relative `/api` and media paths, ensuring same-origin routing via CloudFront Router.

### 5. S3 CORS Missing Production Origin ✅ FIXED
**File:** `sst.config.ts:20`

Changed to `allowOrigins: ["*"]` since bucket is private and only accessible via short-lived presigned URLs.

### 6. Canvas letterSpacing breaks TS builds ✅ FIXED
**File:** `client/src/renderCard.ts`

Replaced `ctx.letterSpacing` with a manual letter-spacing helper.

### 7. type-check hook was a no-op ✅ FIXED
**Files:** `client/package.json`, `server/package.json`, `shared/package.json`

Added per-package `type-check` scripts so Turbo runs TypeScript checks.

### 8. Submit enabled without crop ✅ FIXED
**File:** `client/src/App.tsx`

Submit now requires required fields, a photo, and a valid crop; inline validation added.

---

## Next Steps (Phase 4+)

### Hardening
- [ ] Error handling - Better error messages, retry logic for failed uploads
- [x] Basic form validation - Required fields + file size/type checks
- [ ] Form validation - Jersey number format, name length limits
- [ ] Loading states - Skeleton loaders, progress indicators during render
- [x] S3 lifecycle rules - Auto-delete orphaned uploads after 14 days
- [x] Submit requires complete card - Client gating for photo + crop (auto-saves on submit)
- [ ] Server-side submit completeness validation - Enforce `photo.originalKey` + dimensions + crop before allowing submit
- [x] Presigned POST for strict size enforcement - Enforces size/type via POST policy
- [x] Validate upload keys belong to card - Reject cross-card key updates
- [x] Conditional submit writes - Idempotent submit with DynamoDB condition

### Code Cleanup
- [x] Merge duplicate presign functions - `requestPresignFor` now handles File/Blob
- [x] Align naming - `teamName` replaces `teamId`
- [x] Keep cropper on local URL - Avoids CORS flicker mid-session
- [x] Disable Submit unless crop exists - Gated on required fields, photo, and crop
- [x] Font loading for canvas - Uses `document.fonts.ready` before render
- [x] Canvas image quality - `imageSmoothingEnabled` + `imageSmoothingQuality = 'high'`
- [x] Handle long names - Shrink-to-fit text sizing in render

### UX Upgrades
- [ ] Photo upload prominence - Larger drop zone, drag-and-drop support, clearer empty state
- [ ] Live card preview - Show real-time preview of final card layout (not just crop), reuse `renderCard` logic
- [ ] Button state feedback - Show "Saving..." / "Creating..." on buttons during mutations, not just status text
- [x] Submit enablement hint - Helper text when required fields are missing
- [ ] Status consolidation - Single status indicator instead of multiple inline messages
- [x] Field validation UI - Inline error messages + required field indicators
- [ ] Jersey number format hint - Add a format helper for jersey numbers
- [x] Rendered card panel - Move rendered preview to top of right column
- [x] Submit flow clarity - Auto-save draft on submit
- [ ] Page title - Change from "BHVR" to "Trading Card Studio"
- [ ] Upload progress - Show progress bar during photo upload (especially for large files)
- [ ] Success celebration - Brief animation or visual feedback when card is submitted successfully
- [ ] Keyboard navigation - Tab order, Enter to submit form sections

### Admin/Management
- [ ] Admin list endpoint - Query cards by status using GSI (`byStatus`)
- [ ] Card gallery - View all submitted cards
- [ ] Status management - Mark cards as `rendered`, delete drafts

### Polish
- [ ] Card templates - Different designs/themes
- [x] Font loading - Custom fonts for card text (Sora/Fraunces)
- [ ] Image optimization - Resize before upload, WebP support
- [ ] Mobile UX - Touch-friendly cropping

### Production
- [ ] Auth - Protect card creation/submission (or admin routes only)
- [ ] Rate limiting - Prevent abuse
- [ ] Monitoring - CloudWatch logs, error tracking
- [ ] CI/CD - Automated deployments

## Key Decisions & Considerations
- **Frontend:** Vite + React + Tailwind + TanStack Router + TanStack Query.
- **Backend:** Hono on AWS Lambda (via `hono/aws-lambda`).
- **Infra:** SST v3 with a Router and a media bucket; same-origin routing for `/api/*`, `/u/*`, `/r/*`, and the web app.
- **Rendering:** Browser canvas for final image generation (deterministic, no html2canvas).
- **Crop UX:** Drag-and-drop crop with `react-easy-crop`, persist crop as normalized rectangle + rotation.
- **Storage:** S3 for uploads and renders, DynamoDB for metadata.
- **Security:** Presigned uploads, private buckets with CloudFront OAC access; minimal public exposure.

## Dev Mode Strategy (SST + Vite)
- **Two terminals:** `AWS_PROFILE=prod npx sst dev` + `cd client && pnpm dev`
- SST runs Lambda with `Resource.*` bindings, deploys infra to AWS
- Vite runs locally on `:5173` (or `:5174`) with env vars from `.env.development`
- Frontend calls Lambda URL directly in dev (CORS enabled on Lambda)
- Media URLs use Router URL in dev (S3 only accessible via CloudFront)
- **Production:** Same-origin routing via Router (`/api/*`, `/u/*`, `/r/*`)
- **Dev:** Direct Lambda calls + Router for media

## S3 Key Versioning Strategy
- **Versioned keys:** each upload gets a unique ID to avoid cache invalidation issues
- Key format:
  - `uploads/original/<cardId>/<uploadId>.<ext>`
  - `uploads/crop/<cardId>/<uploadId>.<ext>`
  - `renders/<cardId>/<renderId>.png`
- The returned `key` or `publicUrl` is stored in the card record
- Client always uses the stored key; no assumptions about "current" key
- CloudFront can cache aggressively since keys never collide

## Public vs Admin API Boundaries
- **Public routes (no auth):**
  - `POST /api/uploads/presign` – get presigned URL for upload
  - `POST /api/cards` – create draft
  - `GET /api/cards/:id` – fetch own draft (by ID only, no listing)
  - `PATCH /api/cards/:id` – update draft (cannot set `status` or `renderKey`)
  - `POST /api/cards/:id/submit` – submit card (sets `status=submitted`)
- **Admin routes (future, requires auth):**
  - `GET /api/cards` – list cards by status (uses GSI)
  - `PATCH /api/cards/:id/render` – mark as rendered, set `renderKey` (worker or admin)
- **Server-controlled fields:** `status`, `renderKey`, `createdAt`, `updatedAt`

## Architecture Overview
- **CloudFront (SST Router)**
  - `/` and `/assets/*` → Vite static site bucket
  - `/api/*` → Hono Lambda URL
  - `/u/*` → media bucket `uploads/` prefix
  - `/r/*` → media bucket `renders/` prefix
- **S3**
  - `media` bucket (private, CloudFront access only)
  - `uploads/` and `renders/` prefixes
  - lifecycle for `uploads/` (expire after 14 days)
  - CORS for direct browser uploads (prod origin + localhost for dev)
- **DynamoDB**
  - table `Cards` for draft/submitted metadata
  - GSI: `status` (PK) + `createdAt` (SK) for admin listing

## Repo Structure
- `client/` (Vite + React + TanStack Router/Query)
- `server/` (Hono Lambda app)
- `shared/` (types + Zod schemas)
- `sst.config.ts` (infra and routing)

## Data Model (in `shared/`)
- `CardDesign`
  - `id`, `templateId`, `type`, `teamName`, `position`, `jerseyNumber`, `firstName`, `lastName`, `photographer`
  - `photo`:
    - `originalKey`, `width`, `height`
    - `crop`: `x`, `y`, `w`, `h` (normalized 0..1), `rotateDeg` (0/90/180/270)
    - `cropKey?` (optional cropped derivative)
  - `status`: `draft | submitted | rendered`
  - `renderKey`, `createdAt`, `updatedAt`

## API Surface (Hono)
- `POST /api/uploads/presign`
  - input: `{ cardId, contentType, contentLength, kind: "original" | "crop" | "render" }`
  - validates size + content type (jpeg/png/webp, render must be png)
  - output: `{ uploadUrl, key, publicUrl, method, fields }` (POST policy for direct S3 uploads)
- `POST /api/cards` – create draft
- `GET /api/cards/:id` – fetch draft
- `PATCH /api/cards/:id` – update draft + crop metadata
- `POST /api/cards/:id/submit` – mark submitted with `renderKey`

## Upload & Render Flow
1. Client creates draft (or submit auto-creates) → gets card ID
2. Client requests presign for original upload (`kind=original`)
3. Client uploads to S3 directly, stores `originalKey` in draft via PATCH
4. Client stores crop metadata (and optionally uploads cropped derivative)
5. Client renders final card to canvas (825x1125 full-bleed)
6. Client uploads render via presign (`kind=render`)
7. Client calls `submit` with `renderKey`
8. Server sets `status=submitted` and stores `renderKey`

## Canvas Render Details (`renderCard.ts`)
- Card dimensions: 825x1125 pixels
- Full-bleed image covering entire card (high-quality smoothing)
- Gradient overlay at bottom (350px) for text readability
- Text elements:
  - "TRADING CARD" label (top left)
  - Jersey number watermark (top right, semi-transparent)
  - Player name (bottom, over gradient, shrink-to-fit)
  - Position / Team (below name)
  - Jersey number badge (below position)
  - Photo credit (bottom right)
- Border decorations (subtle white lines)
- Fonts: Sora (sans) + Fraunces (display)

## Crop UX Details
- `react-easy-crop` with drag/pinch/scroll for crop and zoom
- Controls: Zoom In, Zoom Out, Reset (rotation disabled for v1)
- Crop rectangle stored as normalized coordinates (0..1)
- Default crop initializes on media load
- Card aspect ratio: 825:1125 (approx 0.73:1)
- Shared constants in `shared/src/constants.ts` (CARD_WIDTH, CARD_HEIGHT, CARD_ASPECT)

## Suggested Next Milestone (Tight & Realistic)

**Goal:** Fix correctness bugs, make production deployable

1. **Fix crop correctness** ✅ DONE
   - [x] Correct `onCropComplete` argument usage (use 1st arg, not 2nd)
   - [x] Unify crop aspect with render aspect (825:1125 = 0.7333)
   - [x] Disable rotation for v1 (rotation math needs safe-area implementation)

2. **Make production truly same-origin** ✅ DONE
   - [x] Use relative `/api`, `/u`, `/r` in production build (gate on `import.meta.env.DEV`)
   - [x] Allow all origins for S3 CORS (bucket is private, URLs are short-lived)

3. **API hardening** ✅ DONE
   - [x] Presign requires card exists
   - [x] Submit requires renderKey + correct status + validates format
   - [x] Clamp crop values on server

4. **Admin/review screen (optional but valuable)**
   - [ ] List `submitted` cards via GSI (`byStatus`)
   - [ ] Display final render + metadata for quick approval

---

## Milestones
1. **Phase 0: Infra Skeleton** ✅
2. **Phase 1: Card Builder UI** ✅
3. **Phase 2: AWS Uploads** ✅
4. **Phase 3: Submission Pipeline** ✅
5. **Phase 3b: Critical Bug Fixes** ✅
6. **Phase 4: API/Server Hardening** ✅
7. **Phase 4b: Developer Experience** ✅ (eslint, pre-commit hooks)
8. **Phase 5: Remaining Hardening** ⚠️ **← Current Priority** (error handling, validation polish, loading states)
9. **Phase 6: UX Upgrades** - Planned
10. **Phase 7: Admin/Management** - Planned
11. **Phase 8: Polish** - Planned
12. **Phase 9: Production** - Planned

## Open Questions
- Retention period for `renders/`? (`uploads/` expires after 14 days)
- Store cropped derivative, or only original + crop metadata? (Currently: original only)
- Any admin interface required in v1?
- Custom fonts for card rendering?
- PATCH semantics - Current impl is "merge and replace" (Get → merge → Put). Cannot unset fields, no optimistic concurrency. Accept for v1 or switch to `UpdateCommand` with explicit SET/REMOVE?

## Answered Questions
- **Rotation support** - Disabled for v1. The rotation math needs proper safe-area canvas implementation which is complex. Will revisit in a future version if needed.
