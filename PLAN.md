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
- Client: Vite + React with TanStack Router/Query + Tailwind; builder UI with `react-easy-crop`; Vite proxy for `/api`.
- Shared types include `CardDesign`/`CropRect` and related metadata.

## Completed Work (so far)
- Infra wired: Router/Bucket/Dynamo/Function/StaticSite in `sst.config.ts`.
- Lambda handler added via `hono/aws-lambda` (`server/src/lambda.ts`).
- API endpoints implemented: `/api/uploads/presign`, `/api/cards`, `/api/cards/:id` (GET/PATCH), `/api/cards/:id/submit`.
- Client UI scaffolded with form + crop panel + preview and draft save wiring.
- Local dev verified with separate `pnpm -C client dev`, `pnpm -C server dev`, and `sst dev`.

## Next Steps (near-term)
- Wire client to presigned upload flow (original upload + store `originalKey` and dimensions).
- Save crop metadata into the draft on create/update.
- Implement canvas render, presigned upload for renders, and submit flow.
- Add admin list endpoint using the `status` GSI and a lightweight review screen.
- Add validation/error UI; tighten limits; finalize lifecycle + prod CORS origins in `sst.config.ts`.

## Key Decisions & Considerations
- **Frontend:** Vite + React + Tailwind + TanStack Router + TanStack Query.
- **Backend:** Hono on AWS Lambda (via `hono/aws-lambda`).
- **Infra:** SST v3 with a Router and a media bucket; same-origin routing for `/api/*`, `/u/*`, `/r/*`, and the web app.
- **Rendering:** Browser canvas for final image generation (deterministic, no html2canvas).
- **Crop UX:** Drag-and-drop crop with a dedicated crop component (select `react-easy-crop`), persist crop as a normalized rectangle.
- **Storage:** S3 for uploads and renders, DynamoDB for metadata.
- **Security:** Presigned uploads, private buckets with CloudFront OAC access; minimal public exposure.

## Dev Mode Strategy (SST-first)
- **Primary dev command:** `AWS_PROFILE=prod npx sst dev`
- SST orchestrates the full stack; do not run `server/src/dev.ts` separately
- Access the app via the SST Router URL (printed on startup)
- All routes work same-origin: `/api/*`, `/u/*`, `/r/*`
- `Resource.Media.name` and `Resource.Cards.name` are injected by SST runtime
- Vite dev server runs on `:5173` but is proxied through SST Router
- No need for env fallbacks or separate Vite proxy config in production-like dev

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
  - lifecycle for `uploads/` (expire after N days)
  - CORS for direct browser uploads (prod origin + localhost for dev)
- **DynamoDB**
  - table `Cards` for draft/submitted metadata
  - GSI: `status` (PK) + `createdAt` (SK) for admin listing

## Repo Structure (adapted from bhvr)
- `client/` (Vite + React + TanStack Router/Query)
- `server/` (Hono Lambda app)
- `shared/` (types + Zod schemas)
- `sst.config.ts` (infra and routing)
- Add `infra/` if we want to break out stacks later

## Data Model (in `shared/`)
- `CardDesign`
  - `id`, `templateId`, `type`, `teamId`, `position`, `jerseyNumber`, `firstName`, `lastName`, `photographer`
  - `photo`:
    - `originalKey`, `width`, `height`
    - `crop`: `x`, `y`, `w`, `h` (normalized 0..1), `rotateDeg` (0/90/180/270)
    - `cropKey?` (optional cropped derivative)
  - `status`: `draft | submitted | rendered`
  - `renderKey`, `createdAt`, `updatedAt`

## API Surface (Hono)
- `POST /api/uploads/presign`
  - input: `{ cardId, contentType, contentLength, kind: "original" | "crop" | "render" }`
  - validates size + content type (e.g. jpeg/png/webp)
  - output: `{ uploadUrl, key, publicUrl, method, fields? }`
  - note: prefer presigned POST if we need strict size/type enforcement
- `POST /api/cards`
  - create draft
