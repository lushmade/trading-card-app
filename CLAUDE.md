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

- `Cards` - DynamoDB table with GSI on status+createdAt
- `Media` - S3 bucket for uploads and renders
- `Api` - Lambda function running Hono
- `CardRouter` - CloudFront router with routes:
  - `/api/*` → Lambda API
  - `/r/*` → S3 renders
  - `/c/*` → S3 config

### API Routes (server/src/index.ts)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/uploads/presign` | Get presigned URL for S3 upload |
| POST | `/cards` | Create new card draft |
| GET | `/cards/:id` | Get card by ID |
| PATCH | `/cards/:id` | Update card |
| POST | `/cards/:id/submit` | Submit card for rendering |

### Data Flow

1. Client creates card draft → gets card ID
2. Client uploads original photo using presigned URL
3. User crops image (stored as normalized percentages)
4. Client can upload cropped image
5. Submit triggers render pipeline (renderKey stored on card)

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

- Card status flow: `draft` → `submitted` → `rendered`
- Crop coordinates stored as normalized 0-1 floats (rotation disabled for v1)
- Card dimensions: 825x1125 pixels (constants in `shared/src/constants.ts`)
- Max upload size: 15MB, allowed types: JPEG, PNG, WebP (render must be PNG)
- S3 keys are versioned with unique upload IDs to avoid cache issues:
  - `uploads/original/<cardId>/<uploadId>.<ext>`
  - `uploads/crop/<cardId>/<uploadId>.<ext>`
  - `renders/<cardId>/<renderId>.png`
- Public PATCH cannot set `status` or `renderKey` (server-controlled fields)
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
