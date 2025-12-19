# Trading Card Studio

A web application for creating custom sports trading cards. Upload a photo, crop it with drag-and-drop, add player details, and generate a high-quality PNG card ready for printing or sharing.

![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![pnpm](https://img.shields.io/badge/pnpm-10.15-orange)

## Features

- **Drag-and-drop image cropping** - Frame the perfect shot with intuitive controls
- **Live preview** - See your card come together in real-time
- **Client-side rendering** - High-quality 825x1125 PNG generation in the browser
- **Auto-save drafts** - Never lose your work
- **Serverless architecture** - Scales automatically with AWS Lambda

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, Vite, TailwindCSS v4, TanStack Router & Query |
| Backend | Hono (Lambda), DynamoDB, S3 |
| Infrastructure | SST v3, CloudFront Router |
| Build | pnpm workspaces, Turbo, TypeScript |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CloudFront Router                         │
├──────────────┬───────────────────────┬──────────────────────────┤
│   /*         │   /api/*              │   /u/* & /r/*            │
│   Static     │   Lambda API          │   S3 Media               │
│   (React)    │   (Hono)              │   (uploads/renders)      │
└──────────────┴───────────────────────┴──────────────────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │  DynamoDB   │
                    │   Cards     │
                    └─────────────┘
```

**Data Flow:**
1. User creates a card draft and receives a card ID
2. Uploads photo via presigned S3 URL
3. Crops image using normalized coordinates (stored as 0-1 floats)
4. Client renders the final card as PNG using Canvas API
5. Uploads rendered PNG and submits card

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 10+
- AWS CLI configured with a profile (for deployment)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/trading-card-app.git
cd trading-card-app

# Install dependencies
pnpm install
```

### Development

Run two terminals simultaneously:

**Terminal 1 - SST (infrastructure + Lambda)**
```bash
AWS_PROFILE=prod npx sst dev
```

**Terminal 2 - Vite (frontend)**
```bash
cd client && pnpm dev
```

Open http://localhost:5173 to view the app.

### Build & Deploy

```bash
# Type check
pnpm type-check

# Lint
pnpm lint

# Build all packages
pnpm build

# Deploy to AWS
AWS_PROFILE=prod npx sst deploy
```

## Project Structure

```
trading-card-app/
├── client/                 # React frontend
│   ├── src/
│   │   ├── App.tsx         # Main card creation UI
│   │   ├── renderCard.ts   # Canvas-based card renderer
│   │   └── router.tsx      # TanStack Router setup
│   └── index.html
├── server/                 # Hono API
│   └── src/
│       ├── index.ts        # API routes
│       └── lambda.ts       # AWS Lambda handler
├── shared/                 # Shared TypeScript types
│   └── src/
│       ├── types/          # CardDesign, CropRect, etc.
│       └── constants.ts    # Card dimensions
├── sst.config.ts           # SST infrastructure
└── package.json            # Monorepo root
```

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/uploads/presign` | Get presigned URL for S3 upload |
| `POST` | `/cards` | Create a new card draft |
| `GET` | `/cards/:id` | Retrieve card by ID |
| `PATCH` | `/cards/:id` | Update card details |
| `POST` | `/cards/:id/submit` | Submit card for finalization |

### Card Status Flow

```
draft → submitted → rendered
```

### Upload Constraints

- **Max file size:** 15 MB
- **Allowed types:** JPEG, PNG, WebP (render must be PNG)
- **Card dimensions:** 825 x 1125 pixels

## Configuration

### Environment Variables

The client uses environment variables injected at build time:

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | Lambda function URL (dev only) |
| `VITE_ROUTER_URL` | CloudFront Router URL (dev only) |

In production, relative URLs are used (same-origin via CloudFront).

### Pre-commit Hooks

Husky + lint-staged runs on every commit:
- Full TypeScript type checking
- ESLint auto-fix on staged files

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

Built with [SST](https://sst.dev) and [Claude Code](https://claude.ai/code)