- `GET /api/cards/:id`
  - fetch draft
- `PATCH /api/cards/:id`
  - update draft + crop metadata
- `POST /api/cards/:id/submit`
  - mark submitted; include `renderKey`

## Upload & Render Flow
1. Client requests presign for original upload (`kind=original`).
2. Client uploads to S3 directly, stores `originalKey` in draft.
3. Client stores crop metadata (and optionally uploads a cropped derivative with `kind=crop`).
4. Client renders final card to canvas and uploads via presign (`kind=render`).
5. Client calls `submit` with `renderKey` + form data.

## S3 Object Key Scheme
- `uploads/original/<cardId>.<ext>`
- `uploads/crop/<cardId>.jpg` (optional)
- `renders/<cardId>.png`

## Crop UX & Rendering
- Use `react-easy-crop` with drag/pinch/scroll for crop and zoom.
- Persist crop rectangle in normalized image coordinates (0..1) plus rotation.
- Canvas renderer uses a consistent template geometry (825x1125).
- Handle EXIF orientation in-browser prior to rendering.

## Infra Plan (SST)
- Create `media` bucket with `access: "cloudfront"`.
- Create `cards` Dynamo table with `id` hash key and GSI on `status` + `createdAt`.
- Create Hono Lambda with `url: true`, link bucket + table, Lambda entrypoint uses `hono/aws-lambda`.
- Create Router:
  - `router.route("/api", api.url, { rewrite: { regex: "^/api/(.*)$", to: "/$1" } })`
  - `router.routeBucket("/u", bucket, { rewrite: { regex: "^/u/(.*)$", to: "/uploads/$1" } })`
  - `router.routeBucket("/r", bucket, { rewrite: { regex: "^/r/(.*)$", to: "/renders/$1" } })`
- Serve `client/` via `sst.aws.StaticSite` with `router: { instance: router }`.
- Bucket policy and CORS:
  - Allow CloudFront OAC `s3:GetObject` for media bucket.
  - Allow Lambda role to sign presigned uploads; scope `s3:PutObject` to `uploads/*` and `renders/*`.
  - CORS allow `PUT/POST/HEAD` from prod origin and localhost.

## Local Dev Workflow
- `pnpm install`
- `pnpm dev` for client/server shared builds
- Vite proxy `/api` to the local Hono server; client calls relative `/api`.
- `sst dev` for infra + live Lambda (optional). For local dev, use the proxy to avoid CORS and run Vite separately.
- Provide `.env` files for local endpoints and AWS profiles.

## Risks & Mitigations
- **Node runtime alignment:** keep Lambda entrypoint Node-compatible and avoid runtime-specific APIs.
- **SST + Router config drift:** keep route patterns and Vite `base` aligned.
- **Large images and memory:** constrain file size at presign and downscale in browser if needed.
- **Presigned uploads + OAC:** ensure bucket policy allows presigned writes while keeping reads behind CloudFront.

## Completed Cleanup Items
- Import shared types from `shared` (not `shared/dist`) to keep runtime/bundler behavior consistent.
- Fix placeholder types in `shared` (e.g. `success` should be `boolean`).
- Remove Bun-only types from the server build path and use Node types.

## Milestones
1. **Phase 0: Infra Skeleton (done)**
   - Lambda entrypoint (`hono/aws-lambda`)
   - Vite `/api` proxy and client routing
   - TanStack Router + Query wiring
2. **Phase 1: Card Builder UI (in progress)**
   - Form + crop UI + preview shell in place
3. **Phase 2: AWS Uploads (API done, client pending)**
   - Presigned upload API exists; client integration next
4. **Phase 3: Submission Pipeline**
   - Canvas render, upload final image, submit and persist
5. **Phase 4: Hardening**
   - Error handling, validation, logging, lifecycle rules

## Open Questions
- Which domain/subdomain should the Router use?
- Retention period for `uploads/` and `renders/`?
- Presigned upload method: PUT vs POST?
- Store cropped derivative, or only original + crop metadata?
- Any admin interface required in v1?
