# Architecture — KontenPilot AI

## Overview

KontenPilot AI adalah AI Content Intelligence Platform untuk marketing agency
yang menggunakan Next.js + TypeScript + SQLite + Drizzle ORM.

## Tech Stack

- **Framework:** Next.js (App Router)
- **Language:** TypeScript
- **Database:** SQLite via better-sqlite3 + Drizzle ORM
- **AI:** OpenAI GPT-4.1
- **Media:** Cloudinary + S3 + Pexels + Pixabay + FAL
- **Publishing:** Buffer, native YouTube, Meta API
- **Deployment:** systemd service

## Core Components

### Content Generation
- `generateContent.ts` — Caption + hashtag generation
- Content variety system (structure, hook, content type, caption style)
- Regeneration loop with avoid lists

### Content Intelligence
- `contentIntelligence.ts` — 7-dimension scoring
- `contentSimilarity.ts` — Similarity detection + tiers
- `contentFatigue.ts` — Content fatigue detection
- `hashtagTracking.ts` — Overused hashtag detection
- `similarityTier.ts` — Safe/review/high/regenerate tiers

### Platform Adaptation
- `platformAdaptation.ts` — TikTok/Instagram/Facebook/YouTube caption adaptation

### Pre-Publishing QC
- `prePublishQC.ts` — Quality checks before publishing

### Pipeline
- `processProject.ts` — Main content pipeline
- `orchestrate.ts` — Publishing orchestration

## Data Flow

```
User Input
    ↓
Script Processing
    ↓
Content Generation (GPT-4.1)
    ↓
Variety Check (avoid overused patterns)
    ↓
Regeneration (if needed)
    ↓
Quality Checks
    ↓
Draft Review
    ↓
Publishing (per platform adaptation)
```

## Production

- Service: `kontenpilot-backend.service`
- Port: 3100
- Database: `data/kontenpilot.db`
- Deploy: `./scripts/deploy-kontenpilot.sh`
