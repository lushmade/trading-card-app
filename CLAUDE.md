# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A sports trading card creation app. Users upload photos, crop them via drag-and-drop, fill out player details (name, position, team, jersey number, photographer credit), and submit cards for rendering. Built as a monorepo with pnpm workspaces.

## Commands

```bash
# Install dependencies
pnpm install

# Development (backend only - see Development section for full workflow)
AWS_PROFILE=prod npx sst dev

# Build
pnpm build

# Type checking
pnpm type-check

# Linting
pnpm lint
```

## Deployment

This app uses a **hybrid deployment** via [austin-site](https://github.com/austeane/austin-site):
- **Frontend**: Built and deployed from austin-site at https://www.austinwallace.ca/trading-cards
- **Backend**: Deployed from this repo (Lambda, DynamoDB, S3)

**Deploy backend** (from this repo):
```bash
AWS_PROFILE=prod npx sst deploy --stage production
```

**Deploy frontend** (from austin-site):
```bash
cd ~/dev/austin-site
AWS_PROFILE=prod npx sst deploy --stage production
```

Both deployments are required for a fully functioning production app. Frontend changes require redeploying austin-site; backend changes require redeploying this repo.

## Pre-commit Hooks

Husky + lint-staged runs on every commit:
- `pnpm type-check` - Full monorepo type checking
- `eslint --fix` - Auto-fix lint issues on staged files

## Development Workflow

Run two terminals from this repo:

**Terminal 1 - Backend:**
```bash
AWS_PROFILE=prod npx sst dev
```

**Terminal 2 - Frontend:**
```bash
cd client && pnpm dev
```

Open http://localhost:5173. Both frontend and backend hot reload on save.

**Note:** `client/.env.development` contains `VITE_API_URL` and `VITE_ROUTER_URL`. Update these if SST outputs change after redeployment.

**URL routing:**
- **Production:** Same-origin via CloudFront Router (`/api/*`, `/r/*`, `/c/*`)
- **Dev:** Frontend calls Lambda URL directly (CORS enabled), media via Router

## Architecture

### Monorepo Structure

- **client/** - React 19 + Vite + TanStack Router + TailwindCSS v4
- **server/** - Hono API (runs locally via tsx, deploys as Lambda)
- **shared/** - TypeScript types shared between client and server

### Key Technologies

- **SST v3** for AWS infrastructure (DynamoDB, S3, Lambda, CloudFront Router)
- **TanStack Query** for client data fetching
- **react-easy-crop** for drag-and-drop image cropping

### SST Resources (sst.config.ts)

- `Cards` - DynamoDB table with GSIs:
  - `byStatus` (status + createdAt)
  - `byTournamentStatus` (tournamentId + statusCreatedAt)
- `Media` - S3 bucket for uploads, renders, and tournament config
  - Lifecycle rules: crop uploads (14d), originals (2yr), renders (1yr)
- `Api` - Lambda function running Hono
- `CardRouter` - CloudFront router with routes:
  - `/api/*` → Lambda API
  - `/r/*` → S3 renders
  - `/c/*` → S3 config (tournament logos, team logos, overlays)

### API Routes (server/src/index.ts)

**Public Endpoints:**
| Method | Path | Description |
|--------|------|-------------|
| GET | `/tournaments` | List published tournaments |
| GET | `/tournaments/:id` | Get tournament config |
| GET | `/tournaments/:id/teams` | Get tournament teams |
| GET | `/admin-config` | Check if admin auth is enabled |
| POST | `/uploads/presign` | Get presigned URL for S3 upload |
| POST | `/cards` | Create new card draft |
| GET | `/cards` | List cards by status (not drafts) |
| GET | `/cards/:id` | Get card by ID |
| GET | `/cards/:id/photo-url` | Get signed URL for draft photo (edit token required) |
| PATCH | `/cards/:id` | Update card (requires edit token) |
| POST | `/cards/:id/submit` | Submit card for rendering |

**Admin Endpoints** (require `Authorization: Bearer <password>` when auth enabled):
| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/tournaments` | List all tournaments (including unpublished) |
| GET | `/admin/tournaments/:id` | Get tournament draft config |
| POST | `/admin/tournaments` | Create new tournament |
| PUT | `/admin/tournaments/:id` | Update tournament config |
| POST | `/admin/tournaments/:id/publish` | Publish tournament |
| POST | `/admin/tournaments/:id/logos-zip` | Bulk upload team logos |
| POST | `/admin/tournaments/:id/assets/presign` | Presign tournament assets |
| GET | `/admin/tournaments/:id/bundle` | Export tournament as ZIP |
| POST | `/admin/tournaments/import-bundle` | Import tournament from ZIP |
| GET | `/admin/cards` | List cards (including drafts) |
| PATCH | `/admin/cards/:id` | Update card templateId |
| DELETE | `/admin/cards/:id` | Delete draft card |
| GET | `/admin/cards/:id/photo-url` | Get signed URL for original photo |
| GET | `/admin/cards/:id/download-url` | Get signed URL for render |
| POST | `/admin/cards/:id/renders/presign` | Presign render upload |
| POST | `/admin/cards/:id/renders/commit` | Commit render and update status |
| POST | `/admin/cards/:id/render` | Mark card as rendered |

### Data Flow (Auto-Save)

The app uses automatic background saving - no manual "Save Draft" button:

1. **Card type selected** → Card auto-created in background → card ID + edit token stored
2. **Photo selected** → Immediately uploads to S3 (no debounce)
3. **Form fields edited** → Debounced auto-save (2.5s after last change) → PATCH to server + localStorage
4. **Page refresh** → Resume modal appears → Photo restored via signed URL from `/cards/:id/photo-url`
5. **Submit** → Render pipeline triggered (renderKey stored on card)

Draft persistence uses `localStorage` (`client/src/draftStorage.ts`) with:
- `cardId`, `editToken`, `tournamentId`, `cardType`
- Form field values
- Photo metadata (`key`, `width`, `height`, `crop`) for S3 restoration

### Type Aliases (tsconfig.json)

```
@server/* → ./server/src/*
@client/* → ./client/src/*
@shared/* → ./shared/src/*
```

### Canvas Renderer (client/src/renderCard.ts)

Generates 825x1125 PNG cards client-side:
- Full-bleed image with gradient overlay
- Text overlays: name, position/team, jersey number, photo credit
- Uses shared constants from `shared/src/constants.ts`

## Development Notes

- **Auto-save**: Form fields save automatically 2.5s after changes; photos upload immediately on selection
- Card status flow: `draft` → `submitted` → `rendered`
- Card types: `player`, `team-staff`, `media`, `official`, `tournament-staff`, `rare`
- Crop coordinates stored as normalized 0-1 floats (rotation: 0, 90, 180, 270)
- Card dimensions: 825x1125 pixels (constants in `shared/src/constants.ts`)
- Max upload size: 15MB, allowed types: JPEG, PNG, WebP (render must be PNG)
- S3 keys are versioned with unique upload IDs to avoid cache issues:
  - `uploads/original/<cardId>/<uploadId>.<ext>`
  - `uploads/crop/<cardId>/<uploadId>.<ext>` (deprecated, expires after 14d)
  - `renders/<cardId>/<renderId>.png`
- Tournament config stored in S3: `config/tournaments/<id>/<draft|published>/config.json`
- Team logos: `config/tournaments/<id>/teams/<teamId>.png`
- Template overlays: `config/tournaments/<id>/overlays/<templateId>/<uploadId>.png`
- Public PATCH cannot set `status` or `renderKey` (server-controlled fields)
- Edit token required for card mutations (stored in `X-Edit-Token` header)
- Presign endpoint requires card to exist (prevents orphan uploads)
- Submit endpoint requires valid renderKey and draft status

## Sentry

Client error tracking uses `@sentry/react` (initialized in `client/src/main.tsx`).

### Error / Exception Tracking

Use `Sentry.captureException(error)` in `catch` blocks or expected failure paths.

### Tracing

Create custom spans for meaningful user actions or API calls:

```javascript
Sentry.startSpan(
  { op: "ui.click", name: "Submit Card" },
  () => {
    // handler logic
  },
);
```

```javascript
async function fetchCards() {
  return Sentry.startSpan(
    { op: "http.client", name: "GET /api/cards" },
    async () => {
      const response = await fetch("/api/cards");
      return response.json();
    },
  );
}
```

### Logs

Import `* as Sentry` and use `const { logger } = Sentry` for structured logs.

```javascript
logger.info("Upload complete", { cardId });
logger.warn("Retrying upload", { attempt });
logger.error("Upload failed", { error: String(error) });
```

## Tech Debt & Workarounds

1. **Hybrid Deployment** - Frontend deploys from austin-site, backend from this repo. Remember to deploy both when making full-stack changes.

2. **Symlinks in austin-site** - The `apps/trading-cards/` directory in austin-site symlinks to this repo. Changes here are picked up by austin-site builds.

3. **CORS Wildcard** - Lambda Function URL uses `allowMethods: ["*"]` because AWS has a 6-character limit per method (OPTIONS is 7 chars).

4. **Base Path for Production** - When building for production via austin-site, `VITE_BASE_PATH=/trading-cards` must be set. The TanStack Router `basepath` in `client/src/router.tsx` reads this at build time.

5. **CloudFront Cache** - After deploying austin-site, you may need to invalidate CloudFront cache if changes don't appear:
   ```bash
   AWS_PROFILE=prod aws cloudfront create-invalidation --distribution-id E1JQ3CFBKJU5SV --paths "/trading-cards/*"
   ```
